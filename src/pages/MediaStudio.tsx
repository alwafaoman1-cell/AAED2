// استوديو الوسائط: تصفّح كل الصور والملفات + تحديد متعدد + نقل + سلة محذوفات
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Image as ImageIcon, FileText, Download, Eye, Search, Loader2, Images, FileBox,
  RefreshCcw, ExternalLink, Filter, Trash2, FolderInput, CheckSquare, Square,
  Undo2, AlertTriangle, Car, FolderOpen, ArrowRight,
} from "lucide-react";
import { refreshSignedUrls } from "@/lib/refreshSignedUrls";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface MediaItem {
  bucket: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
  updatedAt: string;
  url?: string;
  vehicleId?: string | null;
  claimId?: string | null;
  vehiclePlate?: string;
  vehicleLabel?: string;
}

const REAL_BUCKETS = [
  { id: "insurance-docs", label: "مستندات التأمين" },
  { id: "damage-photos", label: "صور الأضرار / الفحص" },
  { id: "invoices-pdf", label: "فواتير PDF" },
  { id: "avatars", label: "الصور الشخصية" },
];
const TABS = [
  { id: "__vehicles__", label: "🚗 حسب السيارة" },
  { id: "local-photos", label: "صور المراحل والفحص (محلية)" },
  ...REAL_BUCKETS,
  { id: "__trash__", label: "🗑️ سلة المحذوفات" },
];

const TRASH_PREFIX = "__trash/";
const MAX_DEPTH = 4;
const PAGE_SIZE = 1000;

function estimateDataUrlSize(s: string): number {
  if (!s) return 0;
  const i = s.indexOf(",");
  const b64 = i >= 0 ? s.slice(i + 1) : s;
  return Math.floor(b64.length * 0.75);
}

function collectLocalPhotos(): MediaItem[] {
  const out: MediaItem[] = [];
  try {
    for (const wo of getWorkOrders()) {
      for (const p of wo.photos || []) {
        if (!p.dataUrl) continue;
        out.push({
          bucket: "local-photos",
          path: `work-orders/${wo.id}/${p.phase}/${p.id}.jpg`,
          name: `${wo.id} — ${p.phase}${p.caption ? " — " + p.caption : ""}.jpg`,
          size: estimateDataUrlSize(p.dataUrl),
          contentType: "image/jpeg",
          updatedAt: p.uploadedAt || "",
          url: p.dataUrl,
        });
      }
    }
  } catch { /* ignore */ }
  try {
    const raw = {};
    for (const [id, data] of Object.entries<any>(raw)) {
      const savedAt = data?._savedAt || "";
      const annotated: string[] = Array.isArray(data?.annotatedImages) ? [...data.annotatedImages] : [];
      if (data?.annotatedImageDataUrl && annotated.length === 0) annotated.push(data.annotatedImageDataUrl);
      annotated.forEach((src: string, i: number) => {
        if (!src) return;
        out.push({
          bucket: "local-photos",
          path: `inspections/${id}/annotated-${i + 1}.png`,
          name: `${id} — مخطط أضرار ${i + 1}.png`,
          size: estimateDataUrlSize(src),
          contentType: "image/png",
          updatedAt: savedAt,
          url: src,
        });
      });
      const photos: string[] = Array.isArray(data?.photos) ? data.photos : [];
      photos.forEach((src: string, i: number) => {
        if (!src) return;
        out.push({
          bucket: "local-photos",
          path: `inspections/${id}/photo-${i + 1}.jpg`,
          name: `${id} — صورة ضرر ${i + 1}.jpg`,
          size: estimateDataUrlSize(src),
          contentType: "image/jpeg",
          updatedAt: savedAt,
          url: src,
        });
      });
    }
  } catch { /* ignore */ }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

async function listBucketRecursive(bucket: string): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  async function walk(prefix: string, depth: number) {
    if (depth > MAX_DEPTH) return;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "updated_at", order: "desc" },
      });
      if (error || !data || data.length === 0) break;
      const subdirs: string[] = [];
      for (const entry of data) {
        if (!entry.name) continue;
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        const isFile = !!entry.metadata && (entry.metadata as any).size != null;
        if (isFile) {
          out.push({
            bucket,
            path: full,
            name: entry.name,
            size: Number((entry.metadata as any).size || 0),
            contentType: String((entry.metadata as any).mimetype || ""),
            updatedAt: entry.updated_at || entry.created_at || "",
          });
        } else {
          subdirs.push(full);
        }
      }
      await Promise.all(subdirs.map((sd) => walk(sd, depth + 1)));
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  await walk("", 0);
  return out;
}

