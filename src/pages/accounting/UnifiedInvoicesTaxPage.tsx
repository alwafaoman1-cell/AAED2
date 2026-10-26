import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileDown, FileText, Printer, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchAllUnifiedInvoices,
  fetchUnifiedInvoicePage,
  summarizeOutputVat,
  type UnifiedInvoiceFilters,
  type UnifiedInvoiceRow,
} from "@/lib/unifiedInvoiceTaxReport";
import type { ReportExportRequest } from "@/lib/reports-center/reportExportService";

const PAGE_SIZE = 50;
type ExportKind = "invoices" | "vat-xlsx" | "vat-pdf" | "vat-print";
type VatSummary = ReturnType<typeof summarizeOutputVat>;
type ExportRow = UnifiedInvoiceRow & { source_label: string };

function displayMoney(value: unknown): string {
  return `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} OMR`;
}

function invoiceLink(row: UnifiedInvoiceRow): string {
  if (row.source_type === "customer_invoice") return `/sales/invoices/${row.id}`;
  return row.claim_id ? `/insurance/claims/${row.claim_id}` : "/insurance/accounting";
}

export default function UnifiedInvoicesTaxPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const [filters, setFilters] = useState<UnifiedInvoiceFilters>({
    tenantId: "", source: "all", from: "", to: "", invoiceNumber: "", party: "", plate: "", collection: "all", vat: "all",
  });
  const currentFilters = { ...filters, tenantId };
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [plateSearch, setPlateSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [summarySnapshot, setSummarySnapshot] = useState<{ key: string; value: VatSummary } | null>(null);
  const filterKey = JSON.stringify(currentFilters);
  const summary = summarySnapshot?.key === filterKey ? summarySnapshot.value : null;

  const query = useQuery({
    queryKey: ["unified-invoice-tax", currentFilters, page],
    queryFn: () => fetchUnifiedInvoicePage(currentFilters, page, PAGE_SIZE),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  function update<K extends keyof UnifiedInvoiceFilters>(key: K, value: UnifiedInvoiceFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSummarySnapshot(null);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setFilters((current) => ({ ...current, invoiceNumber: invoiceSearch.trim(), party: partySearch.trim(), plate: plateSearch.trim() }));
    setPage(1);
    setSummarySnapshot(null);
  }

  function resetFilters() {
    setFilters({ tenantId: "", source: "all", from: "", to: "", invoiceNumber: "", party: "", plate: "", collection: "all", vat: "all" });
    setInvoiceSearch("");
    setPartySearch("");
    setPlateSearch("");
    setPage(1);
    setSummarySnapshot(null);
  }

  function sourceLabel(row: UnifiedInvoiceRow): string {
    return row.source_type === "insurance_invoice" ? t("unifiedInvoices.insurance") : t("unifiedInvoices.cash");
  }

  function collectionLabel(row: UnifiedInvoiceRow): string {
    if (Number(row.outstanding || 0) <= 0.001) return t("unifiedInvoices.paid");
    if (Number(row.paid || 0) > 0.001) return t("unifiedInvoices.partial");
    return t("unifiedInvoices.unpaid");
  }

  function makeExportRequest(rows: UnifiedInvoiceRow[], tax: VatSummary, vatOnly: boolean): ReportExportRequest<ExportRow> {
    const mapped = rows.map((row) => ({ ...row, source_label: sourceLabel(row) }));
    const columns: ReportExportRequest<ExportRow>["columns"] = [
      { key: "source_label", label: t("unifiedInvoices.source") },
      { key: "invoice_number", label: t("unifiedInvoices.number") },
      { key: "invoice_date", label: t("unifiedInvoices.date"), type: "date" },
      { key: "party_name", label: t("unifiedInvoices.party") },
      { key: "subtotal", label: t("unifiedInvoices.subtotal"), type: "money" },
      { key: "vat", label: t("unifiedInvoices.vat"), type: "money" },
      { key: "total", label: t("unifiedInvoices.total"), type: "money" },
    ];
    if (!vatOnly) columns.push(
      { key: "paid", label: t("unifiedInvoices.collected"), type: "money" },
      { key: "outstanding", label: t("unifiedInvoices.outstanding"), type: "money" },
      { key: "plate", label: t("unifiedInvoices.plate") },
      { key: "claim_number", label: t("unifiedInvoices.claim") },
      { key: "status", label: t("unifiedInvoices.documentStatus") },
    );
    const filterLabels = [
      { label: t("unifiedInvoices.from"), value: filters.from || t("unifiedInvoices.all") },
      { label: t("unifiedInvoices.to"), value: filters.to || t("unifiedInvoices.all") },
      { label: t("unifiedInvoices.source"), value: filters.source === "all" ? t("unifiedInvoices.all") : filters.source === "insurance_invoice" ? t("unifiedInvoices.insurance") : t("unifiedInvoices.cash") },
      { label: t("unifiedInvoices.cashVat"), value: displayMoney(tax.customer_invoice.vat) },
      { label: t("unifiedInvoices.insuranceVat"), value: displayMoney(tax.insurance_invoice.vat) },
      { label: t("unifiedInvoices.totalVat"), value: displayMoney(tax.all.vat) },
      { label: t("unifiedInvoices.rows"), value: String(tax.all.count) },
    ];
    const fileName = `${vatOnly ? "output-vat" : "all-invoices"}_${filters.from || "all"}_${filters.to || "all"}.xlsx`;
    return {
      fileName,
      sheetName: vatOnly ? "Output VAT" : "Invoices",
      title: vatOnly ? t("unifiedInvoices.vatExtractTitle") : t("unifiedInvoices.title"),
      filters: filterLabels,
      columns,
      rows: mapped,
      language,
      generatedBy: profile?.full_name || profile?.user_id || "Authenticated user",
      generatedAt: new Date().toISOString(),
    };
  }

  async function exportRows(kind: ExportKind) {
    if (exporting) return;
    const exportFilters = currentFilters;
    const exportKey = filterKey;
    setExporting(kind);
    try {
      const rows = await fetchAllUnifiedInvoices(exportFilters);
      if (!rows.length) throw new Error("NO_ROWS");
      const tax = summarizeOutputVat(rows);
      setSummarySnapshot({ key: exportKey, value: tax });
      const request = makeExportRequest(rows, tax, kind !== "invoices");
      const { exportReportRowsToXlsx, exportReportRowsToPdf, printReportRows } = await import("@/lib/reports-center/reportExportService");
      if (kind === "vat-pdf") await exportReportRowsToPdf(request);
      else if (kind === "vat-print") await printReportRows(request);
      else exportReportRowsToXlsx(request);
      toast.success(t("unifiedInvoices.exportComplete"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["EXPORT_RANGE_TOO_LARGE", "INVOICE_SET_CHANGED_DURING_EXPORT", "INCOMPLETE_INVOICE_EXPORT", "INVALID_DATE_RANGE", "NO_ROWS"];
      toast.error(known.includes(message) ? t(`unifiedInvoices.errors.${message}`) : (message || t("unifiedInvoices.loadError")));
    } finally {
      setExporting(null);
    }
  }

  const rows = query.data?.rows || [];
  const count = query.data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="space-y-5 p-3 sm:p-5" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("unifiedInvoices.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("unifiedInvoices.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()} disabled={!tenantId || query.isFetching}>
          <RefreshCw className="me-2 size-4" /> {t("unifiedInvoices.refresh")}
        </Button>
      </header>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm"><span>{t("unifiedInvoices.source")}</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={filters.source} onChange={(e) => update("source", e.target.value as UnifiedInvoiceFilters["source"])}>
              <option value="all">{t("unifiedInvoices.all")}</option><option value="customer_invoice">{t("unifiedInvoices.cash")}</option><option value="insurance_invoice">{t("unifiedInvoices.insurance")}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm"><span>{t("unifiedInvoices.from")}</span><Input type="date" value={filters.from} onChange={(e) => update("from", e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>{t("unifiedInvoices.to")}</span><Input type="date" value={filters.to} onChange={(e) => update("to", e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span>{t("unifiedInvoices.collection")}</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={filters.collection} onChange={(e) => update("collection", e.target.value as UnifiedInvoiceFilters["collection"])}>
              <option value="all">{t("unifiedInvoices.all")}</option><option value="paid">{t("unifiedInvoices.paid")}</option><option value="partial">{t("unifiedInvoices.partial")}</option><option value="unpaid">{t("unifiedInvoices.unpaid")}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm"><span>{t("unifiedInvoices.vatFilter")}</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={filters.vat} onChange={(e) => update("vat", e.target.value as UnifiedInvoiceFilters["vat"])}>
              <option value="all">{t("unifiedInvoices.all")}</option><option value="positive">{t("unifiedInvoices.withVat")}</option><option value="zero">{t("unifiedInvoices.zeroVat")}</option>
            </select>
          </label>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={applySearch}>
          <label className="min-w-40 flex-1 space-y-1 text-sm"><span>{t("unifiedInvoices.number")}</span><Input value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} /></label>
          <label className="min-w-40 flex-1 space-y-1 text-sm"><span>{t("unifiedInvoices.party")}</span><Input value={partySearch} onChange={(e) => setPartySearch(e.target.value)} /></label>
          <label className="min-w-28 flex-1 space-y-1 text-sm"><span>{t("unifiedInvoices.plate")}</span><Input value={plateSearch} onChange={(e) => setPlateSearch(e.target.value)} /></label>
          <Button type="submit"><Search className="me-2 size-4" />{t("unifiedInvoices.apply")}</Button>
          <Button type="button" variant="outline" onClick={resetFilters}>{t("unifiedInvoices.reset")}</Button>
        </form>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">{t("unifiedInvoices.vatExtractTitle")}</h2><p className="text-xs text-muted-foreground">{t("unifiedInvoices.vatNote")}</p></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={Boolean(exporting) || count === 0} onClick={() => void exportRows("invoices")}><FileDown className="me-2 size-4" />{t("unifiedInvoices.exportInvoices")}</Button>
            <Button disabled={Boolean(exporting) || count === 0} onClick={() => void exportRows("vat-xlsx")}><FileDown className="me-2 size-4" />{t("unifiedInvoices.exportVat")}</Button>
            <Button variant="outline" disabled={Boolean(exporting) || count === 0} onClick={() => void exportRows("vat-pdf")}><FileText className="me-2 size-4" />PDF</Button>
            <Button variant="outline" disabled={Boolean(exporting) || count === 0} onClick={() => void exportRows("vat-print")}><Printer className="me-2 size-4" />{t("unifiedInvoices.print")}</Button>
          </div>
        </div>
        {summary && <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-muted p-3">{t("unifiedInvoices.cashVat")}<strong className="block text-lg">{displayMoney(summary.customer_invoice.vat)}</strong></div>
          <div className="rounded-lg bg-muted p-3">{t("unifiedInvoices.insuranceVat")}<strong className="block text-lg">{displayMoney(summary.insurance_invoice.vat)}</strong></div>
          <div className="rounded-lg bg-primary/10 p-3">{t("unifiedInvoices.totalVat")}<strong className="block text-lg">{displayMoney(summary.all.vat)}</strong></div>
        </div>}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b p-4 text-sm"><span>{t("unifiedInvoices.rows")}: {count}</span><span>{t("unifiedInvoices.page")} {page} / {totalPages}</span></div>
        {query.isLoading ? <p className="p-6 text-center">{t("unifiedInvoices.loading")}</p>
          : query.isError ? <p role="alert" className="p-6 text-center text-destructive">{t("unifiedInvoices.loadError")}</p>
            : rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">{t("unifiedInvoices.noRows")}</p>
              : <>
                <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted/50 text-muted-foreground"><tr>{["source", "number", "date", "party", "plate", "subtotal", "vat", "total", "collection"].map((key) => <th key={key} className="whitespace-nowrap p-3 text-start">{t(`unifiedInvoices.${key}`)}</th>)}</tr></thead>
                  <tbody>{rows.map((row) => <tr key={`${row.source_type}:${row.id}`} className="border-t hover:bg-muted/30">
                    <td className="p-3">{sourceLabel(row)}</td><td className="p-3 font-mono"><Link className="text-primary underline-offset-2 hover:underline" to={invoiceLink(row)}>{row.invoice_number || "—"}</Link></td>
                    <td className="p-3 whitespace-nowrap">{row.invoice_date || "—"}</td><td className="p-3">{row.party_name || "—"}</td><td className="p-3">{row.plate || "—"}</td>
                    <td className="p-3 whitespace-nowrap font-mono">{displayMoney(row.subtotal)}</td><td className="p-3 whitespace-nowrap font-mono">{displayMoney(row.vat)}</td><td className="p-3 whitespace-nowrap font-mono">{displayMoney(row.total)}</td><td className="p-3">{collectionLabel(row)}</td>
                  </tr>)}</tbody>
                </table></div>
                <div className="space-y-2 p-3 md:hidden">{rows.map((row) => <div key={`${row.source_type}:${row.id}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between gap-2"><Link className="font-mono font-semibold text-primary" to={invoiceLink(row)}>{row.invoice_number || "—"}</Link><span>{sourceLabel(row)}</span></div>
                  <div className="mt-1 text-muted-foreground">{row.invoice_date || "—"} · {row.party_name || "—"}</div>
                  <div className="mt-2 flex justify-between"><span>{t("unifiedInvoices.vat")}: {displayMoney(row.vat)}</span><strong>{displayMoney(row.total)}</strong></div>
                  <div className="mt-1 text-muted-foreground">{collectionLabel(row)}</div>
                </div>)}</div>
              </>}
        <div className="flex items-center justify-between border-t p-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("unifiedInvoices.previous")}</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t("unifiedInvoices.next")}</Button>
        </div>
      </Card>
    </div>
  );
}
