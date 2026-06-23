import { useEffect, useMemo, useState } from "react";
import { Download, Eye, File, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createSignedFileUrl,
  deleteTenantFile,
  listTenantFiles,
  uploadTenantFile,
  type TenantFileRecord,
} from "@/lib/saasAdmin";
import { canDelete } from "@/lib/permissions";

const categories = [
  ["all", "كل الملفات"],
  ["claims", "Claims"],
  ["work_orders", "Work Orders"],
  ["invoices", "Invoices"],
  ["vehicle_photos", "Vehicle Photos"],
  ["inspection_reports", "Inspection Reports"],
  ["signatures", "Signatures"],
  ["qr_labels", "QR Labels"],
  ["whatsapp", "WhatsApp Links"],
  ["pdf_archive", "PDF Archive"],
] as const;

export default function TenantFiles({ tenantId }: { tenantId?: string }) {
  const [files, setFiles] = useState<TenantFileRecord[]>([]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const allowDelete = canDelete();

  async function load() {
    setLoading(true);
    try {
      setFiles(await listTenantFiles(category, tenantId));
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحميل الملفات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [category, tenantId]);

  const filtered = useMemo(() => files.filter((file) =>
    !search || file.file_name.toLowerCase().includes(search.toLowerCase())
  ), [files, search]);

  async function openSigned(file: TenantFileRecord, download = false) {
    const url = await createSignedFileUrl(file);
    if (download) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.file_name;
      anchor.target = "_blank";
      anchor.click();
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    const selectedCategory = category === "all" ? "other" : category;
    setUploading(true);
    try {
      await uploadTenantFile(file, selectedCategory, tenantId ? { tenant_id: tenantId } : {});
      toast.success("تم رفع الملف وربطه بالورشة");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "فشل رفع الملف");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files..." className="flex-1" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{categories.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <label>
          <input type="file" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
          <Button asChild disabled={uploading}><span>{uploading ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Upload File</span></Button>
        </label>
      </div>
      {loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">لا توجد ملفات في هذا التصنيف</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((file) => (
            <Card key={file.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2"><File className="text-primary" size={20} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={file.file_name}>{file.file_name}</p>
                  <p className="text-xs text-muted-foreground">{file.category} · {(file.size_bytes / 1024).toFixed(1)} KB</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(file.created_at).toLocaleString()}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-1 border-t border-border pt-3">
                <Button size="icon" variant="ghost" onClick={() => void openSigned(file)} title="Preview"><Eye size={15} /></Button>
                <Button size="icon" variant="ghost" onClick={() => void openSigned(file, true)} title="Download"><Download size={15} /></Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  await navigator.clipboard.writeText(await createSignedFileUrl(file));
                  toast.success("تم نسخ رابط آمن مؤقت");
                }} title="Copy secure link"><Link2 size={15} /></Button>
                {allowDelete && <Button size="icon" variant="ghost" className="text-destructive" onClick={async () => {
                  await deleteTenantFile(file);
                  toast.success("تم حذف الملف");
                  await load();
                }} title="Delete"><Trash2 size={15} /></Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
