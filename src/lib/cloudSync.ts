// طبقة ترحيل البيانات المحلية إلى Supabase
// تقرأ كل localStorage stores وترفعها على دفعات إلى الجداول المطابقة.
// تُستخدم من صفحة /settings/data-migration (لمرة واحدة بعد تفعيل السحابة).

import { supabase } from "@/integrations/supabase/client";
import { customersStore } from "./customersStore";
import { vehiclesStore } from "./vehiclesStore";
import { getWorkOrders } from "./workOrdersStore";
import { inventoryStore } from "./inventoryStore";
import { expensesStore } from "./expensesStore";
import { journalStore } from "./journalStore";
import { salesStore } from "./salesStore";
import { suppliersStore } from "./suppliersStore";

export type CloudEntity =
  | "customers"
  | "vehicles"
  | "suppliers"
  | "work_orders"
  | "inventory"
  | "expenses"
  | "journal"
  | "sales_documents";

export interface MigrationProgress {
  entity: CloudEntity;
  label: string;
  total: number;
  done: number;
  errors: number;
  status: "idle" | "running" | "done" | "error";
  message?: string;
}

export interface CloudResult {
  inserted: number;
  errors: number;
  message?: string;
}

const BATCH = 200;

async function getTenantId(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", u.user.id)
    .maybeSingle();
  return prof?.tenant_id ?? null;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** ====================== العملاء ====================== */
async function migrateCustomers(tenantId: string): Promise<CloudResult> {
  const list = customersStore.getAll();
  if (!list.length) return { inserted: 0, errors: 0 };
  const rows = list.map((c) => ({
    tenant_id: tenantId,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    address: c.address || null,
    id_number: c.idNumber || null,
    notes: c.notes || null,
    type: c.type || "individual",
    contact_person: c.contactPerson || null,
    commercial_registration: c.commercialRegistration || null,
    tax_number: c.taxNumber || null,
  }));
  let inserted = 0, errors = 0;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase
      .from("customers")
      .insert(batch, { count: "exact" });
    if (error) errors += batch.length; else inserted += count ?? batch.length;
  }
  return { inserted, errors };
}

/** ====================== المركبات ====================== */
async function migrateVehicles(tenantId: string): Promise<CloudResult> {
  const list = vehiclesStore.getAll();
  if (!list.length) return { inserted: 0, errors: 0 };

  // نحتاج معرفات العملاء من Supabase (بعد ترحيل العملاء)
  const { data: customers } = await supabase
    .from("customers")
    .select("id,name,phone")
    .eq("tenant_id", tenantId);
  const byName = new Map((customers || []).map((c: any) => [normalize(c.name), c.id]));
  const byPhone = new Map((customers || []).filter((c: any) => c.phone).map((c: any) => [c.phone, c.id]));

  let placeholderCustomerId: string | null = null;
  async function ensurePlaceholder(): Promise<string> {
    if (placeholderCustomerId) return placeholderCustomerId;
    const { data } = await supabase
      .from("customers")
      .insert({ tenant_id: tenantId, name: "— غير محدد —", type: "individual" })
      .select("id")
      .single();
    placeholderCustomerId = data!.id;
    return placeholderCustomerId;
  }

  const rows: any[] = [];
  for (const v of list) {
    let customerId = byName.get(normalize(v.owner)) || (v.ownerPhone ? byPhone.get(v.ownerPhone) : undefined);
    if (!customerId) customerId = await ensurePlaceholder();
    rows.push({
      tenant_id: tenantId,
      customer_id: customerId,
      plate_number: v.plate,
      brand: v.type?.split(" ")[0] || v.type || "غير محدد",
      model: v.type?.split(" ").slice(1).join(" ") || v.type || "غير محدد",
      year: v.year ? Number(v.year) : null,
      color: v.color || null,
      vin_number: v.vin || null,
      vehicle_type: v.type || null,
      mileage: v.mileage ? Number(v.mileage) : null,
      archived: !!v.archived,
      archived_at: v.archivedAt || null,
      archived_reason: v.archivedReason || null,
    });
  }
  let inserted = 0, errors = 0;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("vehicles").insert(batch, { count: "exact" });
    if (error) errors += batch.length; else inserted += count ?? batch.length;
  }
  return { inserted, errors };
}

