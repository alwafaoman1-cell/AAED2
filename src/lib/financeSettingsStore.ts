import { createStore } from "./createStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";

// ===== Categories =====
export interface FinanceCategory {
  id: string;
  name: string;
  description?: string;
  color?: string; // hex / tailwind color hint
  active: boolean;
  createdAt: string;
}

export const expenseCategoriesStore = createStore<FinanceCategory>({
  key: "alwafa_expense_categories_v1",
  seed: [
    { id: "EC-1", name: "رواتب الموظفين", description: "الرواتب الشهرية والحوافز", color: "#ef4444", active: true, createdAt: new Date().toISOString() },
    { id: "EC-2", name: "قطع غيار", description: "مشتريات قطع الغيار من الموردين", color: "#f59e0b", active: true, createdAt: new Date().toISOString() },
    { id: "EC-3", name: "إيجار وفواتير", description: "إيجار الورشة والكهرباء والماء", color: "#8b5cf6", active: true, createdAt: new Date().toISOString() },
    { id: "EC-4", name: "صيانة معدات", description: "صيانة الأدوات والآلات", color: "#06b6d4", active: true, createdAt: new Date().toISOString() },
  ],
});

// ============================================================
// ☁️ Cloud sync for expense categories — keeps the SAME categories
// visible across desktop + supervisor app + any device.
// ============================================================
function _replaceAllExpenseCategories(rows: FinanceCategory[]) {
  (expenseCategoriesStore as any).replaceAll?.(rows);
}

async function _pullExpenseCategoriesFromCloud(): Promise<void> {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return;
    const { data, error } = await (supabase as any)
      .from("expense_categories")
      .select("id,name,description,color,active,created_at")
      .eq("tenant_id", tenantId);
    if (error || !data) return;

    const local = expenseCategoriesStore.getAll();

    // First-time seed: cloud empty + local has items → push local to cloud
    if (data.length === 0 && local.length > 0) {
      const payload = local.map((c) => ({
        tenant_id: tenantId,
        name: c.name,
        description: c.description ?? null,
        color: c.color ?? null,
        active: c.active,
      }));
      const { data: inserted } = await (supabase as any)
        .from("expense_categories").insert(payload).select();
      if (inserted) {
        _replaceAllExpenseCategories(inserted.map((r: any) => ({
          id: r.id, name: r.name,
          description: r.description ?? undefined,
          color: r.color ?? undefined,
          active: !!r.active,
          createdAt: r.created_at,
        })));
      }
      return;
    }

    _replaceAllExpenseCategories(data.map((r: any) => ({
      id: r.id, name: r.name,
      description: r.description ?? undefined,
      color: r.color ?? undefined,
      active: !!r.active,
      createdAt: r.created_at,
    })));
  } catch (e) {
    console.warn("[expenseCategories] cloud pull failed", e);
  }
}

// Mirror local mutations to cloud
const _origAdd = expenseCategoriesStore.add.bind(expenseCategoriesStore);
const _origUpdate = expenseCategoriesStore.update.bind(expenseCategoriesStore);
const _origRemove = expenseCategoriesStore.remove.bind(expenseCategoriesStore);

expenseCategoriesStore.add = (item: FinanceCategory) => {
  _origAdd(item); // optimistic
  (async () => {
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .insert({
          tenant_id: tenantId,
          name: item.name,
          description: item.description ?? null,
          color: item.color ?? null,
          active: item.active,
        })
        .select()
        .single();
      if (error || !data) return;
      // Swap local id with cloud uuid
      _origUpdate(item.id, { id: data.id, createdAt: data.created_at });
    } catch (e) {
      console.warn("[expenseCategories] cloud insert failed", e);
    }
  })();
};

