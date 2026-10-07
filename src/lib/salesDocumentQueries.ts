import { supabase } from "@/integrations/supabase/client";
import type { SalesDocStatus, SalesDocType } from "@/lib/salesStore";
import { numberPrefix } from "@/lib/salesStore";
import { resolveSeriesByPrefix } from "@/lib/numberingSettings";

export const SALES_LIST_PAGE_SIZE = 30;

export interface SalesDocumentListRow {
  id: string;
  number: string;
  type: SalesDocType;
  status: SalesDocStatus;
  date: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerTaxNo: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  balanceDue: number;
  lastPaymentDate: string | null;
}

export interface SalesDocumentPage {
  rows: SalesDocumentListRow[];
  total: number;
}

export interface SalesDocumentPageOptions {
  tenantId: string;
  type: SalesDocType;
  page: number;
  pageSize?: number;
  status?: string;
  search?: string;
}

export interface SalesFinancialSummary {
  invoiceCount: number;
  revenue: number;
  vat: number;
  invoiceTotal: number;
  paid: number;
  outstanding: number;
  unpaidCount: number;
  todayTotal: number;
  currentMonthTotal: number;
  currentMonthVat: number;
  monthly: Array<{ month: string; revenue: number; vat: number; total: number; paid: number; outstanding: number }>;
}

export interface CashSalesPaymentRow {
  id: string;
  date: string;
  amount: number;
  method: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
}

export async function fetchCashSalesPaymentsPage(tenantId: string, page: number, search: string): Promise<{ rows: CashSalesPaymentRow[]; total: number }> {
  const { data, error } = await (supabase.rpc as any)("list_cash_sales_payments_page_rpc", {
    p_tenant_id: tenantId,
    p_page: page,
    p_page_size: SALES_LIST_PAGE_SIZE,
    p_search: search.trim() || null,
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.items)) throw new Error("Cash payments page unavailable");
  return {
    total: Number(data.totalCount || 0),
    rows: data.items.map((row: any) => ({
      id: row.id,
      date: row.date,
      amount: Number(row.amount || 0),
      method: row.method || "",
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number || "",
      customerName: row.customer_name || "",
    })),
  };
}

export async function fetchSalesFinancialSummary(
  tenantId: string,
  from?: string | null,
  to?: string | null,
): Promise<SalesFinancialSummary> {
  const { data, error } = await (supabase.rpc as any)("sales_financial_read_summary_rpc", {
    p_tenant_id: tenantId,
    p_from: from || null,
    p_to: to || null,
  });
  if (error) throw error;
  if (!data || !Number.isFinite(Number(data.invoiceCount))) throw new Error("Sales summary unavailable");
  return {
    invoiceCount: Number(data.invoiceCount),
    revenue: Number(data.revenue || 0),
    vat: Number(data.vat || 0),
    invoiceTotal: Number(data.invoiceTotal || 0),
    paid: Number(data.paid || 0),
    outstanding: Number(data.outstanding || 0),
    unpaidCount: Number(data.unpaidCount || 0),
    todayTotal: Number(data.todayTotal || 0),
    currentMonthTotal: Number(data.currentMonthTotal || 0),
    currentMonthVat: Number(data.currentMonthVat || 0),
    monthly: Array.isArray(data.monthly) ? data.monthly.map((row: any) => ({
      month: String(row.month),
      revenue: Number(row.revenue || 0),
      vat: Number(row.vat || 0),
      total: Number(row.total || 0),
      paid: Number(row.paid || 0),
      outstanding: Number(row.outstanding || 0),
    })) : [],
  };
}

/** A bounded read model: no line items, payment rows, attachments or metadata. */
export async function fetchSalesDocumentPage(options: SalesDocumentPageOptions): Promise<SalesDocumentPage> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize || SALES_LIST_PAGE_SIZE));
  const page = Math.max(1, Math.floor(options.page));
  const { data, error } = await (supabase.rpc as any)("list_sales_documents_page_rpc", {
    p_tenant_id: options.tenantId,
    p_doc_type: options.type,
    p_page: page,
    p_page_size: pageSize,
    p_status: options.status || "all",
    p_search: options.search?.trim() || null,
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.items)) throw new Error("Sales page unavailable");
  return {
    total: Number(data.totalCount || 0),
    rows: data.items.map((row: any) => ({
      id: row.id,
      number: row.doc_number || "",
      type: row.doc_type as SalesDocType,
      status: row.status as SalesDocStatus,
      date: row.date,
      createdAt: row.created_at,
      customerName: row.customer_name || "",
      customerPhone: row.customer_phone || "",
      customerAddress: row.customer_address || "",
      customerTaxNo: row.customer_tax_no || "",
      subtotal: Number(row.subtotal || 0),
      taxTotal: Number(row.tax_total || 0),
      total: Number(row.total || 0),
      paidTotal: Number(row.paid_amount || 0),
      balanceDue: Number(row.balance_due || 0),
      lastPaymentDate: row.last_payment_date || null,
    })),
  };
}

/** Full filtered export is deliberate and only runs after the export click. */
export async function fetchSalesDocumentExport(options: Omit<SalesDocumentPageOptions, "page">): Promise<SalesDocumentListRow[]> {
  const rows: SalesDocumentListRow[] = [];
  let expectedTotal: number | null = null;
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const result = await fetchSalesDocumentPage({ ...options, page, pageSize: 100 });
    if (expectedTotal === null) expectedTotal = result.total;
    if (result.total !== expectedTotal) throw new Error("Sales export changed while loading; retry for a consistent file");
    for (const row of result.rows) {
      if (seen.has(row.id)) throw new Error("Sales export page overlap; retry for a consistent file");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length === expectedTotal) return rows;
    if (rows.length > expectedTotal || result.rows.length === 0) {
      throw new Error("Sales export incomplete; no partial file will be downloaded");
    }
  }
}

export async function searchSalesDocuments(tenantId: string, search: string): Promise<Array<Pick<SalesDocumentListRow, "id" | "number" | "type" | "customerName">>> {
  const term = search.trim().replace(/[(),.%*"\\]/g, "").slice(0, 80);
  if (term.length < 2) return [];
  const { data, error } = await supabase.from("sales_documents")
    .select("id,doc_number,doc_type,customer_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .or(`doc_number.ilike.%${term}%,customer_name.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    number: row.doc_number || "",
    type: row.doc_type as SalesDocType,
    customerName: row.customer_name || "",
  }));
}

export async function fetchNextNonInvoiceNumber(tenantId: string, type: Exclude<SalesDocType, "invoice">): Promise<string> {
  const prefix = numberPrefix(type);
  const year = new Date().getFullYear();
  const { data, error } = await supabase.from("sales_documents")
    .select("doc_number")
    .eq("tenant_id", tenantId)
    .eq("doc_type", type)
    .ilike("doc_number", `${prefix}-${year}-%`)
    .order("doc_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  const current = Number(String(data?.[0]?.doc_number || "").split("-").at(-1)) || 0;
  const config = resolveSeriesByPrefix(prefix);
  const next = Math.max(current + 1, config?.startFrom ?? 1);
  return `${prefix}-${year}-${String(next).padStart(config?.padding ?? 5, "0")}`;
}
