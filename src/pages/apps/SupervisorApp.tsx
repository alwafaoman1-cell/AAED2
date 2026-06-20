import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardCheck, LogOut, Save, Trash2, Wallet, Receipt, TrendingDown,
  Camera, Car, Plus, Search, FileText, ImageIcon, ShieldCheck, QrCode, Package, RefreshCw,
} from "lucide-react";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";
import NeededPartsManager from "@/components/workorders/NeededPartsManager";
import { getNeededPartsRequestHtml } from "@/lib/pdfGenerator";
import { openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import { buildPartsRequestMessage, openWhatsAppWithMessage } from "@/lib/partsWhatsApp";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import AiWriteButton from "@/components/ai/AiWriteButton";
import AiExtractButton from "@/components/ai/AiExtractButton";
import VinScannerButton from "@/components/scanner/VinScannerButton";
import CustomerAutocomplete from "@/components/customers/CustomerAutocomplete";
import PhoneAutocomplete from "@/components/customers/PhoneAutocomplete";
import { useAuth } from "@/contexts/AuthContext";
import {
  expenseCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import {
  addWorkOrder,
  getWorkOrders,
  subscribeWorkOrders,
  refreshWorkOrdersFromCloud,
  type WorkOrder,
  WORK_ORDER_STATUSES,
} from "@/lib/workOrdersStore";

import { nextWorkOrderNumber } from "@/lib/numbering";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import QrLabel from "@/components/workorders/QrLabel";
import { toast } from "sonner";

const SERVICE_TYPES = ["حادث", "صيانة", "كهرباء", "فحص", "ميكانيكا", "صبغ", "غسيل"] as const;

export default function SupervisorApp() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const dir: "rtl" | "ltr" = isAr ? "rtl" : "ltr";
  const { profile, signOut } = useAuth();

  const [, force] = useState(0);
  useEffect(() => {
    // اسحب أحدث البيانات من السحابة فور دخول الصفحة
    refreshWorkOrdersFromCloud();
    const subs = [
      expenseCategoriesStore.subscribe(() => force((n) => n + 1)),
      employeeCashboxesStore.subscribe(() => force((n) => n + 1)),
      expensesStore.subscribe(() => force((n) => n + 1)),
      subscribeWorkOrders(() => force((n) => n + 1)),
    ];
    // مزامنة دورية كل 30 ثانية كحماية إضافية ضد البيانات القديمة
    const interval = setInterval(() => { refreshWorkOrdersFromCloud(); }, 30000);
    return () => { subs.forEach((u) => u()); clearInterval(interval); };
  }, []);


  const [tab, setTab] = useState<"vehicles" | "wo" | "expense">("vehicles");
  const [kpiFilter, setKpiFilter] = useState<"today" | "open" | "insurance" | "cash" | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  // ============ Stage photos ============
  const [photoOrderId, setPhotoOrderId] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [partsOrderId, setPartsOrderId] = useState<string | null>(null);
  const [partsOpen, setPartsOpen] = useState(false);

  function handlePrintPartsRequest(o: WorkOrder) {
    const parts = o.partsNeeded || [];
    if (parts.length === 0) {
      toast.error(isAr ? "لا توجد قطع غيار مطلوبة" : "No parts needed");
      return;
    }
    const html = getNeededPartsRequestHtml({
      requestNumber: `PR-${o.id}`,
      date: new Date().toISOString().slice(0, 10),
      rows: [{
        workOrderId: o.id,
        customer: o.customer,
        vehicle: `${o.vehicleType} ${o.model} ${o.year}`.trim(),
        vehicleType: `${o.vehicleType} ${o.model}`.trim(),
        year: o.year,
        vin: o.vin,
        plate: o.plate,
        parts: parts.map((p) => ({ name: p.name, quantity: p.quantity, notes: p.notes, fulfilled: p.fulfilled })),
      }],
    });
    openSanitizedPdfWindow(html);
  }

  function handleWhatsAppParts(o: WorkOrder) {
    const parts = o.partsNeeded || [];
    if (parts.length === 0) {
      toast.error(isAr ? "لا توجد قطع غيار مطلوبة" : "No parts needed");
      return;
    }
    openWhatsAppWithMessage(buildPartsRequestMessage(o), o.phone);
  }
  const [search, setSearch] = useState("");
  const workOrders = getWorkOrders();
  const partsOrder = useMemo(
    () => workOrders.find((o) => o.id === partsOrderId) || null,
    [workOrders, partsOrderId]
  );
  const IN_WORKSHOP = (o: WorkOrder) => !["تم التسليم", "مغلق"].includes(o.status);
  // معيار موحّد للتصنيف: يعتبر "تأمين" إذا توفر أي من:
  // 1) اسم شركة تأمين  2) رقم مطالبة  3) نوع الخدمة = حادث
  // غير ذلك → ورشة (كاش). نفس المعيار يستخدم في الفلتر والعدّاد والشارة.
  const hasVal = (v?: string) => !!(v && v.trim() !== "" && v.trim() !== "-");
  const IS_INSURANCE = (o: WorkOrder) =>
    hasVal(o.insurance) || hasVal(o.claimNumber) || (o.serviceType || "").trim() === "حادث";
  const filteredWO = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = workOrders
      .slice()
      .filter(IN_WORKSHOP)
      .sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || ""));
    if (kpiFilter === "today") {
      list = list.filter((o) => o.entryDate === today);
    } else if (kpiFilter === "insurance") {
      list = list.filter(IS_INSURANCE);
    } else if (kpiFilter === "cash") {
      list = list.filter((o) => !IS_INSURANCE(o));
    }
    // "open" يبقى مكافئاً للوضع الافتراضي (سيارات داخل الورشة).

    if (!q) return list;
    return list.filter((o) =>
      [o.id, o.plate, o.customer, o.vehicleType, o.model, o.technician]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [workOrders, search, kpiFilter, today]);

  // ============ New Work Order (no sensitive money fields) ============
  const [wo, setWo] = useState({
    customer: "", phone: "", plate: "", vehicleType: "", model: "", year: "",
    vin: "", color: "", mileage: "", serviceType: "صيانة", technician: profile?.full_name || "",
    description: "", entryDate: today, status: "تحت الفحص",
    isInsurance: false, insuranceCompany: "", claimNumber: "", policyNumber: "",
    incidentDate: "", incidentLocation: "",
  });
  const setWoField = <K extends keyof typeof wo>(k: K, v: typeof wo[K]) => setWo((s) => ({ ...s, [k]: v }));

  const handleCreateWO = () => {
    if (!wo.customer.trim()) return toast.error(isAr ? "اسم العميل مطلوب" : "Customer name required");
    if (!wo.plate.trim()) return toast.error(isAr ? "رقم اللوحة مطلوب" : "Plate number required");
    if (wo.isInsurance) {
      if (!wo.insuranceCompany.trim()) return toast.error(isAr ? "اسم شركة التأمين مطلوب" : "Insurance company required");
      if (!wo.claimNumber.trim()) return toast.error(isAr ? "رقم المطالبة مطلوب" : "Claim number required");
    }
    const id = nextWorkOrderNumber();
    const descParts: string[] = [];
    if (wo.description.trim()) descParts.push(wo.description.trim());
    if (wo.isInsurance) {
      if (wo.policyNumber.trim()) descParts.push(`${isAr ? "وثيقة" : "Policy"}: ${wo.policyNumber.trim()}`);
      if (wo.incidentDate) descParts.push(`${isAr ? "تاريخ الحادث" : "Incident date"}: ${wo.incidentDate}`);
      if (wo.incidentLocation.trim()) descParts.push(`${isAr ? "مكان الحادث" : "Location"}: ${wo.incidentLocation.trim()}`);
    }
    const order: WorkOrder = {
      id,
      customer: wo.customer.trim(),
      phone: wo.phone.trim(),
      plate: wo.plate.trim(),
      vehicleType: wo.vehicleType.trim(),
      model: wo.model.trim(),
      year: wo.year.trim(),
      vin: wo.vin.trim(),
      color: wo.color.trim() || undefined,
      mileage: wo.mileage.trim() || undefined,
      insurance: wo.isInsurance ? wo.insuranceCompany.trim() : "-",
      claimNumber: wo.isInsurance ? wo.claimNumber.trim() : "-",
      entryDate: wo.entryDate,
      technician: wo.technician.trim(),
      serviceType: wo.isInsurance ? "حادث" : wo.serviceType,
      status: wo.status,
      totalCost: 0,
      description: descParts.length ? descParts.join(" — ") : undefined,
      laborCost: 0,
      partsCost: 0,
      photos: [],
    };
    addWorkOrder(order);
    toast.success(`${isAr ? (wo.isInsurance ? "تم إنشاء أمر عمل تأمين" : "تم إنشاء أمر العمل") : (wo.isInsurance ? "Insurance work order created" : "Work order created")} — ${id}`);
    setWo({
      ...wo, customer: "", phone: "", plate: "", vehicleType: "", model: "",
      year: "", vin: "", color: "", mileage: "", description: "",
      isInsurance: false, insuranceCompany: "", claimNumber: "", policyNumber: "",
      incidentDate: "", incidentLocation: "",
    });
    setQrOrderId(id);
    setQrOpen(true);
    setTab("vehicles");
  };

  // ============ Expense voucher (existing) ============
  const categories = expenseCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const settings = voucherSettingsStore.get();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expMode, setExpMode] = useState<"workshop" | "workorder">("workshop");
  const [exp, setExp] = useState({
    date: today,
    amount: "",
    categoryId: categories[0]?.id ?? "",
    cashboxId: cashboxes.find((c) => c.isDefault)?.id || cashboxes[0]?.id || "",
    paymentMethod: settings.defaultPaymentMethod as PaymentMethod,
    beneficiary: "",
    description: "",
    reference: "",
    linkedWorkOrderId: "" as string,
    linkedVehiclePlate: "" as string,
    linkedVehicleName: "" as string,
    photo: null as string | null,
    supplierCompany: "",
    supplierTaxNumber: "",
    supplierInvoiceNumber: "",
  });
  const setExpField = <K extends keyof typeof exp>(k: K, v: typeof exp[K]) =>
    setExp((s) => ({ ...s, [k]: v }));

  // بحث عن أمر عمل بواسطة رقم اللوحة لربط سند الصرف به
  const [woSearch, setWoSearch] = useState("");
  const [woInsuranceOnly, setWoInsuranceOnly] = useState(false);
  const isInsuranceWO = (o: WorkOrder) => IS_INSURANCE(o);
  const woMatches = useMemo(() => {
    const q = woSearch.trim().toLowerCase();
    let list = workOrders;
    if (woInsuranceOnly) list = list.filter(isInsuranceWO);
    if (q) {
      list = list.filter(
        (o) =>
          String(o.plate || "").toLowerCase().includes(q) ||
          String(o.id).toLowerCase().includes(q) ||
          String(o.insurance || "").toLowerCase().includes(q) ||
          String(o.claimNumber || "").toLowerCase().includes(q),
      );
    } else if (!woInsuranceOnly) {
      return [];
    }
    return list.slice(0, 8);
  }, [woSearch, woInsuranceOnly, workOrders]);
  const linkedWO = useMemo(
    () => workOrders.find((o) => o.id === exp.linkedWorkOrderId) || null,
    [workOrders, exp.linkedWorkOrderId]
  );
  const pickWO = (o: WorkOrder) => {
    setExp((s) => ({
      ...s,
      linkedWorkOrderId: o.id,
      linkedVehiclePlate: o.plate || "",
      linkedVehicleName: [o.vehicleType, o.model].filter(Boolean).join(" "),
    }));
    setWoSearch("");
  };
  const clearWO = () =>
    setExp((s) => ({ ...s, linkedWorkOrderId: "", linkedVehiclePlate: "", linkedVehicleName: "" }));

  useEffect(() => {
    if (!exp.categoryId && categories[0]) setExp((s) => ({ ...s, categoryId: categories[0].id }));
    if (!exp.cashboxId && cashboxes[0]) setExp((s) => ({ ...s, cashboxId: cashboxes[0].id }));
  }, [categories, cashboxes, exp.categoryId, exp.cashboxId]);

  const resetExpForm = () =>
    setExp((s) => ({
      ...s, amount: "", beneficiary: "", description: "", reference: "", date: today,
      linkedWorkOrderId: "", linkedVehiclePlate: "", linkedVehicleName: "", photo: null,
      supplierCompany: "", supplierTaxNumber: "", supplierInvoiceNumber: "",
    }));


  const handleSaveExpense = () => {
    const value = parseFloat(exp.amount);
    if (!value || value <= 0) return toast.error(t("supervisor.errAmount"));
    if (!exp.categoryId) return toast.error(t("supervisor.errCategory"));
    if (!exp.cashboxId) return toast.error(t("supervisor.errCashbox"));
    if (expMode === "workorder" && !exp.linkedWorkOrderId) {
      return toast.error(isAr ? "اختر أمر العمل المرتبط بالمصروف" : "Select a work order to link this expense");
    }
    const cat = categories.find((c) => c.id === exp.categoryId);
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === exp.cashboxId);

    // ===== وضع التعديل (مسموح به مرة واحدة فقط) =====
    if (editingId) {
      const orig = expensesStore.getAll().find((e) => e.id === editingId);
      if (!orig) { setEditingId(null); return; }
      if (orig.edited) { toast.error(isAr ? "تم تعديل هذا السند مسبقاً" : "Already edited once"); return; }
      if (orig.refunded) { toast.error(isAr ? "السند مُسترجَع — لا يمكن تعديله" : "Refunded voucher can't be edited"); return; }
      // ضبط الأرصدة: أعد القديم ثم اخصم الجديد (قد تتغير الخزينة)
      const oldCb = employeeCashboxesStore.getAll().find((c) => c.id === orig.cashboxId);
      if (oldCb) employeeCashboxesStore.update(oldCb.id, { currentBalance: oldCb.currentBalance + orig.amount });
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
      expensesStore.update(editingId, {
        date: exp.date,
        amount: value,
        categoryId: exp.categoryId,
        categoryName: cat?.name,
        cashboxId: exp.cashboxId,
        cashboxName: cb?.cashboxName,
        paymentMethod: exp.paymentMethod,
        beneficiary: exp.beneficiary || exp.supplierCompany,
        description: exp.description,
        reference: exp.reference || undefined,
        photo: exp.photo,
        linkedWorkOrderId: exp.linkedWorkOrderId || undefined,
        linkedVehiclePlate: exp.linkedVehiclePlate || undefined,
        linkedVehicleName: exp.linkedVehicleName || undefined,
        supplierTaxNumber: exp.supplierTaxNumber || undefined,
        supplierInvoiceNumber: exp.supplierInvoiceNumber || undefined,
        edited: true,
      });
      toast.success(isAr ? "تم تعديل السند" : "Voucher updated");
      setEditingId(null);
      resetExpForm();
      return;
    }

    const number = voucherSettingsStore.generateNextNumber("payment");
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
    const record: ExpenseRecord = {
      id: `EXP-${Date.now()}`,
      voucherNumber: number,
      date: exp.date,
      amount: value,
      categoryId: exp.categoryId,
      categoryName: cat?.name,
      cashboxId: exp.cashboxId,
      cashboxName: cb?.cashboxName,
      paymentMethod: exp.paymentMethod,
      beneficiary: exp.beneficiary || exp.supplierCompany,
      description: exp.description,
      reference: exp.reference || undefined,
      photo: exp.photo,
      linkedWorkOrderId: exp.linkedWorkOrderId || undefined,
      linkedVehiclePlate: exp.linkedVehiclePlate || undefined,
      linkedVehicleName: exp.linkedVehicleName || undefined,
      supplierTaxNumber: exp.supplierTaxNumber || undefined,
      supplierInvoiceNumber: exp.supplierInvoiceNumber || undefined,
      createdAt: new Date().toISOString(),
    };
    expensesStore.add(record);
    toast.success(t("supervisor.saved", { n: number }));
    resetExpForm();
  };

  const allExpenses = expensesStore.getAll();
  const todaysExp = useMemo(() => allExpenses.filter((e) => e.date === today), [allExpenses, today]);
  const monthExp = useMemo(() => allExpenses.filter((e) => e.date.startsWith(today.slice(0, 7))), [allExpenses, today]);
  const recentExp = useMemo(
    () => allExpenses.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    [allExpenses]
  );

  const handleEditExp = (rec: ExpenseRecord) => {
    if (rec.edited) return toast.error(isAr ? "تم تعديل هذا السند مسبقاً" : "Already edited once");
    if (rec.refunded) return toast.error(isAr ? "السند مُسترجَع" : "Refunded voucher");
    setEditingId(rec.id);
    setExp({
      date: rec.date,
      amount: String(rec.amount),
      categoryId: rec.categoryId,
      cashboxId: rec.cashboxId,
      paymentMethod: rec.paymentMethod,
      beneficiary: rec.beneficiary || "",
      description: rec.description || "",
      reference: rec.reference || "",
      linkedWorkOrderId: rec.linkedWorkOrderId || "",
      linkedVehiclePlate: rec.linkedVehiclePlate || "",
      linkedVehicleName: rec.linkedVehicleName || "",
      photo: rec.photo || null,
      supplierCompany: "",
      supplierTaxNumber: rec.supplierTaxNumber || "",
      supplierInvoiceNumber: rec.supplierInvoiceNumber || "",
    });
    setTab("expense");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRefundExp = (rec: ExpenseRecord) => {
    if (rec.refunded) return toast.error(isAr ? "تم استرجاعه مسبقاً" : "Already refunded");
    if (!confirm(isAr ? `استرجاع المبلغ ${rec.amount} للخزينة؟` : `Refund ${rec.amount} to cashbox?`)) return;
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === rec.cashboxId);
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + rec.amount });
    expensesStore.update(rec.id, { refunded: true, refundedAt: new Date().toISOString() });
    toast.success(isAr ? "تم استرجاع المبلغ للخزينة" : "Refunded to cashbox");
  };


  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-warning/5 text-foreground" dir={dir}>
      {/* ====== Header ====== */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-warning/15 via-card to-primary/10 backdrop-blur-xl border-b border-border shadow-sm pt-safe">
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-warning to-orange-500 flex items-center justify-center shrink-0 shadow-lg shadow-warning/30">
            <ClipboardCheck className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold leading-tight truncate flex items-center gap-1.5">
              {isAr ? "تطبيق المشرف" : "Supervisor App"}
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-warning/40 text-warning gap-0.5">
                <ShieldCheck className="h-2.5 w-2.5" /> PRO
              </Badge>
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">{profile?.full_name || "—"}</p>
          </div>
          <LanguageSwitcher size="icon" showLabel={false} />
          <Button
            size="icon"
            variant="ghost"
            onClick={async () => {
              await refreshWorkOrdersFromCloud();
              force((n) => n + 1);
              toast.success(isAr ? "تم التحديث من السحابة" : "Synced from cloud");
            }}

            className="h-9 w-9"
            title={isAr ? "تحديث" : "Refresh"}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => signOut()} className="h-9 w-9">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-2 px-3 pb-3">
          <Card
            className="p-2 bg-card/60 border-warning/20 cursor-pointer hover:bg-warning/10 active:scale-[0.98] transition-all"
            onClick={() => { setKpiFilter("today"); setTab("vehicles"); }}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Car className="h-3 w-3" /> {isAr ? "سيارات اليوم" : "Today"}</div>
            <p className="text-base font-bold text-warning mt-0.5">{workOrders.filter((o) => o.entryDate === today).length}</p>
          </Card>
          <Card
            className="p-2 bg-card/60 border-primary/20 cursor-pointer hover:bg-primary/10 active:scale-[0.98] transition-all"
            onClick={() => { setKpiFilter("open"); setTab("vehicles"); }}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><FileText className="h-3 w-3" /> {isAr ? "إجمالي مفتوحة" : "Open"}</div>
            <p className="text-base font-bold text-primary mt-0.5">
              {workOrders.filter((o) => !["تم التسليم", "مغلق"].includes(o.status)).length}
            </p>
          </Card>
          <Card
            className="p-2 bg-card/60 border-sky-500/20 cursor-pointer hover:bg-sky-500/10 active:scale-[0.98] transition-all"
            onClick={() => { setKpiFilter("insurance"); setTab("vehicles"); }}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> {isAr ? "تأمين" : "Insurance"}</div>
            <p className="text-base font-bold text-sky-600 dark:text-sky-400 mt-0.5">
              {workOrders.filter(IS_INSURANCE).length}
            </p>
          </Card>
          <Card
            className="p-2 bg-card/60 border-destructive/20 cursor-pointer hover:bg-destructive/10 active:scale-[0.98] transition-all"
            onClick={() => setTab("expense")}
          >
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Wallet className="h-3 w-3" /> {isAr ? "سندات شهرياً" : "Monthly"}</div>
            <p className="text-base font-bold text-destructive mt-0.5">{monthExp.length}</p>
          </Card>
        </div>
      </header>

      <main className="px-3 py-3 pb-24">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-12 bg-card border border-border">
            <TabsTrigger value="vehicles" className="text-xs gap-1 data-[state=active]:bg-warning/15 data-[state=active]:text-warning">
              <Camera className="h-4 w-4" /> {isAr ? "السيارات" : "Vehicles"}
            </TabsTrigger>
            <TabsTrigger value="wo" className="text-xs gap-1 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
              <Plus className="h-4 w-4" /> {isAr ? "أمر عمل" : "New WO"}
            </TabsTrigger>
            <TabsTrigger value="expense" className="text-xs gap-1 data-[state=active]:bg-destructive/15 data-[state=active]:text-destructive">
              <Receipt className="h-4 w-4" /> {isAr ? "سند صرف" : "Voucher"}
            </TabsTrigger>
          </TabsList>

          {/* ====== TAB: Vehicles / Photo Upload ====== */}
          <TabsContent value="vehicles" className="mt-3 space-y-3">
            {/* فلاتر سريعة: الكل / تأمين / كاش (ورشة) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <Button
                size="sm" variant={kpiFilter === null ? "default" : "outline"}
                className="h-8 text-xs px-3 shrink-0"
                onClick={() => setKpiFilter(null)}
              >
                {isAr ? "الكل" : "All"}
                <span className="ms-1 opacity-70">({workOrders.filter(IN_WORKSHOP).length})</span>
              </Button>
              <Button
                size="sm" variant={kpiFilter === "insurance" ? "default" : "outline"}
                className="h-8 text-xs px-3 shrink-0"
                onClick={() => setKpiFilter("insurance")}
              >
                {isAr ? "سيارات التأمين" : "Insurance"}
                <span className="ms-1 opacity-70">
                  ({workOrders.filter((o) => IN_WORKSHOP(o) && IS_INSURANCE(o)).length})
                </span>
              </Button>
              <Button
                size="sm" variant={kpiFilter === "cash" ? "default" : "outline"}
                className="h-8 text-xs px-3 shrink-0"
                onClick={() => setKpiFilter("cash")}
              >
                {isAr ? "سيارات الورشة (كاش)" : "Workshop (Cash)"}
                <span className="ms-1 opacity-70">
                  ({workOrders.filter((o) => IN_WORKSHOP(o) && !IS_INSURANCE(o)).length})
                </span>
              </Button>
              {kpiFilter === "today" && (
                <Badge variant="secondary" className="h-7 px-2 gap-1 text-xs cursor-pointer shrink-0" onClick={() => setKpiFilter(null)}>
                  {isAr ? "سيارات اليوم" : "Today"} <span className="text-muted-foreground">×</span>
                </Badge>
              )}
            </div>
            <Card className="p-3 bg-card border-border">
              <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setKpiFilter(null); }}
                  placeholder={isAr ? "ابحث برقم اللوحة أو الأمر أو العميل…" : "Search by plate, order, customer…"}
                  className="h-11 ps-10"
                />
              </div>
            </Card>

            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] text-muted-foreground">
                {kpiFilter || search.trim()
                  ? (isAr ? `النتائج: ${filteredWO.length}` : `Results: ${filteredWO.length}`)
                  : (isAr ? `جميع أوامر العمل: ${filteredWO.length}` : `All work orders: ${filteredWO.length}`)}
              </p>
            </div>

            <div className="space-y-2">
              {filteredWO.length === 0 && (
                <Card className="p-6 text-center text-xs text-muted-foreground">
                  {isAr ? "لا توجد نتائج" : "No results"}
                </Card>
              )}
              {filteredWO.map((o) => {
                const photoCount = (o.photos || []).length;
                return (
                  <Card
                    key={o.id}
                    onClick={() => { setPhotoOrderId(o.id); setPhotoOpen(true); }}
                    className="p-3 bg-card border-border hover:border-warning/50 active:scale-[0.99] cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-warning/10 border border-warning/30 flex flex-col items-center justify-center shrink-0">
                        <Camera className="h-4 w-4 text-warning" />
                        <span className="text-[9px] font-bold text-warning mt-0.5">{photoCount}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-primary">{o.id}</span>
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">{o.status}</Badge>
                          {IS_INSURANCE(o) && (
                            <Badge className="h-4 px-1 text-[9px] gap-0.5 bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/15">
                              <ShieldCheck className="h-2.5 w-2.5" />
                              {hasVal(o.insurance) ? o.insurance : (isAr ? "تأمين" : "Insurance")}{hasVal(o.claimNumber) ? ` · ${o.claimNumber}` : ""}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-bold truncate mt-0.5">{o.plate} · {o.vehicleType} {o.model}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {o.customer} · {isAr ? "فني:" : "Tech:"} {o.technician || "—"}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPartsOrderId(o.id); setPartsOpen(true); }}
                        className="h-9 w-9 rounded-lg bg-info/10 hover:bg-info/20 border border-info/30 flex items-center justify-center shrink-0 relative"
                        title={isAr ? "قطع الغيار المطلوبة" : "Needed parts"}
                      >
                        <Package className="h-4 w-4 text-info" />
                        {(o.partsNeeded?.length || 0) > 0 && (
                          <span className="absolute -top-1 -end-1 h-4 min-w-4 px-1 rounded-full bg-info text-white text-[9px] font-bold flex items-center justify-center">
                            {o.partsNeeded!.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setQrOrderId(o.id); setQrOpen(true); }}
                        className="h-9 w-9 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0"
                        title={isAr ? "مشاركة رمز QR للتتبع" : "Share tracking QR"}
                      >
                        <QrCode className="h-4 w-4 text-primary" />
                      </button>
                      <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ====== TAB: New Work Order (no sensitive fields) ====== */}
          <TabsContent value="wo" className="mt-3">
            <Card className="p-3 bg-card border-border space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" /> {isAr ? "أمر عمل جديد" : "New Work Order"}
                </h2>
                <Badge variant="outline" className="text-[9px] gap-1">
                  <ShieldCheck className="h-2.5 w-2.5" /> {isAr ? "بدون بيانات مالية" : "No finance"}
                </Badge>
              </div>

              {/* AI auto-fill من بطاقة الملكية / الاستمارة */}
              <AiExtractButton
                schema="vehicle_customer"
                label={isAr ? "تعبئة تلقائية من بطاقة الملكية / استمارة" : "Auto-fill from registration card"}
                hint={isAr ? "صور البطاقة بالكاميرا أو ارفع صورة — سيتم تعبئة العميل والمركبة تلقائياً" : "Photo or upload — auto-fills customer & vehicle"}
                onExtracted={(d) => {
                  if (d.customer_name) setWoField("customer", d.customer_name);
                  if (d.customer_phone) setWoField("phone", d.customer_phone);
                  if (d.plate) setWoField("plate", d.plate);
                  if (d.make) setWoField("vehicleType", d.make);
                  if (d.model) setWoField("model", d.model);
                  if (d.year) setWoField("year", d.year);
                  if (d.color) setWoField("color", d.color);
                  if (d.vin) setWoField("vin", d.vin);
                  if (d.mileage) setWoField("mileage", String(d.mileage).replace(/[^\d]/g, ""));
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "اسم العميل *" : "Customer *"}</label>
                  <CustomerAutocomplete
                    value={wo.customer}
                    onChange={(v) => setWoField("customer", v)}
                    onSelect={(c) => {
                      setWoField("customer", c.name);
                      if (c.phone) setWoField("phone", c.phone);
                    }}
                    className="h-11 bg-background border-border text-foreground"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "الجوال" : "Phone"}</label>
                  <PhoneAutocomplete
                    value={wo.phone}
                    onChange={(v) => setWoField("phone", v)}
                    onSelect={(c) => {
                      setWoField("phone", c.phone);
                      if (c.name) setWoField("customer", c.name);
                    }}
                    className="h-11 bg-background border-border text-foreground"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "رقم اللوحة *" : "Plate *"}</label>
                  <Input value={wo.plate} onChange={(e) => setWoField("plate", e.target.value)} className="h-11 font-bold" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "رقم الشاصي VIN" : "VIN"}</label>
                  <div className="flex gap-2">
                    <Input value={wo.vin} onChange={(e) => setWoField("vin", e.target.value)} className="h-11 font-mono" dir="ltr" />
                    <VinScannerButton onResult={(r) => {
                      if (r.vin) setWoField("vin", r.vin);
                      if (r.year && !wo.year) setWoField("year", r.year);
                    }} />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "الماركة (اختياري)" : "Make (optional)"}</label>
                  <Input value={wo.vehicleType} onChange={(e) => setWoField("vehicleType", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "الموديل (اختياري)" : "Model (optional)"}</label>
                  <Input value={wo.model} onChange={(e) => setWoField("model", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "السنة" : "Year"}</label>
                  <Input inputMode="numeric" value={wo.year} onChange={(e) => setWoField("year", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "اللون" : "Color"}</label>
                  <Input value={wo.color} onChange={(e) => setWoField("color", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "العداد (كم)" : "Mileage (km)"}</label>
                  <Input inputMode="numeric" value={wo.mileage} onChange={(e) => setWoField("mileage", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{isAr ? "نوع الخدمة" : "Service"}</label>
                  <Select value={wo.serviceType} onValueChange={(v) => setWoField("serviceType", v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "الفني" : "Technician"}</label>
                  <Input value={wo.technician} onChange={(e) => setWoField("technician", e.target.value)} className="h-11" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "الحالة" : "Status"}</label>
                  <Select value={wo.status} onValueChange={(v) => setWoField("status", v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORK_ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* ===== Insurance toggle + fields ===== */}
                <div className="col-span-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={wo.isInsurance}
                      onChange={(e) => setWoField("isInsurance", e.target.checked)}
                      className="h-4 w-4 accent-sky-500"
                    />
                    <span className="text-[12px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {isAr ? "أمر عمل تأمين (مطالبة)" : "Insurance work order (claim)"}
                    </span>
                  </label>
                  {wo.isInsurance && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="col-span-2">
                        <label className="text-[11px] text-muted-foreground">{isAr ? "شركة التأمين *" : "Insurance company *"}</label>
                        <Input value={wo.insuranceCompany} onChange={(e) => setWoField("insuranceCompany", e.target.value)} className="h-11" placeholder={isAr ? "مثال: ظفار للتأمين" : "e.g. Dhofar Insurance"} />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{isAr ? "رقم المطالبة *" : "Claim no. *"}</label>
                        <Input value={wo.claimNumber} onChange={(e) => setWoField("claimNumber", e.target.value)} className="h-11 font-mono" dir="ltr" />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{isAr ? "رقم الوثيقة" : "Policy no."}</label>
                        <Input value={wo.policyNumber} onChange={(e) => setWoField("policyNumber", e.target.value)} className="h-11 font-mono" dir="ltr" />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{isAr ? "تاريخ الحادث" : "Incident date"}</label>
                        <Input type="date" value={wo.incidentDate} onChange={(e) => setWoField("incidentDate", e.target.value)} className="h-11" />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{isAr ? "مكان الحادث" : "Location"}</label>
                        <Input value={wo.incidentLocation} onChange={(e) => setWoField("incidentLocation", e.target.value)} className="h-11" />
                      </div>
                      <p className="col-span-2 text-[10px] text-sky-700/80 dark:text-sky-300/80">
                        {isAr
                          ? "سيتم إنشاء أمر العمل كنوع «حادث» وربطه ببيانات شركة التأمين تلقائياً."
                          : "Will be created as 'Accident' type and linked to the insurance company."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">{isAr ? "ملاحظات / وصف العطل" : "Notes / Description"}</label>
                    <AiWriteButton
                      value={wo.description}
                      onChange={(v) => setWoField("description", v)}
                      context={`أمر عمل جديد — العميل ${wo.customer || "—"} — اللوحة ${wo.plate || "—"} — ${wo.vehicleType || ""} ${wo.model || ""}`}
                      label={isAr ? "ذكاء" : "AI"}
                      language={isAr ? "ar" : "en"}
                      size="sm"
                    />
                  </div>
                  <Textarea value={wo.description} onChange={(e) => setWoField("description", e.target.value)} className="min-h-[70px]" />
                </div>
              </div>

              <Button onClick={handleCreateWO} className="w-full h-12 text-base font-bold bg-gradient-to-r from-primary to-blue-500">
                <Save className="h-4 w-4 mx-2" /> {isAr ? "إنشاء + رفع صور الاستلام" : "Create + Upload receipt photos"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                {isAr
                  ? "لا تُعرض التكاليف، الفواتير، الأرباح، أو بيانات التأمين في هذا التطبيق."
                  : "Costs, invoices, profits, and insurance data are not shown here."}
              </p>
            </Card>
          </TabsContent>

          {/* ====== TAB: Expense voucher (existing, refined) ====== */}
          <TabsContent value="expense" className="mt-3 space-y-3">
            <Card className="p-3 bg-card border-border space-y-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Save className="h-4 w-4 text-destructive" /> {isAr ? "سند صرف سريع" : "Quick voucher"}
              </h2>
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-2 col-span-1 bg-destructive/10 border-destructive/30">
                  <div className="text-[10px] text-destructive flex items-center gap-1"><TrendingDown className="h-3 w-3" /> {t("supervisor.today")}</div>
                  <p className="text-sm font-bold text-destructive mt-0.5">{fmt(todaysExp.reduce((s, e) => s + e.amount, 0))}</p>
                </Card>
                <Card className="p-2 col-span-1 bg-warning/10 border-warning/30">
                  <div className="text-[10px] text-warning flex items-center gap-1"><Receipt className="h-3 w-3" /> {t("supervisor.month")}</div>
                  <p className="text-sm font-bold text-warning mt-0.5">{fmt(monthExp.reduce((s, e) => s + e.amount, 0))}</p>
                </Card>
                <Card className="p-2 col-span-1 bg-primary/10 border-primary/30">
                  <div className="text-[10px] text-primary flex items-center gap-1"><Wallet className="h-3 w-3" /> {t("supervisor.count")}</div>
                  <p className="text-sm font-bold text-primary mt-0.5">{monthExp.length}</p>
                </Card>
              </div>

              {/* ====== اختيار نوع المصروف ====== */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setExpMode("workshop"); clearWO(); }}
                  className={`h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition active:scale-[0.98] ${
                    expMode === "workshop"
                      ? "bg-warning/15 border-warning text-warning"
                      : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold">
                    <Wallet className="h-4 w-4" />
                    {isAr ? "مصروف ورشة" : "Workshop expense"}
                  </div>
                  <span className="text-[10px] opacity-80">{isAr ? "اختر إلى أين ذهب المصروف" : "Pick the category"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpMode("workorder")}
                  className={`h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition active:scale-[0.98] ${
                    expMode === "workorder"
                      ? "bg-primary/15 border-primary text-primary"
                      : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold">
                    <Car className="h-4 w-4" />
                    {isAr ? "مصروف أمر عمل" : "Work order expense"}
                  </div>
                  <span className="text-[10px] opacity-80">{isAr ? "يشمل أوامر التأمين" : "Includes insurance WOs"}</span>
                </button>
              </div>


              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.amount")}</label>
                  <Input type="number" inputMode="decimal" value={exp.amount} onChange={(e) => setExpField("amount", e.target.value)} placeholder="0.000" className="h-12 text-lg font-bold text-center" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.category")}</label>
                  <Select value={exp.categoryId} onValueChange={(v) => setExpField("categoryId", v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.cashbox")}</label>
                  <Select value={exp.cashboxId} onValueChange={(v) => setExpField("cashboxId", v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{cashboxes.map((c) => <SelectItem key={c.id} value={c.id}>{c.cashboxName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.method")}</label>
                  <Select value={exp.paymentMethod} onValueChange={(v) => setExpField("paymentMethod", v as PaymentMethod)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t("supervisor.pmCash")}</SelectItem>
                      <SelectItem value="bank_transfer">{t("supervisor.pmBank")}</SelectItem>
                      <SelectItem value="cheque">{t("supervisor.pmCheque")}</SelectItem>
                      <SelectItem value="card">{t("supervisor.pmCard")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.date")}</label>
                  <Input type="date" value={exp.date} onChange={(e) => setExpField("date", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t("supervisor.beneficiary")}</label>
                  <Input value={exp.beneficiary} onChange={(e) => setExpField("beneficiary", e.target.value)} className="h-11" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">{isAr ? "المرجع (رقم فاتورة/شيك/تحويل)" : "Reference (invoice/cheque/ref #)"}</label>
                  <Input value={exp.reference} onChange={(e) => setExpField("reference", e.target.value)} className="h-11" placeholder={isAr ? "اختياري" : "Optional"} />
                </div>

                {/* ===== بيانات الفاتورة الضريبية للمورد ===== */}
                <div className="col-span-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                    🧾 {isAr ? "بيانات ضريبية للمورد (للتقرير الضريبي)" : "Supplier tax info (for tax report)"}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <Input
                      value={exp.supplierCompany}
                      onChange={(e) => setExpField("supplierCompany", e.target.value)}
                      className="h-10 text-sm"
                      placeholder={isAr ? "اسم الشركة / المورد" : "Supplier company"}
                    />
                    <Input
                      value={exp.supplierTaxNumber}
                      onChange={(e) => setExpField("supplierTaxNumber", e.target.value)}
                      className="h-10 text-sm"
                      placeholder={isAr ? "الرقم الضريبي للمورد (OM...)" : "Supplier VAT number"}
                    />
                    <Input
                      value={exp.supplierInvoiceNumber}
                      onChange={(e) => setExpField("supplierInvoiceNumber", e.target.value)}
                      className="h-10 text-sm"
                      placeholder={isAr ? "رقم فاتورة المورد" : "Supplier invoice #"}
                    />
                  </div>
                </div>

                <div className="col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">{t("supervisor.description")}</label>
                    <AiWriteButton
                      value={exp.description}
                      onChange={(v) => setExpField("description", v)}
                      context={`سند صرف — مبلغ ${exp.amount || 0} — مستفيد ${exp.beneficiary || "—"}`}
                      label={isAr ? "ذكاء" : "AI"}
                      language={isAr ? "ar" : "en"}
                      size="sm"
                    />
                  </div>
                  <Textarea value={exp.description} onChange={(e) => setExpField("description", e.target.value)} className="min-h-[60px]" />
                </div>
                <div className="col-span-2">
                  <AiExtractButton
                    schema="expense_receipt"
                    label={isAr ? "استخراج بيانات الإيصال بالذكاء" : "Extract receipt via AI"}
                    hint={isAr ? "صور/ارفع الإيصال — سيتم تعبئة المبلغ والتاريخ والمورد والمرجع تلقائياً" : "Photograph or upload the receipt to auto-fill"}
                    onExtracted={(d) => {
                      if (d.total) setExpField("amount", String(d.total).replace(/[^\d.]/g, ""));
                      if (d.date) setExpField("date", d.date);
                      if (d.vendor) { setExpField("beneficiary", d.vendor); setExpField("supplierCompany", d.vendor); }
                      if (d.invoice_number) { setExpField("reference", d.invoice_number); setExpField("supplierInvoiceNumber", d.invoice_number); }
                      if ((d as any).tax_number || (d as any).vat_number) setExpField("supplierTaxNumber", String((d as any).tax_number || (d as any).vat_number));
                      if (d.notes || d.category) setExpField("description", [d.category, d.notes].filter(Boolean).join(" — "));
                    }}
                  />
                </div>

                {/* ====== صورة الإيصال (اختياري) ====== */}
                <div className="col-span-2 rounded-xl border border-dashed border-border bg-muted/30 p-2.5 space-y-2">
                  <label className="text-[11px] font-semibold flex items-center gap-1">
                    <Camera className="h-3.5 w-3.5 text-destructive" />
                    {isAr ? "صورة الإيصال (اختياري)" : "Receipt photo (optional)"}
                  </label>
                  {exp.photo ? (
                    <div className="relative">
                      <img src={exp.photo} alt="receipt" className="w-full max-h-56 object-contain rounded-lg border border-border bg-card" />
                      <button
                        type="button"
                        onClick={() => setExpField("photo", null)}
                        className="absolute top-1 end-1 h-7 w-7 rounded-full bg-destructive text-destructive-foreground text-xs font-bold shadow-lg"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="h-11 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer active:scale-[0.98] transition">
                        <Camera className="h-4 w-4" />
                        {isAr ? "التقاط" : "Capture"}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setExpField("photo", String(r.result));
                            r.readAsDataURL(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label className="h-11 rounded-lg bg-card border border-border flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer active:scale-[0.98] transition">
                        <ImageIcon className="h-4 w-4" />
                        {isAr ? "من المعرض" : "Gallery"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = () => setExpField("photo", String(r.result));
                            r.readAsDataURL(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>


                {/* ====== ربط بأمر عمل برقم اللوحة (يظهر فقط في وضع مصروف أمر عمل) ====== */}
                {expMode === "workorder" && (
                <div className={`col-span-2 rounded-xl border p-2.5 space-y-2 ${linkedWO ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-primary flex items-center gap-1">
                      <Car className="h-3.5 w-3.5" />
                      {isAr ? "ربط بأمر عمل (إلزامي)" : "Link to work order (required)"}
                    </label>
                    {linkedWO && (
                      <button onClick={clearWO} className="text-[10px] text-destructive hover:underline">
                        {isAr ? "إلغاء الربط" : "Unlink"}
                      </button>
                    )}
                  </div>

                  {linkedWO ? (
                    <div className="rounded-lg bg-card border border-primary/40 p-2 flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        {isInsuranceWO(linkedWO) ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Car className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-primary">{linkedWO.id}</span>
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">{linkedWO.status}</Badge>
                          {isInsuranceWO(linkedWO) && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5 border-primary/40 text-primary">
                              <ShieldCheck className="h-2.5 w-2.5" />
                              {linkedWO.insurance}{linkedWO.claimNumber && linkedWO.claimNumber !== "-" ? ` · ${linkedWO.claimNumber}` : ""}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-bold truncate">{linkedWO.plate} · {linkedWO.vehicleType} {linkedWO.model}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{linkedWO.customer}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            value={woSearch}
                            onChange={(e) => setWoSearch(e.target.value)}
                            placeholder={isAr ? "ابحث برقم اللوحة / الأمر / المطالبة…" : "Plate / order / claim #…"}
                            className="h-10 ps-9 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setWoInsuranceOnly((v) => !v)}
                          className={`h-10 px-2.5 rounded-lg border text-[10px] font-semibold flex items-center gap-1 shrink-0 transition ${
                            woInsuranceOnly ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                          }`}
                          aria-pressed={woInsuranceOnly}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {isAr ? "تأمين" : "Insurance"}
                        </button>
                      </div>
                      {woMatches.length > 0 && (
                        <div className="space-y-1 max-h-48 overflow-auto">
                          {woMatches.map((o) => {
                            const ins = isInsuranceWO(o);
                            return (
                              <button
                                key={o.id}
                                type="button"
                                onClick={() => pickWO(o)}
                                className={`w-full text-start p-2 rounded-lg bg-card border ${ins ? "border-primary/40" : "border-border"} hover:border-primary/50 active:scale-[0.99] transition-all`}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-[10px] text-primary">{o.id}</span>
                                  <Badge variant="outline" className="h-4 px-1 text-[9px]">{o.status}</Badge>
                                  {ins && (
                                    <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5 border-primary/40 text-primary">
                                      <ShieldCheck className="h-2.5 w-2.5" />
                                      {o.insurance}{o.claimNumber && o.claimNumber !== "-" ? ` · ${o.claimNumber}` : ""}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs font-bold truncate">{o.plate} · {o.vehicleType} {o.model}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{o.customer}</p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {(woSearch.trim() || woInsuranceOnly) && woMatches.length === 0 && (
                        <p className="text-[10px] text-muted-foreground text-center py-1">
                          {isAr ? "لا توجد نتائج" : "No results"}
                        </p>
                      )}
                    </>
                  )}
                </div>
                )}
              </div>

              <div className="flex gap-2">
                {editingId && (
                  <Button
                    variant="outline"
                    onClick={() => { setEditingId(null); resetExpForm(); }}
                    className="h-12 px-4"
                  >
                    {isAr ? "إلغاء" : "Cancel"}
                  </Button>
                )}
                <Button onClick={handleSaveExpense} className="flex-1 h-12 text-base font-bold">
                  <Save className="h-4 w-4 mx-2" />
                  {editingId ? (isAr ? "حفظ التعديل" : "Save changes") : t("supervisor.save")}
                </Button>
              </div>
            </Card>

            <Card className="p-3 bg-card border-border">
              <h2 className="text-sm font-bold mb-2">{t("supervisor.recent")}</h2>
              {recentExp.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">{t("supervisor.empty")}</p>
              ) : (
                <div className="space-y-2">
                  {recentExp.map((r) => (
                    <div key={r.id} className={`p-2.5 rounded-lg border ${r.refunded ? "border-success/40 bg-success/5 opacity-75" : "border-border bg-secondary/30"} flex items-start gap-3`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-primary">{r.voucherNumber}</span>
                          <span className="text-[10px] text-muted-foreground">{r.date}</span>
                          {r.linkedWorkOrderId && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5 border-primary/40 text-primary">
                              <Car className="h-2.5 w-2.5" />
                              {r.linkedVehiclePlate || r.linkedWorkOrderId}
                            </Badge>
                          )}
                          {r.edited && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] border-warning/40 text-warning">
                              {isAr ? "معدّل" : "Edited"}
                            </Badge>
                          )}
                          {r.refunded && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px] border-success/40 text-success">
                              {isAr ? "مُسترجَع" : "Refunded"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-semibold truncate mt-0.5">{r.categoryName || "—"} {r.beneficiary ? `· ${r.beneficiary}` : ""}</p>
                        {r.reference && <p className="text-[10px] text-muted-foreground truncate">#{r.reference}</p>}
                        {r.description && <p className="text-[11px] text-muted-foreground truncate">{r.description}</p>}
                      </div>
                      <div className="text-end shrink-0 flex flex-col items-end gap-1">
                        <p className={`text-sm font-bold ${r.refunded ? "text-success line-through" : "text-destructive"}`}>{fmt(r.amount)}</p>
                        {!r.refunded && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleEditExp(r)}
                              disabled={!!r.edited}
                              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                              title={r.edited ? (isAr ? "تم التعديل مرة" : "Already edited") : ""}
                            >
                              <FileText className="h-3 w-3" /> {isAr ? "تعديل" : "Edit"}
                            </button>
                            <span className="text-muted-foreground">·</span>
                            <button
                              onClick={() => handleRefundExp(r)}
                              className="text-[10px] text-success hover:underline inline-flex items-center gap-0.5"
                            >
                              <Wallet className="h-3 w-3" /> {isAr ? "إرجاع" : "Refund"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Stage photos dialog (reused from main app) */}
      <StagePhotosDialog
        orderId={photoOrderId}
        open={photoOpen}
        onClose={() => { setPhotoOpen(false); setPhotoOrderId(null); }}
      />

      {/* QR label / customer tracking link */}
      <QrLabel
        order={qrOrderId ? (workOrders.find((o) => o.id === qrOrderId) || null) : null}
        open={qrOpen}
        onClose={() => { setQrOpen(false); setQrOrderId(null); }}
      />

      {/* Needed parts manager dialog */}
      <ResponsiveDialog
        open={partsOpen}
        onOpenChange={(v) => { setPartsOpen(v); if (!v) setPartsOrderId(null); }}
        className="max-w-3xl"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isAr ? "قطع الغيار المطلوبة" : "Needed parts"}
            {partsOrder && <span className="text-xs text-muted-foreground font-normal block mt-1">{partsOrder.id} · {partsOrder.plate}</span>}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {partsOrder && (
          <div className="mt-3">
            <NeededPartsManager
              order={partsOrder}
              allowEdit={true}
              onPrintRequest={() => handlePrintPartsRequest(partsOrder)}
              onSendWhatsApp={() => handleWhatsAppParts(partsOrder)}
              onSendToSuppliers={() => handleWhatsAppParts(partsOrder)}
            />
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}
