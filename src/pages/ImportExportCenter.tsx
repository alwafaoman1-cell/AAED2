import type React from "react";
import { useMemo, useState } from "react";
import { Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, History, Columns3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  autoMapColumns,
  buildTemplateWorkbook,
  detectDuplicates,
  exportRows,
  getEntityDefinition,
  IMPORT_EXPORT_ENTITIES,
  importExpensesRows,
  logImportExportOperation,
  mapRows,
  normalizePhonesInRows,
  parseImportFile,
  type ImportExportEntity,
} from "@/lib/importExportCenter";

export default function ImportExportCenter() {
  const [entity, setEntity] = useState<ImportExportEntity>("customers");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [mappedRows, setMappedRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);

  const definition = getEntityDefinition(entity);
  const duplicates = useMemo(() => detectDuplicates(entity, mappedRows), [entity, mappedRows]);
  const missingRequired = useMemo(
    () => definition.columns.filter((col) => col.required && !columnMap[col.key]),
    [definition.columns, columnMap],
  );

  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseImportFile(file);
      const nextMap = autoMapColumns(parsed.headers, entity);
      const normalized = await normalizePhonesInRows(mapRows(parsed.rows, nextMap));
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setColumnMap(nextMap);
      setMappedRows(normalized);
      await logImportExportOperation({
        operation: "import",
        entity,
        status: "previewed",
        rowCount: parsed.rows.length,
        duplicateCount: detectDuplicates(entity, normalized).length,
      });
      toast.success("تمت قراءة الملف وتجهيز المعاينة");
    } catch (error: any) {
      toast.error(error?.message || "تعذر قراءة الملف");
      await logImportExportOperation({ operation: "import", entity, status: "failed", rowCount: 0, errorCount: 1 });
    } finally {
      setBusy(false);
    }
  }

  async function refreshMapping(nextMap: Record<string, string>) {
    setColumnMap(nextMap);
    setMappedRows(await normalizePhonesInRows(mapRows(rawRows, nextMap)));
  }

  async function handleExport() {
    setBusy(true);
    try {
      const count = exportRows(entity);
      await logImportExportOperation({ operation: "export", entity, status: "completed", rowCount: count });
      toast.success(`تم تصدير ${count} سجل`);
    } catch (error: any) {
      toast.error(error?.message || "تعذر التصدير");
      await logImportExportOperation({ operation: "export", entity, status: "failed", rowCount: 0, errorCount: 1 });
    } finally {
      setBusy(false);
    }
  }

  function handleTemplate() {
    buildTemplateWorkbook(entity);
    toast.success("تم تحميل قالب Excel");
  }

  async function handleSaveExpenses() {
    if (entity !== "expenses") return;
    if (!mappedRows.length) {
      toast.error("ارفع ملف المصروفات أولاً");
      return;
    }
    if (missingRequired.length > 0) {
      toast.error("يجب ربط حقل المبلغ قبل الحفظ");
      return;
    }
    if (duplicates.length > 0) {
      toast.error("يوجد تكرار في الملف أو أرقام سندات موجودة مسبقًا");
      return;
    }
    setBusy(true);
    try {
      const result = await importExpensesRows(mappedRows);
      await logImportExportOperation({
        operation: "import",
        entity,
        status: result.errors.length ? "failed" : "completed",
        rowCount: result.saved.length,
        errorCount: result.errors.length,
      });
      if (result.errors.length) {
        toast.error(`تم حفظ ${result.saved.length} مصروف، وفشل ${result.errors.length}`);
      } else {
        toast.success(`تم حفظ ${result.saved.length} مصروف في Supabase`);
      }
      if (result.saved.length) {
        setHeaders([]);
        setRawRows([]);
        setMappedRows([]);
        setColumnMap({});
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المصروفات");
      await logImportExportOperation({ operation: "import", entity, status: "failed", rowCount: mappedRows.length, errorCount: 1 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-gradient-to-l from-primary/15 to-card p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-primary">Import / Export Center</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">مركز الاستيراد والتصدير</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              صفحة موحدة للاستيراد والتصدير مع معاينة، كشف التكرار، ربط الأعمدة، وقوالب جاهزة بدون إدخال بيانات تجريبية.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[520px]">
            <Select value={entity} onValueChange={(value) => {
              setEntity(value as ImportExportEntity);
              setHeaders([]);
              setRawRows([]);
              setMappedRows([]);
              setColumnMap({});
            }}>
              <SelectTrigger className="bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_EXPORT_ENTITIES.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.labelAr} · {item.labelEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={handleTemplate}>
              <FileSpreadsheet size={16} /> قالب جاهز
            </Button>
            <Button className="gap-2 gradient-gold text-primary-foreground" onClick={handleExport} disabled={!definition.canExport || busy}>
              <Download size={16} /> تصدير
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-secondary">
          <TabsTrigger value="import" className="gap-2"><Upload size={14} /> الاستيراد</TabsTrigger>
          <TabsTrigger value="mapping" className="gap-2"><Columns3 size={14} /> ربط الأعمدة</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><History size={14} /> السجل</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">رفع Excel / CSV</h2>
                <p className="text-xs text-muted-foreground">سيتم عرض معاينة قبل أي حفظ. الاستيراد الفعلي يبقى تحت مراجعة المستخدم لتجنب كسر القيود الحالية.</p>
              </div>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={!definition.canImport || busy}
                onChange={(event) => void handleFile(event.target.files?.[0])}
                className="max-w-sm bg-secondary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard icon={<FileSpreadsheet size={18} />} label="الصفوف المقروءة" value={mappedRows.length} />
            <StatCard icon={<AlertTriangle size={18} />} label="تكرارات/تنبيهات" value={duplicates.length} tone={duplicates.length ? "warning" : "success"} />
            <StatCard icon={<CheckCircle2 size={18} />} label="حقول مطلوبة مربوطة" value={`${definition.columns.filter((c) => c.required && columnMap[c.key]).length}/${definition.columns.filter((c) => c.required).length || 0}`} />
          </div>

          {missingRequired.length > 0 && mappedRows.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              يجب ربط الحقول المطلوبة قبل الحفظ: {missingRequired.map((col) => col.label).join("، ")}
            </div>
          )}

          {entity === "expenses" && mappedRows.length > 0 && (
            <div className="flex justify-end">
              <Button
                className="gap-2"
                onClick={() => void handleSaveExpenses()}
                disabled={busy || missingRequired.length > 0 || duplicates.length > 0}
              >
                <CheckCircle2 size={16} /> حفظ المصروفات في Supabase
              </Button>
            </div>
          )}

          <PreviewTable rows={mappedRows} duplicates={duplicates} />
        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">ربط الأعمدة يدويًا</h2>
                <p className="text-xs text-muted-foreground">استخدم هذا عندما تختلف أسماء أعمدة ملف Excel عن أسماء النظام.</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshMapping(autoMapColumns(headers, entity))} disabled={!headers.length}>
                <RefreshCw size={14} /> ربط تلقائي
              </Button>
            </div>
            {!headers.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ارفع ملفًا أولًا لعرض الأعمدة.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {definition.columns.map((col) => (
                  <div key={col.key} className="rounded-lg border border-border bg-secondary/30 p-3">
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      {col.label} {col.required && <span className="text-destructive">*</span>}
                    </label>
                    <Select value={columnMap[col.key] || "__none"} onValueChange={(value) => {
                      const next = { ...columnMap };
                      if (value === "__none") delete next[col.key];
                      else next[col.key] = value;
                      void refreshMapping(next);
                    }}>
                      <SelectTrigger className="bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">غير مربوط</SelectItem>
                        {headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-card">
            يتم حفظ سجل العمليات في جدول Supabase الجديد <span className="font-mono text-foreground">import_export_operations</span>.
            تظهر هنا العمليات الجديدة بعد تطبيق migration على قاعدة البيانات.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value, tone = "primary" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "primary" | "warning" | "success" }) {
  const toneClass = tone === "warning" ? "text-warning bg-warning/10" : tone === "success" ? "text-success bg-success/10" : "text-primary bg-primary/10";
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function PreviewTable({ rows, duplicates }: { rows: Record<string, string>[]; duplicates: Array<{ rowIndex: number; reason: string }> }) {
  if (!rows.length) {
    return <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">لا توجد معاينة بعد.</div>;
  }
  const duplicateRows = new Map(duplicates.map((d) => [d.rowIndex, d.reason]));
  const headers = Object.keys(rows[0] || {});
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-secondary text-muted-foreground">
            <tr>
              <th className="p-2 text-start">#</th>
              {headers.map((header) => <th key={header} className="p-2 text-start">{header}</th>)}
              <th className="p-2 text-start">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, index) => {
              const warning = duplicateRows.get(index + 1);
              return (
                <tr key={index} className={`border-t border-border ${warning ? "bg-warning/10" : "hover:bg-secondary/30"}`}>
                  <td className="p-2 text-muted-foreground">{index + 1}</td>
                  {headers.map((header) => <td key={header} className="p-2" dir="auto">{row[header] || "—"}</td>)}
                  <td className="p-2">{warning ? <span className="text-warning">{warning}</span> : <span className="text-success">جاهز</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 100 && <div className="border-t border-border p-2 text-center text-xs text-muted-foreground">تم عرض أول 100 صف فقط من أصل {rows.length}.</div>}
    </div>
  );
}
