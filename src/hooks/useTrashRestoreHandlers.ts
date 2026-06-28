// Registers restore handlers for every entity type so that when the user
// restores an item from the Trash page, it's added back to the right store.
import { useEffect } from "react";
import { registerRestoreHandler } from "@/lib/trashStore";
import { restoreWorkOrderFromTrash, type WorkOrder } from "@/lib/workOrdersStore";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { staffStore, type Technician } from "@/lib/staffStore";
import { inspectionsStore, type InspectionRecord } from "@/lib/inspectionsStore";

let registered = false;

export function useTrashRestoreHandlers() {
  useEffect(() => {
    if (registered) return;
    registered = true;
    registerRestoreHandler("work_order", async (p) => {
      await restoreWorkOrderFromTrash(p as WorkOrder);
    });
    registerRestoreHandler("vehicle", (p) => vehiclesStore.restore(p as Vehicle));
    registerRestoreHandler("inventory", (p) => inventoryStore.restore(p as Part));
    registerRestoreHandler("staff", (p) => staffStore.restore(p as Technician));
    registerRestoreHandler("inspection", (p) => inspectionsStore.restore(p as InspectionRecord));
    // Invoice/Quote restore is wired in Sales page where the docs state lives.
    // Claim restore is wired through the Insurance React Query mutation.
  }, []);
}
