import { CircleHelp, OctagonX, Power } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { vehicleRunningStatus, vehicleRunningStatusLabel, type VehicleRunningStatus } from "@/lib/vehicleRunningStatus";

export function VehicleRunningStatusField({ value, onChange, disabled = false, allowUnknown = true }: {
  value?: unknown; onChange: (value: VehicleRunningStatus) => void; disabled?: boolean; allowUnknown?: boolean;
}) {
  const { i18n } = useTranslation(); const id = useId();
  const english = i18n.language.startsWith("en"); const current = vehicleRunningStatus(value);
  const options = [
    { value: "running" as const, Icon: Power, tone: "text-green-700 dark:text-green-400" },
    { value: "not_running" as const, Icon: OctagonX, tone: "text-destructive" },
    ...(allowUnknown ? [{ value: "unknown" as const, Icon: CircleHelp, tone: "text-muted-foreground" }] : []),
  ];
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="text-sm font-semibold">{english ? "Does the vehicle run?" : "هل المركبة تعمل؟"}</legend>
    <div className={`grid gap-2 ${allowUnknown ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {options.map(({ value: option, Icon, tone }) => <label key={option} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-input p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input type="radio" name={`vehicle-running-${id}`} value={option} checked={current === option} onChange={() => onChange(option)}/>
        <Icon className={`h-5 w-5 shrink-0 ${tone}`} aria-hidden="true"/>
        <span>{vehicleRunningStatusLabel(option, i18n.language)}</span>
      </label>)}
    </div>
  </fieldset>;
}
