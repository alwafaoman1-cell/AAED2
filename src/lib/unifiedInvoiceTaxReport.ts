import { supabase } from "@/integrations/supabase/client";

export type InvoiceSourceFilter = "all" | "customer_invoice" | "insurance_invoice";
export type CollectionFilter = "all" | "paid" | "partial" | "unpaid";
export type VatFilter = "all" | "positive" | "zero";

export interface UnifiedInvoiceFilters {
  tenantId: string;
  source: InvoiceSourceFilter;
  from: string;
  to: string;
  invoiceNumber: string;
  party: string;
  plate: string;
  collection: CollectionFilter;
  vat: VatFilter;
}

export interface UnifiedInvoiceRow extends Record<string, unknown> {
  id: string;
  source_type: string;
  invoice_number: string | null;
  invoice_date: string | null;
  status: string | null;
  claim_id: string | null;
  claim_number: string | null;
  party_name: string | null;
  plate: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  paid: number | null;
  outstanding: number | null;
}

export interface UnifiedInvoicePage {
  rows: UnifiedInvoiceRow[];
  count: number;
}

const EXPORT_BATCH_SIZE = 500;
const MAX_EXPORT_ROWS = 10_000;

function likeTerm(value: string): string {
  return `%${value.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

function queryInvoices(filters: UnifiedInvoiceFilters) {
  if (!filters.tenantId) throw new Error("TENANT_REQUIRED");
  if (filters.from && filters.to && filters.from > filters.to) throw new Error("INVALID_DATE_RANGE");

  // security_invoker view; the explicit tenant predicate is defense in depth.
  let query = supabase.from("reports_invoice_facts_v1")
    .select("id, source_type, invoice_number, invoice_date, status, claim_id, claim_number, party_name, plate, subtotal, vat, total, paid, outstanding", { count: "exact" })
    .eq("tenant_id", filters.tenantId);

  if (filters.source !== "all") query = query.eq("source_type", filters.source);
  if (filters.from) query = query.gte("invoice_date", filters.from);
  if (filters.to) query = query.lte("invoice_date", filters.to);
  if (filters.invoiceNumber.trim()) query = query.ilike("invoice_number", likeTerm(filters.invoiceNumber));
  if (filters.party.trim()) query = query.ilike("party_name", likeTerm(filters.party));
  if (filters.plate.trim()) query = query.ilike("plate", likeTerm(filters.plate));
  if (filters.collection === "paid") query = query.lte("outstanding", 0.001);
  if (filters.collection === "partial") query = query.gt("paid", 0.001).gt("outstanding", 0.001);
  if (filters.collection === "unpaid") query = query.lte("paid", 0.001).gt("outstanding", 0.001);
  if (filters.vat === "positive") query = query.gt("vat", 0);
  if (filters.vat === "zero") query = query.lte("vat", 0);

  return query.order("invoice_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
}

export async function fetchUnifiedInvoicePage(
  filters: UnifiedInvoiceFilters,
  page: number,
  pageSize = 50,
): Promise<UnifiedInvoicePage> {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const { data, count, error } = await queryInvoices(filters).range(offset, offset + pageSize - 1);
  if (error) throw error;
  return { rows: (data || []) as UnifiedInvoiceRow[], count: count ?? 0 };
}

export async function fetchAllUnifiedInvoices(filters: UnifiedInvoiceFilters): Promise<UnifiedInvoiceRow[]> {
  const first = await fetchUnifiedInvoicePage(filters, 1, EXPORT_BATCH_SIZE);
  if (first.count > MAX_EXPORT_ROWS) throw new Error("EXPORT_RANGE_TOO_LARGE");
  const rows = [...first.rows];
  for (let page = 2; rows.length < first.count; page += 1) {
    const next = await fetchUnifiedInvoicePage(filters, page, EXPORT_BATCH_SIZE);
    if (next.count !== first.count) throw new Error("INVOICE_SET_CHANGED_DURING_EXPORT");
    if (!next.rows.length) throw new Error("INCOMPLETE_INVOICE_EXPORT");
    rows.push(...next.rows);
  }
  const keys = new Set(rows.map((row) => `${row.source_type}:${row.id}`));
  if (rows.length !== first.count || keys.size !== rows.length) throw new Error("INCOMPLETE_INVOICE_EXPORT");
  return rows;
}

function baisa(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 1000) : 0;
}

export function summarizeOutputVat(rows: UnifiedInvoiceRow[]) {
  const groups = {
    customer_invoice: { count: 0, subtotal: 0, vat: 0, total: 0 },
    insurance_invoice: { count: 0, subtotal: 0, vat: 0, total: 0 },
  };
  for (const row of rows) {
    if (row.source_type !== "customer_invoice" && row.source_type !== "insurance_invoice") continue;
    const group = groups[row.source_type];
    group.count += 1;
    group.subtotal += baisa(row.subtotal);
    group.vat += baisa(row.vat);
    group.total += baisa(row.total);
  }
  const result = Object.fromEntries(Object.entries(groups).map(([source, group]) => [source, {
    count: group.count,
    subtotal: group.subtotal / 1000,
    vat: group.vat / 1000,
    total: group.total / 1000,
  }])) as Record<"customer_invoice" | "insurance_invoice", { count: number; subtotal: number; vat: number; total: number }>;
  return {
    ...result,
    all: {
      count: result.customer_invoice.count + result.insurance_invoice.count,
      subtotal: (groups.customer_invoice.subtotal + groups.insurance_invoice.subtotal) / 1000,
      vat: (groups.customer_invoice.vat + groups.insurance_invoice.vat) / 1000,
      total: (groups.customer_invoice.total + groups.insurance_invoice.total) / 1000,
    },
  };
}
