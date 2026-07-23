// Customer registry — central CRM store. Pulls aggregated stats from
// workOrdersStore, vehiclesStore so we never duplicate financial data.
// On first load, auto-seeds itself from existing work orders and vehicles
// so the user does not lose data accumulated before this module existed.

import { getWorkOrders } from "./workOrdersStore";
import { vehiclesStore } from "./vehiclesStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { normalizePhone } from "@/lib/phoneUtils";
import { isUuid } from "@/lib/uuid";
import { displayCustomerCode } from "@/lib/customerCode";

export type CustomerTag = "vip" | "regular" | "new";
export type CustomerType = "individual" | "company";

export interface Customer {
  id: string;
  customerCode?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  idNumber?: string;
  notes?: string;
  tag: CustomerTag;
  /** نوع العميل: فرد أو شركة. الافتراضي فرد للحفاظ على التوافق. */
  type?: CustomerType;
  /** للشركات: اسم الشخص المسؤول */
  contactPerson?: string;
  /** للشركات: السجل التجاري */
  commercialRegistration?: string;
  /** للشركات: الرقم الضريبي */
  taxNumber?: string;
  legalName?: string;
  buyerType?: "individual" | "company" | "government" | "insurance_company";
  createdAt: string;
  lastContactAt?: string;
}

export interface CustomerStats {
  visits: number;
  totalSpent: number;
  vehiclesCount: number;
  pendingInvoices: number; // count of unpaid invoices (placeholder: orders not delivered/closed)
  lastVisit?: string;
}

let cache: Customer[] = [];
const listeners = new Set<() => void>();
let cloudRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let cloudRefreshInFlight: Promise<void> | null = null;
let lastCloudRefreshFailureAt = 0;
const CLOUD_REFRESH_FAILURE_COOLDOWN_MS = 15_000;

function normalize(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCustomerName(s: string): string {
  return normalize(s).replace(/[^\p{L}\p{N}\s]/gu, "");
}

function notify() {
  listeners.forEach((l) => { try { l(); } catch {} });
}

function persist() {
  notify();
}

function load(): Customer[] {
  return cache;
}

function rowToCustomer(r: any): Customer {
  return {
    id: r.id,
    customerCode: r.customer_code || undefined,
    name: r.name,
    phone: normalizePhone(r.phone || ""),
    email: r.email || undefined,
    address: r.address || undefined,
    idNumber: r.id_number || undefined,
    notes: r.notes || undefined,
    tag: "regular",
    type: r.type || "individual",
    contactPerson: r.contact_person || undefined,
    commercialRegistration: r.commercial_registration || undefined,
    taxNumber: r.tax_number || undefined,
    legalName: r.legal_name || undefined,
    buyerType: r.buyer_type || r.type || "individual",
    createdAt: r.created_at,
  };
}

export async function refreshCustomersFromCloud() {
  if (Date.now() - lastCloudRefreshFailureAt < CLOUD_REFRESH_FAILURE_COOLDOWN_MS) return;
  if (cloudRefreshInFlight) return cloudRefreshInFlight;

  cloudRefreshInFlight = (async () => {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const { data, error } = await supabase.from("customers").select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .or("archived.is.null,archived.eq.false")
    .order("created_at", { ascending: false });
  if (error) {
    lastCloudRefreshFailureAt = Date.now();
    console.warn("[customersStore] cloud fetch failed", error);
    return;
  }
  cache = (data || []).map(rowToCustomer);
  lastCloudRefreshFailureAt = 0;
  persist();
  })().finally(() => {
    cloudRefreshInFlight = null;
  });
  return cloudRefreshInFlight;
}

function scheduleCustomersRefresh(delay = 250) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (Date.now() - lastCloudRefreshFailureAt < CLOUD_REFRESH_FAILURE_COOLDOWN_MS) return;
  if (cloudRefreshTimer) clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer = setTimeout(() => {
    cloudRefreshTimer = null;
    void refreshCustomersFromCloud();
  }, delay);
}

async function findExistingCustomerCloud(
  tenantId: string,
  input: Partial<Customer> & { name?: string; phone?: string },
): Promise<Customer | null> {
  const phone = normalizePhone(input.phone || "");
  if (phone) {
    const phoneTail = phone.replace(/\D/g, "").slice(-8);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .or("archived.is.null,archived.eq.false")
      .ilike("phone", `%${phoneTail || phone}%`)
      .limit(10);
    if (error) throw error;
    const match = (data || []).find((row: any) =>
      normalizePhone(row.phone || "").replace(/\D/g, "").slice(-8) === phoneTail,
    );
    if (match) return rowToCustomer(match);
  }

  const nameKey = normalizeCustomerName(input.name || "");
  if (nameKey) {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .or("archived.is.null,archived.eq.false")
      .ilike("name", (input.name || "").trim())
      .limit(10);
    if (error) throw error;
    const match = (data || []).find((row: any) => normalizeCustomerName(row.name || "") === nameKey);
    if (match) return rowToCustomer(match);
  }

  return null;
}

