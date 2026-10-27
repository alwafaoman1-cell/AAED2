import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { loadEmployeePunches } from "@/lib/attendance/attendanceCloud";
import { deriveAttendanceDay, type DevicePunch } from "@/lib/attendance/attendanceEngine";
import { printAttendanceMonth } from "@/lib/employeeHrReports";
import { hrStore, type Attendance } from "@/lib/hrStore";

const localMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit" }).format(new Date());
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const time = (stamp?: string | null) => stamp ? stamp.slice(11, 16) : "—";

export default function EmployeeAttendanceTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const [month, setMonth] = useState(localMonth);
  const [punches, setPunches] = useState<DevicePunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Attendance>(() => emptyAttendance(employeeId));
  const [proposalAmount, setProposalAmount] = useState("");
  const [proposalReason, setProposalReason] = useState("");
  const [proposalType, setProposalType] = useState<"late" | "absence" | "other">("late");
  const [saving, setSaving] = useState(false);
  const manual = hrStore.listAttendance(employeeId, month);
  const settlements = hrStore.listAttendanceSettlements(employeeId, month);
  const mayPropose = !settlements.some((row) => row.approvalStatus === "pending" || row.approvalStatus === "approved");
  const employee = hrStore.getEmployee(employeeId);
  const leaves = hrStore.listLeaves(employeeId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCloudError(false);
    void loadEmployeePunches(employeeId, month).then((rows) => {
      if (active) { setPunches(rows); setLoading(false); }
    }).catch((error) => {
      console.error("[Attendance] punch read failed", error);
      if (active) { setCloudError(true); setLoading(false); }
    });
    return () => { active = false; };
  }, [employeeId, month, refresh]);

  const days = useMemo(() => [...new Set(punches.map((row) => row.occurredAt.slice(0, 10)))].sort().reverse()
    .flatMap((date) => { const day = deriveAttendanceDay(punches, date); return day ? [day] : []; }), [punches]);
  const merged = useMemo(() => {
    // Manual corrections must never hide the immutable device evidence for the same date.
    const derived: Attendance[] = days.map((row) => ({
      id: `device-${row.date}`, employeeId, date: row.date,
      checkIn: time(row.firstPunch), checkOut: row.checkout ? time(row.checkout) : undefined,
      status: row.lateMinutes ? "late" : "present", hours: row.workedMinutes / 60,
      notes: row.checkoutEstimated
        ? (isAr ? "خروج 21:00 تقديري، يحتاج مراجعة؛ ليس بصمة فعلية" : "21:00 estimated checkout, review required; not an actual punch")
        : row.needsReview ? (isAr ? "حركات الجهاز غير مكتملة؛ تحتاج مراجعة" : "Device punches incomplete; review required")
          : (isAr ? "من جهاز البصمة" : "From attendance device"),
      createdAt: row.firstPunch,
    }));
    return [...manual, ...derived].sort((a, b) => b.date.localeCompare(a.date) || Number(a.id.startsWith("device-")) - Number(b.id.startsWith("device-")));
  }, [days, employeeId, isAr, manual]);
  const lateMinutes = days.reduce((total, row) => total + row.lateMinutes, 0);
  const reviewCount = days.filter((row) => row.needsReview).length;
  const unverifiedDates = useMemo(() => {
    if (!employee?.hireDate) return [];
    const observed = new Set([...days.map((row) => row.date), ...manual.map((row) => row.date)]);
    const result: string[] = [];
    const [year, number] = month.split("-").map(Number);
    if (!year || !number || number < 1 || number > 12) return result;
    const end = Math.min(new Date(Date.UTC(year, number, 0)).getUTCDate(), 31);
    const today = localDate();
    for (let day = 1; day <= end; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (date >= today || date < employee.hireDate || new Date(`${date}T00:00:00Z`).getUTCDay() === 5 || observed.has(date)) continue;
      if (leaves.some((leave) => leave.status === "approved" && leave.startDate <= date && leave.endDate >= date)) continue;
      result.push(date);
    }
    return result;
  }, [days, employee?.hireDate, leaves, manual, month]);

  async function saveManual() {
    setSaving(true);
    try {
      await hrStore.saveAttendance(form);
      toast.success(isAr ? "تم حفظ الحضور في السحابة" : "Attendance saved to the cloud");
      setOpen(false);
    } catch (error) { console.error("[Attendance] manual save failed", error); toast.error(isAr ? "لم يُحفظ الحضور" : "Attendance was not saved"); }
    finally { setSaving(false); }
  }

  async function propose() {
    setSaving(true);
    try {
      await hrStore.proposeAttendanceDeduction(employeeId, month, Number(proposalAmount), proposalReason, proposalType);
      toast.success(isAr ? "حُفظت تسوية مقترحة؛ لن تُخصم قبل اعتماد المدير" : "Proposal saved; no payroll deduction until manager approval");
      setProposalAmount(""); setProposalReason("");
    } catch (error) { console.error("[Attendance] proposal failed", error); toast.error(isAr ? "تعذر حفظ التسوية المقترحة" : "Could not save proposal"); }
    finally { setSaving(false); }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error || new Error("AUTH_REQUIRED");
      await hrStore.decideAttendanceDeduction(id, decision, data.user.id);
      toast.success(decision === "approved" ? (isAr ? "اعتمد الخصم وسيظهر في كشف الراتب الجديد" : "Deduction approved for new payslips")
        : (isAr ? "رُفضت التسوية دون خصم" : "Proposal rejected without deduction"));
    } catch (error) {
      console.error("[Attendance] approval failed", error);
      toast.error(error instanceof Error && error.message === "ATTENDANCE_PAYSLIP_ALREADY_PAID"
        ? (isAr ? "كشف هذا الشهر مصروف بالفعل؛ لا يمكن خصم مبلغ بأثر رجعي. راجع التسوية مع المحاسب." : "This month's payslip is already paid. Review the adjustment with accounting.")
        : (isAr ? "لم يُحفظ القرار في السحابة" : "Decision was not saved to the cloud"));
    }
    finally { setSaving(false); }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" aria-label={isAr ? "شهر الحضور" : "Attendance month"} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="me-1 h-4 w-4" />{isAr ? "تحديث الحركات" : "Refresh punches"}</Button>
        <Button size="sm" variant="outline" disabled={loading || cloudError} onClick={() => {
          const employee = hrStore.getEmployee(employeeId);
          if (employee) void printAttendanceMonth(employee, month, merged, isAr, unverifiedDates).catch((error) => toast.error((error as Error)?.message || "Print failed"));
        }}><Printer className="me-1 h-4 w-4" />{isAr ? "طباعة كشف الشهر" : "Print month"}</Button>
        <Button size="sm" onClick={() => { setForm(emptyAttendance(employeeId)); setOpen(true); }}><Plus className="me-1 h-4 w-4" />{isAr ? "تسجيل يدوي" : "Manual entry"}</Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{isAr
      ? "الدوام: السبت–الخميس 08:00–13:00 و16:00–21:00، الجمعة راحة. الخروج 21:00 عند غياب البصمة تقديري للمراجعة فقط. الأيام دون بيانات ليست غيابًا مثبتًا."
      : "Shift: Saturday–Thursday 08:00–13:00 and 16:00–21:00; Friday off. Missing 21:00 checkout is only an estimate for review. Missing punches do not prove absence."}</p>
    {loading && <Card className="p-3 text-sm text-muted-foreground">{isAr ? "جارٍ تحميل حركات الجهاز…" : "Loading device punches…"}</Card>}
    {cloudError && <Card className="p-3 text-sm text-destructive">{isAr ? "تعذر تحميل حركات الجهاز من السحابة. لا تعتمد الملخص حتى تعود البيانات." : "Cloud punches could not load. Do not rely on the summary."}</Card>}
    {!loading && !cloudError && <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label={isAr ? "أيام بها بصمة" : "Punched days"} value={days.length} />
        <Metric label={isAr ? "دقائق تأخير ظاهرة" : "Observed late minutes"} value={lateMinutes} />
        <Metric label={isAr ? "دقائق نقص تقديرية" : "Estimated shortfall minutes"} value={days.reduce((total, row) => total + row.shortfallMinutes, 0)} />
        <Metric label={isAr ? "أيام تحتاج مراجعة" : "Days needing review"} value={reviewCount} />
        <Metric label={isAr ? "غياب مسجل يدويًا" : "Manual absences"} value={manual.filter((row) => row.status === "absent").length} />
        <Metric label={isAr ? "أيام بلا حركة — للمراجعة" : "No-punch days — review"} value={unverifiedDates.length} />
      </div>
      {unverifiedDates.length > 0 && <p className="text-sm text-warning">{isAr
        ? `أيام بلا بصمة بعد تاريخ التعيين: ${unverifiedDates.slice(0, 8).join("، ")}${unverifiedDates.length > 8 ? "…" : ""}. ليست غيابًا مثبتًا ولا تُخصم تلقائيًا.`
        : `No punches after hire date: ${unverifiedDates.slice(0, 8).join(", ")}${unverifiedDates.length > 8 ? "…" : ""}. These are not confirmed absences and do not deduct payroll.`}</p>}
      <Card className="divide-y">
        {!merged.length && <p className="p-4 text-sm text-muted-foreground">{isAr ? "لا توجد حركات مستوردة أو سجلات يدوية لهذا الشهر" : "No imported or manual attendance this month"}</p>}
        {merged.map((row) => {
          const device = days.find((day) => day.date === row.date && row.id.startsWith("device-"));
          return <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><strong>{row.date}</strong><span className="ms-2">{row.checkIn || "—"} → {row.checkOut || "—"}</span>
              <div className="text-muted-foreground">{row.id.startsWith("device-") ? (isAr ? "بصمة الجهاز" : "Device punch") : (isAr ? "تسجيل يدوي" : "Manual record")} · {row.notes || "—"}</div></div>
            <div className="flex items-center gap-2">
              <span>{row.status === "absent" ? (isAr ? "غياب يدوي" : "Manual absence") : device?.needsReview ? (isAr ? "مراجعة" : "Review") : row.status === "late" ? (isAr ? "تأخير" : "Late") : (isAr ? "حضور" : "Present")}</span>
              {device && <span className="text-muted-foreground">{device.lateMinutes} {isAr ? "دقيقة تأخير" : "late min"}</span>}
              {!row.id.startsWith("device-") && <Button size="icon" variant="ghost" aria-label={isAr ? "حذف السجل اليدوي" : "Delete manual record"} onClick={() => void hrStore.removeAttendance(row.id).catch(() => toast.error(isAr ? "فشل حذف السجل" : "Delete failed"))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>;
        })}
      </Card>
    </>}
    <Card className="space-y-3 p-4">
      <h3 className="font-semibold">{isAr ? "تسوية الحضور والخصم" : "Attendance settlement & deduction"}</h3>
      <p className="text-sm text-muted-foreground">{isAr ? "التأخير والنقص مؤشرات للمراجعة. لا تُحسب قيمة خصم تلقائيًا ولا تؤثر التسوية المقترحة في الراتب قبل اعتماد المدير." : "Late/shortfall are review indicators. No amount is calculated automatically; proposals do not affect payroll before manager approval."}</p>
      {settlements.map((settlement) => <div key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
        <div>{settlement.reason} · {settlement.amount.toFixed(3)} {isAr ? "ر.ع" : "OMR"} · {settlement.approvalStatus === "pending" ? (isAr ? "بانتظار اعتماد المدير" : "Pending manager approval") : settlement.approvalStatus === "approved" ? (isAr ? "معتمد" : "Approved") : (isAr ? "مرفوض" : "Rejected")}</div>
        {settlement.approvalStatus === "pending" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => void decide(settlement.id, "rejected")}>{isAr ? "رفض" : "Reject"}</Button><Button size="sm" disabled={saving} onClick={() => void decide(settlement.id, "approved")}>{isAr ? "اعتماد الخصم" : "Approve deduction"}</Button></div>}
      </div>)}
      {mayPropose && <div className="grid gap-2 sm:grid-cols-[120px_130px_1fr_auto]">
        <Select value={proposalType} onValueChange={(value) => setProposalType(value as "late" | "absence" | "other")}>
          <SelectTrigger aria-label={isAr ? "نوع التسوية" : "Settlement type"}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem><SelectItem value="absence">{isAr ? "غياب" : "Absence"}</SelectItem><SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem></SelectContent>
        </Select>
        <Input type="number" min="0" step="0.001" value={proposalAmount} onChange={(event) => setProposalAmount(event.target.value)} placeholder={isAr ? "المبلغ" : "Amount"} aria-label={isAr ? "مبلغ الخصم المقترح" : "Proposed deduction amount"} />
        <Input value={proposalReason} onChange={(event) => setProposalReason(event.target.value)} placeholder={isAr ? "سبب موثق للمراجعة" : "Documented reason"} aria-label={isAr ? "سبب التسوية" : "Settlement reason"} />
        <Button disabled={saving || !proposalReason.trim() || Number(proposalAmount) <= 0} onClick={() => void propose()}>{isAr ? "اقتراح فقط" : "Propose only"}</Button>
      </div>}
    </Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{isAr ? "تسجيل حضور يدوي" : "Manual attendance"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2"><div><Label>{isAr ? "الدخول" : "Check-in"}</Label><Input type="time" value={form.checkIn || ""} onChange={(event) => setForm({ ...form, checkIn: event.target.value })} /></div>
          <div><Label>{isAr ? "الخروج" : "Check-out"}</Label><Input type="time" value={form.checkOut || ""} onChange={(event) => setForm({ ...form, checkOut: event.target.value })} /></div></div>
        <div><Label>{isAr ? "الحالة" : "Status"}</Label><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as Attendance["status"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="present">{isAr ? "حضور" : "Present"}</SelectItem><SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem><SelectItem value="absent">{isAr ? "غياب" : "Absent"}</SelectItem><SelectItem value="leave">{isAr ? "إجازة" : "Leave"}</SelectItem><SelectItem value="holiday">{isAr ? "عطلة" : "Holiday"}</SelectItem>
        </SelectContent></Select></div>
      </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button disabled={saving} onClick={() => void saveManual()}>{isAr ? "حفظ" : "Save"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card className="p-3 text-center"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-bold">{value}</div></Card>;
}

function emptyAttendance(employeeId: string): Attendance {
  return { id: hrStore.uid(), employeeId, date: localDate(), status: "present", createdAt: hrStore.nowIso() };
}