expenseCategoriesStore.update = (id: string, patch: Partial<FinanceCategory>) => {
  _origUpdate(id, patch);
  (async () => {
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;
      const cloudPatch: any = {};
      if (patch.name !== undefined) cloudPatch.name = patch.name;
      if (patch.description !== undefined) cloudPatch.description = patch.description ?? null;
      if (patch.color !== undefined) cloudPatch.color = patch.color ?? null;
      if (patch.active !== undefined) cloudPatch.active = patch.active;
      if (Object.keys(cloudPatch).length === 0) return;
      await (supabase as any).from("expense_categories")
        .update(cloudPatch).eq("id", id).eq("tenant_id", tenantId);
    } catch (e) {
      console.warn("[expenseCategories] cloud update failed", e);
    }
  })();
};

expenseCategoriesStore.remove = (id: string) => {
  const removed = _origRemove(id);
  (async () => {
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;
      await (supabase as any).from("expense_categories")
        .delete().eq("id", id).eq("tenant_id", tenantId);
    } catch (e) {
      console.warn("[expenseCategories] cloud delete failed", e);
    }
  })();
  return removed;
};

if (typeof window !== "undefined") {
  let _ecBootstrapped = false;
  let _ecFetchTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleECFetch(delay = 200) {
    if (_ecFetchTimer) clearTimeout(_ecFetchTimer);
    _ecFetchTimer = setTimeout(() => {
      _ecFetchTimer = null;
      _pullExpenseCategoriesFromCloud();
    }, delay);
  }
  function startECCloudSync() {
    if (_ecBootstrapped) return;
    _ecBootstrapped = true;
    scheduleECFetch(0);
    try {
      supabase
        .channel(`expense_cats_${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "expense_categories" },
          () => scheduleECFetch(200))
        .subscribe();
    } catch (e) {
      console.warn("[expenseCategories] realtime failed", e);
    }
    // Initial fetch + realtime are enough. Avoid tab-focus fetch storms from
    // this legacy store; users can still force refresh from the top bar.
  }
  setTimeout(startECCloudSync, 800);

  let _ecLastUid: string | null = null;
  supabase.auth.onAuthStateChange((_e, session) => {
    const uid = session?.user?.id ?? null;
    if (uid !== _ecLastUid) {
      _ecLastUid = uid;
      if (uid) scheduleECFetch(100);
    }
  });
}

export const incomeCategoriesStore = createStore<FinanceCategory>({
  key: "alwafa_income_categories_v1",
  seed: [
    { id: "IC-1", name: "إيرادات إصلاح", description: "فواتير إصلاح المركبات", color: "#22c55e", active: true, createdAt: new Date().toISOString() },
    { id: "IC-2", name: "إيرادات فحص فني", description: "رسوم الفحص والتقييم", color: "#3b82f6", active: true, createdAt: new Date().toISOString() },
    { id: "IC-3", name: "تعويضات تأمين", description: "مدفوعات شركات التأمين", color: "#a855f7", active: true, createdAt: new Date().toISOString() },
    { id: "IC-4", name: "بيع قطع غيار", description: "مبيعات قطع غيار للعملاء", color: "#eab308", active: true, createdAt: new Date().toISOString() },
  ],
});

// ===== Employee Cashboxes =====
export interface EmployeeCashbox {
  id: string;
  employeeName: string;
  employeeId?: string; // link to staff
  cashboxName: string; // الخزينة المرتبطة (مثل: الخزينة الرئيسية)
  openingBalance: number;
  currentBalance: number;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
}

export const employeeCashboxesStore = createStore<EmployeeCashbox>({
  key: "alwafa_employee_cashboxes_v1",
  seed: [
    { id: "CB-1", employeeName: "المدير العام", cashboxName: "الخزينة الرئيسية", openingBalance: 5000, currentBalance: 5000, isDefault: true, active: true, createdAt: new Date().toISOString() },
    { id: "CB-2", employeeName: "محاسب الورشة", cashboxName: "خزينة المحاسبة", openingBalance: 2000, currentBalance: 2000, isDefault: false, active: true, createdAt: new Date().toISOString() },
  ],
});

// ===== Voucher Settings (single config object stored as one item) =====
export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي",
  bank_transfer: "تحويل بنكي",
  cheque: "شيك",
  card: "بطاقة",
};

export interface VoucherSettings {
  // Auto-numbering
  receiptPrefix: string; // سند قبض
  paymentPrefix: string; // سند صرف
  receiptNextNumber: number;
  paymentNextNumber: number;
  numberPadding: number; // 0001 / 00001

  // Default payment method
  defaultPaymentMethod: PaymentMethod;

  // Auto link to cashbox of creator
  autoLinkToCashbox: boolean;

  // Photo attachment for payment vouchers
  paymentVoucherRequirePhoto: boolean; // هل صورة الإيصال إلزامية لسند الصرف
  paymentVoucherAllowCamera: boolean;  // السماح بالتقاط من الكاميرا
}

const VOUCHER_SETTINGS_KEY = "alwafa_voucher_settings_v1";

const DEFAULT_VOUCHER_SETTINGS: VoucherSettings = {
  receiptPrefix: "RCV",
  paymentPrefix: "PAY",
  receiptNextNumber: 1,
  paymentNextNumber: 1,
  numberPadding: 4,
  defaultPaymentMethod: "cash",
  autoLinkToCashbox: true,
  paymentVoucherRequirePhoto: false,
  paymentVoucherAllowCamera: true,
};

const voucherListeners = new Set<() => void>();
let voucherCache: VoucherSettings | null = null;

function loadVoucherSettings(): VoucherSettings {
  if (voucherCache) return voucherCache;
  voucherCache = { ...DEFAULT_VOUCHER_SETTINGS };
  void readCloudSetting<VoucherSettings>(VOUCHER_SETTINGS_KEY, DEFAULT_VOUCHER_SETTINGS)
    .then((value) => {
      voucherCache = { ...DEFAULT_VOUCHER_SETTINGS, ...value };
      voucherListeners.forEach((cb) => cb());
    })
    .catch(() => undefined);
  return voucherCache;
}

function persistVoucherSettings() {
  if (!voucherCache) return;
  voucherListeners.forEach((cb) => cb());
  void writeCloudSetting(VOUCHER_SETTINGS_KEY, voucherCache).catch((error) => {
    console.warn("[voucherSettings] Supabase write failed", error);
  });
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<VoucherSettings>(VOUCHER_SETTINGS_KEY, (value) => {
    voucherCache = { ...DEFAULT_VOUCHER_SETTINGS, ...value };
    voucherListeners.forEach((cb) => cb());
  });
}

export const voucherSettingsStore = {
  get(): VoucherSettings {
    return loadVoucherSettings();
  },
  update(patch: Partial<VoucherSettings>) {
    const current = loadVoucherSettings();
    voucherCache = { ...current, ...patch };
    persistVoucherSettings();
  },
  reset() {
    voucherCache = { ...DEFAULT_VOUCHER_SETTINGS };
    persistVoucherSettings();
  },
  subscribe(cb: () => void): () => void {
    voucherListeners.add(cb);
    return () => voucherListeners.delete(cb);
  },
  /** Generate next number string and increment counter. */
  generateNextNumber(type: "receipt" | "payment"): string {
    const s = loadVoucherSettings();
    const year = new Date().getFullYear();
    const prefix = type === "receipt" ? s.receiptPrefix : s.paymentPrefix;
    const num = type === "receipt" ? s.receiptNextNumber : s.paymentNextNumber;
    const padded = String(num).padStart(s.numberPadding, "0");
    const result = `${prefix}-${year}-${padded}`;
    voucherCache = {
      ...s,
      receiptNextNumber: type === "receipt" ? num + 1 : s.receiptNextNumber,
      paymentNextNumber: type === "payment" ? num + 1 : s.paymentNextNumber,
    };
    persistVoucherSettings();
    return result;
  },
};