/** ====================== أوامر العمل ====================== */
async function migrateWorkOrders(tenantId: string): Promise<CloudResult> {
  const list = getWorkOrders();
  if (!list.length) return { inserted: 0, errors: 0 };

  const { data: customers } = await supabase.from("customers").select("id,name").eq("tenant_id", tenantId);
  const { data: vehicles } = await supabase.from("vehicles").select("id,plate_number").eq("tenant_id", tenantId);
  const custByName = new Map((customers || []).map((c: any) => [normalize(c.name), c.id]));
  const vehByPlate = new Map((vehicles || []).map((v: any) => [v.plate_number, v.id]));

  let placeholderCust: string | null = null;
  let placeholderVeh: string | null = null;
  async function ensureCust(): Promise<string | null> {
    if (placeholderCust) return placeholderCust;
    const { data, error } = await supabase
      .from("customers")
      .insert({ tenant_id: tenantId, name: "— عميل غير محدد —" })
      .select("id")
      .single();
    if (error || !data) { console.error("[ensureCust]", error); return null; }
    placeholderCust = data.id;
    return placeholderCust;
  }
  async function ensureVeh(custId: string): Promise<string | null> {
    if (placeholderVeh) return placeholderVeh;
    const { data, error } = await supabase
      .from("vehicles")
      .insert({
        tenant_id: tenantId,
        customer_id: custId,
        plate_number: `UNK-${Date.now()}`,
        brand: "غير محدد",
        model: "غير محدد",
      })
      .select("id")
      .single();
    if (error || !data) { console.error("[ensureVeh]", error); return null; }
    placeholderVeh = data.id;
    return placeholderVeh;
  }

  const rows: any[] = [];
  let skipped = 0;
  let skipReason: string | undefined;
  for (const o of list) {
    const customerId = custByName.get(normalize(o.customer)) || (await ensureCust());
    if (!customerId) { skipped++; skipReason = "تعذر إنشاء عميل افتراضي (تحقق من صلاحيات RLS)"; continue; }
    const vehicleId = vehByPlate.get(o.plate) || (await ensureVeh(customerId));
    if (!vehicleId) { skipped++; skipReason = "تعذر إنشاء مركبة افتراضية"; continue; }
    rows.push({
      tenant_id: tenantId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      order_number: o.id,
      description: o.description || o.serviceType || null,
      diagnosis: o.diagnosis || null,
      diagnosis_notes: o.diagnosis || null,
      service_type: o.serviceType || null,
      technician_name: o.technician || null,
      entry_date: o.entryDate || new Date().toISOString().slice(0, 10),
      status: mapWoStatus(o.status),
      labor_cost: o.laborCost || 0,
      parts_cost: o.partsCost || 0,
      insurance_company: o.insurance || null,
      insurance_claim_number: o.claimNumber || null,
      notes: o.description || null,
      photos: (o.photos || []).map((p: any) => ({
        id: p.id, phase: p.phase, caption: p.caption, uploadedAt: p.uploadedAt,
      })) as any,
      parts_needed: (o.partsNeeded || []) as any,
    });
  }
  let inserted = 0, errors = skipped, lastErr: string | undefined = skipReason;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("job_orders").insert(batch, { count: "exact" });
    if (error) { errors += batch.length; lastErr = error.message; console.error("[migrate work_orders]", error); }
    else inserted += count ?? batch.length;
  }
  return { inserted, errors, message: lastErr };
}

function mapWoStatus(s: string): any {
  const norm = (s || "").trim();
  if (["مغلق", "تم التسليم"].includes(norm)) return "delivered";
  if (["جاهز للتسليم", "ضبط الجودة"].includes(norm)) return "completed";
  if (["تحت الإصلاح", "قيد العمل", "صيانة"].includes(norm)) return "in_progress";
  if (["بانتظار قطع الغيار", "بانتظار الموافقة"].includes(norm)) return "waiting_parts";
  if (["تحت الفحص", "فحص", "معاينة"].includes(norm)) return "inspection";
  return "received";
}

