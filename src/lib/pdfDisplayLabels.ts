import { getActiveLang } from "@/i18n";

type ControlledPdfField = "workOrderStatus" | "inspectionStatus" | "paymentMethod" | "claimStatus" | "stage" | "arrivalMethod" | "vehicleLocation" | "fuelLevel";
// Display aliases only, taken from the existing workshop/status/payment UI.
// Never apply these dictionaries to names, item descriptions, notes or legal text.
const EN: Record<ControlledPdfField, Record<string, string>> = {
  arrivalMethod: {"العميل أحضر المركبة":"Customer brought the vehicle","سائق أحضر المركبة":"Driver brought the vehicle","وصلت بواسطة رافعة":"Arrived by tow truck"},
  vehicleLocation: {"داخل الورشة":"In workshop","مع العميل":"With customer",in_workshop:"In workshop",with_customer:"With customer"},
  fuelLevel: {"فارغ":"Empty","ربع":"Quarter","نصف":"Half","ثلاثة أرباع":"Three quarters","ممتلئ":"Full"},
  inspectionStatus: {
    "مكتمل": "Completed", "مكتملة": "Completed", completed: "Completed",
    "قيد التنفيذ": "In progress", "قيد الفحص": "Under inspection", in_progress: "In progress",
    "تحت الفحص": "Under inspection", pending: "Pending", "معلق": "Pending",
    cancelled: "Cancelled", "ملغي": "Cancelled",
  },
  workOrderStatus: {
    "تحت الفحص": "Under inspection", "بانتظار الموافقة": "Awaiting approval", "بانتظار قطع الغيار": "Awaiting parts",
    "تحت الإصلاح": "In repair", "ضبط الجودة": "Quality check", "جاهز للتسليم": "Ready for delivery",
    "تم التسليم": "Delivered", "مغلق": "Closed", "قيد التنفيذ": "In Progress", "مكتمل": "Completed",
    received: "Under inspection", inspection: "Under inspection", diagnosing: "Under inspection",
    in_progress: "In repair", waiting_parts: "Awaiting parts", completed: "Ready for delivery", delivered: "Delivered",
  },
  paymentMethod: { "نقدي": "Cash", "تحويل بنكي": "Bank transfer", "شيك": "Cheque", "بطاقة": "Card", cash: "Cash", bank_transfer: "Bank transfer", cheque: "Cheque", card: "Card" },
  claimStatus: { "قيد المراجعة": "Pending", "معتمدة": "Approved", "مرفوضة": "Rejected", "مدفوعة": "Paid", "ملغاة": "Cancelled", pending: "Pending", approved: "Approved", rejected: "Rejected", paid: "Paid", cancelled: "Cancelled" },
  stage: { "استلام": "Received", "فحص": "Inspection", "تحت الإصلاح": "In Progress", "ضبط الجودة": "Quality Check", "تسليم": "Delivery" },
};

export function pdfControlledLabel(value: string, field: ControlledPdfField, language = getActiveLang()): string {
  return language === "en" ? EN[field][value] || value : value;
}
