import { supabase } from "@/integrations/supabase/client";
import { roundMoney } from "@/lib/money";
import { nextExpenseVoucherNumber } from "@/lib/expenseVoucherNumbering";

export type ExpenseScope = "work_order" | "operating";
export type WorkOrderChannel = "cash" | "insurance";

export interface ExpenseCategoryRow {
  id: string; tenant_id: string; code: string; name_ar: string; name_en: string;
  parent_id: string | null; level: number; category_type: "department" | "category" | "subcategory";
  expense_scope: ExpenseScope | "both"; department_code: string | null;
  accounting_mapping_key: string | null; cost_center_id: string | null;
  is_system: boolean; is_active: boolean; sort_order: number;
  description_ar?: string | null; description_en?: string | null;
}

export function normalizeExpenseCategoryRow(row: any): ExpenseCategoryRow {
  const rawSortOrder = row?.sort_order;
  const sortOrder = rawSortOrder == null || rawSortOrder === ""
    ? Number.MAX_SAFE_INTEGER
    : Number(rawSortOrder);
  return {
    ...row,
    code: String(row?.code ?? ""),
    name_ar: String(row?.name_ar ?? ""),
    name_en: String(row?.name_en ?? ""),
    parent_id: row?.parent_id || null,
    level: Number(row?.level) || 1,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : Number.MAX_SAFE_INTEGER,
  } as ExpenseCategoryRow;
}

export function compareExpenseCategoryRows(
  a: ExpenseCategoryRow,
  b: ExpenseCategoryRow,
  mode: "tree" | "code" = "tree",
) {
  const left = normalizeExpenseCategoryRow(a);
  const right = normalizeExpenseCategoryRow(b);
  if (mode === "code") {
    const byCode = left.code.localeCompare(right.code, "en", { numeric: true, sensitivity: "base" });
    if (byCode) return byCode;
  }
  const byOrder = left.sort_order - right.sort_order;
  if (byOrder) return byOrder;
  return left.name_en.localeCompare(right.name_en, "en", { sensitivity: "base" })
    || left.name_ar.localeCompare(right.name_ar, "ar", { sensitivity: "base" })
    || left.code.localeCompare(right.code, "en", { numeric: true, sensitivity: "base" });
}

export interface ExpenseManagementFilters {
  from?: string; to?: string; scope?: string; channel?: string; work_order_id?: string;
  claim_id?: string; vehicle_id?: string; customer_id?: string; department_id?: string;
  category_id?: string; subcategory_id?: string; supplier_id?: string; payment_method?: string;
  cost_center_id?: string; amount_from?: string; amount_to?: string; vat?: string; search?: string;
  insurance_company?: string; classification_status?: string; work_order?: string; claim?: string;
  vehicle?: string; customer?: string; supplier?: string;
}

export interface ExpenseManagementRow extends Record<string, unknown> {
  id: string;
  voucher_number: string;
  date: string;
  supplier_name?: string | null;
  supplier_tax_number?: string | null;
  supplier_invoice_number?: string | null;
  supplier_invoice_date?: string | null;
}

export interface ExpenseInput {
  tenant_id: string; date: string; expense_scope: ExpenseScope; work_order_id?: string | null;
  linked_work_order_id?: string | null; department_id: string; expense_category_id: string;
  subcategory_id?: string | null; cost_center_id?: string | null; supplier_id?: string | null;
  supplier_invoice_number?: string | null; supplier_invoice_date?: string | null; payment_method: string; description: string;
  notes?: string | null; reference_number?: string | null; subtotal: number; vat_amount: number;
  total: number; is_vat_applicable: boolean; attachments?: unknown[];
}

function fail(error: any): never { throw new Error(error?.message || "تعذر تنفيذ العملية"); }

export async function listExpenseCategories(tenantId: string, includeInactive = true) {
  let q = (supabase.from("expense_categories") as any).select("*").eq("tenant_id", tenantId)
    .order("level").order("sort_order").order("name_en");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) fail(error);
  return (data || []).map(normalizeExpenseCategoryRow);
}

export async function getExpenseCategory(tenantId: string, id: string) {
  const { data, error } = await (supabase.from("expense_categories") as any)
    .select("*").eq("tenant_id", tenantId).eq("id", id).single();
  if (error) fail(error); return data as ExpenseCategoryRow;
}

export async function saveExpenseCategory(tenantId: string, userId: string, values: Partial<ExpenseCategoryRow>, id?: string) {
  const payload = { ...values, tenant_id: tenantId, updated_by: userId, ...(id ? {} : { created_by: userId }) };
  const query = id
    ? (supabase.from("expense_categories") as any).update(payload).eq("tenant_id", tenantId).eq("id", id)
    : (supabase.from("expense_categories") as any).insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) fail(error); return data as ExpenseCategoryRow;
}

export async function disableExpenseCategory(tenantId: string, id: string, userId: string) {
  const { data, error } = await (supabase.from("expense_categories") as any).update({ is_active: false, active: false, updated_by: userId })
    .eq("tenant_id", tenantId).eq("id", id).select("*").single();
  if (error) fail(error); return data as ExpenseCategoryRow;
}

