import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { VehicleRearThumbnail } from "@/components/vehicles/VehicleRearThumbnail";
import { VehicleLabelCheckbox } from "./VehicleEntryLabelActions";
import { VehicleCenterRowActions } from "./VehicleCenterRowActions";
import { vehicleEntryArrivalTime } from "@/lib/vehicleEntryArrival";
import type { VehicleCenterTab, VisitStage } from "@/lib/vehicleVisitLifecycle";
import type { VehicleCenterActionRequest } from "@/lib/vehicleCenterPresentation";
import type { useVehicleLabelSelection } from "@/hooks/useVehicleLabelSelection";

export function VehicleCenterCard({ row, tab, thumbnail, selection, stageLabel, purposeLabel, statusLabel, onOpen }: {
  row: any; tab: VehicleCenterTab; thumbnail?: string; selection: ReturnType<typeof useVehicleLabelSelection>;
  stageLabel: (stage: VisitStage) => string; purposeLabel: (row: any) => string; statusLabel: (status: string) => string;
  onOpen: (row: any, request?: VehicleCenterActionRequest) => void;
}) {
  const { t } = useTranslation();
  const vehicle = row.vehicle || row.vehicle_snapshot || {}, customer = row.customer || row.customer_snapshot || {};
  const order = row.work_order || row.converted_work_order, claim = row.claim || row.converted_claim;
  const number = row.entry_number || claim?.claim_number || t("vehicleVisit.claimOnlyCard");
  const recordUrl = row._claimOnly ? `/insurance/${claim.id}` : `/vehicle-entry/${row.id}`;
  const model = [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ");
  const plate = [vehicle.plate_number, vehicle.plate_letters].filter(Boolean).join(" ");
  const details = <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm">
    {[
      [t("vehicleEntry.arrival"), [row.arrival_date, vehicleEntryArrivalTime(row)].filter(Boolean).join(" ")],
      [t("vehicleEntry.customer"), customer.name], [t("vehicleEntry.phone"), customer.phone],
      [t("vehicleEntry.insurance"), row.insurance_snapshot?.company_name || row.insurance_company?.name],
      [t("vehicleEntry.deliveredBy"), row.delivered_by?.full_name], [t("vehicleEntry.purpose"), purposeLabel(row)],
      [t("vehicleVisit.technician"), order?.technician_name], [t("vehicleEntry.workOrder"), order?.order_number],
      [t("vehicleVisit.claim"), claim?.claim_number || row.insurance_snapshot?.claim_number],
      [t("vehicleEntry.status"), row._claimOnly ? t(`vehicleVisit.claimStatus.${row.status}`, { defaultValue: row.status }) : statusLabel(row.status)],
    ].map(([label, value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-muted-foreground">{label}</dt><dd dir="auto">{value || "—"}</dd></div>)}
  </dl>;
  return <article className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="flex items-center justify-between gap-2">
      <Link to={recordUrl} className="min-w-0 break-all font-mono text-xs text-muted-foreground hover:text-primary hover:underline" dir="auto">{number}</Link>
      <div className="shrink-0 print:hidden"><VehicleLabelCheckbox row={row} selection={selection} /></div>
    </div>
    <div className="flex min-w-0 items-center gap-3">
      <VehicleRearThumbnail size="card" url={thumbnail} alt={t("vehicleEntry.rearPhoto", { vehicle: model || number })} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-sm font-semibold" dir="auto">{model || "—"}</p>
        <p className="w-fit rounded-md border border-border bg-muted/30 px-2 py-0.5 text-base font-bold" dir="ltr">{plate || "—"}</p>
        <p className="truncate text-xs text-muted-foreground" dir="auto">{customer.name || "—"}</p>
      </div>
    </div>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
      <span className={`rounded-md px-2 py-1 ${row._reviewReason ? "bg-warning/10 text-foreground" : "bg-primary/10 text-foreground"}`}>{stageLabel(row._visitStage)}</span>
      <span className="break-all font-mono text-muted-foreground" dir="auto">{order?.order_number || claim?.claim_number || ""}</span>
    </div>
    {row._claimOnly && <p className="text-xs text-warning">{t("vehicleVisit.claimOnlyCard")}</p>}
    {row._arrivalSource === "claim_registration" && <p className="text-xs text-warning">{t("vehicleVisit.arrivalFromClaimRegistration")}</p>}
    {row._reviewReason && <p role="status" className="text-xs text-warning">{t(`vehicleVisit.${row._reviewReason}`, { defaultValue: row._reviewReason })}</p>}
    <VehicleCenterRowActions row={row} tab={tab} details={details} onOpen={onOpen} />
  </article>;
}
