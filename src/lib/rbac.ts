// طبقة الصلاحيات المركزية للواجهة (RBAC)
// المصدر الموحّد للحقيقة لما يستطيع كل دور رؤيته/فعله في الـ UI.
// قواعد البيانات تُحرس بـ RLS مستقلاً؛ هنا فقط نخفي/نُعطّل أزرار وصفحات.

import { useAuth, AppRole } from "@/contexts/AuthContext";

export type RbacRole = AppRole; // admin | manager | technician | insurance | accountant
export type Cell = "Y" | "N" | "P"; // مسموح / ممنوع / جزئي

export interface PermRow {
  module: string; moduleEn: string;
  action: string; actionEn: string;
  perms: Record<RbacRole, Cell>;
  notes?: string;
}

/** المصفوفة الافتراضية — نسخة موحّدة تُستخدم من صفحة الإعدادات + بقية النظام. */
export const DEFAULT_PERM_ROWS: PermRow[] = [
  { module: "لوحة التحكم", moduleEn: "Dashboard", action: "عرض", actionEn: "View",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "Y", accountant: "Y" } },

  { module: "أوامر العمل", moduleEn: "Work Orders", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "أوامر العمل", moduleEn: "Work Orders", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "أوامر العمل", moduleEn: "Work Orders", action: "تغيير الحالة + تسليم", actionEn: "Status & delivery",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "N", accountant: "N" } },

  { module: "الفحص العام", moduleEn: "General Inspection", action: "إنشاء + PDF", actionEn: "Create + PDF",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "فحص التأمين", moduleEn: "Insurance Inspection", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "N", insurance: "Y", accountant: "N" } },

  { module: "العملاء", moduleEn: "Customers", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "العملاء", moduleEn: "Customers", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المركبات", moduleEn: "Vehicles", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "Y", insurance: "N", accountant: "N" } },
  { module: "المركبات", moduleEn: "Vehicles", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المبيعات/الفواتير", moduleEn: "Sales/Invoices", action: "إنشاء", actionEn: "Create",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المبيعات/الفواتير", moduleEn: "Sales/Invoices", action: "تعديل/حذف", actionEn: "Edit/Delete",
    perms: { admin: "Y", manager: "P", supervisor: "N", technician: "N", insurance: "N", accountant: "P" },
    notes: "Only drafts; posted invoices need admin." },

  { module: "التأمين/المطالبات", moduleEn: "Insurance/Claims", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "P", insurance: "Y", accountant: "N" } },
  { module: "التأمين/المطالبات", moduleEn: "Insurance/Claims", action: "حذف", actionEn: "Delete",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "التأمين/الدفعات", moduleEn: "Insurance Payments", action: "تسجيل دفعة", actionEn: "Record payment",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "Y", accountant: "Y" } },

  { module: "المخزون", moduleEn: "Inventory", action: "إدخال/إخراج/جرد", actionEn: "In/Out/Stocktake",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "المخزون", moduleEn: "Inventory", action: "حذف صنف", actionEn: "Delete item",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },

  { module: "المشتريات/الموردين", moduleEn: "Purchases/Suppliers", action: "إنشاء/تعديل", actionEn: "Create/Edit",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "Y" } },

  { module: "المحاسبة/القيود", moduleEn: "Accounting/Journal", action: "عرض دفتر اليومية", actionEn: "View journal",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المحاسبة", moduleEn: "Accounting", action: "تعديل/عكس قيد", actionEn: "Edit/Reverse entry",
    perms: { admin: "Y", manager: "N", supervisor: "N", technician: "N", insurance: "N", accountant: "Y" } },
  { module: "المصروفات", moduleEn: "Expenses", action: "إضافة/تعديل/حذف", actionEn: "Add/Edit/Delete",
    perms: { admin: "Y", manager: "Y", supervisor: "Y", technician: "N", insurance: "N", accountant: "Y" } },

  { module: "التقارير", moduleEn: "Reports", action: "عرض + تصدير", actionEn: "View + Export",
    perms: { admin: "Y", manager: "Y", supervisor: "P", technician: "N", insurance: "P", accountant: "Y" },
    notes: "Insurance role: insurance reports only." },

  { module: "المستخدمون", moduleEn: "Users", action: "دعوة/تعديل دور", actionEn: "Invite/Change role",
    perms: { admin: "Y", manager: "N", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "الإعدادات", moduleEn: "Settings", action: "تعديل الإعدادات العامة", actionEn: "Edit global settings",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "قوالب الطباعة", moduleEn: "Print Templates", action: "إنشاء/تعديل/حذف", actionEn: "CRUD",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "سلة المحذوفات", moduleEn: "Trash", action: "استعراض + استعادة", actionEn: "View + Restore",
    perms: { admin: "Y", manager: "N", supervisor: "N", technician: "N", insurance: "N", accountant: "N" } },
  { module: "سجل النشاط", moduleEn: "Audit Log", action: "عرض", actionEn: "View",
    perms: { admin: "Y", manager: "Y", supervisor: "N", technician: "N", insurance: "N", accountant: "Y" } },
];