/** ====================== المخزون ====================== */
async function migrateInventory(tenantId: string): Promise<CloudResult> {
  const list = inventoryStore.getAll() as any[];
  if (!list.length) return { inserted: 0, errors: 0 };
  const rows: any[] = list.map((p: any) => ({
    tenant_id: tenantId,
    name: p.name || p.itemName || "صنف",
    part_number: p.partNumber || p.sku || null,
    category: p.category || null,
    quantity: Number(p.quantity ?? p.stock ?? p.stockQty ?? 0),
    min_quantity: Number(p.minStock ?? p.minQty ?? p.minQuantity ?? 5),
    unit_price: Number(p.sellPrice ?? p.unitPrice ?? p.price ?? 0),
    cost_price: Number(p.buyPrice ?? p.costPrice ?? p.cost ?? 0),
    unit: p.unit || "قطعة",
    barcode: p.barcode || null,
    location: p.location || null,
    notes: p.notes || null,
  }));
  let inserted = 0, errors = 0;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("inventory").insert(batch as any, { count: "exact" });
    if (error) errors += batch.length; else inserted += count ?? batch.length;
  }
  return { inserted, errors };
}
/** ====================== الموردون ====================== */
async function migrateSuppliers(tenantId: string): Promise<CloudResult> {
  const list = suppliersStore.getAll();
  if (!list.length) return { inserted: 0, errors: 0 };
  const rows = list.map((s) => ({
    tenant_id: tenantId,
    name: s.name,
    phone: s.phone || null,
    email: s.email || null,
    address: s.address || null,
    tax_number: s.taxNumber || null,
    notes: s.notes || null,
    vehicle_brands: s.vehicleBrands || [],
    category: s.category || null,
  }));
  let inserted = 0, errors = 0, lastErr: string | undefined;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("suppliers").insert(batch as any, { count: "exact" });
    if (error) { errors += batch.length; lastErr = error.message; }
    else inserted += count ?? batch.length;
  }
  return { inserted, errors, message: lastErr };
}



/** ====================== المصروفات ====================== */
async function migrateExpenses(tenantId: string): Promise<CloudResult> {
  const list = expensesStore.getAll();
  if (!list.length) return { inserted: 0, errors: 0 };
  const rows = list.map((e) => ({
    tenant_id: tenantId,
    voucher_number: e.voucherNumber || `EXP-${e.id.slice(0, 6)}`,
    date: e.date || new Date().toISOString().slice(0, 10),
    amount: Number(e.amount || 0),
    category_id: e.categoryId || null,
    category_name: e.categoryName || null,
    cashbox_id: e.cashboxId || null,
    cashbox_name: e.cashboxName || null,
    payment_method: e.paymentMethod || "cash",
    beneficiary: e.beneficiary || null,
    description: e.description || null,
    linked_work_order_id: e.linkedWorkOrderId || null,
    linked_vehicle_plate: e.linkedVehiclePlate || null,
    linked_vehicle_name: e.linkedVehicleName || null,
  }));
  let inserted = 0, errors = 0;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("expenses").insert(batch, { count: "exact" });
    if (error) errors += batch.length; else inserted += count ?? batch.length;
  }
  return { inserted, errors };
}

