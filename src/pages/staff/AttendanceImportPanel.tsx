import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrStore, type Employee } from "@/lib/hrStore";
import { parseSmartPssRows, type ParsedAttendanceFile } from "@/lib/attendance/attendanceEngine";
import { importDevicePunches, loadDevicePeople, saveDevicePerson, type DevicePersonMapping } from "@/lib/attendance/attendanceCloud";

export default function AttendanceImportPanel({ employees, isAr }: { employees: Employee[]; isAr: boolean }) {
  const [parsed, setParsed] = useState<ParsedAttendanceFile | null>(null);
  const [mapping, setMapping] = useState<DevicePersonMapping[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    void loadDevicePeople().then((rows) => { setMapping(rows); setLoadError(false); })
      .catch((error) => { console.error("[Attendance] mapping load failed", error); setLoadError(true); });
  }, []);
  const people = useMemo(() => {
    const unique = new Map<string, { key: string; device: string; person: string; name: string; count: number }>();
    for (const row of parsed?.punches ?? []) {
      const key = `${row.deviceKey}|${row.personId}`;
      const found = unique.get(key);
      if (found) found.count++;
      else unique.set(key, { key, device: row.deviceKey, person: row.personId, name: row.personName, count: 1 });
    }
    return [...unique.values()].sort((a, b) => a.person.localeCompare(b.person, undefined, { numeric: true }));
  }, [parsed]);
  const selectedFor = (key: string) => choices[key] || mapping.find((row) => `${row.device_key}|${row.person_id}` === key)?.employee_id || "";
  const unmapped = people.filter((row) => !selectedFor(row.key)).length;

  async function openFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)) {
      toast.error(isAr ? "اختر ملف SmartPSS بصيغة XLSX بحجم لا يتجاوز 10MB" : "Choose a SmartPSS XLSX under 10MB");
      return;
    }
    setBusy(true);
    setParsed(null);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("ATTENDANCE_EMPTY_FILE");
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      if (rows.length > 100_001) throw new Error("ATTENDANCE_TOO_MANY_ROWS");
      setParsed(parseSmartPssRows(rows));
      setChoices({});
    } catch (error) {
      console.error("[Attendance] file parse failed", error);
      toast.error(isAr ? "تعذر قراءة ملف الحضور؛ تحقق من تصدير SmartPSS وأعمدته" : "Could not read the SmartPSS attendance export");
    } finally { setBusy(false); }
  }

  async function saveMappings() {
    if (busy || !parsed || unmapped) return;
    setBusy(true);
    try {
      for (const row of people) if (selectedFor(row.key) !== "__skip__") await saveDevicePerson(row.device, row.person, selectedFor(row.key));
      setMapping(await loadDevicePeople());
      setLoadError(false);
      toast.success(isAr ? "تأكد حفظ ربط الأشخاص بالموظفين" : "Employee mapping saved to the cloud");
    } catch (error) {
      console.error("[Attendance] mapping save failed", error);
      toast.error(error instanceof Error && error.message === "ATTENDANCE_MAPPING_HAS_HISTORY"
        ? (isAr ? "لا يمكن تغيير ربط شخص له حركات محفوظة؛ يلزم تصحيح موثق" : "Existing punch history requires an audited remapping")
        : (isAr ? "تعذر حفظ الربط السحابي؛ لم تُستورد الحركات" : "Cloud mapping failed; punches were not imported"));
      try { setMapping(await loadDevicePeople()); } catch { setLoadError(true); }
    } finally { setBusy(false); }
  }

  async function importFile() {
    if (busy || !parsed || unmapped || loadError) return;
    if (people.some((row) => selectedFor(row.key) !== "__skip__" &&
      mapping.find((item) => `${item.device_key}|${item.person_id}` === row.key)?.employee_id !== selectedFor(row.key))) {
      toast.error(isAr ? "احفظ ربط جميع الأشخاص أولًا" : "Save all employee mappings first");
      return;
    }
    setBusy(true);
    try {
      const excluded = new Set(people.filter((row) => selectedFor(row.key) === "__skip__").map((row) => row.key));
      const result = await importDevicePunches(parsed.punches.filter((row) => !excluded.has(`${row.deviceKey}|${row.personId}`)), mapping);
      if (result.unmapped) throw new Error("ATTENDANCE_UNMAPPED");
      toast.success(isAr
        ? `تم التحقق من الاستيراد: ${result.inserted} حركة جديدة، ${result.submitted - result.inserted} موجودة مسبقًا`
        : `Imported ${result.inserted} new punches; ${result.submitted - result.inserted} already existed`);
    } catch (error) {
      console.error("[Attendance] import failed", error);
      toast.error(isAr ? "تعذر استيراد جميع الحركات. أعد المحاولة؛ التكرارات تُتجاهل بأمان." : "Attendance import failed. Retry is safe and idempotent.");
    } finally { setBusy(false); }
  }

  return <Card className="space-y-3 p-4">
    <div>
      <h2 className="font-semibold">{isAr ? "استيراد حركات جهاز البصمة" : "Import device attendance punches"}</h2>
      <p className="text-sm text-muted-foreground">{isAr
        ? "ملف SmartPSS فقط. لا تُستورد الصور أو البصمات؛ الحركات الخام لا تُغيّر الراتب ولا تُحوَّل إلى غياب تلقائي. هذا استيراد يدوي وليس مزامنة لحظية."
        : "SmartPSS XLSX only. No images or biometrics. Raw punches do not alter payroll or auto-mark absence. This is a manual import, not live sync."}</p>
    </div>
    {loadError && <p className="text-sm text-destructive">{isAr ? "تعذر تحميل ربط الموظفين من السحابة. أعد فتح الصفحة قبل الاستيراد." : "Cloud employee mapping could not be loaded. Reopen before importing."}</p>}
    <Input type="file" accept=".xlsx" aria-label={isAr ? "ملف حضور SmartPSS" : "SmartPSS attendance file"} disabled={busy || loadError} onChange={(event) => void openFile(event.target.files?.[0])} />
    {parsed && <>
      <div className="text-sm">{isAr ? "حركات صالحة" : "Valid punches"}: {parsed.punches.length} · {isAr ? "مكررة داخل الملف" : "Duplicates in file"}: {parsed.duplicates} · {isAr ? "أسطر مرفوضة" : "Rejected rows"}: {parsed.rejected}</div>
      {parsed.rejected > 0 && <p className="text-sm text-warning">{isAr ? "راجع الأسطر المرفوضة قبل الاعتماد؛ لن تُستورد." : "Review rejected rows before importing; they will be skipped."}</p>}
      <div className="max-h-72 overflow-y-auto divide-y rounded border">
        {people.map((row) => <div key={row.key} className="grid gap-2 p-2 sm:grid-cols-[1fr_1fr] sm:items-center">
          <div className="text-sm"><span className="font-medium">#{row.person} · {row.name || "—"}</span><span className="ms-2 text-muted-foreground">({row.count})</span><div className="text-xs text-muted-foreground">{row.device}</div></div>
          <Select value={selectedFor(row.key) || undefined} onValueChange={(value) => setChoices((previous) => ({ ...previous, [row.key]: value }))}>
            <SelectTrigger aria-label={isAr ? `موظف الجهاز ${row.person}` : `Device person ${row.person}`}><SelectValue placeholder={isAr ? "اختر الموظف" : "Select employee"} /></SelectTrigger>
            <SelectContent><SelectItem value="__skip__">{isAr ? "استبعاد من الاستيراد" : "Exclude from import"}</SelectItem>{employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.employeeNumber} — {employee.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loadError || !!unmapped} onClick={() => void saveMappings()}>{isAr ? "حفظ ربط الموظفين" : "Save employee mappings"}</Button>
        <Button disabled={busy || loadError || !!unmapped || !parsed.punches.length} onClick={() => void importFile()}>{isAr ? "استيراد الحركات دون تعديل الرواتب" : "Import punches without changing payroll"}</Button></div>
      {!!unmapped && <p className="text-sm text-warning">{isAr ? `${unmapped} شخص دون ربط. لا يمكن استيراد ملف جزئي.` : `${unmapped} people unmapped. Partial import is blocked.`}</p>}
    </>}
  </Card>;
}
