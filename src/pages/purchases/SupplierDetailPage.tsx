import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Car, FileDown, FileSpreadsheet, Printer, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatOMR } from "@/lib/money";
import { queryKeys } from "@/lib/queryKeys";
import { fetchSupplierStatement, type SupplierStatementRow } from "@/lib/purchases/supplierAccountService";
import { exportReportRowsToPdf, exportReportRowsToXlsx, printReportRows, type ReportExportRequest } from "@/lib/reports-center/reportExportService";

type Column = { key: keyof SupplierStatementRow & string; ar: string; en: string; type?: "money" | "date" | "text"; default?: boolean };
const COLUMNS: Column[] = [
  { key: "date", ar: "التاريخ", en: "Date", type: "date", default: true }, { key: "source_type", ar: "المصدر", en: "Source", default: true },
  { key: "reference", ar: "المرجع", en: "Reference", default: true }, { key: "supplier_invoice_number", ar: "فاتورة المورد", en: "Supplier Invoice", default: true },
  { key: "description", ar: "البيان", en: "Description", default: true }, { key: "subtotal", ar: "قبل الضريبة", en: "Subtotal", type: "money" },
  { key: "vat", ar: "الضريبة", en: "VAT", type: "money" }, { key: "purchase_amount", ar: "المشتريات", en: "Purchases", type: "money", default: true },
  { key: "paid_amount", ar: "المدفوع", en: "Paid", type: "money", default: true }, { key: "running_balance", ar: "الرصيد", en: "Balance", type: "money", default: true },
  { key: "payment_method", ar: "طريقة الدفع", en: "Payment Method" }, { key: "vehicle_linked", ar: "مرتبط بمركبة", en: "Vehicle Linked", default: true },
  { key: "work_order_number", ar: "أمر العمل", en: "Work Order", default: true }, { key: "claim_number", ar: "المطالبة", en: "Claim No." },
  { key: "plate_number", ar: "رقم اللوحة", en: "Plate Number", default: true }, { key: "plate_letters", ar: "حروف اللوحة", en: "Plate Letters", default: true },
  { key: "plate_country", ar: "الدولة", en: "Country" }, { key: "vehicle_make", ar: "الماركة", en: "Make", default: true },
  { key: "vehicle_model", ar: "الموديل", en: "Model", default: true }, { key: "vin", ar: "رقم الهيكل", en: "VIN" },
];
const sources: Record<string, { ar: string; en: string }> = { purchase_invoice: { ar: "فاتورة شراء", en: "Purchase invoice" }, expense: { ar: "شراء/مصروف مباشر", en: "Direct purchase/expense" }, payment: { ar: "دفعة مورد", en: "Supplier payment" }, legacy_payment: { ar: "دفعة فاتورة محفوظة", en: "Stored invoice payment" } };
function monthBounds() { const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth() - 11, 1); const iso = (date: Date) => date.toISOString().slice(0, 10); return { from: iso(from), to: iso(now) }; }

