import { createStore } from "./createStore";

export interface PurchaseInvoiceItem {
  partId?: string;        // ربط اختياري بصنف من المخزون
  partNumber?: string;
  name: string;
  qty: number;
  unitPrice: number;
  taxRate: number;        // نسبة %
  discount: number;       // خصم على البند
}

export interface PurchaseInvoice {
  id: string;             // PI-00001
  supplierId: string;
  supplierName: string;
  date: string;           // ISO date (yyyy-mm-dd)
  invoiceNumber: string;  // رقم فاتورة المورد الخارجي
  paymentTerms?: string;
  paymentDays?: number;
  items: PurchaseInvoiceItem[];
  discount: number;       // خصم نسبة مئوية على الإجمالي
  shipping: number;
  notes?: string;
  paid: boolean;
  paidAmount: number;
  status: "draft" | "received" | "partial" | "paid";
  createdAt: string;
}

interface TotalsInput {
  items: PurchaseInvoiceItem[];
  discount: number;
  shipping: number;
}
function calcTotals(inv: TotalsInput) {
  const subtotal = inv.items.reduce((s, i) => s + i.qty * i.unitPrice - (i.discount || 0), 0);
  const tax = inv.items.reduce(
    (s, i) => s + ((i.qty * i.unitPrice - (i.discount || 0)) * (i.taxRate || 0)) / 100,
    0,
  );
  const discountAmt = (subtotal * (inv.discount || 0)) / 100;
  const total = subtotal + tax + (inv.shipping || 0) - discountAmt;
  return { subtotal, tax, discountAmt, total };
}

export const purchaseInvoicesStore = createStore<PurchaseInvoice>({
  key: "alwafa_purchase_invoices_v1",
  seed: [],
});

export function getPurchaseTotals(inv: TotalsInput) {
  return calcTotals(inv);
}

export function nextPurchaseInvoiceId(): string {
  const list = purchaseInvoicesStore.getAll();
  const num = list.length + 1;
  return `PI-${String(num).padStart(5, "0")}`;
}
