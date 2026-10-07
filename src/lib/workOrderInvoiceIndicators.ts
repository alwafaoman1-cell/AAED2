import { supabase } from "@/integrations/supabase/client";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { isInsuranceWorkOrder } from "@/lib/workOrderType";
import { isInsuranceClaimFinanciallyVoided } from "@/lib/insuranceClaimFinancialState";
import { isUuid } from "@/lib/uuid";
import { roundMoney } from "@/lib/money";

export type WorkOrderInvoiceState = "none" | "unpaid" | "partial" | "paid";

export interface WorkOrderInvoiceIndicator {
  state: WorkOrderInvoiceState;
  invoiceNumbers: string[];
  total: number;
  paid: number;
  settlementDiscount: number;
  remaining: number;
}

type InvoiceAmount = { number: string; total: number; paid: number; settlementDiscount?: number };

export function summarizeWorkOrderInvoices(invoices: InvoiceAmount[]): WorkOrderInvoiceIndicator {
  if (!invoices.length) return { state: "none", invoiceNumbers: [], total: 0, paid: 0, settlementDiscount: 0, remaining: 0 };
  const total = roundMoney(invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
  const paid = roundMoney(invoices.reduce((sum, invoice) => sum + Number(invoice.paid || 0), 0));
  const settlementDiscount = roundMoney(invoices.reduce((sum, invoice) => sum + Number(invoice.settlementDiscount || 0), 0));
  const remaining = roundMoney(invoices.reduce((sum, invoice) =>
    sum + Math.max(0, Number(invoice.total || 0) - Number(invoice.paid || 0) - Number(invoice.settlementDiscount || 0)), 0));
  return {
    state: total > 0 && remaining <= 0.001 ? "paid" : paid > 0 ? "partial" : "unpaid",
    invoiceNumbers: invoices.map((invoice) => invoice.number).filter(Boolean),
    total,
    paid,
    settlementDiscount,
    remaining,
  };
}

function activeInvoiceStatus(status: unknown): boolean {
  return !["cancelled", "canceled", "void", "draft", "deleted"].includes(String(status || "").toLowerCase());
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function orderKey(order: WorkOrder): string {
  return order.cloudId || order.id;
}

/** Read only the visible work-order page. Invoice and payment ledgers stay separate by channel. */
export async function fetchWorkOrderInvoiceIndicators(
  tenantId: string,
  orders: WorkOrder[],
): Promise<Record<string, WorkOrderInvoiceIndicator>> {
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const result: Record<string, WorkOrderInvoiceIndicator> = {};
  if (!orders.length) return result;

  const invoiceAmounts = new Map<string, InvoiceAmount[]>();
  for (const order of orders) invoiceAmounts.set(orderKey(order), []);
  const cashOrders = orders.filter((order) => !isInsuranceWorkOrder(order));
  const insuranceOrders = orders.filter(isInsuranceWorkOrder);

  const cashPromise = cashOrders.length ? (async () => {
    const cashRefs = new Map<string, string>();
    for (const order of cashOrders) {
      for (const ref of [order.cloudId, order.id, order.displayNumber]) {
        if (ref) cashRefs.set(ref, orderKey(order));
      }
    }
    const salesQueries = chunks(cashOrders, 8).map((batch) => {
      const filters = new Set<string>();
      for (const order of batch) {
        for (const ref of [order.cloudId, order.id, order.displayNumber].filter(Boolean) as string[]) {
          if (isUuid(ref)) filters.add(`work_order_id.eq.${ref}`);
          filters.add(`metadata->>fromDocId.eq.WO-${ref}`);
          if (!isUuid(ref)) filters.add(`metadata->>fromDocId.eq.${ref}`);
          filters.add(`metadata->>costCenter.eq.${ref}`);
          filters.add(`notes.ilike.%#WO:${ref}%`);
        }
      }
      return (supabase.from("sales_documents" as any) as any)
        .select("id,doc_number,status,invoice_status,issued_at,total,paid_amount,work_order_id,metadata,notes")
        .eq("tenant_id", tenantId)
        .eq("doc_type", "invoice")
        .is("deleted_at", null)
        .or([...filters].join(","));
    });
    const salesResults = await Promise.all(salesQueries);
    const salesRows = new Map<string, any>();
    for (const response of salesResults) {
      if (response.error) throw response.error;
      for (const row of response.data || []) {
        if (activeInvoiceStatus(row.status)
          && (row.invoice_status === "issued" || (row.invoice_status == null && !!row.issued_at))) {
          salesRows.set(row.id, row);
        }
      }
    }
    const salesIds = [...salesRows.keys()];
    const salesPayments = salesIds.length
      ? await (supabase.from("sales_payments" as any) as any)
          .select("sales_document_id,amount")
          .eq("tenant_id", tenantId)
          .in("sales_document_id", salesIds)
      : { data: [], error: null };
    if (salesPayments.error) throw salesPayments.error;
    const paidByDocument = new Map<string, number>();
    for (const payment of salesPayments.data || []) {
      paidByDocument.set(payment.sales_document_id, roundMoney((paidByDocument.get(payment.sales_document_id) || 0) + Number(payment.amount || 0)));
    }
    for (const row of salesRows.values()) {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const fromDocId = String(metadata.fromDocId || "");
      const noteRefs = [...String(row.notes || "").matchAll(/#WO:([A-Za-z0-9-]+)/g)].map((match) => match[1]);
      const key = [row.work_order_id, fromDocId, fromDocId.startsWith("WO-") ? fromDocId.slice(3) : "", metadata.costCenter, ...noteRefs]
        .map((ref) => cashRefs.get(String(ref || "")))
        .find(Boolean);
      if (!key) continue;
      invoiceAmounts.get(key)?.push({
        number: row.doc_number || "",
        total: Number(row.total || 0),
        paid: paidByDocument.get(row.id) || 0,
      });
    }
  })() : Promise.resolve();

  const insurancePromise = insuranceOrders.length ? (async () => {
    const ordersByUuid = new Map(insuranceOrders.filter((order) => isUuid(order.cloudId || order.id)).map((order) => [order.cloudId || order.id, orderKey(order)]));
    const directClaimIds = [...new Set(insuranceOrders.map((order) => order.claimId).filter((id): id is string => !!id && isUuid(id)))];
    const orderUuids = [...ordersByUuid.keys()];
    const claimQueries = [
      ...(directClaimIds.length ? [(supabase.from("insurance_claims" as any) as any)
        .select("id,job_order_id,auto_job_order_id,status,deleted_at")
        .eq("tenant_id", tenantId).in("id", directClaimIds)] : []),
      ...(orderUuids.length ? [
        (supabase.from("insurance_claims" as any) as any)
          .select("id,job_order_id,auto_job_order_id,status,deleted_at")
          .eq("tenant_id", tenantId).in("job_order_id", orderUuids),
        (supabase.from("insurance_claims" as any) as any)
          .select("id,job_order_id,auto_job_order_id,status,deleted_at")
          .eq("tenant_id", tenantId).in("auto_job_order_id", orderUuids),
      ] : []),
    ];
    const claimResults = await Promise.all(claimQueries);
    const claims = new Map<string, any>();
    for (const response of claimResults) {
      if (response.error) throw response.error;
      for (const claim of response.data || []) {
        if (!isInsuranceClaimFinanciallyVoided(claim)) claims.set(claim.id, claim);
      }
    }
    const claimToOrders = new Map<string, Set<string>>();
    for (const order of insuranceOrders) {
      if (order.claimId && claims.has(order.claimId)) {
        const keys = claimToOrders.get(order.claimId) || new Set<string>();
        keys.add(orderKey(order));
        claimToOrders.set(order.claimId, keys);
      }
    }
    for (const claim of claims.values()) {
      const keys = claimToOrders.get(claim.id) || new Set<string>();
      for (const ref of [claim.job_order_id, claim.auto_job_order_id]) {
        const key = ordersByUuid.get(ref);
        if (key) keys.add(key);
      }
      if (keys.size) claimToOrders.set(claim.id, keys);
    }
    const relevantClaimIds = [...claimToOrders.keys()];
    if (relevantClaimIds.length) {
      const [invoiceResponse, paymentResponse] = await Promise.all([
        (supabase.from("insurance_invoices" as any) as any)
          .select("id,claim_id,invoice_number,status,total,settlement_discount_amount")
          .eq("tenant_id", tenantId).in("claim_id", relevantClaimIds),
        (supabase.from("claim_payments" as any) as any)
          .select("claim_id,amount")
          .eq("tenant_id", tenantId).in("claim_id", relevantClaimIds).eq("status", "cleared"),
      ]);
      if (invoiceResponse.error) throw invoiceResponse.error;
      if (paymentResponse.error) throw paymentResponse.error;
      const paidByClaim = new Map<string, number>();
      for (const payment of paymentResponse.data || []) {
        paidByClaim.set(payment.claim_id, roundMoney((paidByClaim.get(payment.claim_id) || 0) + Number(payment.amount || 0)));
      }
      const activeByClaim = new Map<string, any[]>();
      for (const invoice of invoiceResponse.data || []) {
        if (!activeInvoiceStatus(invoice.status)) continue;
        const rows = activeByClaim.get(invoice.claim_id) || [];
        rows.push(invoice);
        activeByClaim.set(invoice.claim_id, rows);
      }
      for (const [claimId, invoices] of activeByClaim) {
        const amount: InvoiceAmount = {
          number: invoices.map((invoice) => invoice.invoice_number).filter(Boolean).join(", "),
          total: invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
          paid: paidByClaim.get(claimId) || 0,
          settlementDiscount: invoices.reduce((sum, invoice) => sum + Number(invoice.settlement_discount_amount || 0), 0),
        };
        for (const key of claimToOrders.get(claimId) || []) invoiceAmounts.get(key)?.push(amount);
      }
    }
  })() : Promise.resolve();

  await Promise.all([cashPromise, insurancePromise]);
  for (const [key, invoices] of invoiceAmounts) result[key] = summarizeWorkOrderInvoices(invoices);
  return result;
}
