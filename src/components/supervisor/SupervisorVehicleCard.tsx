import { Camera, ClipboardList, FileInput, MapPin, MessageCircle, MoreHorizontal, Package, QrCode, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VehicleRearThumbnail } from "@/components/vehicles/VehicleRearThumbnail";
import { supervisorCanOpenAction, type SupervisorAction, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import "@/lib/i18n/supervisorWorkspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SupervisorVisitClocks } from "./SupervisorVisitClocks";
import type { SupervisorMilestone } from "@/lib/supervisorVisitTiming";

export interface SupervisorPermissions {
  expense: boolean;
  stages: boolean;
  workOrder: boolean;
  entry: boolean;
  messages: boolean;
}

export function SupervisorVehicleCard({ row, permissions, photoUrl, onAction, onOpenEntry, milestones, now = Date.now() }: {
  row: SupervisorVehicle;
  permissions: SupervisorPermissions;
  photoUrl?: string;
  onAction: (action: SupervisorAction, row: SupervisorVehicle) => void;
  onOpenEntry: (row: SupervisorVehicle) => void;
  milestones?: SupervisorMilestone[];
  now?: number;
}) {
  const { t } = useTranslation("supervisorWorkspace");
  const buttons = [
    { action: "photos", icon: Camera, allowed: permissions.workOrder },
    { action: "parts", icon: Package, allowed: permissions.workOrder },
    { action: "messages", icon: MessageCircle, allowed: permissions.messages },
  ] as const;
  return <Card role="article" aria-label={`${row.number} · ${row.plate}`} className="flex min-w-0 flex-col gap-2.5 rounded-xl p-3 text-sm shadow-sm">
    <div className="flex items-start gap-3">
      <VehicleRearThumbnail url={photoUrl} alt={row.vehicle || t("unknown")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="whitespace-nowrap font-mono text-xs font-semibold" dir="ltr">{row.workOrderNumber || row.number || t("unknown")}</p>
          <Badge variant="outline" className="shrink-0 text-xs font-normal">{t(row.channel)}</Badge>
        </div>
        <h2 className="mt-1 break-words text-sm font-semibold leading-5">{row.vehicle || t("unknown")}</h2>
        <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{row.customer || t("unknown")}</p>
        <p className="mt-0.5 font-mono text-base font-bold tracking-wide" dir="ltr">{row.plate || t("unknown")}{row.country ? <span className="ms-1 text-xs font-normal text-muted-foreground"> · {row.country}</span> : null}</p>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-y border-border py-1.5">
      <Button variant="ghost" className="min-h-11 gap-1.5 px-2 text-xs" disabled={!permissions.stages || !row.entryId}
        aria-label={`${t("locationAction")}: ${t(row.custody)}`} onClick={() => onAction("location", row)}>
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t(row.custody)}
      </Button>
      <span className="ms-auto rounded-md bg-muted px-2 py-1 text-xs font-semibold">{t(row.stage || "unknown")}</span>
    </div>
    <SupervisorVisitClocks row={row} milestones={milestones} now={now} />
    {(row.legacy || !row.entryId || row.review) && <p className="text-xs text-warning" role="status">
      {t(row.legacy ? "noEntry" : !row.entryId ? "claimOnly" : "reviewWarning")}
    </p>}
    <div className="mt-auto grid grid-cols-2 gap-2">
      <Button className="min-h-11 gap-1.5 px-2 text-xs" disabled={!permissions.stages || !supervisorCanOpenAction(row, "stages")}
        onClick={() => onAction("stages", row)}><ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />{t("updateStage")}</Button>
      <Button variant="outline" className="min-h-11 gap-1.5 px-2 text-xs" disabled={!permissions.expense || !supervisorCanOpenAction(row, "expense")}
        onClick={() => onAction("expense", row)}><Receipt className="h-4 w-4 shrink-0" aria-hidden="true" />{t("expense")}</Button>
    </div>
    <div className="grid grid-cols-4 gap-1 border-t border-border pt-1">
      {buttons.map(({ action, icon: Icon, allowed }) => <Button key={action} variant="ghost"
        className="min-h-11 gap-1 px-1 text-xs" disabled={!allowed || !supervisorCanOpenAction(row, action)}
        title={!allowed ? t("noPermission") : !supervisorCanOpenAction(row, action) ? t(action === "messages" ? "noMessages" : "noOrder") : undefined}
        onClick={() => onAction(action, row)}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(action)}</Button>)}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="min-h-11 gap-1 px-1 text-xs" aria-label={t("moreActions")}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t("moreActions")}</span>
      </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem className="min-h-11 gap-2" disabled={!permissions.entry} onSelect={() => onOpenEntry(row)}><FileInput className="h-4 w-4" aria-hidden="true" />{t(row.entryId ? "openEntry" : "registerEntry")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-2" disabled={!permissions.workOrder || !supervisorCanOpenAction(row, "qr")} onSelect={() => onAction("qr", row)}><QrCode className="h-4 w-4" aria-hidden="true" />{t("qr")}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>
    {!row.entryId && <Button className="min-h-11 text-xs" variant="secondary" disabled={!permissions.entry} onClick={() => onOpenEntry(row)}><FileInput className="me-2 h-4 w-4" aria-hidden="true" />{t("registerEntry")}</Button>}
  </Card>;
}
