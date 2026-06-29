import { useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, FileDown, DollarSign, Clock, FileText, AlertTriangle, FileSpreadsheet, BookOpen, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatCard from "@/components/StatCard";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { useInsuranceCompany, useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { usePaymentsByCompany, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/hooks/useClaimPayments";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";
import { getInsuranceStatementHtml } from "@/lib/insuranceStatementPdf";
import { getInsuranceWorkshopReportHtml, type WorkshopReportRow, type WorkshopColumnKey, DEFAULT_WORKSHOP_COLUMNS, WORKSHOP_COLUMN_LABELS } from "@/lib/insuranceWorkshopReport";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDateLatin } from "@/lib/numberUtils";
import { exportPaymentsToCsv } from "@/lib/insurancePaymentExport";
import { computeAging, summarizeAging, DEFAULT_BUCKETS, type AgingBasis, type AgingBucket } from "@/lib/insuranceAging";
import { journalStore } from "@/lib/journalStore";
import JournalPreview, { entryToPreviewLine } from "@/components/accounting/JournalPreview";
import { getTemplateSettings } from "@/lib/pdfGenerator";
import InsuranceEmployeesManager from "@/components/insurance/InsuranceEmployeesManager";

const CLAIM_STATUS_AR: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "قيد العمل",
  paid: "مدفوعة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};

const BASIS_LABELS: Record<AgingBasis, string> = {
  approval_date: "من تاريخ الاعتماد",
  due_date: "من تاريخ الاستحقاق",
  creation_date: "من تاريخ الإنشاء",
  arrival_date: "من تاريخ استلام المركبة",
  delivery_date: "من تاريخ التسليم",
  invoice_date: "من تاريخ إصدار الفاتورة",
};

const BUCKET_PRESETS: Record<string, AgingBucket[]> = {
  "30/60/90/+90": DEFAULT_BUCKETS,
  "15/30/+30": [
    { label: "0-15", from: 0, to: 15 },
    { label: "16-30", from: 16, to: 30 },
    { label: "31+", from: 31, to: null },
  ],
  "30/45/60/90/+90": [
    { label: "0-30", from: 0, to: 30 },
    { label: "31-45", from: 31, to: 45 },
    { label: "46-60", from: 46, to: 60 },
    { label: "61-90", from: 61, to: 90 },
    { label: "+90", from: 91, to: null },
  ],
};

export default function InsuranceCompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: company } = useInsuranceCompany(id);
  const { data: allClaims } = useInsuranceClaims();
  const { data: companies } = useInsuranceCompanies();
  const { data: payments } = usePaymentsByCompany(id);
  const { data: allInvoices } = useInsuranceInvoices();

  const claims = useMemo(() => {
    if (!allClaims || !company) return [];
    return allClaims.filter(
      (c) => (c as any).insurance_company_id === company.id || c.insurance_company === company.name,
    );
  }, [allClaims, company]);

  // ── المصدر المالي الموحّد ──
  // الدين الفعلي على شركة التأمين = إجمالي فواتيرها النشطة (شامل VAT)،
  // ومطالبات بلا فاتورة تُحسب: (المعتمد/المُقدّر) + VAT حسب إعدادات الضريبة.
  const tpl = getTemplateSettings();
  const vatRate = tpl.taxEnabled === false ? 0 : (Number(tpl.vatRate) || 5) / 100;

  const claimInvoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    const claimIdSet = new Set(claims.map((c) => c.id));
    (allInvoices ?? [])
      .filter((i) => i.status !== "cancelled" && claimIdSet.has(i.claim_id))
      .forEach((i) => {
        // إن وُجد أكثر من فاتورة لنفس المطالبة، نحتفظ بالأحدث فقط
        const prev = map.get(i.claim_id);
        if (!prev || new Date(i.issued_at).getTime() > new Date(prev.issued_at).getTime()) {
          map.set(i.claim_id, i);
        }
      });
    return map;
  }, [allInvoices, claims]);

  const companyInvoices = useMemo(
    () => Array.from(claimInvoiceMap.values()),
    [claimInvoiceMap],
  );

  /** الدين الفعلي للمطالبة (شامل VAT) */
  const claimReceivable = (c: any): number => {
    const inv = claimInvoiceMap.get(c.id);
    if (inv) return Number(inv.total) || 0;
    const net = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
    return net > 0 ? +(net * (1 + vatRate)).toFixed(3) : 0;
  };

  const totalApproved = claims.reduce((s, c) => s + claimReceivable(c), 0);
  const totalPaid = (payments ?? [])
    .filter((p) => p.status !== "bounced")
    .reduce((s, p) => s + Number(p.amount), 0);
  const remaining = +(totalApproved - totalPaid).toFixed(3);

  // ── Aging مرن ──
  const [agingBasis, setAgingBasis] = useState<AgingBasis>("approval_date");
  const [bucketPreset, setBucketPreset] = useState<keyof typeof BUCKET_PRESETS>("30/60/90/+90");
  const buckets = BUCKET_PRESETS[bucketPreset];

  // أعمار الديون تستخدم نفس مصدر الدين (فاتورة شامل VAT أو fallback مع VAT)
  const claimsForAging = useMemo(
    () => claims.map((c) => ({ ...c, approved_amount: claimReceivable(c) })),
    [claims, claimInvoiceMap, vatRate],
  );

  const agingRows = useMemo(
    () => computeAging(claimsForAging as any, payments ?? [], companies, {
      basis: agingBasis,
      buckets,
      defaultTermsDays: company?.payment_terms_days ?? 90,
      invoiceByClaim: claimInvoiceMap as any,
    }),
    [claimsForAging, payments, companies, agingBasis, buckets, company, claimInvoiceMap],
  );

  const aging = useMemo(() => summarizeAging(agingRows, buckets), [agingRows, buckets]);
  const overdueAmount = agingRows
    .filter((r) => r.bucketLabel !== buckets[0].label)
    .reduce((s, r) => s + r.remaining, 0);

  // ── فترة من/إلى + فلتر الحالة المتقدّم ──
  const [periodFrom, setPeriodFrom] = useState<string>("");
  const [periodTo, setPeriodTo] = useState<string>("");
  type ReportFilter = "all" | "in_garage" | "delivered" | "paid" | "pending_collection" | "overdue";
  const [reportFilter, setReportFilter] = useState<ReportFilter>("all");

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (periodFrom && t < new Date(periodFrom).getTime()) return false;
    if (periodTo && t > new Date(periodTo + "T23:59:59").getTime()) return false;
    return true;
  };

  const filteredPayments = useMemo(
    () => (payments ?? []).filter((p) => inRange(p.payment_date)),
    [payments, periodFrom, periodTo],
  );

  // ── القيود المحاسبية للشركة (من journalStore) ──
  const [showJournal, setShowJournal] = useState(false);
  const journalLines = useMemo(() => {
    const claimIds = new Set(claims.map((c) => c.id));
    const paymentIds = new Set((payments ?? []).map((p) => p.id));
    return journalStore.getAll()
      .filter((e) => {
        if (e.source === "insurance_claim" && claimIds.has(e.sourceId)) return true;
        if (e.source === "insurance_payment" && paymentIds.has(e.sourceId)) return true;
        return false;
      })
      .filter((e) => inRange(e.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(entryToPreviewLine);
  }, [claims, payments, periodFrom, periodTo, showJournal]);

  // ── Preview dialogs ──
  const [statementOpen, setStatementOpen] = useState(false);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [workshopPickerOpen, setWorkshopPickerOpen] = useState(false);
  const [reportColumns, setReportColumns] = useState<Record<WorkshopColumnKey, boolean>>(DEFAULT_WORKSHOP_COLUMNS);

  const filteredClaims = useMemo(
    () => claims.filter((c) => inRange(c.approved_at ?? c.created_at)),
    [claims, periodFrom, periodTo],
  );

  // المطالبات بعد تطبيق فلتر التقرير المتقدّم (يستخدم لتقرير عمليات الورشة فقط).
  const reportClaims = useMemo(() => {
    return filteredClaims.filter((c) => {
      const delivered = (c as any).delivered_at ?? null;
      const cPays = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
      const paid = cPays.reduce((s, p) => s + Number(p.amount), 0);
      const approved = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
      const remaining = approved - paid;
      const startMs = new Date(c.created_at).getTime();
      const endMs = delivered ? new Date(delivered).getTime() : Date.now();
      const days = Math.max(0, Math.round((endMs - startMs) / 86_400_000));
      switch (reportFilter) {
        case "in_garage":           return !delivered;
        case "delivered":           return !!delivered;
        case "paid":                return approved > 0 && remaining <= 0.01;
        case "pending_collection":  return !!delivered && remaining > 0.01;
        case "overdue":             return days > 30 && remaining > 0.01;
        default: return true;
      }
    });
  }, [filteredClaims, payments, reportFilter]);

  const statementHtml = useMemo(() => {
    if (!company || !statementOpen) return "";
    return getInsuranceStatementHtml({
      companyName: company.name,
      contactPerson: company.contact_person,
      phone: company.phone,
      email: company.email,
      address: company.address,
      commercialRegistration: (company as any).commercial_registration ?? null,
      taxNumber: (company as any).tax_number ?? null,
      poBox: (company as any).po_box ?? null,
      branchCity: (company as any).branch_city ?? null,
      bankName: (company as any).bank_name ?? null,
      iban: (company as any).iban ?? null,
      bankAccountName: (company as any).bank_account_name ?? null,
      periodFrom: periodFrom || undefined,
      periodTo: periodTo || undefined,
      vatRate,
      claims: reportClaims.map((c) => ({
        claim_number: c.claim_number,
        created_at: c.approved_at ?? c.created_at,
        estimated_amount: Number(c.estimated_amount) || 0,
        approved_amount: Number(c.approved_amount) || 0,
        status: c.status,
      })),
      invoices: companyInvoices
        .filter((inv) => inRange(inv.issued_at))
        .filter((inv) => reportClaims.some((c) => c.id === inv.claim_id))
        .map((inv) => {
          const claim = claims.find((c) => c.id === inv.claim_id);
          return {
            invoice_number: inv.invoice_number,
            claim_number: claim?.claim_number ?? null,
            issued_at: inv.issued_at,
            subtotal: Number(inv.subtotal) || 0,
            vat: Number(inv.vat) || 0,
            total: Number(inv.total) || 0,
            status: inv.status,
          };
        }),
      payments: filteredPayments
        .filter((p) => reportClaims.some((c) => c.id === p.claim_id))
        .map((p) => ({
          payment_number: p.payment_number,
          payment_date: p.payment_date,
          amount: Number(p.amount),
          payment_method: p.payment_method,
          status: p.status,
          reference_number: p.reference_number,
        })),
    });
  }, [company, statementOpen, reportClaims, filteredPayments, companyInvoices, claims, vatRate, periodFrom, periodTo]);

  const workshopHtml = useMemo(() => {
    if (!company || !workshopOpen) return "";
    const rows: WorkshopReportRow[] = reportClaims.map((c) => {
      const cPayments = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
      const paid = cPayments.reduce((s, p) => s + Number(p.amount), 0);
      const approved = Number(c.approved_amount) || 0;
      const estimated = Number(c.estimated_amount) || 0;
      const delivered = (c as any).delivered_at ?? null;
      const reported = c.created_at;
      const arrival = (c as any).workshop_arrival_date ?? null;
      const startRef = arrival ?? reported;
      const startMs = new Date(startRef).getTime();
      const endMs = delivered ? new Date(delivered).getTime() : Date.now();
      const days = Math.max(0, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
      const remaining = approved - paid;
      const collectionStatus: import("@/lib/insuranceWorkshopReport").CollectionStatus =
        approved <= 0 ? "n/a"
        : remaining <= 0.01 ? "paid"
        : paid > 0 ? "partial"
        : days > 30 ? "overdue"
        : "pending";
      const v: any = c.vehicle;
      const inv = claimInvoiceMap.get(c.id);
      return {
        reportedDate: reported,
        estimateDate: (c as any).estimate_date ?? null,
        arrivalDate: arrival,
        workStartedAt: (c as any).work_started_at ?? null,
        workCompletedAt: (c as any).work_completed_at ?? null,
        approvalDate: c.approved_at,
        invoiceDate: inv?.issued_at ?? null,
        invoiceNumber: inv?.invoice_number ?? null,
        claimNumber: c.claim_number,
        vehicleNo: v?.plate_number || "—",
        vehicleMakeModel: v ? [v.brand, v.model, v.year].filter(Boolean).join(" ") : undefined,
        customerName: (c as any).customer?.name || (c as any).vehicle_owner_name || "—",
        status: delivered ? "تم التسليم" : (CLAIM_STATUS_AR[c.status] ?? c.status),
        inWorkshopDays: days,
        estimatedAmount: estimated,
        approvedAmount: approved,
        paidAmount: paid,
        deliveredDate: delivered,
        collectionStatus,
      };
    });
    return getInsuranceWorkshopReportHtml({
      companyName: company.name,
      branchCity: (company as any).branch_city ?? null,
      contactPerson: company.contact_person,
      phone: company.phone,
      email: company.email,
      periodFrom: periodFrom || undefined,
      periodTo: periodTo || undefined,
      rows,
      vatRate,
      columns: reportColumns,
    });
  }, [company, workshopOpen, reportClaims, payments, periodFrom, periodTo, claimInvoiceMap, vatRate, reportColumns]);


  const handleExportCsv = () => {
    if (!company) return;
    exportPaymentsToCsv({
      payments: payments ?? [],
      companyName: company.name,
      periodFrom: periodFrom || undefined,
      periodTo: periodTo || undefined,
    });
  };

  if (!company) return <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/insurance/companies")}>
            <ArrowRight />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {company.name}
              {(company as any).branch_city && (
                <span className="text-base font-normal text-muted-foreground"> — {(company as any).branch_city}</span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {company.contact_person ?? "—"}{company.phone ? ` • ${company.phone}` : ""}
              {company.email ? ` • ${company.email}` : ""}
            </p>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {(company as any).commercial_registration && (
                <span className="px-2 py-0.5 bg-muted rounded-md">
                  س.ت: <span className="font-mono">{(company as any).commercial_registration}</span>
                </span>
              )}
              {(company as any).tax_number && (
                <span className="px-2 py-0.5 bg-muted rounded-md">
                  ر.ض: <span className="font-mono">{(company as any).tax_number}</span>
                </span>
              )}
              {(company as any).po_box && (
                <span className="px-2 py-0.5 bg-muted rounded-md">
                  ص.ب: <span className="font-mono">{(company as any).po_box}</span>
                </span>
              )}
              {(company as any).iban && (
                <span className="px-2 py-0.5 bg-info/10 text-info rounded-md">
                  IBAN: <span className="font-mono ltr inline-block" dir="ltr">{(company as any).iban}</span>
                </span>
              )}
              {(company as any).bank_name && !(company as any).iban && (
                <span className="px-2 py-0.5 bg-info/10 text-info rounded-md">
                  بنك: {(company as any).bank_name}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <InsuranceEmployeesManager companyId={company.id} />

      {/* فلاتر الفترة + تصدير */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-end gap-3 flex-wrap">
          <div className="space-y-1.5 flex-1 min-w-[140px]">
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[140px]">
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
          <div className="space-y-1.5 min-w-[200px]">
            <Label className="text-xs">فلتر التقرير</Label>
            <Select value={reportFilter} onValueChange={(v) => setReportFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع السيارات</SelectItem>
                <SelectItem value="in_garage">داخل الورشة حالياً</SelectItem>
                <SelectItem value="delivered">تم تسليمها</SelectItem>
                <SelectItem value="paid">تم تحصيلها</SelectItem>
                <SelectItem value="pending_collection">مكتملة وبانتظار التحصيل</SelectItem>
                <SelectItem value="overdue">متأخرة (+30 يوم)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setPeriodFrom(""); setPeriodTo(""); setReportFilter("all"); }}>
              مسح الفلاتر
            </Button>
            <Button variant="outline" onClick={handleExportCsv} className="gap-2">
              <FileSpreadsheet size={16} /> Excel/CSV
            </Button>
            <Button variant="outline" onClick={() => setWorkshopPickerOpen(true)} className="gap-2">
              <ClipboardList size={16} /> تقرير عمليات الورشة ({reportClaims.length})
            </Button>
            <Button onClick={() => setStatementOpen(true)} className="gap-2">
              <FileDown size={16} /> كشف PDF
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          الفلتر المتقدّم وفترة التاريخ يطبَّقان على «تقرير عمليات الورشة» و«كشف حساب شركة التأمين» معاً.
        </p>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي المعتمد" value={`${totalApproved.toLocaleString()} ر.ع`} icon={FileText} variant="info" />
        <StatCard title="المدفوع" value={`${totalPaid.toLocaleString()} ر.ع`} icon={DollarSign} variant="success" />
        <StatCard title="المتبقي" value={`${remaining.toLocaleString()} ر.ع`} icon={Clock} variant={remaining > 0 ? "warning" : "success"} />
        <StatCard title="المتأخر (خارج 1ش نطاق)" value={`${overdueAmount.toLocaleString()} ر.ع`} icon={AlertTriangle} variant={overdueAmount > 0 ? "warning" : "success"} />
      </div>

      {/* Aging مرن */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">أعمار الديون (Aging) — مرن</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">احتساب العمر</Label>
              <Select value={agingBasis} onValueChange={(v) => setAgingBasis(v as AgingBasis)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BASIS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">نطاقات الأيام</Label>
              <Select value={bucketPreset} onValueChange={(v) => setBucketPreset(v as any)}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(BUCKET_PRESETS).map((k) => (
                    <SelectItem key={k} value={k}>{k} يوم</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(aging).map(([bucket, val], idx) => (
            <div key={bucket} className={`p-3 rounded-lg border ${
              idx === 0 ? "bg-secondary/30 border-border" :
              idx === buckets.length - 1 ? "bg-destructive/10 border-destructive/30" :
              "bg-warning/10 border-warning/30"
            }`}>
              <div className="text-xs text-muted-foreground mb-1">{bucket} يوم</div>
              <div className="text-lg font-bold">{val.toLocaleString()} ر.ع</div>
            </div>
          ))}
        </div>
      </Card>

      {/* القيود المحاسبية */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-primary" />
            <h2 className="text-base font-semibold">القيود المحاسبية للشركة ({journalLines.length})</h2>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">عرض القيود</Label>
            <Switch checked={showJournal} onCheckedChange={setShowJournal} />
          </div>
        </div>
        {showJournal && (
          <JournalPreview
            title="القيود المرحَّلة (مطالبات + دفعات)"
            lines={journalLines}
            emptyMessage="لا توجد قيود محاسبية مرحّلة لهذه الشركة ضمن الفترة المختارة"
          />
        )}
      </Card>

      {/* تقرير تدقيق المطابقة (Audit Report) */}
      <AuditPanel
        claims={claims as any}
        invoices={companyInvoices}
        payments={payments ?? []}
        vatRate={vatRate}
        claimReceivable={claimReceivable}
        totalReceivable={totalApproved}
        totalPaid={totalPaid}
        remaining={remaining}
      />

      {/* Claims */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold">المطالبات ({claims.length})</h2>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              const rows = claims.map((c) => {
                const cPays = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
                const paid = cPays.reduce((s, p) => s + Number(p.amount), 0);
                const inv = claimInvoiceMap.get(c.id);
                const net = inv ? Number(inv.subtotal) || 0 : (Number(c.approved_amount) || Number(c.estimated_amount) || 0);
                const vat = inv ? Number(inv.vat) || 0 : +(net * vatRate).toFixed(3);
                const gross = claimReceivable(c);
                const rem = +(gross - paid).toFixed(3);
                return {
                  claim_number: c.claim_number,
                  company: company.name,
                  status: CLAIM_STATUS_AR[c.status] ?? c.status,
                  net, vat, gross, paid, remaining: rem,
                  invoice: inv?.invoice_number ?? "",
                };
              });
              const header = ["رقم المطالبة","الشركة","الحالة","المعتمد قبل الضريبة","الضريبة","الإجمالي","المدفوع","المتبقي","رقم الفاتورة"];
              const sums = rows.reduce((a, r) => ({ net: a.net + r.net, vat: a.vat + r.vat, gross: a.gross + r.gross, paid: a.paid + r.paid, remaining: a.remaining + r.remaining }), { net: 0, vat: 0, gross: 0, paid: 0, remaining: 0 });
              const csv = [
                header.join(","),
                ...rows.map((r) => [r.claim_number, `"${r.company}"`, r.status, r.net, r.vat.toFixed(3), r.gross.toFixed(3), r.paid.toFixed(3), r.remaining.toFixed(3), r.invoice].join(",")),
                ["الإجمالي","","", sums.net, sums.vat.toFixed(3), sums.gross.toFixed(3), sums.paid.toFixed(3), sums.remaining.toFixed(3), ""].join(","),
              ].join("\n");
              const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `Audit-${company.name}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <FileSpreadsheet size={14} /> تصدير تقرير التدقيق
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">رقم</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المركبة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">استلام المركبة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">التسليم</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">إنشاء الفاتورة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الحالة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">معتمد (صافي)</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">VAT</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الإجمالي المستحق</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المدفوع</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المتبقي</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الفاتورة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">العمر ({BASIS_LABELS[agingBasis]})</th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr><td colSpan={13} className="py-6 text-center text-muted-foreground">لا توجد مطالبات</td></tr>
              ) : claims.map((c) => {
                const cPayments = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
                const paid = cPayments.reduce((s, p) => s + Number(p.amount), 0);
                const inv = claimInvoiceMap.get(c.id);
                const net = inv ? Number(inv.subtotal) || 0 : (Number(c.approved_amount) || Number(c.estimated_amount) || 0);
                const vat = inv ? Number(inv.vat) || 0 : +(net * vatRate).toFixed(3);
                const gross = claimReceivable(c);
                const rem = +(gross - paid).toFixed(3);
                const ageRow = agingRows.find((r) => r.claimId === c.id);
                const arrival = (c as any).workshop_arrival_date ?? null;
                const delivered = (c as any).delivered_at ?? null;
                const vehicle: any = (c as any).vehicle;
                const vehicleLabel = vehicle
                  ? [vehicle.plate_number, vehicle.brand, vehicle.model].filter(Boolean).join(" · ")
                  : "—";
                return (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/10 cursor-pointer"
                      onClick={() => navigate(`/insurance/${c.id}`)}>
                    <td className="py-2.5 px-4 font-mono text-xs text-primary">{c.claim_number}</td>
                    <td className="py-2.5 px-4 text-xs">{vehicleLabel}</td>
                    <td className="py-2.5 px-4 text-xs">{arrival ? formatDateLatin(arrival) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 px-4 text-xs">{delivered ? formatDateLatin(delivered) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 px-4 text-xs">{inv ? formatDateLatin(inv.issued_at) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 px-4 text-xs">{CLAIM_STATUS_AR[c.status] ?? c.status}</td>
                    <td className="py-2.5 px-4">{net.toLocaleString()} ر.ع</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{vat.toLocaleString()} ر.ع</td>
                    <td className="py-2.5 px-4 font-semibold">{gross.toLocaleString()} ر.ع</td>
                    <td className="py-2.5 px-4 text-success">{paid.toLocaleString()} ر.ع</td>
                    <td className={`py-2.5 px-4 font-bold ${rem > 0.01 ? "text-warning" : "text-success"}`}>
                      {rem.toLocaleString()} ر.ع
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      {inv ? (
                        <span className="font-mono text-primary">#{inv.invoice_number}</span>
                      ) : (
                        <span className="text-muted-foreground">— (VAT تقديري)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      {ageRow ? (
                        <span className="inline-flex items-center gap-1">
                          {ageRow.ageDays} يوم
                          <span className="text-muted-foreground">({ageRow.bucketLabel})</span>
                        </span>
                      ) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {claims.length > 0 && (() => {
              const sums = claims.reduce((a, c) => {
                const cPays = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
                const paid = cPays.reduce((s, p) => s + Number(p.amount), 0);
                const inv = claimInvoiceMap.get(c.id);
                const net = inv ? Number(inv.subtotal) || 0 : (Number(c.approved_amount) || Number(c.estimated_amount) || 0);
                const vat = inv ? Number(inv.vat) || 0 : +(net * vatRate).toFixed(3);
                const gross = claimReceivable(c);
                return { net: a.net + net, vat: a.vat + vat, gross: a.gross + gross, paid: a.paid + paid };
              }, { net: 0, vat: 0, gross: 0, paid: 0 });
              const rem = +(sums.gross - sums.paid).toFixed(3);
              return (
                <tfoot>
                  <tr className="bg-secondary/50 border-t-2 border-border font-bold">
                    <td className="py-3 px-4" colSpan={6}>الإجمالي ({claims.length} مطالبة)</td>
                    <td className="py-3 px-4">{sums.net.toLocaleString()} ر.ع</td>
                    <td className="py-3 px-4">{sums.vat.toLocaleString()} ر.ع</td>
                    <td className="py-3 px-4 text-info">{sums.gross.toLocaleString()} ر.ع</td>
                    <td className="py-3 px-4 text-success">{sums.paid.toLocaleString()} ر.ع</td>
                    <td className={`py-3 px-4 ${rem > 0.01 ? "text-warning" : "text-success"}`}>{rem.toLocaleString()} ر.ع</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      </Card>

      {/* Payments */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold">سجل الدفعات ({filteredPayments.length})</h2>
          <span className="text-xs text-muted-foreground">يطبَّق فلتر الفترة أعلاه</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">رقم الدفعة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">التاريخ</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المرجع</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الطريقة</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">المبلغ</th>
                <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {!filteredPayments.length ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">لا توجد دفعات ضمن الفترة</td></tr>
              ) : filteredPayments.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/10">
                  <td className="py-2.5 px-4 font-mono text-xs text-primary">{p.payment_number}</td>
                  <td className="py-2.5 px-4">{formatDateLatin(p.payment_date)}</td>
                  <td className="py-2.5 px-4 text-xs">
                    {p.claim?.claim_number ? <span className="font-mono">{p.claim.claim_number}</span> : "-"}
                    {p.reference_number && <div className="text-muted-foreground">{p.reference_number}</div>}
                  </td>
                  <td className="py-2.5 px-4">{PAYMENT_METHOD_LABELS[p.payment_method]}</td>
                  <td className="py-2.5 px-4 font-semibold text-success">{Number(p.amount).toLocaleString()} ر.ع</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === "cleared" ? "bg-success/15 text-success" :
                      p.status === "bounced" ? "bg-destructive/15 text-destructive" :
                      "bg-warning/15 text-warning"
                    }`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PdfPreviewDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        htmlContent={statementHtml}
        title={`كشف حساب - ${company.name}`}
        fileName={`Statement-${company.name}`}
      />

      <PdfPreviewDialog
        open={workshopOpen}
        onOpenChange={setWorkshopOpen}
        htmlContent={workshopHtml}
        title={`تقرير عمليات الورشة - ${company.name}`}
        fileName={`Workshop-Report-${company.name}`}
      />

      {/* مُنتقي أعمدة تقرير عمليات الورشة */}
      <Dialog open={workshopPickerOpen} onOpenChange={setWorkshopPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>اختر بنود تقرير عمليات الورشة</DialogTitle>
            <DialogDescription>
              حدِّد الأعمدة التي تريد إظهارها في الكشف قبل المعاينة. عمود
              <span className="font-semibold text-foreground"> «الإجمالي شامل الضريبة 5%» </span>
              يُحتسب تلقائياً من المبلغ المعتمد.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 py-2">
            {(Object.keys(WORKSHOP_COLUMN_LABELS) as WorkshopColumnKey[]).map((k) => (
              <label
                key={k}
                className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-secondary/30 cursor-pointer text-sm"
              >
                <Checkbox
                  checked={reportColumns[k]}
                  onCheckedChange={(v) =>
                    setReportColumns((prev) => ({ ...prev, [k]: v === true }))
                  }
                />
                <span>{WORKSHOP_COLUMN_LABELS[k]}</span>
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2 flex-wrap sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReportColumns(DEFAULT_WORKSHOP_COLUMNS)}
              >
                استعادة الافتراضي
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setReportColumns(
                    Object.fromEntries(
                      (Object.keys(WORKSHOP_COLUMN_LABELS) as WorkshopColumnKey[]).map((k) => [k, true]),
                    ) as Record<WorkshopColumnKey, boolean>,
                  )
                }
              >
                تحديد الكل
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setWorkshopPickerOpen(false)}>إلغاء</Button>
              <Button
                onClick={() => {
                  setWorkshopPickerOpen(false);
                  setWorkshopOpen(true);
                }}
                className="gap-2"
              >
                <FileDown size={16} /> معاينة التقرير
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Audit panel — يطابق الفواتير + المطالبات + الدفعات ويكتشف التكرار
// ─────────────────────────────────────────────────────────────────
function AuditPanel({
  claims,
  invoices,
  payments,
  vatRate,
  claimReceivable,
  totalReceivable,
  totalPaid,
  remaining,
}: {
  claims: any[];
  invoices: any[];
  payments: any[];
  vatRate: number;
  claimReceivable: (c: any) => number;
  totalReceivable: number;
  totalPaid: number;
  remaining: number;
}) {
  // كشف تكرار الفواتير لنفس المطالبة (status != cancelled)
  const dupInvoicesByClaim = useMemo(() => {
    const m = new Map<string, any[]>();
    invoices.forEach((i) => {
      const arr = m.get(i.claim_id) ?? [];
      arr.push(i);
      m.set(i.claim_id, arr);
    });
    return Array.from(m.entries()).filter(([, arr]) => arr.length > 1);
  }, [invoices]);

  // كشف تكرار أرقام الدفعات
  const dupPaymentNumbers = useMemo(() => {
    const m = new Map<string, any[]>();
    payments.forEach((p) => {
      const k = (p.payment_number || "").trim();
      if (!k) return;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    });
    return Array.from(m.entries()).filter(([, arr]) => arr.length > 1);
  }, [payments]);

  // كشف دفعات بنفس (التاريخ + المبلغ + المرجع) — تكرار محتمل
  const dupPaymentSignature = useMemo(() => {
    const m = new Map<string, any[]>();
    payments.forEach((p) => {
      if (p.status === "bounced") return;
      const k = `${p.payment_date}|${Number(p.amount).toFixed(3)}|${p.reference_number ?? ""}|${p.claim_id ?? ""}`;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    });
    return Array.from(m.entries()).filter(([, arr]) => arr.length > 1);
  }, [payments]);

  const claimsWithoutInvoice = claims.filter(
    (c) => !invoices.some((i) => i.claim_id === c.id) && claimReceivable(c) > 0,
  );

  const invoicesTotal = invoices.reduce((s, i) => s + (Number(i.total) || 0), 0);

  const issues =
    dupInvoicesByClaim.length + dupPaymentNumbers.length + dupPaymentSignature.length;

  return (
    <Card className="p-4 space-y-3 border-info/40">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className={issues > 0 ? "text-warning" : "text-success"} />
          <h2 className="text-base font-semibold">
            تقرير تدقيق المطابقة (Audit Report){" "}
            <span className={`text-xs ${issues > 0 ? "text-warning" : "text-success"}`}>
              — {issues > 0 ? `${issues} ملاحظة` : "كل شيء متطابق ✓"}
            </span>
          </h2>
        </div>
        <span className="text-[11px] text-muted-foreground">VAT المطبَّق: {(vatRate * 100).toFixed(2)}%</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div className="p-3 bg-secondary/30 rounded">
          <div className="text-xs text-muted-foreground">عدد المطالبات</div>
          <div className="text-lg font-bold">{claims.length}</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded">
          <div className="text-xs text-muted-foreground">فواتير نشطة</div>
          <div className="text-lg font-bold">{invoices.length}</div>
          <div className="text-[10px] text-muted-foreground">إجمالي: {invoicesTotal.toLocaleString()} ر.ع</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded">
          <div className="text-xs text-muted-foreground">عدد الدفعات (غير المرتجعة)</div>
          <div className="text-lg font-bold">{payments.filter((p) => p.status !== "bounced").length}</div>
        </div>
        <div className="p-3 bg-info/10 rounded">
          <div className="text-xs text-muted-foreground">إجمالي الدين</div>
          <div className="text-lg font-bold">{totalReceivable.toLocaleString()} ر.ع</div>
        </div>
        <div className={`p-3 rounded ${remaining > 0.01 ? "bg-warning/10" : "bg-success/10"}`}>
          <div className="text-xs text-muted-foreground">المتبقي = الدين − المدفوع</div>
          <div className="text-lg font-bold">{remaining.toLocaleString()} ر.ع</div>
          <div className="text-[10px] text-muted-foreground">
            ({totalReceivable.toLocaleString()} − {totalPaid.toLocaleString()})
          </div>
        </div>
      </div>

      {claimsWithoutInvoice.length > 0 && (
        <div className="text-xs p-3 bg-warning/10 rounded">
          <strong>مطالبات بدون فاتورة ضريبية ({claimsWithoutInvoice.length}):</strong>{" "}
          يتم احتساب VAT تقديرياً عليها حتى إصدار الفاتورة.
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {claimsWithoutInvoice.slice(0, 8).map((c) => c.claim_number).join("، ")}
            {claimsWithoutInvoice.length > 8 ? " …" : ""}
          </div>
        </div>
      )}

      {dupInvoicesByClaim.length > 0 && (
        <div className="text-xs p-3 bg-destructive/10 rounded">
          <strong className="text-destructive">⚠ فواتير مكررة لنفس المطالبة:</strong>
          <ul className="list-disc pr-5 mt-1">
            {dupInvoicesByClaim.map(([cid, arr]) => (
              <li key={cid}>
                مطالبة #{cid.slice(0, 8)} — {arr.length} فواتير:{" "}
                {arr.map((i) => i.invoice_number).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dupPaymentNumbers.length > 0 && (
        <div className="text-xs p-3 bg-destructive/10 rounded">
          <strong className="text-destructive">⚠ أرقام دفعات مكررة:</strong>{" "}
          {dupPaymentNumbers.map(([n]) => n).join(", ")}
        </div>
      )}

      {dupPaymentSignature.length > 0 && (
        <div className="text-xs p-3 bg-warning/10 rounded">
          <strong>⚠ دفعات بنفس (التاريخ/المبلغ/المرجع) — احتمال تكرار يدوي:</strong>
          <ul className="list-disc pr-5 mt-1">
            {dupPaymentSignature.map(([k, arr]) => (
              <li key={k}>
                {arr.length}× — {arr.map((p) => p.payment_number).join(", ")} ({Number(arr[0].amount).toLocaleString()} ر.ع)
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
