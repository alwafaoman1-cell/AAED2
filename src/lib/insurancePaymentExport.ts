// تصدير سجل دفعات شركة تأمين إلى CSV/Excel متوافق
import type { ClaimPayment } from "@/hooks/useClaimPayments";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/hooks/useClaimPayments";

const COLUMNS = [
  "رقم الدفعة",
  "التاريخ",
  "رقم المطالبة",
  "شركة التأمين",
  "الطريقة",
  "المرجع",
  "البنك",
  "تاريخ استحقاق الشيك",
  "المبلغ",
  "الحالة",
  "ملاحظات",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface ExportPaymentsOptions {
  payments: ClaimPayment[];
  companyName?: string;
  periodFrom?: string;
  periodTo?: string;
}

export function exportPaymentsToCsv({ payments, companyName, periodFrom, periodTo }: ExportPaymentsOptions) {
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (periodFrom && t < new Date(periodFrom).getTime()) return false;
    if (periodTo && t > new Date(periodTo + "T23:59:59").getTime()) return false;
    return true;
  };
  const filtered = payments.filter((p) => inRange(p.payment_date));

  const rows = filtered.map((p) => [
    p.payment_number,
    p.payment_date,
    p.claim?.claim_number ?? "",
    p.claim?.insurance_company ?? companyName ?? "",
    PAYMENT_METHOD_LABELS[p.payment_method],
    p.reference_number ?? "",
    p.bank_name ?? "",
    p.cheque_due_date ?? "",
    Number(p.amount),
    PAYMENT_STATUS_LABELS[p.status],
    p.notes ?? "",
  ]);

  const lines: string[] = [];
  // Header summary block
  if (companyName) lines.push(`# الشركة: ${companyName}`);
  if (periodFrom || periodTo) lines.push(`# الفترة: ${periodFrom || "—"} → ${periodTo || "—"}`);
  if (lines.length) lines.push("");
  lines.push(COLUMNS.map(csvEscape).join(","));
  rows.forEach((r) => lines.push(r.map(csvEscape).join(",")));

  // BOM for Excel UTF-8 detection
  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const tag = [companyName, periodFrom, periodTo].filter(Boolean).join("_") || "all";
  a.download = `Insurance_Payments_${tag}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
