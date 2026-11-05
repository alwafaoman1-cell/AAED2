import { Camera, ClipboardList, FileInput, MessageCircle, Package, QrCode, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VehicleRearThumbnail } from "@/components/vehicles/VehicleRearThumbnail";
import { supervisorCanOpenAction, type SupervisorAction, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import "@/lib/i18n/supervisorWorkspace";

export interface SupervisorPermissions {
  expense: boolean;
  stages: boolean;
  workOrder: boolean;
  entry: boolean;
  messages: boolean;
}

export function SupervisorVehicleCard({ row, permissions, photoUrl, onAction, onOpenEntry }: {
  row: SupervisorVehicle;
  permissions: SupervisorPermissions;
  photoUrl?: string;
  onAction: (action: SupervisorAction, row: SupervisorVehicle) => void;
  onOpenEntry: (row: SupervisorVehicle) => void;
}) {
  const { t } = useTranslation("supervisorWorkspace");
  const buttons = [
    { action: "expense", icon: Receipt, allowed: permissions.expense },
    { action: "stages", icon: ClipboardList, allowed: permissions.stages },
    { action: "photos", icon: Camera, allowed: permissions.workOrder },
    { action: "parts", icon: Package, allowed: permissions.workOrder },
    { action: "qr", icon: QrCode, allowed: permissions.workOrder },
    { action: "messages", icon: MessageCircle, allowed: permissions.messages },
  ] as const;
  return <Card role="article" aria-label={`${row.number} · ${row.plate}`} className="flex min-w-0 flex-col gap-4 p-4 text-sm">
    <div className="flex items-start gap-3">
      <VehicleRearThumbnail url={photoUrl} alt={row.vehicle || t("unknown")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="break-words font-mono font-semibold" dir="ltr">{row.number || t("unknown")}</p>
          <Badge variant="outline" className="text-xs">{t(row.channel)}</Badge>
        </div>
        <h2 className="mt-1 break-words text-base font-semibold">{row.vehicle || t("unknown")}</h2>
        <p className="mt-1 break-words text-muted-foreground">{row.customer || t("unknown")}</p>
        <p className="mt-1 font-mono" dir="ltr">{row.plate || t("unknown")}{row.country ? ` · ${row.country}` : ""}</p>
      </div>
    </div>
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
      <div><dt className="text-xs text-muted-foreground">{t("custody")}</dt><dd className="mt-1 font-medium">{t(row.custody)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">{t("stage")}</dt><dd className="mt-1 font-medium">{t(row.stage || "unknown")}</dd></div>
      <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t("arrival")}</dt><dd className="mt-1" dir="ltr">{row.arrivalDate || t("unknown")}</dd></div>
    </dl>
    {(row.legacy || !row.entryId || row.review) && <p className="text-xs text-warning" role="status">
      {t(row.legacy ? "noEntry" : !row.entryId ? "claimOnly" : "reviewWarning")}
    </p>}
    {!row.workOrderId && <p className="text-xs text-muted-foreground">{t("toolsHint")}</p>}
    <div className="mt-auto grid grid-cols-2 gap-2 sm:grid-cols-3">
      {buttons.map(({ action, icon: Icon, allowed }) => <Button key={action} variant="outline"
        className="min-h-11 whitespace-normal px-2 text-xs" disabled={!allowed || !supervisorCanOpenAction(row, action)}
        title={!allowed ? t("noPermission") : !supervisorCanOpenAction(row, action) ? t(action === "stages" ? "noEntry" : action === "messages" ? "noMessages" : "noOrder") : undefined}
        onClick={() => onAction(action, row)}><Icon className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t(action)}</Button>)}
    </div>
    <Button className="min-h-11" variant="secondary" disabled={!permissions.entry} onClick={() => onOpenEntry(row)}>
      <FileInput className="me-2 h-4 w-4" aria-hidden="true" />{t(row.entryId ? "openEntry" : "registerEntry")}
    </Button>
  </Card>;
}
