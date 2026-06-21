import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Clock, FileWarning, Banknote, ShieldAlert, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useInsuranceAlerts, type InsuranceAlert } from "@/hooks/useInsuranceAlerts";

const typeIcons: Record<InsuranceAlert["type"], typeof Bell> = {
  delivered_without_invoice: FileWarning,
  policy_expiring: ShieldAlert,
  cheque_due: Banknote,
  invoice_overdue: AlertTriangle,
  stale_pending: Clock,
  unpaid_approved: Banknote,
};

const sevStyles: Record<InsuranceAlert["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/5",
  warning: "border-warning/40 bg-warning/5",
  info: "border-info/40 bg-info/5",
};

const sevBadge: Record<InsuranceAlert["severity"], string> = {
  critical: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  info: "bg-info text-info-foreground",
};

const sevLabel: Record<InsuranceAlert["severity"], string> = {
  critical: "حرج", warning: "تحذير", info: "معلومة",
};

export default function InsuranceAlertsCenter() {
  const navigate = useNavigate();
  const alerts = useInsuranceAlerts();

  const grouped = {
    critical: alerts.filter((a) => a.severity === "critical"),
    warning: alerts.filter((a) => a.severity === "warning"),
    info: alerts.filter((a) => a.severity === "info"),
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Bell className="text-primary" /> مركز التنبيهات الذكي
        </h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          مراقبة آلية لـ LPO المتأخر، الشيكات، الوثائق المنتهية، والمستحقات المتأخرة
        </p>
      </div>


      <div className="grid grid-cols-3 gap-3">
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-destructive">{grouped.critical.length}</div>
          <div className="text-xs text-muted-foreground">حرجة</div>
        </div>
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-warning">{grouped.warning.length}</div>
          <div className="text-xs text-muted-foreground">تحذيرات</div>
        </div>
        <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-info">{grouped.info.length}</div>
          <div className="text-xs text-muted-foreground">معلومات</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h3 className="font-semibold text-lg">لا توجد تنبيهات حالياً</h3>
          <p className="text-sm text-muted-foreground">كل المطالبات والمدفوعات تحت السيطرة</p>
        </div>
      ) : (
        (["critical", "warning", "info"] as const).map((sev) =>
          grouped[sev].length > 0 ? (
            <div key={sev}>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Badge className={sevBadge[sev]}>{sevLabel[sev]}</Badge>
                <span className="text-muted-foreground">({grouped[sev].length})</span>
              </h2>
              <div className="space-y-2">
                {grouped[sev].map((a) => {
                  const Icon = typeIcons[a.type];
                  return (
                    <div key={a.id} className={`border rounded-xl p-3 md:p-4 ${sevStyles[sev]}`}>
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-card border border-border shrink-0">
                          <Icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{a.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{a.description}</div>
                        </div>
                        {a.href && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(a.href!)} className="gap-1 shrink-0">
                            فتح <ChevronLeft size={14} />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null
        )
      )}
    </div>
  );
}
