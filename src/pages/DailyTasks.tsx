import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Circle, Clock, Flag, Plus, Printer, Trash2, ListTodo } from "lucide-react";
import { useDailyTasks, useCreateTask, useUpdateTask, useDeleteTask, type TaskPriority, type TaskStatus, type DailyTask } from "@/hooks/useDailyTasks";
import { buildHtmlWithPageMarginStyle } from "@/lib/pdfLayoutSettings";

const priorityMeta: Record<TaskPriority, { label: string; cls: string }> = {
  urgent: { label: "عاجل", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  high:   { label: "مرتفع", cls: "bg-warning/15 text-warning border-warning/30" },
  normal: { label: "عادي", cls: "bg-muted text-muted-foreground border-border" },
  low:    { label: "منخفض", cls: "bg-info/10 text-info border-info/20" },
};
const statusMeta: Record<TaskStatus, { label: string; cls: string }> = {
  pending:     { label: "قيد الانتظار", cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "قيد التنفيذ", cls: "bg-info/15 text-info" },
  done:        { label: "منجزة", cls: "bg-success/15 text-success" },
};

const today = () => new Date().toISOString().slice(0, 10);

export default function DailyTasks() {
  const [filterDate, setFilterDate] = useState(today());
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<Partial<DailyTask>>({ title: "", priority: "normal", due_date: today() });

  const { data: tasks = [], isLoading } = useDailyTasks({ date: filterDate, status: filterStatus });
  const create = useCreateTask();
  const update = useUpdateTask();
  const del = useDeleteTask();

  const grouped = useMemo(() => ({
    urgent: tasks.filter(t => t.priority === "urgent" && t.status !== "done"),
    pending: tasks.filter(t => t.status !== "done" && t.priority !== "urgent"),
    done: tasks.filter(t => t.status === "done"),
  }), [tasks]);

  const toggleStatus = (t: DailyTask) => {
    const next: TaskStatus = t.status === "done" ? "pending" : t.status === "pending" ? "in_progress" : "done";
    update.mutate({ id: t.id, status: next });
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = tasks.map((t, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(t.title)}</td>
        <td>${escapeHtml(t.description ?? "")}</td>
        <td style="text-align:center">${priorityMeta[t.priority].label}</td>
        <td style="text-align:center">${statusMeta[t.status].label}</td>
        <td style="text-align:center">${t.due_date}</td>
        <td style="width:60px;border:1px solid #999;height:24px"></td>
      </tr>`).join("");
    win.document.write(buildHtmlWithPageMarginStyle(`
      <html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>مهام ${filterDate}</title>
      <style>
        @page{size:A4;margin:0}
        *{box-sizing:border-box}
        body{font-family:'Segoe UI',Tahoma,Arial;margin:0;color:#111;background:#fff}
        .page{width:210mm;min-height:297mm;margin:0 auto;padding:15mm 18mm;background:#fff}
        h1{margin:0 0 4px;font-size:20px}
        .sub{color:#666;font-size:12px;margin-bottom:14px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top}
        th{background:#f5f5f5;text-align:right}
        .stat{display:inline-block;margin-inline-start:8px;padding:2px 8px;border-radius:4px;background:#eee}
      </style></head><body><div class="page">
      <h1>📋 مهام اليوم</h1>
      <div class="sub">التاريخ: ${filterDate} • العدد: ${tasks.length}
        <span class="stat">عاجلة: ${grouped.urgent.length}</span>
        <span class="stat">منجزة: ${grouped.done.length}</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>العنوان</th><th>الوصف</th><th>الأولوية</th><th>الحالة</th><th>التاريخ</th><th>توقيع</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px">لا توجد مهام</td></tr>'}</tbody>
      </table>
      <script>setTimeout(()=>window.print(),300)</script>
      </div></body></html>`));
    win.document.close();
  };

  const submit = () => {
    if (!edit.title?.trim()) return;
    create.mutate(edit, { onSuccess: () => { setShowAdd(false); setEdit({ title: "", priority: "normal", due_date: today() }); } });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ListTodo className="text-primary" /> مهام اليوم</h1>
          <p className="text-sm text-muted-foreground">تذكير صباحي يومي • طباعة كاملة • أولويات وحالات</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-auto" />
          <Button variant="outline" onClick={handlePrint} className="gap-2"><Printer size={16} /> طباعة المهام</Button>
          <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus size={16} /> مهمة جديدة</Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي</div><div className="text-2xl font-bold">{tasks.length}</div></Card>
        <Card className="p-3 border-destructive/30"><div className="text-xs text-destructive">عاجلة</div><div className="text-2xl font-bold text-destructive">{grouped.urgent.length}</div></Card>
        <Card className="p-3 border-info/30"><div className="text-xs text-info">قيد التنفيذ</div><div className="text-2xl font-bold text-info">{tasks.filter(t=>t.status==="in_progress").length}</div></Card>
        <Card className="p-3 border-success/30"><div className="text-xs text-success">منجزة</div><div className="text-2xl font-bold text-success">{grouped.done.length}</div></Card>
      </div>

      <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
        <TabsList>
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="pending">قيد الانتظار</TabsTrigger>
          <TabsTrigger value="in_progress">قيد التنفيذ</TabsTrigger>
          <TabsTrigger value="done">منجزة</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-2">
        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground">جاري التحميل…</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ListTodo size={36} className="mx-auto mb-2 opacity-30" />
            لا توجد مهام لهذا اليوم. اضغط "مهمة جديدة" للإضافة.
          </div>
        ) : (
          <ul className="divide-y">
            {tasks.map((t) => (
              <li key={t.id} className={`flex items-start gap-3 p-3 hover:bg-muted/30 ${t.status === "done" ? "opacity-60" : ""}`}>
                <button onClick={() => toggleStatus(t)} className="mt-0.5 text-primary">
                  {t.status === "done" ? <CheckCircle2 size={20} /> : t.status === "in_progress" ? <Clock size={20} /> : <Circle size={20} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${t.status === "done" ? "line-through" : ""}`}>{t.title}</div>
                  {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] ${priorityMeta[t.priority].cls}`}>
                      <Flag size={10} className="me-1" />{priorityMeta[t.priority].label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${statusMeta[t.status].cls}`}>{statusMeta[t.status].label}</Badge>
                    <span className="text-[10px] text-muted-foreground">{t.due_date}</span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => { if (confirm("حذف المهمة؟")) del.mutate(t.id); }}>
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>مهمة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>العنوان *</Label><Input value={edit.title ?? ""} onChange={(e) => setEdit(s => ({ ...s, title: e.target.value }))} placeholder="مثال: متابعة مطالبة وفاء" /></div>
            <div><Label>الوصف</Label><Textarea value={edit.description ?? ""} onChange={(e) => setEdit(s => ({ ...s, description: e.target.value }))} rows={3} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>التاريخ</Label><Input type="date" value={edit.due_date ?? today()} onChange={(e) => setEdit(s => ({ ...s, due_date: e.target.value }))} /></div>
              <div><Label>الأولوية</Label>
                <Select value={edit.priority ?? "normal"} onValueChange={(v) => setEdit(s => ({ ...s, priority: v as TaskPriority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">عاجل</SelectItem>
                    <SelectItem value="high">مرتفع</SelectItem>
                    <SelectItem value="normal">عادي</SelectItem>
                    <SelectItem value="low">منخفض</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={!edit.title?.trim() || create.isPending}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
