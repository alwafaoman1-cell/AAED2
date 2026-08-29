import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CloudSupplier = Database["public"]["Tables"]["suppliers"]["Row"];
type PurchaseInvoice = Database["public"]["Tables"]["purchase_invoices"]["Row"];
type SupplierPayment = Database["public"]["Tables"]["supplier_payments"]["Row"];
type Expense = Database["public"]["Tables"]["expenses"]["Row"];
type JobOrder = Pick<Database["public"]["Tables"]["job_orders"]["Row"], "id" | "order_number" | "vehicle_id" | "claim_id">;
type Vehicle = Pick<Database["public"]["Tables"]["vehicles"]["Row"], "id" | "plate_number" | "plate_letters" | "plate_country" | "brand" | "model" | "vin">;
type Claim = Pick<Database["public"]["Tables"]["insurance_claims"]["Row"], "id" | "claim_number">;

export interface SupplierAccountSummary {
  purchases: number;
  payments: number;
  outstanding: number;
  purchaseCount: number;
  vehicleLinkedPurchases: number;
}

export interface SupplierAccountListRow extends CloudSupplier, SupplierAccountSummary {}

export interface SupplierStatementRow extends Record<string, unknown> {
  id: string;
  date: string;
  source_type: "purchase_invoice" | "expense" | "payment" | "legacy_payment";
  reference: string;
  supplier_invoice_number: string;
  description: string;
  subtotal: number;
  vat: number;
  purchase_amount: number;
  paid_amount: number;
  running_balance: number;
  payment_method: string;
  vehicle_linked: boolean;
  work_order_number: string;
  claim_number: string;
  plate_number: string;
  plate_letters: string;
  plate_country: string;
  vehicle_make: string;
  vehicle_model: string;
  vin: string;
}

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 100;
const INVALID_STATUSES = new Set(["cancelled", "canceled", "void", "invalid", "deleted", "reversed"]);
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const normalized = (value: unknown) => String(value || "").trim().toLowerCase();
const isImmediatePayment = (method: string | null) => !["", "credit", "on_credit", "آجل"].includes(normalized(method));

