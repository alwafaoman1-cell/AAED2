import { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  variant?: "default" | "gold" | "success" | "warning" | "info";
  to?: string;
  onClick?: () => void;
}

const variantStyles = {
  default: "bg-card border-border",
  gold: "bg-card border-primary/30 shadow-gold",
  success: "bg-card border-success/30",
  warning: "bg-card border-warning/30",
  info: "bg-card border-info/30",
};

const iconVariantStyles = {
  default: "bg-secondary text-foreground",
  gold: "gradient-gold text-primary-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
};

export default function StatCard({ title, value, icon: Icon, trend, trendUp, variant = "default", to, onClick }: StatCardProps) {
  const interactive = !!(to || onClick);
  const content = (
    <div
      className={`rounded-xl border p-4 shadow-card animate-fade-in ${variantStyles[variant]} ${
        interactive ? "cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/50" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground" data-amount="true">{value}</p>
          {trend && (
            <p className={`text-xs font-medium ${trendUp ? "text-success" : "text-destructive"}`}>
              {trend}
            </p>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${iconVariantStyles[variant]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );

  if (to) {
    return <Link to={to} className="block">{content}</Link>;
  }
  return content;
}
