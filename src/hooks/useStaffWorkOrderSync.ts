import { useEffect } from "react";
import { refreshWorkOrdersFromCloud } from "@/lib/workOrdersStore";
import { hasUnsavedWork, subscribeUnsavedWork } from "@/lib/unsavedWork";
import { useAuth } from "@/contexts/AuthContext";

const RESUME_AFTER_MS = 30_000;

/** Reconcile missed realtime events after a staff app was backgrounded or offline. */
export function useStaffWorkOrderSync() {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile?.tenant_id) return;
    let hiddenAt: number | null = null;
    let pending = false;
    let running = false;
    let disposed = false;

    const refresh = () => {
      if (disposed) return;
      if (document.visibilityState !== "visible" || hasUnsavedWork() || running) {
        pending = true;
        return;
      }
      pending = false;
      running = true;
      void refreshWorkOrdersFromCloud()
        .catch((error) => console.warn("[staff-work-orders] cloud reconciliation failed:", error))
        .finally(() => {
          running = false;
          if (pending && !disposed) refresh();
        });
    };

    refresh();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") hiddenAt = Date.now();
      else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_MS) refresh();
        hiddenAt = null;
      }
    };
    const onOnline = () => refresh();
    const unsubscribeDirty = subscribeUnsavedWork((dirty) => {
      if (!dirty && pending) refresh();
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      unsubscribeDirty();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [profile?.tenant_id]);
}
