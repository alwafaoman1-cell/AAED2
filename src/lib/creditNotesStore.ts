// إشعارات دائنة (Credit Notes / Refunds) — مرتجعات أو خصومات تُضاف لرصيد العميل
import { createStore } from "./createStore";

export interface CreditNote {
  id: string;
  number: string;          // رقم الإشعار (CN-00001)
  date: string;            // ISO yyyy-mm-dd
  customer: string;
  customerPhone?: string;
  amount: number;
  reason: string;          // سبب الإشعار
  linkedInvoiceId?: string;
  status: "active" | "applied" | "void";
  notes?: string;
  createdAt: string;
}

export const creditNotesStore = createStore<CreditNote>({
  key: "alwafa_credit_notes_v1",
  seed: [],
});

function norm(s: string) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

export function getCustomerCreditNotes(customer: string): CreditNote[] {
  const k = norm(customer);
  return creditNotesStore.getAll()
    .filter((c) => norm(c.customer) === k)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getCustomerCreditBalance(customer: string): number {
  return getCustomerCreditNotes(customer)
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}
