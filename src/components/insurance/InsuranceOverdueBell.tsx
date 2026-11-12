import { Bell, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useOverdueInsuranceAlerts } from "@/hooks/useOverdueInsuranceAlerts";
import { useTranslation } from "react-i18next";

export default function InsuranceOverdueBell() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const overdue = useOverdueInsuranceAlerts();
  const overdueKnown = overdue.isSuccess && Array.isArray(overdue.data) && !overdue.isFetching && overdue.fetchStatus !== "paused";
  const count = overdueKnown ? overdue.data.length : null;
  const overdueState = overdue.isError ? "loadError" : overdue.isFetching ? "loading" : overdueKnown ? null : "unknown";
  const overdueStateLabel = overdueState ? t(`overdueInsuranceAlerts.${overdueState}`) : undefined;
  const hasOverdueRows = !!overdue.data?.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("overdueInsuranceAlerts.bellLabel")}>
          <Bell size={18} />
          {(count === null || count > 0) && (
            <span title={overdueStateLabel} aria-label={overdueStateLabel} className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {count === null ? (overdue.isError ? "!" : "…") : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir={i18n.dir()}>
        <div className="p-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle size={16} className="text-destructive" />
            {t("overdueInsuranceAlerts.title")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("overdueInsuranceAlerts.description")}
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {overdueStateLabel && (
            <div role={overdue.isError ? "alert" : "status"} className="p-6 text-center text-sm text-muted-foreground">
              <p>{overdueStateLabel}</p>
              {overdue.isError && (
                <Button variant="ghost" size="sm" className="mt-2" disabled={overdue.isFetching} onClick={() => { void overdue.refetch(); }}>
                  {t("overdueInsuranceAlerts.retry")}
                </Button>
              )}
            </div>
          )}
          {overdueKnown && count === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("overdueInsuranceAlerts.empty")}
            </div>
          )}
          {overdue.data?.map((o, i) => (
            <button
              key={i}
              onClick={() => o.companyId && navigate(`/insurance/companies/${o.companyId}`)}
              className="w-full text-right p-3 border-b border-border hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{o.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">
                  {t("overdueInsuranceAlerts.days", { count: o.oldestDays })}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                <span>{t("overdueInsuranceAlerts.claimsCount", { count: o.claimsCount })}</span>
                <span className="font-bold text-warning">{o.remaining.toLocaleString()} {t("overdueInsuranceAlerts.currency")}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {t("overdueInsuranceAlerts.terms", { count: o.termsDays })}
              </div>
            </button>
          ))}
        </div>
        {hasOverdueRows && (
          <div className="p-2 border-t border-border bg-secondary/20">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => navigate("/insurance/payments")}>
              {t("overdueInsuranceAlerts.openPayments")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
