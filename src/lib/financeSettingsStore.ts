import { createStore } from "./createStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import { type FinanceCategory } from "./financeExpenseCategoriesStore";

export { expenseCategoriesStore } from "./financeExpenseCategoriesStore";
export type { FinanceCategory } from "./financeExpenseCategoriesStore";

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
let voucherMutationVersion = 0;

function loadVoucherSettings(): VoucherSettings {
  if (voucherCache) return voucherCache;
  voucherCache = { ...DEFAULT_VOUCHER_SETTINGS };
  const startedAtVersion = voucherMutationVersion;
  void readCloudSetting<VoucherSettings>(VOUCHER_SETTINGS_KEY, DEFAULT_VOUCHER_SETTINGS)
    .then((value) => {
      if (startedAtVersion !== voucherMutationVersion) return;
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
  async updateConfirmed(patch: Partial<VoucherSettings>): Promise<void> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد المنشأة الحالية");
    const next = { ...loadVoucherSettings(), ...patch };
    const startedAtVersion = voucherMutationVersion;
    await writeCloudSetting(VOUCHER_SETTINGS_KEY, next);
    if (await getCurrentTenantId() !== tenantId) {
      throw new Error("تغيرت المنشأة الحالية أثناء حفظ إعدادات السندات؛ أعد تحميل الصفحة");
    }
    if (startedAtVersion !== voucherMutationVersion) return;
    voucherMutationVersion += 1;
    voucherCache = next;
    voucherListeners.forEach((cb) => cb());
  },
  update(patch: Partial<VoucherSettings>) {
    const current = loadVoucherSettings();
    voucherMutationVersion += 1;
    voucherCache = { ...current, ...patch };
    persistVoucherSettings();
  },
  reset() {
    voucherMutationVersion += 1;
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
