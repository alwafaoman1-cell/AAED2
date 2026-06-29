import { useEffect, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus, ReceiptText, Save, X, Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  incomeCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { canManageFinance } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import UnifiedAddPaymentDialog from "@/components/payments/UnifiedAddPaymentDialog";

interface Receipt {
  id: string;
  source?: "sales" | "claim" | "local";
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

const RECEIPTS_KEY = "alwafa_receipts_v1";

function loadReceipts(): Receipt[] {
  try { return JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"); }
  catch { return []; }
}
function saveReceipts(list: Receipt[]) {
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify(list));
}

export default function Receipts() {
  const navigate = useNavigate();
  const [, force] = useState(0);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [open, setOpen] = useState(false);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const u1 = incomeCategoriesStore.subscribe(() => force((n) => n + 1));
    const u2 = employeeCashboxesStore.subscribe(() => force((n) => n + 1));
    return () => { u1(); u2(); };
  }, []);

  async function fetchCloudReceipts() {
    const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
    if (tenantError || !tenantId) {
      toast.error(tenantError?.message || "تعذّر تحديد المؤسسة");
      return;
    }

    const [salesResult, claimResult] = await Promise.all([
      (supabase.from("sales_payments") as any)
        .select("id,payment_number,date,amount,method,reference,notes,sales_document:sales_documents(doc_number,customer_name)")
        .eq("tenant_id", tenantId)
        .order("date", { ascending: false }),
      (supabase.from("claim_payments") as any)
        .select("id,payment_number,payment_date,amount,payment_method,notes,claim:insurance_claims(claim_number,insurance_company)")
        .eq("tenant_id", tenantId)
        .order("payment_date", { ascending: false }),
    ]);
    if (salesResult.error) throw salesResult.error;
    if (claimResult.error) throw claimResult.error;

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
    setReceipts([...salesReceipts, ...claimReceipts].sort((a, b) => b.date.localeCompare(a.date)));
  }

  useEffect(() => {
    void fetchCloudReceipts().catch((error: any) => toast.error(error?.message || "تعذر تحميل سندات القبض"));
    const channel = supabase
      .channel("receipts_cloud_sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_payments" }, () => {
        void fetchCloudReceipts().catch((error: any) => console.warn("[receipts] refresh failed", error));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "claim_payments" }, () => {
        void fetchCloudReceipts().catch((error: any) => console.warn("[receipts] refresh failed", error));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const allowManage = canManageFinance();
  const categories = incomeCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const defaultCashbox = useMemo(() => cashboxes.find((c) => c.isDefault) ?? cashboxes[0], [cashboxes]);
  const settings = voucherSettingsStore.get();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [cashboxId, setCashboxId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(settings.defaultPaymentMethod);
  const [notes, setNotes] = useState("");

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

  const openNew = () => { resetForm(); setOpen(true); };

  const openEdit = (r: Receipt) => {
    setEditingId(r.id);
    setDate(r.date);
    setAmount(String(r.amount));
    setPayerName(r.payerName);
    setCategoryId(r.categoryId);
    setCashboxId(r.cashboxId);
    setPaymentMethod(r.paymentMethod);
    setNotes(r.notes || "");
    setOpen(true);
  };

  const handleSave = () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    if (!payerName.trim()) return toast.error("أدخل اسم الدافع");
    if (!categoryId) return toast.error("اختر التصنيف");
    if (!cashboxId) return toast.error("اختر الخزينة");

    if (editingId) {
      const old = receipts.find((r) => r.id === editingId);
      if (!old) return;
      // إعادة المبلغ القديم وخصم الجديد
      const oldCb = employeeCashboxesStore.getAll().find((c) => c.id === old.cashboxId);
      if (oldCb) employeeCashboxesStore.update(oldCb.id, { currentBalance: oldCb.currentBalance - old.amount });
      const newCb = employeeCashboxesStore.getAll().find((c) => c.id === cashboxId);
      if (newCb) employeeCashboxesStore.update(newCb.id, { currentBalance: newCb.currentBalance + value });

      const updated = receipts.map((r) => r.id === editingId
        ? { ...r, date, amount: value, payerName: payerName.trim(), categoryId, cashboxId, paymentMethod, notes: notes.trim() || undefined }
        : r);
      setReceipts(updated);
      saveReceipts(updated);
      logActivity({
        action: "update", entity: "receipt", entityId: old.number,
        label: `سند قبض من ${payerName}`,
        description: `تعديل المبلغ من ${old.amount.toLocaleString()} إلى ${value.toLocaleString()} ر.ع`,
        amount: value,
      });
      toast.success(`تم تحديث ${old.number}`);
      setOpen(false);
      return;
    }

    const number = voucherSettingsStore.generateNextNumber("receipt");
    const newReceipt: Receipt = {
      id: `R-${Date.now()}`, number, date, amount: value,
      payerName: payerName.trim(), categoryId, cashboxId, paymentMethod,
      notes: notes.trim() || undefined, createdAt: new Date().toISOString(),
    };
    const updated = [newReceipt, ...receipts];
    setReceipts(updated);
    saveReceipts(updated);
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === cashboxId);
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + value });
    logActivity({
      action: "create", entity: "receipt", entityId: number,
      label: `سند قبض من ${payerName}`,
      description: `قبض ${value.toLocaleString()} ر.ع`,
      amount: value,
    });
    toast.success(`تم إنشاء سند القبض ${number}`);
    setOpen(false);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const r = receipts.find((x) => x.id === deleteId);
    if (r) {
      if (r.source === "sales" || r.source === "claim") {
        const table = r.source === "sales" ? "sales_payments" : "claim_payments";
        const cloudId = r.id.replace(`${r.source}:`, "");
        const { error } = await (supabase.from(table as any) as any).delete().eq("id", cloudId);
        if (error) {
          toast.error(error.message);
          return;
        }
        await fetchCloudReceipts();
        toast.success(`تم حذف ${r.number}`);
        setDeleteId(null);
        return;
      }
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === r.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - r.amount });
      const updated = receipts.filter((x) => x.id !== deleteId);
      setReceipts(updated);
      saveReceipts(updated);
      logActivity({
        action: "delete", entity: "receipt", entityId: r.number,
        label: `سند قبض من ${r.payerName}`,
        description: `حذف سند بقيمة ${r.amount.toLocaleString()} ر.ع`,
        amount: r.amount,
      });
      toast.success(`تم حذف ${r.number}`);
    }
    setDeleteId(null);
  };

  const total = receipts.reduce((s, r) => s + r.amount, 0);

  const bulk = useBulkSelection(receipts);
  async function handleBulkDelete() {
    const items = bulk.selectedItems;
    let updated = [...receipts];
    for (const r of items) {
      if (r.source === "sales" || r.source === "claim") {
        const table = r.source === "sales" ? "sales_payments" : "claim_payments";
        const cloudId = r.id.replace(`${r.source}:`, "");
        const { error } = await (supabase.from(table as any) as any).delete().eq("id", cloudId);
        if (error) {
          toast.error(error.message);
          continue;
        }
        updated = updated.filter((x) => x.id !== r.id);
        continue;
      }
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === r.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - r.amount });
      logActivity({ action: "delete", entity: "receipt", entityId: r.number, label: `سند قبض من ${r.payerName}`, description: `حذف جماعي`, amount: r.amount });
      updated = updated.filter((x) => x.id !== r.id);
    }
    setReceipts(updated); saveReceipts(updated);
    await fetchCloudReceipts();
    toast.success(`تم حذف ${items.length} سند`);
    bulk.clear();
  }
  function handleBulkExport() {
    exportRowsAsCsv(
      `receipts-${new Date().toISOString().slice(0, 10)}`,
      ["الرقم", "التاريخ", "من السيد", "التصنيف", "الخزينة", "طريقة الدفع", "المبلغ", "ملاحظات"],
      bulk.selectedItems.map((r) => {
        const cat = categories.find((c) => c.id === r.categoryId);
        const cb = cashboxes.find((c) => c.id === r.cashboxId);
        return [r.number, r.date, r.payerName, cat?.name || "", cb?.cashboxName || "", PAYMENT_METHOD_LABELS[r.paymentMethod], r.amount, r.notes || ""];
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
          <p className="text-sm text-muted-foreground">إدارة وإصدار سندات القبض النقدية</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>
            <ArrowRight size={16} className="ml-1" /> رجوع
          </Button>
          <Button onClick={() => setUnifiedOpen(true)} className="gap-2">
            <Plus size={16} /> إضافة دفعة موحدة
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي السندات</p>
          <p className="text-xl font-bold text-foreground mt-1">{receipts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي المبالغ المقبوضة</p>
          <p className="text-xl font-bold text-success mt-1">{total.toLocaleString()} ر.ع</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">آخر رقم</p>
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
                <th className="text-right p-3">التصنيف</th>
                <th className="text-right p-3">الخزينة</th>
                <th className="text-right p-3">طريقة الدفع</th>
                <th className="text-right p-3">المبلغ</th>
                {allowManage && <th className="text-right p-3">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr><td colSpan={allowManage ? 9 : 8} className="text-center p-8 text-muted-foreground">لا توجد سندات قبض بعد</td></tr>
              ) : receipts.map((r) => {
                const cat = categories.find((c) => c.id === r.categoryId);
                const cb = cashboxes.find((c) => c.id === r.cashboxId);
                const sourceLabel = r.source === "claim" ? "مطالبة تأمين" : r.source === "sales" ? "فاتورة مبيعات" : "";
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-secondary/10">
                    <td className="p-3"><Checkbox checked={bulk.isSelected(r.id)} onCheckedChange={() => bulk.toggle(r.id)} /></td>
                    <td className="p-3 font-mono text-xs">{r.number}</td>
                    <td className="p-3">{r.date}</td>
                    <td className="p-3">{r.payerName}</td>
                    <td className="p-3">
                      {cat ? <Badge variant="outline" style={{ borderColor: cat.color, color: cat.color }}>{cat.name}</Badge> : <Badge variant="secondary">{sourceLabel || "—"}</Badge>}
                    </td>
                    <td className="p-3">{cb?.cashboxName ?? (r.source ? "سحابي" : "—")}</td>
                    <td className="p-3">{PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod}</td>
                    <td className="p-3 font-bold text-success">{r.amount.toLocaleString()} ر.ع</td>
                    {allowManage && (
                      <td className="p-3">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(r)}
                            className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info" title="تعديل">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteId(r.id)}
                            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="حذف">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="سند">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <FileSpreadsheet size={14} /> تصدير CSV
        </Button>
        {allowManage && (
          <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={handleBulkDelete}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>

      <UnifiedAddPaymentDialog
        open={unifiedOpen}
        onOpenChange={setUnifiedOpen}
        onSaved={() => force((n) => n + 1)}
      />


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? "تعديل سند قبض" : "سند قبض جديد"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>المبلغ (ر.ع)</Label>
              <Input type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>استلمنا من السيد / الجهة</Label>
              <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="اسم العميل أو الجهة" />
            </div>
            <div className="space-y-2">
              <Label>تصنيف الإيراد</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الخزينة</Label>
              <Select value={cashboxId} onValueChange={setCashboxId}>
                <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
                <SelectContent>
                  {cashboxes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.cashboxName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>طريقة الدفع</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>وذلك مقابل / ملاحظات</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              <X size={16} className="ml-1" /> إلغاء
            </Button>
            <Button onClick={handleSave} className="gap-2">
              <Save size={16} /> {editingId ? "حفظ التعديلات" : "حفظ السند"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        title="حذف سند القبض"
        description="سيتم حذف السند نهائياً وخصم المبلغ من الخزينة. لا يمكن التراجع."
      />
    </div>
  );
}
