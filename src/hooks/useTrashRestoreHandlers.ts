// Registers restore handlers for every entity type so that when the user
// restores an item from the Trash page, it's added back to the right store.
import { useEffect } from "react";
import { registerRestoreHandler } from "@/lib/trashStore";
import { restoreWorkOrderFromTrash, type WorkOrder } from "@/lib/workOrdersStore";
import { isUuid } from "@/lib/uuid";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { staffStore, type Technician } from "@/lib/staffStore";
import { inspectionsStore, type InspectionRecord } from "@/lib/inspectionsStore";

let registered = false;

export function useTrashRestoreHandlers() {
  useEffect(() => {
    if (registered) return;
    registered = true;
    registerRestoreHandler("work_order", async (p, item) => {
      const payload = p as WorkOrder;
      const cloudId = payload.cloudId || (isUuid(item.entityId) ? item.entityId : undefined);
      const labelOrderNumber = item.label.match(/WO-\d{4}-\d+/)?.[0];
      await restoreWorkOrderFromTrash({
        ...payload,
        id: labelOrderNumber || payload.id,
        displayNumber: labelOrderNumber || payload.displayNumber,
        cloudId,
      });
    });
    registerRestoreHandler("vehicle", (p) => vehiclesStore.restore(p as Vehicle));
    registerRestoreHandler("inventory", (p) => inventoryStore.restore(p as Part));
    registerRestoreHandler("staff", (p) => staffStore.restore(p as Technician));
    registerRestoreHandler("inspection", (p) => inspectionsStore.restore(p as InspectionRecord));
    // Invoice/Quote restore is wired in Sales page where the docs state lives.
    // Claim restore is wired through the Insurance React Query mutation.
  }, []);
}
