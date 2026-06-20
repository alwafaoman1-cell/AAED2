// ترحيل محاسبي تلقائي لفواتير المبيعات، دفعات العملاء، والمصاريف
// كل عملية تنشئ قيد يومية تلقائي مرتبط بالطرف (عميل/مورد/حساب)
import { addJournalEntry, removeJournalBySource } from "./journalStore";

// ─── فاتورة مبيعات / فاتورة أمر عمل ───
export interface PostSalesInvoiceArgs {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  customerName: string;
  subtotal: number;
  vat: number;
  total: number;
  source?: "sales_invoice" | "work_order_invoice";
}

export function postSalesInvoice(args: PostSalesInvoiceArgs) {
  const src = args.source ?? "sales_invoice";
  removeJournalBySource(src, args.invoiceId);
  if (args.total <= 0) return;

  // مدين: ذمم العملاء (الإجمالي)
  // دائن: إيرادات + ضريبة المبيعات
  const date = args.date.slice(0, 10);
  const baseDesc = `فاتورة ${args.invoiceNumber} — ${args.customerName}`;

  if (args.subtotal > 0) {
    addJournalEntry({
      date,
      source: src,
      sourceId: args.invoiceId,
      debitAccount: "ذمم العملاء",
      creditAccount: src === "work_order_invoice" ? "إيرادات خدمات الورشة" : "إيرادات المبيعات",
      amount: args.subtotal,
      description: baseDesc,
    });
  }
  if (args.vat > 0) {
    addJournalEntry({
      date,
      source: src,
      sourceId: args.invoiceId,
      debitAccount: "ذمم العملاء",
      creditAccount: "ضريبة المبيعات",
      amount: args.vat,
      description: `${baseDesc} — VAT`,
    });
  }
}

export function removeSalesInvoiceJournal(invoiceId: string, source: "sales_invoice" | "work_order_invoice" = "sales_invoice") {
  removeJournalBySource(source, invoiceId);
}

// ─── دفعة عميل ───
export type CustomerPaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";
export interface PostCustomerPaymentArgs {
  paymentId: string;
  paymentNumber: string;
  date: string;
  amount: number;
  customerName: string;
  method: CustomerPaymentMethod;
  reference?: string;
}

export function postCustomerPayment(args: PostCustomerPaymentArgs) {
  removeJournalBySource("customer_payment", args.paymentId);
  if (args.amount <= 0) return;

  const debit =
    args.method === "cash" ? "النقدية" :
    args.method === "cheque" ? "شيكات تحت التحصيل" :
    "البنك";

  const methodLabel =
    args.method === "cash" ? "قبض نقدي" :
    args.method === "cheque" ? `شيك ${args.reference ?? ""}` :
    args.method === "bank_transfer" ? "تحويل بنكي" : "بطاقة";

  addJournalEntry({
    date: args.date.slice(0, 10),
    source: "customer_payment",
    sourceId: args.paymentId,
    debitAccount: debit,
    creditAccount: "ذمم العملاء",
    amount: args.amount,
    description: `${methodLabel} ${args.paymentNumber} — ${args.customerName}`,
  });
}

export function removeCustomerPaymentJournal(paymentId: string) {
  removeJournalBySource("customer_payment", paymentId);
}

// ─── مصروف ───
export type ExpensePaymentSource = "cash" | "bank";
export interface PostExpenseArgs {
  expenseId: string;
  expenseNumber: string;
  date: string;
  amount: number;
  category: string;
  paidFrom: ExpensePaymentSource;
  description?: string;
}

export function postExpense(args: PostExpenseArgs) {
  removeJournalBySource("expense", args.expenseId);
  if (args.amount <= 0) return;

  addJournalEntry({
    date: args.date.slice(0, 10),
    source: "expense",
    sourceId: args.expenseId,
    debitAccount: "مصاريف تشغيلية",
    creditAccount: args.paidFrom === "cash" ? "النقدية" : "البنك",
    amount: args.amount,
    description: `مصروف ${args.expenseNumber} — ${args.category}${args.description ? ` (${args.description})` : ""}`,
  });
}

export function removeExpenseJournal(expenseId: string) {
  removeJournalBySource("expense", expenseId);
}
