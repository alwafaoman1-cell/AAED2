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

export type CustomerTag = "vip" | "regular" | "new";
export type CustomerType = "individual" | "company";

export interface Customer {
  id: string;
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

function normalize(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
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
    createdAt: r.created_at,
  };
}

async function refreshCustomersFromCloud() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const { data, error } = await supabase.from("customers").select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .or("archived.is.null,archived.eq.false")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[customersStore] cloud fetch failed", error);
    return;
  }
  cache = (data || []).map(rowToCustomer);
  persist();
}

async function upsertCustomerCloud(c: Customer): Promise<Customer | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  const payload = {
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
  const query = isUuid(c.id)
    ? supabase.from("customers").upsert({ id: c.id, ...payload }).select("*").single()
    : supabase.from("customers").insert(payload).select("*").single();
  const { data, error } = await query;
  if (error) {
    console.warn("[customersStore] cloud upsert failed", error);
    throw error;
  }
  return data ? rowToCustomer(data) : null;
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
    const list = load();
    const normalized = { ...c, phone: normalizePhone(c.phone) };
    list.unshift(normalized);
    persist();
    void upsertCustomerCloud(normalized)
      .then((saved) => { if (saved && saved.id !== normalized.id) void replaceTempCustomerId(normalized.id, saved); })
      .catch(() => {});
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

  async ensureCloudCustomer(input: Partial<Customer> & { name: string; phone?: string; id?: string }): Promise<Customer> {
    if (input.id && isUuid(input.id)) {
      const found = customersStore.getById(input.id);
      if (found) {
        const saved = await upsertCustomerCloud(found);
        return saved || found;
      }
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
  setTimeout(() => void refreshCustomersFromCloud(), 0);
  supabase.auth.onAuthStateChange((_event, session) => {
    cache = [];
    persist();
    if (session?.user) void refreshCustomersFromCloud();
  });
  supabase.channel("customers_store_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
      void refreshCustomersFromCloud();
    })
    .subscribe();
}