export const STORAGE_KEY = "alwafa_roles_perms_v1";
export const rowKey = (moduleEn: string, actionEn: string) => `${moduleEn}::${actionEn}`;

type OverrideMap = Record<string, Partial<Record<RbacRole, Cell>>>;

function loadOverrides(): OverrideMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

export function getEffectiveRows(): PermRow[] {
  const ov = loadOverrides();
  return DEFAULT_PERM_ROWS.map((r) => {
    const o = ov[rowKey(r.moduleEn, r.actionEn)];
    return o ? { ...r, perms: { ...r.perms, ...o } } : r;
  });
}

export function getPermissionCell(moduleEn: string, actionEn: string, role: RbacRole): Cell {
  const ov = loadOverrides();
  const o = ov[rowKey(moduleEn, actionEn)];
  if (o && o[role]) return o[role] as Cell;
  const row = DEFAULT_PERM_ROWS.find((r) => r.moduleEn === moduleEn && r.actionEn === actionEn);
  return row?.perms[role] ?? "N";
}

/** يعيد true إذا كانت الصلاحية Y أو P (الجزئية تُحلّ تفصيلياً داخل المكوّن). */
export function can(role: RbacRole | null | undefined, moduleEn: string, actionEn: string): boolean {
  if (!role) return false;
  if (role === "admin") return true; // الأدمن يتجاوز كل القيود في الواجهة
  const v = getPermissionCell(moduleEn, actionEn, role);
  return v === "Y" || v === "P";
}

/** صارم: يقبل فقط Y. */
export function canStrict(role: RbacRole | null | undefined, moduleEn: string, actionEn: string): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  return getPermissionCell(moduleEn, actionEn, role) === "Y";
}

/** Hook للاستخدام داخل المكوّنات. */
export function useCan(moduleEn: string, actionEn: string, opts?: { strict?: boolean }) {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  return opts?.strict ? canStrict(role, moduleEn, actionEn) : can(role, moduleEn, actionEn);
}

// ---------------------------------------------------------------------------
// خرائط المسارات → صلاحيات (لحماية الصفحات وفلترة السايدبار)
// ---------------------------------------------------------------------------

interface RouteRule { module: string; action: string; }

const ROUTE_RULES: Array<{ match: (p: string) => boolean; rule: RouteRule }> = [
  { match: (p) => p === "/" || p.startsWith("/dashboard"), rule: { module: "Dashboard", action: "View" } },

  { match: (p) => p.startsWith("/work-orders"), rule: { module: "Work Orders", action: "Create/Edit" } },

  { match: (p) => p.startsWith("/inspection/insurance"), rule: { module: "Insurance Inspection", action: "Create/Edit" } },
  { match: (p) => p.startsWith("/inspection"), rule: { module: "General Inspection", action: "Create + PDF" } },

  { match: (p) => p.startsWith("/customers"), rule: { module: "Customers", action: "Create/Edit" } },
  { match: (p) => p.startsWith("/vehicles"), rule: { module: "Vehicles", action: "Create/Edit" } },

  { match: (p) => p.startsWith("/sales"), rule: { module: "Sales/Invoices", action: "Create" } },

  { match: (p) => p.startsWith("/insurance"), rule: { module: "Insurance/Claims", action: "Create/Edit" } },

  { match: (p) => p.startsWith("/inventory"), rule: { module: "Inventory", action: "In/Out/Stocktake" } },

  { match: (p) => p.startsWith("/accounting"), rule: { module: "Accounting/Journal", action: "View journal" } },

  { match: (p) => p.startsWith("/reports"), rule: { module: "Reports", action: "View + Export" } },

  { match: (p) => p === "/users", rule: { module: "Users", action: "Invite/Change role" } },

  { match: (p) => p.startsWith("/settings/trash"), rule: { module: "Trash", action: "View + Restore" } },
  { match: (p) => p.startsWith("/settings/audit-log"), rule: { module: "Audit Log", action: "View" } },
  { match: (p) => p.startsWith("/settings/print-templates"), rule: { module: "Print Templates", action: "CRUD" } },
  { match: (p) => p.startsWith("/settings"), rule: { module: "Settings", action: "Edit global settings" } },
];

export function canAccessPath(path: string, role: RbacRole | null | undefined): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  // المسارات العامة دائمًا مسموحة
  if (path === "/profile" || path === "/tasks" || path === "/daily-log" || path === "/media-studio" || path === "/staff") {
    return true;
  }
  const hit = ROUTE_RULES.find((r) => r.match(path));
  if (!hit) return true; // افتراضياً نسمح بأي مسار غير مُصنَّف
  return can(role, hit.rule.module, hit.rule.action);
}

export function getRouteRule(path: string): RouteRule | null {
  return ROUTE_RULES.find((r) => r.match(path))?.rule ?? null;
}
