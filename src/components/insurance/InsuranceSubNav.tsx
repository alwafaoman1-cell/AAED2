import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, KanbanSquare, List, Building2, Wrench, DollarSign, ReceiptText, Bell, Archive, FileText, Upload, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/insurance", label: "لوحة التأمين", icon: LayoutDashboard, exact: true },
  { to: "/insurance/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/insurance/list", label: "المطالبات", icon: List },
  { to: "/insurance/alerts", label: "التنبيهات", icon: Bell },
  { to: "/insurance/work-orders", label: "أوامر العمل", icon: Wrench },
  { to: "/insurance/payments", label: "المدفوعات", icon: DollarSign },
  { to: "/insurance/investors-report", label: "تقرير المستثمرين", icon: TrendingUp },
  { to: "/insurance/estimates", label: "تقديرات الإصلاح", icon: FileText },
  { to: "/insurance/independent-estimates", label: "التقديرات المستقلة", icon: FileText },
  { to: "/insurance/accounting", label: "الفواتير", icon: ReceiptText },
  { to: "/insurance/documents", label: "أرشيف المستندات", icon: Archive },
  { to: "/insurance/companies", label: "الشركات", icon: Building2 },
  { to: "/insurance/import", label: "استيراد Excel", icon: Upload },
];

export default function InsuranceSubNav() {
  const { pathname } = useLocation();
  return (
    <div className="bg-card/50 border border-border rounded-xl p-1.5 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon size={14} />
              {t.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
