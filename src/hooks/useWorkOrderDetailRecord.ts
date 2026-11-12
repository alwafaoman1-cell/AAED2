import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  fetchWorkOrderFromCloudByIdentifier,
  getWorkOrderById,
  subscribeWorkOrders,
  type WorkOrder,
} from "@/lib/workOrdersStore";

type RecordState = { scope: string; order?: WorkOrder; loading: boolean; error: Error | null };

/** One confirmed cloud row, with the existing canonical mapper/cache and alias resolution. */
export function useWorkOrderDetailRecord(id: string, tenantId?: string | null) {
  const scope = JSON.stringify([tenantId || null, id]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<RecordState>({ scope: "", loading: true, error: null });

  useEffect(() => {
    let active = true;
    let confirmed = false;
    setState({ scope, loading: true, error: null });
    if (!tenantId || !id) return () => { active = false; };

    // Observe confirmed saves/Realtime without hydrating the entire workshop.
    const unsubscribe = subscribeWorkOrders(() => {
      if (!active) return;
      const cached = getWorkOrderById(id);
      // Another screen can renumber/remove this cached identity. Resolve the
      // same route through the canonical alias/deletion reader, never retain
      // stale editable data or trigger a workshop-wide refresh.
      if (confirmed && !cached) { setRevision((value) => value + 1); return; }
      setState((current) => current.scope !== scope || current.loading || current.error
        ? current : { ...current, order: cached });
    }, { loadAll: false });

    void fetchWorkOrderFromCloudByIdentifier(id).then((order) => {
      confirmed = Boolean(order);
      if (active) setState({ scope, order: order || undefined, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setState({ scope, loading: false, error: error instanceof Error ? error : new Error("WORK_ORDER_LOAD_FAILED") });
    });
    return () => { active = false; unsubscribe(); };
  }, [id, tenantId, scope, revision]);

  const setOrder: Dispatch<SetStateAction<WorkOrder | undefined>> = useCallback((value) => {
    setState((current) => current.scope !== scope ? current : {
      ...current, order: typeof value === "function" ? value(current.order) : value,
    });
  }, [scope]);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const current: RecordState = state.scope === scope ? state : { scope, loading: true, error: null };
  return { order: current.order, setOrder, loading: current.loading, error: current.error, retry };
}
