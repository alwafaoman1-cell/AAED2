import { createStore } from "./createStore";
import type { PurchaseInvoiceItem } from "./purchaseInvoicesStore";

export interface PurchaseReturn {
  id: string;             // PR-00001
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: PurchaseInvoiceItem[];
  reason?: string;
  total: number;
  createdAt: string;
}

export const purchaseReturnsStore = createStore<PurchaseReturn>({
  key: "alwafa_purchase_returns_v1",
  seed: [],
});

export function nextPurchaseReturnId(): string {
  const list = purchaseReturnsStore.getAll();
  return `PR-${String(list.length + 1).padStart(5, "0")}`;
}
