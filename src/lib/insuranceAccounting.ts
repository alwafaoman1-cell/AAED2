// محاسبة دفعات شركات التأمين — قيود تلقائية في دفتر اليومية المحلي
// عند الموافقة: مدين ذمم شركات التأمين / دائن إيرادات التأمين
// عند التحصيل: مدين البنك أو النقدية / دائن ذمم شركات التأمين
// شيك معلق: مدين شيكات تحت التحصيل / دائن ذمم شركات التأمين، ثم عند التحصيل: مدين البنك / دائن شيكات تحت التحصيل
// مقاصة: مدين ذمم الموردين / دائن ذمم شركات التأمين

import { addJournalEntry, removeJournalBySource, type JournalAccount } from "./journalStore";

export type InsurancePaymentMethod = "bank_transfer" | "cheque" | "offset" | "cash";
export type InsurancePaymentStatus = "pending" | "cleared" | "bounced";

export interface PostInsuranceClaimApprovalArgs {
  claimId: string;          // UUID
  claimNumber: string;
  date: string;             // ISO (yyyy-mm-dd)
  amount: number;           // إجمالي شامل الضريبة (VAT-inclusive)
  companyName: string;
  /** نسبة ضريبة القيمة المضافة (افتراضياً 5% — عُمان). مرّر 0 لإلغاء فصل الضريبة. */
  vatRate?: number;
}

/**
 * يفصل المبلغ المعتمد إلى صافي الإيراد + ضريبة المبيعات حتى يظهر في إقرار VAT الرسمي.
 *   مدين: ذمم شركات التأمين (الإجمالي)
 *   دائن: إيرادات التأمين (الصافي) + ضريبة المبيعات (VAT)
 */
export function postInsuranceClaimApproval(args: PostInsuranceClaimApprovalArgs) {
  if (args.amount <= 0) return;
  removeJournalBySource("insurance_claim", args.claimId);

  const rate = args.vatRate ?? 0.05;
  const subtotal = rate > 0 ? +(args.amount / (1 + rate)).toFixed(3) : args.amount;
  const vat = rate > 0 ? +(args.amount - subtotal).toFixed(3) : 0;
  const date = args.date.slice(0, 10);
  const baseDesc = `اعتماد مطالبة ${args.claimNumber} — ${args.companyName}`;

  addJournalEntry({
    date,
    source: "insurance_claim",
    sourceId: args.claimId,
    debitAccount: "ذمم شركات التأمين",
    creditAccount: "إيرادات التأمين",
    amount: subtotal,
    description: baseDesc,
  });
  if (vat > 0) {
    addJournalEntry({
      date,
      source: "insurance_claim",
      sourceId: args.claimId,
      debitAccount: "ذمم شركات التأمين",
      creditAccount: "ضريبة المبيعات",
      amount: vat,
      description: `${baseDesc} — VAT`,
    });
  }
}

export interface PostInsurancePaymentArgs {
  paymentId: string;
  paymentNumber: string;
  claimNumber: string;
  date: string;
  amount: number;
  method: InsurancePaymentMethod;
  status: InsurancePaymentStatus;
  companyName: string;
  reference?: string | null;
}

/**
 * يقوم بإنشاء/تحديث القيود المحاسبية للدفعة بحسب الحالة.
 * يحذف أي قيود سابقة لهذه الدفعة ثم يعيد بناءها وفقاً للحالة الراهنة.
 */
