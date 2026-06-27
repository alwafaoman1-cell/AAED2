import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Car, Search, History, MapPin, Edit, Trash2, Plus, ChevronLeft, Archive, RotateCcw, FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import VehicleTracking from "@/components/tracking/VehicleTracking";
import { deleteVehicleFromCloud, saveVehicleToCloud, vehiclesStore, unarchiveVehicle, type Vehicle } from "@/lib/vehiclesStore";
import ArchivedVehicleDetails from "@/components/vehicles/ArchivedVehicleDetails";
import PlateInput from "@/components/vehicles/PlateInput";
import { moveToTrash } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { toast } from "sonner";
import { formatMoney } from "@/lib/pdfGenerator";

const empty: Vehicle = { id: "", plate: "", type: "", vin: "", owner: "", visits: 0, lastVisit: new Date().toISOString().split("T")[0], totalSpent: 0 };

function DetailItem({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="bg-secondary/30 border border-border/60 rounded-lg px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-xs ${mono ? "font-mono" : "font-medium"} ${highlight ? "text-primary font-bold" : "text-foreground"} truncate`} title={value}>{value}</div>
    </div>
  );
}

export default function Vehicles() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [list, setList] = useState<Vehicle[]>(vehiclesStore.getAll());
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Vehicle>(empty);
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => vehiclesStore.subscribe(() => setList([...vehiclesStore.getAll()])), []);

  const { active, archived } = useMemo(() => {
    const matches = (v: Vehicle) =>
      v.plate.includes(search) || v.owner.includes(search) || v.vin.includes(search);
    const filtered = list.filter(matches);
    return {
      active: filtered.filter((v) => !v.archived),
      archived: filtered.filter((v) => v.archived),
    };
  }, [list, search]);

  const bulk = useBulkSelection(archived);
  async function handleBulkDelete() {
    const items = bulk.selectedItems;
    for (const v of items) {
      try {
        const r = await deleteVehicleFromCloud(v, "Bulk soft delete vehicle");
        moveToTrash({ type: "vehicle", entityId: r.id, label: `${r.owner} - ${r.plate}`, payload: r });
      } catch (error: any) {
        toast.error(error?.message || `تعذر حذف المركبة ${v.plate} في Supabase`);
        return;
      }
    }
    toast.success(`تم نقل ${items.length} سيارة للمهملات`);
    bulk.clear();
  }
  function handleBulkExport() {
    exportRowsAsCsv(
      `vehicles-archive-${new Date().toISOString().slice(0, 10)}`,
      ["اللوحة", "النوع", "VIN", "المالك", "الزيارات", "آخر زيارة", "إجمالي الإنفاق", "سبب الأرشفة"],
      bulk.selectedItems.map((v) => [v.plate, v.type, v.vin, v.owner, v.visits, v.lastVisit, v.totalSpent, v.archivedReason || ""]),
    );
  }

  function openNew() { setForm({ ...empty, id: "" }); setEditing(null); setShowForm(true); }
  function openEdit(v: Vehicle) { setForm(v); setEditing(v); setShowForm(true); }
  async function handleSave() {
    if (!form.plate || !form.owner) { toast.error("اللوحة والمالك مطلوبان"); return; }
    try {
      await saveVehicleToCloud({ ...form, id: form.plate || form.id, cloudId: editing?.cloudId || form.cloudId }, { previousPlate: editing?.plate });
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المركبة في Supabase");
      return;
    }
    setShowForm(false);
  }
  async function handleDelete() {
    if (!deleting) return;
    try {
      const removed = await deleteVehicleFromCloud(deleting, "Soft delete vehicle");
      moveToTrash({ type: "vehicle", entityId: removed.id, label: `${removed.owner} - ${removed.plate}`, payload: removed });
      toast.success("تم النقل للمهملات");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حذف المركبة في Supabase");
    }
    setDeleting(null);
  }
  function handleRestore(v: Vehicle) {
    unarchiveVehicle(v.id);
    toast.success(`تمت إعادة "${v.plate}" إلى السيارات النشطة — يمكن إنشاء أمر عمل جديد لها الآن`);
    navigate(`/work-orders?plate=${encodeURIComponent(v.plate)}`);
  }

  const renderCard = (v: Vehicle, isArchived = false) => {
    if (!isArchived) {
      return (
        <div
          key={v.id}
          onClick={() => navigate(`/vehicles/${encodeURIComponent(v.id)}`)}
          className="bg-card border rounded-xl p-4 shadow-card hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer group border-border"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors bg-secondary group-hover:bg-primary/10">
                <Car size={20} className="text-primary" />
              </div>
              <div>
                <p className="text-foreground font-semibold group-hover:text-primary transition-colors">{v.type}</p>
                <p className="text-xs text-muted-foreground">اللوحة: <span className="font-mono">{v.plate}</span> | المالك: {v.owner}</p>
                <p className="text-[10px] text-muted-foreground font-mono">VIN: {v.vin}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
              <span className="flex items-center gap-1"><History size={12} /> {v.visits} زيارات</span>
              <span>آخر زيارة: {v.lastVisit}</span>
              <span className="text-primary font-semibold">{formatMoney(v.totalSpent)}</span>
              {allowEdit && <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-info" title="تعديل"><Edit size={14} /></button>}
              {allowDelete && <button onClick={() => setDeleting(v)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف"><Trash2 size={14} /></button>}
              <ChevronLeft size={16} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </div>
          </div>
        </div>
      );
    }

    // ── Archived: detailed full-info card ──
    const photosCount = (v.photoPairs || []).length;
    return (
      <div
        key={v.id}
        onClick={() => navigate(`/vehicles/${encodeURIComponent(v.id)}`)}
        className="bg-card border border-muted rounded-xl p-5 shadow-card hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer group"
      >
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div onClick={(e) => e.stopPropagation()} className="pt-1">
                <Checkbox checked={bulk.isSelected(v.id)} onCheckedChange={() => bulk.toggle(v.id)} />
              </div>
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-muted/40 group-hover:bg-primary/10 transition-colors shrink-0">
                <Archive size={22} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-foreground font-bold text-base group-hover:text-primary transition-colors">{v.type || "—"}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">مؤرشفة</span>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-foreground font-mono border border-border">{v.plate}</span>
                  {v.year && <span className="text-[11px] text-muted-foreground">{v.year}</span>}
                  {v.color && <span className="text-[11px] text-muted-foreground">• {v.color}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {allowEdit && (
                <Button size="sm" variant="outline" onClick={() => handleRestore(v)} className="gap-1 h-8" title="إرجاع لأوامر العمل">
                  <RotateCcw size={12} /> إرجاع
                </Button>
              )}
              {allowEdit && <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-info" title="تعديل"><Edit size={14} /></button>}
              {allowDelete && <button onClick={() => setDeleting(v)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف"><Trash2 size={14} /></button>}
            </div>
          </div>

          {/* Detail grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <DetailItem label="المالك" value={v.owner || "—"} />
            <DetailItem label="هاتف المالك" value={v.ownerPhone || "—"} mono />
            <DetailItem label="رقم الهيكل (VIN)" value={v.vin || "—"} mono />
            <DetailItem label="عداد المسافة" value={v.mileage ? `${v.mileage} كم` : "—"} />
            <DetailItem label="عدد الزيارات" value={String(v.visits || 0)} />
            <DetailItem label="آخر زيارة" value={v.lastVisit || "—"} />
            <DetailItem label="إجمالي الإنفاق" value={formatMoney(v.totalSpent || 0)} highlight />
            <DetailItem label="صور موثقة" value={String(photosCount)} />
          </div>

          {/* Archive meta */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-border text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <Archive size={12} className="text-primary/60" />
              <span>أُرشفت في: {v.archivedAt ? new Date(v.archivedAt).toLocaleDateString("en-GB") : "—"}</span>
            </div>
            {v.archivedReason && (
              <span className="bg-secondary/40 px-2 py-1 rounded border border-border">السبب: {v.archivedReason}</span>
            )}
          </div>

          {v.notes && (
            <div className="text-xs bg-secondary/30 border border-border rounded p-2 text-foreground">
              <span className="text-[10px] text-muted-foreground">ملاحظات: </span>{v.notes}
            </div>
          )}

          {/* Cloud-loaded details: work orders, claims, uploaded documents */}
          <ArchivedVehicleDetails plate={v.plate} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("vehicles.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("vehicles.subtitle", "Complete record of all vehicles and their status")}</p>
        </div>
        {allowEdit && (
          <Button onClick={openNew} className="gradient-gold text-primary-foreground gap-2"><Plus size={16} /> {t("vehicles.newVehicle", "New Vehicle")}</Button>
        )}
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="active" className="gap-1 data-[state=active]:bg-card"><Car size={14} /> النشطة <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{active.length}</span></TabsTrigger>
          <TabsTrigger value="archive" className="gap-1 data-[state=active]:bg-card"><Archive size={14} /> الأرشيف <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{archived.length}</span></TabsTrigger>
          <TabsTrigger value="tracking" className="gap-1 data-[state=active]:bg-card"><MapPin size={14} /> تتبع الحالة</TabsTrigger>
        </TabsList>

        <div className="relative max-w-md mt-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم اللوحة، اسم المالك، أو رقم الهيكل..." className="pr-9 bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>

        <TabsContent value="active" className="space-y-4 mt-4">
          <div className="grid gap-4">
            {active.map((v) => renderCard(v, false))}
            {active.length === 0 && <div className="text-center py-12 text-muted-foreground"><Car size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد سيارات نشطة</p></div>}
          </div>
        </TabsContent>

        <TabsContent value="archive" className="space-y-4 mt-4">
          <div className="text-xs text-foreground bg-secondary/40 border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <Archive size={14} className="text-primary" /> ما الفائدة من الأرشيف؟
            </div>
            <ul className="list-disc mr-5 text-muted-foreground space-y-1 leading-relaxed">
              <li>يحافظ على القائمة النشطة نظيفة وسريعة (السيارات التي انتهى عملها لا تشغل المكان).</li>
              <li>تنتقل السيارة تلقائياً للأرشيف عند <b>إغلاق أو تسليم جميع</b> أوامر عملها.</li>
              <li>الأرشيف ليس حذفاً — يمكنك إرجاع السيارة في أي وقت بزر "إرجاع" وفتح أمر عمل جديد لها.</li>
              <li>تظل بيانات السيارة (الزيارات، الصور، الفواتير) محفوظة بالكامل وتظهر في تقارير العميل وسجل المركبات.</li>
              <li>يمكنك إضافة سيارة بحقول بسيطة مباشرة هنا (مثلاً سيارة قديمة لعميل بدون VIN كامل) ثم تعديلها لاحقاً.</li>
            </ul>
            {allowEdit && (
              <div className="pt-1">
                <Button size="sm" variant="outline" onClick={openNew} className="gap-1 h-7">
                  <Plus size={12} /> إضافة سيارة بحقول بسيطة
                </Button>
              </div>
            )}
          </div>
          {archived.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} />
              <span>تحديد الكل ({archived.length})</span>
            </div>
          )}
          <div className="grid gap-4">
            {archived.map((v) => renderCard(v, true))}
            {archived.length === 0 && <div className="text-center py-12 text-muted-foreground"><Archive size={40} className="mx-auto mb-3 opacity-30" /><p>الأرشيف فارغ</p></div>}
          </div>
        </TabsContent>

        <TabsContent value="tracking" className="mt-4"><VehicleTracking /></TabsContent>
      </Tabs>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="سيارة">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <FileSpreadsheet size={14} /> تصدير CSV
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={handleBulkDelete}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>


      {/* Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">{editing ? `تعديل ${editing.plate}` : "سيارة جديدة"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <Field label="اللوحة *"><PlateInput value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} excludeId={editing?.id} /></Field>
            <Field label="المالك *"><Input value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="نوع/موديل"><Input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="VIN"><Input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })} className="bg-secondary border-border font-mono" /></Field>
            <Field label="عدد الزيارات"><Input type="number" value={form.visits} onChange={e => setForm({ ...form, visits: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
            <Field label="إجمالي الإنفاق"><Input type="number" value={form.totalSpent} onChange={e => setForm({ ...form, totalSpent: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
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
        title={`حذف السيارة ${deleting?.plate || ""}`}
        description={`سيتم نقل سيارة "${deleting?.owner || ""}" إلى سلة المهملات.`}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
