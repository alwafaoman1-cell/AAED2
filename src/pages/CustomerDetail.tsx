import { useEffect, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight, ChevronLeft, ChevronRight, User, Phone, Mail, MapPin, Edit,
  MessageCircle, Plus, Car, ClipboardList, Receipt, Shield, FileText,
  Sparkles, DollarSign, Calendar, Wallet, Copy, FileDown,
  FileMinus, FileSpreadsheet, MoreHorizontal, Activity,
  Trash2, Pencil, BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

import StatCard from "@/components/StatCard";
import CustomerFormDialog from "@/components/customers/CustomerFormDialog";
import VehicleQuickFormDialog from "@/components/customers/VehicleQuickFormDialog";
import DepositFormDialog from "@/components/customers/DepositFormDialog";
import QuickQuoteDialog from "@/components/customers/QuickQuoteDialog";
import CreditNoteFormDialog from "@/components/customers/CreditNoteFormDialog";
import AppointmentFormDialog from "@/components/customers/AppointmentFormDialog";
import SmsDialog from "@/components/customers/SmsDialog";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { archiveCustomer } from "@/lib/deletePolicy";

import { customersStore } from "@/lib/customersStore";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import {
  depositsStore, getCustomerDepositBalance, type DepositRecord,
} from "@/lib/depositsStore";
import { getDepositReceiptHtml } from "@/lib/pdfGenerator";
import { PAYMENT_METHOD_LABELS } from "@/lib/financeSettingsStore";
import {
  creditNotesStore, getCustomerCreditNotes, getCustomerCreditBalance,
  type CreditNote,
} from "@/lib/creditNotesStore";
import {
  appointmentsStore, getCustomerAppointments, type Appointment,
} from "@/lib/appointmentsStore";
import { getCustomerLedger } from "@/lib/customerLedger";
import { auditLogStore } from "@/lib/auditLogStore";
import { getAccountStatementHtml } from "@/lib/accountStatementPdf";
import { canEdit, canDelete } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";

const TAG_LABEL = { vip: "VIP", regular: "عادي", new: "جديد" } as const;
const TAG_STYLE = {
  vip: "bg-primary/15 text-primary border-primary/30",
  regular: "bg-info/15 text-info border-info/30",
  new: "bg-success/15 text-success border-success/30",
} as const;

function normalize(s: string) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function initials(name: string) {
  return (name || "؟").trim().charAt(0);
}

const AVATAR_COLORS = [
  "bg-rose-500", "bg-pink-500", "bg-fuchsia-500", "bg-purple-500",
  "bg-indigo-500", "bg-blue-500", "bg-cyan-500", "bg-teal-500",
  "bg-emerald-500", "bg-amber-500", "bg-orange-500", "bg-red-500",
];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);

  // dialogs
  const [editOpen, setEditOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState<DepositRecord | null>(null);
  const [depositPreviewHtml, setDepositPreviewHtml] = useState("");
  const [depositPreviewOpen, setDepositPreviewOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [editingCredit, setEditingCredit] = useState<CreditNote | null>(null);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [deleteCustomer, setDeleteCustomer] = useState(false);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);

  const [notes, setNotes] = useState("");
  const allowEdit = canEdit();
  const allowDelete = canDelete();

  useEffect(() => customersStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => depositsStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => creditNotesStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => appointmentsStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => auditLogStore.subscribe(() => setTick((t) => t + 1)), []);

  const allCustomers = useMemo(() => customersStore.getAll(), [tick]);
  const customer = useMemo(() => (id ? customersStore.getById(id) : undefined), [id, tick]);
  const customerIndex = useMemo(
    () => allCustomers.findIndex((c) => c.id === id),
    [allCustomers, id]
  );

  const customerName = customer?.name || "";
  const k = useMemo(() => normalize(customerName), [customerName]);

  const orders = useMemo(
    () => getWorkOrders().filter((o) => normalize(o.customer) === k)
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [k, tick]
  );
  const vehicles = useMemo(() => {
    const registered = vehiclesStore.getAll().filter((v) => normalize(v.owner) === k);
    const map = new Map<string, any>();
    registered.forEach((v) => { if (v.plate) map.set(v.plate, v); });
    // استخراج السيارات من أوامر العمل وتسجيلها إن لم تكن موجودة
    orders.forEach((o) => {
      if (!o.plate) return;
      if (!map.has(o.plate)) {
        map.set(o.plate, {
          id: o.plate,
          plate: o.plate,
          type: `${o.vehicleType || ""} ${o.model || ""}`.trim() || "-",
          vin: o.vin || "",
          owner: customerName,
          ownerPhone: o.phone || "",
          year: o.year || "",
          color: o.color || "",
          mileage: o.mileage || "",
          visits: 0,
          lastVisit: o.entryDate,
          totalSpent: 0,
          fromWorkOrder: true,
        });
      }
    });
    return Array.from(map.values());
  }, [k, orders, customerName, tick]);
  const claims = useMemo(
    () => orders.filter((o) => o.claimNumber && o.claimNumber !== "-"),
    [orders]
  );
  const stats = useMemo(
    () => customer ? customersStore.getStats(customer) : { visits: 0, totalSpent: 0, vehiclesCount: 0, pendingInvoices: 0 },
    [customer, tick]
  );

  const depositBalance = useMemo(() => getCustomerDepositBalance(customerName), [customerName, tick]);
  const customerDeposits = useMemo(
    () => depositsStore.getAll().filter((d) => normalize(d.customer) === k).sort((a, b) => b.date.localeCompare(a.date)),
    [k, tick]
  );

  const creditNotes = useMemo(() => getCustomerCreditNotes(customerName), [customerName, tick]);
  const creditBalance = useMemo(() => getCustomerCreditBalance(customerName), [customerName, tick]);
  const appointments = useMemo(() => getCustomerAppointments(customerName), [customerName, tick]);
  const ledger = useMemo(() => getCustomerLedger(customerName), [customerName, tick]);

  const auditEntries = useMemo(
    () => auditLogStore.getAll().filter(
      (a) => (a.label || "").toLowerCase().includes(k) || (a.description || "").toLowerCase().includes(k)
    ).slice(0, 50),
    [k, tick]
  );

  useEffect(() => {
    if (customer) setNotes(customer.notes || "");
  }, [customer?.id]);

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center" dir="rtl">
        <User size={48} className="text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">العميل غير موجود</h2>
        <Button onClick={() => smartBack(navigate, "/customers")} variant="outline">العودة لقائمة العملاء</Button>
      </div>
    );
  }


  // ====== actions ======
  async function whatsapp() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    try {
      await sendWhatsAppMessage({ message: `مرحباً ${customer.name}، نتواصل معك من ورشة الوفاء.`, phone: customer.phone, recipientName: customer.name, recipientType: "customer" });
      toast.success("تم إرسال الرسالة");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }
  function callPhone() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    window.location.href = `tel:${customer.phone.replace(/\s/g, "")}`;
  }
  function copyPhone() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    navigator.clipboard.writeText(customer.phone);
    toast.success("تم نسخ رقم الجوال");
  }
  function newWorkOrder() {
    navigate("/work-orders", { state: { prefillCustomer: customer.name, prefillPhone: customer.phone } });
  }
  function newInvoice() {
    navigate("/sales", { state: { prefillCustomer: customer.name, mode: "invoice" } });
  }
  function newQuote() { setQuoteOpen(true); }
  function newDeposit() { setDepositOpen(true); }
  function newCreditNote() { setEditingCredit(null); setCreditOpen(true); }
  function newAppointment() { setEditingAppointment(null); setAppointmentOpen(true); }
  function openStatement() { setStatementOpen(true); }

  async function saveNotes() {
    try {
      await customersStore.updateAsync(customer.id, { notes, lastContactAt: new Date().toISOString() });
      toast.success("تم حفظ الملاحظات");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ الملاحظات في Supabase");
    }
  }

  function gotoCustomer(offset: number) {
    const next = allCustomers[customerIndex + offset];
    if (!next) return;
    navigate(`/customers/${next.id}`);
  }

  function deleteCreditNote(c: CreditNote) {
    creditNotesStore.remove(c.id);
    logActivity({
      action: "delete", entity: "invoice", entityId: c.number,
      label: `إشعار دائن ${c.number}`, amount: c.amount,
    });
    toast.success("تم حذف الإشعار الدائن");
  }
  function deleteAppointment(a: Appointment) {
    appointmentsStore.remove(a.id);
    toast.success("تم حذف الموعد");
  }
  async function confirmDeleteCustomer() {
    try {
      await archiveCustomer(customer.id, "Archive Customer Only");
    } catch (error: any) {
      toast.error(error?.message || "فشل حذف/أرشفة العميل في Supabase");
      return;
    }
    customersStore.remove(customer.id);
    logActivity({
      action: "delete", entity: "customer", entityId: customer.id,
      label: customer.name,
    });
    toast.success("تم حذف العميل");
    navigate("/customers");
  }

  function printDeposit(d: DepositRecord) {
    const html = getDepositReceiptHtml({
      receiptNumber: d.receiptNumber,
      date: d.date,
      customerName: d.customer,
      customerPhone: d.customerPhone,
      plateNumber: d.plate,
      amount: d.amount,
      paymentMethod: PAYMENT_METHOD_LABELS[d.paymentMethod],
      scope: d.scope,
      notes: d.notes,
    });
    setDepositPreviewHtml(html);
    setDepositPreviewOpen(true);
  }

  async function whatsappPdfBlob(html: string, fileName: string, msg: string) {
    try {
      const { generatePdfFromHtml } = await import("@/lib/htmlToPdf");
      const blob = await generatePdfFromHtml({ htmlContent: html, fileName: fileName.replace(/\.pdf$/i, "") });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await sendWhatsAppMessage({ message: msg, phone: customer.phone, recipientName: customer.name, recipientType: "customer" });
      toast.success("تم تنزيل الملف وإرسال الرسالة عبر واتساب");
    } catch (e: any) {
      toast.error(e?.message || "تعذّر إنشاء الملف");
    }
  }

  function whatsappDeposit(d: DepositRecord) {
    const html = getDepositReceiptHtml({
      receiptNumber: d.receiptNumber, date: d.date,
      customerName: d.customer, customerPhone: d.customerPhone,
      plateNumber: d.plate, amount: d.amount,
      paymentMethod: PAYMENT_METHOD_LABELS[d.paymentMethod],
      scope: d.scope, notes: d.notes,
    });
    whatsappPdfBlob(html, `receipt-${d.receiptNumber}.pdf`,
      `سند قبض رقم ${d.receiptNumber} بمبلغ ${d.amount.toFixed(3)} ر.ع`);
  }

  function whatsappStatement() {
    const html = getAccountStatementHtml(customer, ledger);
    whatsappPdfBlob(html, `statement-${customer.id}.pdf`,
      `كشف حساب العميل ${customer.name}`);
  }

  function editInvoice(orderId: string) {
    navigate(`/work-orders/${encodeURIComponent(orderId)}`);
  }

  function deleteDeposit(d: DepositRecord) {
    if (!confirm(`حذف الدفعة ${d.receiptNumber}؟`)) return;
    depositsStore.remove(d.id);
    logActivity({
      action: "delete", entity: "receipt", entityId: d.receiptNumber,
      label: `دفعة ${d.receiptNumber}`, amount: d.amount,
    });
    toast.success("تم حذف الدفعة");
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <button onClick={() => smartBack(navigate, "/customers")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowRight size={13} /> العملاء / {customer.name}
        </button>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7"
            disabled={customerIndex <= 0}
            onClick={() => gotoCustomer(-1)} title="العميل السابق">
            <ChevronRight size={14} />
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7"
            disabled={customerIndex >= allCustomers.length - 1}
            onClick={() => gotoCustomer(1)} title="العميل التالي">
            <ChevronLeft size={14} />
          </Button>
        </div>
      </div>

      {/* Header bar (status + nav) */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{customer.name}</h1>
            <span className="text-xs font-mono text-muted-foreground">#{customer.id.slice(-4)}</span>
            <Badge className={`text-[10px] border ${TAG_STYLE[customer.tag]}`}>
              {customer.tag === "vip" && <Sparkles size={9} className="ml-0.5" />}
              {TAG_LABEL[customer.tag]}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
              <BadgeCheck size={10} /> نشط
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gradient-gold text-primary-foreground gap-1 h-8">
                  <Plus size={13} /> إضافة
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-50">
                <DropdownMenuItem onClick={newWorkOrder}><ClipboardList size={13} className="ml-2" />أمر عمل جديد</DropdownMenuItem>
                <DropdownMenuItem onClick={newInvoice}><Receipt size={13} className="ml-2" />فاتورة جديدة</DropdownMenuItem>
                <DropdownMenuItem onClick={newQuote}><FileSpreadsheet size={13} className="ml-2" />عرض سعر</DropdownMenuItem>
                <DropdownMenuItem onClick={newDeposit}><Wallet size={13} className="ml-2" />تسجيل دفعة</DropdownMenuItem>
                <DropdownMenuItem onClick={newCreditNote}><FileMinus size={13} className="ml-2" />إشعار دائن</DropdownMenuItem>
                <DropdownMenuItem onClick={newAppointment}><Calendar size={13} className="ml-2" />ترتيب موعد</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {allowDelete && (
              <Button size="sm" variant="outline" className="gap-1 h-8 text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteCustomer(true)}>
                <Trash2 size={13} /> حذف
              </Button>
            )}
          </div>
        </div>

        {/* Profile Card */}
        <div className="flex flex-col md:flex-row items-start gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`w-20 h-20 rounded-xl ${avatarColor(customer.name)} flex items-center justify-center shrink-0 text-white text-3xl font-bold relative`}>
              {initials(customer.name)}
              <button onClick={() => setEditOpen(true)}
                className="absolute -bottom-1 -left-1 w-6 h-6 rounded bg-info text-info-foreground flex items-center justify-center hover:scale-110 transition-transform">
                <Edit size={11} />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-foreground truncate">{customer.name}</h2>
              {customer.phone && (
                <div className="inline-flex items-center gap-1 mt-2 bg-secondary/50 border border-border rounded-md px-2 py-1" dir="ltr">
                  <button onClick={callPhone} className="text-primary hover:scale-110 transition-transform">
                    <Phone size={12} />
                  </button>
                  <span className="text-xs font-mono text-foreground mx-1">{customer.phone}</span>
                  <button onClick={copyPhone} className="text-muted-foreground hover:text-foreground">
                    <Copy size={11} />
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground mt-2">
                {customer.email && <span className="inline-flex items-center gap-1" dir="ltr"><Mail size={10} /> {customer.email}</span>}
                {customer.address && <span className="inline-flex items-center gap-1"><MapPin size={10} /> {customer.address}</span>}
                <span className="inline-flex items-center gap-1"><Calendar size={10} /> منذ {new Date(customer.createdAt).toLocaleDateString("ar")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Toolbar - 10 buttons */}
        <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-1.5">
          {allowEdit && (
            <ToolbarBtn icon={Pencil} label="تعديل" onClick={() => setEditOpen(true)} />
          )}
          <ToolbarBtn icon={MessageCircle} label="أرسل SMS" onClick={() => setSmsOpen(true)} />
          <ToolbarBtn icon={Calendar} label="ترتيب موعد" onClick={newAppointment} />
          <ToolbarBtn icon={FileText} label="إضافة ملاحظة" onClick={() => {
            const tabs = document.querySelector('[data-tab-trigger="notes"]') as HTMLElement | null;
            tabs?.click();
            setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 100);
          }} />
          <ToolbarBtn icon={Receipt} label="إنشاء فاتورة" onClick={newInvoice} />
          <ToolbarBtn icon={FileSpreadsheet} label="إنشاء عرض سعر" onClick={newQuote} />
          <ToolbarBtn icon={FileMinus} label="إنشاء إشعار دائن" onClick={newCreditNote} />
          <ToolbarBtn icon={FileDown} label="كشف حساب" onClick={openStatement} />
          <ToolbarBtn icon={Wallet} label="رصيد مدفوعات" onClick={newDeposit} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-secondary/60 border border-border text-xs hover:bg-secondary hover:border-primary/40 transition-colors">
                <MoreHorizontal size={12} /> خيارات أخرى
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-50">
              <DropdownMenuItem onClick={whatsapp}><MessageCircle size={13} className="ml-2" />إرسال WhatsApp</DropdownMenuItem>
              <DropdownMenuItem onClick={callPhone}><Phone size={13} className="ml-2" />اتصال هاتفي</DropdownMenuItem>
              <DropdownMenuItem onClick={copyPhone}><Copy size={13} className="ml-2" />نسخ رقم الجوال</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(`/customers/${customer.id}#audit`)}>
                <Activity size={13} className="ml-2" />سجل النشاط
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard title="السيارات" value={stats.vehiclesCount} icon={Car} variant="info" />
        <StatCard title="أوامر العمل" value={stats.visits} icon={ClipboardList} variant="gold" />
        <StatCard title="إجمالي الإنفاق" value={`${stats.totalSpent.toLocaleString()} ر.ع`} icon={DollarSign} variant="success" />
        <StatCard title="فواتير معلقة" value={stats.pendingInvoices} icon={FileText} variant="warning" />
        <StatCard title="رصيد الدفعات" value={`${depositBalance.toLocaleString()} ر.ع`} icon={Wallet} variant="info" />
        <StatCard title="رصيد دائن" value={`${creditBalance.toLocaleString()} ر.ع`} icon={FileMinus} variant="success" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="w-full">
        <TabsList className="bg-secondary border border-border flex-wrap h-auto">
          <TabsTrigger value="details" className="gap-1 data-[state=active]:bg-card"><User size={13} /> التفاصيل</TabsTrigger>
          <TabsTrigger value="statement" className="gap-1 data-[state=active]:bg-card"><FileDown size={13} /> كشف حساب مفصّل</TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1 data-[state=active]:bg-card"><Receipt size={13} /> الفواتير ({orders.length})</TabsTrigger>
          <TabsTrigger value="payments" className="gap-1 data-[state=active]:bg-card"><Wallet size={13} /> المدفوعات ({customerDeposits.length})</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1 data-[state=active]:bg-card"><FileSpreadsheet size={13} /> حركة الحساب ({ledger.entries.length})</TabsTrigger>
          <TabsTrigger value="credits" className="gap-1 data-[state=active]:bg-card"><FileMinus size={13} /> إشعارات دائنة ({creditNotes.length})</TabsTrigger>
          <TabsTrigger value="appointments" className="gap-1 data-[state=active]:bg-card"><Calendar size={13} /> المواعيد ({appointments.length})</TabsTrigger>
          <TabsTrigger value="vehicles" className="gap-1 data-[state=active]:bg-card"><Car size={13} /> السيارات ({vehicles.length})</TabsTrigger>
          <TabsTrigger value="claims" className="gap-1 data-[state=active]:bg-card"><Shield size={13} /> المطالبات ({claims.length})</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1 data-[state=active]:bg-card"><Activity size={13} /> الجدول الزمني</TabsTrigger>
          <TabsTrigger value="notes" data-tab-trigger="notes" className="gap-1 data-[state=active]:bg-card"><FileText size={13} /> ملاحظات</TabsTrigger>
        </TabsList>

        {/* === DETAILS === */}
        <TabsContent value="details" className="mt-4 space-y-4">
          <SectionHeader title="بيانات العميل" />
          <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Field label="رمز الدولة" value="OM" />
            <Field label="باركود" value={customer.id.replace(/[^0-9]/g, "").padStart(13, "0").slice(-13)} mono />
            <Field label="رقم الهوية" value={customer.idNumber || "-"} />
            <Field label="تاريخ التسجيل" value={new Date(customer.createdAt).toLocaleDateString("ar")} />
          </div>

          <div className="flex items-center justify-between">
            <SectionHeader title="بيانات سيارات العميل" />
            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"
              onClick={() => setVehicleFormOpen(true)}>
              <Plus size={12} /> إضافة سيارة
            </Button>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            {vehicles.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">لا توجد سيارات مسجلة</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map((v) => (
                  <Link key={v.id} to={`/vehicles/${encodeURIComponent(v.plate)}`}
                    className="bg-secondary/30 border border-border rounded-lg p-3 hover:border-primary/40 transition-all">
                    <div className="flex items-center gap-2 mb-1">
                      <Car size={14} className="text-primary" />
                      <span className="text-sm font-bold text-foreground">{v.plate}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      <div>الماركة: {v.type || "-"}</div>
                      <div>الموديل: {(v as any).model || "-"}</div>
                      <div>سنة الصنع: {(v as any).year || "-"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <SectionHeader title="معلومات سريعة" />
          <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <QuickInfo label="عدد الفواتير" value={`${ledger.invoicesCount} (عرض)`} />
            <QuickInfo label="آخر فاتورة منشأة"
              value={ledger.lastInvoice
                ? `#${ledger.lastInvoice.id} ${ledger.lastInvoice.amount.toFixed(3)} ر.ع`
                : "-"} />
            <QuickInfo label="عدد الفواتير المستحقة"
              value={ledger.outstanding > 0
                ? `${stats.pendingInvoices} | ${ledger.outstanding.toFixed(3)} ر.ع`
                : "لا توجد فواتير مستحقة الدفع"} />
            <QuickInfo label="آخر عملية دفع"
              value={ledger.lastPayment
                ? `#${ledger.lastPayment.id} ${ledger.lastPayment.amount.toFixed(3)} ر.ع`
                : "-"} />
          </div>

          <SectionHeader title="مختصر الحساب" />
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-right py-2 px-3 font-medium">العملة</th>
                  <th className="text-right py-2 px-3 font-medium">الإجمالي</th>
                  <th className="text-right py-2 px-3 font-medium">مرتجع</th>
                  <th className="text-right py-2 px-3 font-medium">المدفوع حتى تاريخه</th>
                  <th className="text-right py-2 px-3 font-medium">إشعارات دائنة</th>
                  <th className="text-right py-2 px-3 font-medium">المبلغ المستحق</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="py-2 px-3 font-mono">OMR</td>
                  <td className="py-2 px-3 font-medium">{ledger.totalDebit.toFixed(3)} ر.ع</td>
                  <td className="py-2 px-3 text-muted-foreground">-</td>
                  <td className="py-2 px-3 text-success">{ledger.totalCredit.toFixed(3)} ر.ع</td>
                  <td className="py-2 px-3 text-info">{creditBalance.toFixed(3)} ر.ع</td>
                  <td className="py-2 px-3 font-bold text-warning">{ledger.outstanding.toFixed(3)} ر.ع</td>
                </tr>
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* === DETAILED STATEMENT === */}
        <TabsContent value="statement" className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base font-bold text-foreground">كشف حساب مفصّل</h3>
              <p className="text-xs text-muted-foreground">
                ملخص شامل: عدد الزيارات، السيارات المخدومة، الفواتير، الأرصدة — كل تفاصيل العميل في صفحة واحدة.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={openStatement} className="gradient-gold text-primary-foreground gap-1">
                <FileDown size={14} /> طباعة كشف حساب PDF
              </Button>
              <Button onClick={whatsappStatement} variant="outline" className="gap-1 text-success border-success/40 hover:bg-success/10">
                <MessageCircle size={14} /> إرسال واتساب
              </Button>
            </div>
          </div>

          {/* Quick KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">عدد الزيارات</p>
              <p className="text-xl font-bold text-primary">{stats.visits}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">عدد السيارات</p>
              <p className="text-xl font-bold text-info">{stats.vehiclesCount}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">عدد الفواتير</p>
              <p className="text-xl font-bold text-foreground">{ledger.invoicesCount}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">إجمالي الإنفاق</p>
              <p className="text-xl font-bold text-success">{stats.totalSpent.toLocaleString()} ر.ع</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">المستحق الحالي</p>
              <p className="text-xl font-bold text-warning">{ledger.outstanding.toFixed(3)} ر.ع</p>
            </div>
          </div>

          {/* Visits per vehicle */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><Car size={14} className="text-primary" /> الزيارات حسب السيارة</h4>
            {vehicles.length === 0 ? (
              <Empty icon={Car} title="لا توجد سيارات مسجلة" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">اللوحة</th>
                      <th className="text-right py-2 px-3 font-medium">نوع السيارة / الموديل</th>
                      <th className="text-right py-2 px-3 font-medium">سنة الصنع</th>
                      <th className="text-right py-2 px-3 font-medium">عدد الزيارات</th>
                      <th className="text-right py-2 px-3 font-medium">آخر زيارة</th>
                      <th className="text-left py-2 px-3 font-medium">إجمالي الإنفاق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => {
                      const vOrders = orders.filter((o) => o.plate === v.plate);
                      const totalV = vOrders.reduce((s, o) => s + (o.totalCost || 0), 0);
                      const lastV = vOrders[0]?.entryDate || v.lastVisit || "-";
                      return (
                        <tr key={v.id} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="py-2 px-3 font-mono text-primary">
                            <Link to={`/vehicles/${encodeURIComponent(v.plate)}`} className="hover:underline">{v.plate}</Link>
                          </td>
                          <td className="py-2 px-3">{v.type || "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground">{(v as any).year || "-"}</td>
                          <td className="py-2 px-3 font-bold text-info">{vOrders.length}</td>
                          <td className="py-2 px-3 text-muted-foreground">{lastV}</td>
                          <td className="py-2 px-3 text-left font-medium text-success">{totalV.toLocaleString()} ر.ع</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* All visits/orders table */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><ClipboardList size={14} className="text-primary" /> جميع الزيارات وأوامر العمل ({orders.length})</h4>
            {orders.length === 0 ? (
              <Empty icon={ClipboardList} title="لا توجد زيارات" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">#</th>
                      <th className="text-right py-2 px-3 font-medium">رقم الأمر</th>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-right py-2 px-3 font-medium">السيارة</th>
                      <th className="text-right py-2 px-3 font-medium">اللوحة</th>
                      <th className="text-right py-2 px-3 font-medium">نوع الخدمة</th>
                      <th className="text-right py-2 px-3 font-medium">الفني</th>
                      <th className="text-right py-2 px-3 font-medium">الحالة</th>
                      <th className="text-left py-2 px-3 font-medium">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, idx) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono text-primary">
                          <Link to={`/work-orders/${encodeURIComponent(o.id)}`} className="hover:underline">{o.id}</Link>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{o.entryDate}</td>
                        <td className="py-2 px-3">{`${o.vehicleType} ${o.model}`.trim() || "-"}</td>
                        <td className="py-2 px-3 font-mono">{o.plate}</td>
                        <td className="py-2 px-3 text-muted-foreground">{o.serviceType}</td>
                        <td className="py-2 px-3 text-muted-foreground">{o.technician || "-"}</td>
                        <td className="py-2 px-3"><span className="text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info">{o.status}</span></td>
                        <td className="py-2 px-3 text-left font-medium">{o.totalCost.toLocaleString()} ر.ع</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-secondary/30 font-bold">
                    <tr>
                      <td colSpan={8} className="py-2 px-3 text-right">الإجمالي</td>
                      <td className="py-2 px-3 text-left text-success">
                        {orders.reduce((s, o) => s + (o.totalCost || 0), 0).toLocaleString()} ر.ع
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            {orders.length === 0 ? (
              <Empty icon={Receipt} title="لا توجد فواتير" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">الرقم</th>
                      <th className="text-right py-2 px-3 font-medium">السيارة</th>
                      <th className="text-right py-2 px-3 font-medium">الخدمة</th>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-right py-2 px-3 font-medium">الحالة</th>
                      <th className="text-left py-2 px-3 font-medium">المبلغ</th>
                      <th className="text-left py-2 px-3 font-medium">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 font-mono text-primary">{o.id}</td>
                        <td className="py-2 px-3"><Link to={`/vehicles/${encodeURIComponent(o.plate)}`} className="hover:text-primary">{o.plate}</Link></td>
                        <td className="py-2 px-3 text-muted-foreground">{o.serviceType}</td>
                        <td className="py-2 px-3 text-muted-foreground">{o.entryDate}</td>
                        <td className="py-2 px-3"><span className="text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info">{o.status}</span></td>
                        <td className="py-2 px-3 text-left font-medium">{o.totalCost.toLocaleString()} ر.ع</td>
                        <td className="py-2 px-3 text-left">
                          <div className="inline-flex gap-1">
                            <button onClick={() => editInvoice(o.id)} title="فتح/تعديل الفاتورة"
                              className="p-1 rounded hover:bg-primary/10 text-primary"><Pencil size={12} /></button>
                            <button onClick={() => navigate(`/work-orders/${encodeURIComponent(o.id)}?print=1`)} title="طباعة"
                              className="p-1 rounded hover:bg-info/10 text-info"><FileDown size={12} /></button>
                            <button
                              onClick={() => sendWhatsAppMessage({
                                message: `فاتورة رقم ${o.id} بمبلغ ${o.totalCost.toLocaleString()} ر.ع — تفاصيل أمر العمل: ${o.serviceType}`,
                                phone: customer.phone,
                                workOrderId: o.id,
                                recipientName: customer.name,
                                recipientType: "customer",
                              }).then(() => toast.success("تم إرسال الرسالة")).catch((error) =>
                                toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة"))}
                              title="إرسال واتساب"
                              className="p-1 rounded hover:bg-success/10 text-success"><MessageCircle size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* === PAYMENTS / DEPOSITS === */}
        <TabsContent value="payments" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">سندات القبض والدفعات</h3>
              <Button size="sm" onClick={newDeposit} className="gradient-gold text-primary-foreground gap-1 h-7">
                <Plus size={12} /> دفعة جديدة
              </Button>
            </div>
            {customerDeposits.length === 0 ? (
              <Empty icon={Wallet} title="لا توجد دفعات مسجلة" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">السند</th>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-right py-2 px-3 font-medium">النطاق</th>
                      <th className="text-right py-2 px-3 font-medium">المبلغ</th>
                      <th className="text-right py-2 px-3 font-medium">المستهلك</th>
                      <th className="text-right py-2 px-3 font-medium">المتبقي</th>
                      <th className="text-left py-2 px-3 font-medium">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerDeposits.map((d) => (
                      <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 font-mono text-primary">{d.receiptNumber}</td>
                        <td className="py-2 px-3 text-muted-foreground">{d.date}</td>
                        <td className="py-2 px-3">{d.scope === "vehicle" ? `سيارة (${d.plate})` : "عام"}</td>
                        <td className="py-2 px-3">{d.amount.toFixed(3)} ر.ع</td>
                        <td className="py-2 px-3 text-warning">{(d.consumed || 0).toFixed(3)} ر.ع</td>
                        <td className="py-2 px-3 text-success font-medium">{(d.amount - (d.consumed || 0)).toFixed(3)} ر.ع</td>
                        <td className="py-2 px-3 text-left">
                          <div className="inline-flex gap-1">
                            <button onClick={() => printDeposit(d)} title="طباعة سند"
                              className="p-1 rounded hover:bg-info/10 text-info"><FileDown size={12} /></button>
                            <button onClick={() => whatsappDeposit(d)} title="إرسال واتساب"
                              className="p-1 rounded hover:bg-success/10 text-success"><MessageCircle size={12} /></button>
                            {allowEdit && (
                              <button onClick={() => { setEditingDeposit(d); setDepositOpen(true); }} title="تعديل"
                                className="p-1 rounded hover:bg-primary/10 text-primary"><Pencil size={12} /></button>
                            )}
                            {allowDelete && (
                              <button onClick={() => deleteDeposit(d)} title="حذف"
                                className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 size={12} /></button>
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
        </TabsContent>

        {/* === LEDGER === */}
        <TabsContent value="ledger" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">حركة الحساب الكاملة</h3>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={openStatement} className="gap-1 h-7">
                  <FileDown size={12} /> كشف حساب PDF
                </Button>
                <Button size="sm" variant="outline" onClick={whatsappStatement} className="gap-1 h-7 text-success border-success/40 hover:bg-success/10">
                  <MessageCircle size={12} /> واتساب
                </Button>
              </div>
            </div>
            {ledger.entries.length === 0 ? (
              <Empty icon={FileSpreadsheet} title="لا توجد حركات حساب" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-right py-2 px-3 font-medium">النوع</th>
                      <th className="text-right py-2 px-3 font-medium">المرجع</th>
                      <th className="text-right py-2 px-3 font-medium">البيان</th>
                      <th className="text-left py-2 px-3 font-medium">مدين</th>
                      <th className="text-left py-2 px-3 font-medium">دائن</th>
                      <th className="text-left py-2 px-3 font-medium">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.map((e) => (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 text-muted-foreground">{e.date}</td>
                        <td className="py-2 px-3">{ledgerTypeBadge(e.type)}</td>
                        <td className="py-2 px-3 font-mono text-primary">{e.reference}</td>
                        <td className="py-2 px-3">{e.description}</td>
                        <td className="py-2 px-3 text-left text-destructive">{e.debit ? e.debit.toFixed(3) : "-"}</td>
                        <td className="py-2 px-3 text-left text-success">{e.credit ? e.credit.toFixed(3) : "-"}</td>
                        <td className="py-2 px-3 text-left font-medium">{e.balance.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* === CREDIT NOTES === */}
        <TabsContent value="credits" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">الإشعارات الدائنة (المرتجعات)</h3>
              <Button size="sm" onClick={newCreditNote} className="gradient-gold text-primary-foreground gap-1 h-7">
                <Plus size={12} /> إشعار جديد
              </Button>
            </div>
            {creditNotes.length === 0 ? (
              <Empty icon={FileMinus} title="لا توجد إشعارات دائنة" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">الرقم</th>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-right py-2 px-3 font-medium">السبب</th>
                      <th className="text-right py-2 px-3 font-medium">الفاتورة المرتبطة</th>
                      <th className="text-right py-2 px-3 font-medium">المبلغ</th>
                      <th className="text-left py-2 px-3 font-medium">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditNotes.map((c) => (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 font-mono text-primary">{c.number}</td>
                        <td className="py-2 px-3 text-muted-foreground">{c.date}</td>
                        <td className="py-2 px-3">{c.reason}</td>
                        <td className="py-2 px-3 text-muted-foreground">{c.linkedInvoiceId || "-"}</td>
                        <td className="py-2 px-3 font-medium text-success">{c.amount.toFixed(3)} ر.ع</td>
                        <td className="py-2 px-3 text-left">
                          {allowEdit && (
                            <Button size="icon" variant="ghost" className="h-6 w-6"
                              onClick={() => { setEditingCredit(c); setCreditOpen(true); }}>
                              <Pencil size={11} />
                            </Button>
                          )}
                          {allowDelete && (
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10"
                              onClick={() => deleteCreditNote(c)}>
                              <Trash2 size={11} />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* === APPOINTMENTS === */}
        <TabsContent value="appointments" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">المواعيد</h3>
              <Button size="sm" onClick={newAppointment} className="gradient-gold text-primary-foreground gap-1 h-7">
                <Plus size={12} /> موعد جديد
              </Button>
            </div>
            {appointments.length === 0 ? (
              <Empty icon={Calendar} title="لا توجد مواعيد محجوزة" />
            ) : (
              <div className="space-y-2">
                {appointments.map((a) => (
                  <div key={a.id} className="bg-secondary/30 border border-border rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-primary/15 text-primary flex flex-col items-center justify-center">
                        <span className="text-[9px] uppercase">{new Date(a.date).toLocaleString("ar", { month: "short" })}</span>
                        <span className="text-base font-bold leading-none">{new Date(a.date).getDate()}</span>
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{a.service} {a.plate && <span className="text-xs text-muted-foreground">• {a.plate}</span>}</div>
                        <div className="text-[11px] text-muted-foreground">{a.date} • {a.time}</div>
                        {a.notes && <div className="text-[11px] text-muted-foreground mt-1">{a.notes}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge className={`text-[10px] ${
                        a.status === "scheduled" ? "bg-info/15 text-info" :
                        a.status === "completed" ? "bg-success/15 text-success" :
                        a.status === "cancelled" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
                      }`}>
                        {a.status === "scheduled" ? "مجدول" : a.status === "completed" ? "مكتمل" : a.status === "cancelled" ? "ملغى" : "لم يحضر"}
                      </Badge>
                      {allowEdit && (
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => { setEditingAppointment(a); setAppointmentOpen(true); }}>
                          <Pencil size={12} />
                        </Button>
                      )}
                      {allowDelete && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => deleteAppointment(a)}>
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* === VEHICLES === */}
        <TabsContent value="vehicles" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">سيارات العميل ({vehicles.length})</h3>
              <Button size="sm" className="gradient-gold text-primary-foreground gap-1 h-8"
                onClick={() => setVehicleFormOpen(true)}>
                <Plus size={13} /> إضافة سيارة
              </Button>
            </div>
            {vehicles.length === 0 ? (
              <Empty icon={Car} title="لا توجد سيارات مسجّلة" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map((v) => (
                  <Link key={v.id} to={`/vehicles/${encodeURIComponent(v.plate)}`}
                    className="block bg-secondary/30 border border-border rounded-lg p-3 hover:border-primary/40 transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <Car size={16} className="text-primary" />
                      <span className="text-sm font-bold text-foreground">{v.plate}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">{v.type}</div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{v.visits} زيارة</span>
                      <span className="font-medium text-foreground">{(v.totalSpent || 0).toLocaleString()} ر.ع</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* === CLAIMS === */}
        <TabsContent value="claims" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            {claims.length === 0 ? (
              <Empty icon={Shield} title="لا توجد مطالبات تأمين" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right py-2 px-3 font-medium">رقم المطالبة</th>
                      <th className="text-right py-2 px-3 font-medium">شركة التأمين</th>
                      <th className="text-right py-2 px-3 font-medium">السيارة</th>
                      <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                      <th className="text-left py-2 px-3 font-medium">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((o) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-2 px-3 font-mono text-primary">{o.claimNumber}</td>
                        <td className="py-2 px-3">{o.insurance}</td>
                        <td className="py-2 px-3 text-muted-foreground">{o.plate}</td>
                        <td className="py-2 px-3 text-muted-foreground">{o.entryDate}</td>
                        <td className="py-2 px-3 text-left font-medium">{o.totalCost.toLocaleString()} ر.ع</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* === TIMELINE === */}
        <TabsContent value="timeline" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">الجدول الزمني للنشاطات</h3>
            {auditEntries.length === 0 ? (
              <Empty icon={Activity} title="لا توجد نشاطات مسجلة" />
            ) : (
              <div className="space-y-2">
                {auditEntries.map((entry) => (
                  <div key={entry.id} className="flex gap-3 pb-2 border-b border-border/50 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{entry.label}</div>
                      {entry.description && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{entry.description}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1 flex gap-2">
                        <span>{new Date(entry.timestamp).toLocaleString("ar")}</span>
                        <span>•</span>
                        <span>{entry.actor}</span>
                        {entry.amount !== undefined && (
                          <><span>•</span><span className="text-primary">{entry.amount.toLocaleString()} ر.ع</span></>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* === NOTES === */}
        <TabsContent value="notes" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">ملاحظات وسجل التواصل</h3>
              {customer.lastContactAt && (
                <span className="text-[11px] text-muted-foreground">
                  آخر تحديث: {new Date(customer.lastContactAt).toLocaleString("ar")}
                </span>
              )}
            </div>
            <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات داخلية، تفضيلات العميل، تذكيرات..." disabled={!allowEdit} />
            {allowEdit && (
              <div className="flex justify-end">
                <Button size="sm" onClick={saveNotes} className="gradient-gold text-primary-foreground hover:opacity-90">حفظ الملاحظات</Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} initial={customer} />
      <VehicleQuickFormDialog
        open={vehicleFormOpen}
        onOpenChange={setVehicleFormOpen}
        ownerName={customer.name}
        ownerPhone={customer.phone}
      />
      <DepositFormDialog open={depositOpen} onOpenChange={setDepositOpen}
        customerName={customer.name} customerPhone={customer.phone}
        vehiclePlates={vehicles.map((v) => v.plate)} />
      <QuickQuoteDialog open={quoteOpen} onOpenChange={setQuoteOpen}
        customerName={customer.name} customerPhone={customer.phone} />
      <CreditNoteFormDialog open={creditOpen} onOpenChange={setCreditOpen}
        customer={{ name: customer.name, phone: customer.phone }} initial={editingCredit} />
      <AppointmentFormDialog open={appointmentOpen} onOpenChange={setAppointmentOpen}
        customer={{ name: customer.name, phone: customer.phone }} initial={editingAppointment} />
      <SmsDialog open={smsOpen} onOpenChange={setSmsOpen}
        customer={{ name: customer.name, phone: customer.phone }} />
      <PdfPreviewDialog open={statementOpen} onOpenChange={setStatementOpen}
        title={`كشف حساب - ${customer.name}`}
        fileName={`account-statement-${customer.id}`}
        recipientName={customer.name}
        recipientPhone={customer.phone}
        htmlContent={getAccountStatementHtml(customer, ledger)} />
      <ConfirmDeleteDialog
        open={deleteCustomer} onOpenChange={setDeleteCustomer}
        onConfirm={confirmDeleteCustomer}
        title="حذف العميل"
        description={`هل تريد حذف العميل "${customer.name}"؟ يمكن استرجاعه من المهملات.`}
      />
    </div>
  );
}

// ===== sub-components =====
function ToolbarBtn({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-secondary/60 border border-border text-xs hover:bg-secondary hover:border-primary/40 hover:text-primary transition-colors">
      <Icon size={12} /> {label}
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-semibold text-muted-foreground bg-card px-2 py-0.5 rounded border border-border">{title}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <div className={`text-foreground font-medium ${mono ? "font-mono text-[11px]" : ""}`}>{value}</div>
    </div>
  );
}

function QuickInfo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

function ledgerTypeBadge(t: string) {
  const map: Record<string, { label: string; cls: string }> = {
    invoice: { label: "فاتورة", cls: "bg-destructive/15 text-destructive" },
    work_order: { label: "أمر عمل", cls: "bg-warning/15 text-warning" },
    receipt: { label: "سند قبض", cls: "bg-success/15 text-success" },
    deposit: { label: "دفعة", cls: "bg-info/15 text-info" },
    credit_note: { label: "إشعار دائن", cls: "bg-primary/15 text-primary" },
  };
  const item = map[t] || { label: t, cls: "bg-secondary text-foreground" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.cls}`}>{item.label}</span>;
}

function Empty({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="text-center py-12">
      <Icon size={40} className="mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm text-foreground font-medium">{title}</p>
    </div>
  );
}
