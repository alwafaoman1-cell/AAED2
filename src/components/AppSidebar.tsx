import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ClipboardList, Search, ShoppingCart, Calculator,
  Package, Users, Shield, Settings, ChevronLeft, ChevronRight, Menu, X,
  Car, Trash2, UserSquare, ChevronDown, MinusCircle, ReceiptText, Wallet, History, Database,
  FileText, Building2, DollarSign, RotateCcw, BarChart3, ArrowDownUp, FileBarChart, Wrench,
  UserCog, LogOut, Palette, Plus, Tags, KanbanSquare, Bell, List, FileSpreadsheet,
  Smartphone, Download, Power, Key, ServerCog, FolderLock,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { featureForPath, useFeatures } from "@/contexts/FeatureContext";
import { canAccessPath } from "@/lib/rbac";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import LanguageSwitcher from "@/components/LanguageSwitcher";

type SubItem = { path: string; labelKey: string; icon: any };
type MenuItem = {
  path: string;
  labelKey: string;
  icon: any;
  iconClass?: string;
  children?: SubItem[];
};

// مرتبة حسب الأولوية: يومي → دوري → مساعد → إعدادات
const menuItems: MenuItem[] = [
  { path: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "/work-orders", labelKey: "nav.workOrders", icon: ClipboardList },
  { path: "/vehicles", labelKey: "nav.vehicles", icon: Car },
  { path: "/customers", labelKey: "nav.customers", icon: UserSquare },
  { path: "/messages", labelKey: "nav.messages", icon: Bell },
  { path: "/admin/notifications", labelKey: "إشعارات المدير", icon: Bell, iconClass: "text-red-400" },
  { path: "/inspection", labelKey: "nav.inspection", icon: Search },
  {
    path: "/insurance",
    labelKey: "nav.insurance",
    icon: Shield,
    iconClass: "text-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.55)]",
  },
  {
    path: "/sales",
    labelKey: "nav.sales",
    icon: ShoppingCart,
    children: [
      { path: "/sales/invoices", labelKey: "nav.invoicesManagement", icon: FileText },
      { path: "/sales/invoices/new", labelKey: "nav.newInvoice", icon: Plus },
      { path: "/sales/quotes", labelKey: "nav.quotesManagement", icon: ReceiptText },
      { path: "/sales/quotes/new", labelKey: "nav.newQuote", icon: Plus },
      { path: "/sales/credit-notes", labelKey: "nav.creditNotes", icon: RotateCcw },
      { path: "/sales/returns", labelKey: "nav.returnedInvoices", icon: RotateCcw },
      { path: "/sales/recurring", labelKey: "nav.recurringInvoices", icon: History },
    ],
  },
  { path: "/estimates", labelKey: "التقديرات الموحدة", icon: FileSpreadsheet },
  {
    path: "/inventory",
    labelKey: "nav.inventory",
    icon: Package,
    children: [
      { path: "/inventory/movements", labelKey: "nav.stockMovements", icon: ArrowDownUp },
      { path: "/inventory/purchase-invoices", labelKey: "nav.purchaseInvoices", icon: FileText },
      { path: "/inventory/suppliers", labelKey: "nav.suppliers", icon: Building2 },
      { path: "/inventory/supplier-payments", labelKey: "nav.supplierPayments", icon: DollarSign },
      { path: "/inventory/purchase-returns", labelKey: "nav.purchaseReturns", icon: RotateCcw },
      { path: "/inventory/supplier-balance", labelKey: "nav.supplierBalance", icon: BarChart3 },
    ],
  },
  {
    path: "/accounting",
    labelKey: "nav.accounting",
    icon: Calculator,
    children: [
      { path: "/accounting/expenses", labelKey: "nav.addExpense", icon: MinusCircle },
      { path: "/accounting/receipts", labelKey: "nav.receipts", icon: ReceiptText },
      { path: "/accounting/cashbox/topup", labelKey: "nav.cashboxTopup", icon: Wallet },
    ],
  },
  { path: "/daily-log", labelKey: "nav.dailyLog", icon: FileSpreadsheet },
  { path: "/import-export", labelKey: "مركز الاستيراد والتصدير", icon: Download, iconClass: "text-emerald-400" },
  { path: "/tasks", labelKey: "nav.tasks", icon: ClipboardList },
  {
    path: "/apps",
    labelKey: "التطبيقات 📱",
    icon: Smartphone,
    iconClass: "text-blue-400",
    children: [
      { path: "/supervisor", labelKey: "تطبيق المشرف", icon: UserCog },
      { path: "/technician", labelKey: "تطبيق الفني", icon: Wrench },
      { path: "/accountant", labelKey: "تطبيق المحاسب", icon: FileSpreadsheet },
    ],
  },
  { path: "/reports", labelKey: "nav.reports", icon: FileBarChart },
  {
    path: "/staff",
    labelKey: "إدارة الفريق",
    icon: Users,
    children: [
      { path: "/staff", labelKey: "nav.staff", icon: Users },
      { path: "/users", labelKey: "nav.users", icon: UserCog },
      { path: "/admin/saas", labelKey: "لوحة إدارة SaaS", icon: ServerCog },
      { path: "/admin/files", labelKey: "مدير ملفات الورشة", icon: FolderLock },
    ],
  },
  { path: "/media-studio", labelKey: "استوديو الوسائط", icon: Palette, iconClass: "text-fuchsia-400" },
  {
    path: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    children: [
      { path: "/settings/modules", labelKey: "التطبيقات والوحدات", icon: Power },
      { path: "/settings/print-templates", labelKey: "nav.printTemplates", icon: Palette },
      { path: "/settings/roles-permissions", labelKey: "nav.rolesPermissions", icon: Shield },
      { path: "/settings/quick-actions", labelKey: "nav.quickActionsSettings", icon: Plus },
      { path: "/settings/audit-log", labelKey: "nav.auditLog", icon: History },
      { path: "/settings/backup", labelKey: "النسخ الاحتياطي", icon: Database },
      { path: "/settings/ai-keys", labelKey: "مفاتيح الذكاء الاصطناعي", icon: Key },
      { path: "/settings/vehicle-stay-alerts", labelKey: "تنبيهات بقاء المركبة", icon: Bell },
      { path: "/settings/trash", labelKey: "nav.trash", icon: Trash2 },
    ],
  },
];

