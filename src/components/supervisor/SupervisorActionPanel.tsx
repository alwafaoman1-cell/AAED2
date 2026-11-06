import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCan } from "@/lib/rbac";
import { useAuth } from "@/contexts/AuthContext";
import { hasUnsavedWork } from "@/lib/unsavedWork";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { type SupervisorAction, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import type { ExpenseManagementRow } from "@/lib/expenses/expenseClassificationService";

const ExpenseFormPage = lazy(() => import("@/pages/accounting/expenses/ExpenseFormPage"));
const SupervisorStagesPanel = lazy(() => import("./SupervisorStagesPanel").then((module) => ({ default: module.SupervisorStagesPanel })));
const SupervisorOrderTools = lazy(() => import("./SupervisorOrderTools").then((module) => ({ default: module.SupervisorOrderTools })));
const SupervisorVisitMessages = lazy(() => import("./SupervisorVisitMessages").then((module) => ({ default: module.SupervisorVisitMessages })));
const SupervisorExpenseHistory = lazy(() => import("./SupervisorExpenseHistory").then((module) => ({ default: module.SupervisorExpenseHistory })));

export interface SupervisorPanelSelection { action: SupervisorAction | "expenseHistory"; row?: SupervisorVehicle }

export function SupervisorActionPanel({ selection, onClose }: { selection: SupervisorPanelSelection; onClose: () => void }) {
  const { t, i18n } = useTranslation("supervisorWorkspace");
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const pending = useIsMutating() > 0;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editingExpense,setEditingExpense]=useState<ExpenseManagementRow | null>(null);
  const { action, row } = selection;
  const canExpense = useCan("Expenses", "Add/Edit/Delete");
  const canStages = useCan("Work Orders", "Status & delivery");
  const canOrder = useCan("Work Orders", "Create/Edit");
  const allowed = action === "expense" || action === "expenseHistory" ? canExpense : action === "stages" || action === "location" ? canStages
    : action === "messages" ? hasRole("admin", "manager", "insurance", "supervisor") : canOrder;
  function requestClose() {
    if (pending) return;
    if (hasUnsavedWork()) setConfirmDiscard(true);
    else onClose();
  }
  async function saved() {
    // The shared form owns persistence, duplicate protection and readback.
    onClose();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["expense_management"] }),
      qc.invalidateQueries({ queryKey: ["expenses"] }),
      qc.invalidateQueries({ queryKey: ["job_orders"] }),
      qc.invalidateQueries({ queryKey: ["vehicle_visit"] }),
    ]);
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
    <DialogContent dir={i18n.dir()} className={`${action === "stages" || action === "location" ? "max-h-[92dvh] w-[calc(100%-1rem)] max-w-3xl rounded-xl" : "inset-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none sm:rounded-none"} flex flex-col gap-3 overflow-y-auto p-3 text-sm md:p-4 [&>button:last-child]:hidden`} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { event.preventDefault(); requestClose(); }}>
      <DialogHeader className="shrink-0 border-b border-border pb-3 text-start">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DialogTitle className="text-base">{t(action === "expense" && !row ? "generalExpense" : action === "location" ? "locationAction" : action)}</DialogTitle>
          <Button variant="outline" className="min-h-11 min-w-11" disabled={pending} onClick={requestClose}>{t("close")}</Button>
        </div>
        <DialogDescription>{row ? `${row.number} · ${row.plate}` : t("expenseHelp")}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1">
        {!allowed ? <p role="alert">{t("noPermission")}</p> : <Suspense fallback={<p role="status">{t("loading")}</p>}>
          {action === "expense" && <ExpenseFormPage supervisorContext={row ? { entryId: row.entryId, workOrderId: row.workOrderId, workOrderNumber: row.workOrderNumber } : {}}
            onSaved={() => { void saved(); }} onCancel={requestClose} />}
          {action === "expenseHistory" && (editingExpense ? <ExpenseFormPage recordId={editingExpense.id}
            supervisorContext={editingExpense.expense_scope === "work_order" && typeof editingExpense.work_order_id === "string" ? {workOrderId:editingExpense.work_order_id} : {}}
            onSaved={()=>{setEditingExpense(null);void qc.invalidateQueries({queryKey:["expense_management"]});}}
            onCancel={()=>{if(hasUnsavedWork())setConfirmDiscard(true);else setEditingExpense(null);}} /> : <SupervisorExpenseHistory onEdit={setEditingExpense} />)}
          {(action === "stages" || action === "location") && row && <SupervisorStagesPanel row={row} initialLocation={action === "location"} />}
          {action === "messages" && row && <SupervisorVisitMessages entryId={row.entryId} claimId={row.claimId} />}
          {(action === "parts" || action === "photos" || action === "qr") && row && <SupervisorOrderTools action={action} row={row} onClose={requestClose} />}
        </Suspense>}
      </div>
    </DialogContent>
  </Dialog>
  <AlertDialog open={confirmDiscard} onOpenChange={(open) => { if (!pending) setConfirmDiscard(open); }}>
    <AlertDialogContent dir={i18n.dir()}>
      <AlertDialogHeader><AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle><AlertDialogDescription>{t("discardDescription")}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel className="min-h-11" disabled={pending}>{t("keepEditing")}</AlertDialogCancel>
        <AlertDialogAction className="min-h-11" disabled={pending} onClick={() => { if (!pending) onClose(); }}>{t("discard")}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog></>;
}