async function purchaseInvoices(tenantId: string, supplierIds: string[], from?: string, to?: string): Promise<PurchaseInvoice[]> {
  if (!supplierIds.length) return [];
  const rows: PurchaseInvoice[] = [];
  for (let offset = 0; offset < supplierIds.length; offset += ID_CHUNK_SIZE) {
    const ids = supplierIds.slice(offset, offset + ID_CHUNK_SIZE);
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = supabase.from("purchase_invoices").select("*").eq("tenant_id", tenantId).in("supplier_id", ids).order("date").range(start, start + PAGE_SIZE - 1);
      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);
      const { data, error } = await query;
      if (error) throw error;
      const batch = (data || []).filter((row) => !INVALID_STATUSES.has(normalized(row.status)));
      rows.push(...batch);
      if ((data || []).length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function supplierPayments(tenantId: string, supplierIds: string[], from?: string, to?: string): Promise<SupplierPayment[]> {
  if (!supplierIds.length) return [];
  const rows: SupplierPayment[] = [];
  for (let offset = 0; offset < supplierIds.length; offset += ID_CHUNK_SIZE) {
    const ids = supplierIds.slice(offset, offset + ID_CHUNK_SIZE);
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = supabase.from("supplier_payments").select("*").eq("tenant_id", tenantId).in("supplier_id", ids).order("payment_date").range(start, start + PAGE_SIZE - 1);
      if (from) query = query.gte("payment_date", from);
      if (to) query = query.lte("payment_date", to);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function supplierExpenses(tenantId: string, supplierIds: string[], from?: string, to?: string): Promise<Expense[]> {
  if (!supplierIds.length) return [];
  const rows: Expense[] = [];
  for (let offset = 0; offset < supplierIds.length; offset += ID_CHUNK_SIZE) {
    const ids = supplierIds.slice(offset, offset + ID_CHUNK_SIZE);
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = supabase.from("expenses").select("*").eq("tenant_id", tenantId).in("supplier_id", ids).is("deleted_at", null).is("archived_at", null).order("date").range(start, start + PAGE_SIZE - 1);
      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []).filter((row) => !INVALID_STATUSES.has(normalized(row.status))));
      if ((data || []).length < PAGE_SIZE) break;
    }
  }
  return rows;
}

function invoiceMatchKey(supplierId: string | null, invoiceNumber: string | null) {
  return `${supplierId || ""}|${normalized(invoiceNumber)}`;
}

function accountSummary(supplierId: string, invoices: PurchaseInvoice[], payments: SupplierPayment[], expenses: Expense[]): SupplierAccountSummary {
  const supplierInvoices = invoices.filter((row) => row.supplier_id === supplierId);
  const supplierPaymentRows = payments.filter((row) => row.supplier_id === supplierId);
  const invoiceKeys = new Set(supplierInvoices.filter((row) => row.supplier_invoice_number).map((row) => invoiceMatchKey(row.supplier_id, row.supplier_invoice_number)));
  const directExpenses = expenses.filter((row) => row.supplier_id === supplierId && (!row.supplier_invoice_number || !invoiceKeys.has(invoiceMatchKey(row.supplier_id, row.supplier_invoice_number))));
  const purchases = supplierInvoices.reduce((sum, row) => sum + num(row.total), 0) + directExpenses.reduce((sum, row) => sum + num(row.total || row.amount), 0);
  const explicitPayments = supplierPaymentRows.reduce((sum, row) => sum + num(row.amount), 0);
  const paymentsByInvoice = new Map<string, number>();
  for (const payment of supplierPaymentRows) if (payment.purchase_invoice_id) paymentsByInvoice.set(payment.purchase_invoice_id, (paymentsByInvoice.get(payment.purchase_invoice_id) || 0) + num(payment.amount));
  const legacyPaid = supplierInvoices.reduce((sum, row) => sum + Math.max(0, num(row.paid_amount) - (paymentsByInvoice.get(row.id) || 0)), 0);
  const directPaid = directExpenses.filter((row) => isImmediatePayment(row.payment_method)).reduce((sum, row) => sum + num(row.total || row.amount), 0);
  const paid = explicitPayments + legacyPaid + directPaid;
  return {
    purchases, payments: paid, outstanding: purchases - paid,
    purchaseCount: supplierInvoices.length + directExpenses.length,
    vehicleLinkedPurchases: directExpenses.filter((row) => Boolean(row.vehicle_id || row.work_order_id || row.linked_work_order_id)).reduce((sum, row) => sum + num(row.total || row.amount), 0),
  };
}

export async function fetchSupplierAccounts(input: { tenantId: string; search?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize || 25));
  let query = supabase.from("suppliers").select("*", { count: "exact" }).eq("tenant_id", input.tenantId).eq("is_active", true).order("name").range((page - 1) * pageSize, page * pageSize - 1);
  const search = input.search?.trim();
  if (search) query = query.or(`name.ilike.%${search.replace(/[%_,()]/g, "")}%,phone.ilike.%${search.replace(/[%_,()]/g, "")}%,category.ilike.%${search.replace(/[%_,()]/g, "")}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const suppliers = data || [];
  const ids = suppliers.map((row) => row.id);
  const [invoices, payments, expenses] = await Promise.all([
    purchaseInvoices(input.tenantId, ids), supplierPayments(input.tenantId, ids), supplierExpenses(input.tenantId, ids),
  ]);
  return {
    rows: suppliers.map((supplier) => ({ ...supplier, ...accountSummary(supplier.id, invoices, payments, expenses) })),
    total: count || 0, page, pageSize, totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  };
}

export async function fetchSupplierDirectorySummary(tenantId: string) {
  const suppliers: Array<Pick<CloudSupplier, "id">> = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase.from("suppliers").select("id").eq("tenant_id", tenantId).eq("is_active", true).range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    suppliers.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  const ids = suppliers.map((row) => row.id);
  const [invoices, payments, expenses] = await Promise.all([purchaseInvoices(tenantId, ids), supplierPayments(tenantId, ids), supplierExpenses(tenantId, ids)]);
  return ids.reduce((result, supplierId) => {
    const summary = accountSummary(supplierId, invoices, payments, expenses);
    result.purchases += summary.purchases;
    result.payments += summary.payments;
    result.outstanding += summary.outstanding;
    result.purchaseCount += summary.purchaseCount;
    return result;
  }, { supplierCount: ids.length, purchases: 0, payments: 0, outstanding: 0, purchaseCount: 0 });
}

async function fetchLookups(tenantId: string, expenses: Expense[]) {
  const workOrderIds = [...new Set(expenses.map((row) => row.work_order_id || row.linked_work_order_id).filter(Boolean))] as string[];
  const directVehicleIds = expenses.map((row) => row.vehicle_id).filter(Boolean) as string[];
  const directClaimIds = expenses.map((row) => row.claim_id).filter(Boolean) as string[];
  const workOrdersResult = workOrderIds.length
    ? await supabase.from("job_orders").select("id,order_number,vehicle_id,claim_id").eq("tenant_id", tenantId).in("id", workOrderIds)
    : { data: [] as JobOrder[], error: null };
  if (workOrdersResult.error) throw workOrdersResult.error;
  const workOrders = (workOrdersResult.data || []) as JobOrder[];
  const vehicleIds = [...new Set([...directVehicleIds, ...workOrders.map((row) => row.vehicle_id).filter(Boolean)])];
  const claimIds = [...new Set([...directClaimIds, ...workOrders.map((row) => row.claim_id).filter(Boolean) as string[]])];
  const [vehiclesResult, claimsResult] = await Promise.all([
    vehicleIds.length ? supabase.from("vehicles").select("id,plate_number,plate_letters,plate_country,brand,model,vin").eq("tenant_id", tenantId).in("id", vehicleIds) : Promise.resolve({ data: [] as Vehicle[], error: null }),
    claimIds.length ? supabase.from("insurance_claims").select("id,claim_number").eq("tenant_id", tenantId).in("id", claimIds).is("deleted_at", null) : Promise.resolve({ data: [] as Claim[], error: null }),
  ]);
  if (vehiclesResult.error) throw vehiclesResult.error;
  if (claimsResult.error) throw claimsResult.error;
  return {
    workOrders: new Map(workOrders.map((row) => [row.id, row])),
    vehicles: new Map(((vehiclesResult.data || []) as Vehicle[]).map((row) => [row.id, row])),
    claims: new Map(((claimsResult.data || []) as Claim[]).map((row) => [row.id, row])),
  };
}

export async function fetchSupplierStatement(input: { tenantId: string; supplierId: string; from?: string; to?: string }) {
  const supplierResult = await supabase.from("suppliers").select("*").eq("tenant_id", input.tenantId).eq("id", input.supplierId).maybeSingle();
  if (supplierResult.error) throw supplierResult.error;
  if (!supplierResult.data) throw new Error("SUPPLIER_NOT_FOUND");
  const [invoices, payments, expenses] = await Promise.all([
    purchaseInvoices(input.tenantId, [input.supplierId]),
    supplierPayments(input.tenantId, [input.supplierId]),
    supplierExpenses(input.tenantId, [input.supplierId]),
  ]);
  const invoiceKeys = new Set(invoices.filter((row) => row.supplier_invoice_number).map((row) => invoiceMatchKey(row.supplier_id, row.supplier_invoice_number)));
  const directExpenses = expenses.filter((row) => !row.supplier_invoice_number || !invoiceKeys.has(invoiceMatchKey(row.supplier_id, row.supplier_invoice_number)));
  const lookups = await fetchLookups(input.tenantId, directExpenses);
  const rows: SupplierStatementRow[] = [];
  for (const invoice of invoices) {
    rows.push({ id: `invoice-${invoice.id}`, date: invoice.date, source_type: "purchase_invoice", reference: invoice.invoice_number,
      supplier_invoice_number: invoice.supplier_invoice_number || "", description: invoice.notes || "فاتورة شراء", subtotal: num(invoice.subtotal), vat: num(invoice.vat),
      purchase_amount: num(invoice.total), paid_amount: 0, running_balance: 0, payment_method: "credit", vehicle_linked: false,
      work_order_number: "", claim_number: "", plate_number: "", plate_letters: "", plate_country: "", vehicle_make: "", vehicle_model: "", vin: "" });
  }
  for (const expense of directExpenses) {
    const workOrder = lookups.workOrders.get(expense.work_order_id || expense.linked_work_order_id || "");
    const vehicle = lookups.vehicles.get(expense.vehicle_id || workOrder?.vehicle_id || "");
    const claim = lookups.claims.get(expense.claim_id || workOrder?.claim_id || "");
    const amount = num(expense.total || expense.amount);
    rows.push({ id: `expense-${expense.id}`, date: expense.supplier_invoice_date || expense.date, source_type: "expense", reference: expense.voucher_number,
      supplier_invoice_number: expense.supplier_invoice_number || "", description: expense.description || expense.notes || "مصروف/شراء مباشر", subtotal: num(expense.subtotal), vat: num(expense.vat_amount),
      purchase_amount: amount, paid_amount: isImmediatePayment(expense.payment_method) ? amount : 0, running_balance: 0, payment_method: expense.payment_method,
      vehicle_linked: Boolean(vehicle || workOrder), work_order_number: workOrder?.order_number || "", claim_number: claim?.claim_number || "",
      plate_number: vehicle?.plate_number || "", plate_letters: vehicle?.plate_letters || "", plate_country: vehicle?.plate_country || "",
      vehicle_make: vehicle?.brand || "", vehicle_model: vehicle?.model || "", vin: vehicle?.vin || "" });
  }
  const actualPaymentsByInvoice = new Map<string, number>();
  for (const payment of payments) {
    if (payment.purchase_invoice_id) actualPaymentsByInvoice.set(payment.purchase_invoice_id, (actualPaymentsByInvoice.get(payment.purchase_invoice_id) || 0) + num(payment.amount));
    rows.push({ id: `payment-${payment.id}`, date: payment.payment_date, source_type: "payment", reference: payment.payment_number,
      supplier_invoice_number: "", description: payment.notes || "دفعة مورد", subtotal: 0, vat: 0, purchase_amount: 0, paid_amount: num(payment.amount), running_balance: 0,
      payment_method: payment.payment_method, vehicle_linked: false, work_order_number: "", claim_number: "", plate_number: "", plate_letters: "", plate_country: "", vehicle_make: "", vehicle_model: "", vin: "" });
  }
  for (const invoice of invoices) {
    const legacyPaid = Math.max(0, num(invoice.paid_amount) - (actualPaymentsByInvoice.get(invoice.id) || 0));
    if (!legacyPaid) continue;
    rows.push({ id: `legacy-payment-${invoice.id}`, date: invoice.date, source_type: "legacy_payment", reference: invoice.invoice_number,
      supplier_invoice_number: invoice.supplier_invoice_number || "", description: "دفعة محفوظة في فاتورة الشراء", subtotal: 0, vat: 0, purchase_amount: 0,
      paid_amount: legacyPaid, running_balance: 0, payment_method: "legacy", vehicle_linked: false, work_order_number: "", claim_number: "", plate_number: "", plate_letters: "", plate_country: "", vehicle_make: "", vehicle_model: "", vin: "" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance = 0;
  for (const row of rows) { balance += row.purchase_amount - row.paid_amount; row.running_balance = balance; }
  const filteredRows = rows.filter((row) => (!input.from || row.date >= input.from) && (!input.to || row.date <= input.to));
  return { supplier: supplierResult.data, rows: filteredRows, summary: accountSummary(input.supplierId, invoices, payments, expenses), openingBalance: filteredRows.length ? filteredRows[0].running_balance - filteredRows[0].purchase_amount + filteredRows[0].paid_amount : balance };
}

export async function saveSupplier(tenantId: string, input: Partial<CloudSupplier> & { name: string; id?: string }) {
  const payload = {
    tenant_id: tenantId, name: input.name.trim(), phone: input.phone || null, email: input.email || null, address: input.address || null,
    tax_number: input.tax_number || null, category: input.category || null, vehicle_brands: input.vehicle_brands || [], notes: input.notes || null,
    is_active: input.is_active ?? true,
  };
  const query = input.id
    ? supabase.from("suppliers").update(payload).eq("tenant_id", tenantId).eq("id", input.id)
    : supabase.from("suppliers").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data;
}

export async function deactivateSupplier(tenantId: string, supplierId: string) {
  const { error } = await supabase.from("suppliers").update({ is_active: false }).eq("tenant_id", tenantId).eq("id", supplierId);
  if (error) throw error;
}

export async function importSupplierRows(tenantId: string, rows: Array<Partial<CloudSupplier> & { name: string }>) {
  const existing: Array<Pick<CloudSupplier, "id" | "name">> = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase.from("suppliers").select("id,name").eq("tenant_id", tenantId).range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    existing.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  const byName = new Map(existing.map((supplier) => [normalized(supplier.name), supplier.id]));
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const key = normalized(row.name);
    if (!key) continue;
    const id = byName.get(key);
    const saved = await saveSupplier(tenantId, { ...row, name: row.name, id });
    if (id) updated += 1;
    else { added += 1; byName.set(key, saved.id); }
  }
  return { added, updated };
}
