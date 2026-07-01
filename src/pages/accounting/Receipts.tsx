import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileSpreadsheet, Pencil, Plus, ReceiptText, Save, Trash2, X } from "lucide-react";
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
  const [, force] = useState(0);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  async function fetchCloudReceipts() {
    setLoading(true);
    try {
      const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
      if (tenantError || !tenantId) throw new Error(tenantError?.message || "تعذر تحديد المؤسسة");

      const [salesResult, claimResult, manualResult] = await Promise.all([
        (supabase.from("sales_payments") as any)
          .select("id,payment_number,date,amount,method,reference,notes,sales_document:sales_documents(doc_number,customer_name)")
          .eq("tenant_id", tenantId)
          .order("date", { ascending: false }),
        (supabase.from("claim_payments") as any)
          .select("id,payment_number,payment_date,amount,payment_method,notes,claim:insurance_claims(claim_number,insurance_company)")
          .eq("tenant_id", tenantId)
          .order("payment_date", { ascending: false }),
        (supabase.from("accounting_receipts" as any) as any)
          .select("id,receipt_number,receipt_date,amount,payer_name,category_id,cashbox_id,payment_method,notes,created_at")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("receipt_date", { ascending: false }),
      ]);

      if (salesResult.error) throw salesResult.error;
      if (claimResult.error) throw claimResult.error;
      if (manualResult.error) throw manualResult.error;

      const salesReceipts: Receipt[] = (salesResult.data || []).map((row: any) => ({
        id: `sales:${row.id}`,
        source: "sales",
        number: row.payment_number || `PAY-${String(row.id).slice(0, 8)}`,
        date: row.date,
        amount: Number(row.amount || 0),
        payerName: row.sales_document?.customer_name || "عميل",
        categoryId: "sales_invoice",
        cashboxId: "cloud",
        paymentMethod: (row.method || "cash") as PaymentMethod,
        notes: [row.sales_document?.doc_number, row.reference, row.notes].filter(Boolean).join(" — ") || undefined,
        createdAt: row.date,
      }));

      const claimReceipts: Receipt[] = (claimResult.data || []).map((row: any) => ({
        id: `claim:${row.id}`,
        source: "claim",
        number: row.payment_number || `CP-${String(row.id).slice(0, 8)}`,
        date: row.payment_date,
        amount: Number(row.amount || 0),
        payerName: row.claim?.insurance_company || "شركة تأمين",
        categoryId: "insurance_claim",
        cashboxId: "cloud",
        paymentMethod: (row.payment_method || "bank_transfer") as PaymentMethod,
        notes: [row.claim?.claim_number, row.notes].filter(Boolean).join(" — ") || undefined,
        createdAt: row.payment_date,
      }));

      const manualReceipts: Receipt[] = (manualResult.data || []).map((row: any) => ({
        id: `manual:${row.id}`,
        source: "manual",
        number: row.receipt_number,
        date: row.receipt_date,
        amount: Number(row.amount || 0),
        payerName: row.payer_name || "—",
        categoryId: row.category_id || "",
        cashboxId: row.cashbox_id || "",
        paymentMethod: (row.payment_method || "cash") as PaymentMethod,
        notes: row.notes || undefined,
        createdAt: row.created_at || row.receipt_date,
      }));

      setReceipts([...manualReceipts, ...salesReceipts, ...claimReceipts].sort((a, b) => b.date.localeCompare(a.date)));
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحميل سندات القبض");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchCloudReceipts();
    const channel = supabase
      .channel("receipts_cloud_sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_payments" }, () => void fetchCloudReceipts())
      .on("postgres_changes", { event: "*", schema: "public", table: "claim_payments" }, () => void fetchCloudReceipts())
      .on("postgres_changes", { event: "*", schema: "public", table: "accounting_receipts" }, () => void fetchCloudReceipts())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

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
    const value = parseFloat(amount);
    if (!value || value <= 0) return toast.error("أدخل مبلغًا صحيحًا");
    if (!payerName.trim()) return toast.error("أدخل اسم الدافع");
    if (!categoryId) return toast.error("اختر التصنيف");
    if (!cashboxId) return toast.error("اختر الخزينة");

    const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
    if (tenantError || !tenantId) {
      toast.error(tenantError?.message || "تعذر تحديد المؤسسة");
      return;
    }

    if (editingId) {
      const old = receipts.find((receipt) => receipt.id === editingId);
      if (!old || old.source !== "manual") return;
      const cloudId = old.id.replace("manual:", "");
      const { error } = await (supabase.from("accounting_receipts" as any) as any)
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
        .eq("tenant_id", tenantId);
      if (error) {
        toast.error(error.message);
        return;
      }
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

    const number = voucherSettingsStore.generateNextNumber("receipt");
    const { error } = await (supabase.from("accounting_receipts" as any) as any).insert({
      tenant_id: tenantId,
      receipt_number: number,
      receipt_date: date,
      amount: value,
      payer_name: payerName.trim(),
      category_id: categoryId,
      cashbox_id: cashboxId,
      payment_method: paymentMethod,
      notes: notes.trim() || null,
    });
    if (error) {
      toast.error(error.message);
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
    const { error } = await (supabase.from("accounting_receipts" as any) as any)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", cloudId);
    if (error) {
      toast.error(error.message);
      return;
    }
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

  const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const bulk = useBulkSelection(receipts);

  async function handleBulkDelete() {
    const manualItems = bulk.selectedItems.filter((receipt) => receipt.source === "manual");
    if (!manualItems.length) {
      toast.error("يمكن أرشفة السندات اليدوية فقط من هذه الصفحة");
      return;
    }
    const ids = manualItems.map((receipt) => receipt.id.replace("manual:", ""));
    const { error } = await (supabase.from("accounting_receipts" as any) as any)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast.error(error.message);
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
          <p className="text-xl font-bold text-foreground mt-1">{loading ? "…" : receipts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي المقبوض</p>
          <p className="text-xl font-bold text-success mt-1">{total.toLocaleString()} ر.ع</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">آخر سند</p>
          <p className="text-xl font-bold text-foreground mt-1">{receipts[0]?.number ?? "—"}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
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
                {allowManage && <th className="text-right p-3">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr><td colSpan={allowManage ? 8 : 7} className="text-center p-8 text-muted-foreground">{loading ? "جارِ التحميل…" : "لا توجد سندات قبض بعد"}</td></tr>
              ) : receipts.map((receipt) => (
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
                  {allowManage && (
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(receipt)} className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info" title="تعديل">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteId(receipt.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="أرشفة">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
            <Button onClick={() => void handleSave()} className="gap-2">
              <Save size={16} /> {editingId ? "حفظ التعديلات" : "حفظ السند"}
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
    </div>
  );
}
