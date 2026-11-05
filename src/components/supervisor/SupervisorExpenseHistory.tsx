import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useCan } from "@/lib/rbac";
import { listExpenses, type ExpenseManagementRow } from "@/lib/expenses/expenseClassificationService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SupervisorExpenseHistory({ onEdit }: { onEdit?: (expense: ExpenseManagementRow) => void }) {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation("supervisorWorkspace");
  const canExpense = useCan("Expenses", "Add/Edit/Delete");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const query = useQuery({ queryKey: ["expense_management", "supervisor_history", profile?.tenant_id, page, search, channel],
    queryFn: () => listExpenses(page, 20, { search, channel: channel === "all" ? "" : channel }),
    enabled: Boolean(profile?.tenant_id) && canExpense, staleTime: 0 });
  if (!canExpense) return <p role="alert">{t("noPermission")}</p>;
  const pages = Math.max(1, Number(query.data?.pagination?.totalPages || 1));
  return <section className="space-y-4">
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(draftSearch.trim()); setPage(1); }}>
      <Input aria-label={t("searchLabel")} className="min-h-11 min-w-48 flex-1" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} />
      <select aria-label={t("channel")} className="min-h-11 rounded-md border border-input bg-background px-3" value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}>
        {["all", "cash", "insurance"].map((value) => <option key={value} value={value}>{t(value)}</option>)}
      </select><Button type="submit" className="min-h-11">{t("searchLabel")}</Button>
    </form>
    <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs">{t("expenseRefundHelp")}</p>
    {query.isPending ? <p role="status">{t("loading")}</p> : query.isError ? <div role="alert"><p>{t("loadError")}</p><Button className="mt-2 min-h-11" onClick={() => void query.refetch()}>{t("retry")}</Button></div>
      : <div className="space-y-3">{query.data?.rows.map((expense) => <article key={expense.id} className="space-y-2 rounded-xl border border-border p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-mono font-semibold">{expense.voucher_number}</h3><span dir="ltr">{expense.date}</span></div>
        <p>{String(expense.description || "—")}</p>
        <p>{t(expense.expense_scope === "operating" ? "expenseOperating" : "expenseLinked")} · {expense.channel === "insurance" ? t("insurance") : expense.channel === "cash" ? t("cash") : "—"}</p>
        <p>{t("expenseAmount")}: <bdi>{Number(expense.total ?? expense.amount ?? 0).toLocaleString(i18n.language, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</bdi></p>
        {onEdit && <Button className="min-h-11" variant="outline" onClick={() => onEdit(expense)}>{t("editExpense")}</Button>}
      </article>)}{!query.data?.rows.length && <p role="status">{t("expenseEmpty")}</p>}</div>}
    {!query.isError && query.data && <div className="flex items-center justify-center gap-3">
      <Button className="min-h-11" variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button>
      <span className="text-sm">{t("pagination", { page, pages })}</span>
      <Button className="min-h-11" variant="outline" disabled={page >= pages || query.isFetching} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button>
    </div>}
  </section>;
}