async function readCustomerById(tenantId: string, id: string): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || !isUuid(data.id)) throw new Error("تعذر تأكيد حفظ العميل في Supabase");
  return rowToCustomer(data);
}

async function upsertCustomerCloud(c: Customer): Promise<Customer | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const basePayload = {
    tenant_id: tenantId,
    name: c.name,
    phone: normalizePhone(c.phone) || null,
    email: c.email || null,
    address: c.address || null,
    id_number: c.idNumber || null,
    notes: c.notes || null,
    type: c.type || "individual",
    contact_person: c.contactPerson || null,
    commercial_registration: c.commercialRegistration || null,
    tax_number: c.taxNumber || null,
  };
  const payload = {
    ...basePayload,
    legal_name: c.legalName || c.name || null,
    buyer_type: c.buyerType || c.type || "individual",
  };

  let targetId = isUuid(c.id) ? c.id : null;
  if (targetId) {
    const { data: existing, error: lookupError } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", targetId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing?.id) targetId = null;
  }
  if (!targetId) {
    const existing = await findExistingCustomerCloud(tenantId, c);
    if (existing?.id) targetId = existing.id;
  }

  async function writeCustomer(nextPayload: Record<string, unknown>) {
    return targetId
      ? supabase.from("customers").update(nextPayload as any).eq("tenant_id", tenantId).eq("id", targetId).select("id").single()
      : supabase.from("customers").insert(nextPayload as any).select("id").single();
  }
  let { data, error } = await writeCustomer(payload);
  if (error && /legal_name|buyer_type|schema cache|Could not find/i.test(String(error.message || ""))) {
    ({ data, error } = await writeCustomer(basePayload));
  }
  if (error) {
    console.warn("[customersStore] cloud upsert failed", error);
    throw error;
  }
  return data?.id ? readCustomerById(tenantId, data.id) : null;
}

async function replaceTempCustomerId(tempId: string, saved: Customer) {
  const idx = cache.findIndex((c) => c.id === tempId);
  if (idx >= 0) {
    cache[idx] = saved;
    persist();
  }
}

