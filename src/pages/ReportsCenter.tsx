import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  FileSpreadsheet,
  Filter,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReportDataPanel from "@/components/reports/ReportDataPanel";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";
import { formatOMR } from "@/lib/money";
import { REPORT_CATEGORIES, REPORT_DEFINITIONS } from "@/lib/reports-center/reportDefinitions";
import {
  canOpenReport,
  canOpenReportsCenter,
  canUseReportPermission,
} from "@/lib/reports-center/reportPermissions";
import { REPORT_ACCOUNTING_RULES } from "@/lib/reports-center/reportCalculationRules";
import { fetchReportCenterSummary } from "@/lib/reports-center/reportCenterService";
import {
  createReportSavedView,
  deleteReportSavedView,
  fetchReportSavedViews,
} from "@/lib/reports-center/savedViewsService";
import {
  activeReportFilterEntries,
  parseReportCenterFilters,
  setReportCenterParam,
} from "@/lib/reports-center/reportCenterUrlState";
import type { ReportBusinessType, ReportCategory, ReportDefinition } from "@/lib/reports-center/reportTypes";

const categoryIcons: Partial<Record<ReportCategory, typeof FileBarChart>> = {
  overview: BarChart3,
  insurance: ShieldCheck,
  cash: Wallet,
  combined: FileSpreadsheet,
  operations: Wrench,
  invoices: FileBarChart,
  expenses: Wallet,
  profitability: BarChart3,
  performance: CalendarDays,
};

const FILTER_LABELS: Record<string, { ar: string; en: string }> = {
  businessType: { ar: "نوع العمل", en: "Business Type" },
  from: { ar: "من", en: "From" },
  to: { ar: "إلى", en: "To" },
  q: { ar: "البحث", en: "Search" },
  plate: { ar: "اللوحة", en: "Plate" },
  vin: { ar: "رقم الهيكل", en: "VIN" },
  claim: { ar: "المطالبة", en: "Claim" },
  workOrder: { ar: "أمر العمل", en: "Work Order" },
  invoice: { ar: "الفاتورة", en: "Invoice" },
  claimStatus: { ar: "حالة المطالبة", en: "Claim Status" },
  workOrderStatus: { ar: "حالة أمر العمل", en: "Work Order Status" },
  invoiceStatus: { ar: "حالة الفاتورة", en: "Invoice Status" },
  collectionStatus: { ar: "حالة التحصيل", en: "Collection Status" },
  expenseCategory: { ar: "تصنيف المصروف", en: "Expense Category" },
  paymentMethod: { ar: "طريقة الدفع", en: "Payment Method" },
  workshopLocation: { ar: "موقع الورشة", en: "Workshop Location" },
};

function textFor(definition: ReportDefinition, english: boolean) {
  return english ? definition.title.en : definition.title.ar;
}

function datePreset(preset: "today" | "month" | "year") {
  const now = new Date();
  const from = new Date(now);
  if (preset === "month") from.setDate(1);
  if (preset === "year") {
    from.setMonth(0);
    from.setDate(1);
  }
  const iso = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  };
  return { from: iso(from), to: iso(now) };
}

