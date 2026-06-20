// تحويل مطالبة تأمين ملغاة إلى مصروف + فاتورة على مالك السيارة
import { expensesStore, type ExpenseRecord } from "./expensesStore";
import { addWorkOrder, type WorkOrder } from "./workOrdersStore";
import { nextWorkOrderNumber } from "./numbering";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";

/** إنشاء سند مصروف تلقائي للمطالبة الملغاة */
export function createExpenseFromCancelledClaim(claim: InsuranceClaim, amount: number): ExpenseRecord {
  const voucherNumber = `EXP-CNL-${Date.now().toString().slice(-6)}`;
  const record: ExpenseRecord = {
    id: `${voucherNumber}`,
    voucherNumber,
    date: new Date().toISOString().slice(0, 10),
    amount,
    categoryId: "insurance_cancelled",
    categoryName: "مطالبات تأمين ملغاة",
    cashboxId: "main",
    cashboxName: "الصندوق الرئيسي",
    paymentMethod: "cash",
    beneficiary: claim.vehicle_owner_name ?? claim.customer?.name ?? "مالك السيارة",
    description: `تكاليف إصلاح المطالبة الملغاة ${claim.claim_number} — ${claim.insurance_company}`,
    createdAt: new Date().toISOString(),
  };
  expensesStore.add(record);
  return record;
}

/** إنشاء أمر عمل/فاتورة على مالك السيارة بدلاً من شركة التأمين */
export function createCustomerInvoiceFromCancelledClaim(
  claim: InsuranceClaim,
  amount: number,
): WorkOrder {
  const woId = nextWorkOrderNumber();
  const wo: WorkOrder = {
    id: woId,
    customer: claim.vehicle_owner_name ?? claim.customer?.name ?? "—",
    phone: claim.vehicle_owner_phone ?? claim.customer?.phone ?? "",
    plate: claim.vehicle?.plate_number ?? "—",
    vehicleType: claim.vehicle?.brand ?? "",
    model: claim.vehicle?.model ?? "",
    year: String(claim.vehicle?.year ?? ""),
    vin: "",
    insurance: "—",
    claimNumber: claim.claim_number,
    entryDate: new Date().toISOString().slice(0, 10),
    technician: "",
    serviceType: "إصلاح خاص (مطالبة ملغاة)",
    status: "بانتظار الموافقة",
    totalCost: amount,
    laborCost: 0,
    partsCost: amount,
    description: `محوّل من مطالبة تأمين ملغاة ${claim.claim_number}. يتم تحصيل المبلغ من مالك السيارة مباشرة.`,
    partsNeeded: (claim.needed_parts ?? []).map((p, i) => ({
      id: `${woId}-p${i}`,
      name: p.name,
      quantity: p.quantity || 1,
      notes: p.notes,
      status: "pending",
    })),
  };
  addWorkOrder(wo);
  return wo;
}
