import { useEffect, useState } from "react";
import { Users, Star, Wrench, BarChart3, Edit, Trash2, Plus } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { staffStore, type Technician } from "@/lib/staffStore";
import { moveToTrash } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";

const empty: Technician = { id: "", name: "", role: "", completedThisMonth: 0, rating: 5, currentCar: "-", status: "متاح", totalCompleted: 0 };

export default function Staff() {
  const [list, setList] = useState<Technician[]>(staffStore.getAll());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [form, setForm] = useState<Technician>(empty);
  const [deleting, setDeleting] = useState<Technician | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => staffStore.subscribe(() => setList([...staffStore.getAll()])), []);

  function openNew() { setForm({ ...empty, id: `T-${Date.now()}` }); setEditing(null); setShowForm(true); }
  function openEdit(t: Technician) { setForm(t); setEditing(t); setShowForm(true); }
  function handleSave() {
    if (!form.name) { toast.error("الاسم مطلوب"); return; }
    if (editing) staffStore.update(editing.id, form);
    else staffStore.add(form);
    toast.success("تم الحفظ");
    setShowForm(false);
  }
  function handleDelete() {
    if (!deleting) return;
    const r = staffStore.remove(deleting.id);
    if (r) { moveToTrash({ type: "staff", entityId: r.id, label: `${r.name} - ${r.role}`, payload: r }); toast.success("تم النقل للمهملات"); }
    setDeleting(null);
  }

  const avg = list.length ? (list.reduce((a, b) => a + b.rating, 0) / list.length).toFixed(1) : "0";
  const best = list.sort((a, b) => b.rating - a.rating)[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الفنيين والموظفين</h1>
          <p className="text-sm text-muted-foreground">إدارة فريق العمل ومتابعة الأداء</p>
        </div>
        {allowEdit && (
          <Button onClick={openNew} className="gradient-gold text-primary-foreground gap-2"><Plus size={16} /> فني جديد</Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي الفنيين" value={list.length} icon={Users} variant="info" />
        <StatCard title="يعملون حالياً" value={list.filter((t) => t.status === "يعمل").length} icon={Wrench} variant="gold" />
        <StatCard title="أفضل فني" value={best?.name || "-"} icon={Star} variant="success" />
        <StatCard title="متوسط التقييم" value={avg} icon={BarChart3} variant="info" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.map((tech) => (
          <div key={tech.id} className="bg-card border border-border rounded-xl p-4 shadow-card hover:border-primary/20 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full gradient-gold flex items-center justify-center text-sm font-bold text-primary-foreground">{tech.name.charAt(0)}</div>
                <div>
                  <p className="text-foreground font-semibold">{tech.name}</p>
                  <p className="text-xs text-muted-foreground">{tech.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tech.status === "يعمل" ? "bg-success/15 text-success" : "bg-info/15 text-info"}`}>{tech.status}</span>
                {allowEdit && <button onClick={() => openEdit(tech)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-info" title="تعديل"><Edit size={14} /></button>}
                {allowDelete && <button onClick={() => setDeleting(tech)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف"><Trash2 size={14} /></button>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-secondary/50 rounded-lg p-2">
                <p className="text-lg font-bold text-foreground">{tech.completedThisMonth}</p>
                <p className="text-[10px] text-muted-foreground">هذا الشهر</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-2">
                <p className="text-lg font-bold text-foreground">{tech.totalCompleted}</p>
                <p className="text-[10px] text-muted-foreground">إجمالي</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-2">
                <p className="text-lg font-bold text-primary">★ {tech.rating}</p>
                <p className="text-[10px] text-muted-foreground">التقييم</p>
              </div>
            </div>
            {tech.currentCar !== "-" && (
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                <Wrench size={12} /> يعمل على: {tech.currentCar}
              </p>
            )}
          </div>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">{editing ? `تعديل ${editing.name}` : "فني جديد"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <Field label="الاسم *"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="التخصص"><Input value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="الحالة"><Input value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="bg-secondary border-border" placeholder="يعمل / متاح" /></Field>
            <Field label="السيارة الحالية"><Input value={form.currentCar} onChange={e => setForm({ ...form, currentCar: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="مكتمل هذا الشهر"><Input type="number" value={form.completedThisMonth} onChange={e => setForm({ ...form, completedThisMonth: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
            <Field label="إجمالي مكتمل"><Input type="number" value={form.totalCompleted} onChange={e => setForm({ ...form, totalCompleted: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
            <Field label="التقييم (0-5)"><Input type="number" step="0.1" min="0" max="5" value={form.rating} onChange={e => setForm({ ...form, rating: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ</Button>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-border">إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.name || ""}`}
        description="سيتم نقل الموظف لسلة المهملات."
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