export default function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  // إذا لم يصل البروفايل بعد (تحميل/فشل شبكة) لا نُخفي القائمة — حماية الصفحات تتم في ProtectedRoute و RLS
  const roleForGate = profile?.role ?? "admin";
  const { t, i18n } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isRtl = i18n.dir() === "rtl";
  const { isEnabled } = useFeatures();

  const isPathEnabled = (path: string): boolean => {
    const key = featureForPath(path);
    if (!key) return true;
    return isEnabled(key);
  };

  async function handleLogout() {
    await signOut();
    toast.success(t("auth.logoutSuccess"));
    navigate("/auth", { replace: true });
  }
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    menuItems.forEach((m) => {
      if (m.children?.some((c) => location.pathname.startsWith(c.path) || location.pathname === m.path)) {
        init[m.path] = true;
      }
    });
    return init;
  });

  // accordion: فتح واحد فقط في الوقت نفسه + إغلاق المفتوح عند الضغط مجددًا
  const toggleMenu = (path: string) =>
    setOpenMenus((prev) => {
      const isCurrentlyOpen = !!prev[path];
      if (isCurrentlyOpen) return { ...prev, [path]: false };
      const next: Record<string, boolean> = {};
      next[path] = true;
      return next;
    });

  // Sidebar pinned to the inline-end of the viewport (right in RTL, left in LTR)
  const sideClass = isRtl ? "right-0 border-l" : "left-0 border-r";
  const closedTranslate = isRtl ? "translate-x-full" : "-translate-x-full";

  return (
    <>
      {/* Mobile toggle — مدمج مع شريط الأعلى */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className={`fixed top-2 ${isRtl ? "right-3" : "left-3"} z-50 lg:hidden p-2 rounded-lg bg-card border border-border shadow-md`}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 ${sideClass} h-screen z-40 bg-sidebar border-sidebar-border
          flex flex-col transition-all duration-300
          ${collapsed ? "w-[72px]" : "w-[260px]"}
          ${mobileOpen ? "translate-x-0" : `${closedTranslate} lg:translate-x-0`}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-sidebar-border min-h-[72px]">
          <img src={logo} alt={t("company.name")} width={40} height={40} className="rounded-lg flex-shrink-0" />
          {!collapsed && (
            <div className="overflow-hidden flex-1">
              <h1 className="text-sm font-bold text-foreground truncate">{t("company.name")}</h1>
              <p className="text-[10px] text-muted-foreground truncate">{t("company.tagline")}</p>
            </div>
          )}
          {!collapsed && <LanguageSwitcher size="icon" showLabel={false} />}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 overflow-y-auto space-y-1">
          {menuItems
            .filter((item) => canAccessPath(item.path, roleForGate))
            .filter((item) => isPathEnabled(item.path))
            .map((item) => {
            const visibleChildren = item.children
              ?.filter((c) => canAccessPath(c.path, roleForGate))
              .filter((c) => isPathEnabled(c.path));
            const isActive = location.pathname === item.path;
            const hasChildren = !!visibleChildren?.length;
            const isOpen = !!openMenus[item.path];
            const childActive = visibleChildren?.some((c) => location.pathname === c.path);
            const itemLabel = t(item.labelKey);

            return (
              <div key={item.path}>
                <div
                  className={`
                    flex items-center gap-2 rounded-lg text-sm transition-all
                    ${isActive || childActive
                      ? "bg-primary/10 text-primary font-semibold shadow-gold"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }
                  `}
                >
                  <Link
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 flex-1 ${collapsed ? "justify-center" : ""}`}
                    title={collapsed ? itemLabel : undefined}
                  >
                    <item.icon size={20} className={`flex-shrink-0 ${item.iconClass || ""}`} />
                    {!collapsed && <span className="flex-1">{itemLabel}</span>}
                  </Link>
                  {hasChildren && !collapsed && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleMenu(item.path);
                      }}
                      className="p-2 mx-1 rounded-md hover:bg-sidebar-accent/60 active:bg-sidebar-accent transition-colors flex-shrink-0"
                      title={isOpen ? "إغلاق" : "فتح"}
                      aria-expanded={isOpen}
                      aria-label={`Toggle ${itemLabel}`}
                    >
                      <ChevronDown
                        size={18}
                        className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>

                {!collapsed && hasChildren && isOpen && (
                  <div className={`mt-1 space-y-1 ${isRtl ? "mr-6 border-r pr-2" : "ml-6 border-l pl-2"} border-sidebar-border`}>
                    {visibleChildren!.map((child) => {
                      const childIsActive = location.pathname === child.path;
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={() => setMobileOpen(false)}
                          className={`
                            flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all
                            ${childIsActive
                              ? "bg-primary/15 text-primary font-semibold"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            }
                          `}
                        >
                          <child.icon size={14} className="flex-shrink-0" />
                          <span>{t(child.labelKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User profile + logout */}
        {profile && (
          <div className="p-2 border-t border-sidebar-border space-y-1">
            <Link
              to="/profile"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent transition-colors ${collapsed ? "justify-center" : ""} ${location.pathname === "/profile" ? "bg-primary/10" : ""}`}
              title={collapsed ? t("nav.profile", { defaultValue: isRtl ? "الملف الشخصي" : "Profile" }) : undefined}
            >
              <Avatar className="w-9 h-9 flex-shrink-0">
                <AvatarImage src={profile.avatar_url || undefined} />
                <AvatarFallback className="text-xs">{profile.full_name.slice(0, 2)}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-sidebar-foreground truncate">{profile.full_name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{profile.role}</div>
                </div>
              )}
            </Link>
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-destructive hover:bg-destructive/10 transition-all ${collapsed ? "justify-center" : ""}`}
              title={t("common.logout")}
            >
              <LogOut size={18} className="flex-shrink-0" />
              {!collapsed && <span>{t("common.logout")}</span>}
            </button>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:bg-sidebar-accent transition-all justify-center"
            >
              {collapsed
                ? (isRtl ? <ChevronLeft size={18} /> : <ChevronRight size={18} />)
                : (isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />)}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
