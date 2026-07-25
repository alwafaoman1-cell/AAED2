import { useEffect, useRef } from "react";
import { clearDraft, readDraft, saveDraft } from "@/lib/drafts/draftService";
import { markClean, markDirty } from "@/lib/unsavedWork";

export interface DraftPersistenceOptions<T> {
  scopeId: string;
  data: T;
  enabled?: boolean;
  dirty: boolean;
  debounceMs?: number;
  onRestore: (data: T) => void;
}

export function useDraftPersistence<T>({
  scopeId,
  data,
  enabled = true,
  dirty,
  debounceMs = 1000,
  onRestore,
}: DraftPersistenceOptions<T>) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !scopeId || hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = readDraft<T>(scopeId);
    if (!stored) return;
    const shouldRestore = window.confirm("تم العثور على مسودة غير محفوظة. هل تريد استعادتها؟");
    if (shouldRestore) {
      onRestore(stored.data);
      markDirty(scopeId);
    } else {
      clearDraft(scopeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scopeId]);

  useEffect(() => {
    if (!enabled || !scopeId) return;
    if (dirty) markDirty(scopeId);
    else markClean(scopeId);
    return () => markClean(scopeId);
  }, [dirty, enabled, scopeId]);

  useEffect(() => {
    if (!enabled || !scopeId || !dirty) return;
    const timer = window.setTimeout(() => saveDraft(scopeId, data), debounceMs);
    return () => window.clearTimeout(timer);
  }, [data, debounceMs, dirty, enabled, scopeId]);

  return {
    clear: () => {
      clearDraft(scopeId);
      markClean(scopeId);
    },
  };
}

