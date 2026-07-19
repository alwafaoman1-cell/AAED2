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
import { deleteVehicleFromCloud, saveVehicleToCloud, vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import ArchivedVehicleDetails from "@/components/vehicles/ArchivedVehicleDetails";
import PlateInput from "@/components/vehicles/PlateInput";
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

  const { active, archiveVehicles } = useMemo(() => {
    const matches = (v: Vehicle) =>
      v.plate.includes(search) || v.owner.includes(search) || v.vin.includes(search);
    const filtered = list.filter(matches);
    return {
      active: filtered.filter((v) => !v.archived),
      archiveVehicles: filtered,
    };
  }, [list, search]);

  const bulk = useBulkSelection(archiveVehicles);
  async function handleBulkDelete() {
    const items = bulk.selectedItems;
    for (const v of items) {
      try {
        await deleteVehicleFromCloud(v, "Bulk archive vehicle");
      } catch (error: any) {
        toast.error(error?.message || `طھط¹ط°ط± ط­ط°ظپ ط§ظ„ظ…ط±ظƒط¨ط© ${v.plate} ظپظٹ Supabase`);
        return;
      }
    }
    toast.success(`طھظ… ظ†ظ‚ظ„ ${items.length} ط³ظٹط§ط±ط© ط¥ظ„ظ‰ ط£ط±ط´ظٹظپ ط§ظ„ط³ظٹط§ط±ط§طھ`);
    bulk.clear();
  }
  function handleBulkExport() {
    exportRowsAsCsv(
      `vehicles-archive-${new Date().toISOString().slice(0, 10)}`,
      ["ط§ظ„ظ„ظˆط­ط©", "ط§ظ„ظ†ظˆط¹", "VIN", "ط§ظ„ظ…ط§ظ„ظƒ", "ط§ظ„ط²ظٹط§ط±ط§طھ", "ط¢ط®ط± ط²ظٹط§ط±ط©", "ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظ†ظپط§ظ‚", "ط³ط¨ط¨ ط§ظ„ط£ط±ط´ظپط©"],
      bulk.selectedItems.map((v) => [v.plate, v.type, v.vin, v.owner, v.visits, v.lastVisit, v.totalSpent, v.archivedReason || ""]),
    );
  }

  function openNew() { setForm({ ...empty, id: "" }); setEditing(null); setShowForm(true); }
  function openEdit(v: Vehicle) { setForm(v); setEditing(v); setShowForm(true); }
  async function handleSave() {
    if (!form.plate || !form.owner) { toast.error("ط§ظ„ظ„ظˆط­ط© ظˆط§ظ„ظ…ط§ظ„ظƒ ظ…ط·ظ„ظˆط¨ط§ظ†"); return; }
    try {
      await saveVehicleToCloud({ ...form, id: form.plate || form.id, cloudId: editing?.cloudId || form.cloudId }, { previousPlate: editing?.plate });
      toast.success(editing ? "طھظ… ط§ظ„طھط­ط¯ظٹط«" : "طھظ…طھ ط§ظ„ط¥ط¶ط§ظپط©");
    } catch (error: any) {
      toast.error(error?.message || "طھط¹ط°ط± ط­ظپط¸ ط§ظ„ظ…ط±ظƒط¨ط© ظپظٹ Supabase");
      return;
    }
    setShowForm(false);
  }
  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteVehicleFromCloud(deleting, "Archive vehicle");
      toast.success("طھظ… ظ†ظ‚ظ„ ط§ظ„ط³ظٹط§ط±ط© ط¥ظ„ظ‰ ط£ط±ط´ظٹظپ ط§ظ„ط³ظٹط§ط±ط§طھ");
    } catch (error: any) {
      toast.error(error?.message || "طھط¹ط°ط± ط­ط°ظپ ط§ظ„ظ…ط±ظƒط¨ط© ظپظٹ Supabase");
    }
    setDeleting(null);
  }
  async function handleRestore(v: Vehicle, editAfterRestore = false) {
    const restored: Vehicle = {
      ...v,
      archived: false,
      archivedAt: undefined,
      archivedReason: undefined,
    };
    try {
      await saveVehicleToCloud(restored, { previousPlate: v.plate });
      vehiclesStore.update(v.id, restored);
      toast.success(`طھظ…طھ ط§ط³طھط¹ط§ط¯ط© "${v.plate}" ط¥ظ„ظ‰ ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ط±ظƒط¨ط§طھ ط§ظ„ظ†ط´ط·ط©`);
      if (editAfterRestore) {
        setEditing(restored);
        setForm(restored);
        setShowForm(true);
      }
    } catch (error: any) {
      toast.error(error?.message || "طھط¹ط°ط± ط§ط³طھط¹ط§ط¯ط© ط§ظ„ظ…ط±ظƒط¨ط© ظپظٹ Supabase");
    }
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
                <p className="text-xs text-muted-foreground">ط§ظ„ظ„ظˆط­ط©: <span className="font-mono">{v.plate}</span> | ط§ظ„ظ…ط§ظ„ظƒ: {v.owner}</p>
                <p className="text-[10px] text-muted-foreground font-mono">VIN: {v.vin}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
              <span className="flex items-center gap-1"><History size={12} /> {v.visits} ط²ظٹط§ط±ط§طھ</span>
              <span>ط¢ط®ط± ط²ظٹط§ط±ط©: {v.lastVisit}</span>
              <span className="text-primary font-semibold">{formatMoney(v.totalSpent)}</span>
              {allowEdit && <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-info" title="طھط¹ط¯ظٹظ„"><Edit size={14} /></button>}
              {allowDelete && <button onClick={() => setDeleting(v)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="ط­ط°ظپ"><Trash2 size={14} /></button>}
              <ChevronLeft size={16} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </div>
          </div>
        </div>
      );
    }

    // â”€â”€ Archived: detailed full-info card â”€â”€
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
                  <p className="text-foreground font-bold text-base group-hover:text-primary transition-colors">{v.type || "â€”"}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${v.archived ? "bg-muted text-muted-foreground border-border" : "bg-success/10 text-success border-success/30"}`}>
                    {v.archived ? "مؤرشفة" : "نشطة / مرتبطة"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-foreground font-mono border border-border">{v.plate}</span>
                  {v.year && <span className="text-[11px] text-muted-foreground">{v.year}</span>}
                  {v.color && <span className="text-[11px] text-muted-foreground">â€¢ {v.color}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {allowEdit && v.archived && (
                <Button size="sm" variant="outline" onClick={() => handleRestore(v)} className="gap-1 h-8" title="ط§ط³طھط¹ط§ط¯ط© ط§ظ„ظ…ط±ظƒط¨ط©">
                  <RotateCcw size={12} /> ط§ط³طھط¹ط§ط¯ط© ط§ظ„ظ…ط±ظƒط¨ط©
                </Button>
              )}
              {allowEdit && v.archived && (
                <Button size="sm" variant="secondary" onClick={() => handleRestore(v, true)} className="gap-1 h-8" title="ط§ط³طھط¹ط§ط¯ط© ط«ظ… طھط¹ط¯ظٹظ„">
                  <Edit size={12} /> طھط¹ط¯ظٹظ„ ط¨ط¹ط¯ ط§ظ„ط§ط³طھط¹ط§ط¯ط©
                </Button>
              )}
              {allowEdit && !v.archived && (
                <Button size="sm" variant="secondary" onClick={() => openEdit(v)} className="gap-1 h-8" title="طھط¹ط¯ظٹظ„ ط§ظ„ظ…ط±ظƒط¨ط©">
                  <Edit size={12} /> طھط¹ط¯ظٹظ„
                </Button>
              )}
              {allowDelete && <button onClick={() => setDeleting(v)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="ط­ط°ظپ"><Trash2 size={14} /></button>}
            </div>
          </div>

          {/* Detail grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <DetailItem label="ط§ظ„ظ…ط§ظ„ظƒ" value={v.owner || "â€”"} />
            <DetailItem label="ظ‡ط§طھظپ ط§ظ„ظ…ط§ظ„ظƒ" value={v.ownerPhone || "â€”"} mono />
            <DetailItem label="ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„ (VIN)" value={v.vin || "â€”"} mono />
            <DetailItem label="ط¹ط¯ط§ط¯ ط§ظ„ظ…ط³ط§ظپط©" value={v.mileage ? `${v.mileage} ظƒظ…` : "â€”"} />
            <DetailItem label="ط¹ط¯ط¯ ط§ظ„ط²ظٹط§ط±ط§طھ" value={String(v.visits || 0)} />
            <DetailItem label="ط¢ط®ط± ط²ظٹط§ط±ط©" value={v.lastVisit || "â€”"} />
            <DetailItem label="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظ†ظپط§ظ‚" value={formatMoney(v.totalSpent || 0)} highlight />
            <DetailItem label="طµظˆط± ظ…ظˆط«ظ‚ط©" value={String(photosCount)} />
          </div>

          {/* Archive meta */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-border text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <Archive size={12} className="text-primary/60" />
              <span>ط£ظڈط±ط´ظپطھ ظپظٹ: {v.archivedAt ? new Date(v.archivedAt).toLocaleDateString("en-GB") : "â€”"}</span>
            </div>
            {v.archivedReason && (
              <span className="bg-secondary/40 px-2 py-1 rounded border border-border">ط§ظ„ط³ط¨ط¨: {v.archivedReason}</span>
            )}
          </div>

          {v.notes && (
            <div className="text-xs bg-secondary/30 border border-border rounded p-2 text-foreground">
              <span className="text-[10px] text-muted-foreground">ظ…ظ„ط§ط­ط¸ط§طھ: </span>{v.notes}
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
          <TabsTrigger value="active" className="gap-1 data-[state=active]:bg-card"><Car size={14} /> ط§ظ„ظ†ط´ط·ط© <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{active.length}</span></TabsTrigger>
          <TabsTrigger value="archive" className="gap-1 data-[state=active]:bg-card"><Archive size={14} /> أرشيف كل السيارات <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{archiveVehicles.length}</span></TabsTrigger>
          <TabsTrigger value="tracking" className="gap-1 data-[state=active]:bg-card"><MapPin size={14} /> طھطھط¨ط¹ ط§ظ„ط­ط§ظ„ط©</TabsTrigger>
        </TabsList>

        <div className="relative max-w-md mt-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ط¨ط­ط« ط¨ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©طŒ ط§ط³ظ… ط§ظ„ظ…ط§ظ„ظƒطŒ ط£ظˆ ط±ظ‚ظ… ط§ظ„ظ‡ظٹظƒظ„..." className="pr-9 bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>

        <TabsContent value="active" className="space-y-4 mt-4">
          <div className="grid gap-4">
            {active.map((v) => renderCard(v, false))}
            {active.length === 0 && <div className="text-center py-12 text-muted-foreground"><Car size={40} className="mx-auto mb-3 opacity-30" /><p>ظ„ط§ طھظˆط¬ط¯ ط³ظٹط§ط±ط§طھ ظ†ط´ط·ط©</p></div>}
          </div>
        </TabsContent>

        <TabsContent value="archive" className="space-y-4 mt-4">
          <div className="text-xs text-foreground bg-secondary/40 border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <Archive size={14} className="text-primary" /> ظ…ط§ ط§ظ„ظپط§ط¦ط¯ط© ظ…ظ† ط§ظ„ط£ط±ط´ظٹظپطں
            </div>
            <ul className="list-disc mr-5 text-muted-foreground space-y-1 leading-relaxed">
              <li>ظٹط­ط§ظپط¸ ط¹ظ„ظ‰ ط§ظ„ظ‚ط§ط¦ظ…ط© ط§ظ„ظ†ط´ط·ط© ظ†ط¸ظٹظپط© ظˆط³ط±ظٹط¹ط© (ط§ظ„ط³ظٹط§ط±ط§طھ ط§ظ„طھظٹ ط§ظ†طھظ‡ظ‰ ط¹ظ…ظ„ظ‡ط§ ظ„ط§ طھط´ط؛ظ„ ط§ظ„ظ…ظƒط§ظ†).</li>
              <li>طھظ†طھظ‚ظ„ ط§ظ„ط³ظٹط§ط±ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ظ„ظ„ط£ط±ط´ظٹظپ ط¹ظ†ط¯ <b>ط¥ط؛ظ„ط§ظ‚ ط£ظˆ طھط³ظ„ظٹظ… ط¬ظ…ظٹط¹</b> ط£ظˆط§ظ…ط± ط¹ظ…ظ„ظ‡ط§.</li>
              <li>ط§ظ„ط£ط±ط´ظٹظپ ظ„ظٹط³ ط­ط°ظپط§ظ‹ â€” ظٹظ…ظƒظ†ظƒ ط¥ط±ط¬ط§ط¹ ط§ظ„ط³ظٹط§ط±ط© ظپظٹ ط£ظٹ ظˆظ‚طھ ط¨ط²ط± "ط¥ط±ط¬ط§ط¹" ظˆظپطھط­ ط£ظ…ط± ط¹ظ…ظ„ ط¬ط¯ظٹط¯ ظ„ظ‡ط§.</li>
              <li>طھط¸ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظٹط§ط±ط© (ط§ظ„ط²ظٹط§ط±ط§طھطŒ ط§ظ„طµظˆط±طŒ ط§ظ„ظپظˆط§طھظٹط±) ظ…ط­ظپظˆط¸ط© ط¨ط§ظ„ظƒط§ظ…ظ„ ظˆطھط¸ظ‡ط± ظپظٹ طھظ‚ط§ط±ظٹط± ط§ظ„ط¹ظ…ظٹظ„ ظˆط³ط¬ظ„ ط§ظ„ظ…ط±ظƒط¨ط§طھ.</li>
              <li>ظٹظ…ظƒظ†ظƒ ط¥ط¶ط§ظپط© ط³ظٹط§ط±ط© ط¨ط­ظ‚ظˆظ„ ط¨ط³ظٹط·ط© ظ…ط¨ط§ط´ط±ط© ظ‡ظ†ط§ (ظ…ط«ظ„ط§ظ‹ ط³ظٹط§ط±ط© ظ‚ط¯ظٹظ…ط© ظ„ط¹ظ…ظٹظ„ ط¨ط¯ظˆظ† VIN ظƒط§ظ…ظ„) ط«ظ… طھط¹ط¯ظٹظ„ظ‡ط§ ظ„ط§ط­ظ‚ط§ظ‹.</li>
            </ul>
            {allowEdit && (
              <div className="pt-1">
                <Button size="sm" variant="outline" onClick={openNew} className="gap-1 h-7">
                  <Plus size={12} /> ط¥ط¶ط§ظپط© ط³ظٹط§ط±ط© ط¨ط­ظ‚ظˆظ„ ط¨ط³ظٹط·ط©
                </Button>
              </div>
            )}
          </div>
          {archiveVehicles.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} />
              <span>تحديد الكل ({archiveVehicles.length})</span>
            </div>
          )}
          <div className="grid gap-4">
            {archiveVehicles.map((v) => renderCard(v, true))}
            {archiveVehicles.length === 0 && <div className="text-center py-12 text-muted-foreground"><Archive size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد سيارات مسجلة</p></div>}
          </div>
        </TabsContent>

        <TabsContent value="tracking" className="mt-4"><VehicleTracking /></TabsContent>
      </Tabs>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="ط³ظٹط§ط±ط©">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <FileSpreadsheet size={14} /> طھطµط¯ظٹط± CSV
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={handleBulkDelete}>
            <Trash2 size={14} /> ط­ط°ظپ
          </Button>
        )}
      </BulkActionBar>


      {/* Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">{editing ? `طھط¹ط¯ظٹظ„ ${editing.plate}` : "ط³ظٹط§ط±ط© ط¬ط¯ظٹط¯ط©"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <Field label="ط§ظ„ظ„ظˆط­ط© *"><PlateInput value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} excludeId={editing?.id} /></Field>
            <Field label="ط§ظ„ظ…ط§ظ„ظƒ *"><Input value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="ظ†ظˆط¹/ظ…ظˆط¯ظٹظ„"><Input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="bg-secondary border-border" /></Field>
            <Field label="VIN"><Input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })} className="bg-secondary border-border font-mono" /></Field>
            <Field label="ط¹ط¯ط¯ ط§ظ„ط²ظٹط§ط±ط§طھ"><Input type="number" value={form.visits} onChange={e => setForm({ ...form, visits: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
            <Field label="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظ†ظپط§ظ‚"><Input type="number" value={form.totalSpent} onChange={e => setForm({ ...form, totalSpent: Number(e.target.value) })} className="bg-secondary border-border" /></Field>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">ط­ظپط¸</Button>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-border">ط¥ظ„ط؛ط§ط،</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`ط­ط°ظپ ط§ظ„ط³ظٹط§ط±ط© ${deleting?.plate || ""}`}
        description={`ط³ظٹطھظ… ظ†ظ‚ظ„ ط³ظٹط§ط±ط© "${deleting?.owner || ""}" ط¥ظ„ظ‰ ط£ط±ط´ظٹظپ ط§ظ„ط³ظٹط§ط±ط§طھ.`}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
