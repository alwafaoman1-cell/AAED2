import { useEffect, useMemo, useRef, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, Edit, Printer, FileText, Layers, Link as LinkIcon, Copy,
  CreditCard, Crosshair, Paperclip, MoreHorizontal, CalendarPlus, FileEdit, Trash2,
  ChevronUp, ChevronDown, Plus, Send, X, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  salesStore, SalesDoc, SalesDocType, statusLabel,
} from "@/lib/salesStore";
import SalesStatusBadge from "./SalesStatusBadge";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import TemplatePicker from "@/components/print/TemplatePicker";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { getInvoiceHtml, getQuoteHtml, getTemplateSettings } from "@/lib/pdfGenerator";
import { buildZatcaQrDataUrl } from "@/lib/zatcaQr";
import UnifiedSendButton from "@/components/UnifiedSendButton";

interface Props {
  type: SalesDocType;
  backRoute: string;
  editRoute: (id: string) => string;
  listRoute: string;
}

export default function SalesDocDetailPage({ type, backRoute, editRoute, listRoute }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const [tick, setTick] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showAppt, setShowAppt] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [pdfHtml, setPdfHtml] = useState<string>("");
  const [showPdf, setShowPdf] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [confirmCfg, setConfirmCfg] = useState<{
    title: string; description: string; onConfirm: () => void;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = salesStore.subscribe(() => setTick((x) => x + 1));
    return () => { u(); };
  }, []);

  const doc = useMemo(() => salesStore.get(id), [id, tick]);

  function doDelete() {
    salesStore.remove(doc.id);
    toast.success(isAr ? "تم النقل للمحذوفات" : "Moved to trash");
    navigate(listRoute);
  }
  function doDuplicate() {
    const c = salesStore.duplicate(doc.id);
    if (c) { toast.success(isAr ? "تم النسخ" : "Copied"); navigate(`${listRoute}/${c.id}`); }
  }
  function setDraft() {
    salesStore.setStatus(doc.id, "draft");
    toast.success(isAr ? "تم التحويل لمسودة" : "Converted to draft");
  }
  function convertToInvoice() {
    const inv = salesStore.convertToInvoice(doc.id);
    if (inv) { toast.success(isAr ? "تم التحويل لفاتورة" : "Converted to invoice"); navigate(`/sales/invoices/${inv.id}`); }
  }

  async function buildHtml(): Promise<string> {
    if (!doc) return "";
    const tpl = getTemplateSettings();
    const items = doc.items.map((it) => {
      const line = it.quantity * it.unitPrice;
      const disc = (line * (it.discount || 0)) / 100;
      const taxable = line - disc;
      return {
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        // إجمالي السطر قبل الضريبة — الضريبة تظهر مرة واحدة في صندوق الإجماليات
        total: taxable,
      };
    });
    const vehicleInfo = doc.vehicle
      ? `${doc.vehicle.make || ""} ${doc.vehicle.model || ""}${doc.vehicle.year ? ` - ${doc.vehicle.year}` : ""}`.trim()
      : "—";

    let qrDataUrl = "";
    try {
      qrDataUrl = await buildZatcaQrDataUrl({
        sellerName: tpl.companyName,
        vatNumber: tpl.vatNumber,
        timestamp: new Date(doc.date).toISOString(),
        total: doc.total,
        vat: doc.taxTotal,
      });
    } catch (e) {
      console.warn("QR build failed", e);
    }

    const paidVia = (doc.payments && doc.payments.length > 0)
      ? Array.from(new Set(doc.payments.map(p => p.method).filter(Boolean))).join(" + ")
      : "";

    const baseData = {
      invoiceNumber: doc.number,
      date: doc.date,
      customerName: doc.customerName,
      customerPhone: "",
      vehicleInfo,
      plateNumber: doc.vehicle?.plate || "—",
      items,
      subtotal: doc.subtotal,
      vat: doc.taxTotal,
      total: doc.total,
      notes: doc.notes,
      paymentTerms: doc.paymentTerms,
      paidVia,
      paidTotal: doc.paidTotal || 0,
      balanceDue: doc.balanceDue,
    };
    return type === "quote"
      ? getQuoteHtml({ ...baseData, quoteNumber: doc.number })
      : injectQrIntoInvoice(getInvoiceHtml(baseData), qrDataUrl, isAr);
  }

  async function buildAndShowPdf() {
    if (!doc) return;
    const html = await buildHtml();
    setPdfHtml(html);
    setShowPdf(true);
  }

  // Build the live in-page preview HTML using the same template
  useEffect(() => {
    if (!doc) {
      setPreviewHtml("");
      return;
    }
    let cancelled = false;
    buildHtml().then((h) => { if (!cancelled) setPreviewHtml(h); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, tick]);

  if (!doc) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{isAr ? "المستند غير موجود" : "Document not found"}</p>
        <Button className="mt-4" onClick={() => smartBack(navigate, listRoute)}>{isAr ? "عودة" : "Back"}</Button>
      </div>
    );
  }

  const currency = doc.currency === "OMR" ? "ر.ع" : doc.currency;

  return (
    <div className="space-y-3" dir={isRtl ? "rtl" : "ltr"}>
      {/* Top bar with status + nav */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, listRoute)}>
            <ArrowLeft className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{titleByType(type, isAr)} #{doc.number}</h1>
              <SalesStatusBadge status={doc.status} />
            </div>
            <div className="text-xs text-muted-foreground">{doc.customerName}</div>
            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3 flex-wrap" dir="ltr">
              <span title={isAr ? "تاريخ إصدار الفاتورة (لا يتغير عند الدفع)" : "Issue date (does not change on payment)"}>
                📄 {isAr ? "إصدار:" : "Issued:"} {new Date(doc.date).toLocaleDateString(isAr ? "ar-OM" : "en-GB")}
              </span>
              {doc.payments && doc.payments.length > 0 && (() => {
                const last = doc.payments.reduce((a, b) => (a.date > b.date ? a : b)).date;
                return (
                  <span className="text-success" title={isAr ? "تاريخ آخر تحصيل" : "Last payment date"}>
                    💵 {isAr ? "آخر تحصيل:" : "Last paid:"} {new Date(last).toLocaleDateString(isAr ? "ar-OM" : "en-GB")}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <TemplatePicker docType={(type === "quote" ? "quote" : "tax_invoice") as any} size="sm" />
          <UnifiedSendButton
            ctx={{
              recipientName: doc.customerName,
              phone: (doc as any).customerPhone || undefined,
              email: (doc as any).customerEmail || undefined,
              htmlContent: previewHtml,
              fileBaseName: `${titleByType(type, true)}-${doc.number}`,
              emailSubject: `${titleByType(type, true)} ${doc.number}`,
              defaultMessage: isAr
                ? `مرحباً ${doc.customerName}،\nمرفق ${titleByType(type, true)} رقم ${doc.number} بقيمة ${doc.total} ${currency}.`
                : `Hello ${doc.customerName},\nAttached is ${titleByType(type, false)} #${doc.number} for ${doc.total} ${currency}.`,
              payment: type === "invoice" && doc.balanceDue > 0.001 ? {
                amount: doc.balanceDue,
                currency: doc.currency || "OMR",
                sourceType: "invoice",
                sourceId: doc.id,
                sourceReference: doc.number,
                description: `${titleByType(type, true)} ${doc.number}`,
              } : undefined,
            }}
            label={isAr ? "إرسال" : "Send"}
          />
          <Button variant="outline" size="icon" title={isAr ? "السابق" : "Prev"}><ChevronUp className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" title={isAr ? "التالي" : "Next"}><ChevronDown className="h-4 w-4" /></Button>
          <Button className="gap-2" onClick={buildAndShowPdf}>
            <Printer className="h-4 w-4" /> {isAr ? "طباعة / PDF" : "Print / PDF"}
          </Button>
        </div>
      </div>

      {/* Toolbar (دفترة style) */}
      <div className="rounded-lg border bg-card p-2 flex flex-wrap items-center gap-1 text-sm">
        <ToolbarBtn icon={<Edit className="h-4 w-4" />} label={isAr ? "تعديل" : "Edit"} onClick={() => navigate(editRoute(doc.id))} />
        <ToolbarBtn icon={<Printer className="h-4 w-4" />} label={isAr ? "طباعة" : "Print"} onClick={buildAndShowPdf} />
        <ToolbarBtn icon={<FileText className="h-4 w-4" />} label="PDF" onClick={buildAndShowPdf} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-muted">
              <Layers className="h-4 w-4" /> {isAr ? "قسائم" : "Vouchers"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setShowPayment(true)}>{isAr ? "إضافة سند قبض" : "Add receipt voucher"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-muted">
              <LinkIcon className="h-4 w-4" /> {isAr ? "مرجع" : "Reference"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!doc.fromDocId}>
              {doc.fromDocId
                ? (isAr ? `محول من: ${doc.fromDocType} ${doc.fromDocId}` : `Linked from ${doc.fromDocType}`)
                : (isAr ? "لا يوجد مرجع" : "No reference")}
            </DropdownMenuItem>
            {type === "quote" && (
              <DropdownMenuItem onClick={convertToInvoice}>{isAr ? "تحويل إلى فاتورة" : "Convert to invoice"}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarBtn icon={<Copy className="h-4 w-4" />} label={isAr ? "نسخ" : "Duplicate"} onClick={doDuplicate} />
        {type !== "quote" && (
          <ToolbarBtn icon={<CreditCard className="h-4 w-4" />} label={isAr ? "إضافة عملية دفع" : "Add payment"} onClick={() => setShowPayment(true)} />
        )}
        {type !== "quote" && doc.balanceDue > 0.001 && (
          <ToolbarBtn
            icon={<CheckCircle2 className="h-4 w-4 text-success" />}
            label={isAr ? "تحويل لمدفوعة" : "Mark as paid"}
            onClick={() => {
              setConfirmCfg({
                title: isAr ? "تأكيد التحويل لمدفوعة" : "Confirm mark as paid",
                description: isAr
                  ? `سيتم تسجيل دفعة بقيمة ${doc.balanceDue.toFixed(3)} ${currency} وتحويل الفاتورة إلى مدفوعة. متابعة؟`
                  : `Record a payment of ${doc.balanceDue.toFixed(3)} ${currency} and mark as paid?`,
                onConfirm: () => {
                  salesStore.markPaidInFull(doc.id, isAr ? "نقداً" : "Cash");
                  toast.success(isAr ? "تم تحويل الفاتورة إلى مدفوعة" : "Marked as paid");
                },
              });
            }}
          />
        )}
        {type === "quote" && (
          doc.status === "converted" ? (
            <ToolbarBtn
              icon={<CheckCircle2 className="h-4 w-4 text-success" />}
              label={isAr ? "محوّل لفاتورة بالفعل" : "Already converted"}
              onClick={() => toast.info(isAr ? "هذا العرض محوّل لفاتورة بالفعل" : "This quote is already converted to an invoice")}
            />
          ) : (
            <ToolbarBtn
              icon={<ArrowLeft className="h-4 w-4 text-primary" />}
              label={isAr ? "تحويل لفاتورة" : "Convert to invoice"}
              onClick={() => {
                setConfirmCfg({
                  title: isAr ? "تأكيد التحويل لفاتورة" : "Confirm convert to invoice",
                  description: isAr
                    ? `سيتم إنشاء فاتورة جديدة من عرض السعر ${doc.number}. متابعة؟`
                    : `A new invoice will be created from quote ${doc.number}. Continue?`,
                  onConfirm: () => { convertToInvoice(); },
                });
              }}
            />
          )
        )}
        <ToolbarBtn icon={<Crosshair className="h-4 w-4" />} label={isAr ? "تعيين مراكز التكلفة" : "Cost centers"} onClick={() => setShowCost(true)} />
        <ToolbarBtn icon={<Paperclip className="h-4 w-4" />} label={isAr ? "إضافة ملاحظة/مرفق" : "Note / attachment"} onClick={() => setShowNote(true)} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-muted">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setShowAppt(true)}><CalendarPlus className="h-4 w-4 me-2" /> {isAr ? "ترتيب موعد" : "Schedule"}</DropdownMenuItem>
            <DropdownMenuItem onClick={setDraft}><FileEdit className="h-4 w-4 me-2" /> {isAr ? "تحويل إلى مسودة" : "Convert to draft"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={doDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 me-2" /> {isAr ? "حذف" : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tabs: details / activity */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{isAr ? "التفاصيل" : "Details"}</TabsTrigger>
          <TabsTrigger value="activity">{isAr ? "سجل النشاطات" : "Activity"}</TabsTrigger>
          <TabsTrigger value="payments">{isAr ? "الدفعات" : "Payments"} ({doc.payments.length})</TabsTrigger>
          <TabsTrigger value="attachments">{isAr ? "المرفقات" : "Attachments"} ({doc.attachments.length})</TabsTrigger>
          <TabsTrigger value="notes">{isAr ? "الملاحظات" : "Notes"} ({doc.noteEntries.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-3 mt-3">
          {/* Live preview rendered with the same template as the printed PDF */}
          <div className="rounded-lg border bg-card overflow-hidden">
            {previewHtml ? (
              <iframe
                title="invoice-preview"
                srcDoc={previewHtml}
                className="w-full bg-white"
                style={{ height: "1100px", border: "0" }}
              />
            ) : (
              <div className="text-center py-16 text-sm text-muted-foreground">
                {isAr ? "جارٍ تحميل القالب..." : "Loading template..."}
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-6">

            {/* Inline payments panel inside details */}
            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{isAr ? "الدفعات المسجلة" : "Recorded payments"}</h3>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowPayment(true)}>
                  <Plus className="h-3.5 w-3.5" /> {isAr ? "إضافة دفعة" : "Add payment"}
                </Button>
              </div>
              {doc.payments.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded">
                  {isAr ? "لا توجد دفعات بعد — أضف أول دفعة" : "No payments yet — add the first one"}
                </div>
              ) : (
                <table className="w-full text-xs border">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-2 text-start border">{isAr ? "التاريخ" : "Date"}</th>
                      <th className="p-2 text-start border">{isAr ? "طريقة الدفع" : "Method"}</th>
                      <th className="p-2 text-start border">{isAr ? "مرجع" : "Reference"}</th>
                      <th className="p-2 text-end border">{isAr ? "المبلغ" : "Amount"}</th>
                      <th className="p-2 border w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.payments.map((p) => (
                      <tr key={p.id} className="border">
                        <td className="p-2 border">{p.date}</td>
                        <td className="p-2 border">{p.method}</td>
                        <td className="p-2 border text-muted-foreground">{p.reference || "—"}</td>
                        <td className="p-2 border text-end font-mono font-semibold">{p.amount.toFixed(3)} {currency}</td>
                        <td className="p-2 border text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setConfirmCfg({
                                title: isAr ? "حذف الدفعة" : "Delete payment",
                                description: isAr ? "هل تريد حذف هذه الدفعة؟" : "Delete this payment?",
                                onConfirm: () => {
                                  salesStore.removePayment(doc.id, p.id);
                                  toast.success(isAr ? "تم الحذف" : "Removed");
                                },
                              });
                            }}
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {doc.notes && (
              <div className="mt-6 text-xs text-muted-foreground border-t pt-3">
                <strong>{isAr ? "ملاحظات:" : "Notes:"}</strong> {doc.notes}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <div className="rounded-lg border bg-card divide-y">
            {doc.activity.slice().reverse().map((a) => (
              <div key={a.id} className="p-3 text-sm flex justify-between">
                <span>{a.text}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.at).toLocaleString(isAr ? "ar-OM" : "en-GB")}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="payments" className="mt-3">
          <div className="rounded-lg border bg-card">
            <div className="p-3 flex items-center justify-between border-b">
              <h3 className="text-sm font-semibold">{isAr ? "الدفعات" : "Payments"}</h3>
              <Button size="sm" className="gap-1.5" onClick={() => setShowPayment(true)}>
                <Plus className="h-3.5 w-3.5" /> {isAr ? "إضافة دفعة" : "Add payment"}
              </Button>
            </div>
            <div className="divide-y">
              {doc.payments.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد دفعات" : "No payments"}</div>}
              {doc.payments.map((p) => (
                <div key={p.id} className="p-3 text-sm flex justify-between items-center">
                  <div>
                    <div className="font-medium">{p.method} {p.reference && <span className="text-muted-foreground">— {p.reference}</span>}</div>
                    <div className="text-xs text-muted-foreground">{p.date}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-mono font-bold">{p.amount.toFixed(3)} {currency}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setConfirmCfg({
                          title: isAr ? "حذف الدفعة" : "Delete payment",
                          description: isAr ? "هل تريد حذف هذه الدفعة؟" : "Delete this payment?",
                          onConfirm: () => {
                            salesStore.removePayment(doc.id, p.id);
                            toast.success(isAr ? "تم الحذف" : "Removed");
                          },
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {doc.payments.length > 0 && (
              <div className="p-3 border-t bg-muted/30 text-sm flex justify-between font-semibold">
                <span>{isAr ? "إجمالي المدفوع" : "Total paid"}</span>
                <span className="font-mono">{doc.paidTotal.toFixed(3)} {currency}</span>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="attachments" className="mt-3">
          <div className="rounded-lg border bg-card divide-y">
            {doc.attachments.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد مرفقات" : "No attachments"}</div>}
            {doc.attachments.map((a) => (
              <a key={a.id} href={a.dataUrl} download={a.name} className="p-3 text-sm flex justify-between hover:bg-muted/50">
                <span>{a.name}</span>
                <span className="text-xs text-muted-foreground">{(a.size / 1024).toFixed(1)} KB</span>
              </a>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-3">
          <div className="rounded-lg border bg-card divide-y">
            {doc.noteEntries.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد ملاحظات" : "No notes"}</div>}
            {doc.noteEntries.map((n) => (
              <div key={n.id} className="p-3 text-sm">
                <div>{n.text}</div>
                <div className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString(isAr ? "ar-OM" : "en-GB")}</div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <PaymentDialog open={showPayment} onClose={() => setShowPayment(false)} doc={doc} isAr={isAr} />
      <NoteDialog open={showNote} onClose={() => setShowNote(false)} doc={doc} isAr={isAr} />
      <AppointmentDialog open={showAppt} onClose={() => setShowAppt(false)} doc={doc} isAr={isAr} />
      <CostCenterDialog open={showCost} onClose={() => setShowCost(false)} doc={doc} isAr={isAr} />
      {showPdf && (
        <PdfPreviewDialog
          open={showPdf}
          onOpenChange={setShowPdf}
          htmlContent={pdfHtml}
          title={`${titleByType(type, isAr)} ${doc.number}`}
          fileName={`${type}-${doc.number}`}
          recipientName={doc.customerName}
          recipientPhone={(doc as any).customerPhone || ""}
        />
      )}

      <AlertDialog open={!!confirmCfg} onOpenChange={(o) => !o && setConfirmCfg(null)}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCfg?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCfg?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmCfg?.onConfirm(); setConfirmCfg(null); }}>
              {isAr ? "متابعة" : "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Inject QR image after the totals box in the legacy invoice HTML. */
function injectQrIntoInvoice(html: string, qrDataUrl: string, isAr: boolean): string {
  if (!qrDataUrl) return html;
  const qrBlock = `<div style="margin-top:14px;display:flex;justify-content:flex-end;"><div style="text-align:center;"><img src="${qrDataUrl}" style="width:120px;height:120px;border:1px solid #ddd;padding:4px;background:#fff;display:block;"/><div style="font-size:9px;color:#888;margin-top:4px;letter-spacing:0.5px;">${isAr ? "رمز ZATCA" : "ZATCA / TLV QR"}</div></div></div>`;
  return html.replace('</div>\n  </div>', `${qrBlock}</div>\n  </div>`).replace('</body>', `${''}</body>`);
}

function ToolbarBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-muted">
      {icon} {label}
    </button>
  );
}

function Row({ k, v, c, bold }: { k: string; v: number; c: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}>
      <span>{k}</span>
      <span className="font-mono">{v.toFixed(3)} {c}</span>
    </div>
  );
}

function titleByType(t: SalesDocType, isAr: boolean) {
  const map: Record<SalesDocType, [string, string]> = {
    invoice: ["فاتورة", "Invoice"],
    quote: ["عرض سعر", "Quote"],
    credit_note: ["إشعار دائن", "Credit note"],
    return_invoice: ["فاتورة مرتجعة", "Return invoice"],
    recurring_invoice: ["فاتورة دورية", "Recurring invoice"],
    customer_payment: ["دفعة عميل", "Customer payment"],
  };
  return isAr ? map[t][0] : map[t][1];
}

const PAYMENT_METHODS_AR = [
  "نقداً",
  "تحويل بنكي - حساب الشركة",
  "تحويل بنكي - حساب شخصي",
  "شيك",
  "بطاقة",
];
const PAYMENT_METHODS_EN: Record<string, string> = {
  "نقداً": "Cash",
  "تحويل بنكي - حساب الشركة": "Bank transfer - Company",
  "تحويل بنكي - حساب شخصي": "Bank transfer - Personal",
  "شيك": "Cheque",
  "بطاقة": "Card",
};

function PaymentDialog({ open, onClose, doc, isAr }: { open: boolean; onClose: () => void; doc: SalesDoc; isAr: boolean }) {
  const [amount, setAmount] = useState(doc.balanceDue || 0);
  const [method, setMethod] = useState<string>("نقداً");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [showOver, setShowOver] = useState(false);
  const [markFullPaid, setMarkFullPaid] = useState(false);

  // Reset balance amount whenever opened
  useEffect(() => {
    if (open) {
      setAmount(doc.balanceDue || 0);
      setRef("");
      setDate(new Date().toISOString().slice(0, 10));
      setMethod("نقداً");
      setMarkFullPaid(false);
    }
  }, [open, doc.balanceDue]);

  // عند تفعيل "مدفوعة بالكامل بالفعل" يتم تعبئة المبلغ بالرصيد المتبقي تلقائياً
  useEffect(() => {
    if (markFullPaid) setAmount(doc.balanceDue || 0);
  }, [markFullPaid, doc.balanceDue]);

  function commit() {
    salesStore.addPayment(doc.id, { amount, method, date, reference: ref });
    toast.success(isAr ? "تمت إضافة الدفعة" : "Payment added");
    onClose();
  }

  function save() {
    if (amount <= 0) { toast.error(isAr ? "أدخل قيمة" : "Enter amount"); return; }
    if (amount > doc.balanceDue + 0.001) { setShowOver(true); return; }
    commit();
  }
  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isAr ? "إضافة عملية دفع" : "Add payment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded bg-muted/40 p-2 text-xs flex justify-between">
            <span>{isAr ? "الإجمالي" : "Total"}: <strong className="font-mono">{doc.total.toFixed(3)}</strong></span>
            <span>{isAr ? "المدفوع" : "Paid"}: <strong className="font-mono text-success">{doc.paidTotal.toFixed(3)}</strong></span>
            <span>{isAr ? "المتبقي" : "Balance"}: <strong className="font-mono text-destructive">{doc.balanceDue.toFixed(3)}</strong></span>
          </div>
          <div>
            <Label>{isAr ? "القيمة (قابلة للتعديل — يمكن إدخال دفعة جزئية)" : "Amount (editable — partial payments allowed)"}</Label>
            <Input type="text" inputMode="decimal" step="0.001" value={amount} onChange={(e) => { setAmount(parseMoneyInput(e.target.value)); setMarkFullPaid(false); }} />
          </div>
          <div>
            <Label>{isAr ? "طريقة الدفع" : "Method"}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS_AR.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {isAr ? opt : PAYMENT_METHODS_EN[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>{isAr ? "مرجع / رقم العملية" : "Reference"}</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={isAr ? "اختياري" : "optional"} /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 items-center">
          <label className="flex items-center gap-2 me-auto text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-success"
              checked={markFullPaid}
              onChange={(e) => setMarkFullPaid(e.target.checked)}
            />
            <span>{isAr ? "مدفوعة بالكامل بالفعل" : "Already fully paid"}</span>
          </label>
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={showOver} onOpenChange={setShowOver}>
      <AlertDialogContent dir={isAr ? "rtl" : "ltr"} className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{isAr ? "المبلغ أكبر من الرصيد" : "Amount exceeds balance"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isAr ? "المبلغ المُدخل أكبر من الرصيد المستحق — هل تريد المتابعة؟" : "Amount exceeds balance due — continue?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setShowOver(false); commit(); }}>
            {isAr ? "متابعة" : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}


function NoteDialog({ open, onClose, doc, isAr }: { open: boolean; onClose: () => void; doc: SalesDoc; isAr: boolean }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  function save() {
    if (text.trim()) salesStore.addNote(doc.id, text.trim());
    toast.success(isAr ? "تم الحفظ" : "Saved");
    setText(""); onClose();
  }
  async function attach(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const { convertImageToWebp, fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const optimized = await convertImageToWebp(f);
    const dataUrl = await fileToWebpDataUrl(f);
    salesStore.addAttachment(doc.id, { name: optimized.name, size: optimized.size, dataUrl });
    toast.success(isAr ? "تم الإرفاق" : "Attached");
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isAr ? "إضافة ملاحظة / مرفق" : "Add note / attachment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>{isAr ? "ملاحظة" : "Note"}</Label><Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div>
            <Label>{isAr ? "إرفاق ملف" : "Attach file"}</Label>
            <input ref={fileRef} type="file" onChange={attach} className="block mt-1 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isAr ? "إغلاق" : "Close"}</Button>
          <Button onClick={save}>{isAr ? "حفظ الملاحظة" : "Save note"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDialog({ open, onClose, doc, isAr }: { open: boolean; onClose: () => void; doc: SalesDoc; isAr: boolean }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  function save() {
    if (!title.trim()) { toast.error(isAr ? "اكتب العنوان" : "Title required"); return; }
    salesStore.addAppointment(doc.id, { title, date, time, note });
    toast.success(isAr ? "تم الحفظ" : "Saved");
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isAr ? "ترتيب موعد" : "Schedule appointment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>{isAr ? "العنوان" : "Title"}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>{isAr ? "الوقت" : "Time"}</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostCenterDialog({ open, onClose, doc, isAr }: { open: boolean; onClose: () => void; doc: SalesDoc; isAr: boolean }) {
  const [val, setVal] = useState(doc.costCenter || "");
  function save() {
    salesStore.setCostCenter(doc.id, val.trim());
    toast.success(isAr ? "تم الحفظ" : "Saved");
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isAr ? "تعيين مركز التكلفة" : "Set cost center"}</DialogTitle></DialogHeader>
        <div><Label>{isAr ? "اسم مركز التكلفة" : "Cost center"}</Label><Input value={val} onChange={(e) => setVal(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
