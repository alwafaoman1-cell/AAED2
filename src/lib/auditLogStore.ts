// نظام سجل النشاط (Audit Log) - يتتبع كل الإجراءات الحساسة في النظام
import { createStore } from "./createStore";
import { getCurrentRole } from "./permissions";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "status_change"
  | "payment"
  | "refund";

export type AuditEntity =
  | "work_order"
  | "expense"
  | "receipt"
  | "deposit"
  | "inspection"
  | "invoice"
  | "vehicle"
  | "customer"
  | "claim"
  | "cashbox";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;        // اسم/دور المستخدم
  actorRole: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  label: string;        // وصف موجز للكيان (للعرض السريع)
  description?: string; // تفاصيل إضافية (مثل: "تعديل المبلغ من 100 إلى 150")
  amount?: number;
  metadata?: Record<string, any>;
}

export const auditLogStore = createStore<AuditEntry>({
  key: "alwafa_audit_log_v1",
  seed: [],
});

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  restore: "استرجاع",
  status_change: "تغيير حالة",
  payment: "دفع",
  refund: "استرداد",
};

const ENTITY_LABELS: Record<AuditEntity, string> = {
  work_order: "أمر عمل",
  expense: "سند صرف",
  receipt: "سند قبض",
  deposit: "عربون",
  inspection: "فحص",
  invoice: "فاتورة",
  vehicle: "سيارة",
  customer: "عميل",
  claim: "مطالبة تأمين",
  cashbox: "خزينة",
};

export function getActionLabel(a: AuditAction): string {
  return ACTION_LABELS[a] || a;
}
export function getEntityLabel(e: AuditEntity): string {
  return ENTITY_LABELS[e] || e;
}

/** تسجيل نشاط جديد + توليد إشعار */
export function logActivity(input: Omit<AuditEntry, "id" | "timestamp" | "actor" | "actorRole">) {
  const role = getCurrentRole();
  const entry: AuditEntry = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor: role === "admin" ? "المدير" : role === "manager" ? "المشرف" : role,
    actorRole: role,
    ...input,
  };
  auditLogStore.add(entry);
  // إرسال إشعار فوري (تحميل ديناميكي لتفادي الـ circular import)
  import("./notificationsStore").then(({ notificationsStore }) => {
    notificationsStore.addFromAudit(entry);
  }).catch(() => {});
}
