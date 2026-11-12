import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { journalStore, type JournalEntry } from "@/lib/journalStore";
import { expensesStore } from "@/lib/expensesStore";
import { salesStore } from "@/lib/salesStore";
import { getJournalSourceRoute, JOURNAL_SOURCE_LABEL } from "@/lib/journalSourceLink";
import { formatMoney } from "@/lib/pdfGenerator";
import { useTranslation } from "react-i18next";
import "@/lib/i18n/performanceReadSummaries";

const REVENUE_ACCOUNTS = new Set(["إيرادات المبيعات", "إيرادات خدمات الورشة"]);
const EXPENSE_ACCOUNTS = new Set(["مصروف شراء", "مصاريف شحن", "مصاريف تشغيلية", "خصم ممنوح"]);

function recentEntries() {
  return journalStore.getAll().filter((entry) => {
    if (entry.source === "insurance_claim") return false;
    if (entry.source === "expense") { const expense = expensesStore.getById(entry.sourceId); return !!expense && !expense.deletedAt && !expense.archivedAt; }
    if (entry.source === "sales_invoice" || entry.source === "work_order_invoice") { const doc = salesStore.get(entry.sourceId); return !!doc && !doc.isDeleted && doc.status !== "cancelled" && doc.status !== "draft"; }
    return true;
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,8);
}
/** Legacy activity is intentionally loaded only after the user opens it. */
export default function RecentAccountingEntries() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [entries,setEntries] = useState<JournalEntry[]>(recentEntries);
  useEffect(() => {
    const refresh = () => setEntries(recentEntries());
    const subs = [journalStore.subscribe(refresh),expensesStore.subscribe(refresh),salesStore.subscribe(refresh)];
    void expensesStore.refresh();
    return () => subs.forEach(unsubscribe => { unsubscribe(); });
  },[]);
  if (entries.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("performanceRead.noEntries")}</p>;
  return <div className="space-y-2">{entries.map(entry => {
    const isRevenue = REVENUE_ACCOUNTS.has(entry.creditAccount);
    const isExpense = EXPENSE_ACCOUNTS.has(entry.debitAccount);
    const sign = isRevenue ? "+" : isExpense ? "-" : "";
    const cls = isRevenue ? "bg-success/15 text-success" : isExpense ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground";
    const Icon = isRevenue ? TrendingUp : isExpense ? TrendingDown : BookOpen;
    const route = getJournalSourceRoute(entry.source, entry.sourceId);
    return <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg p-3 hover:bg-secondary/20"><span className={`rounded-lg p-2 ${cls}`}><Icon className="h-4 w-4"/></span><div className="min-w-0 flex-1"><p className="truncate text-sm">{entry.description}</p><p className="font-mono text-xs text-muted-foreground" dir="ltr">{entry.date} · {entry.id} · {JOURNAL_SOURCE_LABEL[entry.source]}</p></div><span className={`font-mono text-sm ${cls}`} dir="ltr">{sign}{formatMoney(entry.amount)}</span>{route&&<Button size="icon" variant="outline" aria-label={entry.description} onClick={()=>navigate(route)}><ExternalLink className="h-4 w-4"/></Button>}</div>;
  })}</div>;
}
