// ظ…ط­ط§ط³ط¨ط© ط¯ظپط¹ط§طھ ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ† â€” ظ‚ظٹظˆط¯ طھظ„ظ‚ط§ط¦ظٹط© ظپظٹ ط¯ظپطھط± ط§ظ„ظٹظˆظ…ظٹط© ط§ظ„ظ…ط­ظ„ظٹ
// ط¹ظ†ط¯ ط§ظ„ظ…ظˆط§ظپظ‚ط©: ظ…ط¯ظٹظ† ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ† / ط¯ط§ط¦ظ† ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„طھط£ظ…ظٹظ†
// ط¹ظ†ط¯ ط§ظ„طھط­طµظٹظ„: ظ…ط¯ظٹظ† ط§ظ„ط¨ظ†ظƒ ط£ظˆ ط§ظ„ظ†ظ‚ط¯ظٹط© / ط¯ط§ط¦ظ† ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†
// ط´ظٹظƒ ظ…ط¹ظ„ظ‚: ظ…ط¯ظٹظ† ط´ظٹظƒط§طھ طھط­طھ ط§ظ„طھط­طµظٹظ„ / ط¯ط§ط¦ظ† ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†طŒ ط«ظ… ط¹ظ†ط¯ ط§ظ„طھط­طµظٹظ„: ظ…ط¯ظٹظ† ط§ظ„ط¨ظ†ظƒ / ط¯ط§ط¦ظ† ط´ظٹظƒط§طھ طھط­طھ ط§ظ„طھط­طµظٹظ„
// ظ…ظ‚ط§طµط©: ظ…ط¯ظٹظ† ط°ظ…ظ… ط§ظ„ظ…ظˆط±ط¯ظٹظ† / ط¯ط§ط¦ظ† ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†

import { addJournalEntry, removeJournalBySource, type JournalAccount } from "./journalStore";
import { calculateVatExclusive } from "@/lib/money";

export type InsurancePaymentMethod = "bank_transfer" | "cheque" | "offset" | "cash";
export type InsurancePaymentStatus = "pending" | "cleared" | "bounced";

export interface PostInsuranceClaimApprovalArgs {
  claimId: string;          // UUID
  claimNumber: string;
  date: string;             // ISO (yyyy-mm-dd)
  amount: number;           // ط¥ط¬ظ…ط§ظ„ظٹ ط´ط§ظ…ظ„ ط§ظ„ط¶ط±ظٹط¨ط© (VAT-exclusive input + VAT on top)
  companyName: string;
  /** ظ†ط³ط¨ط© ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (ط§ظپطھط±ط§ط¶ظٹط§ظ‹ 5% â€” ط¹ظڈظ…ط§ظ†). ظ…ط±ظ‘ط± 0 ظ„ط¥ظ„ط؛ط§ط، ظپطµظ„ ط§ظ„ط¶ط±ظٹط¨ط©. */
  vatRate?: number;
}

/**
 * ظٹظپطµظ„ ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط¹طھظ…ط¯ ط¥ظ„ظ‰ طµط§ظپظٹ ط§ظ„ط¥ظٹط±ط§ط¯ + ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ ط­طھظ‰ ظٹط¸ظ‡ط± ظپظٹ ط¥ظ‚ط±ط§ط± VAT ط§ظ„ط±ط³ظ…ظٹ.
 *   ظ…ط¯ظٹظ†: ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ† (ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ)
 *   ط¯ط§ط¦ظ†: ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„طھط£ظ…ظٹظ† (ط§ظ„طµط§ظپظٹ) + ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ (VAT)
 */
