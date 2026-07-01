// Registers restore handlers for every entity type so that when the user
// restores an item from the Trash page, it's added back to the right store.
import { useEffect } from "react";
import { registerRestoreHandler } from "@/lib/trashStore";
import { restoreWorkOrderFromTrash, type WorkOrder } from "@/lib/workOrdersStore";
import { isUuid } from "@/lib/uuid";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { customersStore, refreshCustomersFromCloud, type Customer } from "@/lib/customersStore";
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
    registerRestoreHandler("customer", async (p, item) => {
      const payload = p as Customer;
      const tenantId = await getCurrentTenantId();
      if (!tenantId || !isUuid(item.entityId)) throw new Error("Cannot restore customer without a valid tenant/customer id");
      const { error } = await supabase
        .from("customers")
        .update({
          deleted_at: null,
          archived_at: null,
          archived: false,
          deleted_by: null,
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", item.entityId);
      if (error) throw error;
      await refreshCustomersFromCloud();
      customersStore.restore({ ...payload, id: item.entityId });
    });
    registerRestoreHandler("vehicle", (p) => vehiclesStore.restore(p as Vehicle));
    registerRestoreHandler("inventory", (p) => inventoryStore.restore(p as Part));
    registerRestoreHandler("staff", (p) => staffStore.restore(p as Technician));
    registerRestoreHandler("inspection", (p) => inspectionsStore.restore(p as InspectionRecord));
    // Invoice/Quote restore is wired in Sales page where the docs state lives.
    // Claim restore is wired through the Insurance React Query mutation.
  }, []);
}
