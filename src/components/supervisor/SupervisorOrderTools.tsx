import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readSupervisorOrder, type SupervisorAction, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import { getWorkOrderById, subscribeWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";
import { useCan } from "@/lib/rbac";
import { useAuth } from "@/contexts/AuthContext";
import { getNeededPartsRequestHtml } from "@/lib/pdfGenerator";
import { openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import { SupervisorPartsMessenger } from "./SupervisorPartsMessenger";

const StagePhotosDialog = lazy(() => import("@/components/workorders/StagePhotosDialog"));
const QrLabel = lazy(() => import("@/components/workorders/QrLabel"));
const NeededPartsManager = lazy(() => import("@/components/workorders/NeededPartsManager"));

export function SupervisorOrderTools({ action, row, onClose }: { action: SupervisorAction; row: SupervisorVehicle; onClose: () => void }) {
  const { t } = useTranslation("supervisorWorkspace");
  const canEdit = useCan("Work Orders", "Create/Edit");
  const { profile } = useAuth();
  const [, update] = useState(0);
  const [messageTarget, setMessageTarget] = useState<"customer" | "supplier" | null>(null);
  useEffect(() => subscribeWorkOrders(() => update((value) => value + 1)), []);
  const query = useQuery({ queryKey: ["job_orders", "supervisor_action", profile?.tenant_id, row.entryId, row.workOrderId], queryFn: () => readSupervisorOrder(row), staleTime: 0 });
  const fresh = query.data;
  const order = fresh ? getWorkOrderById(fresh.cloudId || fresh.id) || fresh : undefined;

  function printParts(current: WorkOrder) {
    if (!current.partsNeeded?.length) { toast.error(t("partsEmpty")); return; }
    openSanitizedPdfWindow(getNeededPartsRequestHtml({
      requestNumber: `PR-${current.id}`, date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Muscat" }),
      rows: [{ workOrderId: current.id, customer: current.customer, vehicle: `${current.vehicleType} ${current.model} ${current.year}`.trim(),
        vehicleType: `${current.vehicleType} ${current.model}`.trim(), year: current.year, vin: current.vin, plate: current.plate,
        parts: current.partsNeeded.map((part) => ({ name: part.name, quantity: part.quantity, notes: part.notes, fulfilled: part.fulfilled })) }],
    }));
  }
  if (!canEdit) return <p role="alert">{t("noPermission")}</p>;
  if (query.isPending) return <p role="status">{t("cloudRead")}</p>;
  if (query.isError || !order) return <div role="alert"><p>{t("actionError")}</p><Button className="mt-3 min-h-11" onClick={() => void query.refetch()}>{t("retry")}</Button></div>;
  return <Suspense fallback={<p role="status">{t("loading")}</p>}>
    {action === "photos" && <StagePhotosDialog orderId={order.id} open onClose={onClose} updateOrderStatus={false} />}
    {action === "qr" && <QrLabel order={order} open onClose={onClose} />}
    {action === "parts" && <div className="space-y-4">
      <NeededPartsManager order={order} allowEdit={canEdit} onPrintRequest={() => printParts(order)}
        onSendWhatsApp={() => setMessageTarget("customer")} onSendToSuppliers={() => setMessageTarget("supplier")} />
      {messageTarget && <SupervisorPartsMessenger row={row} order={order} target={messageTarget} onClose={() => setMessageTarget(null)} />}
    </div>}
  </Suspense>;
}
