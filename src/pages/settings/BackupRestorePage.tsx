import { useEffect, useState } from "react";
import { Database, Download, Upload, Cloud, AlertTriangle, CheckCircle2, Trash2, Loader2, FileJson, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBackupJson, buildBackupZip, downloadBlob, restoreFromManifest,
  dryRunRestoreManifest,
  BACKUP_TABLES, type BackupManifest, type RestoreDryRunReport,
} from "@/lib/backupSystem";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";

type CloudFile = { name: string; size: number; created_at: string };

export default function BackupRestorePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "manager";

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [dryRunReport, setDryRunReport] = useState<RestoreDryRunReport | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<BackupManifest | null>(null);

  const tenantId = profile?.tenant_id;

  async function refreshCloud() {
    if (!tenantId) return;
    const { data, error } = await supabase.storage.from("backups").list(tenantId, {
      limit: 100, sortBy: { column: "created_at", order: "desc" },
    });
    if (error) { console.warn(error); return; }
    setCloudFiles((data ?? []).filter(f => f.name && !f.name.startsWith(".")) as any);
  }
  useEffect(() => { refreshCloud(); }, [tenantId]);

  async function handleExportJson() {
    setBusy(true); setProgress("");
    try {
      const m = await buildBackupJson({ onProgress: setProgress });
      downloadBlob(new Blob([JSON.stringify(m, null, 2)], { type: "application/json" }),
        `backup-${new Date().toISOString().slice(0,10)}.json`);
      toast.success("تم تصدير النسخة الاحتياطية JSON");
    } catch (e: any) {
      toast.error(e?.message || "فشل التصدير");
    } finally { setBusy(false); setProgress(""); }
  }

  async function handleExportZip() {
    setBusy(true); setProgress("");
    try {
      const m = await buildBackupJson({ onProgress: setProgress });
      const blob = await buildBackupZip({ manifest: m, includeAttachments, onProgress: setProgress });
      downloadBlob(blob, `backup-${new Date().toISOString().slice(0,10)}.zip`);
      toast.success("تم إنشاء أرشيف النسخة الاحتياطية");
    } catch (e: any) {
      toast.error(e?.message || "فشل التصدير");
    } finally { setBusy(false); setProgress(""); }
  }

  async function handleUploadToCloud() {
    if (!tenantId) return;
    setBusy(true); setProgress("");
    try {
      const m = await buildBackupJson({ onProgress: setProgress });
      const json = new Blob([JSON.stringify(m)], { type: "application/json" });
      const filename = `backup-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
      const { error } = await supabase.storage.from("backups")
        .upload(`${tenantId}/${filename}`, json, { upsert: false, contentType: "application/json" });
      if (error) throw error;
      toast.success("تم رفع النسخة الاحتياطية للسحابة");
      await refreshCloud();
    } catch (e: any) {
      toast.error(e?.message || "فشل الرفع");
    } finally { setBusy(false); setProgress(""); }
  }

  async function handleDownloadCloud(name: string) {
    if (!tenantId) return;
    const { data, error } = await supabase.storage.from("backups").download(`${tenantId}/${name}`);
    if (error || !data) return toast.error("فشل التنزيل");
    downloadBlob(data, name);
  }

  async function handleDeleteCloud(name: string) {
    if (!tenantId) return;
    const { error } = await supabase.storage.from("backups").remove([`${tenantId}/${name}`]);
    if (error) return toast.error("فشل الحذف");
    toast.success("تم الحذف");
    refreshCloud();
  }

  async function handleRestoreFromCloud(name: string) {
    if (!tenantId) return;
    if (!confirm(`سيتم استعادة البيانات من ${name}. هذا قد يكتب فوق السجلات الموجودة. متابعة؟`)) return;
    setBusy(true); setProgress("جاري التنزيل…");
    try {
      const { data, error } = await supabase.storage.from("backups").download(`${tenantId}/${name}`);
      if (error || !data) throw error || new Error("لا يوجد ملف");
      const text = await data.text();
      const m: BackupManifest = JSON.parse(text);
      const dry = await dryRunRestoreManifest(m, { mode: "merge", onProgress: setProgress });
      if (!dry.ok) throw new Error("Dry Run failed. Review uploaded backup before restore.");
      const r = await restoreFromManifest(m, { onProgress: setProgress, dryRunReport: dry, mode: "merge" });
      const ok = Object.values(r.inserted).reduce((s,n) => s+n, 0);
      const errs = Object.keys(r.errors).length;
      toast.success(`تمت الاستعادة (${ok} سجل)${errs ? ` — ${errs} جدول واجه أخطاء` : ""}`);
    } catch (e: any) {
      toast.error(e?.message || "فشل الاستعادة");
    } finally { setBusy(false); setProgress(""); }
  }

  async function handleDryRunUpload() {
    if (!restoreFile) return;
    setBusy(true); setProgress("");
    try {
      const text = await restoreFile.text();
      const m: BackupManifest = JSON.parse(text);
      if (m.app !== "alwafa-erp" || !m.tables) throw new Error("ملف غير صالح");
      const report = await dryRunRestoreManifest(m, { mode: "merge", onProgress: setProgress });
      setRestoreManifest(m);
      setDryRunReport(report);
      if (!report.ok) {
        toast.error("Dry Run فشل — راجع تقرير الأخطاء");
      } else {
        toast.success("Dry Run ناجح — يمكنك تنفيذ Merge Restore");
      }
    } catch (e: any) {
      toast.error(e?.message || "فشل قراءة الملف");
      setDryRunReport(null);
      setRestoreManifest(null);
    } finally { setBusy(false); setProgress(""); }
  }

  async function handleRestoreUpload() {
    if (!restoreManifest || !dryRunReport) return;
    setBusy(true); setProgress("");
    try {
      if (!dryRunReport.ok) throw new Error("Dry Run غير ناجح");
      const r = await restoreFromManifest(restoreManifest, { onProgress: setProgress, dryRunReport, mode: "merge" });
      const ok = Object.values(r.inserted).reduce((s,n) => s+n, 0);
      const errs = Object.entries(r.errors);
      toast.success(`تمت الاستعادة (${ok} سجل)`);
      if (errs.length) toast.warning(`أخطاء في: ${errs.map(([k]) => k).join(", ")}`);
      setRestoreFile(null);
      setDryRunReport(null);
      setRestoreManifest(null);
    } catch (e: any) {
      toast.error(e?.message || "فشل تنفيذ الاستعادة");
    } finally { setBusy(false); setProgress(""); setConfirmRestore(false); }
  }

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 text-warning" size={32} />
        <p>هذه الصفحة متاحة للمدير العام أو مدير الورشة فقط.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="text-primary" /> النسخ الاحتياطي والاستعادة
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          نسخ احتياطية كاملة مع Dry Run وTenant Mapping وMerge Restore آمن بدون حذف بيانات حالية.
        </p>
      </div>

      {/* Manual Export */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Download size={18} className="text-primary" />
          <h2 className="font-semibold">تصدير يدوي</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          سيتم تصدير {BACKUP_TABLES.length} جدول مع metadata وrow counts. الأسرار مثل API Keys يتم إخفاؤها ولا تُصدّر كاملة.
        </p>
        <div className="flex items-center justify-between p-3 border border-border rounded-lg">
          <div>
            <div className="text-sm font-medium">تضمين المرفقات (الصور والملفات)</div>
            <div className="text-xs text-muted-foreground">يزيد حجم الأرشيف. متاح مع تصدير ZIP فقط.</div>
          </div>
          <Switch checked={includeAttachments} onCheckedChange={setIncludeAttachments} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Button onClick={handleExportJson} disabled={busy} variant="outline" className="gap-2">
            <FileJson size={16} /> تصدير JSON
          </Button>
          <Button onClick={handleExportZip} disabled={busy} className="gap-2">
            <Archive size={16} /> تصدير ZIP {includeAttachments && "+ المرفقات"}
          </Button>
          <Button onClick={handleUploadToCloud} disabled={busy} variant="secondary" className="gap-2">
            <Cloud size={16} /> رفع للسحابة
          </Button>
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">
            <Loader2 className="animate-spin" size={16} /> {progress || "جاري المعالجة…"}
          </div>
        )}
      </Card>

      {/* Cloud backups */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Cloud size={18} className="text-primary" />
          <h2 className="font-semibold">النسخ السحابية المتاحة</h2>
          <Badge variant="outline" className="ml-auto">{cloudFiles.length}</Badge>
        </div>
        {cloudFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">لا توجد نسخ احتياطية سحابية بعد</p>
        ) : (
          <div className="space-y-2">
            {cloudFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-2 p-3 border border-border rounded-lg">
                <FileJson size={16} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono truncate" dir="ltr">{f.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {(f.size / 1024).toFixed(1)} KB · {new Date(f.created_at).toLocaleString("en-GB")}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleDownloadCloud(f.name)} className="gap-1">
                  <Download size={14} /> تنزيل
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleRestoreFromCloud(f.name)} className="gap-1 text-warning">
                  <Upload size={14} /> استعادة
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDeleteCloud(f.name)} className="text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Restore from file */}
      <Card className="p-5 space-y-3 border-warning/30">
        <div className="flex items-center gap-2">
          <Upload size={18} className="text-warning" />
          <h2 className="font-semibold">استعادة من ملف</h2>
        </div>
        <div className="bg-warning/5 border border-warning/20 rounded-lg p-3 text-xs">
          <AlertTriangle size={14} className="inline ml-1 text-warning" />
          الاستعادة لا تعمل قبل Dry Run ناجح. الوضع الافتراضي Merge Mode ولا يحذف بيانات حالية. Replace Mode معطّل هنا ويتطلب حماية خادم: كلمة مرور + OTP + عبارة تأكيد + backup قبل الحذف.
        </div>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-2 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-secondary file:text-foreground"
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleDryRunUpload}
            disabled={!restoreFile || busy}
            variant="outline"
            className="gap-2"
          >
            <CheckCircle2 size={16} /> Dry Run / فحص الملف
          </Button>
          <Button
            onClick={() => setConfirmRestore(true)}
            disabled={!dryRunReport?.ok || !restoreManifest || busy}
            variant="destructive"
            className="gap-2"
          >
            <Upload size={16} /> Merge Restore
          </Button>
        </div>
        {dryRunReport && (
          <div className={`rounded-lg border p-3 text-xs ${dryRunReport.ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <b>Dry Run Report</b>
              <Badge variant="outline">{dryRunReport.ok ? "Ready" : "Blocked"}</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>Schema: {dryRunReport.schemaVersion || "—"}</div>
              <div>Mode: {dryRunReport.mode}</div>
              <div className="font-mono" dir="ltr">old_tenant_id: {dryRunReport.sourceTenantId || "—"}</div>
              <div className="font-mono" dir="ltr">current_tenant_id: {dryRunReport.currentTenantId || "—"}</div>
            </div>
            <div className="mt-3 max-h-56 overflow-auto rounded border bg-background/60">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-start">Table</th>
                    <th className="p-2">Rows</th>
                    <th className="p-2">Duplicates</th>
                    <th className="p-2">Importable</th>
                    <th className="p-2">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(dryRunReport.tableCounts).map((table) => (
                    <tr key={table} className="border-b last:border-0">
                      <td className="p-2 font-mono" dir="ltr">{table}</td>
                      <td className="p-2 text-center">{dryRunReport.tableCounts[table] || 0}</td>
                      <td className="p-2 text-center">{dryRunReport.duplicates[table] || 0}</td>
                      <td className="p-2 text-center">{dryRunReport.importable[table] || 0}</td>
                      <td className="p-2 text-center">{dryRunReport.skipped[table] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.keys(dryRunReport.errors).length > 0 && (
              <div className="mt-2 text-destructive whitespace-pre-wrap">
                {Object.entries(dryRunReport.errors).map(([table, errs]) => `${table}: ${errs.join(", ")}`).join("\n")}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Daily schedule info */}
      <Card className="p-5 space-y-2 bg-success/5 border-success/20">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-success" />
          <h2 className="font-semibold">النسخ الاحتياطي اليومي التلقائي</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          نسخة احتياطية تلقائية تُنشأ يومياً وتُحفظ في السحابة لمدة 30 يوم.
          الجدولة تعمل عبر النظام الخلفي ولا تتطلب أي إجراء منك.
        </p>
      </Card>

      <ConfirmDeleteDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title="تأكيد الاستعادة"
        description="سيتم تحديث/إضافة سجلات في قاعدة البيانات. هذه العملية قد تستغرق دقائق."
        confirmLabel="نعم، استعادة"
        onConfirm={handleRestoreUpload}
      />
    </div>
  );
}
