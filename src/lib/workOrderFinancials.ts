import { supabase } from "@/integrations/supabase/client";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { isUuid } from "@/lib/uuid";
import { roundMoney } from "@/lib/money";

export type WorkOrderLinkedInvoiceKind = "sales_invoice" | "insurance_invoice";

export interface WorkOrderLinkedInvoice {
  kind: WorkOrderLinkedInvoiceKind;
  id: string;
  number: string;
  status: string;
  claimId: string | null;
  workOrderId: string | null;
  customerId: string | null;
  customerName: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  insuranceCompanyId: string | null;
  insuranceCompanyName: string | null;
  subtotal: number;
  vat: number;
  total: number;
  paid: number;
  remaining: number;
}

export interface WorkOrderFinancialSnapshot {
  invoices: WorkOrderLinkedInvoice[];
  subtotal: number;
  vat: number;
  total: number;
  paid: number;
  remaining: number;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function activeStatus(status: unknown) {
  return !["cancelled", "canceled", "draft"].includes(String(status || "").toLowerCase());
}

export async function fetchWorkOrderFinancials(
  tenantId: string,
  order: Pick<WorkOrder, "id" | "cloudId" | "displayNumber" | "claimId" | "customerId" | "customer" | "vehicleId" | "plate">,
): Promise<WorkOrderFinancialSnapshot> {
  if (!tenantId) throw new Error("tenant_not_found");

  const workOrderRefs = unique([
    order.cloudId,
    isUuid(order.id) ? order.id : null,
    order.displayNumber,
    order.id,
  ]);
  const workOrderUuid = workOrderRefs.find(isUuid) || null;
  const claimIds = new Set<string>();
  if (order.claimId && isUuid(order.claimId)) claimIds.add(order.claimId);

  if (workOrderUuid) {
    const { data: linkedClaims, error } = await (supabase.from("insurance_claims" as any) as any)
      .select("id")
      .eq("tenant_id", tenantId)
      .or(`job_order_id.eq.${workOrderUuid},auto_job_order_id.eq.${workOrderUuid}`);
    if (error) throw error;
    for (const claim of linkedClaims || []) if (claim.id) claimIds.add(String(claim.id));
  }

  const salesFilters = unique(workOrderRefs.flatMap((ref) => [
    `work_order_id.eq.${ref}`,
    `metadata->>fromDocId.eq.WO-${ref}`,
    `metadata->>costCenter.eq.${ref}`,
  ]));
  const salesPromise = salesFilters.length
    ? (supabase.from("sales_documents" as any) as any)
        .select("id,doc_number,status,subtotal,tax_total,total,paid_amount,balance_due,customer_id,customer_name,vehicle_plate,work_order_id,metadata")
        .eq("tenant_id", tenantId)
        .eq("doc_type", "invoice")
        .is("deleted_at", null)
        .or(salesFilters.join(","))
    : Promise.resolve({ data: [], error: null });
  const insurancePromise = claimIds.size
    ? (supabase.from("insurance_invoices" as any) as any)
        .select("id,claim_id,invoice_number,status,subtotal,vat,total,paid_amount,insurance_company_id,insurance_company_name,vehicle_plate")
        .eq("tenant_id", tenantId)
        .in("claim_id", Array.from(claimIds))
    : Promise.resolve({ data: [], error: null });

  const [salesResult, insuranceResult] = await Promise.all([salesPromise, insurancePromise]);
  if (salesResult.error) throw salesResult.error;
  if (insuranceResult.error) throw insuranceResult.error;

  const salesRows = (salesResult.data || []).filter((row: any) => activeStatus(row.status));
  const insuranceRows = (insuranceResult.data || []).filter((row: any) => activeStatus(row.status));
  const salesIds = salesRows.map((row: any) => row.id).filter(Boolean);
  const allClaimIds = unique(insuranceRows.map((row: any) => row.claim_id));

  const [salesPaymentsResult, claimPaymentsResult, claimsResult] = await Promise.all([
    salesIds.length
      ? (supabase.from("sales_payments" as any) as any)
          .select("sales_document_id,amount")
          .eq("tenant_id", tenantId)
          .in("sales_document_id", salesIds)
      : Promise.resolve({ data: [], error: null }),
    allClaimIds.length
      ? (supabase.from("claim_payments" as any) as any)
          .select("claim_id,amount,status")
          .eq("tenant_id", tenantId)
          .in("claim_id", allClaimIds)
          .eq("status", "cleared")
      : Promise.resolve({ data: [], error: null }),
    allClaimIds.length
      ? (supabase.from("insurance_claims" as any) as any)
          .select("id,customer_id,vehicle_id,insurance_company_id,insurance_company,vehicle_plate")
          .eq("tenant_id", tenantId)
          .in("id", allClaimIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (salesPaymentsResult.error) throw salesPaymentsResult.error;
  if (claimPaymentsResult.error) throw claimPaymentsResult.error;
  if (claimsResult.error) throw claimsResult.error;

  const salesPaid = new Map<string, number>();
  for (const payment of salesPaymentsResult.data || []) {
    salesPaid.set(payment.sales_document_id, roundMoney((salesPaid.get(payment.sales_document_id) || 0) + Number(payment.amount || 0)));
  }
  const claimPaid = new Map<string, number>();
  for (const payment of claimPaymentsResult.data || []) {
    claimPaid.set(payment.claim_id, roundMoney((claimPaid.get(payment.claim_id) || 0) + Number(payment.amount || 0)));
  }
  const claimsById = new Map((claimsResult.data || []).map((claim: any) => [String(claim.id), claim]));

  const invoices: WorkOrderLinkedInvoice[] = [
    ...salesRows.map((row: any) => {
      const total = roundMoney(row.total);
      const paid = roundMoney(salesPaid.has(row.id) ? salesPaid.get(row.id) : row.paid_amount);
      return {
        kind: "sales_invoice" as const,
        id: row.id,
        number: row.doc_number,
        status: row.status,
        claimId: null,
        workOrderId: row.work_order_id || workOrderUuid,
        customerId: row.customer_id || order.customerId || null,
        customerName: row.customer_name || order.customer || "—",
        vehicleId: order.vehicleId || null,
        vehiclePlate: row.vehicle_plate || order.plate || null,
        insuranceCompanyId: null,
        insuranceCompanyName: null,
        subtotal: roundMoney(row.subtotal),
        vat: roundMoney(row.tax_total),
        total,
        paid,
        remaining: roundMoney(Math.max(0, total - paid)),
      };
    }),
    ...insuranceRows.map((row: any) => {
      const claim = claimsById.get(String(row.claim_id)) as any;
      const total = roundMoney(row.total);
      const paid = roundMoney(claimPaid.has(row.claim_id) ? claimPaid.get(row.claim_id) : row.paid_amount);
      return {
        kind: "insurance_invoice" as const,
        id: row.id,
        number: row.invoice_number,
        status: row.status,
        claimId: row.claim_id,
        workOrderId: workOrderUuid,
        customerId: claim?.customer_id || order.customerId || null,
        customerName: order.customer || "—",
        vehicleId: claim?.vehicle_id || order.vehicleId || null,
        vehiclePlate: row.vehicle_plate || claim?.vehicle_plate || order.plate || null,
        insuranceCompanyId: row.insurance_company_id || claim?.insurance_company_id || null,
        insuranceCompanyName: row.insurance_company_name || claim?.insurance_company || null,
        subtotal: roundMoney(row.subtotal),
        vat: roundMoney(row.vat),
        total,
        paid,
        remaining: roundMoney(Math.max(0, total - paid)),
      };
    }),
  ];

  return invoices.reduce<WorkOrderFinancialSnapshot>((snapshot, invoice) => ({
    invoices: [...snapshot.invoices, invoice],
    subtotal: roundMoney(snapshot.subtotal + invoice.subtotal),
    vat: roundMoney(snapshot.vat + invoice.vat),
    total: roundMoney(snapshot.total + invoice.total),
    paid: roundMoney(snapshot.paid + invoice.paid),
    remaining: roundMoney(snapshot.remaining + invoice.remaining),
  }), { invoices: [], subtotal: 0, vat: 0, total: 0, paid: 0, remaining: 0 });
}
