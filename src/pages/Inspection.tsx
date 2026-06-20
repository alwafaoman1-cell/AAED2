import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, Plus, FileText, Camera, Eye, Edit, Trash2, Link as LinkIcon, X, ShieldCheck, FileSpreadsheet, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import InspectionFormDialog from "@/components/inspection/InspectionFormDialog";
import PhotoAlbumPdfDialog from "@/components/inspection/PhotoAlbumPdfDialog";


import { inspectionsStore, normalizePlate, type InspectionRecord } from "@/lib/inspectionsStore";
import { moveToTrash } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  "مكتمل": "bg-success/15 text-success",
  "قيد الفحص": "bg-warning/15 text-warning",
};

const empty: InspectionRecord = { id: "", workOrder: "", customer: "", vehicle: "", date: new Date().toISOString().split("T")[0], damageType: "", photos: 0, status: "قيد الفحص" };

export default function Inspection() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [showAlbum, setShowAlbum] = useState(false);
  

  
  const [preselectOrderId, setPreselectOrderId] = useState<string | undefined>(undefined);
  const [list, setList] = useState<InspectionRecord[]>(inspectionsStore.getAll());
  const [editing, setEditing] = useState<InspectionRecord | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<InspectionRecord>(empty);
  const [search, setSearch] = useState("");
  const [woFilter, setWoFilter] = useState<string>("");
  const [deleting, setDeleting] = useState<InspectionRecord | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => inspectionsStore.subscribe(() => setList([...inspectionsStore.getAll()])), []);

  // التقاط بارامترات الرابط القادمة من /workorders
  useEffect(() => {
    const isNew = searchParams.get("new");
    const wo = searchParams.get("wo");
    if (isNew === "1") {
      const linkedOrder = sessionStorage.getItem("inspection_link_order") || undefined;
      setPreselectOrderId(linkedOrder);
      setShowForm(true);
      sessionStorage.removeItem("inspection_link_order");
      // تنظيف الرابط
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    if (wo) {
      setWoFilter(wo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    // إزالة التكرار: فحص واحد لكل سيارة (نفس اللوحة + نفس النوع) — نُبقي الأحدث
    const dedupMap = new Map<string, InspectionRecord>();
    [...list]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .forEach((i) => {
        const key = `${i.kind || "general"}::${normalizePlate(i.plate || i.vehicle) || i.id}`;
        dedupMap.set(key, i);
      });
    const deduped = Array.from(dedupMap.values()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return deduped.filter((i) => {
      if (woFilter && i.workOrder !== woFilter) return false;
      if (!search) return true;
      return i.id.includes(search) || i.customer.includes(search) || i.workOrder.includes(search) || i.vehicle.includes(search);
    });
  }, [list, search, woFilter]);

  const bulk = useBulkSelection(filtered);


  function handleOpenReport(ins: InspectionRecord) {
    navigate(`/inspection/${encodeURIComponent(ins.id)}/report`);
  }

  function openEdit(ins: InspectionRecord) {
    if (ins.kind === "insurance") {
      navigate(`/inspection/insurance/new?edit=${encodeURIComponent(ins.id)}`);
      return;
    }
    setEditForm(ins); setEditing(ins); setShowEdit(true);
  }
  function handleSaveEdit() {
    if (editing) {
      const changed: string[] = [];
      if (editing.status !== editForm.status) changed.push(`الحالة: ${editing.status} → ${editForm.status}`);
      if (editing.damageType !== editForm.damageType) changed.push(`نوع الضرر`);
      if (editing.photos !== editForm.photos) changed.push(`عدد الصور: ${editing.photos} → ${editForm.photos}`);
      inspectionsStore.update(editing.id, editForm);
      logActivity({
        action: "update",
        entity: "inspection",
        entityId: editing.id,
        label: `${editForm.customer} — ${editForm.vehicle}`,
        description: changed.length > 0 ? changed.join(" • ") : "تحديث بيانات الفحص",
      });
      toast.success("تم التحديث");
    }
    setShowEdit(false);
  }
  function handleDelete() {
    if (!deleting) return;
    const r = inspectionsStore.remove(deleting.id);
    if (r) {
      moveToTrash({ type: "inspection", entityId: r.id, label: `${r.customer} - ${r.vehicle}`, payload: r });
      logActivity({
        action: "delete",
        entity: "inspection",
        entityId: r.id,
        label: `${r.customer} — ${r.vehicle}`,
        description: "نقل للمهملات",
      });
      toast.success("تم النقل للمهملات");
    }
    setDeleting(null);
  }

  function handleOpenNew() {
    setPreselectOrderId(undefined);
    setShowForm(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الفحص والمعاينة</h1>
          <p className="text-sm text-muted-foreground">إدارة تقارير الفحص وتوثيق الأضرار</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setShowAlbum(true)} variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 gap-2">
            <Images size={18} /> ألبوم صور PDF
          </Button>
          <Button onClick={() => navigate("/inspection/insurance/new")} variant="outline" className="border-info/40 text-info hover:bg-info/10 gap-2">
            <ShieldCheck size={18} /> فحص تأمين / Insurance
          </Button>
          <Button onClick={handleOpenNew} className="gradient-gold text-primary-foreground shadow-gold hover:opacity-90 gap-2">
            <Plus size={18} /> فحص عام
          </Button>
        </div>

      </div>

      {woFilter && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
          <LinkIcon size={14} className="text-primary" />
          <span className="text-xs text-foreground">عرض الفحوصات المرتبطة بأمر العمل: <span className="font-mono text-primary">{woFilter}</span></span>
          <button
            type="button"
            onClick={() => setWoFilter("")}
            className="ml-auto p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            title="إزالة الفلتر"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 max-w-3xl">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في تقارير الفحص..." className="pr-9 bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={bulk.allChecked} onCheckedChange={() => bulk.toggleAll()} />
            تحديد الكل
          </label>
        )}
      </div>

      <div className="grid gap-4">

        {filtered.map((ins) => (
          <div key={ins.id} className={`bg-card border border-border rounded-xl p-4 shadow-card hover:border-primary/20 transition-colors ${bulk.isSelected(ins.id) ? "ring-2 ring-primary/30" : ""}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Checkbox className="mt-1" checked={bulk.isSelected(ins.id)} onCheckedChange={() => bulk.toggle(ins.id)} />
                <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-primary">{ins.id}</span>
                  {ins.kind === "insurance" && (
                    <span
                      title="فحص تأمين / Insurance Inspection"
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-info/15 text-info border border-info/30"
                    >
                      <ShieldCheck size={11} /> Insurance
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">← {ins.workOrder}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColors[ins.status] || "bg-muted text-muted-foreground"}`}>{ins.status}</span>
                </div>
                <p className="text-foreground font-medium">{ins.customer} — {ins.vehicle}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>نوع الضرر: {ins.damageType}</span>
                  <span className="flex items-center gap-1"><Camera size={12} /> {ins.photos} صورة</span>
                  <span>{ins.date}</span>
                </div>
              </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="border-border text-foreground hover:bg-secondary gap-1 text-xs" onClick={() => handleOpenReport(ins)}>
                  <Eye size={14} /> معاينة
                </Button>
                <Button variant="outline" size="sm" className="border-border text-foreground hover:bg-secondary gap-1 text-xs" onClick={() => handleOpenReport(ins)}>
                  <FileText size={14} /> التقرير
                </Button>
                {allowEdit && <button onClick={() => openEdit(ins)} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-info" title="تعديل"><Edit size={14} /></button>}
                {allowDelete && <button onClick={() => setDeleting(ins)} className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف"><Trash2 size={14} /></button>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground"><Search size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد تقارير</p></div>}
      </div>

      <PhotoAlbumPdfDialog open={showAlbum} onOpenChange={setShowAlbum} />

      <InspectionFormDialog

        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) setPreselectOrderId(undefined); }}
        preselectOrderId={preselectOrderId}
      />
      


      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">تعديل {editing?.id}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <Field label="رقم أمر العمل"><Input value={editForm.workOrder} onChange={e => setEditForm({ ...editForm, workOrder: e.target.value })} className="bg-secondary border-border font-mono" /></Field>
            <Field label="العميل"><Input value={editForm.customer} onChange={e => setEditForm({ ...editForm, customer: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="المركبة"><Input value={editForm.vehicle} onChange={e => setEditForm({ ...editForm, vehicle: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="نوع الضرر"><Input value={editForm.damageType} onChange={e => setEditForm({ ...editForm, damageType: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="عدد الصور"><Input type="number" value={editForm.photos} onChange={e => setEditForm({ ...editForm, photos: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
            <Field label="الحالة"><Input value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} className="bg-secondary border-border" /></Field>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSaveEdit} className="gradient-gold text-primary-foreground flex-1">حفظ</Button>
            <Button variant="outline" onClick={() => setShowEdit(false)} className="border-border">إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف تقرير ${deleting?.id || ""}`}
        description="سيتم نقل التقرير لسلة المهملات."
      />

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="تقرير">
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => {
          const rows = bulk.selectedItems.map((i) => [i.id, i.workOrder, i.customer, i.vehicle, i.damageType, i.photos, i.status, i.date]);
          exportRowsAsCsv(`inspections-${new Date().toISOString().slice(0,10)}`, ["رقم","أمر العمل","العميل","المركبة","نوع الضرر","صور","الحالة","التاريخ"], rows);
          toast.success(`تم تصدير ${rows.length} تقرير`);
        }}>
          <FileSpreadsheet size={14} /> تصدير
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => {
            if (!confirm(`حذف ${bulk.count} تقرير؟`)) return;
            bulk.selectedItems.forEach((r) => {
              inspectionsStore.remove(r.id);
              moveToTrash({ type: "inspection", entityId: r.id, label: `${r.customer} - ${r.vehicle}`, payload: r });
            });
            toast.success(`تم نقل ${bulk.count} تقرير للمهملات`);
            bulk.clear();
          }}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
