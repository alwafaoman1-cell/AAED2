import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileSpreadsheet, FileText, Pencil, Plus, Printer, ReceiptText, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  employeeCashboxesStore,
  incomeCategoriesStore,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  voucherSettingsStore,
} from "@/lib/financeSettingsStore";
import { canManageFinance } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import { smartBack } from "@/lib/smartBack";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { exportRowsAsCsv, useBulkSelection } from "@/hooks/useBulkSelection";
import UnifiedAddPaymentDialog from "@/components/payments/UnifiedAddPaymentDialog";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";

interface Receipt {
  id: string;
  source: "sales" | "claim" | "manual";
  number: string;
  date: string;
  amount: number;
  payerName: string;
  categoryId: string;
  cashboxId: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdAt: string;
}

export default function Receipts() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfHtml, setPdfHtml] = useState("");
  const [pdfTitle, setPdfTitle] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSource, setFilterSource] = useState<"all" | Receipt["source"]>("all");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exportingAll, setExportingAll] = useState(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const pageSize = 50;

  const allowManage = canManageFinance();
  const categories = incomeCategoriesStore.getAll().filter((category) => category.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((cashbox) => cashbox.active);
  const defaultCashbox = useMemo(() => cashboxes.find((cashbox) => cashbox.isDefault) ?? cashboxes[0], [cashboxes]);
  const settings = voucherSettingsStore.get();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [cashboxId, setCashboxId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(settings.defaultPaymentMethod);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const unsubscribeCategories = incomeCategoriesStore.subscribe(() => force((value) => value + 1));
    const unsubscribeCashboxes = employeeCashboxesStore.subscribe(() => force((value) => value + 1));
    return () => {
      unsubscribeCategories();
      unsubscribeCashboxes();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => { setPage(1); }, [filterSource, filterPaymentMethod, filterDateFrom, filterDateTo, debouncedSearch]);

  const receiptQuery = useQuery({
    queryKey: queryKeys.receipts.list(profile?.tenant_id, { page, filterSource, filterPaymentMethod, filterDateFrom, filterDateTo, debouncedSearch }),
    enabled: Boolean(profile?.tenant_id),
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("list_accounting_receipts_page_rpc", {
        p_tenant_id: profile!.tenant_id,
        p_page: page,
        p_page_size: pageSize,
        p_source: filterSource,
        p_method: filterPaymentMethod,
        p_date_from: filterDateFrom || null,
        p_date_to: filterDateTo || null,
        p_search: debouncedSearch || null,
      });
      if (error) throw error;
      const payload = data || {};
      return {
        totalCount: Number(payload.totalCount || 0),
        totalAmount: Number(payload.totalAmount || 0),
        latestNumber: String(payload.latestNumber || "—"),
        receipts: (Array.isArray(payload.items) ? payload.items : []).map((row: any): Receipt => ({
          id: String(row.id),
          source: row.source,
          number: row.number || "—",
          date: row.receipt_date,
          amount: Number(row.amount || 0),
          payerName: row.payer_name || "—",
          categoryId: row.category_id || "",
          cashboxId: row.cashbox_id || "",
          paymentMethod: (row.payment_method || "cash") as PaymentMethod,
          notes: row.notes || undefined,
          createdAt: row.created_at || row.receipt_date,
        })),
      };
    },
  });
  const receipts: Receipt[] = receiptQuery.data?.receipts || [];
  const filteredReceipts = receipts;
  const loading = receiptQuery.isPending;
  const totalCount = receiptQuery.data?.totalCount || 0;
  const total = receiptQuery.data?.totalAmount || 0;
  const latestNumber = receiptQuery.data?.latestNumber || "—";
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  useEffect(() => {
    if (!receiptQuery.isPending && page > pageCount) setPage(pageCount);
  }, [page, pageCount, receiptQuery.isPending]);

  async function fetchCloudReceipts() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.receipts.all });
  }

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setAmount("");
    setPayerName("");
    setCategoryId(categories[0]?.id ?? "");
    setCashboxId(defaultCashbox?.id ?? "");
    setPaymentMethod(settings.defaultPaymentMethod);
    setNotes("");
  };

  const openNew = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (receipt: Receipt) => {
    if (receipt.source !== "manual") {
      toast.error("عدّل الدفعة الأصلية من صفحة الفاتورة أو المطالبة");
      return;
    }
    setEditingId(receipt.id);
    setDate(receipt.date);
    setAmount(String(receipt.amount));
    setPayerName(receipt.payerName);
    setCategoryId(receipt.categoryId);
    setCashboxId(receipt.cashboxId);
    setPaymentMethod(receipt.paymentMethod);
    setNotes(receipt.notes || "");
    setOpen(true);
  };

  async function handleSave() {
    if (savingRef.current) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) return toast.error("أدخل مبلغًا صحيحًا");
    if (!payerName.trim()) return toast.error("أدخل اسم الدافع");
    if (!categoryId) return toast.error("اختر التصنيف");
    if (!cashboxId) return toast.error("اختر الخزينة");

    const tenantId = profile?.tenant_id;
    if (!tenantId) return toast.error("تعذر تحديد المؤسسة");
    savingRef.current = true;
    setSaving(true);
    try {
      if (editingId) {
        const old = receipts.find((receipt) => receipt.id === editingId);
        if (!old || old.source !== "manual") return;
        const cloudId = old.id.replace("manual:", "");
        const { data: updated, error } = await (supabase.from("accounting_receipts" as any) as any)
          .update({
            receipt_date: date,
            amount: value,
            payer_name: payerName.trim(),
            category_id: categoryId,
            cashbox_id: cashboxId,
            payment_method: paymentMethod,
            notes: notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cloudId)
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle();
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!updated?.id) return toast.error("لم يتم تحديث السند في قاعدة البيانات؛ تحقق من الصلاحيات ثم أعد المحاولة");
        logActivity({
          action: "update",
          entity: "receipt",
          entityId: old.number,
          label: `سند قبض من ${payerName}`,
          description: `تعديل المبلغ من ${old.amount.toLocaleString()} إلى ${value.toLocaleString()} ر.ع`,
          amount: value,
        });
        toast.success(`تم تحديث ${old.number}`);
        setOpen(false);
        await fetchCloudReceipts();
        return;
      }

      const { data: number, error: numberError } = await (supabase.rpc as any)("reserve_receipt_number_rpc", {
        p_tenant_id: tenantId,
      });
      if (numberError || typeof number !== "string" || !number) {
        throw numberError || new Error("تعذر تخصيص رقم سند قبض من قاعدة البيانات");
      }
      const { data: inserted, error } = await (supabase.from("accounting_receipts" as any) as any).insert({
        tenant_id: tenantId,
        receipt_number: number,
        receipt_date: date,
        amount: value,
        payer_name: payerName.trim(),
        category_id: categoryId,
        cashbox_id: cashboxId,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
      }).select("id,receipt_number").single();
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!inserted?.id || inserted.receipt_number !== number) {
        toast.error("تعذر تأكيد إنشاء السند؛ افحص القائمة قبل إعادة المحاولة");
        return;
      }

      logActivity({
        action: "create",
        entity: "receipt",
        entityId: number,
        label: `سند قبض من ${payerName}`,
        description: `قبض ${value.toLocaleString()} ر.ع`,
        amount: value,
      });
      toast.success(`تم إنشاء سند القبض ${number}`);
      setOpen(false);
      await fetchCloudReceipts();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ السند؛ تحقق من الاتصال قبل إعادة المحاولة");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    const receipt = receipts.find((item) => item.id === deleteId);
    if (!receipt) return;
    if (receipt.source !== "manual") {
      toast.error("احذف الدفعة الأصلية من صفحة الفاتورة أو المطالبة");
      setDeleteId(null);
      return;
    }
    const cloudId = receipt.id.replace("manual:", "");
    const { data: archived, error } = await (supabase.from("accounting_receipts" as any) as any)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", cloudId)
      .eq("tenant_id", profile?.tenant_id || "")
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!archived?.id) return toast.error("لم يتم أرشفة السند في قاعدة البيانات؛ تحقق من الصلاحيات ثم أعد المحاولة");
    logActivity({
      action: "delete",
      entity: "receipt",
      entityId: receipt.number,
      label: `سند قبض من ${receipt.payerName}`,
      description: `أرشفة سند بقيمة ${receipt.amount.toLocaleString()} ر.ع`,
      amount: receipt.amount,
    });
    toast.success(`تم أرشفة ${receipt.number}`);
    setDeleteId(null);
    await fetchCloudReceipts();
  }

  const bulk = useBulkSelection<Receipt>(filteredReceipts);
  const clearBulkSelection = bulk.clear;
  useEffect(() => { clearBulkSelection(); }, [page, filterSource, filterPaymentMethod, filterDateFrom, filterDateTo, debouncedSearch, clearBulkSelection]);

  const escapeHtml = (value: unknown) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const getReceiptSourceLabel = (source: Receipt["source"]) =>
    source === "sales" ? "فاتورة مبيعات" : source === "claim" ? "مطالبة تأمين" : "يدوي";

  const buildReceiptHtml = (receipt: Receipt) => {
    const category = categories.find((item) => item.id === receipt.categoryId);
    const cashbox = cashboxes.find((item) => item.id === receipt.cashboxId);
    const amount = Number(receipt.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
      <title>سند قبض ${escapeHtml(receipt.number)}</title>
      <style>
        @page{size:A4;margin:0}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        body{margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
        .page{width:210mm;min-height:297mm;margin:0 auto;background:white;padding:14mm;position:relative}
        .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #16a34a;padding-bottom:8mm}
        .badge{background:linear-gradient(135deg,#16a34a,#166534);color:white;border-radius:8px;padding:8mm 10mm;text-align:center;min-width:58mm}
        .badge .small{font-size:12px;opacity:.9}.badge .num{font-size:22px;font-weight:800;font-family:Arial,sans-serif;direction:ltr}
        .company{text-align:left;font-size:11px;line-height:1.7}.company b{font-size:16px;color:#0f172a}
        h1{font-size:18px;margin:10mm 0 5mm;color:#166534}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin:5mm 0}
        .row{border:1px solid #dbe3ef;border-radius:7px;padding:4mm;background:#f8fafc}
        .row label{display:block;font-size:10px;color:#64748b;margin-bottom:1mm}.row strong{font-size:13px}
        .amount{margin:9mm 0;background:linear-gradient(135deg,#16a34a,#166534);color:white;border-radius:10px;padding:8mm;text-align:center}
        .amount .label{font-size:12px;opacity:.9}.amount .value{font-size:32px;font-weight:900;font-family:Arial,sans-serif;direction:ltr}
        .notes{border-right:4px solid #16a34a;background:#f0fdf4;padding:5mm;border-radius:8px;min-height:22mm}
        .signatures{display:flex;justify-content:space-between;margin-top:24mm;gap:12mm}
        .sign{flex:1;text-align:center;border-top:1px solid #94a3b8;padding-top:3mm;color:#64748b;font-size:11px}
        .footer{position:absolute;left:14mm;right:14mm;bottom:10mm;border-top:1px solid #e2e8f0;padding-top:3mm;text-align:center;color:#94a3b8;font-size:10px}
        @media print{body{background:white}.page{margin:0;box-shadow:none}}
      </style></head><body><div class="page">
        <div class="header">
          <div class="badge"><div class="small">سند قبض<br/>RECEIPT VOUCHER</div><div class="num">${escapeHtml(receipt.number)}</div><div class="small">${escapeHtml(receipt.date)}</div></div>
          <div class="company"><b>شركة الوفاء للأعمال المتكاملة</b><br/>Al Wafa Integrated Business Company LLC<br/>Muscat, Sultanate of Oman</div>
        </div>
        <h1>بيانات سند القبض</h1>
        <div class="grid">
          <div class="row"><label>استلمنا من السيد / الجهة</label><strong>${escapeHtml(receipt.payerName || "—")}</strong></div>
          <div class="row"><label>المصدر</label><strong>${escapeHtml(getReceiptSourceLabel(receipt.source))}</strong></div>
          <div class="row"><label>التصنيف</label><strong>${escapeHtml(category?.name || receipt.categoryId || receipt.source)}</strong></div>
          <div class="row"><label>الخزينة</label><strong>${escapeHtml(cashbox?.cashboxName || (receipt.source === "manual" ? receipt.cashboxId : "سحابي"))}</strong></div>
          <div class="row"><label>طريقة الدفع</label><strong>${escapeHtml(PAYMENT_METHOD_LABELS[receipt.paymentMethod] || receipt.paymentMethod)}</strong></div>
          <div class="row"><label>تاريخ الإنشاء</label><strong>${escapeHtml(receipt.createdAt || receipt.date)}</strong></div>
        </div>
        <div class="amount"><div class="label">المبلغ المستلم / Amount Received</div><div class="value">${amount} OMR</div></div>
        <div class="notes"><strong>ملاحظات:</strong><br/>${escapeHtml(receipt.notes || "—")}</div>
        <div class="signatures">
          <div class="sign">توقيع المستلم<br/>Recipient Signature</div>
          <div class="sign">المحاسب<br/>Accountant</div>
          <div class="sign">المدير المعتمد<br/>Authorized Manager</div>
        </div>
        <div class="footer">Generated by TEMO Auto ERP • ${new Date().toISOString().slice(0, 10)}</div>
      </div></body></html>`;
  };

  const openReceiptPdf = (receipt: Receipt) => {
    setPdfHtml(buildReceiptHtml(receipt));
    setPdfTitle(`سند قبض ${receipt.number}`);
    setPdfOpen(true);
  };

  async function handleBulkDelete() {
    const manualItems = bulk.selectedItems.filter((receipt) => receipt.source === "manual");
    if (!manualItems.length) {
      toast.error("يمكن أرشفة السندات اليدوية فقط من هذه الصفحة");
      return;
    }
    const ids = manualItems.map((receipt) => receipt.id.replace("manual:", ""));
    const { data: archived, error } = await (supabase.from("accounting_receipts" as any) as any)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("tenant_id", profile?.tenant_id || "")
      .is("deleted_at", null)
      .in("id", ids)
      .select("id");
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((archived || []).length !== ids.length) {
      toast.error(`تم أرشفة ${(archived || []).length} من ${ids.length} سند فقط؛ حدّث القائمة وافحص البقية`);
      bulk.clear();
      await fetchCloudReceipts();
      return;
    }
    toast.success(`تم أرشفة ${manualItems.length} سند`);
    bulk.clear();
    await fetchCloudReceipts();
  }

  function handleBulkExport() {
    exportRowsAsCsv(
      `receipts-${new Date().toISOString().slice(0, 10)}`,
      ["الرقم", "التاريخ", "من السيد", "التصنيف", "الخزينة", "طريقة الدفع", "المبلغ", "ملاحظات"],
      bulk.selectedItems.map((receipt) => {
        const category = categories.find((item) => item.id === receipt.categoryId);
        const cashbox = cashboxes.find((item) => item.id === receipt.cashboxId);
        return [
          receipt.number,
          receipt.date,
          receipt.payerName,
          category?.name || receipt.source,
          cashbox?.cashboxName || (receipt.source === "manual" ? "" : "سحابي"),
          PAYMENT_METHOD_LABELS[receipt.paymentMethod] || receipt.paymentMethod,
          receipt.amount,
          receipt.notes || "",
        ];
      }),
    );
  }

  async function handleExportAll() {
    if (!profile?.tenant_id || exportingAll) return;
    setExportingAll(true);
    try {
      const rows: (string | number)[][] = [];
      const seenIds = new Set<string>();
      let expectedTotal: number | null = null;
      const exportPageSize = 100;
      for (let exportPage = 1; ; exportPage++) {
        const { data, error } = await (supabase.rpc as any)("list_accounting_receipts_page_rpc", {
          p_tenant_id: profile.tenant_id,
          p_page: exportPage,
          p_page_size: exportPageSize,
          p_source: filterSource,
          p_method: filterPaymentMethod,
          p_date_from: filterDateFrom || null,
          p_date_to: filterDateTo || null,
          p_search: debouncedSearch || null,
        });
        if (error) throw error;
        const currentTotal = Number(data?.totalCount || 0);
        if (expectedTotal === null) expectedTotal = currentTotal;
        if (expectedTotal !== currentTotal) throw new Error("تغيّرت السندات أثناء التصدير؛ أعد المحاولة");
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        for (const item of items) {
          if (seenIds.has(String(item.id))) throw new Error("تغيّر ترتيب السندات أثناء التصدير؛ أعد المحاولة");
          seenIds.add(String(item.id));
          const category = categories.find((entry) => entry.id === item.category_id);
          const cashbox = cashboxes.find((entry) => entry.id === item.cashbox_id);
          rows.push([
            item.number || "", item.receipt_date || "", item.payer_name || "",
            category?.name || item.source || "",
            cashbox?.cashboxName || (item.source === "manual" ? "" : "سحابي"),
            PAYMENT_METHOD_LABELS[item.payment_method as PaymentMethod] || item.payment_method || "",
            Number(item.amount || 0), item.notes || "",
          ]);
        }
        if (items.length < exportPageSize || rows.length >= currentTotal) break;
      }
      if (rows.length !== expectedTotal) throw new Error("التصدير غير مكتمل؛ أعد المحاولة");
      exportRowsAsCsv(`receipts-${new Date().toISOString().slice(0, 10)}`,
        ["الرقم", "التاريخ", "من السيد", "التصنيف", "الخزينة", "طريقة الدفع", "المبلغ", "ملاحظات"], rows);
      toast.success(`تم تصدير ${rows.length} سند`);
    } catch (error: any) {
      toast.error(error?.message || "تعذر تصدير السندات");
    } finally {
      setExportingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ReceiptText className="text-success" size={24} /> سندات القبض
          </h1>
          <p className="text-sm text-muted-foreground">إدارة وعرض سندات القبض السحابية المرتبطة بالدفعات والفواتير والمطالبات.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={exportingAll || !totalCount} onClick={() => void handleExportAll()} className="gap-2">
            <FileSpreadsheet size={16} /> {exportingAll ? "جارِ التصدير…" : "تصدير كل النتائج"}
          </Button>
          <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>
            <ArrowRight size={16} className="ml-1" /> رجوع
          </Button>
          <Button variant="outline" onClick={openNew} className="gap-2">
            <Plus size={16} /> سند يدوي
          </Button>
          <Button onClick={() => setUnifiedOpen(true)} className="gap-2">
            <Plus size={16} /> إضافة دفعة موحدة
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي السندات</p>
          <p className="text-xl font-bold text-foreground mt-1">{loading ? "…" : totalCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي المقبوض</p>
          <p className="text-xl font-bold text-success mt-1">{total.toLocaleString()} ر.ع</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">آخر سند</p>
          <p className="text-xl font-bold text-foreground mt-1">{latestNumber}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 p-4 border-b border-border bg-secondary/10">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="بحث برقم السند / الدافع / الملاحظات"
              className="pr-9 h-9"
            />
          </div>
          <Select value={filterSource} onValueChange={(value) => setFilterSource(value as typeof filterSource)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المصادر</SelectItem>
              <SelectItem value="manual">يدوي</SelectItem>
              <SelectItem value="sales">فواتير المبيعات</SelectItem>
              <SelectItem value="claim">مطالبات التأمين</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPaymentMethod} onValueChange={setFilterPaymentMethod}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل طرق الدفع</SelectItem>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={filterDateFrom} onChange={(event) => setFilterDateFrom(event.target.value)} className="h-9" title="من تاريخ" />
          <Input type="date" value={filterDateTo} onChange={(event) => setFilterDateTo(event.target.value)} className="h-9" title="إلى تاريخ" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="p-3 w-10"><Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} /></th>
                <th className="text-right p-3">الرقم</th>
                <th className="text-right p-3">التاريخ</th>
                <th className="text-right p-3">من السيد</th>
                <th className="text-right p-3">المصدر</th>
                <th className="text-right p-3">طريقة الدفع</th>
                <th className="text-right p-3">المبلغ</th>
                <th className="text-right p-3">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.length === 0 ? (
                <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">{loading ? "جارِ التحميل…" : receiptQuery.isError ? <button className="underline" onClick={() => void receiptQuery.refetch()}>تعذر تحميل السندات — اضغط لإعادة المحاولة</button> : "لا توجد سندات قبض مطابقة"}</td></tr>
              ) : filteredReceipts.map((receipt) => (
                <tr key={receipt.id} className="border-t border-border hover:bg-secondary/10">
                  <td className="p-3"><Checkbox checked={bulk.isSelected(receipt.id)} onCheckedChange={() => bulk.toggle(receipt.id)} /></td>
                  <td className="p-3 font-mono text-xs">{receipt.number}</td>
                  <td className="p-3">{receipt.date}</td>
                  <td className="p-3">{receipt.payerName}</td>
                  <td className="p-3">
                    <Badge variant="outline">
                      {receipt.source === "sales" ? "فاتورة" : receipt.source === "claim" ? "مطالبة" : "يدوي"}
                    </Badge>
                  </td>
                  <td className="p-3">{PAYMENT_METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}</td>
                  <td className="p-3 font-bold text-success">{receipt.amount.toLocaleString()} ر.ع</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => openReceiptPdf(receipt)} className="p-1.5 rounded hover:bg-success/10 text-muted-foreground hover:text-success" title="طباعة / PDF">
                        <Printer size={14} />
                      </button>
                      <button onClick={() => openReceiptPdf(receipt)} className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info" title="معاينة / تنزيل PDF">
                        <FileText size={14} />
                      </button>
                      {allowManage && (
                        <>
                        <button onClick={() => openEdit(receipt)} className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info" title="تعديل">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteId(receipt.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="أرشفة">
                          <Trash2 size={14} />
                        </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border p-3 text-sm">
          <span>{totalCount === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)}`} / {totalCount}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || receiptQuery.isFetching} onClick={() => setPage((value) => value - 1)}>السابق</Button>
            <span>{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount || receiptQuery.isFetching} onClick={() => setPage((value) => value + 1)}>التالي</Button>
          </div>
        </div>
      </div>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="سند">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <FileSpreadsheet size={14} /> تصدير CSV
        </Button>
        {allowManage && (
          <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={() => void handleBulkDelete()}>
            <Trash2 size={14} /> أرشفة
          </Button>
        )}
      </BulkActionBar>

      <UnifiedAddPaymentDialog
        open={unifiedOpen}
        onOpenChange={setUnifiedOpen}
        onSaved={() => {
          force((value) => value + 1);
          void fetchCloudReceipts();
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? "تعديل سند قبض" : "سند قبض يدوي جديد"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>المبلغ (ر.ع)</Label>
              <Input type="number" min="0" step="0.001" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>استلمنا من السيد / الجهة</Label>
              <Input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="اسم العميل أو الجهة" />
            </div>
            <div className="space-y-2">
              <Label>تصنيف الإيراد</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                <SelectContent>
                  {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الخزينة</Label>
              <Select value={cashboxId} onValueChange={setCashboxId}>
                <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
                <SelectContent>
                  {cashboxes.map((cashbox) => <SelectItem key={cashbox.id} value={cashbox.id}>{cashbox.cashboxName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>طريقة الدفع</Label>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              <X size={16} className="ml-1" /> إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()} className="gap-2">
              <Save size={16} /> {saving ? "جارِ الحفظ…" : editingId ? "حفظ التعديلات" : "حفظ السند"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(value) => !value && setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        title="أرشفة سند القبض"
        description="سيتم أرشفة السند اليدوي وإخفاؤه من القائمة العادية. دفعات الفواتير والمطالبات تُدار من مصدرها الأصلي."
      />

      <PdfPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        htmlContent={pdfHtml}
        title={pdfTitle}
        fileName={pdfTitle}
      />
    </div>
  );
}
