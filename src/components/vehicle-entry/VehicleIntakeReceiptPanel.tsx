import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { toast } from "sonner";
import { buildIntakeReceiptHtml, cancelIntakeReceipt, getIntakeReceiptContext, getIntakeReceiptDocument, getIntakeReceiptHistory, getIntakeReceiptPermissions, getSignedIntakeRevision, issueIntakeReceipt, receiptDateTime } from "@/lib/vehicleIntakeReceipt";
import { buildVehicleEntryHtml } from "@/lib/vehicleEntryService";

export default function VehicleIntakeReceiptPanel({ entryId, revision }: { entryId: string; revision: number }) {
  const { i18n } = useTranslation(); const en = i18n.language.startsWith("en"); const qc = useQueryClient();
  const text = (ar: string, english: string) => en ? english : ar;
  const permissions = useQuery({ queryKey: ["intake-receipt-permissions"], queryFn: getIntakeReceiptPermissions });
  const hasAccess = !!permissions.data && Object.values(permissions.data).some(Boolean);
  const context = useQuery({ queryKey: ["vehicle-intake-receipts", entryId, revision], queryFn: () => getIntakeReceiptContext(entryId), enabled: hasAccess });
  const [html, setHtml] = useState(""); const [pdfOpen, setPdfOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(""); const [cancelId, setCancelId] = useState<string | null>(null); const [historyOpen, setHistoryOpen] = useState(false);
  const history = useQuery({ queryKey: ["intake-receipt-history", entryId], queryFn: () => getIntakeReceiptHistory(entryId), enabled: historyOpen && permissions.data?.History === true });
  async function run(action: () => Promise<unknown>) { setBusy(true); try { await action(); await qc.invalidateQueries({ queryKey: ["vehicle-intake-receipts", entryId] }); await qc.invalidateQueries({ queryKey: ["intake-receipt-history", entryId] }); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  const statuses = { draft: text("مسودة", "Draft"), issued: text("صادر", "Issued"), used: text("تم استخدامه", "Used"), cancelled: text("ملغى", "Cancelled"), replaced: text("مستبدل بإصدار أحدث", "Replaced by a newer revision") };
  if (permissions.data && !hasAccess) return null;
  return <Card className="space-y-3 p-4" dir={en ? "ltr" : "rtl"}>
    <h2 className="text-lg font-bold">{text("وصل استلام المركبة", "Vehicle intake receipt")}</h2>
    <p className="text-sm text-muted-foreground">{text("يصدر تلقائيًا بعد توقيع مُسلّم المركبة. تحفظ النسخة الموقعة، ويُستخدم الوصل مرة واحدة عند التسليم.", "Issued automatically after the vehicle intake signer signs. The signed revision is preserved and the receipt is used once at delivery.")}</p>
    {context.isLoading && <p role="status">{text("جارٍ تحميل الوصل…", "Loading receipt…")}</p>}
    {context.error && <p role="alert" className="text-destructive">{(context.error as Error).message}</p>}
    {context.data?.receipts.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
      <span className="font-mono text-sm" dir="ltr">{r.receipt_number}</span><span>{statuses[r.status]} · {text("الإصدار", "Revision")} {r.revision}</span><span className="text-sm">{r.signer_name}</span>
      {permissions.data?.Print && <>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { setHtml(await buildIntakeReceiptHtml(await getIntakeReceiptDocument(r.id), en ? "en" : "ar")); setPdfOpen(true); })}>{text("معاينة / تنزيل / طباعة الوصل", "Preview / download / print receipt")}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { setHtml(await buildIntakeReceiptHtml(await getIntakeReceiptDocument(r.id), en ? "en" : "ar", true)); setPdfOpen(true); })}>{text("الوصل مع نموذج الدخول", "Receipt with intake form")}</Button>
      </>}
      {r.status === "issued" && permissions.data?.Cancel && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setCancelId(r.id); setReason(""); }}>{text("إلغاء الوصل", "Cancel receipt")}</Button>}
    </div>)}
    {context.data?.receipts.length === 0 && <p className="text-sm">{text("لا يوجد وصل لهذا النموذج بعد. يلزم توقيع الإصدار الحالي، ولن يُنقل أي توقيع قديم إليه.", "No receipt yet. The current revision must be signed; an old signature is never carried forward.")}</p>}
    <div className="flex flex-wrap gap-2">
      {permissions.data?.Issue && <Button variant="outline" disabled={busy} onClick={() => run(() => issueIntakeReceipt(entryId))}>{text("استرجاع الوصل الصادر", "Retrieve issued receipt")}</Button>}
      <Button variant="outline" disabled={busy} onClick={() => context.refetch()}>{text("تحديث", "Refresh")}</Button>
      {permissions.data?.History && <Button variant="outline" onClick={() => setHistoryOpen(!historyOpen)}>{text("سجل التدقيق", "Audit history")}</Button>}
    </div>
    {cancelId && <div className="space-y-2 rounded border p-3"><label htmlFor="custody-cancel-reason">{text("سبب إلغاء الوصل", "Receipt cancellation reason")}</label><Input id="custody-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /><Button disabled={busy || reason.trim().length < 5} onClick={() => run(async () => { await cancelIntakeReceipt(cancelId, reason); setCancelId(null); })}>{text("تأكيد الإلغاء", "Confirm cancellation")}</Button><Button variant="ghost" onClick={() => setCancelId(null)}>{text("رجوع", "Back")}</Button></div>}
    {historyOpen && <div className="space-y-2 text-sm">
      {history.error && <p role="alert">{(history.error as Error).message}</p>}
      {history.data?.map((a) => <div key={a.id} className="space-y-1 rounded border p-2">
        <b>{({ issued: text("إصدار", "Issued"), verified: text("تحقق", "Verified"), used: text("استخدام عند التسليم", "Used at delivery"), replaced: text("استبدال", "Replaced"), cancelled: text("إلغاء", "Cancelled"), document_viewed: text("فتح المستند", "Document opened"), legacy_delivery_exception: text("استثناء زيارة قديمة", "Legacy delivery exception"), legacy_intake_preserved: text("حفظ نموذج الدخول السابق", "Previous signed intake preserved"), signed_revision_viewed: text("عرض نموذج محفوظ", "Saved intake viewed") } as Record<string, string>)[a.action] || a.action}</b>
        <span> · {receiptDateTime(a.occurred_at, en ? "en" : "ar")}</span><p dir="ltr">{a.actor_id || "—"}</p>
        {a.details.reason != null && <p>{String(a.details.reason)}</p>}
        {a.details.revision_id != null && permissions.data?.Print && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => {
          const source = await getSignedIntakeRevision(String(a.details.revision_id));
          setHtml(buildVehicleEntryHtml(source, en ? "en" : "ar")); setPdfOpen(true);
        })}>{text("عرض نموذج الدخول المحفوظ", "View saved intake form")}</Button>}
      </div>)}
    </div>}
    <PdfPreviewDialog open={pdfOpen} onOpenChange={setPdfOpen} htmlContent={html} title={text("وصل استلام المركبة", "Vehicle intake receipt")} fileName={`vehicle-intake-receipt-${entryId}`} />
  </Card>;
}
