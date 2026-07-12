// أعمار ديون مرنة لمطالبات شركات التأمين
// يحسب المتبقي لكل مطالبة ويصنّفه ضمن نطاقات قابلة للتخصيص.
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import type { ClaimPayment } from "@/hooks/useClaimPayments";
import type { InsuranceCompany } from "@/hooks/useInsuranceCompanies";

export type AgingBasis =
  | "approval_date"
  | "due_date"
  | "creation_date"
  | "arrival_date"   // تاريخ استلام/وصول المركبة للورشة
  | "delivery_date"  // تاريخ تسليم المركبة للعميل/الشركة
  | "invoice_date";  // تاريخ إصدار الفاتورة الضريبية

export interface AgingBucket {
  /** اسم النطاق المعروض (مثل "0-15") */
  label: string;
  /** الحد الأدنى للأيام (مشمول) */
  from: number;
  /** الحد الأعلى للأيام (مشمول) — null = ما لا نهاية */
  to: number | null;
}

export const DEFAULT_BUCKETS: AgingBucket[] = [
  { label: "0-30", from: 0, to: 30 },
  { label: "31-60", from: 31, to: 60 },
  { label: "61-90", from: 61, to: 90 },
  { label: "+90", from: 91, to: null },
];

export const ALERT_BUCKETS: AgingBucket[] = [
  { label: "0-15", from: 0, to: 15 },
  { label: "16-30", from: 16, to: 30 },
  { label: "31+", from: 31, to: null },
];

export interface AgingRow {
  claimId: string;
  claimNumber: string;
  companyName: string;
  companyId: string | null;
  approvedAmount: number;
  paidAmount: number;
  remaining: number;
  ageDays: number;
  bucketLabel: string;
  baseDate: string; // ISO — التاريخ المرجعي المستخدم في الحساب
  // ─── التواريخ الرسمية للمطالبة (للعرض في الجداول والتقارير) ───
  arrivalDate: string | null;   // workshop_arrival_date
  deliveryDate: string | null;  // delivered_at
  approvalDate: string | null;  // approved_at
  invoiceDate: string | null;   // insurance_invoices.invoice_date
  invoiceNumber: string | null;
  dueDate: string | null;       // approved_at + payment_terms_days
}

export interface AgingComputeOptions {
  basis: AgingBasis;
  buckets: AgingBucket[];
  /** أيام الاستحقاق المفترضة عند basis === "due_date" بدون شركة محددة */
  defaultTermsDays?: number;
  /** خريطة المطالبة → الفاتورة النشطة (لاستخدام invoice_date كأساس وعرض رقم الفاتورة) */
  invoiceByClaim?: Map<string, { invoice_date?: string | null; issued_at: string; invoice_number: string }>;
}

function toBucketLabel(days: number, buckets: AgingBucket[]): string {
  const b = buckets.find((x) => days >= x.from && (x.to === null || days <= x.to));
  return b?.label ?? buckets[buckets.length - 1].label;
}

/** يُرجع صفوف Aging مفصّلة لكل مطالبة فيها متبقي > 0 */
export function computeAging(
  claims: InsuranceClaim[],
  payments: ClaimPayment[],
  companies: InsuranceCompany[] | undefined,
  options: AgingComputeOptions,
): AgingRow[] {
  const now = Date.now();
  const out: AgingRow[] = [];

  claims.forEach((c) => {
    if (c.status !== "approved" && c.status !== "paid") return;
    const cPayments = payments.filter((p) => p.claim_id === c.id && p.status !== "bounced");
    const paid = cPayments.reduce((s, p) => s + Number(p.amount), 0);
    const approved = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
    const remaining = approved - paid;
    if (remaining <= 0.01) return;

    const company = companies?.find((co) => co.id === (c as any).insurance_company_id);
    const terms = company?.payment_terms_days ?? options.defaultTermsDays ?? 90;

    const arrivalIso = (c as any).workshop_arrival_date ?? null;
    const deliveryIso = (c as any).delivered_at ?? null;
    const approvalIso = c.approved_at ?? null;
    const inv = options.invoiceByClaim?.get(c.id) ?? null;
    const invoiceIso = inv?.invoice_date ?? inv?.issued_at ?? null;
    const dueIso = approvalIso
      ? new Date(new Date(approvalIso).getTime() + terms * 86400000).toISOString()
      : new Date(new Date(c.created_at).getTime() + terms * 86400000).toISOString();

    let baseIso: string;
    switch (options.basis) {
      case "due_date":
        baseIso = dueIso;
        break;
      case "creation_date":
        baseIso = c.created_at;
        break;
      case "arrival_date":
        // fallback chain: arrival → approval → created
        baseIso = arrivalIso ?? approvalIso ?? c.created_at;
        break;
      case "delivery_date":
        // إذا لم تُسلَّم بعد، استخدم اليوم الحالي → العمر = 0 (لا يبدأ العد قبل التسليم)
        baseIso = deliveryIso ?? new Date(now).toISOString();
        break;
      case "invoice_date":
        // إذا لا توجد فاتورة، استخدم تاريخ التسليم → الاعتماد → الإنشاء كاحتياطي
        baseIso = invoiceIso ?? deliveryIso ?? approvalIso ?? c.created_at;
        break;
      case "approval_date":
      default:
        baseIso = approvalIso ?? c.created_at;
        break;
    }

    const baseDate = new Date(baseIso).getTime();
    const ageDays = Math.max(0, Math.floor((now - baseDate) / 86400000));
    out.push({
      claimId: c.id,
      claimNumber: c.claim_number,
      companyName: company?.name || c.insurance_company || "غير محدد",
      companyId: (c as any).insurance_company_id ?? null,
      approvedAmount: approved,
      paidAmount: paid,
      remaining,
      ageDays,
      bucketLabel: toBucketLabel(ageDays, options.buckets),
      baseDate: baseIso,
      arrivalDate: arrivalIso,
      deliveryDate: deliveryIso,
      approvalDate: approvalIso,
      invoiceDate: invoiceIso,
      invoiceNumber: inv?.invoice_number ?? null,
      dueDate: dueIso,
    });
  });

  return out;
}


/** يجمع المبالغ حسب اسم النطاق */
export function summarizeAging(rows: AgingRow[], buckets: AgingBucket[]): Record<string, number> {
  const out: Record<string, number> = {};
  buckets.forEach((b) => (out[b.label] = 0));
  rows.forEach((r) => {
    out[r.bucketLabel] = (out[r.bucketLabel] ?? 0) + r.remaining;
  });
  return out;
}
