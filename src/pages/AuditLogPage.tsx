import { useEffect, useMemo, useState } from "react";
import { History, Search, Filter, Download, Trash2, Plus, Pencil, RotateCw, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  auditLogStore,
  getActionLabel,
  getEntityLabel,
  type AuditAction,
  type AuditEntity,
} from "@/lib/auditLogStore";
import { canViewAuditLog } from "@/lib/permissions";
import { toast } from "sonner";

const ACTION_ICONS: Record<AuditAction, any> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: RotateCw,
  status_change: Activity,
  payment: History,
  refund: RotateCw,
};

const ACTION_COLORS: Record<AuditAction, string> = {
  create: "bg-success/15 text-success",
  update: "bg-info/15 text-info",
  delete: "bg-destructive/15 text-destructive",
  restore: "bg-primary/15 text-primary",
  status_change: "bg-warning/15 text-warning",
  payment: "bg-success/15 text-success",
  refund: "bg-warning/15 text-warning",
};

const ENTITY_OPTIONS: AuditEntity[] = [
  "work_order", "expense", "receipt", "deposit", "inspection",
  "invoice", "vehicle", "customer", "claim", "cashbox",
];

export default function AuditLogPage() {
  const [, force] = useState(0);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => auditLogStore.subscribe(() => force((n) => n + 1)), []);

  const allowed = canViewAuditLog();
  const all = auditLogStore.getAll();

  const filtered = useMemo(() => {
    return all
      .filter((e) => {
        if (actionFilter !== "all" && e.action !== actionFilter) return false;
        if (entityFilter !== "all" && e.entity !== entityFilter) return false;
        if (dateFrom && e.timestamp < dateFrom) return false;
        if (dateTo && e.timestamp > dateTo + "T23:59:59") return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = `${e.label} ${e.description || ""} ${e.entityId} ${e.actor}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [all, actionFilter, entityFilter, dateFrom, dateTo, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = filtered.filter((e) => e.timestamp.startsWith(today)).length;
    const deletes = filtered.filter((e) => e.action === "delete").length;
    return { total, todayCount, deletes };
  }, [filtered]);

  if (!allowed) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">ليس لديك صلاحية لعرض سجل النشاط.</p>
      </div>
    );
  }

  const exportCsv = () => {
    if (filtered.length === 0) return toast.error("لا توجد سجلات للتصدير");
    const headers = ["التاريخ والوقت", "المستخدم", "الإجراء", "الكيان", "المعرف", "الوصف", "المبلغ"];
    const rows = filtered.map((e) => [
      new Date(e.timestamp).toLocaleString("ar"),
      e.actor,
      getActionLabel(e.action),
      getEntityLabel(e.entity),
      e.entityId,
      (e.description || e.label).replace(/[\n,]/g, " "),
      e.amount?.toLocaleString() || "-",
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير سجل النشاط");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <History className="text-primary" size={24} /> سجل النشاط
          </h1>
          <p className="text-sm text-muted-foreground">
            تتبع كل العمليات الحساسة في النظام (إنشاء، تعديل، حذف، تغيير حالة)
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} className="gap-2">
          <Download size={16} /> تصدير CSV
        </Button>
      </div>

      {/* إحصائيات */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">إجمالي العمليات</p>
          <p className="text-xl font-bold text-foreground mt-1">{stats.total}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">عمليات اليوم</p>
          <p className="text-xl font-bold text-info mt-1">{stats.todayCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-card">
          <p className="text-xs text-muted-foreground">عمليات حذف</p>
          <p className="text-xl font-bold text-destructive mt-1">{stats.deletes}</p>
        </div>
      </div>

      {/* فلاتر */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input placeholder="بحث في الوصف، المعرف، أو المستخدم..."
              value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger><Filter size={14} className="ml-1" /><SelectValue placeholder="الإجراء" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الإجراءات</SelectItem>
              <SelectItem value="create">{getActionLabel("create")}</SelectItem>
              <SelectItem value="update">{getActionLabel("update")}</SelectItem>
              <SelectItem value="delete">{getActionLabel("delete")}</SelectItem>
              <SelectItem value="status_change">{getActionLabel("status_change")}</SelectItem>
              <SelectItem value="restore">{getActionLabel("restore")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger><SelectValue placeholder="النوع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {ENTITY_OPTIONS.map((e) => (
                <SelectItem key={e} value={e}>{getEntityLabel(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="من" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="إلى" />
          </div>
        </div>
      </div>

      {/* القائمة */}
      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="text-right p-3">الوقت</th>
                <th className="text-right p-3">المستخدم</th>
                <th className="text-right p-3">الإجراء</th>
                <th className="text-right p-3">النوع</th>
                <th className="text-right p-3">المعرف</th>
                <th className="text-right p-3">الوصف</th>
                <th className="text-right p-3">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center p-12 text-muted-foreground">
                  <History size={40} className="mx-auto mb-2 opacity-30" />
                  <p>لا توجد سجلات مطابقة</p>
                </td></tr>
              ) : filtered.map((e) => {
                const Icon = ACTION_ICONS[e.action];
                return (
                  <tr key={e.id} className="border-t border-border/50 hover:bg-secondary/10">
                    <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="p-3 text-foreground">{e.actor}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium ${ACTION_COLORS[e.action]}`}>
                        <Icon size={10} /> {getActionLabel(e.action)}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px]">{getEntityLabel(e.entity)}</Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-primary">{e.entityId}</td>
                    <td className="p-3 text-foreground text-xs">
                      <p className="font-medium">{e.label}</p>
                      {e.description && <p className="text-muted-foreground text-[10px]">{e.description}</p>}
                    </td>
                    <td className="p-3 font-bold text-foreground whitespace-nowrap">
                      {e.amount ? `${e.amount.toLocaleString()} ر.ع` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
