import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Search, Users, UserCheck, UserX, Wallet, BadgeDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrStore, type Employee } from "@/lib/hrStore";
import StatCard from "@/components/StatCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function EmployeesList() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const [, force] = useState(0);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const u = hrStore.subscribe(() => force((x) => x + 1));
    return () => { u(); };
  }, []);

  const employees = hrStore.listEmployees();
  const filtered = useMemo(() => employees.filter((e) => {
    if (statusFilter !== "all" && e.employmentStatus !== statusFilter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      e.name.toLowerCase().includes(s) ||
      (e.employeeNumber || "").toLowerCase().includes(s) ||
      (e.position || "").toLowerCase().includes(s) ||
      (e.phone || "").toLowerCase().includes(s)
    );
  }), [employees, q, statusFilter]);

  const stats = {
    total: employees.length,
    active: employees.filter((e) => e.employmentStatus === "active").length,
    onLeave: employees.filter((e) => e.employmentStatus === "on_leave").length,
    payroll: employees.reduce((s, e) => s + (e.baseSalary || 0) + (e.housingAllowance || 0) + (e.transportAllowance || 0) + (e.otherAllowances || 0), 0),
  };

  function newEmployee() {
    const e: Employee = {
      id: hrStore.uid(),
      employeeNumber: hrStore.nextEmployeeNumber(),
      name: "",
      position: "",
      employmentStatus: "active",
      baseSalary: 0,
      createdAt: hrStore.nowIso(),
      updatedAt: hrStore.nowIso(),
    };
    hrStore.saveEmployee(e);
    navigate(`/staff/${e.id}`);
  }

  return (
    <div className="space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "الفنيون والموظفون" : "Staff & Technicians"}</h1>
          <p className="text-sm text-muted-foreground">{isAr ? "نظام موارد بشرية متكامل" : "Integrated HR system"}</p>
        </div>
        <Button onClick={newEmployee} className="gap-2 bg-success hover:bg-success/90 text-success-foreground">
          <Plus className="h-4 w-4" /> {isAr ? "موظف جديد" : "New employee"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title={isAr ? "إجمالي الموظفين" : "Total"} value={stats.total} icon={Users} variant="info" />
        <StatCard title={isAr ? "نشط" : "Active"} value={stats.active} icon={UserCheck} variant="success" />
        <StatCard title={isAr ? "في إجازة" : "On leave"} value={stats.onLeave} icon={UserX} variant="gold" />
        <StatCard title={isAr ? "إجمالي الرواتب" : "Payroll"} value={`${stats.payroll.toFixed(0)} ر.ع`} icon={Wallet} variant="info" />
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-2.5 start-3 h-4 w-4 text-muted-foreground" />
          <Input className="ps-9" placeholder={isAr ? "ابحث بالاسم/الرقم/الوظيفة" : "Search"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
            <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
            <SelectItem value="on_leave">{isAr ? "في إجازة" : "On leave"}</SelectItem>
            <SelectItem value="suspended">{isAr ? "موقوف" : "Suspended"}</SelectItem>
            <SelectItem value="terminated">{isAr ? "انتهت خدمته" : "Terminated"}</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
            {isAr ? "لا يوجد موظفون. اضغط (موظف جديد)." : "No employees yet."}
          </div>
        )}
        {filtered.map((e) => (
          <Link key={e.id} to={`/staff/${e.id}`}>
            <Card className="p-4 hover:border-primary/50 hover:shadow-md transition cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={e.avatarUrl} />
                  <AvatarFallback className="gradient-gold text-primary-foreground">{e.name.slice(0, 2) || "؟"}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{e.name || (isAr ? "بدون اسم" : "Unnamed")}</div>
                      <div className="text-xs text-muted-foreground truncate">{e.position || "—"}</div>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{e.employeeNumber}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <StatusPill status={e.employmentStatus} isAr={isAr} />
                    <div className="text-xs flex items-center gap-1 text-muted-foreground">
                      <BadgeDollarSign className="h-3 w-3" />
                      <span className="font-mono">{(e.baseSalary || 0).toFixed(0)} ر.ع</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status, isAr }: { status: string; isAr: boolean }) {
  const map: Record<string, { ar: string; en: string; cls: string }> = {
    active:     { ar: "نشط",        en: "Active",     cls: "bg-success/15 text-success" },
    on_leave:   { ar: "في إجازة",   en: "On leave",   cls: "bg-warning/15 text-warning" },
    suspended:  { ar: "موقوف",      en: "Suspended",  cls: "bg-muted text-muted-foreground" },
    terminated: { ar: "منتهي",      en: "Terminated", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] || map.active;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{isAr ? m.ar : m.en}</span>;
}
