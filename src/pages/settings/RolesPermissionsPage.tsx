import { useEffect, useMemo, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, ArrowRight, Shield, ShieldCheck, Users as UsersIcon, Wrench,
  FileText, Calculator, Lock, Database, Layers, Printer, Save, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Role = "admin" | "manager" | "technician" | "insurance" | "accountant";

const ROLE_DEFS: { key: Role; ar: string; en: string; descAr: string; descEn: string; icon: any; color: string }[] = [
  {
    key: "admin", ar: "المدير العام", en: "Admin",
    descAr: "صلاحيات كاملة على كل شيء — مستخدمين، إعدادات، حذف، استرجاع، قيود محاسبية.",
    descEn: "Full access: users, settings, deletions, restores, accounting entries.",
    icon: ShieldCheck, color: "text-red-500 bg-red-500/10",
  },
  {
    key: "manager", ar: "مدير الورشة", en: "Workshop Manager",
    descAr: "إدارة العمليات اليومية: أوامر العمل، الفواتير، العملاء، المخزون، التقارير.",
    descEn: "Daily operations: work orders, invoices, customers, inventory, reports.",
    icon: Shield, color: "text-amber-500 bg-amber-500/10",
  },
  {
    key: "technician", ar: "فني", en: "Technician",
    descAr: "تنفيذ أوامر العمل، تحديث الحالات، إضافة فحوصات وصور المراحل.",
    descEn: "Execute work orders, update statuses, add inspections and stage photos.",
    icon: Wrench, color: "text-blue-500 bg-blue-500/10",
  },
  {
    key: "insurance", ar: "موظف تأمين", en: "Insurance Officer",
    descAr: "متابعة مطالبات التأمين، الفحوصات التأمينية، الفواتير والدفعات لشركات التأمين.",
    descEn: "Insurance claims, takaful inspections, insurer invoices and payments.",
    icon: FileText, color: "text-sky-500 bg-sky-500/10",
  },
  {
    key: "accountant", ar: "محاسب", en: "Accountant",
    descAr: "دفتر اليومية، المصروفات، التقارير المالية، تسويات الموردين والعملاء.",
    descEn: "Journal entries, expenses, financial reports, supplier/customer reconciliations.",
    icon: Calculator, color: "text-emerald-500 bg-emerald-500/10",
  },
];

type Cell = "Y" | "N" | "P"; // Yes / No / Partial

interface PermRow {
  module: string; moduleEn: string;
  action: string; actionEn: string;
  perms: Record<Role, Cell>;
  notes?: string;
}

const ROWS: PermRow[] = [
  { module: "لوحة التحكم", moduleEn: "Dashboard", action: "عرض", actionEn: "View",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "Y", accountant: "Y" } },

  { module: "أوامر العمل", moduleEn: "Work Orders", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "أوامر العمل", moduleEn: "Work Orders", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },
  { module: "أوامر العمل", moduleEn: "Work Orders", action: "تغيير الحالة + تسليم", actionEn: "Status & delivery",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "N", accountant: "N" } },

  { module: "الفحص العام", moduleEn: "General Inspection", action: "إنشاء + PDF", actionEn: "Create + PDF",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "فحص التأمين", moduleEn: "Insurance Inspection", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "Y", accountant: "N" } },

  { module: "العملاء", moduleEn: "Customers", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "العملاء", moduleEn: "Customers", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المركبات", moduleEn: "Vehicles", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "المركبات", moduleEn: "Vehicles", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المبيعات/الفواتير", moduleEn: "Sales/Invoices", action: "إنشاء", actionEn: "Create",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المبيعات/الفواتير", moduleEn: "Sales/Invoices", action: "تعديل/حذف", actionEn: "Edit/Delete",
    perms: { admin: "Y", manager: "P", technician: "N", insurance: "N", accountant: "P" },
    notes: "Only drafts; posted invoices need admin." },

  { module: "التأمين/المطالبات", moduleEn: "Insurance/Claims", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "P", insurance: "Y", accountant: "N" } },
  { module: "التأمين/المطالبات", moduleEn: "Insurance/Claims", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },
  { module: "التأمين/الدفعات", moduleEn: "Insurance Payments", action: "تسجيل دفعة", actionEn: "Record payment",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "Y", accountant: "Y" } },

  { module: "المخزون", moduleEn: "Inventory", action: "إدخال/إخراج/جرد", actionEn: "In/Out/Stocktake",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },
  { module: "المخزون", moduleEn: "Inventory", action: "حذف صنف", actionEn: "Delete item",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المشتريات/الموردين", moduleEn: "Purchases/Suppliers", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "Y" } },

  { module: "المحاسبة/القيود", moduleEn: "Accounting/Journal", action: "عرض دفتر اليومية", actionEn: "View journal",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المحاسبة", moduleEn: "Accounting", action: "تعديل/عكس قيد", actionEn: "Edit/Reverse entry",
    perms: { admin: "Y", manager: "N", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المصروفات", moduleEn: "Expenses", action: "إضافة/تعديل/حذف", actionEn: "Add/Edit/Delete",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "Y" } },

  { module: "التقارير", moduleEn: "Reports", action: "عرض + تصدير", actionEn: "View + Export",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "P", accountant: "Y" },
    notes: "Insurance role: insurance reports only." },

  { module: "المستخدمون", moduleEn: "Users", action: "دعوة/تعديل دور", actionEn: "Invite/Change role",
    perms: { admin: "Y", manager: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "الإعدادات", moduleEn: "Settings", action: "تعديل الإعدادات العامة", actionEn: "Edit global settings",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },
  { module: "قوالب الطباعة", moduleEn: "Print Templates", action: "إنشاء/تعديل/حذف", actionEn: "CRUD",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "N" } },
  { module: "سلة المحذوفات", moduleEn: "Trash", action: "استعراض + استعادة", actionEn: "View + Restore",
    perms: { admin: "Y", manager: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "سجل النشاط", moduleEn: "Audit Log", action: "عرض", actionEn: "View",
    perms: { admin: "Y", manager: "Y", technician: "N", insurance: "N", accountant: "Y" } },
];

function CellBadge({ v }: { v: Cell }) {
  if (v === "Y") return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">✓</Badge>;
  if (v === "P") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">جزئي</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
}

const STORAGE_KEY = "alwafa_roles_perms_v1";

function loadOverrides(): Record<string, Record<Role, Cell>> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveOverrides(o: Record<string, Record<Role, Cell>>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
}
function rowKey(r: PermRow) { return `${r.moduleEn}::${r.actionEn}`; }

function applyOverrides(rows: PermRow[], overrides: Record<string, Record<Role, Cell>>): PermRow[] {
  return rows.map((r) => {
    const o = overrides[rowKey(r)];
    return o ? { ...r, perms: { ...r.perms, ...o } } : r;
  });
}

export default function RolesPermissionsPage() {
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [overrides, setOverrides] = useState<Record<string, Record<Role, Cell>>>(() => loadOverrides());
  const [dirty, setDirty] = useState(false);

  const effectiveRows = useMemo(() => applyOverrides(ROWS, overrides), [overrides]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effectiveRows.filter((r) => {
      if (q) {
        const hay = `${r.module} ${r.moduleEn} ${r.action} ${r.actionEn}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all") {
        if (r.perms[roleFilter] === "N") return false;
      }
      return true;
    });
  }, [search, roleFilter, effectiveRows]);

  const Back = isRtl ? ArrowRight : ArrowLeft;

  function setCell(row: PermRow, role: Role, val: Cell) {
    const k = rowKey(row);
    setOverrides((prev) => {
      const next = { ...prev };
      const cur = { ...(next[k] || {}) } as Record<Role, Cell>;
      cur[role] = val;
      next[k] = cur;
      return next;
    });
    setDirty(true);
  }

  function handleSave() {
    saveOverrides(overrides);
    setDirty(false);
    toast.success(isRtl ? "تم حفظ تعديلات الصلاحيات" : "Permissions saved");
  }
  function handleReset() {
    if (!confirm(isRtl ? "إعادة كل الصلاحيات للوضع الافتراضي؟" : "Reset all permissions to defaults?")) return;
    setOverrides({});
    saveOverrides({});
    setDirty(false);
    toast.success(isRtl ? "تمت الإعادة للافتراضي" : "Reset to defaults");
  }

  function exportPrint() {
    window.print();
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => smartBack(navigate, "/settings")} className="gap-2">
            <Back size={16} />
            {isRtl ? "رجوع للإعدادات" : "Back to settings"}
          </Button>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Lock className="text-primary" />
            {isRtl ? "أدوار المستخدمين والصلاحيات" : "Roles & Permissions"}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {dirty && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
              {isRtl ? "تغييرات غير محفوظة" : "Unsaved"}
            </span>
          )}
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <RotateCcw size={14} /> {isRtl ? "افتراضي" : "Reset"}
          </Button>
          <Button onClick={handleSave} disabled={!dirty} className="gap-2 gradient-gold text-primary-foreground">
            <Save size={14} /> {isRtl ? "حفظ" : "Save"}
          </Button>
          <Button variant="outline" onClick={exportPrint} className="gap-2">
            <Printer size={14} /> {isRtl ? "طباعة" : "Print"}
          </Button>
        </div>
      </div>

      {/* Intro */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers size={18} className="text-primary" />
            {isRtl ? "كيف يعمل نظام الصلاحيات؟" : "How permissions work"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            {isRtl
              ? "النظام متعدد المستأجرين (Multi-Tenant). كل مستأجر يملك بياناته الخاصة عبر سياسات Row-Level Security (RLS) على عمود tenant_id. كل مستخدم له دور واحد أساسي يحدد ما يستطيع رؤيته أو تعديله."
              : "Multi-tenant SaaS. Each tenant owns its own data via Row-Level Security (RLS) on tenant_id. Every user has one primary role that determines what they can view or edit."}
          </p>
          <ul className="list-disc ms-6 space-y-1">
            <li>{isRtl ? "RLS تتحقق من الدور عبر دوال أمنية: get_user_role() و get_user_tenant_id()." : "RLS checks role via security definer functions: get_user_role() and get_user_tenant_id()."}</li>
            <li>{isRtl ? "صلاحيات الواجهة تعمل عبر useAuth().hasRole() وغلاف ProtectedRoute." : "UI guards use useAuth().hasRole() and the ProtectedRoute wrapper."}</li>
            <li>{isRtl ? "يمكنك تعديل أي خلية في المصفوفة (مسموح/جزئي/ممنوع) ثم الضغط على \"حفظ\". التغييرات تُطبَّق فوراً على واجهة المستخدم." : "You can edit any cell (Allow/Partial/Deny) then click Save. Changes apply to the UI immediately."}</li>
          </ul>
        </CardContent>
      </Card>

      {/* Roles cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ROLE_DEFS.map((r) => {
          const Icon = r.icon;
          const yes = effectiveRows.filter((x) => x.perms[r.key] === "Y").length;
          const partial = effectiveRows.filter((x) => x.perms[r.key] === "P").length;
          const no = effectiveRows.filter((x) => x.perms[r.key] === "N").length;
          return (
            <Card key={r.key} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.color}`}>
                  <Icon size={20} />
                </div>
                <CardTitle className="text-base mt-2">
                  {isRtl ? r.ar : r.en}
                  <span className="text-xs text-muted-foreground ms-2 font-normal">({r.key})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">{isRtl ? r.descAr : r.descEn}</p>
                <div className="flex gap-2 flex-wrap pt-1">
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                    {isRtl ? `مسموح: ${yes}` : `Allowed: ${yes}`}
                  </Badge>
                  {partial > 0 && (
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                      {isRtl ? `جزئي: ${partial}` : `Partial: ${partial}`}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">
                    {isRtl ? `ممنوع: ${no}` : `Denied: ${no}`}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isRtl ? "مصفوفة الصلاحيات التفصيلية" : "Detailed permissions matrix"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-3">
            <Input
              placeholder={isRtl ? "ابحث في الوحدات/الإجراءات..." : "Search modules/actions..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRtl ? "كل الأدوار" : "All roles"}</SelectItem>
                {ROLE_DEFS.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{isRtl ? r.ar : r.en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">{isRtl ? "الوحدة" : "Module"}</TableHead>
                  <TableHead className="min-w-[160px]">{isRtl ? "الإجراء" : "Action"}</TableHead>
                  {ROLE_DEFS.map((r) => (
                    <TableHead key={r.key} className="text-center min-w-[90px]">
                      {isRtl ? r.ar : r.en}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{isRtl ? row.module : row.moduleEn}</TableCell>
                    <TableCell>
                      {isRtl ? row.action : row.actionEn}
                      {row.notes && <div className="text-[10px] text-muted-foreground mt-0.5">{row.notes}</div>}
                    </TableCell>
                    {ROLE_DEFS.map((r) => (
                      <TableCell key={r.key} className="text-center">
                        <Select value={row.perms[r.key]} onValueChange={(v) => setCell(row, r.key, v as Cell)}>
                          <SelectTrigger className="h-8 w-[88px] mx-auto text-xs px-2">
                            <SelectValue>
                              <CellBadge v={row.perms[r.key]} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Y">{isRtl ? "✓ مسموح" : "✓ Allow"}</SelectItem>
                            <SelectItem value="P">{isRtl ? "جزئي" : "Partial"}</SelectItem>
                            <SelectItem value="N">{isRtl ? "— ممنوع" : "— Deny"}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><CellBadge v="Y" /> {isRtl ? "مسموح كامل" : "Full access"}</span>
            <span className="flex items-center gap-1"><CellBadge v="P" /> {isRtl ? "مسموح جزئياً" : "Partial access"}</span>
            <span className="flex items-center gap-1"><CellBadge v="N" /> {isRtl ? "ممنوع" : "Denied"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database size={18} className="text-primary" />
            {isRtl ? "الحماية الفنية" : "Technical security"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            {isRtl
              ? "كل جدول حسّاس عليه سياسة RLS تتحقق من tenant_id والدور قبل أي SELECT/INSERT/UPDATE/DELETE."
              : "Every sensitive table has RLS policies validating tenant_id and role before any SELECT/INSERT/UPDATE/DELETE."}
          </p>
          <ul className="list-disc ms-6 space-y-1">
            <li>{isRtl ? "Storage buckets خاصة (invoices-pdf) — لا يمكن الوصول إلا عبر signed URL." : "Private buckets (invoices-pdf) — accessible only through signed URLs."}</li>
            <li>{isRtl ? "buckets عامة (damage-photos, insurance-docs, avatars) — للقراءة فقط." : "Public buckets (damage-photos, insurance-docs, avatars) — read-only."}</li>
            <li>{isRtl ? "Triggers تلقائية: ترقيم أوامر العمل، توليد فواتير التأمين، إغلاق المطالبة عند التسليم." : "Auto triggers: WO numbering, insurance invoice generation, claim closure on delivery."}</li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/users")} className="gap-2">
          <UsersIcon size={14} /> {isRtl ? "إدارة المستخدمين" : "Manage users"}
        </Button>
      </div>
    </div>
  );
}
