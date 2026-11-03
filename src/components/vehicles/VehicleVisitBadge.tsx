import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getLinkedVehicleVisit } from "@/lib/vehicleVisitLifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function VehicleVisitBadge({ source, id }: { source: "claim" | "work_order"; id?: string | null }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["vehicle_visit", "linked", source, id],
    queryFn: () => getLinkedVehicleVisit(source, id!),
    enabled: Boolean(id && UUID.test(id)), staleTime: 15_000,
    refetchOnWindowFocus: true, refetchInterval: 60_000,
  });
  if (query.isError) return <span className="text-xs text-destructive" role="status">{t("vehicleVisit.locationUnavailable")}</span>;
  if (query.isSuccess && !query.data) return <span className="text-xs text-muted-foreground">{t("vehicleVisit.noLinkedEntry")}</span>;
  if (!query.data) return null;
  const { entryId, number, stage, presence, reviewReason } = query.data;
  const custody = presence === "in_workshop" ? t("vehicleEntry.workshopTab")
    : presence === "with_customer" ? t("vehicleEntry.customerTab")
    : t("vehicleEntry.reviewLocation");
  const label = stage === "needs_review"
    ? [number, t("vehicleEntry.reviewLocation")].filter(Boolean).join(" · ")
    : [number, stage ? t(`vehicleVisit.${stage}`) : t("vehicleVisit.legacyUnrecorded"), custody].filter(Boolean).join(" · ");
  return entryId
    ? <Link className="inline-flex rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10" to={`/vehicle-entry/${entryId}`}>
        {[label, reviewReason && stage !== "needs_review" ? t("vehicleEntry.reviewLocation") : ""].filter(Boolean).join(" · ")}
      </Link>
    : <span className="inline-flex rounded-full border border-warning/40 bg-warning/5 px-2 py-1 text-xs font-semibold text-warning">
        {[label, t("vehicleVisit.claimOnlyCard")].filter(Boolean).join(" · ")}
      </span>;
}