export function postInsurancePayment(args: PostInsurancePaymentArgs) {
  // إزالة قيود قديمة مرتبطة بهذه الدفعة (لإعادة الترحيل عند التحديث/الحذف)
  removeJournalBySource("insurance_payment", args.paymentId);

  if (args.amount <= 0) return;
  if (args.status === "bounced") {
    // شيك مرتجع — لا قيد فعّال
    return;
  }

  let debit: JournalAccount;
  const credit: JournalAccount = "ذمم شركات التأمين";
  let desc = "";

  if (args.method === "cheque") {
    if (args.status === "pending") {
      debit = "شيكات تحت التحصيل";
      desc = `استلام شيك ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
    } else {
      debit = "البنك";
      desc = `تحصيل شيك ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
    }
  } else if (args.method === "bank_transfer") {
    debit = "البنك";
    desc = `تحويل بنكي ${args.paymentNumber} — ${args.companyName}`;
  } else if (args.method === "cash") {
    debit = "النقدية";
    desc = `قبض نقدي ${args.paymentNumber} — ${args.companyName}`;
  } else {
    // offset / مقاصة → ذمم موردين
    debit = "ذمم الموردين";
    desc = `تسوية مقاصة ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
  }

  addJournalEntry({
    date: args.date.slice(0, 10),
    source: "insurance_payment",
    sourceId: args.paymentId,
    debitAccount: debit,
    creditAccount: credit,
    amount: args.amount,
    description: `${desc} — مطالبة ${args.claimNumber}`,
  });
}

export function removeInsurancePaymentJournal(paymentId: string) {
  removeJournalBySource("insurance_payment", paymentId);
}
export function removeInsuranceClaimJournal(claimId: string) {
  removeJournalBySource("insurance_claim", claimId);
}

// ─────────────────────────────────────────────────────────────────
// معاينة قيود قبل الحفظ — تُحسب نفس منطق postInsurancePayment
// لكن دون الكتابة في دفتر اليومية. تستعمل في حوار "تسجيل دفعة".
// ─────────────────────────────────────────────────────────────────
export interface PreviewLine {
  date: string;
  debitAccount: JournalAccount;
  creditAccount: JournalAccount;
  amount: number;
  description: string;
}

export function previewInsurancePayment(args: PostInsurancePaymentArgs): PreviewLine[] {
  if (args.amount <= 0 || args.status === "bounced") return [];

  let debit: JournalAccount;
  const credit: JournalAccount = "ذمم شركات التأمين";
  let desc = "";

  if (args.method === "cheque") {
    if (args.status === "pending") {
      debit = "شيكات تحت التحصيل";
      desc = `استلام شيك ${args.paymentNumber || "(جديد)"} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
    } else {
      debit = "البنك";
      desc = `تحصيل شيك ${args.paymentNumber || "(جديد)"} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
    }
  } else if (args.method === "bank_transfer") {
    debit = "البنك";
    desc = `تحويل بنكي ${args.paymentNumber || "(جديد)"} — ${args.companyName}`;
  } else if (args.method === "cash") {
    debit = "النقدية";
    desc = `قبض نقدي ${args.paymentNumber || "(جديد)"} — ${args.companyName}`;
  } else {
    debit = "ذمم الموردين";
    desc = `تسوية مقاصة ${args.paymentNumber || "(جديد)"} ${args.reference ? `(${args.reference})` : ""} — ${args.companyName}`;
  }

  return [
    {
      date: args.date.slice(0, 10),
      debitAccount: debit,
      creditAccount: credit,
      amount: args.amount,
      description: `${desc} — مطالبة ${args.claimNumber}`,
    },
  ];
}

export function previewInsuranceClaimApproval(args: PostInsuranceClaimApprovalArgs): PreviewLine[] {
  if (args.amount <= 0) return [];
  const rate = args.vatRate ?? 0.05;
  const subtotal = rate > 0 ? +(args.amount / (1 + rate)).toFixed(3) : args.amount;
  const vat = rate > 0 ? +(args.amount - subtotal).toFixed(3) : 0;
  const date = args.date.slice(0, 10);
  const baseDesc = `اعتماد مطالبة ${args.claimNumber} — ${args.companyName}`;
  const lines: PreviewLine[] = [
    {
      date,
      debitAccount: "ذمم شركات التأمين",
      creditAccount: "إيرادات التأمين",
      amount: subtotal,
      description: baseDesc,
    },
  ];
  if (vat > 0) {
    lines.push({
      date,
      debitAccount: "ذمم شركات التأمين",
      creditAccount: "ضريبة المبيعات",
      amount: vat,
      description: `${baseDesc} — VAT`,
    });
  }
  return lines;
}
