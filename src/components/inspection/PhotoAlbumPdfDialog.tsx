import { useRef, useState } from "react";
import { Upload, X, RotateCw, Download, Eye, Loader2, Images, FileArchive } from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { fileToWebpDataUrl } from "@/lib/imageToWebp";
import {
  generatePhotoAlbumPdf,
  loadImageMeta,
  downloadBlob,
  type PhotoAlbumImage,
} from "@/lib/photoAlbumPdf";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface AlbumItem extends PhotoAlbumImage {
  id: string;
}

// لا يوجد حد أقصى لعدد الصور أو الصفحات

function rotateDataUrl(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = h; canvas.height = w;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(h / 2, w / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve({ dataUrl: canvas.toDataURL("image/webp", 0.85), width: h, height: w });
    };
    img.onerror = () => reject(new Error("rotate failed"));
    img.src = dataUrl;
  });
}

export default function PhotoAlbumPdfDialog({ open, onOpenChange }: Props) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [workOrder, setWorkOrder] = useState("");
  const [customer, setCustomer] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;


  async function expandZips(files: File[]): Promise<File[]> {
    const out: File[] = [];
    for (const f of files) {
      const isZip = /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
      if (!isZip) { out.push(f); continue; }
      try {
        const zip = await JSZip.loadAsync(f);
        const entries = Object.values(zip.files).filter((e) => !e.dir && IMG_EXT.test(e.name));
        // sort by name for natural order
        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const entry of entries) {
          const blob = await entry.async("blob");
          const baseName = entry.name.split("/").pop() || entry.name;
          const ext = (baseName.match(/\.[^.]+$/)?.[0] || ".jpg").toLowerCase();
          const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
          out.push(new File([blob], baseName, { type: mime }));
        }
        toast.success(`📦 استُخرج ${entries.length} صورة من ${f.name}`);
      } catch (err) {
        console.error(err);
        toast.error(`تعذّر فتح الملف المضغوط: ${f.name}`);
      }
    }
    return out;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const expanded = await expandZips(Array.from(files));
      const added: AlbumItem[] = [];
      for (const f of expanded) {
        if (!f.type.startsWith("image/") && !IMG_EXT.test(f.name)) continue;
        const dataUrl = await fileToWebpDataUrl(f, { quality: 0.82, maxDimension: 1800 });
        const meta = await loadImageMeta(dataUrl);
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dataUrl,
          width: meta.width,
          height: meta.height,
          caption: "",
        });
      }
      setItems((prev) => [...prev, ...added]);
      if (added.length > 0) toast.success(`تم إضافة ${added.length} صورة`);
    } catch (e: any) {
      toast.error("فشل تحميل بعض الصور");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }


  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function rotateItem(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    try {
      const r = await rotateDataUrl(it.dataUrl);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, dataUrl: r.dataUrl, width: r.width, height: r.height } : i)),
      );
    } catch {
      toast.error("تعذّر تدوير الصورة");
    }
  }

  function updateCaption(id: string, caption: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, caption } : i)));
  }

  async function buildPdf(): Promise<Blob | null> {
    if (items.length === 0) {
      toast.error("أضف صوراً أولاً");
      return null;
    }
    setBusy(true);
    try {
      const blob = await generatePhotoAlbumPdf(items, {
        workOrderRef: workOrder.trim() || undefined,
        customer: customer.trim() || undefined,
        vehicle: vehicle.trim() || undefined,
        date: date || undefined,
        title: "Photo Album",
      });
      return blob;
    } catch (e) {
      console.error(e);
      toast.error("فشل توليد PDF");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    const blob = await buildPdf();
    if (!blob) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(blob));
  }

  async function onDownload() {
    const blob = await buildPdf();
    if (!blob) return;
    const name = `photo-album-${workOrder || "album"}-${date}`;
    downloadBlob(blob, name);
    toast.success("تم تنزيل PDF");
  }

  function reset() {
    items.forEach(() => {}); // nothing — dataUrls released by GC
    setItems([]);
    setWorkOrder("");
    setCustomer("");
    setVehicle("");
    setDate(new Date().toISOString().split("T")[0]);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }

  const pages = Math.ceil(items.length / 4);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
        onOpenChange(o);
      }}
      className="max-w-4xl"
    >
      <div dir="rtl" className="space-y-4">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Images size={20} className="text-primary" />
            ألبوم صور PDF — 4 صور لكل صفحة
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {/* رأس البيانات */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="space-y-1">
            <label className="text-muted-foreground">رقم أمر العمل</label>
            <Input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} placeholder="WO-..." className="h-9 bg-secondary border-border font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">العميل</label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="اسم العميل" className="h-9 bg-secondary border-border" />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">المركبة</label>
            <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="نوع/رقم اللوحة" className="h-9 bg-secondary border-border" />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">التاريخ</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 bg-secondary border-border" />
          </div>
        </div>

        {/* منطقة رفع */}
        <div
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="border-2 border-dashed border-border rounded-xl p-4 bg-secondary/30 text-center"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.zip,application/zip,application/x-zip-compressed"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="gradient-gold text-primary-foreground gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            اختر صوراً أو ملف ZIP أو اسحب هنا
          </Button>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center justify-center gap-1">
            {items.length > 0 ? (
              <>
                <span className="font-bold text-foreground">{items.length}</span> صورة →{" "}
                <span className="font-bold text-primary">{pages}</span> صفحة A4
              </>
            ) : (
              <><FileArchive size={12} className="text-primary" /> يدعم الصور المفردة وملفات ZIP — يتم استخراج كل الصور تلقائياً</>
            )}
          </p>
        </div>

        {/* شبكة المعاينة */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto p-1">
            {items.map((it, idx) => (
              <div key={it.id} className="relative group border border-border rounded-lg overflow-hidden bg-secondary/50">
                <div className="aspect-square bg-black/5 flex items-center justify-center">
                  <img src={it.dataUrl} alt={`#${idx + 1}`} className="w-full h-full object-cover" />
                </div>
                <div className="absolute top-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                  #{idx + 1}
                </div>
                <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => rotateItem(it.id)}
                    className="p-1 rounded bg-background/90 hover:bg-info hover:text-white text-foreground"
                    title="تدوير"
                  >
                    <RotateCw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="p-1 rounded bg-background/90 hover:bg-destructive hover:text-white text-foreground"
                    title="حذف"
                  >
                    <X size={12} />
                  </button>
                </div>
                <input
                  value={it.caption || ""}
                  onChange={(e) => updateCaption(it.id, e.target.value)}
                  placeholder="تسمية…"
                  className="w-full text-[10px] px-1.5 py-1 bg-background border-t border-border focus:outline-none focus:bg-secondary"
                />
              </div>
            ))}
          </div>
        )}

        {/* معاينة PDF */}
        {previewUrl && (
          <div className="border border-border rounded-lg overflow-hidden bg-secondary">
            <iframe src={previewUrl} className="w-full h-[60vh]" title="PDF Preview" />
          </div>
        )}

        {/* الأزرار */}
        <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-border">
          {items.length > 0 && (
            <Button type="button" variant="ghost" onClick={reset} disabled={busy} className="text-muted-foreground">
              مسح الكل
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onPreview} disabled={busy || items.length === 0} className="gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            معاينة PDF
          </Button>
          <Button type="button" onClick={onDownload} disabled={busy || items.length === 0} className="gradient-gold text-primary-foreground gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            تنزيل PDF
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
