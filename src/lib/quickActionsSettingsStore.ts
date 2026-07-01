// إعدادات زر الإجراءات السريعة العائم (FAB)
// يُحفظ في localStorage حتى يبقى مع المستخدم على نفس الجهاز.

import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

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
let cache: QuickActionsSettings = { ...DEFAULT_SETTINGS };
let bootstrapped = false;

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  void readCloudSetting<QuickActionsSettings>(KEY, DEFAULT_SETTINGS).then((value) => {
    cache = { ...DEFAULT_SETTINGS, ...value };
    listeners.forEach((listener) => listener(cache));
  }).catch(() => undefined);
  subscribeCloudSetting<QuickActionsSettings>(KEY, (value) => {
    cache = { ...DEFAULT_SETTINGS, ...value };
    listeners.forEach((listener) => listener(cache));
  });
}

export function getQuickActionsSettings(): QuickActionsSettings {
  bootstrap();
  return { ...cache, visibleActions: [...cache.visibleActions] };
}

export function saveQuickActionsSettings(s: QuickActionsSettings) {
  cache = { ...DEFAULT_SETTINGS, ...s };
  listeners.forEach((l) => l(cache));
  void writeCloudSetting(KEY, cache).catch((error) => console.warn("[quickActionsSettings] Supabase write failed", error));
}

export function subscribeQuickActionsSettings(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetQuickActionsSettings() {
  saveQuickActionsSettings({ ...DEFAULT_SETTINGS });
}
