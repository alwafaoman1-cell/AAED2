import { VehicleReviewReturnAction } from "./VehicleReviewReturnAction";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, FileText, LogIn, MapPin, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkflowRequirements } from "@/hooks/useWorkflowRequirements";
import Can from "@/components/Can";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canInspectVehicleEntry } from "@/lib/vehicleEntryInspection";
import { getVehicleCenterPrimaryAction, type VehicleCenterActionRequest } from "@/lib/vehicleCenterPresentation";
import type { VehicleCenterTab } from "@/lib/vehicleVisitLifecycle";
import "@/i18n/vehicleEntryInspection";
import "@/lib/i18n/vehicleCenterMobile";

export function VehicleCenterRowActions({ row, tab, details, onOpen }: {
  row: any; tab: VehicleCenterTab; details?: ReactNode; onOpen: (row: any, request?: VehicleCenterActionRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const { hasRole } = useAuth();
  const { requirementsEnabled } = useWorkflowRequirements();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const action = getVehicleCenterPrimaryAction(row, tab, hasRole, requirementsEnabled);
  const label = t(`vehicleCenterMobile.${action.label}`);
  const number = row.entry_number || row.claim?.claim_number || t("vehicleVisit.claimOnlyCard");
  const recordUrl = row._claimOnly ? `/insurance/${row.claim.id}` : `/vehicle-entry/${row.id}`;
  return <div className="flex min-w-0 items-center gap-2 print:hidden">
    <Button size="sm" variant={action.request ? "default" : "outline"} className={`h-auto min-h-10 min-w-0 flex-1 gap-2 whitespace-normal ${action.request?.intent === "arrival" ? "bg-success text-success-foreground hover:bg-success/90" : ""}`}
      aria-label={`${label} · ${number}`} onClick={() => onOpen(row, action.request)}>
      {action.request?.intent === "arrival" && <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />}{label}
    </Button>
    {row._visitStage === "delivered" && !row._claimOnly && <VehicleReviewReturnAction entryId={row.id} />}
    <DropdownMenu dir={i18n.dir()}><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label={`${t("vehicleCenterMobile.moreActions")} · ${number}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="print:hidden">
        <DropdownMenuItem onSelect={() => onOpen(row)} aria-label={`${t("vehicleVisit.manageLocationAndStage")} · ${number}`}><MapPin className="me-2 h-4 w-4" aria-hidden="true" />{t("vehicleVisit.manageLocationAndStage")}</DropdownMenuItem>
        {details && <DropdownMenuItem onSelect={() => setDetailsOpen(true)}><FileText className="me-2 h-4 w-4" aria-hidden="true" />{t("vehicleCenterMobile.visitDetails")}</DropdownMenuItem>}
        <DropdownMenuItem asChild><Link to={recordUrl}>{t("vehicleCenterMobile.openRecord")}</Link></DropdownMenuItem>
        {canInspectVehicleEntry(row) && <Can module="Insurance Inspection" action="Create/Edit"><DropdownMenuItem asChild>
          <Link to={`/inspection/insurance/new?entry=${encodeURIComponent(row.id)}`} aria-label={t("vehicleEntryInspection:actionFor", { number: row.entry_number })}><ClipboardCheck className="me-2 h-4 w-4" aria-hidden="true" />{t("vehicleEntryInspection:action")}</Link>
        </DropdownMenuItem></Can>}
      </DropdownMenuContent>
    </DropdownMenu>
    {details && <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent dir={i18n.dir()} className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("vehicleCenterMobile.visitDetails")}</DialogTitle><DialogDescription><bdi>{number}</bdi></DialogDescription></DialogHeader>{details}
    </DialogContent></Dialog>}
  </div>;
}
