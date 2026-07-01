import { Fragment, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BarChart3, TrendingUp, Package, Users, BookOpen, Building2, Car, Receipt, FileBarChart,
  ShoppingCart, ArrowDownUp, ClipboardList, BookCheck, AlertTriangle,
  Search, ChevronDown, ChevronLeft, X, CalendarRange, ExternalLink, Wrench,
} from "lucide-react";
import ReportToolbar from "@/components/reports/ReportToolbar";
import ReportsKpiBar from "@/components/reports/ReportsKpiBar";
import {
  rangeShortcut, getReportFacets,
  buildSalesReport, buildPurchasesReport, buildProfitLossReport, buildVatReport,
  buildPerVehicleProfitReport, buildInventoryReport, buildMovementsReport,
  buildWorkOrdersReport, buildCustomersReport, buildSuppliersReport,
  buildJournalReport, buildTrialBalance, getVehicleProfitDetail,
  buildPartsProfitReport,
  type ReportFilters,
} from "@/lib/reportsEngine";
import type { ReportColumn, ReportExportPayload } from "@/lib/reportExporters";
import { usePersistedState } from "@/hooks/usePersistedState";

const fmt = (n: number) =>
  (n || 0).toLocaleString("ar-OM", { maximumFractionDigits: 2 }) + " ر.ع";

type GroupKey = "financial" | "operational" | "relations" | "accounting";

type ReportKey =
  | "sales" | "purchases" | "pl" | "vat" | "perVehicle" | "partsProfit"
  | "inventory" | "movements" | "workOrders"
  | "customers" | "suppliers"
  | "journal" | "trialBalance";

interface ReportCardDef {
  key: ReportKey;
  title: string;
  description: string;
  icon: any;
  variant: "gold" | "info" | "success" | "warning" | "destructive";
  group: GroupKey;
}

const REPORT_DEFS: ReportCardDef[] = [
  // مالية
  { key: "sales", title: "تقرير المبيعات والفواتير", description: "إيرادات الفترة، المدفوع والمعلق", icon: ShoppingCart, variant: "success", group: "financial" },
  { key: "purchases", title: "تقرير المشتريات والموردين", description: "فواتير الشراء والمدفوعات", icon: Building2, variant: "info", group: "financial" },
  { key: "pl", title: "الأرباح والخسائر (P&L)", description: "إيرادات - تكاليف - مصروفات = صافي الربح", icon: TrendingUp, variant: "gold", group: "financial" },
  { key: "vat", title: "ضريبة القيمة المضافة (VAT)", description: "الضريبة المخرجة والمدخلة (5%)", icon: Receipt, variant: "warning", group: "financial" },
  { key: "perVehicle", title: "ربح/خسارة لكل سيارة", description: "تحليل تفصيلي لربحية كل أمر شغل", icon: Car, variant: "destructive", group: "financial" },
  { key: "partsProfit", title: "ربح قطع الغيار", description: "هامش الربح من بيع قطع الغيار للعملاء", icon: Package, variant: "success", group: "financial" },

  // تشغيلية
  { key: "inventory", title: "قيمة المخزون والتنبيهات", description: "قيمة المخزون والأصناف الناقصة", icon: Package, variant: "info", group: "operational" },
  { key: "movements", title: "حركات المخزون (IN/OUT)", description: "إذن إدخال وإخراج وتحويل", icon: ArrowDownUp, variant: "gold", group: "operational" },
  { key: "workOrders", title: "أوامر الشغل والصيانة", description: "حالات أوامر العمل والتكاليف", icon: ClipboardList, variant: "success", group: "operational" },

  // علاقات
  { key: "customers", title: "كشف حساب العملاء", description: "الأرصدة والودائع والفواتير المعلقة", icon: Users, variant: "info", group: "relations" },
  { key: "suppliers", title: "كشف حساب الموردين", description: "إجمالي المشتريات والمدفوع والمتبقي", icon: Building2, variant: "warning", group: "relations" },

  // محاسبية
  { key: "journal", title: "دفتر اليومية", description: "كل القيود المحاسبية المرحّلة", icon: BookOpen, variant: "gold", group: "accounting" },
  { key: "trialBalance", title: "ميزان المراجعة", description: "أرصدة كل الحسابات (مدين/دائن)", icon: BookCheck, variant: "success", group: "accounting" },
];

