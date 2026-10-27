import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Pencil, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { loadAttendanceReviews, loadEmployeePunches, saveDayReview, saveMonthReview, type DayReview, type MonthReview } from "@/lib/attendance/attendanceCloud";
import { deriveAttendanceDay, isCompletedAttendanceDate, WORKSHOP_BREAK, type AttendanceDay, type AttendanceDayReview, type DevicePunch, type PeriodStatus } from "@/lib/attendance/attendanceEngine";
import { printAttendanceMonth } from "@/lib/employeeHrReports";
import { hrStore, type Attendance } from "@/lib/hrStore";

const localDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const localMonth = () => localDate().slice(0, 7);
const clock = (stamp?: string | null) => stamp?.slice(11, 16) ?? "—";
const approvedLeave = (date: string, leaves: ReturnType<typeof hrStore.listLeaves>) =>
  leaves.some((item) => item.status === "approved" && item.startDate <= date && item.endDate >= date);
const isFriday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5;

function monthDates(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, number] = month.split("-").map(Number);
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`);
}

function reviewInput(day: AttendanceDay | undefined): AttendanceDayReview {
  const status = (value?: PeriodStatus): AttendanceDayReview["morning_status"] =>
    value === "present" || value === "absent" || value === "excused" ? value : "incomplete";
  return {
    morning_status: status(day?.morning.status), afternoon_status: status(day?.afternoon.status),
    morning_in: day?.morning.status === "present" ? clock(day.morning.checkIn) : null,
    morning_out: day?.morning.status === "present" ? clock(day.morning.checkOut) : null,
    afternoon_in: day?.afternoon.status === "present" ? clock(day.afternoon.checkIn) : null,
    afternoon_out: day?.afternoon.status === "present" ? clock(day.afternoon.checkOut) : null,
  };
}

const periodLabel = (status: PeriodStatus, isAr: boolean) => ({
  present: isAr ? "حضور" : "Present", absent: isAr ? "غياب حسب السجل" : "No punches in covered period",
  incomplete: isAr ? "بصمة ناقصة" : "Incomplete punches", excused: isAr ? "معذور" : "Excused",
  pending: isAr ? "لم ينتهِ الدوام" : "Shift ongoing", rest: isAr ? "راحة" : "Rest day",
})[status];
const manualStatusLabel = (status: Attendance["status"], isAr: boolean) => isAr ? ({
  present: "حضور", absent: "غياب", late: "تأخير", leave: "إجازة", holiday: "عطلة",
})[status] : status;
const settlementStatusLabel = (status: string | undefined, isAr: boolean) => isAr ? ({
  pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض",
} as Record<string, string>)[status || ""] || "—" : status || "—";

function Metric({ label, value }: { label: string; value: number | string }) {
  return <Card className="p-3 text-center"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-bold">{value}</div></Card>;
}

export default function EmployeeAttendanceTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const { hasRole } = useAuth();
  const canManage = hasRole("admin", "manager");
  const [month, setMonth] = useState(localMonth);
  const [punches, setPunches] = useState<DevicePunch[]>([]);
  const [monthReview, setMonthReview] = useState<MonthReview | null>(null);
  const [dayReviews, setDayReviews] = useState<DayReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageStart, setCoverageStart] = useState("");
  const [coverageEnd, setCoverageEnd] = useState("");
  const [graceMinutes, setGraceMinutes] = useState("0");
  const [coverageReason, setCoverageReason] = useState("");
  const [editDate, setEditDate] = useState<string | null>(null);
  const [dayForm, setDayForm] = useState<AttendanceDayReview>(reviewInput(undefined));
  const [dayReason, setDayReason] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualToDelete, setManualToDelete] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<Attendance>(() => emptyAttendance(employeeId));
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [proposalAmount, setProposalAmount] = useState("");
  const [proposalReason, setProposalReason] = useState("");
  const [proposalType, setProposalType] = useState<"late" | "absence" | "other">("late");
  const employee = hrStore.getEmployee(employeeId);
  const manual = hrStore.listAttendance(employeeId, month);
  const leaves = hrStore.listLeaves(employeeId);
  const settlements = hrStore.listAttendanceSettlements(employeeId, month);
  const payslip = hrStore.listPayslips(employeeId).find((row) => row.month === month);
  const verifiedBalance = payslip && payslip.paidAmount !== undefined
    ? Math.max(0, payslip.netSalary - payslip.paidAmount) : null;
  const mayPropose = !settlements.some((row) => row.approvalStatus === "pending" || row.approvalStatus === "approved");

  useEffect(() => {
    let active = true;
    setLoading(true); setCloudError(false); setMonthReview(null); setDayReviews([]); setPunches([]);
    void Promise.all([loadEmployeePunches(employeeId, month), loadAttendanceReviews(employeeId, month)]).then(([raw, reviews]) => {
      if (!active) return;
      setPunches(raw); setMonthReview(reviews.monthReview); setDayReviews(reviews.dayReviews); setLoading(false);
    }).catch((error) => {
      console.error("[Attendance] cloud read failed", error);
      if (active) { setCloudError(true); setLoading(false); }
    });
    return () => { active = false; };
  }, [employeeId, month, refresh]);

  const latestByDate = useMemo(() => new Map([...dayReviews].reverse().map((row) => [row.attendance_date, row])), [dayReviews]);
  const dayDates = useMemo(() => {
    const dates = new Set([...punches.map((row) => row.occurredAt.slice(0, 10)), ...latestByDate.keys()]);
    if (monthReview) for (const date of monthDates(month)) {
      if (date >= monthReview.coverage_start && date <= monthReview.coverage_end &&
          isCompletedAttendanceDate(date) && !isFriday(date) && !approvedLeave(date, leaves) &&
          (!employee?.hireDate || date >= employee.hireDate) &&
          !manual.some((row) => row.date === date && row.status !== "absent")) dates.add(date);
    }
    return [...dates].filter((date) => date.startsWith(month)).sort().reverse();
  }, [punches, latestByDate, monthReview, month, leaves, employee?.hireDate, manual]);
  const days = useMemo(() => dayDates.flatMap((date) => {
    const row = latestByDate.get(date);
    const covered = !!monthReview && date >= monthReview.coverage_start && date <= monthReview.coverage_end;
    const day = deriveAttendanceDay(punches, date, new Date(), monthReview?.grace_minutes ?? 0, row as (DayReview & AttendanceDayReview) | undefined, covered);
    return day ? [day] : [];
  }), [dayDates, latestByDate, monthReview, punches]);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const unverifiedDates = useMemo(() => {
    const first = employee?.hireDate || employee?.contractStartDate || dayDates.at(-1);
    if (!first) return [];
    const last = dayDates[0] || monthDates(month).at(-1);
    return monthDates(month).filter((date) => date >= first && date <= (last || date) && isCompletedAttendanceDate(date) &&
      !isFriday(date) && !approvedLeave(date, leaves) && !byDate.has(date) && !manual.some((row) => row.date === date));
  }, [employee?.hireDate, employee?.contractStartDate, dayDates, month, leaves, byDate, manual]);
  const absentMorning = days.filter((day) => day.morning.status === "absent").length;
  const absentEvening = days.filter((day) => day.afternoon.status === "absent").length;
  const absentFull = days.filter((day) => day.morning.status === "absent" && day.afternoon.status === "absent").length;
  const late = days.reduce((sum, day) => sum + day.lateMinutes, 0);
  const shortfall = days.reduce((sum, day) => sum + day.shortfallMinutes, 0);
  const reviewCount = days.filter((day) => day.needsReview).length;

  function editDay(date: string) {
    setDayForm(reviewInput(byDate.get(date)));
    setDayReason(""); setEditDate(date);
  }
  function openCoverage() {
    const observed = punches.map((row) => row.occurredAt.slice(0, 10)).sort();
    setCoverageStart(monthReview?.coverage_start || observed[0] || `${month}-01`);
    setCoverageEnd(monthReview?.coverage_end || observed.at(-1) || monthDates(month).filter((date) => isCompletedAttendanceDate(date)).at(-1) || `${month}-01`);
    setGraceMinutes(String(monthReview?.grace_minutes ?? 0)); setCoverageReason(""); setCoverageOpen(true);
  }
  async function saveCoverage() {
    setSaving(true);
    try {
      await saveMonthReview(employeeId, month, coverageStart, coverageEnd, Number(graceMinutes), coverageReason);
      toast.success(isAr ? "تأكد حفظ تغطية الشهر وفترة السماح؛ راجع الغياب قبل أي خصم" : "Coverage and grace saved; review absences before deduction");
      setCoverageOpen(false); setRefresh((x) => x + 1);
    } catch (error) { console.error("[Attendance] coverage save failed", error); toast.error(isAr ? "لم تُحفظ تغطية الشهر في السحابة" : "Month coverage was not saved"); }
    finally { setSaving(false); }
  }
  async function saveReview() {
    if (!editDate) return;
    setSaving(true);
    try {
      await saveDayReview(employeeId, editDate, dayForm, dayReason);
      toast.success(isAr ? "حُفظ التصحيح موثقًا دون تغيير البصمات الأصلية" : "Audited correction saved; original punches unchanged");
      setEditDate(null); setRefresh((x) => x + 1);
    } catch (error) { console.error("[Attendance] day review failed", error); toast.error(isAr ? "لم يُحفظ تصحيح اليوم؛ تحقق من الأوقات والسبب" : "Day correction was not saved; check times and reason"); }
    finally { setSaving(false); }
  }
  async function saveManual() {
    setSaving(true);
    try { await hrStore.saveAttendance(manualForm); toast.success(isAr ? "تم حفظ السجل اليدوي في السحابة" : "Manual record saved"); setManualOpen(false); }
    catch (error) { console.error("[Attendance] manual save failed", error); toast.error(isAr ? "لم يُحفظ السجل اليدوي" : "Manual record was not saved"); }
    finally { setSaving(false); }
  }
  async function deleteManual() {
    if (!manualToDelete) return;
    setSaving(true);
    try {
      await hrStore.removeAttendance(manualToDelete);
      toast.success(isAr ? "حُذف السجل اليدوي بعد تأكيد الحفظ السحابي" : "Legacy manual record removed from the cloud");
      setManualToDelete(null);
    } catch (error) { console.error("[Attendance] manual delete failed", error); toast.error(isAr ? "تعذر حذف السجل اليدوي" : "Could not remove manual record"); }
    finally { setSaving(false); }
  }
  async function propose() {
    setSaving(true);
    try {
      await hrStore.proposeAttendanceDeduction(employeeId, month, Number(proposalAmount), proposalReason, proposalType);
      toast.success(isAr ? "حُفظت تسوية مقترحة؛ لا خصم قبل اعتماد المدير" : "Proposal saved; no deduction until manager approval");
      setProposalAmount(""); setProposalReason("");
    } catch (error) { console.error("[Attendance] proposal failed", error); toast.error(isAr ? "تعذر حفظ التسوية" : "Could not save proposal"); }
    finally { setSaving(false); }
  }
  async function decide(id: string, decision: "approved" | "rejected") {
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error || new Error("AUTH_REQUIRED");
      await hrStore.decideAttendanceDeduction(id, decision, data.user.id);
      toast.success(decision === "approved" ? (isAr ? "اعتمد الخصم لكشف راتب جديد" : "Deduction approved for new payslips") : (isAr ? "رُفضت التسوية دون خصم" : "Proposal rejected"));
    } catch (error) {
      console.error("[Attendance] decision failed", error);
      toast.error(error instanceof Error && error.message === "ATTENDANCE_PAYSLIP_ALREADY_PAID"
        ? (isAr ? "كشف هذا الشهر مدفوع؛ راجع المحاسب" : "Payslip already paid; consult accounting")
        : (isAr ? "لم يُحفظ القرار في السحابة" : "Decision was not saved"));
    } finally { setSaving(false); }
  }

  const printRows: Attendance[] = days.map((day) => ({ id: `device-${day.date}`, employeeId, date: day.date,
    checkIn: clock(day.morning.checkIn), checkOut: clock(day.checkout),
    status: day.morning.status === "absent" && day.afternoon.status === "absent" ? "absent" : day.lateMinutes ? "late" : "present",
    hours: day.workedMinutes / 60, createdAt: day.firstPunch || `${day.date}T00:00:00+04:00`,
    notes: `${isAr ? "صباح" : "AM"}: ${periodLabel(day.morning.status, isAr)} ${clock(day.morning.checkIn)}–${clock(day.morning.checkOut)}; ` +
      `${isAr ? "استراحة" : "Break"}: ${clock(day.breakOut)}–${clock(day.breakIn)}; ` +
      `${isAr ? "مساء" : "PM"}: ${periodLabel(day.afternoon.status, isAr)} ${clock(day.afternoon.checkIn)}–${clock(day.afternoon.checkOut)}` +
      (day.checkoutEstimated ? (isAr ? "; خروج 21:00 تقديري غير مثبت" : "; 21:00 estimated, not a punch") : ""),
  }));

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" aria-label={isAr ? "شهر الحضور" : "Attendance month"} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={() => setRefresh((x) => x + 1)}><RefreshCw className="me-1 h-4 w-4" />{isAr ? "تحديث" : "Refresh"}</Button>
        <Button size="sm" variant="outline" disabled={loading || cloudError} onClick={() => employee && void printAttendanceMonth(employee, month, [...printRows, ...manual], isAr, unverifiedDates).catch((error) => toast.error((error as Error)?.message || "Print failed"))}><Printer className="me-1 h-4 w-4" />{isAr ? "طباعة الشهر" : "Print month"}</Button>
        {canManage && <Button size="sm" variant="outline" disabled={loading || cloudError} onClick={openCoverage}><ClipboardCheck className="me-1 h-4 w-4" />{isAr ? "تغطية الشهر والسماح" : "Coverage & grace"}</Button>}
        {canManage && <Button size="sm" variant="outline" onClick={() => { setManualForm(emptyAttendance(employeeId)); setManualOpen(true); }}><Plus className="me-1 h-4 w-4" />{isAr ? "سجل يدوي" : "Manual record"}</Button>}
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{isAr
      ? `السبت–الخميس 08:00–13:00، استراحة ${WORKSHOP_BREAK.start / 60}:00–${WORKSHOP_BREAK.end / 60}:00، مساءً 16:00–21:00. الجمعة راحة. السماح المعتمد: ${monthReview?.grace_minutes ?? 0} دقيقة. الخروج التقديري ليس بصمة ولا يُثبت ساعات عمل.`
      : `Sat–Thu 08:00–13:00, break 13:00–16:00, evening 16:00–21:00; Friday off. Approved grace: ${monthReview?.grace_minutes ?? 0} min. Estimated checkout is not a punch or verified work time.`}</p>
    {loading && <Card className="p-3 text-sm text-muted-foreground">{isAr ? "جارٍ تحميل الحضور…" : "Loading attendance…"}</Card>}
    {cloudError && <Card className="p-3 text-sm text-destructive">{isAr ? "تعذر تحميل سجل السحابة؛ الملخص غير متاح ولا يُعتمد." : "Cloud attendance failed to load; do not use this summary."}</Card>}
    {!loading && !cloudError && <>
      {!monthReview && <Card className="border-warning p-3 text-sm text-warning">{isAr ? "لم يؤكد المدير اكتمال استيراد هذا الشهر؛ الأيام بلا بصمة غير مصنفة كغياب." : "Month import coverage is not confirmed; no-punch dates are not classified as absences."}</Card>}
      {monthReview && <p className="text-sm text-muted-foreground">{isAr ? "التغطية المعتمدة" : "Confirmed coverage"}: {monthReview.coverage_start} — {monthReview.coverage_end} · {isAr ? "آخر اعتماد" : "Last review"}: {new Date(monthReview.created_at).toLocaleString(isAr ? "ar-OM" : "en-GB")}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label={isAr ? "أيام غياب كاملة بالسجل" : "Full no-punch days"} value={absentFull} />
        <Metric label={isAr ? "غياب صباحي" : "AM absent"} value={absentMorning} />
        <Metric label={isAr ? "غياب مسائي" : "PM absent"} value={absentEvening} />
        <Metric label={isAr ? "دقائق التأخير بعد السماح" : "Late min after grace"} value={late} />
        <Metric label={isAr ? "دقائق نقص قابلة للمراجعة" : "Reviewable shortfall min"} value={shortfall} />
        <Metric label={isAr ? "أيام تحتاج مراجعة" : "Days to review"} value={reviewCount} />
        <Metric label={isAr ? "غياب يدوي سابق" : "Legacy manual absence"} value={new Set(manual.filter((row) => row.status === "absent").map((row) => row.date)).size} />
      </div>
      {unverifiedDates.length > 0 && <Card className="space-y-2 p-3 text-sm"><strong>{isAr ? "أيام بلا بصمة خارج التغطية — غير محسوبة غيابًا" : "No-punch dates outside coverage — not counted absent"}</strong>
        <div className="flex flex-wrap gap-2">{unverifiedDates.map((date) => <Button key={date} size="sm" variant="outline" disabled={!canManage} onClick={() => editDay(date)}>{date}</Button>)}</div></Card>}
      <Card className="divide-y">
        {!days.length && !manual.length && <p className="p-4 text-sm text-muted-foreground">{isAr ? "لا توجد بصمات أو مراجعات لهذا الشهر" : "No punches or reviews this month"}</p>}
        {days.map((day) => <div key={day.date} className="grid gap-2 p-3 text-sm lg:grid-cols-[110px_1fr_1fr_1fr_auto] lg:items-center">
          <div className="font-semibold">{day.date}<div className="text-xs font-normal text-muted-foreground">{day.punchCount} {isAr ? "بصمة أصلية" : "raw punches"}</div><div className="text-xs font-normal text-muted-foreground">{punches.filter((row) => row.occurredAt.startsWith(day.date)).map((row) => clock(row.occurredAt)).join("، ")}</div></div>
          <div>{isAr ? "الصباح" : "Morning"} · {periodLabel(day.morning.status, isAr)}<div className="text-muted-foreground">{clock(day.morning.checkIn)} → {clock(day.morning.checkOut)}</div></div>
          <div>{isAr ? "الاستراحة: خروج / دخول" : "Break: out / back"}<div className="text-muted-foreground">{clock(day.breakOut)} → {clock(day.breakIn)}</div></div>
          <div>{isAr ? "المساء" : "Evening"} · {periodLabel(day.afternoon.status, isAr)}<div className="text-muted-foreground">{clock(day.afternoon.checkIn)} → {clock(day.afternoon.checkOut)}{day.checkoutEstimated && (isAr ? " · خروج 21:00 تقديري" : " · 21:00 estimated out")}</div>
            <div className="text-xs text-muted-foreground">{day.lateMinutes} {isAr ? "د تأخير" : "late min"} · {day.shortfallMinutes} {isAr ? "د نقص" : "shortfall min"}{day.reviewed && (isAr ? " · تصحيح موثق" : " · reviewed correction")}</div></div>
          {canManage && isCompletedAttendanceDate(day.date) && <Button size="sm" variant="outline" onClick={() => editDay(day.date)}><Pencil className="me-1 h-4 w-4" />{isAr ? "مراجعة/تعديل" : "Review/edit"}</Button>}
        </div>)}
        {manual.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><strong>{row.date}</strong> · {isAr ? "سجل يدوي سابق" : "Legacy manual record"} · {manualStatusLabel(row.status, isAr)} · {row.checkIn || "—"} → {row.checkOut || "—"} · {row.notes || "—"}</span>{canManage && <Button size="icon" variant="ghost" aria-label={isAr ? "حذف السجل اليدوي" : "Delete legacy manual record"} onClick={() => setManualToDelete(row.id)}><Trash2 className="h-4 w-4" /></Button>}</div>)}
      </Card>
      {canManage && <Card className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{isAr ? "تسوية الحضور والراتب" : "Attendance settlement"}</h3><p className="text-sm text-muted-foreground">{isAr ? "الغياب والتأخير تقدير من سجل الجهاز؛ لا خصم تلقائي قبل مراجعة المدير." : "Absence and lateness are device-record indicators; no automatic payroll deduction."}</p></div><Button variant="outline" onClick={() => setSettlementOpen((x) => !x)}>{isAr ? "تسوية الحساب" : "Settle account"}</Button></div>
        {settlementOpen && <div className="space-y-3"><p className="text-sm">{isAr ? `غياب كامل ${absentFull} يوم، صباحي ${absentMorning}، مسائي ${absentEvening}؛ تأخير ${late} دقيقة بعد سماح ${monthReview?.grace_minutes ?? 0}؛ نقص ${shortfall} دقيقة. المبلغ يحدد بعد المراجعة.` : `Full no-punch days ${absentFull}, AM ${absentMorning}, PM ${absentEvening}; late ${late} min after ${monthReview?.grace_minutes ?? 0} min grace; reviewable shortfall ${shortfall} min. Manager determines any amount.`}</p>
          <p className="text-sm text-muted-foreground">{verifiedBalance === null
            ? (isAr ? "متبقي الراتب غير مؤكد: لا يوجد كشف راتب بمبلغ دفع مثبت لهذا الشهر." : "Salary balance unverified: this month has no payslip with a verified paid amount.")
            : (isAr ? `صافي كشف الراتب المحفوظ ${payslip?.netSalary.toFixed(3)} ر.ع · المدفوع المثبت ${payslip?.paidAmount?.toFixed(3)} ر.ع · المتبقي المثبت ${verifiedBalance.toFixed(3)} ر.ع` : `Saved payslip net ${payslip?.netSalary.toFixed(3)} OMR · verified paid ${payslip?.paidAmount?.toFixed(3)} OMR · verified balance ${verifiedBalance.toFixed(3)} OMR`)}</p>
          {settlements.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"><span>{item.reason} · {item.amount.toFixed(3)} {isAr ? "ر.ع" : "OMR"} · {settlementStatusLabel(item.approvalStatus, isAr)}</span>{item.approvalStatus === "pending" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => void decide(item.id, "rejected")}>{isAr ? "رفض" : "Reject"}</Button><Button size="sm" disabled={saving} onClick={() => void decide(item.id, "approved")}>{isAr ? "اعتماد الخصم" : "Approve"}</Button></div>}</div>)}
          {mayPropose && <div className="grid gap-2 sm:grid-cols-[120px_130px_1fr_auto]"><Select value={proposalType} onValueChange={(value) => setProposalType(value as typeof proposalType)}><SelectTrigger aria-label={isAr ? "نوع التسوية" : "Settlement type"}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem><SelectItem value="absence">{isAr ? "غياب" : "Absence"}</SelectItem><SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem></SelectContent></Select><Input type="number" min="0" step="0.001" value={proposalAmount} onChange={(event) => setProposalAmount(event.target.value)} placeholder={isAr ? "المبلغ" : "Amount"} aria-label={isAr ? "مبلغ مقترح" : "Proposed amount"} /><Input value={proposalReason} onChange={(event) => setProposalReason(event.target.value)} placeholder={isAr ? "سبب موثق" : "Documented reason"} aria-label={isAr ? "سبب التسوية" : "Settlement reason"} /><Button disabled={saving || !monthReview || !proposalReason.trim() || Number(proposalAmount) <= 0} onClick={() => void propose()}>{isAr ? "اقتراح فقط" : "Propose only"}</Button></div>}
        </div>}
      </Card>}
    </>}

    <Dialog open={coverageOpen} onOpenChange={setCoverageOpen}><DialogContent><DialogHeader><DialogTitle>{isAr ? "تأكيد تغطية الاستيراد وفترة السماح" : "Confirm import coverage & grace"}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{isAr ? "اعتمد فقط الأيام التي تأكدت من استيراد حركات جميع أفراد الدوام فيها. غياب البصمة داخل التغطية يظهر كغياب حسب السجل، دون خصم تلقائي." : "Confirm only dates whose punch export is complete. No-punch covered days appear as record-based absence, never automatic payroll deductions."}</p><div className="grid grid-cols-2 gap-2"><div><Label>{isAr ? "من" : "From"}</Label><Input type="date" value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} /></div><div><Label>{isAr ? "إلى" : "To"}</Label><Input type="date" value={coverageEnd} onChange={(e) => setCoverageEnd(e.target.value)} /></div></div><div><Label>{isAr ? "السماح لكل بداية فترة (دقيقة)" : "Grace per shift start (minutes)"}</Label><Input type="number" min="0" max="60" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} /></div><div><Label>{isAr ? "سبب ومصدر تأكيد التغطية" : "Coverage evidence / reason"}</Label><Input value={coverageReason} onChange={(e) => setCoverageReason(e.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setCoverageOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button disabled={saving || coverageReason.trim().length < 8} onClick={() => void saveCoverage()}>{isAr ? "حفظ الاعتماد" : "Confirm coverage"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!editDate} onOpenChange={(open) => !open && setEditDate(null)}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{isAr ? `مراجعة يوم ${editDate}` : `Review day ${editDate}`}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{isAr ? "التعديل لا يغير البصمات الأصلية. احفظ سببًا موثقًا؛ كل نسخة تصحيح تبقى في سجل المراجعة." : "Original punches remain unchanged. Provide a documented reason; each correction is retained."}</p><p className="text-sm">{isAr ? "بصمات الجهاز الأصلية" : "Original device punches"}: {punches.filter((row) => row.occurredAt.startsWith(editDate || "#")).map((row) => `${clock(row.occurredAt)} [${row.eventCode}]`).join("، ") || "—"}</p>{(["morning", "afternoon"] as const).map((period) => <div key={period} className="space-y-2 rounded border p-3"><Label>{period === "morning" ? (isAr ? "الفترة الصباحية" : "Morning") : (isAr ? "الفترة المسائية" : "Evening")}</Label><Select value={dayForm[`${period}_status`]} onValueChange={(value) => setDayForm((form) => ({ ...form, [`${period}_status`]: value as AttendanceDayReview["morning_status"], [`${period}_in`]: null, [`${period}_out`]: null }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="present">{isAr ? "حضور مصحح" : "Reviewed present"}</SelectItem><SelectItem value="absent">{isAr ? "غياب" : "Absent"}</SelectItem><SelectItem value="excused">{isAr ? "معذور" : "Excused"}</SelectItem><SelectItem value="incomplete">{isAr ? "بصمة ناقصة" : "Incomplete"}</SelectItem></SelectContent></Select>{dayForm[`${period}_status`] === "present" && <div className="grid grid-cols-2 gap-2"><div><Label>{isAr ? "دخول" : "In"}</Label><Input type="time" value={dayForm[`${period}_in`] || ""} onChange={(e) => setDayForm((form) => ({ ...form, [`${period}_in`]: e.target.value }))} /></div><div><Label>{isAr ? "خروج" : "Out"}</Label><Input type="time" value={dayForm[`${period}_out`] || ""} onChange={(e) => setDayForm((form) => ({ ...form, [`${period}_out`]: e.target.value }))} /></div></div>}</div>)}<div><Label>{isAr ? "سبب التصحيح (إلزامي)" : "Correction reason (required)"}</Label><Input value={dayReason} onChange={(e) => setDayReason(e.target.value)} placeholder={isAr ? "مثال: نسي تسجيل الخروج وأبلغ الإدارة" : "E.g. missed checkout reported to management"} /></div>{editDate && dayReviews.filter((row) => row.attendance_date === editDate).length > 0 && <div className="space-y-1 text-xs text-muted-foreground">{dayReviews.filter((row) => row.attendance_date === editDate).map((row) => <p key={row.id}>{new Date(row.created_at).toLocaleString(isAr ? "ar-OM" : "en-GB")} · {periodLabel(row.morning_status as PeriodStatus, isAr)} {row.morning_in || "—"}–{row.morning_out || "—"} / {periodLabel(row.afternoon_status as PeriodStatus, isAr)} {row.afternoon_in || "—"}–{row.afternoon_out || "—"} · {row.reason}</p>)}</div>}<DialogFooter><Button variant="outline" onClick={() => setEditDate(null)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button disabled={saving || dayReason.trim().length < 8} onClick={() => void saveReview()}>{isAr ? "حفظ تصحيح موثق" : "Save reviewed correction"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={manualOpen} onOpenChange={setManualOpen}><DialogContent><DialogHeader><DialogTitle>{isAr ? "تسجيل حضور يدوي" : "Manual attendance"}</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} /></div><div className="grid grid-cols-2 gap-2"><div><Label>{isAr ? "الدخول" : "Check-in"}</Label><Input type="time" value={manualForm.checkIn || ""} onChange={(e) => setManualForm({ ...manualForm, checkIn: e.target.value })} /></div><div><Label>{isAr ? "الخروج" : "Check-out"}</Label><Input type="time" value={manualForm.checkOut || ""} onChange={(e) => setManualForm({ ...manualForm, checkOut: e.target.value })} /></div></div><Select value={manualForm.status} onValueChange={(value) => setManualForm({ ...manualForm, status: value as Attendance["status"] })}><SelectTrigger aria-label={isAr ? "الحالة" : "Status"}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="present">{isAr ? "حضور" : "Present"}</SelectItem><SelectItem value="absent">{isAr ? "غياب" : "Absent"}</SelectItem><SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem><SelectItem value="leave">{isAr ? "إجازة" : "Leave"}</SelectItem><SelectItem value="holiday">{isAr ? "عطلة" : "Holiday"}</SelectItem></SelectContent></Select><div><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Input value={manualForm.notes || ""} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setManualOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button disabled={saving} onClick={() => void saveManual()}>{isAr ? "حفظ" : "Save"}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={!!manualToDelete} onOpenChange={(open) => !open && setManualToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{isAr ? "حذف السجل اليدوي السابق؟" : "Delete legacy manual record?"}</AlertDialogTitle><AlertDialogDescription>{isAr ? "لن تُحذف بصمات الجهاز أو التصحيحات الموثقة. راجع السجل قبل المتابعة." : "Raw punches and audited corrections are not deleted. Check the record first."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void deleteManual(); }}>{isAr ? "حذف السجل اليدوي" : "Delete manual record"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function emptyAttendance(employeeId: string): Attendance {
  return { id: hrStore.uid(), employeeId, date: localDate(), status: "present", createdAt: hrStore.nowIso() };
}
