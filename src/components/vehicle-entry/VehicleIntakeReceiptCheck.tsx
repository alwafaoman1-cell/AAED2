import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getIntakeReceiptContext, getIntakeReceiptPermissions, verifyIntakeReceipt, type VerifiedIntakeReceipt } from "@/lib/vehicleIntakeReceipt";

export default function VehicleIntakeReceiptCheck({ entryId, receiptId, legacyReason, onChange, readOnly = false, initialReference = "" }: {
  entryId: string; receiptId?: string | null; legacyReason?: string | null; readOnly?: boolean; initialReference?: string;
  onChange: (receiptId: string | null, legacyReason: string) => void;
}) {
  const { i18n } = useTranslation(); const en = i18n.language.startsWith("en"); const text = (ar: string, english: string) => en ? english : ar;
  const id = useId().replace(/:/g, ""); const [reference, setReference] = useState(initialReference); const [verified, setVerified] = useState<VerifiedIntakeReceipt | null>(null);
  const verificationGeneration = useRef(0); const fileRef = useRef<HTMLInputElement>(null); const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [scanning, setScanning] = useState(false);
  const perms = useQuery({ queryKey: ["intake-receipt-permissions"], queryFn: getIntakeReceiptPermissions });
  const context = useQuery({ queryKey: ["vehicle-intake-receipts", entryId], queryFn: () => getIntakeReceiptContext(entryId), enabled: !!entryId && !readOnly });
  useEffect(() => {
    if (!scanning) return;
    let active = true; let scanner: import("html5-qrcode").Html5Qrcode | undefined;
    setError("");
    const timeout = window.setTimeout(() => { if (active) { setError(text("لم تستجب الكاميرا. تحقق من إذن الكاميرا أو اقرأ صورة QR أو أدخل رقم الوصل.", "Camera did not respond. Check camera permission, read a QR image, or enter the receipt number.")); setScanning(false); } }, 15000);
    void import("html5-qrcode").then(async ({ Html5Qrcode }) => {
      if (!active) return;
      scanner = new Html5Qrcode(`receipt-camera-${id}`, { verbose: false });
      try { await scanner.start({ facingMode: "environment" }, { fps: 8, qrbox: 220 }, (value) => { if (active) { verificationGeneration.current++; setReference(value); setVerified(null); onChange(null, ""); setScanning(false); } }, () => {}); window.clearTimeout(timeout); if (!active && scanner.isScanning) { await scanner.stop(); scanner.clear(); } }
      catch { window.clearTimeout(timeout); if (active) { setError(text("تعذر فتح الكاميرا. أدخل رقم الوصل أو الصق الرمز.", "Camera unavailable. Enter the receipt number or paste its QR link.")); setScanning(false); } }
    }).catch(() => { window.clearTimeout(timeout); if (active) { setError(text("تعذر تحميل قارئ QR. أدخل رقم الوصل.", "QR scanner could not load. Enter the receipt number.")); setScanning(false); } });
    return () => { active = false; window.clearTimeout(timeout); if (scanner?.isScanning) void scanner.stop().then(() => scanner?.clear()).catch(() => {}); };
  }, [scanning, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { verificationGeneration.current++; }, [entryId]);
  async function readQrFile(file?: File) {
    if (!file) return;
    setReadingFile(true); setError(""); const generation = ++verificationGeneration.current; setVerified(null); onChange(null, "");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const reader = new Html5Qrcode(`receipt-camera-${id}`, { verbose: false });
      try { const value = await reader.scanFile(file, false); if (generation === verificationGeneration.current) setReference(value); }
      finally { reader.clear(); }
    } catch { setError(text("تعذرت قراءة QR من الصورة. اختر صورة واضحة أو أدخل رقم الوصل.", "Could not read a QR code in the image. Choose a clear image or enter the receipt number.")); }
    finally { setReadingFile(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function verify() {
    const generation = ++verificationGeneration.current;
    setBusy(true); setError(""); setVerified(null); onChange(null, "");
    try { const result = await verifyIntakeReceipt(entryId, reference); if (generation === verificationGeneration.current) { setVerified(result); onChange(result.id, ""); } }
    catch (e) { if (generation === verificationGeneration.current) setError((e as Error).message); } finally { setBusy(false); }
  }
  if (readOnly) return <div className="rounded border p-3 text-sm">{legacyReason ? <>{text("استثناء زيارة قديمة:", "Legacy visit exception:")} {legacyReason}</> : <>{text("وصل الاستلام المرتبط:", "Linked intake receipt:")} {receiptId || text("محضر سابق لتفعيل الميزة", "Handover predating this feature")}</>}</div>;
  return <section className="space-y-2 rounded-lg border p-3" dir={en ? "ltr" : "rtl"}>
    <h3 className="font-semibold">{text("التحقق من وصل الاستلام", "Verify intake receipt")}</h3>
    <Label htmlFor={`receipt-reference-${id}`}>{text("رقم الوصل أو رمز QR", "Receipt number or QR link")}</Label>
    <Input id={`receipt-reference-${id}`} value={reference} onChange={(e) => { verificationGeneration.current++; setReference(e.target.value); setVerified(null); onChange(null, ""); }} placeholder="VIR-ENT-…" dir="ltr" />
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || readingFile || scanning || !reference.trim() || !perms.data?.Verify} onClick={verify}>{text("تحقق من الوصل", "Verify receipt")}</Button><Button type="button" variant="outline" disabled={readingFile} onClick={() => setScanning(!scanning)}>{scanning ? text("إغلاق الكاميرا", "Close camera") : text("مسح QR", "Scan QR")}</Button><Button type="button" variant="outline" disabled={scanning || readingFile} onClick={() => fileRef.current?.click()}>{readingFile ? text("جارٍ قراءة الصورة…", "Reading image…") : text("قراءة صورة QR", "Read QR image")}</Button></div>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={text("صورة رمز QR", "QR code image")} onChange={(event) => void readQrFile(event.target.files?.[0])} />
    <div id={`receipt-camera-${id}`} className={scanning ? "max-w-sm" : "hidden"} />
    {verified && <div role="status" className="rounded bg-emerald-50 p-2 text-emerald-900"><b>{verified.receipt_number}</b><p>{verified.entry_number} · {verified.signer_name}</p><p>{[verified.vehicle.make || verified.vehicle.brand, verified.vehicle.model, verified.vehicle.plate_number, verified.vehicle.plate_letters].filter(Boolean).join(" · ")}</p></div>}
    {(error || context.error || perms.error) && <p role="alert" className="text-sm text-destructive">{error || (context.error as Error)?.message || (perms.error as Error)?.message}</p>}
    {context.data?.required === false && perms.data?.["Legacy exception"] && <div className="space-y-2 border-t pt-3"><Label htmlFor={`legacy-reason-${id}`}>{text("استثناء لزيارة قديمة — اكتب سببًا واضحًا بدل الوصل", "Legacy visit exception — give a clear reason in place of a receipt")}</Label><Textarea id={`legacy-reason-${id}`} value={legacyReason || ""} maxLength={1000} onChange={(e) => { verificationGeneration.current++; setVerified(null); onChange(null, e.target.value); }} /><p className="text-xs text-muted-foreground">{text("يحفظ السبب والموظف والوقت في سجل التدقيق عند التسليم. لا ينشئ توقيعًا أو وصلًا بأثر رجعي.", "The reason, employee and time are audited at delivery. No signature or receipt is created retroactively.")}</p></div>}
  </section>;
}