/** ====================== دفتر اليومية ====================== */
async function migrateJournal(tenantId: string): Promise<CloudResult> {
  const list = journalStore.getAll();
  if (!list.length) return { inserted: 0, errors: 0 };
  let inserted = 0, errors = 0;
  for (const je of list) {
    const { data: header, error: headErr } = await supabase
      .from("journal_entries")
      .insert({
        tenant_id: tenantId,
        entry_number: je.id,
        entry_date: je.date,
        description: je.description,
        source_type: je.source,
        source_id: je.sourceId,
        total_debit: je.amount,
        total_credit: je.amount,
      })
      .select("id")
      .single();
    if (headErr || !header) { errors++; continue; }
    const { error: linesErr } = await supabase.from("journal_lines").insert([
      {
        tenant_id: tenantId,
        entry_id: header.id,
        account_code: je.debitAccount,
        account_name: je.debitAccount,
        debit: je.amount,
        credit: 0,
        memo: je.description,
      },
      {
        tenant_id: tenantId,
        entry_id: header.id,
        account_code: je.creditAccount,
        account_name: je.creditAccount,
        debit: 0,
        credit: je.amount,
        memo: je.description,
      },
    ]);
    if (linesErr) errors++; else inserted++;
  }
  return { inserted, errors };
}

/** ====================== فواتير وعروض الأسعار ====================== */
async function migrateSalesDocs(tenantId: string): Promise<CloudResult> {
  const list = salesStore.list();
  if (!list.length) return { inserted: 0, errors: 0 };

  const { data: customers } = await supabase.from("customers").select("id,name").eq("tenant_id", tenantId);
  const custByName = new Map((customers || []).map((c: any) => [normalize(c.name), c.id]));

  const rows: any[] = list
    .filter((d) => d.type === "invoice" || d.type === "quote")
    .map((d) => ({
      tenant_id: tenantId,
      doc_number: String(d.number || d.id),
      doc_type: d.type,
      date: (d.date || new Date().toISOString()).slice(0, 10),
      due_date: d.dueDate ? d.dueDate.slice(0, 10) : null,
      customer_id: custByName.get(normalize(d.customerName)) || null,
      customer_name: d.customerName || null,
      vehicle_plate: (d as any).vehicle?.plate || null,
      vehicle_make: (d as any).vehicle?.make || null,
      vehicle_model: (d as any).vehicle?.model || null,
      items: d.items as any,
      subtotal: d.subtotal || 0,
      discount_total: d.discountTotal || 0,
      tax_total: d.taxTotal || 0,
      total: d.total || 0,
      paid_amount: (d as any).paidAmount || 0,
      balance_due: d.balanceDue || 0,
      status: d.status,
      notes: d.notes || null,
    }));

  let inserted = 0, errors = 0;
  for (const batch of chunked(rows, BATCH)) {
    const { error, count } = await supabase.from("sales_documents").insert(batch as any, { count: "exact" });
    if (error) errors += batch.length; else inserted += count ?? batch.length;
  }
  return { inserted, errors };
}


function normalize(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** ====================== المنسّق العام ====================== */
export const ENTITY_PLAN: { entity: CloudEntity; label: string; total: () => number; run: (t: string) => Promise<CloudResult> }[] = [
  { entity: "customers", label: "العملاء", total: () => customersStore.getAll().length, run: migrateCustomers },
  { entity: "vehicles", label: "المركبات", total: () => vehiclesStore.getAll().length, run: migrateVehicles },
  { entity: "suppliers", label: "الموردون", total: () => suppliersStore.getAll().length, run: migrateSuppliers },
  { entity: "work_orders", label: "أوامر العمل", total: () => getWorkOrders().length, run: migrateWorkOrders },
  { entity: "inventory", label: "المخزون", total: () => (inventoryStore as any).getAll?.().length || 0, run: migrateInventory },
  { entity: "expenses", label: "المصروفات", total: () => expensesStore.getAll().length, run: migrateExpenses },
  { entity: "journal", label: "دفتر اليومية", total: () => journalStore.getAll().length, run: migrateJournal },
  { entity: "sales_documents", label: "الفواتير وعروض الأسعار", total: () => salesStore.list().filter((d) => d.type === "invoice" || d.type === "quote").length, run: migrateSalesDocs },
];

export async function runFullMigration(
  onProgress: (p: MigrationProgress) => void
): Promise<{ ok: boolean; tenantId: string | null }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, tenantId: null };

  for (const step of ENTITY_PLAN) {
    const total = step.total();
    onProgress({ entity: step.entity, label: step.label, total, done: 0, errors: 0, status: total ? "running" : "done" });
    if (!total) continue;
    try {
      const res = await step.run(tenantId);
      onProgress({
        entity: step.entity,
        label: step.label,
        total,
        done: res.inserted,
        errors: res.errors,
        status: res.errors && !res.inserted ? "error" : "done",
        message: res.message,
      });
    } catch (e: any) {
      onProgress({ entity: step.entity, label: step.label, total, done: 0, errors: total, status: "error", message: e?.message });
    }
  }
  return { ok: true, tenantId };
}