export default function SupplierDetailPage() {
  const { supplierId = "" } = useParams();
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.startsWith("en") ?? false;
  const bounds = useMemo(monthBounds, []);
  const [from, setFrom] = useState(bounds.from); const [to, setTo] = useState(bounds.to);
  const [source, setSource] = useState(""); const [vehicle, setVehicle] = useState(""); const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(COLUMNS.filter((column) => column.default).map((column) => column.key));
  const statement = useQuery({
    queryKey: queryKeys.suppliers.detail(supplierId, { tenantId: profile?.tenant_id, from, to }),
    queryFn: () => fetchSupplierStatement({ tenantId: profile!.tenant_id, supplierId, from, to }),
    enabled: Boolean(profile?.tenant_id && supplierId), staleTime: 60_000, gcTime: 600_000, refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => (statement.data?.rows || []).filter((row) => {
    if (source && row.source_type !== source) return false;
    if (vehicle === "yes" && !row.vehicle_linked) return false;
    if (vehicle === "no" && row.vehicle_linked) return false;
    const query = search.trim().toLowerCase();
    return !query || [row.reference, row.supplier_invoice_number, row.description, row.work_order_number, row.claim_number, row.plate_number, row.plate_letters, row.vehicle_make, row.vehicle_model, row.vin].some((value) => String(value || "").toLowerCase().includes(query));
  }), [statement.data?.rows, source, vehicle, search]);
  const columns = COLUMNS.filter((column) => visible.includes(column.key));
  const exportRequest = (): ReportExportRequest<SupplierStatementRow> => ({
    fileName: `Supplier_Statement_${statement.data?.supplier.name || supplierId}_${from}_${to}.xlsx`, sheetName: "Supplier Statement",
    title: `${english ? "Supplier Statement" : "كشف حساب المورد"} — ${statement.data?.supplier.name || ""}`,
    filters: [{ label: english ? "From" : "من", value: from }, { label: english ? "To" : "إلى", value: to }, { label: english ? "Source" : "المصدر", value: source || (english ? "All" : "الكل") }, { label: english ? "Vehicle linkage" : "الارتباط بالمركبة", value: vehicle || (english ? "All" : "الكل") }],
    columns: columns.map((column) => ({ key: column.key, label: english ? column.en : column.ar, type: column.type })), rows, language: english ? "en" : "ar",
    generatedBy: profile?.full_name || profile?.user_id || "System",
  });
  async function runExport(kind: "xlsx" | "pdf" | "print") { try { if (!rows.length) throw new Error(english ? "No matching rows." : "لا توجد سجلات مطابقة."); if (!columns.length) throw new Error(english ? "Select at least one column." : "اختر عمودًا واحدًا على الأقل."); const request = exportRequest(); if (kind === "xlsx") exportReportRowsToXlsx(request); else if (kind === "pdf") await exportReportRowsToPdf(request); else await printReportRows(request); } catch (error) { toast.error((error as Error).message); } }
  const Back = english ? ArrowLeft : ArrowRight;
  const display = (row: SupplierStatementRow, column: Column) => { const raw = row[column.key]; if (column.type === "money") return formatOMR(Number(raw || 0)); if (column.type === "date") return String(raw || "").slice(0, 10) || "—"; if (column.key === "source_type") return sources[String(raw)]?.[english ? "en" : "ar"] || String(raw || "—"); if (column.key === "vehicle_linked") return raw ? (english ? "Yes" : "نعم") : (english ? "No" : "لا"); return raw === "" || raw === null || raw === undefined ? "—" : String(raw); };
  return <main className="mx-auto max-w-[1700px] space-y-5 p-4 md:p-6" dir={english ? "ltr" : "rtl"}>
    <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><Button asChild variant="outline" size="icon"><Link to="/inventory/suppliers"><Back size={16}/></Link></Button><div><p className="text-xs text-muted-foreground">{english ? "Inventory / Suppliers" : "المخزون / الموردون"}</p><h1 className="text-2xl font-bold">{statement.data?.supplier.name || (english ? "Supplier Account" : "حساب المورد")}</h1><p className="text-sm text-muted-foreground">{statement.data?.supplier.phone || "—"} · {statement.data?.supplier.tax_number || (english ? "No tax number" : "لا يوجد رقم ضريبي")}</p></div></div><div className="flex flex-wrap gap-2"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><SlidersHorizontal size={15}/>{english ? "Columns" : "الأعمدة"} ({visible.length})</Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-[70vh] overflow-y-auto"><DropdownMenuLabel>{english ? "Display and export" : "العرض والتصدير"}</DropdownMenuLabel>{COLUMNS.map((column) => <DropdownMenuCheckboxItem key={column.key} checked={visible.includes(column.key)} onCheckedChange={(checked) => setVisible((current) => checked ? [...new Set([...current, column.key])] : current.filter((key) => key !== column.key))}>{english ? column.en : column.ar}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><Button variant="outline" onClick={() => void runExport("xlsx")}><FileSpreadsheet size={15}/>Excel</Button><Button variant="outline" onClick={() => void runExport("pdf")}><FileDown size={15}/>PDF</Button><Button variant="outline" onClick={() => void runExport("print")}><Printer size={15}/>{english ? "Print" : "طباعة"}</Button></div></header>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">{[[english ? "All-time purchases" : "إجمالي المشتريات", statement.data?.summary.purchases], [english ? "All-time payments" : "إجمالي المدفوع", statement.data?.summary.payments], [english ? "Current outstanding" : "الرصيد المستحق الحالي", statement.data?.summary.outstanding], [english ? "Opening balance" : "رصيد بداية الفترة", statement.data?.openingBalance], [english ? "Vehicle-linked purchases" : "مشتريات مرتبطة بمركبات", statement.data?.summary.vehicleLinkedPurchases]].map(([label, amount]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-lg font-bold" dir="ltr">{formatOMR(Number(amount || 0))}</p></CardContent></Card>)}</section>
    <Card><CardContent className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-5"><label className="text-xs">{english ? "From" : "من"}<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label className="text-xs">{english ? "To" : "إلى"}<Input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label><label className="text-xs">{english ? "Source" : "المصدر"}<select className="h-10 w-full rounded-md border bg-background px-2" value={source} onChange={(event) => setSource(event.target.value)}><option value="">{english ? "All" : "الكل"}</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label[english ? "en" : "ar"]}</option>)}</select></label><label className="text-xs">{english ? "Vehicle linkage" : "الارتباط بمركبة"}<select className="h-10 w-full rounded-md border bg-background px-2" value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option value="">{english ? "All" : "الكل"}</option><option value="yes">{english ? "Vehicle linked" : "مرتبطة بمركبة"}</option><option value="no">{english ? "Not linked" : "غير مرتبطة"}</option></select></label><label className="text-xs">{english ? "Search" : "بحث"}<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={english ? "Invoice, vehicle, work order…" : "فاتورة، مركبة، أمر عمل…"}/></label></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Car size={18}/>{english ? "Purchases and supplier account movements" : "المشتريات وحركات حساب المورد"}</CardTitle></CardHeader><CardContent className="p-0">{statement.isLoading ? <div className="p-16 text-center">{english ? "Loading…" : "جاري التحميل…"}</div> : statement.isError ? <div className="p-12 text-center text-destructive">{(statement.error as Error).message}</div> : !rows.length ? <div className="p-16 text-center text-muted-foreground">{english ? "No matching movements." : "لا توجد حركات مطابقة."}</div> : <div className="overflow-x-auto"><Table className="min-w-max"><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key}>{english ? column.en : column.ar}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id} className={row.vehicle_linked ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}>{columns.map((column) => <TableCell key={column.key} dir={column.type === "money" ? "ltr" : undefined}>{display(row, column)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</CardContent></Card>
  </main>;
}