const DEFAULT_FILTERS: ReportFilters = { range: rangeShortcut("month") };

export default function Reports() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl = i18n.dir() === "rtl";
  // التبويب النشط محفوظ
  const [activeTab, setActiveTab] = usePersistedState<GroupKey>("reports.activeTab", "financial");

  // فلاتر منفصلة لكل تبويب — تبقى عند الرجوع
  const [tabFilters, setTabFilters] = usePersistedState<Record<GroupKey, ReportFilters>>(
    "reports.filtersByTab",
    {
      financial: DEFAULT_FILTERS,
      operational: DEFAULT_FILTERS,
      relations: DEFAULT_FILTERS,
      accounting: DEFAULT_FILTERS,
    },
  );

  const filters = tabFilters[activeTab] || DEFAULT_FILTERS;
  const setFilters = (f: ReportFilters) =>
    setTabFilters({ ...tabFilters, [activeTab]: f });

  const [activeReport, setActiveReport] = useState<ReportKey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const facets = useMemo(() => getReportFacets(), []);

  const rangeLabel = `من ${filters.range.from} إلى ${filters.range.to}`;

  // ===== بناء بيانات التقرير النشط =====
  const activePayload = useMemo<ReportExportPayload | null>(() => {
    if (!activeReport) return null;
    const def = REPORT_DEFS.find((d) => d.key === activeReport)!;

    if (activeReport === "sales") {
      const r = buildSalesReport(filters);
      const columns: ReportColumn[] = [
        { key: "orderId", label: "رقم الأمر" },
        { key: "date", label: "التاريخ" },
        { key: "customer", label: "العميل" },
        { key: "plate", label: "اللوحة" },
        { key: "status", label: "الحالة" },
        { key: "total", label: "المبلغ (ر.ع)" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows: r.rows,
        summary: [
          { label: "عدد الفواتير", value: String(r.count) },
          { label: "إجمالي الإيرادات", value: fmt(r.totalRevenue) },
          { label: "المحصّل (مدفوع)", value: fmt(r.paidRevenue) },
          { label: "المعلّق", value: fmt(r.pendingRevenue) },
          { label: "ضريبة القيمة المضافة المحصّلة", value: fmt(r.vatCollected) },
        ],
      };
    }

    if (activeReport === "purchases") {
      const r = buildPurchasesReport(filters);
      const columns: ReportColumn[] = [
        { key: "invoiceId", label: "رقم الفاتورة" },
        { key: "date", label: "التاريخ" },
        { key: "supplier", label: "المورد" },
        { key: "status", label: "الحالة" },
        { key: "total", label: "الإجمالي" },
        { key: "paid", label: "المدفوع" },
        { key: "remaining", label: "المتبقي" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows: r.rows,
        summary: [
          { label: "عدد الفواتير", value: String(r.count) },
          { label: "إجمالي المشتريات", value: fmt(r.totalPurchases) },
          { label: "إجمالي المدفوع", value: fmt(r.totalPaid) },
          { label: "إجمالي المتبقي", value: fmt(r.totalRemaining) },
          { label: "ضريبة القيمة المضافة المدفوعة", value: fmt(r.vatPaid) },
        ],
      };
    }

    if (activeReport === "pl") {
      const r = buildProfitLossReport(filters);
      const columns: ReportColumn[] = [
        { key: "label", label: "البند" },
        { key: "value", label: "المبلغ (ر.ع)" },
      ];
      const rows = [
        { label: "إجمالي الإيرادات", value: fmt(r.revenue) },
        { label: "تكلفة قطع الغيار (COGS)", value: fmt(r.cogs) },
        { label: "تكلفة العمالة", value: fmt(r.laborCost) },
        { label: "المصروفات التشغيلية", value: fmt(r.expenses) },
        { label: "مجمل الربح", value: fmt(r.grossProfit) },
        { label: "صافي الربح", value: fmt(r.netProfit) },
        { label: "هامش الربح", value: r.margin.toFixed(2) + " %" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "صافي الربح", value: fmt(r.netProfit) },
          { label: "VAT مستحق للهيئة", value: fmt(r.vatDue) },
        ],
      };
    }

    if (activeReport === "vat") {
      const r = buildVatReport(filters);
      const columns: ReportColumn[] = [
        { key: "label", label: "البند" },
        { key: "value", label: "المبلغ (ر.ع)" },
      ];
      const rows = [
        { label: "وعاء المبيعات (قبل الضريبة)", value: fmt(r.salesBase) },
        { label: "ضريبة المخرجات (5%)", value: fmt(r.outputVat) },
        { label: "وعاء المشتريات (قبل الضريبة)", value: fmt(r.purchasesBase) },
        { label: "ضريبة المدخلات (5%)", value: fmt(r.inputVat) },
        { label: "صافي الضريبة المستحقة", value: fmt(r.netDue) },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [{ label: "صافي ضريبة القيمة المضافة المستحقة للهيئة", value: fmt(r.netDue) }],
      };
    }

    if (activeReport === "perVehicle") {
      const r = buildPerVehicleProfitReport(filters);
      const columns: ReportColumn[] = [
        { key: "orderId", label: "رقم الأمر" },
        { key: "date", label: "التاريخ" },
        { key: "plate", label: "اللوحة" },
        { key: "customer", label: "العميل" },
        { key: "vehicleType", label: "السيارة" },
        { key: "revenue", label: "الإيراد" },
        { key: "partsCost", label: "قطع الغيار" },
        { key: "laborCost", label: "العمالة" },
        { key: "extraExpenses", label: "مصاريف إضافية" },
        { key: "externalVouchers", label: "سندات صرف" },
        { key: "totalCost", label: "إجمالي التكلفة" },
        { key: "profit", label: "الربح" },
        { key: "margin", label: "الهامش %", format: (v) => (v || 0).toFixed(2) + " %" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows: r.rows,
        summary: [
          { label: "إجمالي الإيرادات", value: fmt(r.totals.revenue) },
          { label: "إجمالي التكاليف", value: fmt(r.totals.cost) },
          { label: "صافي الربح", value: fmt(r.totals.profit) },
          { label: "الهامش الإجمالي", value: r.totals.margin.toFixed(2) + " %" },
        ],
      };
    }

    if (activeReport === "partsProfit") {
      const r = buildPartsProfitReport(filters);
      const columns: ReportColumn[] = [
        { key: "voucherNumber", label: "رقم السند" },
        { key: "date", label: "التاريخ" },
        { key: "workOrderId", label: "أمر العمل" },
        { key: "partName", label: "القطعة" },
        { key: "partNumber", label: "رقم القطعة" },
        { key: "qty", label: "الكمية" },
        { key: "buyPrice", label: "سعر الشراء", format: (v) => (v || 0).toFixed(3) },
        { key: "sellPrice", label: "سعر البيع", format: (v) => (v || 0).toFixed(3) },
        { key: "totalCost", label: "إجمالي التكلفة", format: (v) => (v || 0).toFixed(3) },
        { key: "totalRevenue", label: "إجمالي البيع", format: (v) => (v || 0).toFixed(3) },
        { key: "profit", label: "الربح", format: (v) => (v || 0).toFixed(3) },
        { key: "marginPct", label: "الهامش %", format: (v) => (v || 0).toFixed(1) + " %" },
        { key: "supplier", label: "المورد" },
        { key: "supplierTaxNumber", label: "الرقم الضريبي" },
        { key: "supplierInvoiceNumber", label: "فاتورة المورد" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows: r.rows,
        summary: [
          { label: "عدد البنود", value: String(r.totals.items) },
          { label: "إجمالي الكمية المباعة", value: String(r.totals.qty) },
          { label: "إجمالي تكلفة الشراء", value: fmt(r.totals.totalCost) },
          { label: "إجمالي إيراد البيع", value: fmt(r.totals.totalRevenue) },
          { label: "صافي الربح من القطع", value: fmt(r.totals.totalProfit) },
          { label: "متوسط هامش الربح", value: r.totals.avgMarginPct.toFixed(1) + " %" },
        ],
      };
    }

    if (activeReport === "inventory") {
      const r = buildInventoryReport();
      const columns: ReportColumn[] = [
        { key: "partId", label: "الكود" },
        { key: "name", label: "الصنف" },
        { key: "partNumber", label: "رقم القطعة" },
        { key: "category", label: "التصنيف" },
        { key: "stock", label: "المتاح" },
        { key: "minStock", label: "الحد الأدنى" },
        { key: "buyPrice", label: "سعر الشراء" },
        { key: "sellPrice", label: "سعر البيع" },
        { key: "inventoryValue", label: "قيمة المخزون" },
        { key: "status", label: "الحالة", format: (v) => v === "out" ? "نافد" : v === "low" ? "منخفض" : "متوفر" },
      ];
      return {
        title: def.title, rangeLabel: "حالة آنية", columns, rows: r.rows,
        summary: [
          { label: "عدد الأصناف", value: String(r.totals.items) },
          { label: "قيمة المخزون الإجمالية", value: fmt(r.totals.totalValue) },
          { label: "أصناف منخفضة المخزون", value: String(r.totals.lowStock) },
          { label: "أصناف نافدة", value: String(r.totals.outOfStock) },
        ],
      };
    }

    if (activeReport === "movements") {
      const rows = buildMovementsReport(filters);
      const columns: ReportColumn[] = [
        { key: "id", label: "رقم الحركة" },
        { key: "date", label: "التاريخ" },
        { key: "type", label: "النوع", format: (v) => v === "IN" ? "إدخال" : v === "OUT" ? "إخراج" : "تحويل" },
        { key: "reference", label: "المرجع" },
        { key: "reason", label: "السبب" },
        { key: "itemsCount", label: "عدد الأصناف" },
        { key: "totalQty", label: "إجمالي الكمية" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "عدد الحركات", value: String(rows.length) },
          { label: "إدخال", value: String(rows.filter((r) => r.type === "IN").length) },
          { label: "إخراج", value: String(rows.filter((r) => r.type === "OUT").length) },
          { label: "تحويل", value: String(rows.filter((r) => r.type === "TRANSFER").length) },
        ],
      };
    }

    if (activeReport === "workOrders") {
      const rows = buildWorkOrdersReport(filters);
      const columns: ReportColumn[] = [
        { key: "id", label: "رقم الأمر" },
        { key: "date", label: "التاريخ" },
        { key: "customer", label: "العميل" },
        { key: "plate", label: "اللوحة" },
        { key: "serviceType", label: "نوع الخدمة" },
        { key: "technician", label: "الفني" },
        { key: "status", label: "الحالة" },
        { key: "totalCost", label: "التكلفة" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "عدد أوامر الشغل", value: String(rows.length) },
          { label: "إجمالي التكاليف", value: fmt(rows.reduce((s, r) => s + r.totalCost, 0)) },
        ],
      };
    }

    if (activeReport === "customers") {
      const rows = buildCustomersReport(filters);
      const columns: ReportColumn[] = [
        { key: "name", label: "العميل" },
        { key: "phone", label: "الجوال" },
        { key: "visits", label: "زيارات" },
        { key: "totalSpent", label: "إجمالي الإنفاق" },
        { key: "pending", label: "فواتير معلقة" },
        { key: "depositBalance", label: "رصيد الدفعات" },
        { key: "lastVisit", label: "آخر زيارة" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "عدد العملاء", value: String(rows.length) },
          { label: "إجمالي الإيرادات", value: fmt(rows.reduce((s, r) => s + r.totalSpent, 0)) },
          { label: "إجمالي المعلق", value: fmt(rows.reduce((s, r) => s + r.pending, 0)) },
        ],
      };
    }

    if (activeReport === "suppliers") {
      const rows = buildSuppliersReport(filters);
      const columns: ReportColumn[] = [
        { key: "name", label: "المورد" },
        { key: "phone", label: "الجوال" },
        { key: "totalPurchases", label: "إجمالي المشتريات" },
        { key: "totalPaid", label: "المدفوع" },
        { key: "balance", label: "الرصيد المتبقي" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "عدد الموردين", value: String(rows.length) },
          { label: "إجمالي المشتريات", value: fmt(rows.reduce((s, r) => s + r.totalPurchases, 0)) },
          { label: "إجمالي الأرصدة المستحقة", value: fmt(rows.reduce((s, r) => s + r.balance, 0)) },
        ],
      };
    }

    if (activeReport === "journal") {
      const rows = buildJournalReport(filters);
      const columns: ReportColumn[] = [
        { key: "id", label: "رقم القيد" },
        { key: "date", label: "التاريخ" },
        { key: "source", label: "المصدر" },
        { key: "sourceId", label: "المرجع" },
        { key: "debit", label: "مدين" },
        { key: "credit", label: "دائن" },
        { key: "amount", label: "المبلغ" },
        { key: "description", label: "البيان" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows,
        summary: [
          { label: "عدد القيود", value: String(rows.length) },
          { label: "إجمالي الحركات", value: fmt(rows.reduce((s, r) => s + r.amount, 0)) },
        ],
      };
    }

    if (activeReport === "trialBalance") {
      const r = buildTrialBalance(filters);
      const columns: ReportColumn[] = [
        { key: "account", label: "الحساب" },
        { key: "debit", label: "مدين" },
        { key: "credit", label: "دائن" },
        { key: "balance", label: "الرصيد" },
      ];
      return {
        title: def.title, rangeLabel, columns, rows: r.rows,
        summary: [
          { label: "إجمالي المدين", value: fmt(r.totals.debit) },
          { label: "إجمالي الدائن", value: fmt(r.totals.credit) },
          { label: "الفرق", value: fmt(r.totals.debit - r.totals.credit) },
        ],
      };
    }

    return null;
  }, [activeReport, filters, rangeLabel]);

  // ===== بحث لحظي داخل صفوف التقرير النشط =====
  const filteredRows = useMemo(() => {
    if (!activePayload) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activePayload.rows;
    return activePayload.rows.filter((row) =>
      Object.values(row).some((v) => {
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      }),
    );
  }, [activePayload, searchQuery]);

  // payload بعد البحث (للتصدير ينعكس البحث أيضاً)
  const exportPayload = useMemo<ReportExportPayload | null>(() => {
    if (!activePayload) return null;
    return { ...activePayload, rows: filteredRows };
  }, [activePayload, filteredRows]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectReport = (key: ReportKey) => {
    setActiveReport(key);
    setSearchQuery("");
    setExpandedRows(new Set());
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Hero */}
      <div className={`bg-gradient-to-${isRtl ? "l" : "r"} from-primary/10 via-card to-card border border-border rounded-xl p-6 shadow-card`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
              <FileBarChart size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t("reports.title")}</h1>
              <p className="text-sm text-muted-foreground">
                {isRtl
                  ? "تقارير احترافية متكاملة تربط جميع وحدات النظام: المبيعات • المشتريات • المخزون • المحاسبة"
                  : "Integrated professional reports connecting all system modules: Sales • Purchases • Inventory • Accounting"}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {filters.range.from} → {filters.range.to}
          </Badge>
        </div>
      </div>

      {/* ===== التقارير المستقلة (صفحات كاملة) ===== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <ExternalLink size={16} className="text-primary" />
              {isRtl ? "التقارير الاحترافية المستقلة" : "Standalone Professional Reports"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isRtl ? "كل تقرير يفتح في صفحة كاملة بتصميم احترافي وتصدير PDF أفقي" : "Each report opens in a full dedicated page with landscape PDF export"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => smartBack(navigate, "/reports/center")} className="gap-1">
            <FileBarChart size={14} /> {isRtl ? "كل المستخرجات" : "All Exports"}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              key: "monthly",
              title: isRtl ? "التقرير الشهري الشامل" : "Monthly Comprehensive Report",
              desc: isRtl ? "إيرادات + مصروفات + رواتب + إيجار وتكاليف ثابتة + صافي الربح" : "Revenue + expenses + payroll + fixed costs + net profit",
              icon: CalendarRange,
              route: "/reports/monthly",
              badge: isRtl ? "جديد ⭐" : "New ⭐",
              gradient: "from-primary/15 to-primary/5 border-primary/40",
              iconColor: "bg-primary/20 text-primary",
            },
            {
              key: "wo-statement",
              title: isRtl ? "تقرير تكلفة وربحية أوامر العمل" : "Work Orders Cost & Profit Statement",
              desc: isRtl ? "إيرادات، تكلفة قطع غيار، تكلفة عمالة، مصروفات أخرى، صافي ربح ومصدر التكلفة النهائي" : "Revenue, spare parts cost, labour cost, other expenses, net profit and final cost source",
              icon: Wrench,
              route: "/reports/work-orders-statement",
              badge: isRtl ? "PDF أفقي" : "Landscape PDF",
              gradient: "from-success/15 to-success/5 border-success/40",
              iconColor: "bg-success/20 text-success",
            },
            {
              key: "completed-without-invoice",
              title: isRtl ? "المسلّمة بانتظار LPO / فاتورة" : "Delivered Waiting LPO / Invoice",
              desc: isRtl ? "تمييز أوامر التأمين المسلّمة بانتظار LPO أو فاتورة التأمين عن أوامر النقد التي تحتاج فاتورة مبيعات" : "Separate delivered insurance work orders waiting for LPO/insurance invoice from cash jobs that need a sales invoice",
              icon: AlertTriangle,
              route: "/reports/completed-without-invoice",
              badge: isRtl ? "رقابة مالية" : "Control",
              gradient: "from-warning/15 to-warning/5 border-warning/40",
              iconColor: "bg-warning/20 text-warning",
            },
            {
              key: "overdue-invoices",
              title: isRtl ? "الفواتير المتأخرة" : "Overdue Invoices",
              desc: isRtl ? "عرض الفواتير المستحقة مع تذكير دفع يمنع التكرار خلال 24 ساعة" : "View overdue invoices and prepare payment reminders without duplicate sends",
              icon: Receipt,
              route: "/reports/overdue-invoices",
              badge: isRtl ? "تذكير دفع" : "Reminder",
              gradient: "from-destructive/15 to-destructive/5 border-destructive/40",
              iconColor: "bg-destructive/20 text-destructive",
            },
            {
              key: "parts-profit",
              title: isRtl ? "ربح قطع الغيار التفصيلي" : "Parts Profit Detailed",
              desc: isRtl ? "كل قطعة: سعر شراء، سعر بيع، الربح، السيارة" : "Per part: buy/sell price, profit, vehicle",
              icon: TrendingUp,
              route: "/reports/parts-profit",
              badge: isRtl ? "PDF أفقي" : "Landscape PDF",
              gradient: "from-info/15 to-info/5 border-info/40",
              iconColor: "bg-info/20 text-info",
            },
            {
              key: "executive",
              title: isRtl ? "لوحة تنفيذية مباشرة" : "Live Executive Dashboard",
              desc: isRtl ? "KPIs محدّثة لحظياً: مبيعات، أرباح، ذمم، VAT" : "Live KPIs: sales, profit, AR, VAT",
              icon: TrendingUp,
              route: "/dashboard/executive",
              badge: isRtl ? "مباشر" : "Live",
              gradient: "from-warning/15 to-warning/5 border-warning/40",
              iconColor: "bg-warning/20 text-warning",
            },
            {
              key: "cloud-vat",
              title: isRtl ? "تقارير سحابية + إقرار VAT" : "Cloud Reports + VAT Filing",
              desc: isRtl ? "تقارير محاسبية متقدمة وإقرار رسمي PDF/Excel" : "Advanced cloud reports & official VAT filing",
              icon: FileBarChart,
              route: "/reports/cloud-advanced",
              badge: isRtl ? "VAT رسمي" : "Official VAT",
              gradient: "from-info/15 to-info/5 border-info/40",
              iconColor: "bg-info/20 text-info",
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card
                key={c.key}
                onClick={() => navigate(c.route)}
                className={`p-5 cursor-pointer transition-all hover:shadow-gold hover:scale-[1.02] bg-gradient-to-br ${c.gradient}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${c.iconColor}`}>
                    <Icon size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{c.title}</h3>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{c.badge}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.desc}</p>
                    <div className="flex items-center gap-1 mt-2 text-[11px] text-primary font-medium">
                      <ExternalLink size={11} /> {isRtl ? "فتح الصفحة الكاملة" : "Open full page"}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* شريط KPI الفوري */}
      <ReportsKpiBar filters={filters} />


      {/* التبويبات */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as GroupKey); setActiveReport(null); }} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="financial"><BarChart3 size={14} className="ml-1" /> {isRtl ? "مالية" : "Financial"}</TabsTrigger>
          <TabsTrigger value="operational"><Package size={14} className="ml-1" /> {isRtl ? "تشغيلية" : "Operational"}</TabsTrigger>
          <TabsTrigger value="relations"><Users size={14} className="ml-1" /> {isRtl ? "علاقات" : "Relations"}</TabsTrigger>
          <TabsTrigger value="accounting"><BookOpen size={14} className="ml-1" /> {isRtl ? "محاسبية" : "Accounting"}</TabsTrigger>
        </TabsList>

        {(["financial", "operational", "relations", "accounting"] as const).map((group) => (
          <TabsContent key={group} value={group} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {REPORT_DEFS.filter((r) => r.group === group).map((def) => {
                const Icon = def.icon;
                const isActive = activeReport === def.key;
                return (
                  <Card
                    key={def.key}
                    onClick={() => handleSelectReport(def.key)}
                    className={`p-5 cursor-pointer transition-all hover:shadow-gold hover:scale-[1.02] ${
                      isActive ? "ring-2 ring-primary shadow-gold" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0
                        ${def.variant === "gold" ? "bg-primary/15 text-primary" : ""}
                        ${def.variant === "success" ? "bg-success/15 text-success" : ""}
                        ${def.variant === "info" ? "bg-info/15 text-info" : ""}
                        ${def.variant === "warning" ? "bg-warning/15 text-warning" : ""}
                        ${def.variant === "destructive" ? "bg-destructive/15 text-destructive" : ""}
                      `}>
                        <Icon size={22} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm text-foreground">{def.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* عرض التقرير النشط */}
            {activeReport && activePayload && exportPayload && REPORT_DEFS.find((d) => d.key === activeReport)?.group === group && (
              <div className="space-y-4">
                <ReportToolbar
                  filters={filters}
                  setFilters={setFilters}
                  facets={facets}
                  payload={exportPayload}
                  showCustomer={["sales", "perVehicle", "workOrders", "customers"].includes(activeReport)}
                  showSupplier={["purchases", "suppliers"].includes(activeReport)}
                  showStatus={["sales", "perVehicle", "workOrders"].includes(activeReport)}
                  showTechnician={["perVehicle", "workOrders"].includes(activeReport)}
                />

                <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
                  <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{activePayload.title}</h3>
                      {activePayload.rangeLabel && (
                        <p className="text-xs text-muted-foreground mt-0.5">{activePayload.rangeLabel}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* بحث سريع */}
                      <div className="relative">
                        <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="بحث (فاتورة/أمر/VIN/عميل)..."
                          className="h-9 w-64 pr-7 pl-7 text-sm"
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery("")}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <Badge variant="secondary">
                        {filteredRows.length}
                        {searchQuery && ` / ${activePayload.rows.length}`} سجل
                      </Badge>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/30">
                        <tr>
                          {activeReport === "perVehicle" && (
                            <th className="w-10 px-2 py-3"></th>
                          )}
                          {activePayload.columns.map((c) => (
                            <th key={c.key} className="text-right px-4 py-3 font-semibold text-xs text-muted-foreground whitespace-nowrap">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.length === 0 ? (
                          <tr>
                            <td colSpan={activePayload.columns.length + (activeReport === "perVehicle" ? 1 : 0)} className="text-center py-12">
                              <AlertTriangle className="mx-auto text-muted-foreground mb-2" size={32} />
                              <p className="text-sm text-muted-foreground">
                                {searchQuery ? "لا توجد نتائج مطابقة للبحث" : "لا توجد بيانات في هذه الفترة"}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          filteredRows.map((r, idx) => {
                            const rowKey = (r as any).orderId || (r as any).id || String(idx);
                            const isExpanded = expandedRows.has(rowKey);
                            const isPerVehicle = activeReport === "perVehicle";
                            return (
                              <Fragment key={`r-${rowKey}-${idx}`}>
                                <tr className="border-t border-border hover:bg-secondary/20 transition-colors">
                                  {isPerVehicle && (
                                    <td className="w-10 px-2 py-2.5 text-center">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => toggleRow(rowKey)}
                                        aria-label="توسيع التفاصيل"
                                      >
                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                                      </Button>
                                    </td>
                                  )}
                                  {activePayload.columns.map((c) => {
                                    const v = r[c.key];
                                    const formatted = c.format
                                      ? c.format(v)
                                      : typeof v === "number"
                                      ? v.toLocaleString("ar-OM", { maximumFractionDigits: 2 })
                                      : v ?? "—";
                                    return (
                                      <td key={c.key} className="px-4 py-2.5 text-right whitespace-nowrap">
                                        {formatted}
                                      </td>
                                    );
                                  })}
                                </tr>
                                {isPerVehicle && isExpanded && (
                                  <tr className="bg-secondary/10 border-t border-border">
                                    <td colSpan={activePayload.columns.length + 1} className="p-0">
                                      <VehicleProfitDetailsRow orderId={(r as any).orderId} />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {activePayload.summary && activePayload.summary.length > 0 && (
                    <div className="p-4 border-t border-border bg-secondary/10">
                      <h4 className="text-sm font-semibold mb-3 text-foreground">ملخص التقرير</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {activePayload.summary.map((s, i) => (
                          <div key={i} className="bg-card border border-border rounded-lg p-3">
                            <p className="text-[11px] text-muted-foreground">{s.label}</p>
                            <p className="text-sm font-bold text-foreground mt-1">{s.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ============== مكون تفاصيل ربح/خسارة سيارة (سطر قابل للتوسعة) ==============
function VehicleProfitDetailsRow({ orderId }: { orderId: string }) {
  const detail = useMemo(() => getVehicleProfitDetail(orderId), [orderId]);
  const totalServices = detail.services.reduce((s, x) => s + x.amount, 0);
  const totalParts = detail.parts.reduce((s, x) => s + x.total, 0);
  const totalInternal = detail.internalExpenses.reduce((s, x) => s + x.amount, 0);
  const totalExternal = detail.externalVouchers.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* الخدمات */}
      <Card className="p-3">
        <h5 className="text-sm font-bold mb-2 text-success flex items-center gap-2">
          <ClipboardList size={14} /> الخدمات والعمالة
          <span className="ms-auto text-xs text-muted-foreground">{fmt(totalServices)}</span>
        </h5>
        {detail.services.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد خدمات مسجلة</p>
        ) : (
          <ul className="text-xs space-y-1">
            {detail.services.map((s, i) => (
              <li key={i} className="flex justify-between border-b border-border/50 py-1">
                <span>{s.label}</span>
                <span className="font-semibold">{fmt(s.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* قطع الغيار */}
      <Card className="p-3">
        <h5 className="text-sm font-bold mb-2 text-info flex items-center gap-2">
          <Package size={14} /> قطع الغيار
          <span className="ms-auto text-xs text-muted-foreground">{fmt(totalParts)}</span>
        </h5>
        {detail.parts.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد قطع غيار مسجلة</p>
        ) : (
          <ul className="text-xs space-y-1">
            {detail.parts.map((p, i) => (
              <li key={i} className="flex justify-between border-b border-border/50 py-1">
                <span>{p.label}</span>
                <span className="font-semibold">{fmt(p.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* مصاريف داخلية */}
      <Card className="p-3">
        <h5 className="text-sm font-bold mb-2 text-warning flex items-center gap-2">
          <Receipt size={14} /> مصاريف إضافية داخلية
          <span className="ms-auto text-xs text-muted-foreground">{fmt(totalInternal)}</span>
        </h5>
        {detail.internalExpenses.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد مصاريف داخلية</p>
        ) : (
          <ul className="text-xs space-y-1">
            {detail.internalExpenses.map((e, i) => (
              <li key={i} className="flex justify-between border-b border-border/50 py-1">
                <span>{e.label}{e.notes ? ` — ${e.notes}` : ""}</span>
                <span className="font-semibold">{fmt(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* سندات صرف خارجية */}
      <Card className="p-3">
        <h5 className="text-sm font-bold mb-2 text-destructive flex items-center gap-2">
          <Receipt size={14} /> سندات صرف مرتبطة
          <span className="ms-auto text-xs text-muted-foreground">{fmt(totalExternal)}</span>
        </h5>
        {detail.externalVouchers.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد سندات صرف خارجية</p>
        ) : (
          <ul className="text-xs space-y-1">
            {detail.externalVouchers.map((v, i) => (
              <li key={i} className="flex justify-between border-b border-border/50 py-1 gap-2">
                <span className="truncate">
                  {v.voucherNumber} — {v.category || "—"}
                  {v.description ? ` (${v.description})` : ""}
                </span>
                <span className="font-semibold whitespace-nowrap">{fmt(v.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
