// دفتر يومية محاسبي بسيط (Journal Ledger)
// كل قيد يحتوي على: تاريخ، حساب مدين، حساب دائن، مبلغ، مرجع، وصف
import { createStore } from "./createStore";

export type JournalAccount =
  | "المخزون"
  | "ذمم الموردين"
  | "النقدية"
  | "البنك"
  | "مصروف شراء"
  | "مرتجعات المشتريات"
  | "ضريبة القيمة المضافة"
  | "مصاريف شحن"
  | "ذمم شركات التأمين"
  | "إيرادات التأمين"
  | "شيكات تحت التحصيل"
  | "ذمم العملاء"
  | "إيرادات المبيعات"
  | "إيرادات خدمات الورشة"
  | "ضريبة المبيعات"
  | "مصاريف تشغيلية"
  | "خصم مكتسب"
  | "خصم ممنوح";

export type JournalSource =
  | "purchase_invoice"
  | "supplier_payment"
  | "purchase_return"
  | "manual"
  | "insurance_claim"
  | "insurance_payment"
  | "sales_invoice"
  | "customer_payment"
  | "expense"
  | "work_order_invoice";


export interface JournalEntry {
  id: string;             // JE-00001
  date: string;           // ISO yyyy-mm-dd
  source: JournalSource;
  sourceId: string;       // PI-00001 / SP-00001 / PR-00001
  debitAccount: JournalAccount;
  creditAccount: JournalAccount;
  amount: number;
  description: string;
  createdAt: string;
}

export const journalStore = createStore<JournalEntry>({
  key: "alwafa_journal_v1",
  seed: [],
});

export function nextJournalId(): string {
  // Use max(existing numeric IDs) + 1 to avoid collisions after any deletion.
  const list = journalStore.getAll();
  const max = list.reduce((m, e) => {
    const n = parseInt(String(e.id).replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `JE-${String(max + 1).padStart(5, "0")}`;
}

export function addJournalEntry(
  entry: Omit<JournalEntry, "id" | "createdAt">,
): JournalEntry {
  const full: JournalEntry = {
    ...entry,
    id: nextJournalId(),
    createdAt: new Date().toISOString(),
  };
  journalStore.add(full);
  return full;
}

/** حذف كل القيود المرتبطة بمستند معين (عند حذف فاتورة/دفعة) */
export function removeJournalBySource(source: JournalSource, sourceId: string) {
  const list = journalStore.getAll();
  list
    .filter((e) => e.source === source && e.sourceId === sourceId)
    .forEach((e) => journalStore.remove(e.id));
}

export function getJournalForSource(source: JournalSource, sourceId: string): JournalEntry[] {
  return journalStore
    .getAll()
    .filter((e) => e.source === source && e.sourceId === sourceId);
}
