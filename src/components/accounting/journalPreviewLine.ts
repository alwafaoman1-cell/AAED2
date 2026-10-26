import type { JournalEntry } from "@/lib/journalStore";

export interface JournalPreviewLine {
  /** اختياري — لتمييز القيود المحفوظة عن القيود المتوقعة */
  pending?: boolean;
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
  reference?: string;
}

/** محوّل من JournalEntry (المحفوظة في journalStore) → سطر معاينة */
export function entryToPreviewLine(e: JournalEntry): JournalPreviewLine {
  return {
    pending: false,
    date: e.date,
    debitAccount: e.debitAccount,
    creditAccount: e.creditAccount,
    amount: e.amount,
    description: `${e.description}${e.sourceId ? ` — ${e.sourceId}` : ""}`,
  };
}
