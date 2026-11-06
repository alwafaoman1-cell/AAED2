import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { VehicleVisitControlPanel } from "@/pages/vehicle-entry/VehicleVisitControlPanel";
import { readSupervisorOrder, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import { useCan } from "@/lib/rbac";
import { useAuth } from "@/contexts/AuthContext";
import { VehicleVisitQuickActionDialog } from "@/pages/vehicle-entry/VehicleVisitQuickActionDialog";
import { SupervisorClaimApproval } from "./SupervisorClaimApproval";

const WorkOrderStatusDialog = lazy(() => import("@/components/workorders/WorkOrderStatusDialog"));
const VehicleDeliveryReceiptDialog = lazy(() => import("@/components/workorders/VehicleDeliveryReceiptDialog"));

export function SupervisorStagesPanel({ row, initialLocation = false }: { row: SupervisorVehicle; initialLocation?: boolean }) {
  const { t } = useTranslation("supervisorWorkspace");
  const qc = useQueryClient();
  const canStatus = useCan("Work Orders", "Status & delivery");
  const { profile, hasRole } = useAuth();
  const [statusOpen, setStatusOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [locationOpen,setLocationOpen]=useState(initialLocation);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const order = useQuery({
    queryKey: ["job_orders", "supervisor_action", profile?.tenant_id, row.entryId, row.workOrderId],
    queryFn: () => readSupervisorOrder(row), enabled: Boolean(row.workOrderId), staleTime: 0,
  });
  async function confirmedRefresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["vehicle_visit"] }),
      qc.invalidateQueries({ queryKey: ["job_orders"] }),
      qc.invalidateQueries({ queryKey: ["insurance_claims"] }),
    ]);
  }
  if (!row.entryId) return <p role="status">{t("noEntry")}</p>;
  const tools = <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="min-h-11 text-xs" onClick={()=>setLocationOpen(true)}>{t("custodyAction")}</Button>
      {!row.workOrderId ? <p role="status" className="text-sm text-warning">{t("noOrder")}</p> : order.isPending ? <p role="status">{t("cloudRead")}</p>
        : order.isError ? <div role="alert"><p>{t("actionError")}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => void order.refetch()}>{t("retry")}</Button></div>
          : <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11 text-xs" disabled={!canStatus || !order.data} onClick={() => setStatusOpen(true)}>{t("workOrderStatus")}</Button>
            <Button variant="outline" className="min-h-11 text-xs" disabled={!canStatus || !order.data} onClick={() => setHandoverOpen(true)}>{t("handover")}</Button>
          </div>}
    </div>;
  return <div className="space-y-3">
    <VehicleVisitControlPanel entryId={row.entryId} supervisor supervisorActions={tools}
      onRequestClaimApproval={row.claimId && hasRole("admin", "manager") ? () => setApprovalOpen(value => !value) : undefined}
      onRequestWorkOrderStatus={canStatus && order.data ? () => setStatusOpen(true) : undefined}
      onRequestHandover={canStatus && order.data ? () => setHandoverOpen(true) : undefined} />
    {approvalOpen && row.claimId && <section className="space-y-2 rounded-lg border border-border p-3" aria-label={t("approveHere")}>
      <h3 className="text-sm font-semibold">{t("approveHere")}</h3><p className="text-xs text-muted-foreground">{t("approvalHelp")}</p>
      <SupervisorClaimApproval claimId={row.claimId} onApproved={() => { setApprovalOpen(false); void confirmedRefresh(); }} />
    </section>}
    {locationOpen && <VehicleVisitQuickActionDialog row={row.visit?.entry || {id:row.entryId,entry_number:row.number}} open
      onOpenChange={setLocationOpen} workspace="supervisor" mode="location"
      onRequestHandover={canStatus && order.data ? ()=>setHandoverOpen(true) : undefined} />}
    <Suspense fallback={<p role="status">{t("loading")}</p>}>
      {statusOpen && order.data && <WorkOrderStatusDialog order={order.data} cloudJobOrderId={order.data.cloudId}
        open onOpenChange={setStatusOpen} onUpdated={() => void confirmedRefresh()}
        onRequestHandover={() => { setStatusOpen(false); setHandoverOpen(true); }} />}
      {handoverOpen && order.data && <VehicleDeliveryReceiptDialog order={order.data} open supervisor
        onOpenChange={setHandoverOpen} onFinalized={() => { setHandoverOpen(false); void confirmedRefresh(); }} />}
    </Suspense>
  </div>;
}