export default function ReportsCenter() {
  const { i18n } = useTranslation();
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [savedViewName, setSavedViewName] = useState("");
  const english = i18n.resolvedLanguage?.startsWith("en") ?? false;
  const filters = useMemo(
    () => parseReportCenterFilters(params, profile?.tenant_id || ""),
    [params, profile?.tenant_id],
  );
  const setParam = (key: string, value: string | number | null) =>
    setParams(setReportCenterParam(params, key, value), { replace: true });

  const summaryQuery = useQuery({
    queryKey: queryKeys.reportCenter.summary(filters),
    queryFn: ({ signal }) => fetchReportCenterSummary(filters, signal),
    enabled:
      Boolean(filters.tenantId) &&
      canUseReportPermission(profile?.role, "reports.accounting"),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const visibleReports = useMemo(() => {
    const role = profile?.role;
    const query = filters.search.trim().toLocaleLowerCase();
    return REPORT_DEFINITIONS.filter((report) => {
      if (!canOpenReport(role, report.key)) return false;
      if (filters.businessType !== "all" && !report.businessTypes.includes(filters.businessType)) return false;
      if (!["all", "overview"].includes(filters.category) && report.category !== filters.category) return false;
      if (!query) return true;
      return `${report.title.ar} ${report.title.en} ${report.description.ar} ${report.description.en}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [filters.businessType, filters.category, filters.search, profile?.role]);
  const selectedReport = useMemo(
    () =>
      REPORT_DEFINITIONS.find(
        (report) => report.key === filters.reportKey && canOpenReport(profile?.role, report.key),
      ) || null,
    [filters.reportKey, profile?.role],
  );
  const canManageSavedViews = canUseReportPermission(profile?.role, "reports.saved_views");
  const savedViewsQuery = useQuery({
    queryKey: queryKeys.reportCenter.savedViews(profile?.tenant_id),
    queryFn: () => fetchReportSavedViews(profile?.tenant_id || ""),
    enabled: Boolean(profile?.tenant_id) && canManageSavedViews && filters.category === "saved",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const saveViewMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id || !profile.user_id) throw new Error("reports_profile_missing");
      const savedFilters = Object.fromEntries(
        Array.from(params.entries()).filter(([key]) => !["category", "page"].includes(key)),
      );
      return createReportSavedView({
        tenantId: profile.tenant_id,
        userId: profile.user_id,
        name: savedViewName,
        reportKey: filters.reportKey,
        filters: savedFilters,
      });
    },
    onSuccess: () => {
      setSavedViewName("");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reportCenter.savedViews(profile?.tenant_id),
      });
      toast.success(english ? "Report view saved" : "تم حفظ عرض التقرير");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message === "report_saved_view_name_required"
          ? english ? "Enter a name for the saved view" : "أدخل اسمًا للعرض المحفوظ"
          : english ? "Could not save the report view" : "تعذر حفظ عرض التقرير",
      );
    },
  });
  const deleteViewMutation = useMutation({
    mutationFn: deleteReportSavedView,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reportCenter.savedViews(profile?.tenant_id),
      });
      toast.success(english ? "Saved view deleted" : "تم حذف العرض المحفوظ");
    },
    onError: () =>
      toast.error(english ? "Could not delete the saved view" : "تعذر حذف العرض المحفوظ"),
  });

  const applySavedView = (reportKey: string, values: Record<string, string>) => {
    const next = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value) next.set(key, String(value));
    });
    if (reportKey) next.set("report", reportKey);
    next.set("category", "all");
    next.delete("page");
    setParams(next, { replace: true });
  };

  const activeFilters = activeReportFilterEntries(params);
  const summary = summaryQuery.data?.summary;
  const summaryCards = summary
    ? [
        { labelAr: "المطالبات", labelEn: "Claims", value: String(summary.claimsCount), tip: REPORT_ACCOUNTING_RULES.estimateAmount },
        { labelAr: "أوامر العمل", labelEn: "Work Orders", value: String(summary.workOrdersCount) },
        { labelAr: "داخل الورشة", labelEn: "In Workshop", value: String(summary.vehiclesInWorkshop) },
        { labelAr: "تم التسليم", labelEn: "Delivered", value: String(summary.deliveredVehicles) },
        { labelAr: "التقديرات", labelEn: "Estimates", value: formatOMR(summary.estimateTotal), tip: REPORT_ACCOUNTING_RULES.estimateAmount },
        { labelAr: "المعتمد", labelEn: "Approved", value: formatOMR(summary.approvedTotal), tip: REPORT_ACCOUNTING_RULES.approvedAmount },
        { labelAr: "الفواتير قبل الضريبة", labelEn: "Invoice Subtotal", value: formatOMR(summary.invoiceSubtotal), tip: REPORT_ACCOUNTING_RULES.invoiceRevenue },
        { labelAr: "VAT", labelEn: "VAT", value: formatOMR(summary.vat), tip: REPORT_ACCOUNTING_RULES.vat },
        { labelAr: "إجمالي الفواتير", labelEn: "Invoice Total", value: formatOMR(summary.invoiceTotal) },
        { labelAr: "المحصّل", labelEn: "Paid", value: formatOMR(summary.paid), tip: REPORT_ACCOUNTING_RULES.paidAmount },
        { labelAr: "المتبقي", labelEn: "Outstanding", value: formatOMR(summary.outstanding) },
        { labelAr: "التكاليف الفعلية", labelEn: "Actual Costs", value: formatOMR(summary.expenses), tip: REPORT_ACCOUNTING_RULES.directCosts },
        { labelAr: "تكلفة القطع", labelEn: "Parts Cost", value: formatOMR(summary.partsCost) },
        { labelAr: "تكلفة العمالة", labelEn: "Labour Cost", value: formatOMR(summary.laborCost) },
        { labelAr: "النقل", labelEn: "Transport Cost", value: formatOMR(summary.transportCost) },
        { labelAr: "الربح الإجمالي", labelEn: "Gross Profit", value: formatOMR(summary.grossProfit), tip: REPORT_ACCOUNTING_RULES.grossProfit },
        { labelAr: "هامش الربح", labelEn: "Gross Margin", value: `${summary.grossMargin.toLocaleString("en-US", { maximumFractionDigits: 3 })}%` },
        { labelAr: "متوسط أيام الورشة", labelEn: "Avg. Workshop Days", value: summary.averageWorkshopDays.toLocaleString("en-US", { maximumFractionDigits: 1 }) },
        { labelAr: "فواتير متأخرة", labelEn: "Overdue Invoices", value: String(summary.overdueInvoices) },
        { labelAr: "مطالبات بانتظار التحصيل", labelEn: "Claims Awaiting Collection", value: String(summary.claimsAwaitingCollection) },
        { labelAr: "مكتملة دون فاتورة", labelEn: "Completed Without Invoice", value: String(summary.completedWithoutInvoice) },
      ]
    : [];

  const setPreset = (preset: "today" | "month" | "year") => {
    const range = datePreset(preset);
    const next = new URLSearchParams(params);
    next.set("from", range.from);
    next.set("to", range.to);
    next.delete("page");
    setParams(next, { replace: true });
  };

  const openReport = (report: ReportDefinition) => {
    const next = new URLSearchParams(params);
    next.set("report", report.key);
    next.set("category", report.category);
    next.set("page", "1");
    setParams(next, { replace: true });
    requestAnimationFrame(() => {
      document.getElementById("reports-center-data-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  if (!canOpenReportsCenter(profile?.role)) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="border-destructive/30 p-6 text-center">
          <h1 className="text-lg font-bold">
            {english ? "Access denied" : "غير مصرح بفتح مركز التقارير"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {english
              ? "Your role does not have reports.view permission."
              : "لا يملك دور المستخدم صلاحية reports.view."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/">{english ? "Back to dashboard" : "العودة إلى لوحة التحكم"}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 md:p-6" dir={english ? "ltr" : "rtl"}>
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/">{english ? "Dashboard" : "لوحة التحكم"}</Link>
        {english ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        <span className="text-foreground">{english ? "Reports & Exports Center" : "مركز التقارير والمستخرجات"}</span>
      </nav>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileBarChart className="text-primary" />
            {english ? "Reports & Exports Center" : "مركز التقارير والمستخرجات"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {english
              ? "One catalog for insurance, cash, operational and accounting reports. Every amount keeps its documented source."
              : "كتالوج موحد لتقارير التأمين والكاش والتشغيل والمحاسبة، مع توضيح مصدر كل مبلغ ومنع خلط الإيراد بالتقدير."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {english ? "Last update" : "آخر تحديث"}:{" "}
            {summaryQuery.data?.generatedAt
              ? new Date(summaryQuery.data.generatedAt).toLocaleString(english ? "en-OM" : "ar-OM")
              : "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching}>
            <RefreshCw className={summaryQuery.isFetching ? "animate-spin" : ""} size={15} />
            {english ? "Refresh" : "تحديث"}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={15} />
            {english ? "Print" : "طباعة"}
          </Button>
        </div>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="space-y-2">
            <Label>{english ? "Business Type" : "نوع العمل"}</Label>
            <div className="flex rounded-lg border bg-muted/30 p-1">
              {(["all", "insurance", "cash"] as ReportBusinessType[]).map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={filters.businessType === type ? "default" : "ghost"}
                  onClick={() => setParam("businessType", type)}
                >
                  {type === "all"
                    ? english ? "All" : "الكل"
                    : type === "insurance"
                      ? english ? "Insurance" : "التأمين"
                      : english ? "Cash" : "الكاش"}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="report-from">{english ? "Start Date" : "تاريخ البداية"}</Label>
              <Input id="report-from" type="date" value={filters.from} onChange={(event) => setParam("from", event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-to">{english ? "End Date" : "تاريخ النهاية"}</Label>
              <Input id="report-to" type="date" value={filters.to} onChange={(event) => setParam("to", event.target.value)} />
            </div>
            <div className="relative space-y-1 sm:col-span-2">
              <Label htmlFor="report-search">{english ? "Search Reports" : "البحث داخل التقارير"}</Label>
              <Search className="pointer-events-none absolute bottom-3 start-3 text-muted-foreground" size={15} />
              <Input
                id="report-search"
                className="ps-9"
                value={filters.search}
                onChange={(event) => setParam("q", event.target.value)}
                placeholder={english ? "Report name or description..." : "اسم التقرير أو وصفه..."}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{english ? "Quick range:" : "فترة سريعة:"}</span>
          <Button size="sm" variant="ghost" onClick={() => setPreset("today")}>{english ? "Today" : "اليوم"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreset("month")}>{english ? "This Month" : "هذا الشهر"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreset("year")}>{english ? "This Year" : "هذه السنة"}</Button>
        </div>

        <details className="rounded-lg border p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Filter size={15} />
            {english ? "Advanced Filters" : "الفلاتر المتقدمة"}
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["plate", english ? "Plate" : "رقم اللوحة"],
              ["vin", "VIN"],
              ["claim", english ? "Claim Number" : "رقم المطالبة"],
              ["workOrder", english ? "Work Order Number" : "رقم أمر العمل"],
              ["invoice", english ? "Invoice Number" : "رقم الفاتورة"],
              ["claimStatus", english ? "Claim Status" : "حالة المطالبة"],
              ["workOrderStatus", english ? "Work Order Status" : "حالة أمر العمل"],
              ["invoiceStatus", english ? "Invoice Status" : "حالة الفاتورة"],
              ["collectionStatus", english ? "Collection Status" : "حالة التحصيل"],
              ["expenseCategory", english ? "Expense Category" : "تصنيف المصروف"],
              ["paymentMethod", english ? "Payment Method" : "طريقة الدفع"],
              ["workshopLocation", english ? "Workshop Location" : "موقع الورشة"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`report-${key}`}>{label}</Label>
                <Input
                  id={`report-${key}`}
                  value={params.get(key) || ""}
                  onChange={(event) => setParam(key, event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const clean = new URLSearchParams();
                clean.set("businessType", filters.businessType);
                clean.set("category", filters.category);
                clean.set("from", filters.from);
                clean.set("to", filters.to);
                setParams(clean, { replace: true });
              }}
            >
              <X size={14} />
              {english ? "Clear Advanced Filters" : "مسح الفلاتر المتقدمة"}
            </Button>
          </div>
        </details>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeFilters.map(([key, value]) => (
              <Badge key={`${key}-${value}`} variant="secondary" className="gap-1">
                {(english ? FILTER_LABELS[key]?.en : FILTER_LABELS[key]?.ar) || key}: {value}
                <button type="button" onClick={() => setParam(key, null)} aria-label={`remove ${key}`}>
                  <X size={12} />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, index) => (
            <Card key={index} className="h-24 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : summaryQuery.data?.available && summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {summaryCards.map((card) => (
            <Card key={card.labelEn} className="p-3" title={card.tip}>
              <p className="text-xs text-muted-foreground">{english ? card.labelEn : card.labelAr}</p>
              <p className="mt-1 break-words text-lg font-bold" dir="ltr">{card.value}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          {english
            ? "The verified server-side summary is not activated in this database yet. No estimated or page-only totals are shown."
            : "ملخص المجاميع الموثق على الخادم غير مفعّل في قاعدة البيانات بعد. لن يعرض النظام أرقامًا تقديرية أو مجاميع تخص الصفحة الحالية."}
        </Card>
      )}

      {selectedReport && (
        <ReportDataPanel
          report={selectedReport}
          filters={filters}
          english={english}
          onClose={() => setParam("report", null)}
          onPageChange={(page) => setParam("page", page)}
        />
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {REPORT_CATEGORIES.map((category) => {
          const Icon = categoryIcons[category.key] || FileBarChart;
          return (
            <Button
              key={category.key}
              variant={filters.category === category.key ? "default" : "outline"}
              onClick={() => setParam("category", category.key)}
              className="shrink-0"
            >
              <Icon size={14} />
              {english ? category.en : category.ar}
            </Button>
          );
        })}
      </div>

      {filters.category === "saved" &&
      canUseReportPermission(profile?.role, "reports.saved_views") ? (
        <Card className="space-y-4 p-4">
          <h2 className="font-semibold">{english ? "Saved Reports" : "التقارير المحفوظة"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {english
              ? "Saved views are stored in the tenant-isolated reporting database and can be reopened without local storage."
              : "تحتاج التقارير المحفوظة إلى تفعيل طبقة التقارير السحابية. يمكن حاليًا مشاركة رابط الصفحة نفسه بكل الفلاتر دون LocalStorage."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
              placeholder={english ? "Saved view name" : "اسم العرض المحفوظ"}
              aria-label={english ? "Saved view name" : "اسم العرض المحفوظ"}
            />
            <Button
              onClick={() => saveViewMutation.mutate()}
              disabled={saveViewMutation.isPending || !savedViewName.trim()}
            >
              <Save size={14} />
              {saveViewMutation.isPending
                ? english ? "Saving..." : "جارٍ الحفظ..."
                : english ? "Save current view" : "حفظ العرض الحالي"}
            </Button>
          </div>
          {savedViewsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {english ? "Loading saved views..." : "جارٍ تحميل العروض المحفوظة..."}
            </p>
          ) : savedViewsQuery.isError ? (
            <p className="text-sm text-destructive">
              {english ? "Could not load saved views." : "تعذر تحميل العروض المحفوظة."}
            </p>
          ) : savedViewsQuery.data?.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {savedViewsQuery.data.map((view) => (
                <div
                  key={view.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => applySavedView(view.report_key, view.filters)}
                  >
                    <span className="block truncate font-medium">{view.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {view.report_key || (english ? "Catalog" : "الفهرس")}
                    </span>
                  </button>
                  {view.user_id === profile?.user_id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={english ? "Delete saved view" : "حذف العرض المحفوظ"}
                      disabled={deleteViewMutation.isPending}
                      onClick={() => deleteViewMutation.mutate(view.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {english ? "No saved views yet." : "لا توجد عروض محفوظة بعد."}
            </p>
          )}
        </Card>
      ) : visibleReports.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleReports.map((report) => (
            <Card key={report.key} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{textFor(report, english)}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {english ? report.description.en : report.description.ar}
                  </p>
                </div>
                <Badge variant={report.implementation === "ready" ? "default" : report.implementation === "legacy" ? "secondary" : "outline"}>
                  {report.implementation === "ready"
                    ? english ? "Ready" : "جاهز"
                    : report.implementation === "legacy"
                      ? english ? "Existing" : "حالي"
                      : english ? "Server layer pending" : "بانتظار طبقة الخادم"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {report.businessTypes.map((type) => (
                  <Badge key={type} variant="outline">
                    {type === "all" ? (english ? "All" : "الكل") : type === "insurance" ? (english ? "Insurance" : "تأمين") : (english ? "Cash" : "كاش")}
                  </Badge>
                ))}
                {report.exportFormats.filter((format) => format !== "screen").map((format) => (
                  <Badge key={format} variant="outline">{format.toUpperCase()}</Badge>
                ))}
              </div>
              {report.calculationNotes.length > 0 && (
                <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {english ? report.calculationNotes[0].en : report.calculationNotes[0].ar}
                </p>
              )}
              <Button className="mt-auto" onClick={() => openReport(report)} disabled={report.implementation === "planned"}>
                {english ? "Open Report" : "فتح التقرير"}
                {english ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-10 text-center text-muted-foreground">
          {english ? "No reports match the selected filters." : "لا توجد تقارير مطابقة للفلاتر المحددة."}
        </Card>
      )}
    </div>
  );
}