/** فحص ما إذا كانت السحابة تحتوي بالفعل على بيانات (لمنع الترحيل المكرر) */
export async function cloudHasData(): Promise<{ entity: CloudEntity; count: number }[]> {
  const checks: CloudEntity[] = ["customers", "vehicles", "suppliers", "work_orders", "inventory", "expenses", "journal", "sales_documents"];
  const tableMap: Record<CloudEntity, string> = {
    customers: "customers",
    vehicles: "vehicles",
    suppliers: "suppliers",
    work_orders: "job_orders",
    inventory: "inventory",
    expenses: "expenses",
    journal: "journal_entries",
    sales_documents: "sales_documents",
  };
  const out: { entity: CloudEntity; count: number }[] = [];
  for (const e of checks) {
    const { count } = await supabase.from(tableMap[e] as any).select("*", { count: "exact", head: true });
    out.push({ entity: e, count: count || 0 });
  }
  return out;
}

/** ====================== سحب من السحابة → localStorage ====================== */
// مفاتيح localStorage المستخدمة في المتاجر المحلية
const LS_KEYS: Record<CloudEntity, string> = {
  customers: "alwafa_customers_v1",
  vehicles: "alwafa_vehicles_v2",
  suppliers: "alwafa_suppliers_v1",
  work_orders: "alwafa_work_orders",
  inventory: "alwafa_inventory_v1",
  expenses: "alwafa_expenses_v1",
  journal: "alwafa_journal_v1",
  sales_documents: "alwafa_sales_docs_v1",
};

function writeLS(key: string, rows: any[]) {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
    // إشعار التبويبات الأخرى + المتاجر المحلية بالتغيير
    try { new BroadcastChannel(`store:${key}`).postMessage({ ts: Date.now() }); } catch {}
    window.dispatchEvent(new StorageEvent("storage", { key }));
  } catch {}
}

