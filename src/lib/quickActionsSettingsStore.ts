// إعدادات زر الإجراءات السريعة العائم (FAB)
// يُحفظ في localStorage حتى يبقى مع المستخدم على نفس الجهاز.

export type FabPosition = "bottom-right" | "bottom-left" | "bottom-center";

export type QuickActionKey =
  | "expense"
  | "photos"
  | "invoice"
  | "quote"
  | "newWorkOrder"
  | "newInspection"
  | "newVehicle"
  | "neededParts"
  | "stockMovement"
  | "newClaim"
  | "newEstimate";

export interface QuickActionsSettings {
  enabled: boolean;
  position: FabPosition;
  offsetY: number; // 16 → 200
  visibleActions: QuickActionKey[];
}

const KEY = "alwafa_quick_actions_v1";

export const ALL_ACTIONS: { key: QuickActionKey; labelAr: string; labelEn: string }[] = [
  { key: "expense",        labelAr: "مصروفات أمر عمل",      labelEn: "Work Order Expense" },
  { key: "photos",         labelAr: "صور أمر عمل",          labelEn: "Work Order Photos" },
  { key: "invoice",        labelAr: "فاتورة لأمر عمل",       labelEn: "Invoice From WO" },
  { key: "quote",          labelAr: "عرض سعر / تقدير تأمين", labelEn: "Quote / Estimate" },
  { key: "newWorkOrder",   labelAr: "أمر عمل جديد",         labelEn: "New Work Order" },
  { key: "newInspection",  labelAr: "فحص جديد",             labelEn: "New Inspection" },
  { key: "newVehicle",     labelAr: "استلام مركبة",          labelEn: "Receive Vehicle" },
  { key: "neededParts",    labelAr: "السيارات تحتاج قطع",    labelEn: "Parts Needed" },
  { key: "stockMovement",  labelAr: "حركة مخزنية",          labelEn: "Stock Movement" },
  { key: "newEstimate",    labelAr: "تقدير إصلاح سريع",      labelEn: "Quick Repair Estimate" },
  { key: "newClaim",       labelAr: "مطالبة تأمين جديدة",    labelEn: "New Insurance Claim" },
];

export const DEFAULT_SETTINGS: QuickActionsSettings = {
  enabled: true,
  position: "bottom-right",
  offsetY: 24,
  visibleActions: ["expense", "photos", "invoice", "newWorkOrder"],
};

type Listener = (s: QuickActionsSettings) => void;
const listeners = new Set<Listener>();

export function getQuickActionsSettings(): QuickActionsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveQuickActionsSettings(s: QuickActionsSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(s));
}

export function subscribeQuickActionsSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetQuickActionsSettings() {
  saveQuickActionsSettings({ ...DEFAULT_SETTINGS });
}
