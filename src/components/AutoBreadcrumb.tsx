import { Link, useLocation } from "react-router-dom";
import { Home, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";

// خريطة لأسماء المسارات الرئيسية (تظهر بالعربي/الإنجليزي حسب اللغة)
const LABELS: Record<string, { ar: string; en: string }> = {
  "work-orders": { ar: "أوامر العمل", en: "Work Orders" },
  inspection: { ar: "الفحص", en: "Inspection" },
  insurance: { ar: "التأمين", en: "Insurance" },
  sales: { ar: "المبيعات", en: "Sales" },
  invoices: { ar: "الفواتير", en: "Invoices" },
  quotes: { ar: "عروض الأسعار", en: "Quotes" },
  "credit-notes": { ar: "إشعارات دائنة", en: "Credit Notes" },
  returns: { ar: "المرتجعات", en: "Returns" },
  recurring: { ar: "الفواتير الدورية", en: "Recurring" },
  payments: { ar: "المدفوعات", en: "Payments" },
  settings: { ar: "الإعدادات", en: "Settings" },
  accounting: { ar: "المحاسبة", en: "Accounting" },
  expenses: { ar: "المصاريف", en: "Expenses" },
  receipts: { ar: "السندات", en: "Receipts" },
  cashbox: { ar: "الصندوق", en: "Cashbox" },
  topup: { ar: "إيداع", en: "Top up" },
  inventory: { ar: "المخزون", en: "Inventory" },
  "purchase-invoices": { ar: "فواتير المشتريات", en: "Purchase Invoices" },
  suppliers: { ar: "الموردون", en: "Suppliers" },
  "supplier-payments": { ar: "مدفوعات الموردين", en: "Supplier Payments" },
  "purchase-returns": { ar: "مرتجع المشتريات", en: "Purchase Returns" },
  "supplier-balance": { ar: "رصيد الموردين", en: "Supplier Balance" },
  movements: { ar: "حركات المخزون", en: "Stock Movements" },
  staff: { ar: "الموظفون", en: "Staff" },
  profile: { ar: "الملف الشخصي", en: "Profile" },
  users: { ar: "المستخدمون", en: "Users" },
  vehicles: { ar: "السيارات", en: "Vehicles" },
  customers: { ar: "العملاء", en: "Customers" },
  tasks: { ar: "المهام اليومية", en: "Daily Tasks" },
  reports: { ar: "التقارير", en: "Reports" },
  "print-templates": { ar: "قوالب الطباعة", en: "Print Templates" },
  "expense-categories": { ar: "تصنيفات المصاريف", en: "Expense Categories" },
  "roles-permissions": { ar: "الأدوار والصلاحيات", en: "Roles & Permissions" },
  "quick-actions": { ar: "الإجراءات السريعة", en: "Quick Actions" },
  trash: { ar: "المهملات", en: "Trash" },
  "audit-log": { ar: "سجل التدقيق", en: "Audit Log" },
  list: { ar: "القائمة", en: "List" },
  pipeline: { ar: "Pipeline", en: "Pipeline" },
  alerts: { ar: "التنبيهات", en: "Alerts" },
  companies: { ar: "الشركات", en: "Companies" },
  documents: { ar: "أرشيف المستندات", en: "Documents" },
  archive: { ar: "الأرشيف", en: "Archive" },
  new: { ar: "جديد", en: "New" },
  edit: { ar: "تعديل", en: "Edit" },
  report: { ar: "تقرير", en: "Report" },
  variants: { ar: "النسخ", en: "Variants" },
};

function labelFor(seg: string, lang: "ar" | "en"): string {
  if (LABELS[seg]) return LABELS[seg][lang];
  // معرّفات عددية أو UUID — اعرضها بصيغة #...
  if (/^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg)) return `#${seg.slice(0, 8)}`;
  return decodeURIComponent(seg);
}

export default function AutoBreadcrumb() {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const lang: "ar" | "en" = i18n.language?.startsWith("ar") ? "ar" : "en";

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

  // لا نعرض الشريط في الجذر (الصفحة الرئيسية)
  if (segments.length === 0) return null;

  const Sep = isRtl ? ChevronLeft : ChevronRight;
  const homeLabel = lang === "ar" ? "الرئيسية" : "Home";

  return (
    <nav
      aria-label="breadcrumb"
      className="px-3 md:px-6 lg:px-8 py-2 text-xs md:text-sm text-muted-foreground border-b border-border/50 bg-background/50"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link
            to="/"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Home size={14} />
            <span className="hidden sm:inline">{homeLabel}</span>
          </Link>
        </li>
        {segments.map((seg, idx) => {
          const href = "/" + segments.slice(0, idx + 1).join("/");
          const isLast = idx === segments.length - 1;
          return (
            <li key={href} className="inline-flex items-center gap-1.5">
              <Sep size={12} className="opacity-60" />
              {isLast ? (
                <span className="font-medium text-foreground">{labelFor(seg, lang)}</span>
              ) : (
                <Link to={href} className="hover:text-foreground transition-colors">
                  {labelFor(seg, lang)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
