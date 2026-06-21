// يربط كل قيد يومية بمسار/صفحة المصدر الأصلي في النظام
import type { JournalSource } from "./journalStore";

export function getJournalSourceRoute(source: JournalSource, sourceId: string): string | null {
  switch (source) {
    case "sales_invoice":
      return `/sales/invoices/${encodeURIComponent(sourceId)}`;
    case "work_order_invoice":
      return `/work-orders/${encodeURIComponent(sourceId)}`;
    case "customer_payment":
      return `/sales/payments`;
    case "expense":
      return `/accounting`; // قائمة المصاريف (تبويب نظرة عامة)
    case "purchase_invoice":
      return `/inventory/purchase-invoices`;
    case "supplier_payment":
      return `/inventory/supplier-payments`;
    case "purchase_return":
      return `/inventory/purchase-returns`;
    case "insurance_claim":
      return `/insurance/${encodeURIComponent(sourceId)}`;
    case "insurance_payment":
      return `/insurance/payments`;
    case "manual":
    default:
      return null;
  }
}

export const JOURNAL_SOURCE_LABEL: Record<JournalSource, string> = {
  purchase_invoice: "فاتورة شراء",
  supplier_payment: "دفعة مورد",
  purchase_return: "مرتجع مشتريات",
  manual: "يدوي",
  insurance_claim: "مطالبة تأمين",
  insurance_payment: "دفعة تأمين",
  sales_invoice: "فاتورة مبيعات",
  customer_payment: "دفعة عميل",
  expense: "مصروف",
  work_order_invoice: "فاتورة أمر عمل",
};
