import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, Loader2, Printer, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";
import { formatOMR } from "@/lib/money";
import { fetchAllReportRows, fetchReportData } from "@/lib/reports-center/reportCenterService";
import { canExportReport } from "@/lib/reports-center/reportPermissions";
import {
  exportReportRowsToPdf,
  exportReportRowsToXlsx,
  printReportRows,
  type ReportExportRequest,
} from "@/lib/reports-center/reportExportService";
import type {
  ReportCenterFilters,
  ReportColumnDefinition,
  ReportDefinition,
  ReportRow,
} from "@/lib/reports-center/reportTypes";

interface Props {
  report: ReportDefinition;
  filters: ReportCenterFilters;
  english: boolean;
  onClose: () => void;
  onPageChange: (page: number) => void;
}

function formatCell(value: unknown, column: ReportColumnDefinition, english: boolean) {
  if (value === null || value === undefined || value === "") return "—";
  if (column.type === "money") return formatOMR(value);
  if (column.type === "percentage") {
    return `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
  }
  if (column.type === "number") return Number(value || 0).toLocaleString("en-US");
  if (column.type === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString(english ? "en-OM" : "ar-OM");
  }
  return String(value);
}

function exportRequest(
  report: ReportDefinition,
  filters: ReportCenterFilters,
  rows: ReportRow[],
  english: boolean,
  generatedBy: string,
): ReportExportRequest<ReportRow> {
  const title = english ? report.title.en : report.title.ar;
  return {
    fileName: `${report.key}_${filters.from}_to_${filters.to}.xlsx`,
    sheetName: report.key,
    title,
    filters: [
      { label: english ? "From" : "من", value: filters.from },
      { label: english ? "To" : "إلى", value: filters.to },
      { label: english ? "Business Type" : "نوع العمل", value: filters.businessType },
      ...(filters.search
        ? [{ label: english ? "Search" : "البحث", value: filters.search }]
        : []),
    ],
    columns: report.columns.map((column) => ({
      key: column.key,
      label: english ? column.label.en : column.label.ar,
      type: column.type === "status" ? "text" : column.type,
    })),
    rows,
    language: english ? "en" : "ar",
    generatedBy,
    generatedAt: new Date().toISOString(),
  };
}

export default function ReportDataPanel({
  report,
  filters,
  english,
  onClose,
  onPageChange,
}: Props) {
  const { profile } = useAuth();
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | "print" | null>(null);
  const query = useQuery({
    queryKey: queryKeys.reportCenter.detail(report.key, filters),
    queryFn: ({ signal }) => fetchReportData(report.key, filters, signal),
    enabled: Boolean(filters.tenantId),
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const runExport = async (format: "xlsx" | "pdf" | "print") => {
    if (!canExportReport(profile?.role, format)) {
      toast.error(english ? "You do not have permission for this action." : "لا تملك صلاحية هذا الإجراء.");
      return;
    }
    setExporting(format);
    try {
      const result = await fetchAllReportRows(report.key, filters);
      if (!result.available) throw new Error("Server-side report RPC is not activated.");
      if (!result.rows.length) throw new Error(english ? "The report has no rows." : "لا توجد سجلات للتصدير.");
      const request = exportRequest(
        report,
        filters,
        result.rows,
        english,
        profile?.full_name || profile?.user_id || "Authenticated user",
      );
      if (format === "xlsx") exportReportRowsToXlsx(request);
      if (format === "pdf") await exportReportRowsToPdf(request);
      if (format === "print") await printReportRows(request);
      toast.success(english ? "Export completed" : "تم إنشاء المستخرج");
    } catch (error: any) {
      toast.error(
        error?.message ||
          (english ? "Report export failed." : "تعذر إنشاء المستخرج."),
      );
    } finally {
      setExporting(null);
    }
  };

  const result = query.data;
  return (
    <Card className="space-y-4 p-4" id="reports-center-data-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-bold">{english ? report.title.en : report.title.ar}</h2>
          <p className="text-sm text-muted-foreground">
            {english ? report.description.en : report.description.ar}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} />
            {english ? "Refresh" : "تحديث"}
          </Button>
          {canExportReport(profile?.role, "xlsx") && <Button variant="outline" size="sm" onClick={() => void runExport("xlsx")} disabled={Boolean(exporting)}>
            {exporting === "xlsx" ? <Loader2 className="animate-spin" size={14} /> : <FileSpreadsheet size={14} />}
            XLSX
          </Button>}
          {canExportReport(profile?.role, "pdf") && <Button variant="outline" size="sm" onClick={() => void runExport("pdf")} disabled={Boolean(exporting)}>
            {exporting === "pdf" ? <Loader2 className="animate-spin" size={14} /> : <FileDown size={14} />}
            PDF
          </Button>}
          {canExportReport(profile?.role, "print") && <Button variant="outline" size="sm" onClick={() => void runExport("print")} disabled={Boolean(exporting)}>
            {exporting === "print" ? <Loader2 className="animate-spin" size={14} /> : <Printer size={14} />}
            {english ? "Print" : "طباعة"}
          </Button>}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            {english ? "Close" : "إغلاق"}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin" /> {english ? "Loading report..." : "جاري تحميل التقرير..."}
        </div>
      ) : query.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {english ? "The report query failed." : "فشل استعلام التقرير."}{" "}
          {String((query.error as any)?.message || "")}
        </div>
      ) : !result?.available ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          {english
            ? "The detailed server-side report migration is not activated in this database. No client-side fallback is used."
            : "طبقة التقرير التفصيلي على الخادم غير مفعلة في قاعدة البيانات. لن يتم استخدام تجميع بديل داخل المتصفح."}
        </div>
      ) : (
        <>
          {result.dataQuality.unknownBusinessType > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              {english
                ? `${result.dataQuality.unknownBusinessType} record(s) need business-type review and were not silently classified as cash.`
                : `${result.dataQuality.unknownBusinessType} سجل يحتاج مراجعة نوع العمل، ولم يتم تصنيفه تلقائيًا ككاش.`}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {Object.entries(result.aggregates)
              .filter(([, value]) => Number.isFinite(Number(value)))
              .map(([key, value]) => (
                <div key={key} className="rounded-lg border bg-muted/20 p-2">
                  <p className="text-[11px] text-muted-foreground">{key}</p>
                  <p className="font-semibold" dir="ltr">
                    {/amount|subtotal|vat|total|paid|outstanding|cost|profit/i.test(key)
                      ? formatOMR(value)
                      : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                  </p>
                </div>
              ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  {report.columns.map((column) => (
                    <TableHead key={column.key}>
                      {english ? column.label.en : column.label.ar}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.length ? (
                  result.rows.map((row, index) => (
                    <TableRow key={String(row.recordId || `${result.pagination.page}-${index}`)}>
                      {report.columns.map((column) => (
                        <TableCell key={column.key} dir={column.type === "money" ? "ltr" : undefined}>
                          {formatCell(row[column.key], column, english)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={report.columns.length} className="h-28 text-center text-muted-foreground">
                      {english ? "No matching records." : "لا توجد سجلات مطابقة."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {english ? "Total rows" : "إجمالي السجلات"}:{" "}
              {result.pagination.totalRows.toLocaleString("en-US")}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={result.pagination.page <= 1}
                onClick={() => onPageChange(result.pagination.page - 1)}
              >
                {english ? "Previous" : "السابق"}
              </Button>
              <span dir="ltr">
                {result.pagination.page} / {Math.max(result.pagination.totalPages, 1)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={result.pagination.page >= result.pagination.totalPages}
                onClick={() => onPageChange(result.pagination.page + 1)}
              >
                {english ? "Next" : "التالي"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
