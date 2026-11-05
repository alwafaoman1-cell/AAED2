import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import Can from "@/components/Can";
import { Button } from "@/components/ui/button";
import { canInspectVehicleEntry } from "@/lib/vehicleEntryInspection";
import "@/i18n/vehicleEntryInspection";

export function VehicleEntryInspectionAction({ entry }: { entry: any }) {
  const { t } = useTranslation("vehicleEntryInspection");
  if (!canInspectVehicleEntry(entry)) return null;
  return <Can module="Insurance Inspection" action="Create/Edit">
    <Button asChild variant="outline" size="sm" className="gap-2">
      <Link to={`/inspection/insurance/new?entry=${encodeURIComponent(entry.id)}`}
        aria-label={t("actionFor", { number: entry.entry_number })}>
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />{t("action")}
      </Link>
    </Button>
  </Can>;
}
