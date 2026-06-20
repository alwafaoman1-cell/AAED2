// قسم استلام المركبة — يُدمج في صفحة تفاصيل أمر العمل
import { useEffect, useState } from "react";
import { Car, Save, Camera, X, Loader2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type BelongingItem = { key: string; label_ar: string; label_en?: string };

interface Props {
  jobOrderId: string; // UUID
}

const DEFAULT_ITEMS: BelongingItem[] = [
  { key: "main_key", label_ar: "مفتاح رئيسي" },
  { key: "spare_key", label_ar: "مفتاح احتياطي" },
  { key: "spare_tire", label_ar: "استبنة" },
  { key: "tool_kit", label_ar: "عدة السيارة" },
  { key: "fire_extinguisher", label_ar: "طفاية حريق" },
  { key: "warning_triangle", label_ar: "مثلث تحذير" },
  { key: "trunk_cover", label_ar: "غطاء صندوق الأمتعة" },
  { key: "manual", label_ar: "كتيب المركبة" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function VehicleReceptionSection({ jobOrderId }: Props) {
  const isUuid = UUID_RE.test(jobOrderId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [km, setKm] = useState<string>("");
  const [fuel, setFuel] = useState<number>(50);
  const [notes, setNotes] = useState<string>("");
  const [belongings, setBelongings] = useState<Record<string, boolean | string>>({});
  const [other, setOther] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [items, setItems] = useState<BelongingItem[]>(DEFAULT_ITEMS);
  const [belongingsOpen, setBelongingsOpen] = useState(false);

  useEffect(() => {
    if (!isUuid) { setLoading(false); return; }
    (async () => {
      const [{ data: jo }, { data: settings }] = await Promise.all([
        supabase.from("job_orders")
          .select("odometer_km, fuel_level_pct, reception_notes, reception_photos, vehicle_belongings, received_at")
          .eq("id", jobOrderId).maybeSingle(),
        supabase.from("workshop_belongings_settings").select("items").maybeSingle(),
      ]);
      if (jo) {
        setKm(jo.odometer_km != null ? String(jo.odometer_km) : "");
        setFuel(jo.fuel_level_pct ?? 50);
        setNotes(jo.reception_notes || "");
        const b = (jo.vehicle_belongings as any) || {};
        setBelongings(b);
        setOther(typeof b.other === "string" ? b.other : "");
        setPhotos(Array.isArray(jo.reception_photos) ? (jo.reception_photos as any) : []);
      }
      if (settings?.items) setItems(settings.items as any);
      setLoading(false);
    })();
  }, [jobOrderId, isUuid]);

  async function handlePhotoUpload(file: File) {
    setUploadingPhoto(true);
    try {
      const path = `reception/${jobOrderId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
      const { error } = await supabase.storage.from("damage-photos").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("damage-photos").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (signed?.signedUrl) setPhotos((p) => [...p, signed.signedUrl]);
      toast.success("تم رفع الصورة");
    } catch (e: any) {
      toast.error(e.message || "فشل رفع الصورة");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function save() {
    if (!isUuid) { toast.error("هذا الأمر غير مزامن مع السحابة"); return; }
    setSaving(true);
    try {
      const merged = { ...belongings, other };
      const { error } = await supabase.from("job_orders").update({
        odometer_km: km ? Number(km) : null,
        fuel_level_pct: fuel,
        reception_notes: notes,
        reception_photos: photos,
        vehicle_belongings: merged,
        received_at: new Date().toISOString(),
      }).eq("id", jobOrderId);
      if (error) throw error;
      toast.success("تم حفظ بيانات الاستلام");
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setSaving(false); }
  }

  if (!isUuid) return null;
  if (loading) return <div className="bg-card border rounded-xl p-4 text-sm text-muted-foreground"><Loader2 className="inline animate-spin" size={14}/> جاري التحميل…</div>;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Car size={16} className="text-primary" /> فحص واستلام المركبة
        </h2>
        <Button size="sm" onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14} />} حفظ بيانات الاستلام
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">قراءة العداد (KM)</Label>
          <Input type="number" value={km} onChange={(e) => setKm(e.target.value)} placeholder="مثال: 125400" />
        </div>
        <div>
          <Label className="text-xs">مستوى الوقود: <strong className="text-primary">{fuel}%</strong></Label>
          <input type="range" min={0} max={100} step={5} value={fuel} onChange={(e) => setFuel(Number(e.target.value))} className="w-full accent-primary mt-2" />
        </div>
      </div>

      <div>
        <Label className="text-xs">ملاحظات الاستلام</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="حالة المركبة الظاهرية، خدوش سابقة، رائحة، إلخ" />
      </div>

      <div>
        <Label className="text-xs mb-2 block">المقتنيات داخل المركبة</Label>
        {(() => {
          const checkedItems = items.filter((it) => belongings[it.key]);
          const hasOther = !!other?.trim();
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" type="button" onClick={() => setBelongingsOpen(true)} className="gap-1 h-8">
                <ClipboardList size={14} /> تعديل المقتنيات
                <span className="text-[10px] text-muted-foreground mr-1">
                  ({checkedItems.length}{hasOther ? " + أخرى" : ""})
                </span>
              </Button>
              {checkedItems.length === 0 && !hasOther ? (
                <span className="text-[11px] text-muted-foreground">— لم تُسجَّل مقتنيات بعد</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {checkedItems.map((it) => (
                    <span key={it.key} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">{it.label_ar}</span>
                  ))}
                  {hasOther && (
                    <span className="text-[10px] bg-muted text-foreground px-2 py-0.5 rounded-full">+ {other}</span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Belongings dialog */}
      <Dialog open={belongingsOpen} onOpenChange={setBelongingsOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>المقتنيات داخل المركبة</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {items.map((it) => (
              <label key={it.key} className="flex items-center gap-2 text-xs bg-muted/30 rounded-md p-2 cursor-pointer hover:bg-muted/50">
                <Checkbox
                  checked={!!belongings[it.key]}
                  onCheckedChange={(v) => setBelongings((b) => ({ ...b, [it.key]: !!v }))}
                />
                <span>{it.label_ar}</span>
              </label>
            ))}
          </div>
          <Input className="mt-2" value={other} onChange={(e) => setOther(e.target.value)} placeholder="مقتنيات أخرى (اكتبها هنا)…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBelongingsOpen(false)}>إغلاق</Button>
            <Button onClick={() => { setBelongingsOpen(false); save(); }}>حفظ المقتنيات</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs">صور المركبة عند الاستلام ({photos.length})</Label>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} />
            <Button size="sm" variant="outline" className="gap-1" asChild>
              <span>{uploadingPhoto ? <Loader2 size={14} className="animate-spin"/> : <Camera size={14} />} رفع صورة</span>
            </Button>
          </label>
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square bg-muted rounded overflow-hidden group">
                <img src={p} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setPhotos((arr) => arr.filter((_, x) => x !== i))}
                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
