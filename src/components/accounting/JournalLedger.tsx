import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, BookOpen, Download, Scale, Filter, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StatCard from "@/components/StatCard";
import { journalStore, type JournalEntry, type JournalSource, type JournalAccount } from "@/lib/journalStore";
import { JOURNAL_SOURCE_LABEL as SOURCE_LABEL, getJournalSourceRoute } from "@/lib/journalSourceLink";
import { formatMoney, getTemplateSettings } from "@/lib/pdfGenerator";

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "كل المصادر" },
  ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })),
];

const fmt = (n: number) => formatMoney(n, { withSymbol: false });
const sym = () => getTemplateSettings().currencySymbol || "ر.ع";

export default function JournalLedger() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<JournalEntry[]>(journalStore.getAll());
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => journalStore.subscribe(() => setEntries([...journalStore.getAll()])), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((e) => {
        if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (!q) return true;
        return (
          e.id.toLowerCase().includes(q) ||
          e.sourceId.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.debitAccount.toLowerCase().includes(q) ||
          e.creditAccount.toLowerCase().includes(q)
        );
      });
  }, [entries, search, sourceFilter, from, to]);

  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);

  // ميزان مراجعة: تجميع حسب الحساب (مدين/دائن)
  const trialBalance = useMemo(() => {
    const map = new Map<JournalAccount, { debit: number; credit: number }>();
    for (const e of filtered) {
      const d = map.get(e.debitAccount) || { debit: 0, credit: 0 };
      d.debit += e.amount;
      map.set(e.debitAccount, d);
      const c = map.get(e.creditAccount) || { debit: 0, credit: 0 };
      c.credit += e.amount;
      map.set(e.creditAccount, c);
    }
    return Array.from(map.entries())
      .map(([account, v]) => ({ account, debit: v.debit, credit: v.credit, balance: v.debit - v.credit }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [filtered]);

  const totalDebit = trialBalance.reduce((s, r) => s + r.debit, 0);
  const totalCredit = trialBalance.reduce((s, r) => s + r.credit, 0);

  const exportCsv = () => {
    const rows = [
      ["JE No", "Date", "Source", "Source ID", "Debit Account", "Credit Account", "Amount", "Description"],
      ...filtered.map((e) => [
        e.id, e.date, SOURCE_LABEL[e.source] || e.source, e.sourceId,
        e.debitAccount, e.creditAccount, e.amount.toFixed(3), e.description,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `journal_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="عدد القيود" value={filtered.length} icon={BookOpen} variant="info" />
        <StatCard title="إجمالي المدين" value={`${fmt(totalDebit)} ${sym()}`} icon={Scale} variant="success" />
        <StatCard title="إجمالي الدائن" value={`${fmt(totalCredit)} ${sym()}`} icon={Scale} variant="warning" />
        <StatCard title="الفرق" value={`${fmt(totalDebit - totalCredit)} ${sym()}`} icon={BookOpen} variant={Math.abs(totalDebit - totalCredit) < 0.01 ? "success" : "destructive" as any} />
      </div>

      {/* فلاتر */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="relative md:col-span-2">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث: رقم/وصف/حساب..." className="pr-9" />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger><Filter size={14} className="ml-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="من" />
        <div className="flex gap-2">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="إلى" />
          <Button variant="outline" size="icon" onClick={exportCsv} title="تصدير CSV"><Download size={16} /></Button>
        </div>
      </div>

      <Tabs defaultValue="entries" dir="rtl">
        <TabsList>
          <TabsTrigger value="entries"><BookOpen size={14} className="ml-1" /> القيود</TabsTrigger>
          <TabsTrigger value="trial"><Scale size={14} className="ml-1" /> ميزان المراجعة</TabsTrigger>
        </TabsList>

        <TabsContent value="entries">
          <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                    <th className="text-right py-3 px-4 font-medium">رقم القيد</th>
                    <th className="text-right py-3 px-4 font-medium">التاريخ</th>
                    <th className="text-right py-3 px-4 font-medium">المصدر</th>
                    <th className="text-right py-3 px-4 font-medium">حساب مدين</th>
                    <th className="text-right py-3 px-4 font-medium">حساب دائن</th>
                    <th className="text-right py-3 px-4 font-medium">المبلغ</th>
                    <th className="text-right py-3 px-4 font-medium hidden lg:table-cell">الوصف</th>
                    <th className="text-right py-3 px-4 font-medium">المستند</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">لا توجد قيود مطابقة</td></tr>
                  )}
                  {filtered.map((e) => {
                    const route = getJournalSourceRoute(e.source, e.sourceId);
                    return (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-3 px-4 font-mono text-xs text-primary font-semibold" dir="ltr">{e.id}</td>
                        <td className="py-3 px-4 text-muted-foreground font-mono text-xs" dir="ltr">{e.date}</td>
                        <td className="py-3 px-4">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground">{SOURCE_LABEL[e.source] || e.source}</span>
                          <span className="text-[10px] text-muted-foreground font-mono mr-1" dir="ltr">{e.sourceId}</span>
                        </td>
                        <td className="py-3 px-4 text-success">{e.debitAccount}</td>
                        <td className="py-3 px-4 text-destructive">{e.creditAccount}</td>
                        <td className="py-3 px-4 text-foreground font-mono font-semibold" dir="ltr">{fmt(e.amount)}</td>
                        <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell text-xs">{e.description}</td>
                        <td className="py-3 px-4">
                          {route ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() => navigate(route)}
                              title="فتح المستند الأصلي"
                            >
                              <ExternalLink size={12} /> فتح
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-secondary/40 font-bold">
                      <td colSpan={5} className="py-3 px-4 text-right">الإجمالي</td>
                      <td className="py-3 px-4 font-mono" dir="ltr">{fmt(totalAmount)}</td>
                      <td className="hidden lg:table-cell" />
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="trial">
          <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                    <th className="text-right py-3 px-4 font-medium">الحساب</th>
                    <th className="text-right py-3 px-4 font-medium">مدين</th>
                    <th className="text-right py-3 px-4 font-medium">دائن</th>
                    <th className="text-right py-3 px-4 font-medium">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.length === 0 && (
                    <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">لا توجد بيانات</td></tr>
                  )}
                  {trialBalance.map((r) => (
                    <tr key={r.account} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="py-3 px-4 font-medium">{r.account}</td>
                      <td className="py-3 px-4 font-mono text-success" dir="ltr">{fmt(r.debit)}</td>
                      <td className="py-3 px-4 font-mono text-destructive" dir="ltr">{fmt(r.credit)}</td>
                      <td className={`py-3 px-4 font-mono font-bold ${r.balance >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">
                        {fmt(Math.abs(r.balance))} {r.balance >= 0 ? "مدين" : "دائن"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {trialBalance.length > 0 && (
                  <tfoot>
                    <tr className="bg-secondary/40 font-bold">
                      <td className="py-3 px-4 text-right">الإجمالي</td>
                      <td className="py-3 px-4 font-mono" dir="ltr">{fmt(totalDebit)}</td>
                      <td className="py-3 px-4 font-mono" dir="ltr">{fmt(totalCredit)}</td>
                      <td className={`py-3 px-4 font-mono ${Math.abs(totalDebit - totalCredit) < 0.01 ? "text-success" : "text-destructive"}`} dir="ltr">
                        {Math.abs(totalDebit - totalCredit) < 0.01 ? "متوازن ✓" : `فرق ${fmt(Math.abs(totalDebit - totalCredit))}`}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
