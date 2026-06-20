// سجل مراسلات الواتساب لكل أمر عمل (تخزين محلي)

export type WaMessageKind =
  | "parts_request"
  | "parts_request_supplier"
  | "ready_for_pickup"
  | "payment_followup"
  | "invoice_share"
  | "custom";

export interface WaMessageLog {
  id: string;
  workOrderId: string;
  kind: WaMessageKind;
  recipientName: string;       // اسم المستقبل (عميل/مورد)
  recipientPhone: string;      // رقم الهاتف
  recipientType: "customer" | "supplier" | "other";
  preview: string;             // أول 120 حرف من الرسالة
  fullText: string;            // النص الكامل
  sentAt: string;              // ISO
  sentBy?: string;             // اسم المستخدم لاحقاً
}

const STORAGE_KEY = "alwafa_wa_message_logs";

let cache: WaMessageLog[] | null = null;
const listeners = new Set<() => void>();

function load(): WaMessageLog[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

export const WA_KIND_LABELS: Record<WaMessageKind, string> = {
  parts_request: "طلب قطع غيار (للعميل)",
  parts_request_supplier: "طلب قطع غيار (للمورد)",
  ready_for_pickup: "إشعار جاهزية السيارة",
  payment_followup: "متابعة دفع/فاتورة",
  invoice_share: "إرسال فاتورة",
  custom: "رسالة مخصصة",
};

export function logWaMessage(entry: Omit<WaMessageLog, "id" | "sentAt"> & { sentAt?: string }): WaMessageLog {
  const list = load();
  const item: WaMessageLog = {
    id: `WA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sentAt: entry.sentAt || new Date().toISOString(),
    ...entry,
    preview: (entry.fullText || "").slice(0, 120),
  };
  list.unshift(item);
  // limit to last 500 to avoid bloat
  if (list.length > 500) list.length = 500;
  persist();
  return item;
}

export function getWaLogsForOrder(orderId: string): WaMessageLog[] {
  return load().filter((m) => m.workOrderId === orderId);
}

export function getAllWaLogs(): WaMessageLog[] {
  return load();
}

export function deleteWaLog(id: string) {
  const list = load();
  const idx = list.findIndex((l) => l.id === id);
  if (idx >= 0) {
    list.splice(idx, 1);
    persist();
  }
}

export function subscribeWaLogs(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
