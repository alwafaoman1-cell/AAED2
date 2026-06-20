import { useEffect, useState } from "react";
import { FileText, Plus, DollarSign, Receipt, Eye, ArrowLeftRight, Edit, Trash2, CheckCircle2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import StatCard from "@/components/StatCard";
import InvoiceEditor, { InvoiceFormData } from "@/components/sales/InvoiceEditor";
import { getAdvancedDocHtml, getInsuranceEstimateHtml } from "@/lib/pdfGenerator";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { moveToTrash, registerRestoreHandler } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { inventoryStore } from "@/lib/inventoryStore";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";

interface DocItem {
  id: string;
  type: "invoice" | "quote";
  customer: string;
  total: number;
  date: string;
  status: string;
  fromQuote?: string;
  data: InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number };
}

const initialDocs: DocItem[] = [];

const statusColors: Record<string, string> = {
  "محول لفاتورة": "bg-success/15 text-success",
  "بانتظار الرد": "bg-warning/15 text-warning",
  "مرفوض": "bg-destructive/15 text-destructive",
  "مدفوعة": "bg-success/15 text-success",
  "غير مدفوعة": "bg-destructive/15 text-destructive",
  "مسودة": "bg-muted text-muted-foreground",
};

export default function Sales() {
  const [docs, setDocs] = useState<DocItem[]>(initialDocs);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"invoice" | "quote">("invoice");
  const [editorInitial, setEditorInitial] = useState<Partial<InvoiceFormData> | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [convertSource, setConvertSource] = useState<DocItem | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [deleting, setDeleting] = useState<DocItem | null>(null);
  const [insuranceSource, setInsuranceSource] = useState<DocItem | null>(null);
  const [insuranceForm, setInsuranceForm] = useState({
    insuranceCompany: "",
    claimNumber: "",
    policyNumber: "",
    vehiclePlate: "",
    vehicleInfo: "",
    incidentDate: new Date().toISOString().split("T")[0],
    incidentDescription: "",
  });
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  // Restore handlers wired to local state
  useEffect(() => {
    registerRestoreHandler("invoice", (p) => setDocs((prev) => prev.some(d => d.id === (p as DocItem).id) ? prev : [p as DocItem, ...prev]));
    registerRestoreHandler("quote", (p) => setDocs((prev) => prev.some(d => d.id === (p as DocItem).id) ? prev : [p as DocItem, ...prev]));
  }, []);

  // فتح فاتورة/عرض سعر تلقائياً عند القدوم من "إجراءات سريعة"
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const newType = params.get("new");
      if (newType !== "invoice" && newType !== "quote") return;
      const raw = sessionStorage.getItem("alwafa_invoice_prefill");
      if (!raw) return;
      const pf = JSON.parse(raw);
      sessionStorage.removeItem("alwafa_invoice_prefill");

      const docType: "invoice" | "quote" = newType === "quote" ? "quote" : "invoice";
      const items: any[] = [];
      const newId = () => Math.random().toString(36).slice(2, 9);

      // 1) القطع المستهلكة فعلياً من حركات المخزون كبنود تفصيلية
      const consumed: Array<{ id: string; name: string; partNumber: string; qty: number; unitPrice: number }> =
        Array.isArray(pf.consumedParts) ? pf.consumedParts : [];
      consumed.forEach((p) => {
        items.push({
          id: newId(),
          description: `${p.name}${p.partNumber ? ` — ${p.partNumber}` : ""}`,
          quantity: p.qty || 1,
          unitPrice: Number(p.unitPrice) || 0,
          discount: 0,
          tax: 5,
          inventoryId: p.id,
        });
      });

      // 2) إذا لم تظهر قطع تفصيلية، اعرض إجمالي قطع الغيار كبند واحد
      const consumedTotal = consumed.reduce((s, p) => s + (p.qty || 0) * (Number(p.unitPrice) || 0), 0);
      if (consumed.length === 0 && pf.partsCost && pf.partsCost > 0) {
        items.push({
          id: newId(),
          description: `قطع غيار — أمر العمل ${pf.workOrderId}`,
          quantity: 1,
          unitPrice: Number(pf.partsCost) || 0,
          discount: 0,
          tax: 5,
        });
      }

      // 3) أجور العمالة كبند مستقل
      if (pf.laborCost && pf.laborCost > 0) {
        items.push({
          id: newId(),
          description: `أجور عمالة وخدمات — أمر العمل ${pf.workOrderId}`,
          quantity: 1,
          unitPrice: Number(pf.laborCost) || 0,
          discount: 0,
          tax: 5,
        });
      }

      if (items.length === 0) {
        items.push({ id: newId(), description: pf.description || "خدمة", quantity: 1, unitPrice: 0, discount: 0, tax: 5 });
      }

      const isInsuranceQuote = docType === "quote" && (pf.insuranceCompany || pf.claimNumber);

      setEditorMode(docType);
      setEditorInitial({
        docType,
        number: nextNumber(docType),
        issueDate: new Date().toISOString().split("T")[0],
        customer: isInsuranceQuote ? pf.insuranceCompany || pf.customer : pf.customer || "",
        paymentTerms:
          docType === "quote"
            ? "هذا تقدير تكلفة صالح لمدة 30 يوماً / Estimate valid for 30 days"
            : "نقداً عند الاستلام / Cash on delivery",
        customFields: [
          { id: newId(), label: "Vehicle / المركبة", value: pf.vehicleInfo || "" },
          { id: newId(), label: "Reg. No / رقم اللوحة", value: pf.vehiclePlate || "" },
          { id: newId(), label: "VIN / رقم الهيكل", value: pf.vin || "" },
          { id: newId(), label: "Work Order / أمر العمل", value: pf.workOrderId || "" },
          { id: newId(), label: "Insurance / شركة التأمين", value: pf.insuranceCompany || "" },
          { id: newId(), label: "Claim No / رقم المطالبة", value: pf.claimNumber || "" },
          { id: newId(), label: "Customer / العميل", value: pf.customer || "" },
        ],
        items,
        notes:
          docType === "quote"
            ? `تقدير تكلفة إصلاح المركبة المذكورة أعلاه. ${pf.description || ""}`
            : pf.description || "",
      });
      setEditingId(null);
      setConvertSource(null);
      setEditorOpen(true);
      // نظف URL
      window.history.replaceState({}, "", "/sales");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quotes = docs.filter(d => d.type === "quote");
  const invoices = docs.filter(d => d.type === "invoice");

  function nextNumber(type: "invoice" | "quote") {
    const prefix = type === "invoice" ? "INV-" : "QT-";
    const same = docs.filter(d => d.type === type);
    return prefix + String(same.length + 1).padStart(5, '0');
  }

  function openNew(type: "invoice" | "quote") {
    setEditorMode(type);
    setEditorInitial({ docType: type, number: nextNumber(type) });
    setEditingId(null);
    setConvertSource(null);
    setEditorOpen(true);
  }

  function openEdit(doc: DocItem) {
    setEditorMode(doc.type);
    setEditorInitial(doc.data);
    setEditingId(doc.id);
    setConvertSource(null);
    setEditorOpen(true);
  }

  function openConvert(quote: DocItem) {
    setEditorMode("invoice");
    setEditorInitial({
      ...quote.data,
      docType: "invoice",
      number: nextNumber("invoice"),
      issueDate: new Date().toISOString().split('T')[0],
    });
    setEditingId(null);
    setConvertSource(quote);
    setEditorOpen(true);
  }

  function handleDelete() {
    if (!deleting) return;
    setDocs((prev) => prev.filter(d => d.id !== deleting.id));
    moveToTrash({
      type: deleting.type,
      entityId: deleting.id,
      label: `${deleting.customer} - ${deleting.total.toLocaleString()} ر.ع`,
      payload: deleting,
    });
    logActivity({
      action: "delete",
      entity: "invoice",
      entityId: deleting.id,
      label: `${deleting.type === "invoice" ? "فاتورة" : "عرض سعر"} ${deleting.id} — ${deleting.customer}`,
      description: "نقل للمهملات",
      amount: deleting.total,
    });
    toast.success(`تم نقل ${deleting.id} للمهملات`);
    setDeleting(null);
  }

  /**
   * تحويل الفاتورة إلى "مدفوعة" + خصم المخزون لكل بند مرتبط بالمخزن.
   * يسمح بالكميات السالبة (المنتج يصبح بكمية ناقصة) مع تنبيه.
   */
  function markAsPaid(doc: DocItem) {
    if (doc.status === "مدفوعة") return;
    let deductedCount = 0;
    let negativeWarnings: string[] = [];
    doc.data.items.forEach((item) => {
      if (!item.inventoryId) return;
      const part = inventoryStore.getById(item.inventoryId);
      if (!part) return;
      const newStock = part.stock - item.quantity;
      const newSold = (part.sold || 0) + item.quantity;
      inventoryStore.update(part.id, { stock: newStock, sold: newSold });
      deductedCount++;
      if (newStock < 0) negativeWarnings.push(`${part.name} (${newStock})`);
    });
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: "مدفوعة" } : d)));
    logActivity({
      action: "payment",
      entity: "invoice",
      entityId: doc.id,
      label: `فاتورة ${doc.id} — ${doc.customer}`,
      description: deductedCount > 0 ? `تأكيد دفع وخصم ${deductedCount} قطعة من المخزن` : "تأكيد دفع الفاتورة",
      amount: doc.total,
    });
    toast.success(
      deductedCount > 0
        ? `تم تأكيد الدفع وخصم ${deductedCount} قطعة من المخزن`
        : `تم تأكيد الدفع للفاتورة ${doc.id}`,
    );
    if (negativeWarnings.length > 0) {
      toast.warning(`كميات سالبة: ${negativeWarnings.join("، ")}`);
    }
  }

  function handleSave(data: InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number }) {
    if (editingId) {
      const old = docs.find(d => d.id === editingId);
      setDocs(prev => prev.map(d => d.id === editingId ? { ...d, customer: data.customer, total: data.total, date: data.issueDate, data } : d));
      logActivity({
        action: "update",
        entity: "invoice",
        entityId: editingId,
        label: `${data.docType === "invoice" ? "فاتورة" : "عرض سعر"} ${editingId} — ${data.customer}`,
        description: old && old.total !== data.total ? `تعديل المبلغ من ${old.total} إلى ${data.total}` : "تعديل بيانات المستند",
        amount: data.total,
      });
      toast.success(`تم تحديث ${editingId}`);
      setEditorOpen(false);
      return;
    }
    const newDoc: DocItem = {
      id: data.number, type: data.docType, customer: data.customer,
      total: data.total, date: data.issueDate,
      status: data.docType === "invoice" ? "غير مدفوعة" : "بانتظار الرد",
      fromQuote: convertSource?.id, data,
    };
    setDocs(prev => {
      const next = [newDoc, ...prev];
      if (convertSource) return next.map(d => d.id === convertSource.id ? { ...d, status: "محول لفاتورة" } : d);
      return next;
    });
    logActivity({
      action: "create",
      entity: "invoice",
      entityId: data.number,
      label: `${data.docType === "invoice" ? "فاتورة" : "عرض سعر"} ${data.number} — ${data.customer}`,
      description: convertSource ? `تحويل من عرض السعر ${convertSource.id}` : `إنشاء ${data.docType === "invoice" ? "فاتورة" : "عرض سعر"} جديد`,
      amount: data.total,
    });
    setEditorOpen(false);
    toast.success(`تم حفظ ${data.docType === "invoice" ? "الفاتورة" : "عرض السعر"} ${data.number}`);
  }

  function handlePreviewFromEditor(data: InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number }) {
    setPreviewHtml(getAdvancedDocHtml({
      docType: data.docType,
      template: data.template,
      number: data.number || nextNumber(data.docType),
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      customerName: data.customer,
      paymentTerms: data.paymentTerms,
      customFields: data.customFields.map(c => ({ label: c.label, value: c.value })),
      items: data.items,
      subtotal: data.subtotal,
      discountTotal: data.discountTotal,
      taxTotal: data.taxTotal,
      total: data.total,
      notes: data.notes,
    }));
    setPreviewTitle(`${data.docType === "invoice" ? "فاتورة" : "عرض سعر"} ${data.number}`);
    setShowPreview(true);
  }

  function previewExisting(doc: DocItem) {
    handlePreviewFromEditor(doc.data);
  }

  // ===== Insurance Estimate =====
  function openInsuranceEstimate(doc: DocItem) {
    // اقتراح بيانات افتراضية من الحقول المخصصة الموجودة في المستند
    const cf = doc.data.customFields || [];
    const findField = (keys: string[]) =>
      cf.find(c => keys.some(k => c.label.toLowerCase().includes(k.toLowerCase())))?.value || "";

    setInsuranceForm({
      insuranceCompany: "",
      claimNumber: findField(["claim", "مطالبة"]),
      policyNumber: "",
      vehiclePlate: findField(["plate", "reg", "لوحة"]),
      vehicleInfo: [findField(["make", "ماركة"]), findField(["model", "موديل"])].filter(Boolean).join(" "),
      incidentDate: new Date().toISOString().split("T")[0],
      incidentDescription: "",
    });
    setInsuranceSource(doc);
  }

  /** فتح المحرر لإنشاء تقدير تكلفة للتأمين من الصفر (بدون فاتورة سابقة). */
  function openNewInsuranceEstimate() {
    setEditorMode("quote");
    setEditorInitial({
      docType: "quote",
      number: nextNumber("quote"),
      notes: "تقدير تكلفة إصلاح للتأمين — يُحوَّل تلقائياً إلى تقرير تأمين رسمي بعد الحفظ.",
    });
    setEditingId(null);
    setConvertSource(null);
    setEditorOpen(true);
  }

  function generateInsuranceEstimate() {
    if (!insuranceSource) return;
    if (!insuranceForm.insuranceCompany.trim()) {
      toast.error("اسم شركة التأمين مطلوب");
      return;
    }
    if (!insuranceForm.claimNumber.trim()) {
      toast.error("رقم المطالبة مطلوب");
      return;
    }
    const data = insuranceSource.data;
    const estimateNumber = "EST-" + insuranceSource.id.replace(/^(INV|QT)-/, "");
    setPreviewHtml(getInsuranceEstimateHtml({
      docType: "quote",
      template: data.template,
      number: estimateNumber,
      issueDate: new Date().toISOString().split("T")[0],
      customerName: data.customer,
      paymentTerms: data.paymentTerms,
      customFields: data.customFields.map(c => ({ label: c.label, value: c.value })),
      items: data.items,
      subtotal: data.subtotal,
      discountTotal: data.discountTotal,
      taxTotal: data.taxTotal,
      total: data.total,
      notes: data.notes,
      insuranceCompany: insuranceForm.insuranceCompany,
      claimNumber: insuranceForm.claimNumber,
      policyNumber: insuranceForm.policyNumber || undefined,
      vehiclePlate: insuranceForm.vehiclePlate || undefined,
      vehicleInfo: insuranceForm.vehicleInfo || undefined,
      incidentDate: insuranceForm.incidentDate || undefined,
      incidentDescription: insuranceForm.incidentDescription || undefined,
    }));
    setPreviewTitle(`تقدير تكلفة للتأمين ${estimateNumber}`);
    setInsuranceSource(null);
    setShowPreview(true);
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المبيعات</h1>
          <p className="text-sm text-muted-foreground">عروض الأسعار والفواتير وتقدير تكلفة التأمين</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => openNew("quote")} variant="outline" className="gap-1.5 border-border">
            <FileText size={14} /> عرض سعر جديد
          </Button>
          <Button onClick={() => openNew("invoice")} className="gap-1.5 gradient-gold text-primary-foreground">
            <Receipt size={14} /> فاتورة جديدة
          </Button>
          <Button onClick={openNewInsuranceEstimate} className="gap-1.5 bg-info text-info-foreground hover:bg-info/90">
            <Shield size={14} /> تقدير تكلفة للتأمين
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="عروض أسعار نشطة" value={quotes.filter(q => q.status === "بانتظار الرد").length} icon={FileText} variant="info" />
        <StatCard title="فواتير الشهر" value={invoices.length} icon={Receipt} variant="gold" />
        <StatCard title="إجمالي المبيعات" value={`${invoices.reduce((a, b) => a + b.total, 0).toLocaleString(undefined, { minimumFractionDigits: 3 })} ر.ع`} icon={DollarSign} variant="success" />
        <StatCard title="غير مدفوعة" value={`${invoices.filter(i => i.status === "غير مدفوعة").reduce((a, b) => a + b.total, 0).toLocaleString(undefined, { minimumFractionDigits: 3 })} ر.ع`} icon={DollarSign} variant="warning" />
      </div>

      <DocSection title="عروض الأسعار / Quotes" emptyText="لا توجد عروض أسعار بعد" items={quotes}
        onNew={() => openNew("quote")} onPreview={previewExisting} onConvert={openConvert}
        onEdit={allowEdit ? openEdit : undefined} onDelete={allowDelete ? setDeleting : undefined}
        onInsurance={openInsuranceEstimate} showConvert />

      <DocSection title="الفواتير / Invoices" emptyText="لا توجد فواتير بعد" items={invoices}
        onNew={() => openNew("invoice")} onPreview={previewExisting}
        onEdit={allowEdit ? openEdit : undefined} onDelete={allowDelete ? setDeleting : undefined}
        onInsurance={openInsuranceEstimate}
        onMarkPaid={markAsPaid} />
      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {convertSource ? `تحويل ${convertSource.id} إلى فاتورة` : editorMode === "invoice" ? "فاتورة جديدة" : "عرض سعر جديد"}
            </DialogTitle>
          </DialogHeader>
          <InvoiceEditor
            initial={editorInitial}
            onSave={handleSave}
            onPreview={handlePreviewFromEditor}
            onCancel={() => setEditorOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <PdfPreviewDialog open={showPreview} onOpenChange={setShowPreview} htmlContent={previewHtml} title={previewTitle} />

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.id || ""}`}
        description={`سيتم نقل ${deleting?.type === "invoice" ? "الفاتورة" : "عرض السعر"} لسلة المهملات.`}
      />

      {/* Insurance Estimate Dialog */}
      <Dialog open={!!insuranceSource} onOpenChange={(o) => !o && setInsuranceSource(null)}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Shield size={18} className="text-info" />
              تقدير تكلفة إصلاح للتأمين {insuranceSource ? `— من ${insuranceSource.id}` : ""}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            بنود الإصلاح والقيم تُؤخذ تلقائياً من المستند المصدر. أدخل بيانات شركة التأمين والحادث لتوليد تقرير رسمي.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">شركة التأمين *</Label>
              <Input
                value={insuranceForm.insuranceCompany}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, insuranceCompany: e.target.value })}
                placeholder="مثال: Oman United Insurance"
                className="bg-secondary border-border"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">رقم المطالبة *</Label>
              <Input
                value={insuranceForm.claimNumber}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, claimNumber: e.target.value })}
                placeholder="CLM-2025-XXXX"
                className="bg-secondary border-border"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">رقم البوليصة</Label>
              <Input
                value={insuranceForm.policyNumber}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, policyNumber: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">رقم اللوحة</Label>
              <Input
                value={insuranceForm.vehiclePlate}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, vehiclePlate: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">السيارة (ماركة وموديل)</Label>
              <Input
                value={insuranceForm.vehicleInfo}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, vehicleInfo: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">ملاحظات الفاحص</Label>
              <Textarea
                rows={3}
                value={insuranceForm.incidentDescription}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, incidentDescription: e.target.value })}
                placeholder="ملاحظات إضافية حول الأضرار والقطع المطلوبة..."
                className="bg-secondary border-border"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={generateInsuranceEstimate} className="gradient-gold text-primary-foreground flex-1 gap-1.5">
              <Eye size={14} /> توليد التقدير ومعاينته
            </Button>
            <Button variant="outline" onClick={() => setInsuranceSource(null)} className="border-border">إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocSection({
  title, items, emptyText, onNew, onPreview, onConvert, onEdit, onDelete, onMarkPaid, onInsurance, showConvert,
}: {
  title: string; items: DocItem[]; emptyText: string;
  onNew: () => void; onPreview: (d: DocItem) => void;
  onConvert?: (d: DocItem) => void;
  onEdit?: (d: DocItem) => void;
  onDelete?: (d: DocItem) => void;
  onMarkPaid?: (d: DocItem) => void;
  onInsurance?: (d: DocItem) => void;
  showConvert?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">الرقم</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">العميل</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">المبلغ</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">التاريخ</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">الحالة</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">المرجع</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium text-xs">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20">
                  <td className="py-2.5 px-3 font-mono text-xs text-primary">{d.id}</td>
                  <td className="py-2.5 px-3 text-foreground">{d.customer}</td>
                  <td className="py-2.5 px-3 text-foreground font-medium">{d.total.toLocaleString(undefined, { minimumFractionDigits: 3 })} ر.ع</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{d.date}</td>
                  <td className="py-2.5 px-3"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColors[d.status] || ''}`}>{d.status}</span></td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{d.fromQuote ? `← ${d.fromQuote}` : '-'}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => onPreview(d)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary" title="معاينة"><Eye size={14} /></button>
                      {onInsurance && (
                        <button onClick={() => onInsurance(d)} className="p-1.5 rounded-md hover:bg-info/10 text-info" title="إنشاء تقدير تكلفة للتأمين"><Shield size={14} /></button>
                      )}
                      {showConvert && onConvert && d.status === "بانتظار الرد" && (
                        <button onClick={() => onConvert(d)} className="p-1.5 rounded-md hover:bg-primary/10 text-primary" title="تحويل لفاتورة"><ArrowLeftRight size={14} /></button>
                      )}
                      {onMarkPaid && d.type === "invoice" && d.status !== "مدفوعة" && (
                        <button onClick={() => onMarkPaid(d)} className="p-1.5 rounded-md hover:bg-success/10 text-success" title="تأكيد الدفع وخصم المخزون"><CheckCircle2 size={14} /></button>
                      )}
                      {onEdit && (
                        <button onClick={() => onEdit(d)} className="p-1.5 rounded-md hover:bg-info/10 text-info" title="تعديل"><Edit size={14} /></button>
                      )}
                      {onDelete && (
                        <button onClick={() => onDelete(d)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive" title="حذف"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
