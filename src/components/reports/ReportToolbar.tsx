// مكوّن مشترك: شريط أدوات تصدير + فلاتر التقرير
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, FileText, Printer, Download, Calendar } from "lucide-react";
import {
  exportReportToPdf, exportReportToXlsx, exportReportToCsv, printReport,
  type ReportExportPayload,
} from "@/lib/reportExporters";
import { rangeShortcut, type DateRange, type ReportFilters } from "@/lib/reportsEngine";

interface Props {
  filters: ReportFilters;
  setFilters: (f: ReportFilters) => void;
  facets: { customers: string[]; suppliers: string[]; technicians: string[]; statuses: string[] };
  payload: ReportExportPayload;
  showCustomer?: boolean;
  showSupplier?: boolean;
  showStatus?: boolean;
  showTechnician?: boolean;
}

export default function ReportToolbar({
  filters, setFilters, facets, payload,
  showCustomer, showSupplier, showStatus, showTechnician,
}: Props) {
  const updateRange = (range: DateRange) => setFilters({ ...filters, range });

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
      {/* اختصارات الفترة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Calendar size={14} /> اختصارات:
        </span>
        {[
          { key: "today", label: "اليوم" },
          { key: "week", label: "أسبوع" },
          { key: "month", label: "شهر" },
          { key: "quarter", label: "ربع" },
          { key: "year", label: "سنة" },
        ].map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant="outline"
            onClick={() => updateRange(rangeShortcut(s.key as any))}
            className="h-7 text-xs"
          >
            {s.label}
          </Button>
        ))}
      </div>

      {/* الفلاتر */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">من تاريخ</Label>
          <Input
            type="date"
            value={filters.range.from}
            onChange={(e) => updateRange({ ...filters.range, from: e.target.value })}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">إلى تاريخ</Label>
          <Input
            type="date"
            value={filters.range.to}
            onChange={(e) => updateRange({ ...filters.range, to: e.target.value })}
            className="h-9"
          />
        </div>

        {showCustomer && (
          <div className="space-y-1">
            <Label className="text-xs">العميل</Label>
            <Select
              value={filters.customer || "__all"}
              onValueChange={(v) => setFilters({ ...filters, customer: v === "__all" ? undefined : v })}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">جميع العملاء</SelectItem>
                {facets.customers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showSupplier && (
          <div className="space-y-1">
            <Label className="text-xs">المورد</Label>
            <Select
              value={filters.supplier || "__all"}
              onValueChange={(v) => setFilters({ ...filters, supplier: v === "__all" ? undefined : v })}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">جميع الموردين</SelectItem>
                {facets.suppliers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showStatus && (
          <div className="space-y-1">
            <Label className="text-xs">الحالة</Label>
            <Select
              value={filters.status || "__all"}
              onValueChange={(v) => setFilters({ ...filters, status: v === "__all" ? undefined : v })}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">جميع الحالات</SelectItem>
                {facets.statuses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showTechnician && (
          <div className="space-y-1">
            <Label className="text-xs">الفني/المستخدم</Label>
            <Select
              value={filters.technician || "__all"}
              onValueChange={(v) => setFilters({ ...filters, technician: v === "__all" ? undefined : v })}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">الجميع</SelectItem>
                {facets.technicians.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* أزرار التصدير */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button
          size="sm"
          onClick={() => { void exportReportToPdf(payload, `${payload.title}.pdf`); }}
          className="bg-destructive hover:bg-destructive/90"
        >
          <FileText size={14} className="ml-1" /> PDF
        </Button>
        <Button
          size="sm"
          onClick={() => exportReportToXlsx(payload, `${payload.title}.xlsx`)}
          className="bg-success hover:bg-success/90"
        >
          <FileSpreadsheet size={14} className="ml-1" /> Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportReportToCsv(payload, `${payload.title}.csv`)}
        >
          <Download size={14} className="ml-1" /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => printReport(payload)}>
          <Printer size={14} className="ml-1" /> طباعة
        </Button>
      </div>
    </div>
  );
}