export async function deleteExpenseCategory(tenantId: string, id: string) {
  const { error } = await (supabase.from("expense_categories") as any).delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
}

export async function listCategoryAudit(tenantId: string, categoryId?: string) {
  let q = (supabase as any).from("expense_category_audit_logs").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(100);
  if (categoryId) q = q.eq("category_id", categoryId);
  const { data, error } = await q; if (error) fail(error); return data || [];
}

export async function applyDefaultCategoryTemplate() {
  const { data, error } = await (supabase.rpc as any)("apply_default_expense_category_template");
  if (error) fail(error); return Number(data || 0);
}

export async function listExpenses(page: number, pageSize: number, filters: ExpenseManagementFilters) {
  const clean = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "" && value != null));
  const { data, error } = await (supabase.rpc as any)("expense_management_rpc", { p_page: page, p_page_size: pageSize, p_filters: clean });
  if (error) fail(error);
  const result = data as { rows: ExpenseManagementRow[]; aggregates: Record<string, number>; pagination: any };
  const supplierIds = [...new Set((result.rows || []).map((row: any) => row.supplier_id).filter(Boolean))] as string[];
  if (!supplierIds.length) return result;
  const { data: suppliers, error: suppliersError } = await (supabase.from("suppliers") as any)
    .select("id,name,tax_number")
    .in("id", supplierIds);
  if (suppliersError) fail(suppliersError);
  const suppliersById = new Map((suppliers || []).map((supplier: any) => [supplier.id, supplier]));
  return {
    ...result,
    rows: (result.rows || []).map((row: any) => {
      const supplier: any = suppliersById.get(row.supplier_id);
      return {
        ...row,
        supplier_name: row.supplier_name || supplier?.name || null,
        supplier_tax_number: row.supplier_tax_number || supplier?.tax_number || null,
      };
    }),
  };
}

export async function listAllExpenses(filters: ExpenseManagementFilters) {
  const first = await listExpenses(1, 500, filters);
  const pages = Number(first.pagination?.totalPages || 1);
  if (pages <= 1) return first.rows || [];
  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => listExpenses(index + 2, 500, filters)),
  );
  return [first, ...remaining].flatMap((result) => result.rows || []);
}

export async function getExpense(tenantId: string, id: string) {
  const { data, error } = await (supabase.from("expenses") as any).select("*").eq("tenant_id", tenantId).eq("id", id).single();
  if (error) fail(error); return data;
}

export async function searchExpenseWorkOrders(search: string) {
  if (search.trim().length < 2) return [];
  const { data, error } = await (supabase.rpc as any)("expense_work_order_search_rpc", { p_search: search.trim(), p_limit: 20 });
  if (error) fail(error); return (data || []) as any[];
}

export async function searchSuppliers(tenantId: string, search: string) {
  if (search.trim().length < 2) return [];
  const term = search.trim().replace(/[,%()]/g, " ");
  const { data, error } = await (supabase.from("suppliers") as any).select("id,name,phone,tax_number")
    .eq("tenant_id", tenantId).or(`name.ilike.%${term}%,phone.ilike.%${term}%,tax_number.ilike.%${term}%`)
    .limit(20);
  if (error) fail(error); return data || [];
}

export async function listCostCenters(tenantId: string) {
  const { data, error } = await (supabase.from("accounting_cost_centers") as any)
    .select("id,code,name_ar,name_en,is_active").eq("tenant_id", tenantId).eq("is_active", true).order("code");
  if (error) fail(error); return data || [];
}

export async function saveExpense(input: ExpenseInput, userId: string, id?: string) {
  const payload: any = {
    ...input, amount: roundMoney(input.subtotal), subtotal: roundMoney(input.subtotal),
    vat_amount: roundMoney(input.vat_amount), total: roundMoney(input.total), created_by: userId,
    category_id: input.subcategory_id || input.expense_category_id,
  };
  if (!id) payload.voucher_number = await nextExpenseVoucherNumber();
  const query = id
    ? (supabase.from("expenses") as any).update(payload).eq("tenant_id", input.tenant_id).eq("id", id)
    : (supabase.from("expenses") as any).insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) fail(error); if (!data?.id) throw new Error("لم يتم تأكيد حفظ المصروف"); return data;
}

export async function softDeleteExpense(tenantId: string, id: string) {
  const { data, error } = await (supabase.from("expenses") as any).update({ deleted_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).select("id").single();
  if (error) fail(error); return data;
}

export async function uploadExpenseAttachment(tenantId: string, expenseId: string, file: File) {
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("نوع الملف غير مدعوم");
  if (file.size > 12 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 12MB");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tenantId}/expenses/${expenseId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("expense-documents").upload(path, file, { contentType: file.type, upsert: false });
  if (error) fail(error);
  return { bucket: "expense-documents", path, file_name: file.name, mime_type: file.type, size: file.size };
}

export async function setExpenseAttachments(tenantId: string, expenseId: string, attachments: unknown[]) {
  const { data, error } = await (supabase.from("expenses") as any).update({ attachments })
    .eq("tenant_id", tenantId).eq("id", expenseId).select("*").single();
  if (error) fail(error); return data;
}
