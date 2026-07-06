import { useEffect, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openSanitizedPdfWindow, openAndPrintWindow } from "@/lib/safePdfWindow";
import {
  ArrowRight, MinusCircle, Save, Search, FileText, Printer, Mail, Pencil, Trash2,
  Calendar as CalendarIcon, Download, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  expenseCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { getPaymentVoucherHtml } from "@/lib/pdfGenerator";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { logActivity } from "@/lib/auditLogStore";
import BulkExpenseDialog from "@/components/accounting/BulkExpenseDialog";
import AiExtractButton from "@/components/ai/AiExtractButton";
import AiWriteButton from "@/components/ai/AiWriteButton";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { calculateVatExclusive, roundMoney } from "@/lib/money";

type ReportPeriod = "all" | "day" | "month" | "year";

export default function ExpenseNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [, force] = useState(0);
  useEffect(() => {
    const subs = [
      expenseCategoriesStore.subscribe(() => force((n) => n + 1)),
      employeeCashboxesStore.subscribe(() => force((n) => n + 1)),
      voucherSettingsStore.subscribe(() => force((n) => n + 1)),
      expensesStore.subscribe(() => force((n) => n + 1)),
    ];
    expensesStore.refresh();
    return () => subs.forEach((u) => u());
  }, []);

  const settings = voucherSettingsStore.get();
  const categories = expenseCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const defaultCashbox = useMemo(() => cashboxes.find((c) => c.isDefault) ?? cashboxes[0], [cashboxes]);
  const linkContext = useMemo(() => ({
    claimId: searchParams.get("claim_id") || undefined,
    linkedWorkOrderId: searchParams.get("work_order_id") || searchParams.get("workOrder") || undefined,
    customerId: searchParams.get("customer_id") || undefined,
    vehicleId: searchParams.get("vehicle_id") || undefined,
    invoiceId: searchParams.get("invoice_id") || undefined,
  }), [searchParams]);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [cashboxId, setCashboxId] = useState<string>(defaultCashbox?.id ?? "");
  const [amount, setAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(settings.defaultPaymentMethod);
  const [beneficiary, setBeneficiary] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [linkedVehiclePlate, setLinkedVehiclePlate] = useState<string>("");
  // حقول ضريبية للمورد (لتقرير الضريبة الرسمي)
  const [supplierCompany, setSupplierCompany] = useState<string>("");
  const [supplierTaxNumber, setSupplierTaxNumber] = useState<string>("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>("");

  // List filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("all");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Dialogs
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfHtml, setPdfHtml] = useState("");
  const [pdfTitle, setPdfTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteMultipleOpen, setDeleteMultipleOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setCategoryId(categories[0]?.id ?? "");
    setCashboxId(defaultCashbox?.id ?? "");
    setAmount("");
    setPaymentMethod(settings.defaultPaymentMethod);
    setBeneficiary("");
    setDescription("");
    setPhoto(null);
    setLinkedVehiclePlate("");
    setSupplierCompany("");
    setSupplierTaxNumber("");
    setSupplierInvoiceNumber("");
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    setPhoto(await fileToWebpDataUrl(file));
  };

  const handleSave = async () => {
    const value = parseMoneyInput(amount);
    if (!value || value <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    if (!categoryId) return toast.error("اختر تصنيف المصروف");
    if (!cashboxId) return toast.error("اختر الخزينة");
    if (settings.paymentVoucherRequirePhoto && !photo && !editingId) return toast.error("صورة الإيصال مطلوبة");

    const cat = categories.find((c) => c.id === categoryId);
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === cashboxId);
    const isPartsCat = !!cat && /قطع غيار/.test(cat.name);
    const linkedVehicle = linkedVehiclePlate
      ? vehiclesStore.getAll().find((v) => v.plate === linkedVehiclePlate)
      : undefined;
    const vehicleFields: Partial<ExpenseRecord> = isPartsCat && linkedVehiclePlate
      ? {
          linkedVehiclePlate,
          linkedVehicleName: linkedVehicle ? `${linkedVehicle.type} — ${linkedVehicle.plate}` : linkedVehiclePlate,
        }
      : { linkedVehiclePlate: undefined, linkedVehicleName: undefined };

    if (editingId) {
      const old = expensesStore.getById(editingId);
      if (old) {
        // Refund old amount to original cashbox, deduct new amount from current cashbox
        const oldCb = employeeCashboxesStore.getAll().find((c) => c.id === old.cashboxId);
        try {
          await expensesStore.update(editingId, {
          date, amount: value, categoryId, categoryName: cat?.name, cashboxId,
          cashboxName: cb?.cashboxName, paymentMethod, beneficiary, description, photo,
          supplierTaxNumber: supplierTaxNumber || undefined,
          supplierInvoiceNumber: supplierInvoiceNumber || undefined,
          ...(supplierCompany ? { beneficiary: beneficiary || supplierCompany } : {}),
          ...linkContext,
          ...vehicleFields,
          });
        } catch (error: any) {
          toast.error(error?.message || "تعذر تحديث المصروف في Supabase");
          return;
        }
        if (oldCb) employeeCashboxesStore.update(oldCb.id, { currentBalance: oldCb.currentBalance + old.amount });
        if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
        logActivity({
          action: "update", entity: "expense", entityId: old.voucherNumber,
          label: `${cat?.name || "مصروف"}`,
          description: `تعديل المبلغ من ${old.amount.toLocaleString()} إلى ${value.toLocaleString()} ر.ع`,
          amount: value,
        });
        toast.success(`تم تحديث سند الصرف ${old.voucherNumber}`);
      }
      resetForm();
      return;
    }

    const number = voucherSettingsStore.generateNextNumber("payment");

    const record: ExpenseRecord = {
      id: `EXP-${Date.now()}`,
      voucherNumber: number,
      date, amount: value,
      categoryId, categoryName: cat?.name,
      cashboxId, cashboxName: cb?.cashboxName,
      paymentMethod,
      beneficiary: beneficiary || supplierCompany,
      description, photo,
      supplierTaxNumber: supplierTaxNumber || undefined,
      supplierInvoiceNumber: supplierInvoiceNumber || undefined,
      ...linkContext,
      ...vehicleFields,
      createdAt: new Date().toISOString(),
    };
    try {
      await expensesStore.add(record);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المصروف في Supabase");
      return;
    }
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
    logActivity({
      action: "create", entity: "expense", entityId: number,
      label: `${cat?.name || "مصروف"} — ${beneficiary || "بدون مستفيد"}`,
      description: `إضافة سند صرف بقيمة ${value.toLocaleString()} ر.ع`,
      amount: value,
    });
    toast.success(`تم حفظ سند الصرف ${number}`);
    resetForm();
  };

  const handleEdit = (rec: ExpenseRecord) => {
    setEditingId(rec.id);
    setDate(rec.date);
    setCategoryId(rec.categoryId);
    setCashboxId(rec.cashboxId);
    setAmount(String(rec.amount));
    setPaymentMethod(rec.paymentMethod);
    setBeneficiary(rec.beneficiary || "");
    setDescription(rec.description || "");
    setPhoto(rec.photo || null);
    setLinkedVehiclePlate(rec.linkedVehiclePlate || "");
    setSupplierCompany("");
    setSupplierTaxNumber(rec.supplierTaxNumber || "");
    setSupplierInvoiceNumber(rec.supplierInvoiceNumber || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const rec = expensesStore.getById(deleteId);
    if (rec) {
      await expensesStore.remove(deleteId);
      // Refund cashbox
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === rec.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + rec.amount });
      logActivity({
        action: "delete", entity: "expense", entityId: rec.voucherNumber,
        label: `${rec.categoryName || "مصروف"}`,
        description: `حذف سند صرف بقيمة ${rec.amount.toLocaleString()} ر.ع`,
        amount: rec.amount,
      });
      toast.success(`تم حذف سند الصرف ${rec.voucherNumber}`);
    }
    setDeleteId(null);
  };

  const openPdf = (rec: ExpenseRecord) => {
    const html = getPaymentVoucherHtml({
      voucherNumber: rec.voucherNumber,
      date: rec.date,
      amount: rec.amount,
      categoryName: rec.categoryName || "-",
      cashboxName: rec.cashboxName || "-",
      paymentMethod: PAYMENT_METHOD_LABELS[rec.paymentMethod],
      beneficiary: rec.beneficiary,
      description: rec.description,
      photo: rec.photo,
    });
    setPdfHtml(html);
    setPdfTitle(`سند صرف ${rec.voucherNumber}`);
    setPdfOpen(true);
  };

  const handleEmail = (rec: ExpenseRecord) => {
    const subject = encodeURIComponent(`سند صرف ${rec.voucherNumber}`);
    const body = encodeURIComponent(
      `رقم السند: ${rec.voucherNumber}\nالتاريخ: ${rec.date}\nالمبلغ: ${rec.amount.toLocaleString()} ر.ع\nالمستفيد: ${rec.beneficiary || "-"}\nالتصنيف: ${rec.categoryName || "-"}\nالبيان: ${rec.description || "-"}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // Filtering + reports
  const filtered = useMemo(() => {
    const all = expensesStore.getAll();
    return all.filter((r) => {
      if (linkContext.claimId && r.claimId !== linkContext.claimId && r.sourceClaimId !== linkContext.claimId) return false;
      if (linkContext.linkedWorkOrderId && r.linkedWorkOrderId !== linkContext.linkedWorkOrderId && r.sourceWorkOrderId !== linkContext.linkedWorkOrderId) return false;
      if (linkContext.vehicleId && r.vehicleId !== linkContext.vehicleId) return false;
      if (linkContext.customerId && r.customerId !== linkContext.customerId) return false;
      if (filterCategory !== "all" && r.categoryId !== filterCategory) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const hay = `${r.voucherNumber} ${r.beneficiary || ""} ${r.description || ""} ${r.categoryName || ""} ${r.cashboxName || ""} ${r.claimId || ""} ${r.linkedWorkOrderId || ""} ${r.vehicleId || ""} ${r.customerId || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (reportPeriod !== "all") {
        const d = new Date(r.date);
        const ref = new Date(reportDate);
        if (reportPeriod === "day" && r.date !== reportDate) return false;
        if (reportPeriod === "month" && (d.getMonth() !== ref.getMonth() || d.getFullYear() !== ref.getFullYear())) return false;
        if (reportPeriod === "year" && d.getFullYear() !== ref.getFullYear()) return false;
      }
      return true;
    });
  }, [searchTerm, filterCategory, reportPeriod, reportDate, linkContext, expensesStore.getAll().length]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, r) => s + r.amount, 0);
    const byCategory: Record<string, number> = {};
    filtered.forEach((r) => {
      const k = r.categoryName || "-";
      byCategory[k] = (byCategory[k] || 0) + r.amount;
    });
    return { total, count: filtered.length, byCategory };
  }, [filtered]);

  const bulk = useBulkSelection<ExpenseRecord>(filtered);

  const handleDeleteMultiple = async () => {
    if (bulk.count === 0) return;
    let refundTotal = 0;
    for (const rec of bulk.selectedItems) {
      try {
        await expensesStore.remove(rec.id);
      } catch (error: any) {
        toast.error(error?.message || `تعذر حذف سند الصرف ${rec.voucherNumber} من Supabase`);
        return;
      }
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === rec.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + rec.amount });
      refundTotal += rec.amount;
      logActivity({
        action: "delete", entity: "expense", entityId: rec.voucherNumber,
        label: `${rec.categoryName || "مصروف"}`,
        description: `حذف سند صرف بقيمة ${rec.amount.toLocaleString()} ر.ع`,
        amount: rec.amount,
      });
    }
    toast.success(`تم حذف ${bulk.count} سند صرف (إجمالي مُسترجع: ${refundTotal.toLocaleString()} ر.ع)`);
    bulk.clear();
    setDeleteMultipleOpen(false);
  };

  const exportSelectedCsv = () => {
    if (bulk.count === 0) return;
    const headers = ["رقم السند", "التاريخ", "المبلغ", "التصنيف", "الخزينة", "طريقة الدفع", "المستفيد", "البيان"];
    const rows = bulk.selectedItems.map((r) => [
      r.voucherNumber, r.date, r.amount, r.categoryName || "", r.cashboxName || "",
      PAYMENT_METHOD_LABELS[r.paymentMethod], r.beneficiary || "", (r.description || "").replace(/[\n,]/g, " "),
    ]);
    exportRowsAsCsv(`expenses-selected-${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
    toast.success("تم تصدير السجلات المحددة");
  };

  const exportCsv = () => {
    const headers = ["رقم السند", "التاريخ", "المبلغ", "التصنيف", "الخزينة", "طريقة الدفع", "المستفيد", "البيان"];
    const rows = filtered.map((r) => [
      r.voucherNumber, r.date, r.amount, r.categoryName || "", r.cashboxName || "",
      PAYMENT_METHOD_LABELS[r.paymentMethod], r.beneficiary || "", (r.description || "").replace(/[\n,]/g, " "),
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-report-${reportPeriod}-${reportDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير التقرير");
  };

  const printReport = () => {
    const periodLabel = reportPeriod === "day" ? `يومي - ${reportDate}` :
      reportPeriod === "month" ? `شهري - ${reportDate.slice(0, 7)}` :
      reportPeriod === "year" ? `سنوي - ${reportDate.slice(0, 4)}` : "كامل الفترة";
    const rowsHtml = filtered.map((r, i) => `
      <tr>
        <td>${i + 1}</td><td>${r.voucherNumber}</td><td>${r.date}</td>
        <td>${r.categoryName || "-"}</td><td>${r.beneficiary || "-"}</td>
        <td>${PAYMENT_METHOD_LABELS[r.paymentMethod]}</td>
        <td style="text-align:left;font-weight:600;">${r.amount.toLocaleString()} ر.ع</td>
      </tr>`).join("");
    const catHtml = Object.entries(totals.byCategory).map(([k, v]) =>
      `<tr><td>${k}</td><td style="text-align:left;">${v.toLocaleString()} ر.ع</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/>
      <title>تقرير المصروفات</title>
      <style>
        body{font-family:Tahoma,sans-serif;padding:20px;color:#1a1a2e}
        h1{border-bottom:3px solid #dc2626;padding-bottom:8px}
        .meta{color:#666;margin:10px 0;font-size:13px}
        table{width:100%;border-collapse:collapse;margin:15px 0;font-size:12px}
        th{background:#1a1a2e;color:#fff;padding:8px;text-align:right}
        td{padding:7px;border-bottom:1px solid #eee;text-align:right}
        .summary{background:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:15px;margin:15px 0}
        .summary h3{color:#dc2626;margin-bottom:10px}
        @page{size:A4;margin:0}
        @media print{html,body{padding:0!important;margin:0!important}}
        body{padding:14mm}
      </style></head><body>
      <h1>تقرير المصروفات</h1>
      <div class="meta">الفترة: ${periodLabel} • عدد السندات: ${totals.count}</div>
      <div class="summary">
        <h3>الإجمالي: ${totals.total.toLocaleString()} ر.ع</h3>
        <table><thead><tr><th>التصنيف</th><th>الإجمالي</th></tr></thead><tbody>${catHtml}</tbody></table>
      </div>
      <table><thead><tr>
        <th>#</th><th>رقم السند</th><th>التاريخ</th><th>التصنيف</th><th>المستفيد</th><th>طريقة الدفع</th><th>المبلغ</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>
      </body></html>`;
    openAndPrintWindow(html);
  };

  // ===== تقرير ضريبي رسمي: يعرض فقط المصروفات التي تحمل بيانات فاتورة المورد (رقم ضريبي/رقم فاتورة) =====
  const taxRows = useMemo(
    () => filtered.filter((r) => r.supplierTaxNumber || r.supplierInvoiceNumber),
    [filtered]
  );
  const taxTotals = useMemo(() => {
    const base = roundMoney(taxRows.reduce((s, r) => s + r.amount, 0));
    const vat = calculateVatExclusive(base).vatAmount;
    return { base, vat, totalIncl: roundMoney(base + vat), count: taxRows.length };
  }, [taxRows]);

  const printTaxReport = () => {
    const periodLabel = reportPeriod === "day" ? `يومي - ${reportDate}` :
      reportPeriod === "month" ? `شهري - ${reportDate.slice(0, 7)}` :
      reportPeriod === "year" ? `سنوي - ${reportDate.slice(0, 4)}` : "كامل الفترة";
    const rows = taxRows.map((r, i) => {
      const breakdown = calculateVatExclusive(r.amount);
      const base = breakdown.subtotalBeforeVat;
      const vat = breakdown.vatAmount;
      return `<tr>
        <td>${i + 1}</td>
        <td>${r.date}</td>
        <td>${r.supplierInvoiceNumber || "-"}</td>
        <td>${r.beneficiary || "-"}</td>
        <td>${r.supplierTaxNumber || "-"}</td>
        <td>${r.categoryName || "-"}</td>
        <td style="text-align:left">${base.toFixed(3)}</td>
        <td style="text-align:left">${vat.toFixed(3)}</td>
        <td style="text-align:left;font-weight:700">${breakdown.totalIncludingVat.toFixed(3)}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
      <title>تقرير ضريبة المدخلات</title>
      <style>
        body{font-family:Tahoma,sans-serif;padding:14mm;color:#1a1a2e}
        h1{border-bottom:3px solid #0ea5e9;padding-bottom:8px;margin:0 0 6px}
        .meta{color:#666;margin:8px 0;font-size:12px}
        table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11px}
        th{background:#0f172a;color:#fff;padding:7px;text-align:right;border:1px solid #ccc}
        td{padding:6px 7px;border:1px solid #e5e7eb;text-align:right}
        .summary{background:#ecfeff;border:2px solid #0ea5e9;border-radius:8px;padding:14px;margin:14px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
        .summary div b{display:block;color:#0369a1;font-size:11px}
        .summary div span{font-size:15px;font-weight:700;color:#0c4a6e}
        @page{size:A4;margin:0}
      </style></head><body>
      <h1>🧾 تقرير ضريبة القيمة المضافة — المدخلات (5%)</h1>
      <div class="meta">الفترة: ${periodLabel} • عدد الفواتير: ${taxTotals.count} • تاريخ التقرير: ${new Date().toISOString().slice(0,10)}</div>
      <div class="summary">
        <div><b>الوعاء الضريبي</b><span>${taxTotals.base.toFixed(3)} ر.ع</span></div>
        <div><b>ضريبة المدخلات (5%)</b><span>${taxTotals.vat.toFixed(3)} ر.ع</span></div>
        <div><b>الإجمالي شامل الضريبة</b><span>${taxTotals.totalIncl.toFixed(3)} ر.ع</span></div>
        <div><b>عدد الفواتير</b><span>${taxTotals.count}</span></div>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>التاريخ</th><th>رقم الفاتورة</th><th>اسم المورد</th>
          <th>الرقم الضريبي</th><th>التصنيف</th><th>الوعاء</th><th>VAT 5%</th><th>الإجمالي</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="9" style="text-align:center;padding:20px;color:#999">لا توجد فواتير ضريبية في الفترة المحددة. أضف الرقم الضريبي ورقم الفاتورة عند تسجيل المصروف.</td></tr>`}</tbody>
      </table>
      <p style="font-size:10px;color:#666;margin-top:20px">تقرير معد للأغراض الضريبية — جهاز الضرائب — سلطنة عُمان. المبالغ بالريال العُماني (ر.ع).</p>
      </body></html>`;
    openAndPrintWindow(html);
  };

  const exportTaxCsv = () => {
    const headers = ["#","التاريخ","رقم الفاتورة","اسم المورد","الرقم الضريبي","التصنيف","الوعاء","VAT 5%","الإجمالي"];
    const rows = taxRows.map((r, i) => {
      const breakdown = calculateVatExclusive(r.amount);
      const base = breakdown.subtotalBeforeVat;
      const vat = breakdown.vatAmount;
      return [i+1, r.date, r.supplierInvoiceNumber||"", r.beneficiary||"", r.supplierTaxNumber||"", r.categoryName||"", breakdown.subtotalBeforeVat.toFixed(3), breakdown.vatAmount.toFixed(3), breakdown.totalIncludingVat.toFixed(3)];
    });
    const csv = "\uFEFF" + [headers, ...rows].map(row => row.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax-input-vat-${reportPeriod}-${reportDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير التقرير الضريبي");
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MinusCircle className="text-destructive" size={24} /> إدارة المصروفات
          </h1>
          <p className="text-sm text-muted-foreground">إنشاء سندات الصرف، البحث، والتقارير المالية</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} className="gap-2">
            <Plus size={16} /> إضافة عدة بنود
          </Button>
          <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>
            <ArrowRight size={16} className="ml-1" /> رجوع
          </Button>
        </div>
      </div>

      {/* === Form === */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            {editingId ? <><Pencil size={16} /> تعديل سند صرف</> : <><Plus size={16} /> سند صرف جديد</>}
          </h2>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>إلغاء التعديل</Button>
          )}
        </div>

        {/* تعبئة تلقائية من صورة الفاتورة */}
        <div className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <div className="text-xs">
            <div className="font-medium text-foreground">⚡ تعبئة من صورة الفاتورة بالذكاء</div>
            <div className="text-muted-foreground">صوّر إيصال المصروف أو فاتورة الشراء، وسنستخرج المبلغ والتاريخ والمورد</div>
          </div>
          <AiExtractButton
            schema="expense_receipt"
            label="تعبئة من فاتورة"
            onExtracted={(d) => {
              if (d.total) setAmount(String(d.total).replace(/[^\d.]/g, ""));
              if (d.date) setDate(d.date);
              if (d.vendor) setBeneficiary(d.vendor);
              if (d.notes || d.invoice_number) {
                setDescription([d.notes, d.invoice_number && `رقم الفاتورة: ${d.invoice_number}`].filter(Boolean).join(" — "));
              }
            }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>المبلغ (ر.ع)</Label>
            <Input type="text" inputMode="decimal" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
          </div>
          <div className="space-y-2">
            <Label>تصنيف المصروف</Label>
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
                  <SelectItem key={c.id} value={c.id}>
                    {c.cashboxName} — {c.currentBalance.toLocaleString()} ر.ع
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
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
          <div className="space-y-2">
            <Label>المستفيد / المورد</Label>
            <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="اسم المستفيد" />
          </div>

          {/* ===== حقول ضريبية رسمية للمورد (لتقرير الضريبة) ===== */}
          <div className="md:col-span-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
            <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
              🧾 بيانات الفاتورة الضريبية للمورد (اختياري — تظهر في التقرير الضريبي)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">اسم الشركة / المورد</Label>
                <Input value={supplierCompany} onChange={(e) => setSupplierCompany(e.target.value)} placeholder="اسم الشركة كما في الفاتورة" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">الرقم الضريبي للمورد</Label>
                <Input value={supplierTaxNumber} onChange={(e) => setSupplierTaxNumber(e.target.value)} placeholder="OMxxxxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">رقم فاتورة المورد</Label>
                <Input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} placeholder="INV-..." />
              </div>
            </div>
          </div>

          {/* السيارة المرتبطة — يظهر فقط لتصنيف "قطع غيار" */}
          {(() => {
            const cat = categories.find((c) => c.id === categoryId);
            const isParts = !!cat && /قطع غيار/.test(cat.name);
            if (!isParts) return null;
            const allVehicles = vehiclesStore.getAll();
            return (
              <div className="space-y-2 md:col-span-2 bg-warning/5 border border-warning/30 rounded-lg p-3">
                <Label className="flex items-center gap-2">
                  🚗 السيارة المرتبطة بالقطعة
                  <span className="text-xs text-muted-foreground">(لتتبع تكلفة كل سيارة)</span>
                </Label>
                <Select value={linkedVehiclePlate || "__none__"} onValueChange={(v) => setLinkedVehiclePlate(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="اختر السيارة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— بدون ربط —</SelectItem>
                    {allVehicles.map((v) => (
                      <SelectItem key={v.id} value={v.plate}>
                        {v.plate} — {v.type} ({v.owner})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>البيان / التفاصيل</Label>
              <AiWriteButton
                value={description}
                onChange={setDescription}
                context={`سند صرف بقيمة ${amount} ر.ع للمستفيد ${beneficiary || "-"}`}
                placeholder="مثال: اكتب وصفاً لمصروف صيانة مكتب"
              />
            </div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="تفاصيل المصروف..." rows={2} />
          </div>
          <div className="space-y-2">
            <Label>
              صورة الإيصال
              {settings.paymentVoucherRequirePhoto && <span className="text-destructive mr-1">*</span>}
            </Label>
            <Input
              type="file"
              accept="image/*"
              capture={settings.paymentVoucherAllowCamera ? "environment" : undefined}
              onChange={handlePhoto}
            />
            {photo && <img src={photo} alt="إيصال" className="mt-2 max-h-24 rounded-lg border border-border" />}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button onClick={handleSave} className="gap-2">
            <Save size={16} /> {editingId ? "حفظ التعديلات" : "حفظ سند الصرف"}
          </Button>
        </div>
      </div>

      {/* === List + Reports === */}
      <Tabs defaultValue="list" dir="rtl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list"><FileText size={14} className="ml-1" /> قائمة المصروفات</TabsTrigger>
          <TabsTrigger value="reports"><CalendarIcon size={14} className="ml-1" /> التقارير</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 shadow-card">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div className="relative md:col-span-2">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  placeholder="ابحث برقم السند / المستفيد / البيان..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue placeholder="كل التصنيفات" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={exportCsv} className="flex-1 gap-1">
                  <Download size={14} /> CSV
                </Button>
                <Button variant="outline" onClick={printReport} className="flex-1 gap-1">
                  <Printer size={14} /> طباعة
                </Button>
              </div>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="secondary" className="text-sm">عدد السندات: {totals.count}</Badge>
              <Badge variant="destructive" className="text-sm">الإجمالي: {totals.total.toLocaleString()} ر.ع</Badge>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                لا توجد مصروفات مطابقة
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={bulk.allChecked}
                          data-state={bulk.someChecked ? "indeterminate" : undefined}
                          onCheckedChange={bulk.toggleAll}
                          aria-label="تحديد الكل"
                        />
                      </TableHead>
                      <TableHead className="text-right">رقم السند</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">التصنيف</TableHead>
                      <TableHead className="text-right">السيارة</TableHead>
                      <TableHead className="text-right">المستفيد</TableHead>
                      <TableHead className="text-right">الخزينة</TableHead>
                      <TableHead className="text-right">المبلغ</TableHead>
                      <TableHead className="text-right">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="w-8">
                          <Checkbox
                            checked={bulk.isSelected(r.id)}
                            onCheckedChange={() => bulk.toggle(r.id)}
                            aria-label={`تحديد ${r.voucherNumber}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.voucherNumber}</TableCell>
                        <TableCell className="text-xs">{r.date}</TableCell>
                        <TableCell className="text-xs">{r.categoryName || "-"}</TableCell>
                        <TableCell className="text-xs">
                          {r.linkedVehiclePlate ? (
                            <span className="px-1.5 py-0.5 bg-warning/10 text-warning rounded font-mono">
                              {r.linkedVehiclePlate}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{r.beneficiary || "-"}</TableCell>
                        <TableCell className="text-xs">{r.cashboxName || "-"}</TableCell>
                        <TableCell className="text-xs font-bold text-destructive">
                          {r.amount.toLocaleString()} ر.ع
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="عرض / PDF" onClick={() => openPdf(r)}>
                              <FileText size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="طباعة" onClick={() => { openPdf(r); }}>
                              <Printer size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="إرسال بالبريد" onClick={() => handleEmail(r)}>
                              <Mail size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => handleEdit(r)}>
                              <Pencil size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="حذف" onClick={() => setDeleteId(r.id)}>
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <BulkActionBar count={bulk.count} onClear={bulk.clear} label="محدد">
                  <Button variant="outline" size="sm" className="gap-1" onClick={exportSelectedCsv}>
                    <Download size={14} /> CSV
                  </Button>
                  <Button variant="destructive" size="sm" className="gap-1" onClick={() => setDeleteMultipleOpen(true)}>
                    <Trash2 size={14} /> حذف
                  </Button>
                </BulkActionBar>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 shadow-card">
            <h3 className="font-semibold text-foreground mb-4">إعدادات التقرير</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="space-y-2">
                <Label>الفترة</Label>
                <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as ReportPeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفترات</SelectItem>
                    <SelectItem value="day">يومي</SelectItem>
                    <SelectItem value="month">شهري</SelectItem>
                    <SelectItem value="year">سنوي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reportPeriod !== "all" && (
                <div className="space-y-2">
                  <Label>
                    {reportPeriod === "day" ? "اليوم" : reportPeriod === "month" ? "الشهر (أي تاريخ ضمنه)" : "السنة (أي تاريخ ضمنها)"}
                  </Label>
                  <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <Label>التصنيف</Label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل التصنيفات</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground">الإجمالي</p>
                <p className="text-2xl font-bold text-destructive">{totals.total.toLocaleString()} ر.ع</p>
              </div>
              <div className="bg-secondary/30 border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">عدد السندات</p>
                <p className="text-2xl font-bold text-foreground">{totals.count}</p>
              </div>
              <div className="bg-secondary/30 border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">متوسط السند</p>
                <p className="text-2xl font-bold text-foreground">
                  {totals.count ? (totals.total / totals.count).toFixed(3) : "0.000"} ر.ع
                </p>
              </div>
            </div>

            {/* By category breakdown */}
            <h4 className="font-semibold text-sm text-foreground mb-3">التوزيع حسب التصنيف</h4>
            {Object.keys(totals.byCategory).length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد بيانات</p>
            ) : (
              <div className="space-y-2 mb-6">
                {Object.entries(totals.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, val]) => {
                    const pct = totals.total ? (val / totals.total) * 100 : 0;
                    return (
                      <div key={name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-foreground">{name}</span>
                          <span className="text-muted-foreground">{val.toLocaleString()} ر.ع ({pct.toFixed(1)}%)</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-destructive" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="flex gap-2 pt-4 border-t border-border flex-wrap">
              <Button onClick={printReport} className="gap-2">
                <Printer size={16} /> طباعة التقرير
              </Button>
              <Button variant="outline" onClick={exportCsv} className="gap-2">
                <Download size={16} /> تصدير CSV
              </Button>
              <Button onClick={printTaxReport} className="gap-2 bg-sky-600 hover:bg-sky-700 text-white">
                🧾 تقرير ضريبي رسمي (PDF)
              </Button>
              <Button variant="outline" onClick={exportTaxCsv} className="gap-2 border-sky-500 text-sky-700">
                <Download size={16} /> تقرير ضريبي CSV
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              💡 يشمل التقرير الضريبي فقط المصروفات التي تحمل <b>الرقم الضريبي للمورد</b> أو <b>رقم فاتورة المورد</b> (عدد الفواتير الحالي: {taxRows.length})
            </p>

          </div>
        </TabsContent>
      </Tabs>

      <PdfPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        htmlContent={pdfHtml}
        title={pdfTitle}
        fileName={pdfTitle}
      />

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف سند الصرف"
        description="سيتم استرجاع المبلغ إلى الخزينة. هل أنت متأكد؟"
      />

      <ConfirmDeleteDialog
        open={deleteMultipleOpen}
        onOpenChange={setDeleteMultipleOpen}
        onConfirm={handleDeleteMultiple}
        title="حذف مصروفات محددة"
        description={`سيتم حذف ${bulk.count} سند صرف واسترجاع المبالغ إلى الخزائن. لا يمكن التراجع بعد الحذف.`}
        confirmLabel="حذف المحدد"
        destructive
      />

      <BulkExpenseDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}
