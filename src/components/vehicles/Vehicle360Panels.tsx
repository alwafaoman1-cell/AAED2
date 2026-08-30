import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, Banknote, CalendarDays, Camera, CarFront, CheckCircle2,
  CircleDollarSign, ClipboardList, FileText, History, MapPin, Package, Receipt,
  Search, Shield, TrendingDown, TrendingUp, UserRound, WalletCards, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Vehicle360Snapshot, VehicleTimelineCategory, VehicleTimelineEvent } from "@/lib/vehicle360";
import { formatDateLatin } from "@/lib/numberUtils";

type Tx = (ar: string, en: string) => string;

function money(value: unknown) {
  return `OMR ${Number(value || 0).toFixed(3)}`;
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatDateLatin(String(value).slice(0, 10));
  return `${formatDateLatin(parsed.toISOString().slice(0, 10))} ${parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function presenceLabel(value: string, tx: Tx) {
  const key = String(value || "").toLowerCase();
  if (["in_workshop", "received", "at_workshop", "repairing"].includes(key)) return tx("داخل الورشة", "In workshop");
  if (["delivered", "with_customer", "customer"].includes(key)) return tx("مع العميل", "With customer");
  if (["returned", "returned_to_workshop"].includes(key)) return tx("عادت إلى الورشة", "Returned to workshop");
  return value || tx("لا يوجد أمر نشط", "No active order");
}

function SummaryCard({ label, value, tone = "default", icon: Icon }: { label: string; value: string; tone?: "default" | "good" | "warning" | "bad"; icon: typeof Activity }) {
  const styles = tone === "good" ? "border-emerald-500/30 bg-emerald-500/5" : tone === "warning" ? "border-amber-500/30 bg-amber-500/5" : tone === "bad" ? "border-red-500/30 bg-red-500/5" : "border-border bg-card";
  return <div className={`rounded-xl border p-3 ${styles}`}><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><div className="text-base font-bold text-foreground">{value}</div></div>;
}

export function VehicleOverviewPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const navigate = useNavigate();
  const activeOrder = data.activeWorkOrder;
  const activeClaim = data.activeClaim;
  const integrityWarnings = [
    activeClaim && !activeClaim.job_order_id && !activeClaim.auto_job_order_id ? tx("المطالبة النشطة غير مرتبطة بأمر عمل", "Active claim is not linked to a work order") : null,
    activeOrder && activeOrder.claim_id && !data.claims.some((claim) => claim.id === activeOrder.claim_id) ? tx("أمر العمل يشير إلى مطالبة غير موجودة في سجل المركبة", "Work order points to a claim missing from this vehicle history") : null,
  ].filter(Boolean) as string[];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label={tx("الحالة الحالية", "Current status")} value={presenceLabel(data.currentPresence, tx)} tone={data.activeWorkOrder ? "warning" : "good"} icon={MapPin} />
      <SummaryCard label={tx("أمر العمل النشط", "Active work order")} value={activeOrder?.order_number || "—"} tone={activeOrder ? "warning" : "default"} icon={Wrench} />
      <SummaryCard label={tx("المطالبة النشطة", "Active claim")} value={activeClaim?.claim_number || "—"} tone={activeClaim ? "warning" : "default"} icon={Shield} />
      <SummaryCard label={tx("آخر حركة", "Latest activity")} value={dateTime(data.timeline[0]?.occurredAt)} icon={Activity} />
    </div>
    {(activeOrder || activeClaim) && <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><div className="font-bold text-foreground">{tx("الملف التشغيلي الحالي", "Current operational file")}</div><div className="mt-1 text-sm text-muted-foreground">{activeOrder ? `${tx("أمر العمل", "Work order")}: ${activeOrder.order_number} · ${activeOrder.status}` : ""}{activeClaim ? ` · ${tx("المطالبة", "Claim")}: ${activeClaim.claim_number} · ${activeClaim.status}` : ""}</div></div>
        <div className="flex flex-wrap gap-2">{activeOrder && <Button size="sm" onClick={() => navigate(`/work-orders/${encodeURIComponent(activeOrder.order_number || activeOrder.id)}`)}>{tx("فتح أمر العمل", "Open work order")}</Button>}{activeClaim && <Button size="sm" variant="outline" onClick={() => navigate(`/insurance/${activeClaim.id}`)}>{tx("فتح المطالبة", "Open claim")}</Button>}</div>
      </div>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label={tx("عدد الزيارات", "Workshop visits")} value={String(Math.max(data.entries.length, data.workOrders.length))} icon={History} />
      <SummaryCard label={tx("أول زيارة", "First visit")} value={data.firstVisitAt ? formatDateLatin(data.firstVisitAt.slice(0, 10)) : "—"} icon={CalendarDays} />
      <SummaryCard label={tx("آخر زيارة", "Latest visit")} value={data.lastVisitAt ? formatDateLatin(data.lastVisitAt.slice(0, 10)) : "—"} icon={CalendarDays} />
      <SummaryCard label={tx("صور ومستندات", "Photos and documents")} value={String(data.media.length)} icon={Camera} />
    </div>
    {integrityWarnings.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><div className="mb-2 flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" />{tx("تنبيهات الربط", "Link integrity alerts")}</div>{integrityWarnings.map((warning) => <div key={warning} className="text-sm text-muted-foreground">• {warning}</div>)}</div>}
  </div>;
}

const CATEGORY_LABELS: Record<VehicleTimelineCategory, [string, string]> = {
  vehicle: ["المركبة", "Vehicle"], entry: ["الدخول", "Entry"], work_order: ["أوامر العمل", "Work orders"], claim: ["المطالبات", "Claims"], parts: ["قطع الغيار", "Parts"], expense: ["المصروفات", "Expenses"], invoice: ["الفواتير", "Invoices"], payment: ["الدفعات", "Payments"], media: ["الوسائط", "Media"], delivery: ["التسليم", "Delivery"], audit: ["التدقيق", "Audit"],
};

function eventIcon(category: VehicleTimelineCategory) {
  const map = { vehicle: CarFront, entry: ClipboardList, work_order: Wrench, claim: Shield, parts: Package, expense: Receipt, invoice: FileText, payment: Banknote, media: Camera, delivery: CheckCircle2, audit: Activity };
  return map[category];
}

function EventRow({ row, tx }: { row: VehicleTimelineEvent; tx: Tx }) {
  const navigate = useNavigate();
  const Icon = eventIcon(row.category);
  return <div className="relative grid gap-3 border-b border-border/60 p-4 last:border-0 md:grid-cols-[175px_1fr_auto]">
    <div className="text-xs text-muted-foreground">{dateTime(row.occurredAt)}</div>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><span className="font-bold text-foreground">{tx(row.titleAr, row.titleEn)}</span>{row.status && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">{row.status}</span>}</div>{(row.detailAr || row.detailEn) && <div className="mt-1 ps-9 text-sm text-muted-foreground">{tx(row.detailAr || "", row.detailEn || row.detailAr || "")}</div>}{row.actor && <div className="mt-1 flex items-center gap-1 ps-9 text-[11px] text-muted-foreground"><UserRound className="h-3 w-3" />{row.actor}</div>}</div>
    <div className="flex items-center gap-2 md:justify-end">{typeof row.amount === "number" && row.amount !== 0 && <span className="font-mono text-sm font-bold">{money(row.amount)}</span>}{row.href && <Button size="sm" variant="outline" onClick={() => navigate(row.href!)}>{tx("فتح", "Open")}</Button>}</div>
  </div>;
}

export function VehicleTimelinePanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => data.timeline.filter((row) => {
    const matchesCategory = category === "all" || row.category === category;
    const haystack = `${row.titleAr} ${row.titleEn} ${row.detailAr || ""} ${row.detailEn || ""} ${row.status || ""}`.toLowerCase();
    return matchesCategory && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  }), [category, data.timeline, search]);
  return <div className="overflow-hidden rounded-xl border bg-card">
    <div className="grid gap-2 border-b p-3 md:grid-cols-[1fr_240px_auto]">
      <div className="relative"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tx("ابحث في تاريخ المركبة...", "Search vehicle history...")} className="ps-9" /></div>
      <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{tx("كل الأحداث", "All events")}</SelectItem>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{tx(label[0], label[1])}</SelectItem>)}</SelectContent></Select>
      <div className="self-center text-xs text-muted-foreground">{filtered.length} / {data.timeline.length}</div>
    </div>
    {filtered.length ? filtered.map((row) => <EventRow key={row.id} row={row} tx={tx} />) : <div className="p-12 text-center text-sm text-muted-foreground">{tx("لا توجد أحداث مطابقة", "No matching events")}</div>}
  </div>;
}

export function VehicleVisitsPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const navigate = useNavigate();
  return <div className="space-y-3">{data.workOrders.map((order) => {
    const claim = data.claims.find((item) => item.id === order.claim_id || item.job_order_id === order.id || item.auto_job_order_id === order.id);
    const orderExpenses = data.expenses.filter((expense) => [order.id, order.order_number].includes(expense.work_order_id) || [order.id, order.order_number].includes(expense.linked_work_order_id));
    const expenseTotal = orderExpenses.reduce((sum, expense) => sum + Number(expense.total || expense.amount || 0), 0);
    const end = order.vehicle_delivered_at || order.work_completed_at || order.completed_at;
    const days = order.entry_date ? Math.max(0, Math.ceil(((end ? new Date(end) : new Date()).getTime() - new Date(order.entry_date).getTime()) / 86400000)) : 0;
    return <div key={order.id} className="rounded-xl border bg-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-primary">{order.order_number}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{order.status}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{order.work_order_type === "insurance" || claim ? tx("تأمين", "Insurance") : tx("كاش", "Cash")}</span></div><div className="mt-2 text-sm text-muted-foreground">{order.service_type || order.diagnosis || order.description || "—"}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{tx("الدخول", "Entry")}: {dateTime(order.entry_date || order.received_at)}</span><span>{tx("الخروج", "Exit")}: {dateTime(end)}</span><span>{tx("أيام الورشة", "Workshop days")}: {days}</span>{claim && <span>{tx("المطالبة", "Claim")}: {claim.claim_number}</span>}</div></div><div className="grid grid-cols-2 gap-2 text-end text-xs sm:grid-cols-3"><div><div className="text-muted-foreground">{tx("إجمالي الأمر", "Order total")}</div><b>{money(order.final_total)}</b></div><div><div className="text-muted-foreground">{tx("المصروف الفعلي", "Actual expenses")}</div><b>{money(expenseTotal)}</b></div><Button size="sm" variant="outline" onClick={() => navigate(`/work-orders/${encodeURIComponent(order.order_number || order.id)}`)}>{tx("فتح الأمر", "Open order")}</Button></div></div></div>;
  })}{data.workOrders.length === 0 && <div className="rounded-xl border p-12 text-center text-muted-foreground">{tx("لا توجد زيارات أو أوامر عمل مرتبطة", "No linked visits or work orders")}</div>}</div>;
}

export function VehicleClaimsPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const navigate = useNavigate();
  return <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[760px] text-sm"><thead className="bg-secondary/50 text-xs text-muted-foreground"><tr><th className="p-3 text-start">{tx("رقم المطالبة", "Claim number")}</th><th className="p-3 text-start">{tx("شركة التأمين", "Insurance company")}</th><th className="p-3 text-start">{tx("الحالة", "Status")}</th><th className="p-3 text-start">{tx("أمر العمل", "Work order")}</th><th className="p-3 text-start">{tx("المعتمد", "Approved")}</th><th className="p-3 text-start">{tx("التسليم", "Delivery")}</th><th /></tr></thead><tbody>{data.claims.map((claim) => { const order = data.workOrders.find((row) => row.id === claim.job_order_id || row.id === claim.auto_job_order_id || row.claim_id === claim.id); return <tr key={claim.id} className="border-t"><td className="p-3 font-mono font-bold text-primary">{claim.claim_number}</td><td className="p-3">{claim.insurance_company || "—"}</td><td className="p-3">{claim.status}</td><td className="p-3 font-mono">{order?.order_number || <span className="text-amber-600">{tx("غير مرتبط", "Not linked")}</span>}</td><td className="p-3">{money(claim.approved_amount || claim.lpo_amount)}</td><td className="p-3">{dateTime(claim.vehicle_delivered_at || claim.delivered_at)}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => navigate(`/insurance/${claim.id}`)}>{tx("فتح", "Open")}</Button></td></tr>; })}</tbody></table>{data.claims.length === 0 && <div className="p-12 text-center text-muted-foreground">{tx("لا توجد مطالبات مرتبطة", "No linked claims")}</div>}</div>;
}

export function VehicleFinancialPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const f = data.financial;
  const navigate = useNavigate();
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SummaryCard label={tx("الإيراد المفوتر", "Billed revenue")} value={money(f.totalBilled)} tone="good" icon={CircleDollarSign} /><SummaryCard label={tx("المحصل فعليًا", "Actually collected")} value={money(f.totalCollected)} tone="good" icon={Banknote} /><SummaryCard label={tx("المصروف الفعلي", "Actual expenses")} value={money(f.expenses)} tone="warning" icon={TrendingDown} /><SummaryCard label={tx("ربح الفواتير", "Invoice margin")} value={money(f.invoiceMargin)} tone={f.invoiceMargin >= 0 ? "good" : "bad"} icon={TrendingUp} /></div>
    <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border bg-card p-4"><h3 className="mb-3 flex items-center gap-2 font-bold"><WalletCards className="h-4 w-4" />{tx("الفصل المالي", "Financial separation")}</h3><div className="grid grid-cols-2 gap-3 text-sm"><Metric label={tx("فواتير الكاش", "Cash billed")} value={f.cashBilled} /><Metric label={tx("تحصيل الكاش", "Cash collected")} value={f.cashCollected} /><Metric label={tx("فواتير التأمين", "Insurance billed")} value={f.insuranceBilled} /><Metric label={tx("تحصيل التأمين", "Insurance collected")} value={f.insuranceCollected} /><Metric label={tx("الرصيد المتبقي", "Outstanding")} value={f.outstanding} /><Metric label={tx("صافي التدفق بعد المصروف", "Cashflow after expenses")} value={f.cashflowMargin} /></div></div><div className="rounded-xl border bg-card p-4"><h3 className="mb-3 flex items-center gap-2 font-bold"><Receipt className="h-4 w-4" />{tx("تفصيل المصروف", "Expense breakdown")}</h3><div className="grid grid-cols-2 gap-3 text-sm"><Metric label={tx("قطع الغيار", "Spare parts")} value={f.partsExpenses} /><Metric label={tx("مصروفات أخرى", "Other expenses")} value={f.otherExpenses} /><Metric label={tx("عدد السندات", "Expense records")} plain={String(data.expenses.filter((row) => !row.deleted_at && !row.archived_at).length)} /><Metric label={tx("عدد الدفعات", "Payment records")} plain={String(data.cashPayments.length + data.insurancePayments.filter((row) => row.status === "cleared").length)} /></div></div></div>
    <FinancialTable title={tx("الفواتير المرتبطة", "Linked invoices")} headers={[tx("النوع", "Type"), tx("الرقم", "Number"), tx("التاريخ", "Date"), tx("الإجمالي", "Total"), tx("الحالة", "Status")]} rows={[...data.cashInvoices.map((row) => ({ id: row.id, cells: [tx("كاش", "Cash"), row.doc_number, dateTime(row.issued_at || row.date), money(row.total), row.status], href: `/sales/invoices/${row.id}` })), ...data.insuranceInvoices.map((row) => ({ id: row.id, cells: [tx("تأمين", "Insurance"), row.invoice_number, dateTime(row.issued_at || row.invoice_date), money(row.total), row.status], href: row.claim_id ? `/insurance/${row.claim_id}` : null }))]} onOpen={(href) => href && navigate(href)} tx={tx} />
    <FinancialTable title={tx("المصروفات المرتبطة", "Linked expenses")} headers={[tx("السند", "Voucher"), tx("التاريخ", "Date"), tx("التصنيف", "Category"), tx("الإجمالي", "Total"), tx("الحالة", "Status")]} rows={data.expenses.filter((row) => !row.deleted_at && !row.archived_at).map((row) => ({ id: row.id, cells: [row.voucher_number, dateTime(row.date), row.category_name || row.expense_type, money(row.total || row.amount), row.status || "—"], href: `/accounting/expenses/${row.id}/edit` }))} onOpen={(href) => href && navigate(href)} tx={tx} />
  </div>;
}

function Metric({ label, value, plain }: { label: string; value?: number; plain?: string }) { return <div className="rounded-lg bg-secondary/40 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono font-bold">{plain ?? money(value)}</div></div>; }

function FinancialTable({ title, headers, rows, onOpen, tx }: { title: string; headers: string[]; rows: Array<{ id: string; cells: unknown[]; href?: string | null }>; onOpen: (href?: string | null) => void; tx: Tx }) {
  return <div className="overflow-x-auto rounded-xl border bg-card"><div className="border-b p-4 font-bold">{title}</div><table className="w-full min-w-[720px] text-sm"><thead className="bg-secondary/40 text-xs text-muted-foreground"><tr>{headers.map((header) => <th key={header} className="p-3 text-start">{header}</th>)}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t">{row.cells.map((cell, index) => <td key={index} className="p-3">{String(cell ?? "—")}</td>)}<td className="p-3">{row.href && <Button size="sm" variant="ghost" onClick={() => onOpen(row.href)}>{tx("فتح", "Open")}</Button>}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="p-10 text-center text-muted-foreground">{tx("لا توجد سجلات", "No records")}</div>}</div>;
}

export function VehicleMediaPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  return <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">{data.media.map((media) => <div key={media.id} className="overflow-hidden rounded-xl border bg-card">{media.public_url && media.media_type !== "document" ? <a href={media.public_url} target="_blank" rel="noreferrer"><img src={media.public_url} alt={media.caption || media.file_name || "vehicle"} loading="lazy" className="aspect-video w-full object-cover" /></a> : <div className="flex aspect-video items-center justify-center bg-secondary/40"><FileText className="h-8 w-8 text-muted-foreground" /></div>}<div className="p-3"><div className="truncate text-sm font-semibold">{media.caption || media.file_name || media.category}</div><div className="mt-1 text-xs text-muted-foreground">{dateTime(media.uploaded_at || media.created_at)} · {media.category}</div>{media.public_url && <a href={media.public_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary underline">{tx("فتح الملف", "Open file")}</a>}</div></div>)}{data.media.length === 0 && <div className="col-span-full rounded-xl border p-12 text-center text-muted-foreground">{tx("لا توجد صور أو مستندات مرتبطة", "No linked photos or documents")}</div>}</div>;
}

export function VehicleAuditPanel({ data, tx }: { data: Vehicle360Snapshot; tx: Tx }) {
  const events = data.timeline.filter((row) => row.category === "audit");
  return <div className="overflow-hidden rounded-xl border bg-card">{events.map((row) => <EventRow key={row.id} row={row} tx={tx} />)}{events.length === 0 && <div className="p-12 text-center text-muted-foreground">{tx("لا توجد أحداث تدقيق محفوظة", "No audit events recorded")}</div>}</div>;
}
