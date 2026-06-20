// Customer registry — central CRM store. Pulls aggregated stats from
// workOrdersStore, vehiclesStore so we never duplicate financial data.
// On first load, auto-seeds itself from existing work orders and vehicles
// so the user does not lose data accumulated before this module existed.

import { getWorkOrders } from "./workOrdersStore";
import { vehiclesStore } from "./vehiclesStore";

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

const STORAGE_KEY = "alwafa_customers_v1";

let cache: Customer[] | null = null;
const listeners = new Set<() => void>();
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`store:${STORAGE_KEY}`) : null;

function normalize(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function notify() {
  listeners.forEach((l) => { try { l(); } catch {} });
}

function reloadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch { cache = []; }
  notify();
}

if (channel) channel.onmessage = () => reloadFromStorage();
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) reloadFromStorage();
  });
}

function persist() {
  if (!cache) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch {}
  notify();
  if (channel) { try { channel.postMessage({ ts: Date.now() }); } catch {} }
}

function migrateFromExistingData(): Customer[] {
  // Build initial set from work orders + vehicles
  const map = new Map<string, Customer>();
  const now = new Date().toISOString();

  const upsert = (name: string, phone: string) => {
    const key = normalize(name);
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      if (!existing.phone && phone) existing.phone = phone;
      return;
    }
    map.set(key, {
      id: `CUST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      phone: phone || "",
      tag: "regular",
      createdAt: now,
    });
  };

  try {
    getWorkOrders().forEach((o) => upsert(o.customer, o.phone));
    vehiclesStore.getAll().forEach((v) => upsert(v.owner, v.ownerPhone || ""));
  } catch {}

  return Array.from(map.values());
}

function load(): Customer[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw);
      return cache!;
    }
  } catch {}
  cache = migrateFromExistingData();
  persist();
  return cache;
}

export const customersStore = {
  getAll(): Customer[] { return load(); },
  getById(id: string): Customer | undefined { return load().find((c) => c.id === id); },

  findByName(name: string): Customer | undefined {
    const k = normalize(name);
    return load().find((c) => normalize(c.name) === k);
  },

  findByPhone(phone: string): Customer | undefined {
    const p = (phone || "").replace(/\s/g, "");
    if (!p) return undefined;
    return load().find((c) => (c.phone || "").replace(/\s/g, "") === p);
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
      id: `CUST-IP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        customersStore.update(found.id, { phone });
      }
      return customersStore.findByName(name)!;
    }
    const created: Customer = {
      id: `CUST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      phone,
      tag: "new",
      createdAt: new Date().toISOString(),
    };
    customersStore.add(created);
    return created;
  },

  add(c: Customer) {
    const list = load();
    list.unshift(c);
    persist();
  },

  update(id: string, patch: Partial<Customer>) {
    const list = load();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      persist();
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