async function listVehicleMediaIndex(): Promise<Record<string, MediaItem[]>> {
  const byBucket: Record<string, MediaItem[]> = {};
  const { data, error } = await supabase
    .from("vehicle_media" as any)
    .select("id,storage_bucket,storage_path,file_name,file_size,mime_type,uploaded_at,media_type,vehicle_id,claim_id,public_url")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = (data || []) as any[];
  const vehicleIds = Array.from(new Set(rows.map((row) => row.vehicle_id).filter(Boolean)));
  const claimIds = Array.from(new Set(rows.map((row) => row.claim_id).filter(Boolean)));

  const [vehiclesResult, claimsResult] = await Promise.all([
    vehicleIds.length
      ? supabase.from("vehicles" as any).select("id,plate_number,plate_letters,brand,model,year").in("id", vehicleIds as any)
      : Promise.resolve({ data: [], error: null } as any),
    claimIds.length
      ? supabase.from("insurance_claims" as any).select("id,vehicle_plate,vehicle_make,vehicle_model,vehicle_year").in("id", claimIds as any)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const vehicles = new Map<string, any>((vehiclesResult.data || []).map((vehicle: any) => [vehicle.id, vehicle]));
  const claims = new Map<string, any>((claimsResult.data || []).map((claim: any) => [claim.id, claim]));

  rows.forEach((row) => {
    const bucket = row.storage_bucket || "insurance-docs";
    const vehicle = row.vehicle_id ? vehicles.get(row.vehicle_id) : null;
    const claim = row.claim_id ? claims.get(row.claim_id) : null;
    const vehiclePlate = [
      vehicle?.plate_letters || "",
      vehicle?.plate_number || claim?.vehicle_plate || "",
    ].filter(Boolean).join(" ").trim() || "—";
    const vehicleLabel = [
      vehicle?.brand || claim?.vehicle_make || "",
      vehicle?.model || claim?.vehicle_model || "",
      vehicle?.year || claim?.vehicle_year || "",
    ].filter(Boolean).join(" ").trim() || vehiclePlate;
    const item: MediaItem = {
      bucket,
      path: row.storage_path,
      name: row.file_name || String(row.storage_path || "").split("/").pop() || "file",
      size: Number(row.file_size || 0),
      contentType: String(row.mime_type || (row.media_type === "image" ? "image/*" : "")),
      updatedAt: row.uploaded_at || "",
      url: row.public_url || undefined,
      vehicleId: row.vehicle_id || null,
      claimId: row.claim_id || null,
      vehiclePlate,
      vehicleLabel,
    };
    if (!byBucket[bucket]) byBucket[bucket] = [];
    byBucket[bucket].push(item);
  });

  return byBucket;
}

const isImage = (it: MediaItem) =>
  it.contentType?.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|svg|heic)$/i.test(it.name);
const isPdf = (it: MediaItem) =>
  it.contentType === "application/pdf" || /\.pdf$/i.test(it.name);

function humanSize(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024; i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

const isTrashed = (it: MediaItem) =>
  it.path.startsWith(TRASH_PREFIX) || it.path.includes(`/${TRASH_PREFIX}`);

function genId() {
  return (crypto as any).randomUUID?.() || Math.random().toString(36).slice(2);
}

export default function MediaStudio() {
  const [tab, setTab] = useState<string>("__vehicles__");
  const [items, setItems] = useState<Record<string, MediaItem[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "images" | "pdfs" | "other">("all");
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [imgPreview, setImgPreview] = useState<MediaItem | null>(null);

  // التحديد المتعدد (مفتاحه bucket|path)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetBucket, setMoveTargetBucket] = useState<string>("");
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [tenantId, setTenantId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const { profile } = useAuth();
  const canDestroy = profile?.role === "admin" || profile?.role === "manager";

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const { data: p } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (p?.tenant_id) setTenantId(p.tenant_id as string);
    })();
  }, []);

  const isTrashTab = tab === "__trash__";
  const isLocalTab = tab === "local-photos";
  const isVehiclesTab = tab === "__vehicles__";

  // ── تجميع حسب السيارة ──
  type VehicleGroup = {
    key: string;
    plate: string;
    label: string;
    items: MediaItem[];
    cover?: string;
  };
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [claimToVehicle, setClaimToVehicle] = useState<Record<string, { plate: string; label: string }>>({});
  const [inspectionToVehicle, setInspectionToVehicle] = useState<Record<string, { plate: string; label: string }>>({});
  const [openVehicle, setOpenVehicle] = useState<string | null>(null);

  async function loadVehicleMaps() {
    if (!tenantId) return;
    setVehiclesLoading(true);
    try {
      const [{ data: claims }, { data: inspections }] = await Promise.all([
        supabase
          .from("insurance_claims" as any)
          .select("id, vehicle_id, vehicle_make, vehicle_model, vehicle_plate, vehicle:vehicles(brand, model, plate_number)")
          .eq("tenant_id", tenantId) as any,
        supabase
          .from("inspections" as any)
          .select("id, vehicle_id, vehicle:vehicles(brand, model, plate_number)")
          .eq("tenant_id", tenantId) as any,
      ]);
      const cm: Record<string, { plate: string; label: string }> = {};
      (claims || []).forEach((c: any) => {
        const plate = c.vehicle?.plate_number || c.vehicle_plate || "بدون-لوحة";
        const brand = c.vehicle?.brand || c.vehicle_make || "";
        const model = c.vehicle?.model || c.vehicle_model || "";
        cm[c.id] = { plate, label: `${brand} ${model}`.trim() || plate };
      });
      setClaimToVehicle(cm);
      const im: Record<string, { plate: string; label: string }> = {};
      (inspections || []).forEach((i: any) => {
        const plate = i.vehicle?.plate_number || "بدون-لوحة";
        const brand = i.vehicle?.brand || "";
        const model = i.vehicle?.model || "";
        im[i.id] = { plate, label: `${brand} ${model}`.trim() || plate };
      });
      setInspectionToVehicle(im);
    } finally {
      setVehiclesLoading(false);
    }
  }

  // مفتاح تحديد العنصر
  const keyOf = (it: MediaItem) => `${it.bucket}|${it.path}`;

  async function loadBucket(b: string, force = false, skipSign = false) {
    if (!force && items[b]) return;
    setLoading((s) => ({ ...s, [b]: true }));
    try {
      if (b === "local-photos") {
        setItems((s) => ({ ...s, [b]: collectLocalPhotos() }));
        return;
      }
      const list = await listBucketRecursive(b);
      list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      if (skipSign) {
        // أداء: لا نوقّع كل الـ URLs دفعة واحدة — نؤجلها للعرض الفعلي
        setItems((s) => ({ ...s, [b]: list }));
        return;
      }
      const signed = new Map<string, string>();
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100).map((x) => x.path);
        const m = await refreshSignedUrls(b, chunk);
        m.forEach((v, k) => signed.set(k, v));
      }
      const withUrls = list.map((x) => ({ ...x, url: signed.get(x.path) }));
      setItems((s) => ({ ...s, [b]: withUrls }));
    } finally {
      setLoading((s) => ({ ...s, [b]: false }));
    }
  }

  async function loadAllRealBuckets(force = false, skipSign = false) {
    await Promise.all(REAL_BUCKETS.map((b) => loadBucket(b.id, force, skipSign)));
  }

  async function loadVehicleMediaIndex(force = false) {
    if (!force && REAL_BUCKETS.some((bucket) => items[bucket.id])) return;
    setVehiclesLoading(true);
    try {
      const indexed = await listVehicleMediaIndex();
      setItems((current) => {
        const next = { ...current };
        REAL_BUCKETS.forEach((bucket) => {
          next[bucket.id] = indexed[bucket.id] || [];
        });
        return next;
      });
    } catch (error) {
      console.warn("[MediaStudio] vehicle_media index failed; falling back to Storage listing", error);
      await loadAllRealBuckets(force, true);
    } finally {
      setVehiclesLoading(false);
    }
  }

  // توقيع URLs لمجموعة عناصر متى ما لزم (Lazy)
  const signingRef = useRef<Set<string>>(new Set());
  async function ensureSignedFor(list: MediaItem[]) {
    const byBucket = new Map<string, string[]>();
    for (const it of list) {
      if (it.url || it.bucket === "local-photos") continue;
      const sigKey = keyOf(it);
      if (signingRef.current.has(sigKey)) continue;
      signingRef.current.add(sigKey);
      if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
      byBucket.get(it.bucket)!.push(it.path);
    }
    if (!byBucket.size) return;
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const m = await refreshSignedUrls(bucket, chunk);
        setItems((s) => {
          const cur = s[bucket] || [];
          const next = cur.map((it) => (m.has(it.path) ? { ...it, url: m.get(it.path) } : it));
          return { ...s, [bucket]: next };
        });
      }
    }
  }

  useEffect(() => {
    setSelected(new Set());
    setOpenVehicle(null);
    if (isLocalTab) loadBucket("local-photos");
    else if (isTrashTab) loadAllRealBuckets();
    else if (isVehiclesTab) {
      // تبويب السيارات: حمّل القوائم بدون توقيع — يوقَّع لاحقاً عند فتح السيارة
      loadBucket("local-photos");
      loadVehicleMediaIndex();
      loadVehicleMaps();
    } else loadBucket(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tenantId]);

  // كل الملفات الفعّالة (غير المحذوفة) لكل المخازن + المحلية
  const allActiveItems: MediaItem[] = useMemo(() => {
    const out: MediaItem[] = [];
    for (const b of REAL_BUCKETS) (items[b.id] || []).forEach((it) => { if (!isTrashed(it)) out.push(it); });
    (items["local-photos"] || []).forEach((it) => out.push(it));
    return out;
  }, [items]);

  // تجميع حسب السيارة
  const vehicleGroups: VehicleGroup[] = useMemo(() => {
    if (!isVehiclesTab) return [];
    const groups = new Map<string, VehicleGroup>();
    const ensure = (key: string, plate: string, label: string) => {
      if (!groups.has(key)) groups.set(key, { key, plate, label, items: [] });
      return groups.get(key)!;
    };
    for (const it of allActiveItems) {
      let mapped: { plate: string; label: string } | null = null;
      if (it.vehiclePlate || it.vehicleLabel) {
        mapped = {
          plate: it.vehiclePlate || "—",
          label: it.vehicleLabel || it.vehiclePlate || "—",
        };
      }
      // claims/<claimId>/...
      const cm = it.path.match(/(?:^|\/)claims\/([0-9a-f-]{8,})\//i);
      if (!mapped && cm && claimToVehicle[cm[1]]) mapped = claimToVehicle[cm[1]];
      // inspections/<id>/...
      if (!mapped) {
        const im = it.path.match(/(?:^|\/)inspections\/([0-9a-zA-Z_-]+)\//);
        if (im && inspectionToVehicle[im[1]]) mapped = inspectionToVehicle[im[1]];
      }
      const key = mapped ? `${mapped.plate}` : "__unassigned__";
      const label = mapped ? mapped.label : "غير مصنّف";
      const plate = mapped ? mapped.plate : "—";
      const g = ensure(key, plate, label);
      g.items.push(it);
      if (!g.cover && isImage(it) && it.url) g.cover = it.url;
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  }, [allActiveItems, claimToVehicle, inspectionToVehicle, isVehiclesTab]);

  const activeVehicleGroup = useMemo(
    () => vehicleGroups.find((g) => g.key === openVehicle) || null,
    [vehicleGroups, openVehicle],
  );

  // عند فتح سيارة في تبويب "حسب السيارة"، وقّع روابط ملفاتها فقط
  useEffect(() => {
    if (isVehiclesTab && activeVehicleGroup?.items?.length) {
      ensureSignedFor(activeVehicleGroup.items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVehicle]);

  // أيضاً وقّع غلاف أوّل صورة لكل مجموعة في شاشة قائمة السيارات
  useEffect(() => {
    if (isVehiclesTab && !openVehicle && vehicleGroups.length) {
      const covers: MediaItem[] = [];
      for (const g of vehicleGroups.slice(0, 20)) {
        const firstImg = g.items.find((it) => isImage(it) && !it.url);
        if (firstImg) covers.push(firstImg);
      }
      if (covers.length) ensureSignedFor(covers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleGroups.length, openVehicle, isVehiclesTab]);

  // قائمة العرض الحالية
  const currentList: MediaItem[] = useMemo(() => {
    if (isVehiclesTab) return activeVehicleGroup?.items || [];
    if (isTrashTab) {
      return REAL_BUCKETS.flatMap((b) => (items[b.id] || []).filter(isTrashed));
    }
    if (isLocalTab) return items["local-photos"] || [];
    return (items[tab] || []).filter((it) => !isTrashed(it));
  }, [items, tab, isTrashTab, isLocalTab, isVehiclesTab, activeVehicleGroup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentList.filter((it) => {
      if (kind === "images" && !isImage(it)) return false;
      if (kind === "pdfs" && !isPdf(it)) return false;
      if (kind === "other" && (isImage(it) || isPdf(it))) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q);
    });
  }, [currentList, search, kind]);

  const stats = useMemo(() => ({
    total: currentList.length,
    images: currentList.filter(isImage).length,
    pdfs: currentList.filter(isPdf).length,
    size: currentList.reduce((s, x) => s + (x.size || 0), 0),
  }), [currentList]);

  const allSelected = filtered.length > 0 && filtered.every((it) => selected.has(keyOf(it)));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((it) => next.delete(keyOf(it)));
    else filtered.forEach((it) => next.add(keyOf(it)));
    setSelected(next);
  };
  const toggleOne = (it: MediaItem) => {
    const k = keyOf(it);
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    setSelected(next);
  };

  const selectedItems = useMemo(
    () => filtered.filter((it) => selected.has(keyOf(it))),
    [filtered, selected],
  );

  // ── الإجراءات ──
  const storageRootForBucket = (bucket: string) => (bucket === "avatars" ? userId : tenantId);

  // نقل إلى سلة المحذوفات: <tenant_id>/__trash/<uuid>/<basename>
  async function moveToTrash() {
    if (!selectedItems.length) return;
    if (!tenantId || !userId) { toast.error("جاري تحميل بيانات الحساب، حاول مرة أخرى"); return; }
    setBusy(true);
    try {
      let ok = 0, fail = 0;
      const errs: string[] = [];
      for (const it of selectedItems) {
        if (it.bucket === "local-photos") { fail++; continue; }
        const base = it.path.split("/").pop() || "file";
        const root = storageRootForBucket(it.bucket);
        const dest = `${root}/${TRASH_PREFIX}${genId()}/${base}`;
        const { error } = await supabase.storage.from(it.bucket).move(it.path, dest);
        if (error) { console.error(error); fail++; errs.push(error.message); }
        else ok++;
      }
      if (ok) toast.success(`تم نقل ${ok} ملف إلى السلة${fail ? ` — فشل ${fail}` : ""}`);
      else if (fail) toast.error(`فشل نقل ${fail} ملف: ${errs[0] || ""}`);
      setSelected(new Set());
      await loadAllRealBuckets(true);
    } finally { setBusy(false); }
  }

  // استعادة من السلة → <tenant_id>/restored/<base>
  async function restoreFromTrash() {
    if (!selectedItems.length) return;
    if (!tenantId || !userId) { toast.error("جاري تحميل بيانات الحساب، حاول مرة أخرى"); return; }
    setBusy(true);
    try {
      let ok = 0, fail = 0;
      for (const it of selectedItems) {
        if (!isTrashed(it)) continue;
        const base = it.path.split("/").pop() || "file";
        const root = storageRootForBucket(it.bucket);
        const dest = `${root}/restored/${base}`;
        const { error } = await supabase.storage.from(it.bucket).move(it.path, dest);
        if (error) { console.error(error); fail++; } else ok++;
      }
      toast.success(`تمت استعادة ${ok} ملف${fail ? ` — فشل ${fail}` : ""}`);
      setSelected(new Set());
      await loadAllRealBuckets(true);
    } finally { setBusy(false); }
  }

  // نقل لمجلد آخر داخل نفس bucket
  async function applyMove() {
    if (!selectedItems.length || !moveTargetFolder.trim()) {
      toast.error("اختر اسم المجلد");
      return;
    }
    const folder = moveTargetFolder.replace(/^\/+|\/+$/g, "");
    setBusy(true);
    try {
      let ok = 0, fail = 0;
      for (const it of selectedItems) {
        if (it.bucket === "local-photos") { fail++; continue; }
        if (moveTargetBucket && moveTargetBucket !== it.bucket) { fail++; continue; }
        const base = it.path.split("/").pop() || "file";
        const dest = folder ? `${folder}/${base}` : base;
        if (dest === it.path) continue;
        const { error } = await supabase.storage.from(it.bucket).move(it.path, dest);
        if (error) { console.error(error); fail++; } else ok++;
      }
      toast.success(`تم نقل ${ok} ملف${fail ? ` — فشل ${fail}` : ""}`);
      setSelected(new Set());
      setMoveOpen(false);
      setMoveTargetFolder("");
      await loadAllRealBuckets(true);
    } finally { setBusy(false); }
  }

  // إفراغ السلة: حذف نهائي + تنظيف المراجع في DB
  async function emptyTrash() {
    setBusy(true);
    try {
      // اجمع كل ملفات السلة عبر كل buckets
      const trashItems: MediaItem[] = REAL_BUCKETS.flatMap(
        (b) => (items[b.id] || []).filter(isTrashed),
      );
      if (!trashItems.length) {
        toast.info("السلة فارغة");
        return;
      }
      // 1) حذف من Storage
      const byBucket = new Map<string, string[]>();
      for (const it of trashItems) {
        if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
        byBucket.get(it.bucket)!.push(it.path);
      }
      let removed = 0;
      for (const [bucket, paths] of byBucket) {
        // remove في دفعات 100
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          const { error } = await supabase.storage.from(bucket).remove(chunk);
          if (error) console.error(`remove ${bucket}:`, error);
          else removed += chunk.length;
        }
      }
      // 2) تنظيف المراجع في قاعدة البيانات
      let cleaned = 0;
      try {
        const { data, error } = await supabase.functions.invoke("cleanup-media-references", {
          body: { items: trashItems.map((it) => ({ bucket: it.bucket, path: it.path })) },
        });
        if (error) console.error("cleanup fn:", error);
        cleaned = (data as any)?.cleaned ?? 0;
      } catch (e) {
        console.error("cleanup fn invoke:", e);
      }
      toast.success(`حذف نهائي ${removed} ملف · تنظيف ${cleaned} مرجع من قاعدة البيانات`);
      setConfirmEmpty(false);
      setSelected(new Set());
      await loadAllRealBuckets(true);
    } finally { setBusy(false); }
  }

  // حذف نهائي مباشر (للعناصر المختارة في السلة فقط)
  async function deleteForever() {
    const trashSelected = selectedItems.filter(isTrashed);
    if (!trashSelected.length) return;
    setBusy(true);
    try {
      const byBucket = new Map<string, string[]>();
      for (const it of trashSelected) {
        if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
        byBucket.get(it.bucket)!.push(it.path);
      }
      let removed = 0;
      for (const [bucket, paths] of byBucket) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (!error) removed += paths.length;
      }
      try {
        await supabase.functions.invoke("cleanup-media-references", {
          body: { items: trashSelected.map((it) => ({ bucket: it.bucket, path: it.path })) },
        });
      } catch (e) { console.error(e); }
      toast.success(`تم حذف ${removed} ملف نهائياً وتنظيف مراجعها`);
      setSelected(new Set());
      await loadAllRealBuckets(true);
    } finally { setBusy(false); }
  }

  // المجلدات المقترحة للنقل (في bucket المحدد)
  const folderSuggestions = useMemo(() => {
    const target = moveTargetBucket || (selectedItems[0]?.bucket ?? tab);
    const list = items[target] || [];
    const folders = new Set<string>();
    list.forEach((it) => {
      const parts = it.path.split("/");
      if (parts.length > 1) {
        // أوّل مستوى فقط من المجلدات (وتجاهل __trash)
        if (!parts.includes("__trash")) folders.add(parts[0]);
      }
    });
    return [...folders].sort();
  }, [items, moveTargetBucket, selectedItems, tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Images size={22} className="text-primary" /> استوديو الوسائط
          </h1>
          <p className="text-sm text-muted-foreground">
            تصفّح، حدّد، انقل، أو احذف الصور والملفات. الحذف يُرسل للسلة، وإفراغ السلة يمسح من السيرفر نهائياً.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (isVehiclesTab) { loadVehicleMediaIndex(true); loadBucket("local-photos", true); loadVehicleMaps(); }
            else if (isTrashTab) loadAllRealBuckets(true);
            else loadBucket(tab, true);
          }}
          disabled={
            isVehiclesTab
              ? vehiclesLoading || REAL_BUCKETS.some((b) => loading[b.id])
              : isTrashTab
                ? REAL_BUCKETS.some((b) => loading[b.id])
                : !!loading[tab]
          }
        >
          {(isVehiclesTab
            ? vehiclesLoading || REAL_BUCKETS.some((b) => loading[b.id])
            : isTrashTab
              ? REAL_BUCKETS.some((b) => loading[b.id])
              : !!loading[tab])
            ? <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            : <RefreshCcw className="w-4 h-4 ml-2" />}
          تحديث
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((b) => (
            <TabsTrigger key={b.id} value={b.id} className="gap-2">
              <FileBox size={14} /> {b.label}
              {b.id === "__trash__" ? (
                <Badge variant="destructive" className="ml-1 text-[10px]">
                  {REAL_BUCKETS.reduce((n, x) => n + (items[x.id] || []).filter(isTrashed).length, 0)}
                </Badge>
              ) : items[b.id] && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {(items[b.id] || []).filter((it) => !isTrashed(it)).length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((b) => (
          <TabsContent key={b.id} value={b.id} className="space-y-4">
            {isVehiclesTab && !openVehicle ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="عدد السيارات" value={vehicleGroups.length} icon={<Car className="w-4 h-4" />} />
                  <StatCard label="إجمالي الملفات" value={allActiveItems.length} icon={<FileBox className="w-4 h-4" />} />
                  <StatCard label="الصور" value={allActiveItems.filter(isImage).length} icon={<ImageIcon className="w-4 h-4" />} />
                  <StatCard label="ملفات PDF" value={allActiveItems.filter(isPdf).length} icon={<FileText className="w-4 h-4" />} />
                </div>
                <div className="bg-card border border-border rounded-xl p-4 shadow-card">
                  <div className="relative">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم اللوحة أو موديل السيارة..." className="pr-9" />
                  </div>
                </div>
                {vehiclesLoading ? (
                  <div className="py-16 text-center text-muted-foreground text-sm">
                    <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" /> جاري تجميع السيارات...
                  </div>
                ) : vehicleGroups.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground text-sm">
                    <Car size={40} className="mx-auto mb-2 opacity-30" /> لا توجد ملفات مرتبطة بسيارات
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {vehicleGroups
                      .filter((g) => {
                        const q = search.trim().toLowerCase();
                        if (!q) return true;
                        return g.plate.toLowerCase().includes(q) || g.label.toLowerCase().includes(q);
                      })
                      .map((g) => (
                        <button
                          key={g.key}
                          type="button"
                          onClick={() => setOpenVehicle(g.key)}
                          className="group bg-card border border-border rounded-xl overflow-hidden shadow-card hover:shadow-lg hover:border-primary transition text-right"
                        >
                          <div className="aspect-square bg-secondary/30 relative flex items-center justify-center">
                            {g.cover ? (
                              <img src={g.cover} alt={g.plate} loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <Car className="w-14 h-14 text-muted-foreground/50" />
                            )}
                            <Badge className="absolute top-2 left-2 bg-background/90 text-foreground border border-border">
                              {g.items.length} ملف
                            </Badge>
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <FolderOpen className="w-8 h-8 text-white" />
                            </div>
                          </div>
                          <div className="p-2">
                            <p className="text-sm font-bold truncate flex items-center gap-1" dir="ltr">
                              <Car size={12} /> {g.plate}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">{g.label}</p>
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {isVehiclesTab && openVehicle && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setOpenVehicle(null)} className="gap-1">
                      <ArrowRight size={14} /> رجوع للسيارات
                    </Button>
                    <div className="text-sm">
                      <span className="font-bold" dir="ltr">{activeVehicleGroup?.plate}</span>
                      <span className="text-muted-foreground"> · {activeVehicleGroup?.label}</span>
                    </div>
                  </div>
                )}

                {/* الإحصاءات */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="إجمالي" value={stats.total} icon={<FileBox className="w-4 h-4" />} />
                  <StatCard label="الصور" value={stats.images} icon={<ImageIcon className="w-4 h-4" />} />
                  <StatCard label="ملفات PDF" value={stats.pdfs} icon={<FileText className="w-4 h-4" />} />
                  <StatCard label="الحجم" value={humanSize(stats.size)} icon={<Download className="w-4 h-4" />} />
                </div>

                {/* فلاتر */}
                <div className="bg-card border border-border rounded-xl p-4 shadow-card grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="relative md:col-span-2">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الملف أو المسار..." className="pr-9" />
                  </div>
                  <Select value={kind} onValueChange={(v: any) => setKind(v)}>
                    <SelectTrigger><Filter className="w-4 h-4 ml-2" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الأنواع</SelectItem>
                      <SelectItem value="images">صور فقط</SelectItem>
                      <SelectItem value="pdfs">PDF فقط</SelectItem>
                      <SelectItem value="other">ملفات أخرى</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* شريط الإجراءات */}
                {!isLocalTab && !isVehiclesTab && (
                  <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={toggleAll} className="gap-1">
                      {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
                    </Button>
                    <Badge variant="outline">{selected.size} محدد</Badge>
                    <div className="flex-1" />

                    {!isTrashTab ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setMoveTargetBucket(selectedItems[0]?.bucket || tab); setMoveOpen(true); }}
                          disabled={!selected.size || busy}
                          className="gap-1"
                        >
                          <FolderInput size={14} /> نقل لمجلد آخر
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={moveToTrash}
                          disabled={!selected.size || busy}
                          className="gap-1"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          حذف ({selected.size})
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={restoreFromTrash} disabled={!selected.size || busy} className="gap-1">
                          <Undo2 size={14} /> استعادة
                        </Button>
                        {canDestroy && (
                          <>
                            <Button size="sm" variant="destructive" onClick={deleteForever} disabled={!selected.size || busy} className="gap-1">
                              <Trash2 size={14} /> حذف نهائي للمحدد
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => setConfirmEmpty(true)}
                              disabled={busy || stats.total === 0}
                              className="gap-1 bg-red-600 hover:bg-red-700 text-white"
                            >
                              <AlertTriangle size={14} /> إفراغ السلة ({stats.total})
                            </Button>
                          </>
                        )}
                        {!canDestroy && (
                          <Badge variant="outline" className="text-[10px]">
                            الحذف النهائي للمدير/المسؤول فقط
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* القائمة */}
                {loading[isTrashTab ? REAL_BUCKETS[0].id : tab] ? (
                  <div className="py-16 text-center text-muted-foreground text-sm">
                    <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                    جاري التحميل...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground text-sm">
                    <ImageIcon size={40} className="mx-auto mb-2 opacity-30" />
                    {isTrashTab ? "السلة فارغة" : "لا توجد ملفات"}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {filtered.map((it) => (
                      <MediaCard
                        key={keyOf(it)}
                        item={it}
                        selected={selected.has(keyOf(it))}
                        selectable={!isLocalTab && !isVehiclesTab}
                        onToggle={() => toggleOne(it)}
                        onImageClick={() => setImgPreview(it)}
                        onPdfClick={() => setPreview(it)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <ArchivedPdfPreviewDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        url={preview?.url || ""}
        fileName={preview?.name || "document.pdf"}
        title={preview?.name || "مستند"}
      />

      {/* Lightbox للصور */}
      {imgPreview && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setImgPreview(null)}
        >
          <img src={imgPreview.url} alt={imgPreview.name} className="max-h-[90vh] max-w-[95vw] object-contain rounded-lg shadow-2xl" />
          <div className="absolute bottom-4 right-4 left-4 flex items-center justify-between gap-2 text-white text-xs font-mono bg-black/60 rounded-lg p-2" dir="ltr">
            <span className="truncate">{imgPreview.path}</span>
            <a href={imgPreview.url} download={imgPreview.name} target="_blank" rel="noopener noreferrer" className="shrink-0 underline">تنزيل</a>
          </div>
        </div>
      )}

      {/* نقل لمجلد */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderInput size={16} /> نقل لمجلد آخر</DialogTitle>
            <DialogDescription>
              سيتم نقل {selectedItems.length} ملف ضمن نفس المخزن. النقل بين المخازن غير متاح.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المخزن</label>
              <Select value={moveTargetBucket} onValueChange={setMoveTargetBucket}>
                <SelectTrigger><SelectValue placeholder="المخزن" /></SelectTrigger>
                <SelectContent>
                  {REAL_BUCKETS.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">اسم المجلد الوجهة</label>
              <Input
                value={moveTargetFolder}
                onChange={(e) => setMoveTargetFolder(e.target.value)}
                placeholder="مثلاً: archive-2026"
                dir="ltr"
              />
              {folderSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {folderSuggestions.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setMoveTargetFolder(f)}
                      className="text-[11px] px-2 py-1 rounded border border-border hover:bg-secondary"
                      dir="ltr"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(false)} disabled={busy}>إلغاء</Button>
            <Button size="sm" onClick={applyMove} disabled={busy || !moveTargetFolder.trim()} className="gap-1">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />}
              نقل الآن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد إفراغ السلة */}
      <Dialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} /> تأكيد إفراغ السلة
            </DialogTitle>
            <DialogDescription>
              سيتم حذف جميع ملفات السلة <strong>نهائياً من السيرفر</strong>، مع تنظيف أي مراجع لها
              في قاعدة البيانات (مطالبات، فحوص، فواتير، سجلات). لا يمكن التراجع.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs">
            عدد الملفات: <strong>{stats.total}</strong> · الحجم: <strong>{humanSize(stats.size)}</strong>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmEmpty(false)} disabled={busy}>إلغاء</Button>
            <Button size="sm" onClick={emptyTrash} disabled={busy} className="gap-1 bg-red-600 hover:bg-red-700 text-white">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              نعم، احذف نهائياً
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-card">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>
        {icon}
      </div>
      <div className="text-xl font-bold text-foreground mt-1">{value}</div>
    </div>
  );
}

function MediaCard({
  item,
  selected,
  selectable,
  onToggle,
  onImageClick,
  onPdfClick,
}: {
  item: MediaItem;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onImageClick: () => void;
  onPdfClick: () => void;
}) {
  const image = isImage(item);
  const pdf = isPdf(item);
  return (
    <div className={`group bg-card border rounded-xl overflow-hidden shadow-card hover:shadow-lg transition relative ${
      selected ? "border-primary ring-2 ring-primary" : "border-border"
    }`}>
      {selectable && (
        <label
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 z-10 bg-background/90 backdrop-blur rounded-md p-1 border border-border shadow cursor-pointer flex items-center"
          aria-label="تحديد"
        >
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        </label>
      )}
      <div
        className="aspect-square bg-secondary/30 relative flex items-center justify-center cursor-pointer"
        onClick={() => (image ? onImageClick() : pdf ? onPdfClick() : window.open(item.url, "_blank"))}
      >
        {image && item.url ? (
          <img src={item.url} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
        ) : pdf ? (
          <FileText className="w-12 h-12 text-red-500/70" />
        ) : (
          <FileBox className="w-12 h-12 text-muted-foreground/60" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Eye className="w-6 h-6 text-white" />
        </div>
      </div>
      <div className="p-2 space-y-1">
        <p className="text-[11px] font-medium truncate" title={item.name}>{item.name}</p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{humanSize(item.size)}</span>
          <div className="flex items-center gap-1">
            {item.url && (
              <a href={item.url} download={item.name} target="_blank" rel="noopener noreferrer" title="تنزيل" className="p-1 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                <Download className="w-3 h-3" />
              </a>
            )}
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" title="فتح" className="p-1 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
