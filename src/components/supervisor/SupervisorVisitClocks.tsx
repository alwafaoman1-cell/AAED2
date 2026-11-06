import { AlertCircle, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSupervisorVisitTiming, type SupervisorMilestone, type SupervisorVisitClock } from "@/lib/supervisorVisitTiming";
import type { SupervisorVehicle } from "@/lib/supervisorWorkspace";
import { workshopDateTime } from "@/lib/workshopDateTime";

const tones = {
  normal: "border-success/25 bg-success/5 text-success",
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  critical: "border-destructive/60 bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/25",
  unknown: "border-border bg-muted/40 text-muted-foreground",
};

export function SupervisorVisitClocks({ row, milestones, now }: { row: SupervisorVehicle; milestones?: SupervisorMilestone[]; now: number }) {
  const { t } = useTranslation("supervisorWorkspace");
  const timing = getSupervisorVisitTiming(row, milestones, now);
  function display(value: SupervisorVisitClock, key: "arrivalAge" | "approvalAge") {
    const sourceDate = value.start ? workshopDateTime(value.start).date : "";
    return <div className={`min-w-0 rounded-lg border px-2.5 py-2 ${tones[value.tone]}`} data-clock={key} data-tone={value.tone}>
      <dt className="text-xs font-medium">{t(key)}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-base font-bold tabular-nums">
        {value.tone === "overdue" || value.tone === "critical" ? <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {value.days === null ? <span className="text-xs font-medium">{t(value.issue === "unconfirmed" ? "clockUnconfirmed" : value.issue === "future" || value.issue === "invalid" ? "clockReview" : key === "approvalAge" ? "approvalNotRecorded" : "arrivalNotRecorded")}</span>
          : <span>{t(value.days === 0 ? "today" : value.days === 1 ? "day" : "days", { count: value.days })}</span>}
      </dd>
      {sourceDate && <p className="mt-0.5 text-xs" dir="ltr"><time dateTime={value.start!}>{sourceDate}</time>{value.stopped ? ` · ${t("clockStopped")}` : ""}</p>}
      {value.tone === "critical" && <p className="mt-0.5 text-xs font-semibold">{t("over25")}</p>}
    </div>;
  }
  return <dl className="grid grid-cols-2 gap-2" aria-label={t("visitTiming")}>{display(timing.arrival, "arrivalAge")}{display(timing.approval, "approvalAge")}</dl>;
}