export const customersStore = {
  getAll(): Customer[] { return load(); },
  getById(id: string): Customer | undefined { return load().find((c) => c.id === id); },
  displayCode(customer: Customer | undefined | null): string { return displayCustomerCode(customer); },

  findByName(name: string): Customer | undefined {
    const k = normalize(name);
    return load().find((c) => normalize(c.name) === k);
  },

  findByPhone(phone: string): Customer | undefined {
    const p = normalizePhone(phone);
    if (!p) return undefined;
    return load().find((c) => normalizePhone(c.phone) === p);
  },

  /** هل اسم العميل يمثّل "Insurance Pending" (عميل افتراضي للتأمين)؟ */
  isInsurancePending(name: string): boolean {
    return /^insurance\s*pending/i.test((name || "").trim()) || (name || "").trim().startsWith("غير محدد - تأمين");
  },

  /**
   * يُرجع/ينشئ عميلاً افتراضياً لشركة تأمين معيّنة (مركبات بدون عميل بعد).
   * المركبة المربوطة به ممنوع استخدامها في فواتير نقدية.
   */
  getOrCreateInsurancePending(insuranceCompany: string): Customer {
    const company = (insuranceCompany || "").trim() || "غير محدد";
    const pendingName = `Insurance Pending - ${company}`;
    const existing = customersStore.findByName(pendingName);
    if (existing) return existing;
    const c: Customer = {
      id: crypto.randomUUID(),
      name: pendingName,
      phone: "",
      type: "company",
      contactPerson: company,
      tag: "new",
      notes: `عميل افتراضي لمركبات تأمين ${company} بانتظار تحديد المالك الفعلي عند التسليم.`,
      createdAt: new Date().toISOString(),
    };
    customersStore.add(c);
    return c;
  },

  /** Returns existing customer by name OR creates a new one. Useful from forms. */
  getOrCreateByName(name: string, phone = ""): Customer {
    const found = customersStore.findByName(name);
    if (found) {
      if (phone && !found.phone) {
        customersStore.update(found.id, { phone: normalizePhone(phone) });
      }
      return customersStore.findByName(name)!;
    }
    const created: Customer = {
      id: crypto.randomUUID(),
      name: name.trim(),
      phone: normalizePhone(phone),
      tag: "new",
      createdAt: new Date().toISOString(),
    };
    customersStore.add(created);
    return created;
  },

  add(c: Customer) {
    const normalized = { ...c, phone: normalizePhone(c.phone) };
    void customersStore.addAsync(normalized).catch((error) => {
      console.warn("[customersStore.add] failed", error);
    });
  },

  async addAsync(c: Customer): Promise<Customer> {
    const normalized = { ...c, phone: normalizePhone(c.phone) };
    const saved = await upsertCustomerCloud(normalized);
    if (!saved?.id || !isUuid(saved.id)) throw new Error("Customer must be saved before creating the work order.");
    const list = load();
    const existingIdx = list.findIndex((x) => x.id === normalized.id || x.id === saved.id);
    if (existingIdx >= 0) list[existingIdx] = saved;
    else list.unshift(saved);
    persist();
    return saved;
  },

  async updateAsync(id: string, patch: Partial<Customer>): Promise<Customer> {
    const current = customersStore.getById(id);
    if (!current) throw new Error("العميل غير موجود في القائمة الحالية");
    const normalized = {
      ...current,
      ...patch,
      id,
      phone: patch.phone !== undefined ? normalizePhone(patch.phone) : current.phone,
    };
    const saved = await upsertCustomerCloud(normalized);
    if (!saved?.id || !isUuid(saved.id)) throw new Error("تعذر تأكيد تحديث العميل في Supabase");
    const list = load();
    const idx = list.findIndex((x) => x.id === id || x.id === saved.id);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    persist();
    return saved;
  },

  async ensureCloudCustomer(input: Partial<Customer> & { name: string; phone?: string; id?: string }): Promise<Customer> {
    if (input.id && isUuid(input.id)) {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
      const existing = await readCustomerById(tenantId, input.id).catch(() => null);
      if (existing) return existing;
    }
    const byPhone = input.phone ? customersStore.findByPhone(input.phone) : undefined;
    if (byPhone?.id && isUuid(byPhone.id)) {
      const saved = await upsertCustomerCloud(byPhone);
      return saved || byPhone;
    }
    const byName = customersStore.findByName(input.name);
    if (byName?.id && isUuid(byName.id)) {
      const saved = await upsertCustomerCloud(byName);
      return saved || byName;
    }
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
    const cloudExisting = await findExistingCustomerCloud(tenantId, input);
    if (cloudExisting?.id) {
      const list = load();
      if (!list.some((x) => x.id === cloudExisting.id)) list.unshift(cloudExisting);
      persist();
      return cloudExisting;
    }
    return customersStore.addAsync({
      id: input.id && isUuid(input.id) ? input.id : crypto.randomUUID(),
      name: input.name.trim(),
      phone: normalizePhone(input.phone || ""),
      email: input.email,
      address: input.address,
      idNumber: input.idNumber,
      notes: input.notes,
      tag: input.tag || "new",
      type: input.type || "individual",
      contactPerson: input.contactPerson,
      commercialRegistration: input.commercialRegistration,
      taxNumber: input.taxNumber,
      createdAt: input.createdAt || new Date().toISOString(),
    });
  },

  update(id: string, patch: Partial<Customer>) {
    const list = load();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch, phone: patch.phone !== undefined ? normalizePhone(patch.phone) : list[idx].phone };
      persist();
      void upsertCustomerCloud(list[idx]).catch(() => {});
    }
  },

  remove(id: string): Customer | undefined {
    const list = load();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    const [removed] = list.splice(idx, 1);
    persist();
    return removed;
  },

  restore(c: Customer) {
    const list = load();
    if (list.some((x) => x.id === c.id)) return;
    list.unshift(c);
    persist();
    void upsertCustomerCloud(c);
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },

  /** Aggregate stats for a specific customer derived from related entities. */
  getStats(customer: Customer): CustomerStats {
    const k = normalize(customer.name);
    const orders = getWorkOrders().filter((o) => normalize(o.customer) === k);
    const vehicles = vehiclesStore.getAll().filter((v) => normalize(v.owner) === k);

    const totalSpent = orders.reduce((s, o) => s + (o.totalCost || 0), 0)
      + vehicles.reduce((s, v) => s + (v.totalSpent || 0), 0) * 0; // avoid double counting; orders are source of truth

    const pendingInvoices = orders.filter((o) =>
      !["تم التسليم", "مغلق", "جاهز للتسليم"].includes(o.status)
    ).length;

    const lastVisit = orders
      .map((o) => o.entryDate)
      .sort()
      .reverse()[0];

    return {
      visits: orders.length,
      totalSpent,
      vehiclesCount: vehicles.length,
      pendingInvoices,
      lastVisit,
    };
  },

  /** Auto-suggested tag based on activity. */
  computeTag(stats: CustomerStats): CustomerTag {
    if (stats.totalSpent >= 5000 || stats.visits >= 5) return "vip";
    if (stats.visits === 0) return "new";
    return "regular";
  },
};

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    cache = [];
    persist();
    void session;
  });
  // Realtime invalidation is centralized in useRealtimeSync. Avoid duplicate
  // store-level subscriptions that refetch the full customer list repeatedly.
}
