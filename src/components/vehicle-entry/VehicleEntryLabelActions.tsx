import { Loader2, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { VehicleLabelSelection } from "@/hooks/useVehicleLabelSelection";
import "@/lib/i18n/vehicleEntryLabels";

export function VehicleLabelCheckbox({ row, selection }: { row: any; selection: VehicleLabelSelection }) {
  const { t } = useTranslation("vehicleEntryLabels");
  return <Checkbox checked={selection.checked(row.id)} disabled={selection.printing}
    aria-label={t("select", { number: row.entry_number || row.claim?.claim_number || row.id })}
    onCheckedChange={(value) => selection.toggle(row, value === true)} />;
}

export function VehicleEntryLabelActions({ selection, total, ready }: { selection: VehicleLabelSelection; total: number; ready: boolean }) {
  const { t } = useTranslation("vehicleEntryLabels");
  return <section className="space-y-2 rounded-lg border border-border bg-card p-3 print:hidden" aria-label={t("title")}>
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-sm">{t("title")}</strong>
      <span className="text-sm text-muted-foreground" role="status">{t("selected", { count: selection.count })}</span>
      <Button variant="outline" size="sm" disabled={!ready || !total || selection.printing} onClick={selection.selectAll}>{t("all", { count: total })}</Button>
      <Button variant="outline" size="sm" disabled={!selection.count || selection.printing} onClick={selection.clear}>{t("clear")}</Button>
      <Button variant="outline" size="sm" disabled={!ready || !selection.count || selection.printing} onClick={() => void selection.print()} className="gap-2">
        {selection.printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}{t("print")}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{t("hint")}</p>
  </section>;
}
