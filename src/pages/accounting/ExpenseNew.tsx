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
  // ط­ظ‚ظˆظ„ ط¶ط±ظٹط¨ظٹط© ظ„ظ„ظ…ظˆط±ط¯ (ظ„طھظ‚ط±ظٹط± ط§ظ„ط¶ط±ظٹط¨ط© ط§ظ„ط±ط³ظ…ظٹ)
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
    if (!value || value <= 0) return toast.error("ط£ط¯ط®ظ„ ظ…ط¨ظ„ط؛ط§ظ‹ طµط­ظٹط­ط§ظ‹");
    if (!categoryId) return toast.error("ط§ط®طھط± طھطµظ†ظٹظپ ط§ظ„ظ…طµط±ظˆظپ");
    if (!cashboxId) return toast.error("ط§ط®طھط± ط§ظ„ط®ط²ظٹظ†ط©");
    if (settings.paymentVoucherRequirePhoto && !photo && !editingId) return toast.error("طµظˆط±ط© ط§ظ„ط¥ظٹطµط§ظ„ ظ…ط·ظ„ظˆط¨ط©");

    const cat = categories.find((c) => c.id === categoryId);
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === cashboxId);
    const isPartsCat = !!cat && /ظ‚ط·ط¹ ط؛ظٹط§ط±/.test(cat.name);
    const linkedVehicle = linkedVehiclePlate
      ? vehiclesStore.getAll().find((v) => v.plate === linkedVehiclePlate)
      : undefined;
    const vehicleFields: Partial<ExpenseRecord> = isPartsCat && linkedVehiclePlate
      ? {
          linkedVehiclePlate,
          linkedVehicleName: linkedVehicle ? `${linkedVehicle.type} â€” ${linkedVehicle.plate}` : linkedVehiclePlate,
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
          toast.error(error?.message || "طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ظ…طµط±ظˆظپ ظپظٹ Supabase");
          return;
        }
        if (oldCb) employeeCashboxesStore.update(oldCb.id, { currentBalance: oldCb.currentBalance + old.amount });
        if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
        logActivity({
          action: "update", entity: "expense", entityId: old.voucherNumber,
          label: `${cat?.name || "ظ…طµط±ظˆظپ"}`,
          description: `طھط¹ط¯ظٹظ„ ط§ظ„ظ…ط¨ظ„ط؛ ظ…ظ† ${old.amount.toLocaleString()} ط¥ظ„ظ‰ ${value.toLocaleString()} ط±.ط¹`,
          amount: value,
        });
        toast.success(`طھظ… طھط­ط¯ظٹط« ط³ظ†ط¯ ط§ظ„طµط±ظپ ${old.voucherNumber}`);
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
      toast.error(error?.message || "طھط¹ط°ط± ط­ظپط¸ ط§ظ„ظ…طµط±ظˆظپ ظپظٹ Supabase");
      return;
    }
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
    logActivity({
      action: "create", entity: "expense", entityId: number,
      label: `${cat?.name || "ظ…طµط±ظˆظپ"} â€” ${beneficiary || "ط¨ط¯ظˆظ† ظ…ط³طھظپظٹط¯"}`,
      description: `ط¥ط¶ط§ظپط© ط³ظ†ط¯ طµط±ظپ ط¨ظ‚ظٹظ…ط© ${value.toLocaleString()} ط±.ط¹`,
      amount: value,
    });
    toast.success(`طھظ… ط­ظپط¸ ط³ظ†ط¯ ط§ظ„طµط±ظپ ${number}`);
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
        label: `${rec.categoryName || "ظ…طµط±ظˆظپ"}`,
        description: `ط­ط°ظپ ط³ظ†ط¯ طµط±ظپ ط¨ظ‚ظٹظ…ط© ${rec.amount.toLocaleString()} ط±.ط¹`,
        amount: rec.amount,
      });
      toast.success(`طھظ… ط­ط°ظپ ط³ظ†ط¯ ط§ظ„طµط±ظپ ${rec.voucherNumber}`);
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
    setPdfTitle(`ط³ظ†ط¯ طµط±ظپ ${rec.voucherNumber}`);
    setPdfOpen(true);
  };

  const handleEmail = (rec: ExpenseRecord) => {
    const subject = encodeURIComponent(`ط³ظ†ط¯ طµط±ظپ ${rec.voucherNumber}`);
    const body = encodeURIComponent(
      `ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯: ${rec.voucherNumber}\nط§ظ„طھط§ط±ظٹط®: ${rec.date}\nط§ظ„ظ…ط¨ظ„ط؛: ${rec.amount.toLocaleString()} ط±.ط¹\nط§ظ„ظ…ط³طھظپظٹط¯: ${rec.beneficiary || "-"}\nط§ظ„طھطµظ†ظٹظپ: ${rec.categoryName || "-"}\nط§ظ„ط¨ظٹط§ظ†: ${rec.description || "-"}`
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
        toast.error(error?.message || `طھط¹ط°ط± ط­ط°ظپ ط³ظ†ط¯ ط§ظ„طµط±ظپ ${rec.voucherNumber} ظ…ظ† Supabase`);
        return;
      }
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === rec.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + rec.amount });
      refundTotal += rec.amount;
      logActivity({
        action: "delete", entity: "expense", entityId: rec.voucherNumber,
        label: `${rec.categoryName || "ظ…طµط±ظˆظپ"}`,
        description: `ط­ط°ظپ ط³ظ†ط¯ طµط±ظپ ط¨ظ‚ظٹظ…ط© ${rec.amount.toLocaleString()} ط±.ط¹`,
        amount: rec.amount,
      });
    }
    toast.success(`طھظ… ط­ط°ظپ ${bulk.count} ط³ظ†ط¯ طµط±ظپ (ط¥ط¬ظ…ط§ظ„ظٹ ظ…ظڈط³طھط±ط¬ط¹: ${refundTotal.toLocaleString()} ط±.ط¹)`);
    bulk.clear();
    setDeleteMultipleOpen(false);
  };

  const exportSelectedCsv = () => {
    if (bulk.count === 0) return;
    const headers = ["ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯", "ط§ظ„طھط§ط±ظٹط®", "ط§ظ„ظ…ط¨ظ„ط؛", "ط§ظ„طھطµظ†ظٹظپ", "ط§ظ„ط®ط²ظٹظ†ط©", "ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹", "ط§ظ„ظ…ط³طھظپظٹط¯", "ط§ظ„ط¨ظٹط§ظ†"];
    const rows = bulk.selectedItems.map((r) => [
      r.voucherNumber, r.date, r.amount, r.categoryName || "", r.cashboxName || "",
      PAYMENT_METHOD_LABELS[r.paymentMethod], r.beneficiary || "", (r.description || "").replace(/[\n,]/g, " "),
    ]);
    exportRowsAsCsv(`expenses-selected-${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
    toast.success("طھظ… طھطµط¯ظٹط± ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ظ…ط­ط¯ط¯ط©");
  };

  const exportCsv = () => {
    const headers = ["ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯", "ط§ظ„طھط§ط±ظٹط®", "ط§ظ„ظ…ط¨ظ„ط؛", "ط§ظ„طھطµظ†ظٹظپ", "ط§ظ„ط®ط²ظٹظ†ط©", "ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹", "ط§ظ„ظ…ط³طھظپظٹط¯", "ط§ظ„ط¨ظٹط§ظ†"];
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
    toast.success("طھظ… طھطµط¯ظٹط± ط§ظ„طھظ‚ط±ظٹط±");
  };

  const printReport = () => {
    const periodLabel = reportPeriod === "day" ? `ظٹظˆظ…ظٹ - ${reportDate}` :
      reportPeriod === "month" ? `ط´ظ‡ط±ظٹ - ${reportDate.slice(0, 7)}` :
      reportPeriod === "year" ? `ط³ظ†ظˆظٹ - ${reportDate.slice(0, 4)}` : "ظƒط§ظ…ظ„ ط§ظ„ظپطھط±ط©";
    const rowsHtml = filtered.map((r, i) => `
      <tr>
        <td>${i + 1}</td><td>${r.voucherNumber}</td><td>${r.date}</td>
        <td>${r.categoryName || "-"}</td><td>${r.beneficiary || "-"}</td>
        <td>${PAYMENT_METHOD_LABELS[r.paymentMethod]}</td>
        <td style="text-align:left;font-weight:600;">${r.amount.toLocaleString()} ط±.ط¹</td>
      </tr>`).join("");
    const catHtml = Object.entries(totals.byCategory).map(([k, v]) =>
      `<tr><td>${k}</td><td style="text-align:left;">${v.toLocaleString()} ط±.ط¹</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/>
      <title>طھظ‚ط±ظٹط± ط§ظ„ظ…طµط±ظˆظپط§طھ</title>
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
      <h1>طھظ‚ط±ظٹط± ط§ظ„ظ…طµط±ظˆظپط§طھ</h1>
      <div class="meta">ط§ظ„ظپطھط±ط©: ${periodLabel} â€¢ ط¹ط¯ط¯ ط§ظ„ط³ظ†ط¯ط§طھ: ${totals.count}</div>
      <div class="summary">
        <h3>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ: ${totals.total.toLocaleString()} ط±.ط¹</h3>
        <table><thead><tr><th>ط§ظ„طھطµظ†ظٹظپ</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th></tr></thead><tbody>${catHtml}</tbody></table>
      </div>
      <table><thead><tr>
        <th>#</th><th>ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯</th><th>ط§ظ„طھط§ط±ظٹط®</th><th>ط§ظ„طھطµظ†ظٹظپ</th><th>ط§ظ„ظ…ط³طھظپظٹط¯</th><th>ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹</th><th>ط§ظ„ظ…ط¨ظ„ط؛</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>
      </body></html>`;
    openAndPrintWindow(html);
  };

  // ===== طھظ‚ط±ظٹط± ط¶ط±ظٹط¨ظٹ ط±ط³ظ…ظٹ: ظٹط¹ط±ط¶ ظپظ‚ط· ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„طھظٹ طھط­ظ…ظ„ ط¨ظٹط§ظ†ط§طھ ظپط§طھظˆط±ط© ط§ظ„ظ…ظˆط±ط¯ (ط±ظ‚ظ… ط¶ط±ظٹط¨ظٹ/ط±ظ‚ظ… ظپط§طھظˆط±ط©) =====
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
    const periodLabel = reportPeriod === "day" ? `ظٹظˆظ…ظٹ - ${reportDate}` :
      reportPeriod === "month" ? `ط´ظ‡ط±ظٹ - ${reportDate.slice(0, 7)}` :
      reportPeriod === "year" ? `ط³ظ†ظˆظٹ - ${reportDate.slice(0, 4)}` : "ظƒط§ظ…ظ„ ط§ظ„ظپطھط±ط©";
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
      <title>طھظ‚ط±ظٹط± ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¯ط®ظ„ط§طھ</title>
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
      <h1>ًں§¾ طھظ‚ط±ظٹط± ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© â€” ط§ظ„ظ…ط¯ط®ظ„ط§طھ (5%)</h1>
      <div class="meta">ط§ظ„ظپطھط±ط©: ${periodLabel} â€¢ ط¹ط¯ط¯ ط§ظ„ظپظˆط§طھظٹط±: ${taxTotals.count} â€¢ طھط§ط±ظٹط® ط§ظ„طھظ‚ط±ظٹط±: ${new Date().toISOString().slice(0,10)}</div>
      <div class="summary">
        <div><b>ط§ظ„ظˆط¹ط§ط، ط§ظ„ط¶ط±ظٹط¨ظٹ</b><span>${taxTotals.base.toFixed(3)} ط±.ط¹</span></div>
        <div><b>ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¯ط®ظ„ط§طھ (5%)</b><span>${taxTotals.vat.toFixed(3)} ط±.ط¹</span></div>
        <div><b>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط´ط§ظ…ظ„ ط§ظ„ط¶ط±ظٹط¨ط©</b><span>${taxTotals.totalIncl.toFixed(3)} ط±.ط¹</span></div>
        <div><b>ط¹ط¯ط¯ ط§ظ„ظپظˆط§طھظٹط±</b><span>${taxTotals.count}</span></div>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>ط§ظ„طھط§ط±ظٹط®</th><th>ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©</th><th>ط§ط³ظ… ط§ظ„ظ…ظˆط±ط¯</th>
          <th>ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ</th><th>ط§ظ„طھطµظ†ظٹظپ</th><th>ط§ظ„ظˆط¹ط§ط،</th><th>VAT 5%</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="9" style="text-align:center;padding:20px;color:#999">ظ„ط§ طھظˆط¬ط¯ ظپظˆط§طھظٹط± ط¶ط±ظٹط¨ظٹط© ظپظٹ ط§ظ„ظپطھط±ط© ط§ظ„ظ…ط­ط¯ط¯ط©. ط£ط¶ظپ ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ ظˆط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ط¹ظ†ط¯ طھط³ط¬ظٹظ„ ط§ظ„ظ…طµط±ظˆظپ.</td></tr>`}</tbody>
      </table>
      <p style="font-size:10px;color:#666;margin-top:20px">طھظ‚ط±ظٹط± ظ…ط¹ط¯ ظ„ظ„ط£ط؛ط±ط§ط¶ ط§ظ„ط¶ط±ظٹط¨ظٹط© â€” ط¬ظ‡ط§ط² ط§ظ„ط¶ط±ط§ط¦ط¨ â€” ط³ظ„ط·ظ†ط© ط¹ظڈظ…ط§ظ†. ط§ظ„ظ…ط¨ط§ظ„ط؛ ط¨ط§ظ„ط±ظٹط§ظ„ ط§ظ„ط¹ظڈظ…ط§ظ†ظٹ (ط±.ط¹).</p>
      </body></html>`;
    openAndPrintWindow(html);
  };

  const exportTaxCsv = () => {
    const headers = ["#","ط§ظ„طھط§ط±ظٹط®","ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©","ط§ط³ظ… ط§ظ„ظ…ظˆط±ط¯","ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ","ط§ظ„طھطµظ†ظٹظپ","ط§ظ„ظˆط¹ط§ط،","VAT 5%","ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ"];
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
    toast.success("طھظ… طھطµط¯ظٹط± ط§ظ„طھظ‚ط±ظٹط± ط§ظ„ط¶ط±ظٹط¨ظٹ");
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MinusCircle className="text-destructive" size={24} /> ط¥ط¯ط§ط±ط© ط§ظ„ظ…طµط±ظˆظپط§طھ
          </h1>
          <p className="text-sm text-muted-foreground">ط¥ظ†ط´ط§ط، ط³ظ†ط¯ط§طھ ط§ظ„طµط±ظپطŒ ط§ظ„ط¨ط­ط«طŒ ظˆط§ظ„طھظ‚ط§ط±ظٹط± ط§ظ„ظ…ط§ظ„ظٹط©</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} className="gap-2">
            <Plus size={16} /> ط¥ط¶ط§ظپط© ط¹ط¯ط© ط¨ظ†ظˆط¯
          </Button>
          <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>
            <ArrowRight size={16} className="ml-1" /> ط±ط¬ظˆط¹
          </Button>
        </div>
      </div>

      {/* === Form === */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            {editingId ? <><Pencil size={16} /> طھط¹ط¯ظٹظ„ ط³ظ†ط¯ طµط±ظپ</> : <><Plus size={16} /> ط³ظ†ط¯ طµط±ظپ ط¬ط¯ظٹط¯</>}
          </h2>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>ط¥ظ„ط؛ط§ط، ط§ظ„طھط¹ط¯ظٹظ„</Button>
          )}
        </div>

        {/* طھط¹ط¨ط¦ط© طھظ„ظ‚ط§ط¦ظٹط© ظ…ظ† طµظˆط±ط© ط§ظ„ظپط§طھظˆط±ط© */}
        <div className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <div className="text-xs">
            <div className="font-medium text-foreground">âڑ، طھط¹ط¨ط¦ط© ظ…ظ† طµظˆط±ط© ط§ظ„ظپط§طھظˆط±ط© ط¨ط§ظ„ط°ظƒط§ط،</div>
            <div className="text-muted-foreground">طµظˆظ‘ط± ط¥ظٹطµط§ظ„ ط§ظ„ظ…طµط±ظˆظپ ط£ظˆ ظپط§طھظˆط±ط© ط§ظ„ط´ط±ط§ط،طŒ ظˆط³ظ†ط³طھط®ط±ط¬ ط§ظ„ظ…ط¨ظ„ط؛ ظˆط§ظ„طھط§ط±ظٹط® ظˆط§ظ„ظ…ظˆط±ط¯</div>
          </div>
          <AiExtractButton
            schema="expense_receipt"
            label="طھط¹ط¨ط¦ط© ظ…ظ† ظپط§طھظˆط±ط©"
            onExtracted={(d) => {
              if (d.total) setAmount(String(d.total).replace(/[^\d.]/g, ""));
              if (d.date) setDate(d.date);
              if (d.vendor) setBeneficiary(d.vendor);
              if (d.notes || d.invoice_number) {
                setDescription([d.notes, d.invoice_number && `ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©: ${d.invoice_number}`].filter(Boolean).join(" â€” "));
              }
            }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>ط§ظ„طھط§ط±ظٹط®</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ط§ظ„ظ…ط¨ظ„ط؛ (ط±.ط¹)</Label>
            <Input type="text" inputMode="decimal" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
          </div>
          <div className="space-y-2">
            <Label>طھطµظ†ظٹظپ ط§ظ„ظ…طµط±ظˆظپ</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="ط§ط®طھط± ط§ظ„طھطµظ†ظٹظپ" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ط§ظ„ط®ط²ظٹظ†ط©</Label>
            <Select value={cashboxId} onValueChange={setCashboxId}>
              <SelectTrigger><SelectValue placeholder="ط§ط®طھط± ط§ظ„ط®ط²ظٹظ†ط©" /></SelectTrigger>
              <SelectContent>
                {cashboxes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.cashboxName} â€” {c.currentBalance.toLocaleString()} ط±.ط¹
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹</Label>
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
            <Label>ط§ظ„ظ…ط³طھظپظٹط¯ / ط§ظ„ظ…ظˆط±ط¯</Label>
            <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="ط§ط³ظ… ط§ظ„ظ…ط³طھظپظٹط¯" />
          </div>

          {/* ===== ط­ظ‚ظˆظ„ ط¶ط±ظٹط¨ظٹط© ط±ط³ظ…ظٹط© ظ„ظ„ظ…ظˆط±ط¯ (ظ„طھظ‚ط±ظٹط± ط§ظ„ط¶ط±ظٹط¨ط©) ===== */}
          <div className="md:col-span-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
            <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
              ًں§¾ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط¶ط±ظٹط¨ظٹط© ظ„ظ„ظ…ظˆط±ط¯ (ط§ط®طھظٹط§ط±ظٹ â€” طھط¸ظ‡ط± ظپظٹ ط§ظ„طھظ‚ط±ظٹط± ط§ظ„ط¶ط±ظٹط¨ظٹ)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ط§ط³ظ… ط§ظ„ط´ط±ظƒط© / ط§ظ„ظ…ظˆط±ط¯</Label>
                <Input value={supplierCompany} onChange={(e) => setSupplierCompany(e.target.value)} placeholder="ط§ط³ظ… ط§ظ„ط´ط±ظƒط© ظƒظ…ط§ ظپظٹ ط§ظ„ظپط§طھظˆط±ط©" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ ظ„ظ„ظ…ظˆط±ط¯</Label>
                <Input value={supplierTaxNumber} onChange={(e) => setSupplierTaxNumber(e.target.value)} placeholder="OMxxxxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ط±ظ‚ظ… ظپط§طھظˆط±ط© ط§ظ„ظ…ظˆط±ط¯</Label>
                <Input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} placeholder="INV-..." />
              </div>
            </div>
          </div>

          {/* ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ظ…ط±طھط¨ط·ط© â€” ظٹط¸ظ‡ط± ظپظ‚ط· ظ„طھطµظ†ظٹظپ "ظ‚ط·ط¹ ط؛ظٹط§ط±" */}
          {(() => {
            const cat = categories.find((c) => c.id === categoryId);
            const isParts = !!cat && /ظ‚ط·ط¹ ط؛ظٹط§ط±/.test(cat.name);
            if (!isParts) return null;
            const allVehicles = vehiclesStore.getAll();
            return (
              <div className="space-y-2 md:col-span-2 bg-warning/5 border border-warning/30 rounded-lg p-3">
                <Label className="flex items-center gap-2">
                  ًںڑ— ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط§ظ„ظ‚ط·ط¹ط©
                  <span className="text-xs text-muted-foreground">(ظ„طھطھط¨ط¹ طھظƒظ„ظپط© ظƒظ„ ط³ظٹط§ط±ط©)</span>
                </Label>
                <Select value={linkedVehiclePlate || "__none__"} onValueChange={(v) => setLinkedVehiclePlate(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="ط§ط®طھط± ط§ظ„ط³ظٹط§ط±ط©" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">â€” ط¨ط¯ظˆظ† ط±ط¨ط· â€”</SelectItem>
                    {allVehicles.map((v) => (
                      <SelectItem key={v.id} value={v.plate}>
                        {v.plate} â€” {v.type} ({v.owner})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>ط§ظ„ط¨ظٹط§ظ† / ط§ظ„طھظپط§طµظٹظ„</Label>
              <AiWriteButton
                value={description}
                onChange={setDescription}
                context={`ط³ظ†ط¯ طµط±ظپ ط¨ظ‚ظٹظ…ط© ${amount} ط±.ط¹ ظ„ظ„ظ…ط³طھظپظٹط¯ ${beneficiary || "-"}`}
                placeholder="ظ…ط«ط§ظ„: ط§ظƒطھط¨ ظˆطµظپط§ظ‹ ظ„ظ…طµط±ظˆظپ طµظٹط§ظ†ط© ظ…ظƒطھط¨"
              />
            </div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="طھظپط§طµظٹظ„ ط§ظ„ظ…طµط±ظˆظپ..." rows={2} />
          </div>
          <div className="space-y-2">
            <Label>
              طµظˆط±ط© ط§ظ„ط¥ظٹطµط§ظ„
              {settings.paymentVoucherRequirePhoto && <span className="text-destructive mr-1">*</span>}
            </Label>
            <Input
              type="file"
              accept="image/*"
              capture={settings.paymentVoucherAllowCamera ? "environment" : undefined}
              onChange={handlePhoto}
            />
            {photo && <img src={photo} alt="ط¥ظٹطµط§ظ„" className="mt-2 max-h-24 rounded-lg border border-border" />}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button onClick={handleSave} className="gap-2">
            <Save size={16} /> {editingId ? "ط­ظپط¸ ط§ظ„طھط¹ط¯ظٹظ„ط§طھ" : "ط­ظپط¸ ط³ظ†ط¯ ط§ظ„طµط±ظپ"}
          </Button>
        </div>
      </div>

      {/* === List + Reports === */}
      <Tabs defaultValue="list" dir="rtl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list"><FileText size={14} className="ml-1" /> ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…طµط±ظˆظپط§طھ</TabsTrigger>
          <TabsTrigger value="reports"><CalendarIcon size={14} className="ml-1" /> ط§ظ„طھظ‚ط§ط±ظٹط±</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 shadow-card">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div className="relative md:col-span-2">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  placeholder="ط§ط¨ط­ط« ط¨ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯ / ط§ظ„ظ…ط³طھظپظٹط¯ / ط§ظ„ط¨ظٹط§ظ†..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue placeholder="ظƒظ„ ط§ظ„طھطµظ†ظٹظپط§طھ" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ظƒظ„ ط§ظ„طھطµظ†ظٹظپط§طھ</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={exportCsv} className="flex-1 gap-1">
                  <Download size={14} /> CSV
                </Button>
                <Button variant="outline" onClick={printReport} className="flex-1 gap-1">
                  <Printer size={14} /> ط·ط¨ط§ط¹ط©
                </Button>
              </div>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="secondary" className="text-sm">ط¹ط¯ط¯ ط§ظ„ط³ظ†ط¯ط§طھ: {totals.count}</Badge>
              <Badge variant="destructive" className="text-sm">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ: {totals.total.toLocaleString()} ط±.ط¹</Badge>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                ظ„ط§ طھظˆط¬ط¯ ظ…طµط±ظˆظپط§طھ ظ…ط·ط§ط¨ظ‚ط©
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
                          aria-label="طھط­ط¯ظٹط¯ ط§ظ„ظƒظ„"
                        />
                      </TableHead>
                      <TableHead className="text-right">ط±ظ‚ظ… ط§ظ„ط³ظ†ط¯</TableHead>
                      <TableHead className="text-right">ط§ظ„طھط§ط±ظٹط®</TableHead>
                      <TableHead className="text-right">ط§ظ„طھطµظ†ظٹظپ</TableHead>
                      <TableHead className="text-right">ط§ظ„ط³ظٹط§ط±ط©</TableHead>
                      <TableHead className="text-right">ط§ظ„ظ…ط³طھظپظٹط¯</TableHead>
                      <TableHead className="text-right">ط§ظ„ط®ط²ظٹظ†ط©</TableHead>
                      <TableHead className="text-right">ط§ظ„ظ…ط¨ظ„ط؛</TableHead>
                      <TableHead className="text-right">ط¥ط¬ط±ط§ط،ط§طھ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="w-8">
                          <Checkbox
                            checked={bulk.isSelected(r.id)}
                            onCheckedChange={() => bulk.toggle(r.id)}
                            aria-label={`طھط­ط¯ظٹط¯ ${r.voucherNumber}`}
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
                          {r.amount.toLocaleString()} ط±.ط¹
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="ط¹ط±ط¶ / PDF" onClick={() => openPdf(r)}>
                              <FileText size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="ط·ط¨ط§ط¹ط©" onClick={() => { openPdf(r); }}>
                              <Printer size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="ط¥ط±ط³ط§ظ„ ط¨ط§ظ„ط¨ط±ظٹط¯" onClick={() => handleEmail(r)}>
                              <Mail size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="طھط¹ط¯ظٹظ„" onClick={() => handleEdit(r)}>
                              <Pencil size={14} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="ط­ط°ظپ" onClick={() => setDeleteId(r.id)}>
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <BulkActionBar count={bulk.count} onClear={bulk.clear} label="ظ…ط­ط¯ط¯">
                  <Button variant="outline" size="sm" className="gap-1" onClick={exportSelectedCsv}>
                    <Download size={14} /> CSV
                  </Button>
                  <Button variant="destructive" size="sm" className="gap-1" onClick={() => setDeleteMultipleOpen(true)}>
                    <Trash2 size={14} /> ط­ط°ظپ
                  </Button>
                </BulkActionBar>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 shadow-card">
            <h3 className="font-semibold text-foreground mb-4">ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„طھظ‚ط±ظٹط±</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="space-y-2">
                <Label>ط§ظ„ظپطھط±ط©</Label>
                <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as ReportPeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ظƒظ„ ط§ظ„ظپطھط±ط§طھ</SelectItem>
                    <SelectItem value="day">ظٹظˆظ…ظٹ</SelectItem>
                    <SelectItem value="month">ط´ظ‡ط±ظٹ</SelectItem>
                    <SelectItem value="year">ط³ظ†ظˆظٹ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reportPeriod !== "all" && (
                <div className="space-y-2">
                  <Label>
                    {reportPeriod === "day" ? "ط§ظ„ظٹظˆظ…" : reportPeriod === "month" ? "ط§ظ„ط´ظ‡ط± (ط£ظٹ طھط§ط±ظٹط® ط¶ظ…ظ†ظ‡)" : "ط§ظ„ط³ظ†ط© (ط£ظٹ طھط§ط±ظٹط® ط¶ظ…ظ†ظ‡ط§)"}
                  </Label>
                  <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <Label>ط§ظ„طھطµظ†ظٹظپ</Label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ظƒظ„ ط§ظ„طھطµظ†ظٹظپط§طھ</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p className="text-xs text-muted-foreground">ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</p>
                <p className="text-2xl font-bold text-destructive">{totals.total.toLocaleString()} ط±.ط¹</p>
              </div>
              <div className="bg-secondary/30 border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">ط¹ط¯ط¯ ط§ظ„ط³ظ†ط¯ط§طھ</p>
                <p className="text-2xl font-bold text-foreground">{totals.count}</p>
              </div>
              <div className="bg-secondary/30 border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">ظ…طھظˆط³ط· ط§ظ„ط³ظ†ط¯</p>
                <p className="text-2xl font-bold text-foreground">
                  {totals.count ? (totals.total / totals.count).toFixed(3) : "0.000"} ط±.ط¹
                </p>
              </div>
            </div>

            {/* By category breakdown */}
            <h4 className="font-semibold text-sm text-foreground mb-3">ط§ظ„طھظˆط²ظٹط¹ ط­ط³ط¨ ط§ظ„طھطµظ†ظٹظپ</h4>
            {Object.keys(totals.byCategory).length === 0 ? (
              <p className="text-muted-foreground text-sm">ظ„ط§ طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ</p>
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
                          <span className="text-muted-foreground">{val.toLocaleString()} ط±.ط¹ ({pct.toFixed(1)}%)</span>
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
                <Printer size={16} /> ط·ط¨ط§ط¹ط© ط§ظ„طھظ‚ط±ظٹط±
              </Button>
              <Button variant="outline" onClick={exportCsv} className="gap-2">
                <Download size={16} /> طھطµط¯ظٹط± CSV
              </Button>
              <Button onClick={printTaxReport} className="gap-2 bg-sky-600 hover:bg-sky-700 text-white">
                ًں§¾ طھظ‚ط±ظٹط± ط¶ط±ظٹط¨ظٹ ط±ط³ظ…ظٹ (PDF)
              </Button>
              <Button variant="outline" onClick={exportTaxCsv} className="gap-2 border-sky-500 text-sky-700">
                <Download size={16} /> طھظ‚ط±ظٹط± ط¶ط±ظٹط¨ظٹ CSV
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              ًں’، ظٹط´ظ…ظ„ ط§ظ„طھظ‚ط±ظٹط± ط§ظ„ط¶ط±ظٹط¨ظٹ ظپظ‚ط· ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„طھظٹ طھط­ظ…ظ„ <b>ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ ظ„ظ„ظ…ظˆط±ط¯</b> ط£ظˆ <b>ط±ظ‚ظ… ظپط§طھظˆط±ط© ط§ظ„ظ…ظˆط±ط¯</b> (ط¹ط¯ط¯ ط§ظ„ظپظˆط§طھظٹط± ط§ظ„ط­ط§ظ„ظٹ: {taxRows.length})
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
        title="ط­ط°ظپ ط³ظ†ط¯ ط§ظ„طµط±ظپ"
        description="ط³ظٹطھظ… ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ظ…ط¨ظ„ط؛ ط¥ظ„ظ‰ ط§ظ„ط®ط²ظٹظ†ط©. ظ‡ظ„ ط£ظ†طھ ظ…طھط£ظƒط¯طں"
      />

      <ConfirmDeleteDialog
        open={deleteMultipleOpen}
        onOpenChange={setDeleteMultipleOpen}
        onConfirm={handleDeleteMultiple}
        title="ط­ط°ظپ ظ…طµط±ظˆظپط§طھ ظ…ط­ط¯ط¯ط©"
        description={`ط³ظٹطھظ… ط­ط°ظپ ${bulk.count} ط³ظ†ط¯ طµط±ظپ ظˆط§ط³طھط±ط¬ط§ط¹ ط§ظ„ظ…ط¨ط§ظ„ط؛ ط¥ظ„ظ‰ ط§ظ„ط®ط²ط§ط¦ظ†. ظ„ط§ ظٹظ…ظƒظ† ط§ظ„طھط±ط§ط¬ط¹ ط¨ط¹ط¯ ط§ظ„ط­ط°ظپ.`}
        confirmLabel="ط­ط°ظپ ط§ظ„ظ…ط­ط¯ط¯"
        destructive
      />

      <BulkExpenseDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}
