import { createStore } from "./createStore";
import type { PaymentMethod } from "./financeSettingsStore";

export type DepositScope = "customer" | "vehicle";

export interface DepositRecord {
  id: string;
  receiptNumber: string;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  scope: DepositScope;
  customer: string; // اسم العميل
  customerPhone?: string;
  /** رقم اللوحة عندما يكون النطاق "vehicle" */
  plate?: string;
  paymentMethod: PaymentMethod;
  cashboxId?: string;
  cashboxName?: string;
  notes?: string;
  /** المبلغ المستخدم بالفعل (مخصوم من فواتير) */
  consumed: number;
  /** أمر العمل/الفاتورة الذي استخدم العربون */
  appliedToWorkOrderId?: string;
  createdAt: string;
}

export const depositsStore = createStore<DepositRecord>({
  key: "alwafa_deposits_v1",
  seed: [],
});

/** الرصيد المتاح للعميل (عام + سيارات) */
export function getCustomerDepositBalance(customer: string): number {
  const c = customer.trim().toLowerCase();
  return depositsStore
    .getAll()
    .filter((d) => d.customer.trim().toLowerCase() === c)
    .reduce((sum, d) => sum + Math.max(0, d.amount - (d.consumed || 0)), 0);
}

/** الرصيد المتاح لسيارة محددة */
export function getVehicleDepositBalance(plate: string): number {
  const p = plate.trim().toLowerCase();
  return depositsStore
    .getAll()
    .filter((d) => d.scope === "vehicle" && (d.plate || "").trim().toLowerCase() === p)
    .reduce((sum, d) => sum + Math.max(0, d.amount - (d.consumed || 0)), 0);
}
