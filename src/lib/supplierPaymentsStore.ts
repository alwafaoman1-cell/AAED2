import { createStore } from "./createStore";

export interface SupplierPayment {
  id: string;             // SP-00001
  supplierId: string;
  supplierName: string;
  invoiceId?: string;     // مرتبط بفاتورة شراء (اختياري)
  amount: number;
  method: "نقدي" | "تحويل بنكي" | "شيك" | "بطاقة";
  reference?: string;
  date: string;
  notes?: string;
  createdAt: string;
}

export const supplierPaymentsStore = createStore<SupplierPayment>({
  key: "alwafa_supplier_payments_v1",
  seed: [],
});

export function nextSupplierPaymentId(): string {
  const list = supplierPaymentsStore.getAll();
  return `SP-${String(list.length + 1).padStart(5, "0")}`;
}