export function postInsuranceClaimApproval(args: PostInsuranceClaimApprovalArgs) {
  if (args.amount <= 0) return;
  removeJournalBySource("insurance_claim", args.claimId);

  const rate = args.vatRate ?? 0.05;
  const breakdown = calculateVatExclusive(args.amount, rate);
  const subtotal = breakdown.subtotalBeforeVat;
  const vat = breakdown.vatAmount;
  const date = args.date.slice(0, 10);
  const baseDesc = `ط§ط¹طھظ…ط§ط¯ ظ…ط·ط§ظ„ط¨ط© ${args.claimNumber} â€” ${args.companyName}`;

  addJournalEntry({
    date,
    source: "insurance_claim",
    sourceId: args.claimId,
    debitAccount: "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†",
    creditAccount: "ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„طھط£ظ…ظٹظ†",
    amount: subtotal,
    description: baseDesc,
  });
  if (vat > 0) {
    addJournalEntry({
      date,
      source: "insurance_claim",
      sourceId: args.claimId,
      debitAccount: "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†",
      creditAccount: "ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ",
      amount: vat,
      description: `${baseDesc} â€” VAT`,
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
 * ظٹظ‚ظˆظ… ط¨ط¥ظ†ط´ط§ط،/طھط­ط¯ظٹط« ط§ظ„ظ‚ظٹظˆط¯ ط§ظ„ظ…ط­ط§ط³ط¨ظٹط© ظ„ظ„ط¯ظپط¹ط© ط¨ط­ط³ط¨ ط§ظ„ط­ط§ظ„ط©.
 * ظٹط­ط°ظپ ط£ظٹ ظ‚ظٹظˆط¯ ط³ط§ط¨ظ‚ط© ظ„ظ‡ط°ظ‡ ط§ظ„ط¯ظپط¹ط© ط«ظ… ظٹط¹ظٹط¯ ط¨ظ†ط§ط،ظ‡ط§ ظˆظپظ‚ط§ظ‹ ظ„ظ„ط­ط§ظ„ط© ط§ظ„ط±ط§ظ‡ظ†ط©.
 */
export function postInsurancePayment(args: PostInsurancePaymentArgs) {
  // ط¥ط²ط§ظ„ط© ظ‚ظٹظˆط¯ ظ‚ط¯ظٹظ…ط© ظ…ط±طھط¨ط·ط© ط¨ظ‡ط°ظ‡ ط§ظ„ط¯ظپط¹ط© (ظ„ط¥ط¹ط§ط¯ط© ط§ظ„طھط±ط­ظٹظ„ ط¹ظ†ط¯ ط§ظ„طھط­ط¯ظٹط«/ط§ظ„ط­ط°ظپ)
  removeJournalBySource("insurance_payment", args.paymentId);

  if (args.amount <= 0) return;
  if (args.status === "bounced") {
    // ط´ظٹظƒ ظ…ط±طھط¬ط¹ â€” ظ„ط§ ظ‚ظٹط¯ ظپط¹ظ‘ط§ظ„
    return;
  }

  let debit: JournalAccount;
  const credit: JournalAccount = "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†";
  let desc = "";

  if (args.method === "cheque") {
    if (args.status === "pending") {
      debit = "ط´ظٹظƒط§طھ طھط­طھ ط§ظ„طھط­طµظٹظ„";
      desc = `ط§ط³طھظ„ط§ظ… ط´ظٹظƒ ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
    } else {
      debit = "ط§ظ„ط¨ظ†ظƒ";
      desc = `طھط­طµظٹظ„ ط´ظٹظƒ ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
    }
  } else if (args.method === "bank_transfer") {
    debit = "ط§ظ„ط¨ظ†ظƒ";
    desc = `طھط­ظˆظٹظ„ ط¨ظ†ظƒظٹ ${args.paymentNumber} â€” ${args.companyName}`;
  } else if (args.method === "cash") {
    debit = "ط§ظ„ظ†ظ‚ط¯ظٹط©";
    desc = `ظ‚ط¨ط¶ ظ†ظ‚ط¯ظٹ ${args.paymentNumber} â€” ${args.companyName}`;
  } else {
    // offset / ظ…ظ‚ط§طµط© â†’ ط°ظ…ظ… ظ…ظˆط±ط¯ظٹظ†
    debit = "ط°ظ…ظ… ط§ظ„ظ…ظˆط±ط¯ظٹظ†";
    desc = `طھط³ظˆظٹط© ظ…ظ‚ط§طµط© ${args.paymentNumber} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
  }

  addJournalEntry({
    date: args.date.slice(0, 10),
    source: "insurance_payment",
    sourceId: args.paymentId,
    debitAccount: debit,
    creditAccount: credit,
    amount: args.amount,
    description: `${desc} â€” ظ…ط·ط§ظ„ط¨ط© ${args.claimNumber}`,
  });
}

export function removeInsurancePaymentJournal(paymentId: string) {
  removeJournalBySource("insurance_payment", paymentId);
}
export function removeInsuranceClaimJournal(claimId: string) {
  removeJournalBySource("insurance_claim", claimId);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ظ…ط¹ط§ظٹظ†ط© ظ‚ظٹظˆط¯ ظ‚ط¨ظ„ ط§ظ„ط­ظپط¸ â€” طھظڈط­ط³ط¨ ظ†ظپط³ ظ…ظ†ط·ظ‚ postInsurancePayment
// ظ„ظƒظ† ط¯ظˆظ† ط§ظ„ظƒطھط§ط¨ط© ظپظٹ ط¯ظپطھط± ط§ظ„ظٹظˆظ…ظٹط©. طھط³طھط¹ظ…ظ„ ظپظٹ ط­ظˆط§ط± "طھط³ط¬ظٹظ„ ط¯ظپط¹ط©".
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const credit: JournalAccount = "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†";
  let desc = "";

  if (args.method === "cheque") {
    if (args.status === "pending") {
      debit = "ط´ظٹظƒط§طھ طھط­طھ ط§ظ„طھط­طµظٹظ„";
      desc = `ط§ط³طھظ„ط§ظ… ط´ظٹظƒ ${args.paymentNumber || "(ط¬ط¯ظٹط¯)"} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
    } else {
      debit = "ط§ظ„ط¨ظ†ظƒ";
      desc = `طھط­طµظٹظ„ ط´ظٹظƒ ${args.paymentNumber || "(ط¬ط¯ظٹط¯)"} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
    }
  } else if (args.method === "bank_transfer") {
    debit = "ط§ظ„ط¨ظ†ظƒ";
    desc = `طھط­ظˆظٹظ„ ط¨ظ†ظƒظٹ ${args.paymentNumber || "(ط¬ط¯ظٹط¯)"} â€” ${args.companyName}`;
  } else if (args.method === "cash") {
    debit = "ط§ظ„ظ†ظ‚ط¯ظٹط©";
    desc = `ظ‚ط¨ط¶ ظ†ظ‚ط¯ظٹ ${args.paymentNumber || "(ط¬ط¯ظٹط¯)"} â€” ${args.companyName}`;
  } else {
    debit = "ط°ظ…ظ… ط§ظ„ظ…ظˆط±ط¯ظٹظ†";
    desc = `طھط³ظˆظٹط© ظ…ظ‚ط§طµط© ${args.paymentNumber || "(ط¬ط¯ظٹط¯)"} ${args.reference ? `(${args.reference})` : ""} â€” ${args.companyName}`;
  }

  return [
    {
      date: args.date.slice(0, 10),
      debitAccount: debit,
      creditAccount: credit,
      amount: args.amount,
      description: `${desc} â€” ظ…ط·ط§ظ„ط¨ط© ${args.claimNumber}`,
    },
  ];
}

export function previewInsuranceClaimApproval(args: PostInsuranceClaimApprovalArgs): PreviewLine[] {
  if (args.amount <= 0) return [];
  const rate = args.vatRate ?? 0.05;
  const breakdown = calculateVatExclusive(args.amount, rate);
  const subtotal = breakdown.subtotalBeforeVat;
  const vat = breakdown.vatAmount;
  const date = args.date.slice(0, 10);
  const baseDesc = `ط§ط¹طھظ…ط§ط¯ ظ…ط·ط§ظ„ط¨ط© ${args.claimNumber} â€” ${args.companyName}`;
  const lines: PreviewLine[] = [
    {
      date,
      debitAccount: "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†",
      creditAccount: "ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„طھط£ظ…ظٹظ†",
      amount: subtotal,
      description: baseDesc,
    },
  ];
  if (vat > 0) {
    lines.push({
      date,
      debitAccount: "ط°ظ…ظ… ط´ط±ظƒط§طھ ط§ظ„طھط£ظ…ظٹظ†",
      creditAccount: "ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ",
      amount: vat,
      description: `${baseDesc} â€” VAT`,
    });
  }
  return lines;
}
