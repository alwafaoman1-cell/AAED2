import { createStore } from "./createStore";
import type { Role } from "./permissions";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: "active" | "suspended";
  createdAt: string;
  lastLoginAt?: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "مدير عام",
  manager: "مدير ورشة",
  supervisor: "مشرف",
  technician: "فني",
  insurance: "موظف تأمين",
  customer: "عميل",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "صلاحيات كاملة لكل النظام (إنشاء/تعديل/حذف/إعدادات)",
  manager: "إدارة أوامر العمل والفواتير والعملاء والمخزون",
  supervisor: "تشغيل سريع من الجوال: أوامر عمل + مصاريف + متابعة",
  technician: "تنفيذ أوامر العمل وتحديث الحالات وإضافة الفحوصات",
  insurance: "متابعة مطالبات التأمين فقط",
  customer: "عرض سياراته وأوامر عمله فقط (عبر بوابة العميل)",
};

export const usersStore = createStore<AppUser>({
  key: "alwafa_users_v1",
  seed: [
    {
      id: "U-1",
      name: "المدير العام",
      email: "admin@alwafa.om",
      phone: "+968 9000 0001",
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ],
});