async function fetchAll(table: string, tenantId: string): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function pullCustomers(tenantId: string): Promise<CloudResult> {
  const rows = await fetchAll("customers", tenantId);
  const mapped = rows.map((c: any) => ({
    id: c.id, name: c.name, phone: c.phone || "", email: c.email || undefined,
    address: c.address || undefined, idNumber: c.id_number || undefined,
    notes: c.notes || undefined, tag: "regular",
    type: c.type || "individual", contactPerson: c.contact_person || undefined,
    commercialRegistration: c.commercial_registration || undefined,
    taxNumber: c.tax_number || undefined,
    createdAt: c.created_at,
  }));
  writeLS(LS_KEYS.customers, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullVehicles(tenantId: string): Promise<CloudResult> {
  const [vehs, custs] = await Promise.all([
    fetchAll("vehicles", tenantId),
    fetchAll("customers", tenantId),
  ]);
  const cMap = new Map(custs.map((c: any) => [c.id, c]));
  const mapped = vehs.map((v: any) => {
    const owner: any = cMap.get(v.customer_id);
    return {
      id: v.plate_number, plate: v.plate_number,
      type: v.vehicle_type || `${v.brand || ""} ${v.model || ""}`.trim(),
      vin: v.vin_number || "",
      owner: owner?.name || "—",
      ownerPhone: owner?.phone || undefined,
      year: v.year ? String(v.year) : undefined,
      color: v.color || undefined,
      mileage: v.mileage ? String(v.mileage) : undefined,
      visits: 0, lastVisit: "", totalSpent: 0,
      archived: !!v.archived,
      archivedAt: v.archived_at || undefined,
      archivedReason: v.archived_reason || undefined,
    };
  });
  writeLS(LS_KEYS.vehicles, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullWorkOrders(tenantId: string): Promise<CloudResult> {
  const [orders, vehs, custs] = await Promise.all([
    fetchAll("job_orders", tenantId),
    fetchAll("vehicles", tenantId),
    fetchAll("customers", tenantId),
  ]);
  const vMap = new Map(vehs.map((v: any) => [v.id, v]));
  const cMap = new Map(custs.map((c: any) => [c.id, c]));
  const reverseStatus: Record<string, string> = {
    received: "تحت الفحص", inspection: "تحت الفحص",
    waiting_parts: "بانتظار قطع الغيار", in_progress: "تحت الإصلاح",
    completed: "جاهز للتسليم", delivered: "تم التسليم",
  };
  const mapped = orders.map((o: any) => {
    const v: any = vMap.get(o.vehicle_id);
    const c: any = cMap.get(o.customer_id);
    return {
      id: o.order_number || o.id,
      customer: c?.name || "—",
      phone: c?.phone || "",
      plate: v?.plate_number || "",
      vehicle: v ? `${v.brand || ""} ${v.model || ""}`.trim() : "",
      vin: v?.vin_number || "",
      serviceType: o.service_type || "",
      description: o.description || "",
      diagnosis: o.diagnosis_notes || o.diagnosis || "",
      technician: o.technician_name || "",
      entryDate: o.entry_date || o.created_at?.slice(0, 10),
      status: reverseStatus[o.status] || "تحت الفحص",
      laborCost: Number(o.labor_cost || 0),
      partsCost: Number(o.parts_cost || 0),
      totalCost: Number(o.final_total || o.labor_cost || 0) + Number(o.parts_cost || 0),
      insurance: o.insurance_company || "",
      claimNumber: o.insurance_claim_number || "",
      photos: Array.isArray(o.photos) ? o.photos : [],
      partsNeeded: Array.isArray(o.parts_needed) ? o.parts_needed : [],
      stages: Array.isArray(o.stages) ? o.stages : [],
    };
  });
  writeLS(LS_KEYS.work_orders, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullInventory(tenantId: string): Promise<CloudResult> {
  const rows = await fetchAll("inventory", tenantId);
  const mapped = rows.map((p: any) => ({
    id: p.id, name: p.name, partNumber: p.part_number || undefined,
    category: p.category || undefined, quantity: p.quantity,
    minStock: p.min_quantity, sellPrice: Number(p.unit_price || 0),
    buyPrice: Number(p.cost_price || 0), unit: p.unit || "قطعة",
    barcode: p.barcode || undefined, location: p.location || undefined,
    notes: p.notes || undefined,
  }));
  writeLS(LS_KEYS.inventory, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullExpenses(tenantId: string): Promise<CloudResult> {
  const rows = await fetchAll("expenses", tenantId);
  const mapped = rows.map((e: any) => ({
    id: e.id, voucherNumber: e.voucher_number, date: e.date,
    amount: Number(e.amount || 0), categoryId: e.category_id || undefined,
    categoryName: e.category_name || undefined, cashboxId: e.cashbox_id || undefined,
    cashboxName: e.cashbox_name || undefined, paymentMethod: e.payment_method || "cash",
    beneficiary: e.beneficiary || undefined, description: e.description || undefined,
    linkedWorkOrderId: e.linked_work_order_id || undefined,
    linkedVehiclePlate: e.linked_vehicle_plate || undefined,
    linkedVehicleName: e.linked_vehicle_name || undefined,
  }));
  writeLS(LS_KEYS.expenses, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullJournal(tenantId: string): Promise<CloudResult> {
  const [entries, lines] = await Promise.all([
    fetchAll("journal_entries", tenantId),
    fetchAll("journal_lines", tenantId),
  ]);
  const linesByEntry = new Map<string, any[]>();
  lines.forEach((l: any) => {
    const arr = linesByEntry.get(l.entry_id) || [];
    arr.push(l); linesByEntry.set(l.entry_id, arr);
  });
  const mapped = entries.map((e: any) => {
    const ls = linesByEntry.get(e.id) || [];
    const debit = ls.find((l) => Number(l.debit) > 0);
    const credit = ls.find((l) => Number(l.credit) > 0);
    return {
      id: e.entry_number, date: e.entry_date,
      description: e.description || "",
      source: e.source_type || "manual", sourceId: e.source_id || "",
      amount: Number(e.total_debit || 0),
      debitAccount: debit?.account_code || "",
      creditAccount: credit?.account_code || "",
    };
  });
  writeLS(LS_KEYS.journal, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullSalesDocs(tenantId: string): Promise<CloudResult> {
  const rows = await fetchAll("sales_documents", tenantId);
  const mapped = rows.map((d: any) => ({
    id: d.id, number: d.doc_number, type: d.doc_type,
    date: d.date, dueDate: d.due_date || undefined,
    customerName: d.customer_name || "", customerId: d.customer_id || undefined,
    vehicle: d.vehicle_plate ? { plate: d.vehicle_plate, make: d.vehicle_make, model: d.vehicle_model } : undefined,
    items: Array.isArray(d.items) ? d.items : [],
    subtotal: Number(d.subtotal || 0), discountTotal: Number(d.discount_total || 0),
    taxTotal: Number(d.tax_total || 0), total: Number(d.total || 0),
    paidAmount: Number(d.paid_amount || 0), balanceDue: Number(d.balance_due || 0),
    status: d.status, notes: d.notes || undefined,
  }));
  writeLS(LS_KEYS.sales_documents, mapped);
  return { inserted: mapped.length, errors: 0 };
}

async function pullSuppliers(tenantId: string): Promise<CloudResult> {
  const rows = await fetchAll("suppliers", tenantId);
  const mapped = rows.map((s: any) => ({
    id: s.id, name: s.name, phone: s.phone || "",
    email: s.email || undefined, address: s.address || undefined,
    taxNumber: s.tax_number || undefined, notes: s.notes || undefined,
    vehicleBrands: Array.isArray(s.vehicle_brands) ? s.vehicle_brands : [],
    category: s.category || undefined,
    createdAt: s.created_at,
  }));
  writeLS(LS_KEYS.suppliers, mapped);
  return { inserted: mapped.length, errors: 0 };
}

export const PULL_PLAN: { entity: CloudEntity; label: string; run: (t: string) => Promise<CloudResult> }[] = [
  { entity: "customers", label: "العملاء", run: pullCustomers },
  { entity: "vehicles", label: "المركبات", run: pullVehicles },
  { entity: "suppliers", label: "الموردون", run: pullSuppliers },
  { entity: "work_orders", label: "أوامر العمل", run: pullWorkOrders },
  { entity: "inventory", label: "المخزون", run: pullInventory },
  { entity: "expenses", label: "المصروفات", run: pullExpenses },
  { entity: "journal", label: "دفتر اليومية", run: pullJournal },
  { entity: "sales_documents", label: "الفواتير وعروض الأسعار", run: pullSalesDocs },
];

export async function runFullPull(
  onProgress: (p: MigrationProgress) => void
): Promise<{ ok: boolean; tenantId: string | null }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { ok: false, tenantId: null };
  for (const step of PULL_PLAN) {
    onProgress({ entity: step.entity, label: step.label, total: 0, done: 0, errors: 0, status: "running" });
    try {
      const res = await step.run(tenantId);
      onProgress({
        entity: step.entity, label: step.label,
        total: res.inserted, done: res.inserted, errors: res.errors,
        status: res.errors ? "error" : "done", message: res.message,
      });
    } catch (e: any) {
      onProgress({ entity: step.entity, label: step.label, total: 0, done: 0, errors: 1, status: "error", message: e?.message });
    }
  }
  return { ok: true, tenantId };
}
