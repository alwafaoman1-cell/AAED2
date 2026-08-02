import type { WorkOrderLinkedInvoice } from "@/lib/workOrderFinancials";

export type PaymentTarget =
  | {
      kind: "sales_invoice";
      id: string;
      number: string;
      customerId: string | null;
      customerName: string;
      vehicleId: string | null;
      vehiclePlate: string | null;
      workOrderId: string | null;
      claimId: null;
      invoiceId: string;
      total: number;
      paid: number;
      remaining: number;
    }
  | {
      kind: "insurance_claim";
      id: string;
      number: string;
      customerId: string | null;
      customerName: string;
      vehicleId: string | null;
      vehiclePlate: string | null;
      workOrderId: string | null;
      claimId: string;
      invoiceId: string | null;
      insuranceCompanyId: string | null;
      insuranceCompany: string;
      total: number;
      paid: number;
      remaining: number;
    };

export function paymentTargetFromWorkOrderInvoice(invoice: WorkOrderLinkedInvoice): PaymentTarget | null {
  if (invoice.kind === "sales_invoice") {
    return {
      kind: "sales_invoice",
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      vehicleId: invoice.vehicleId,
      vehiclePlate: invoice.vehiclePlate,
      workOrderId: invoice.workOrderId,
      claimId: null,
      invoiceId: invoice.id,
      total: invoice.total,
      paid: invoice.paid,
      remaining: invoice.remaining,
    };
  }
  if (!invoice.claimId) return null;
  return {
    kind: "insurance_claim",
    id: invoice.id,
    number: invoice.number,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    vehicleId: invoice.vehicleId,
    vehiclePlate: invoice.vehiclePlate,
    workOrderId: invoice.workOrderId,
    claimId: invoice.claimId,
    invoiceId: invoice.id,
    insuranceCompanyId: invoice.insuranceCompanyId,
    insuranceCompany: invoice.insuranceCompanyName || "—",
    total: invoice.total,
    paid: invoice.paid,
    remaining: invoice.remaining,
  };
}
