/**
 * Unified status color system.
 * Maps any status string (English/Arabic) to a semantic color category
 * that resolves to design-system tokens (success/warning/destructive/info/muted).
 *
 * Usage:
 *   <Badge className={statusBadgeClasses(order.status)}>{label}</Badge>
 *   const tone = statusTone(claim.status); // "success" | "warning" | ...
 */

export type StatusTone = "success" | "warning" | "destructive" | "info" | "muted" | "primary";

const SUCCESS = new Set([
  "completed", "delivered", "paid", "approved", "active", "cleared",
  "done", "closed", "issued", "received_payment", "success",
  "مكتمل", "مسلم", "مدفوع", "معتمد", "نشط", "مقبول", "تم", "مغلق",
]);

const WARNING = new Set([
  "pending", "in_progress", "in-progress", "processing", "waiting",
  "diagnosis", "repair", "ready", "draft", "partial", "partially_paid",
  "قيد الانتظار", "قيد التنفيذ", "قيد المعالجة", "قيد الفحص", "قيد الإصلاح",
  "جاهز", "مسودة", "مدفوع جزئياً", "معلق",
]);

const DESTRUCTIVE = new Set([
  "rejected", "cancelled", "canceled", "failed", "overdue", "expired",
  "bounced", "void", "refunded", "blocked", "error",
  "مرفوض", "ملغي", "ملغى", "فشل", "متأخر", "منتهي", "مرتجع", "محظور",
]);

const INFO = new Set([
  "received", "new", "created", "submitted", "scheduled", "assigned",
  "in_review", "under_review", "estimated",
  "مستلم", "جديد", "تم الإنشاء", "مُرسل", "مجدول", "مسند", "قيد المراجعة", "تحت التقدير",
]);

const PRIMARY = new Set([
  "open", "active_claim", "in_workshop",
  "مفتوح", "في الورشة",
]);

export function statusTone(status?: string | null): StatusTone {
  if (!status) return "muted";
  const s = String(status).trim().toLowerCase();
  if (SUCCESS.has(s)) return "success";
  if (WARNING.has(s)) return "warning";
  if (DESTRUCTIVE.has(s)) return "destructive";
  if (INFO.has(s)) return "info";
  if (PRIMARY.has(s)) return "primary";
  return "muted";
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success:     "bg-success/15 text-success border-success/30",
  warning:     "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  info:        "bg-info/15 text-info border-info/30",
  primary:     "bg-primary/15 text-primary border-primary/30",
  muted:       "bg-muted text-muted-foreground border-border",
};

export function statusBadgeClasses(status?: string | null): string {
  const s = String(status ?? "").trim().toLowerCase();
  // Special-case: paid → dark green for high visibility
  if (s === "paid" || s === "مدفوع" || s === "مدفوعة") {
    return "bg-green-700 text-white border-green-800 dark:bg-green-600 dark:border-green-700";
  }
  return TONE_CLASSES[statusTone(status)];
}

export function toneClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone];
}

/** Solid dot indicator class (for timelines/lists). */
export function statusDotClass(status?: string | null): string {
  const tone = statusTone(status);
  const map: Record<StatusTone, string> = {
    success:     "bg-success",
    warning:     "bg-warning",
    destructive: "bg-destructive",
    info:        "bg-info",
    primary:     "bg-primary",
    muted:       "bg-muted-foreground/40",
  };
  return map[tone];
}
