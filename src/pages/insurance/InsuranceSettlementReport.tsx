import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Columns3, FileSpreadsheet, Filter, Loader2, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fetchSettlementReport } from "@/lib/insuranceSettlementService";
import { EMPTY_SETTLEMENT_FILTERS, filterSettlements, summarizeSettlements } from "@/lib/insuranceSettlementReport";
import { SETTLEMENT_COLUMNS, DEFAULT_SETTLEMENT_COLUMNS, settlementCell, settlementNumericColumns, exportSettlementXlsx, settlementReportHtml, prepareSettlementReportHtml, type SettlementColumn } from "@/lib/insuranceSettlementExport";
import "@/lib/i18n/insuranceSettlements";

const PdfPreviewDialog = lazy(() => import("@/components/PdfPreviewDialog"));
const formatAmount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function InsuranceSettlementReport() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const rtl = i18n.resolvedLanguage?.startsWith("ar") ?? false;
  const [filters, setFilters] = useState({ ...EMPTY_SETTLEMENT_FILTERS });
  const [columns, setColumns] = useState<SettlementColumn[]>(DEFAULT_SETTLEMENT_COLUMNS);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ html: string; tenant: string; language: string } | null>(null);
  const currentScope = useRef("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  currentScope.current = `${profile?.tenant_id}:${profile?.user_id}:${i18n.resolvedLanguage}`;
  const query = useQuery({
    queryKey: ["insurance-settlement-report", profile?.tenant_id, profile?.user_id],
    enabled: !!profile?.tenant_id,
    queryFn: ({ signal }) => fetchSettlementReport(profile!.tenant_id, signal),
    staleTime: 0, refetchOnWindowFocus: true,
  });
  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const ready = !query.isError && !query.isFetching && !!query.data && !invalidDates;
  const rows = useMemo(() => ready ? filterSettlements(query.data!, filters) : [], [ready, query.data, filters]);
  const summary = summarizeSettlements(rows);
  const companies = [...new Set((query.data || []).map(r => r.company))].sort((a, b) => a.localeCompare(b));
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pages);
  const pageRows = rows.slice((currentPage - 1) * 25, currentPage * 25);
  const change = (values: Partial<typeof filters>) => { setFilters(f => ({ ...f, ...values })); setPage(1); setPreview(null); };
  const selected = SETTLEMENT_COLUMNS.filter(k => columns.includes(k));
  const filterLabel = [t(`insuranceSettlements.${filters.dateBasis}`), `${filters.from || "—"} → ${filters.to || "—"}`,
    filters.company === "all" ? t("insuranceSettlements.allCompanies") : filters.company,
    filters.search, filters.reviewOnly ? t("insuranceSettlements.reviewOnly") : ""].filter(Boolean).join(" · ");

  async function exportReport(kind: "excel" | "pdf") {
    if (!ready || !rows.length || !profile?.tenant_id) return;
    const tenant = profile.tenant_id;
    const scope = currentScope.current;
    setBusy(true);
    try {
      if (!mounted.current || scope !== currentScope.current) return;
      if (kind === "excel") await exportSettlementXlsx(rows, selected, t, rtl, () => mounted.current && scope === currentScope.current);
      else {
        const html = await prepareSettlementReportHtml(settlementReportHtml(rows, selected, t, rtl, filterLabel), () => mounted.current && scope === currentScope.current);
        if (mounted.current && scope === currentScope.current) setPreview({ html, tenant, language: i18n.resolvedLanguage });
      }
    } catch { toast.error(t("insuranceSettlements.exportError")); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4" dir={rtl ? "rtl" : "ltr"}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-xl font-bold">{t("insuranceSettlements.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("insuranceSettlements.subtitle")}</p></div>
      <Button asChild variant="outline"><Link to="/insurance/accounting">{t("insuranceSettlements.back")}</Link></Button>
    </header>
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-muted-foreground" aria-hidden="true" />
        <Input className="min-w-0 flex-1 basis-64" aria-label={t("insuranceSettlements.search")} placeholder={t("insuranceSettlements.search")}
          value={filters.search} onChange={e => change({ search: e.target.value })} />
        <Button variant="outline" onClick={() => change({ ...EMPTY_SETTLEMENT_FILTERS })}>{t("insuranceSettlements.clear")}</Button>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RotateCcw className="me-2 size-4" />{t("insuranceSettlements.refresh")}</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Label className="space-y-2">{t("insuranceSettlements.company")}<select aria-label={t("insuranceSettlements.company")}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={filters.company} onChange={e => change({ company: e.target.value })}>
          <option value="all">{t("insuranceSettlements.allCompanies")}</option>{companies.map(c => <option key={c} value={c}>{c || "—"}</option>)}
        </select></Label>
        <Label className="space-y-2">{t("insuranceSettlements.dateBasis")}<select aria-label={t("insuranceSettlements.dateBasis")}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={filters.dateBasis}
          onChange={e => change({ dateBasis: e.target.value as "invoice" | "settlement" })}>
          <option value="invoice">{t("insuranceSettlements.invoice")}</option><option value="settlement">{t("insuranceSettlements.settlement")}</option>
        </select></Label>
        <Label className="space-y-2">{t("insuranceSettlements.from")}<Input aria-label={t("insuranceSettlements.from")} type="date" value={filters.from} onChange={e => change({ from: e.target.value })} /></Label>
        <Label className="space-y-2">{t("insuranceSettlements.to")}<Input aria-label={t("insuranceSettlements.to")} type="date" value={filters.to} onChange={e => change({ to: e.target.value })} /></Label>
      </div>
      <Label className="flex items-center gap-2"><input type="checkbox" checked={filters.reviewOnly} onChange={e => change({ reviewOnly: e.target.checked })} />{t("insuranceSettlements.reviewOnly")}</Label>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("insuranceSettlements.scope")}</p>
    </div>
    {invalidDates && <p role="alert" className="text-sm text-destructive">{t("insuranceSettlements.invalidDates")}</p>}
    {query.isFetching && <div role="status" className="flex items-center gap-2 p-6"><Loader2 className="size-5 animate-spin" />{t("insuranceSettlements.loading")}</div>}
    {query.isError && <p role="alert" className="rounded-xl border border-destructive p-4 text-destructive">{t("insuranceSettlements.error")}</p>}
    {ready && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(["invoices", "recordedDiscount", "verifiedDiscount", "paid", "remaining"] as const).map(k => <div key={k} className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t(`insuranceSettlements.${k}`)}</p><p className="mt-2 text-lg font-bold" dir="ltr">{k === "invoices" ? summary[k] : `${formatAmount(summary[k])} OMR`}</p>
        </div>)}
      </div>
      {summary.review > 0 && <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t("insuranceSettlements.reviewNote")} ({summary.review})</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !rows.length} onClick={() => void exportReport("excel")}><FileSpreadsheet className="me-2 size-4" />{t("insuranceSettlements.excel")}</Button>
        <Button variant="outline" disabled={busy || !rows.length} onClick={() => void exportReport("pdf")}><Printer className="me-2 size-4" />{t("insuranceSettlements.preview")}</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><Columns3 className="me-2 size-4" />{t("insuranceSettlements.columns")} ({selected.length})</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">{SETTLEMENT_COLUMNS.map(k => <DropdownMenuCheckboxItem key={k} checked={columns.includes(k)}
            disabled={columns.length === 1 && columns.includes(k)} onSelect={e => e.preventDefault()}
            onCheckedChange={checked => setColumns(current => checked ? [...current, k] : current.filter(c => c !== k))}>{t(`insuranceSettlements.fields.${k}`)}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
        </DropdownMenu>
        {busy && <Loader2 role="status" aria-label={t("insuranceSettlements.loading")} className="size-4 animate-spin" />}
        <span className="ms-auto text-sm text-muted-foreground">{rows.length} {t("insuranceSettlements.rows")}</span>
      </div>
      <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm">
        <thead><tr className="bg-muted/50">{selected.map(k => <th scope="col" key={k} className="whitespace-nowrap p-3 text-start font-medium">{t(`insuranceSettlements.fields.${k}`)}</th>)}</tr></thead>
        <tbody>{pageRows.map(r => <tr key={r.invoiceId} className="border-t border-border">{selected.map(k => <td key={k} className="p-3 align-top">
          {k === "invoiceNumber" ? <Link className="whitespace-nowrap text-primary underline" to={`/insurance/accounting?invoice=${encodeURIComponent(r.invoiceId)}`}>{r.invoiceNumber}</Link>
            : k === "claimNumber" ? <Link className="text-primary underline" to={`/insurance/${r.claimId}`}>{r.claimNumber || "—"}</Link>
            : k === "status" ? <span className={r.issues.length ? "text-warning" : "text-success"} title={String(settlementCell(r, k, t))}>{t(`insuranceSettlements.${r.issues.length ? "review" : "verified"}`)}</span>
            : settlementNumericColumns.has(k) ? <span dir="ltr" className="whitespace-nowrap tabular-nums">{formatAmount(Number(settlementCell(r, k, t)))}</span>
            : <span className="block min-w-24 max-w-80 break-words">{settlementCell(r, k, t) || "—"}</span>}
        </td>)}</tr>)}</tbody>
      </table>{!rows.length && <p className="p-8 text-center text-muted-foreground">{t("insuranceSettlements.empty")}</p>}</div>
      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t("insuranceSettlements.previous")}</Button>
        <span className="text-sm" dir="ltr">{currentPage} / {pages}</span>
        <Button variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t("insuranceSettlements.next")}</Button>
      </div>
    </>}
    {preview && ready && preview.tenant === profile?.tenant_id && preview.language === i18n.resolvedLanguage && <Suspense fallback={<Loader2 className="size-5 animate-spin" />}><PdfPreviewDialog open onOpenChange={open => !open && setPreview(null)}
      title={t("insuranceSettlements.title")} fileName="insurance-settlement-discounts.pdf" htmlContent={preview.html} /></Suspense>}
  </div>;
}
