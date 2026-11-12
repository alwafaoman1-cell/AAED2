import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOverdueInsuranceSummary, overdueInsuranceQueryKey } from "@/lib/overdueInsuranceSummary";

export type { OverdueCompany } from "@/lib/overdueInsuranceSummary";

const invalidationSubscribers = new WeakMap<QueryClient, { count: number; unsubscribe: () => void }>();

function subscribeSummaryInvalidation(qc: QueryClient) {
  let shared = invalidationSubscribers.get(qc);
  if (!shared) {
    let queued = false;
    let disposed = false;
    let needsRefresh = false;
    let alreadyCovered = false;
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const [root, child] = event.query.queryKey;
      const summaryRefresh = root === "insurance_claims" && child === "overdue_summary" && event.action.type === "invalidate";
      if (summaryRefresh) {
        // Only a later invalidation covers the dependency event. A fetch that
        // was already running before a payment/approval changed does not.
        if (needsRefresh && event.query.state.data !== undefined) alreadyCovered = true;
        return;
      }
      const invalidatedDependency = event.action.type === "invalidate" &&
        (root === "insurance_invoices" || root === "insurance_companies" || root === "claim_payments");
      const manualClaimUpdate = root === "insurance_claims" && child !== "overdue_summary" &&
        event.action.type === "success" && event.action.manual;
      if (!invalidatedDependency && !manualClaimUpdate) return;
      needsRefresh ||= !!invalidatedDependency || !!manualClaimUpdate;
      if (queued) return;
      queued = true;
      // A broad mutation can invalidate many cached pages; refresh the shared
      // summary once, even when both bells are mounted.
      queueMicrotask(() => {
        const refresh = needsRefresh && !alreadyCovered;
        needsRefresh = false;
        alreadyCovered = false;
        queued = false;
        if (disposed || !refresh) return;
        const filters = { queryKey: overdueInsuranceQueryKey, refetchType: "active" as const };
        const initialReadInFlight = qc.getQueryCache().findAll({ queryKey: overdueInsuranceQueryKey, type: "active" })
          .some((query) => query.state.data === undefined && query.state.fetchStatus === "fetching");
        // React Query normally reuses an initial in-flight read even during
        // invalidation. Explicit cancellation prevents an older snapshot from
        // hiding the change that just triggered this refresh.
        if (initialReadInFlight) {
          void qc.cancelQueries({ queryKey: overdueInsuranceQueryKey }).then(() => {
            if (!disposed) return qc.invalidateQueries(filters);
          });
        } else {
          void qc.invalidateQueries(filters);
        }
      });
    });
    shared = { count: 0, unsubscribe: () => { disposed = true; unsubscribe(); } };
    invalidationSubscribers.set(qc, shared);
  }
  shared.count += 1;
  return () => {
    if (--shared.count === 0) {
      shared.unsubscribe();
      invalidationSubscribers.delete(qc);
    }
  };
}

function useInvalidationSource(root: string, tenantId?: string, userId?: string) {
  // Keep an observable cache key for existing mutations even if no full-table
  // reader is mounted. Invalidating a sentinel resolves locally, resetting its
  // stale flag so later mutations are observed too; it never reads the backend.
  useQuery({
    queryKey: [root, "overdue_invalidation", tenantId, userId],
    queryFn: () => null,
    initialData: null,
    enabled: !!tenantId && !!userId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useOverdueInsuranceAlerts() {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const queryKey = [...overdueInsuranceQueryKey, profile?.tenant_id, profile?.user_id, profile?.role, i18n.language];

  useInvalidationSource("insurance_invoices", profile?.tenant_id, profile?.user_id);
  useInvalidationSource("insurance_companies", profile?.tenant_id, profile?.user_id);
  useInvalidationSource("claim_payments", profile?.tenant_id, profile?.user_id);
  useEffect(() => subscribeSummaryInvalidation(qc), [qc]);

  // Consumers must distinguish undefined/loading/error from a confirmed [].
  // Sharing this tenant/user/role-keyed query also deduplicates the two bells.
  return useQuery({
    queryKey,
    enabled: !!profile?.tenant_id && !!profile?.user_id,
    queryFn: ({ signal }) => fetchOverdueInsuranceSummary(
      profile!.tenant_id, signal, i18n.language.startsWith("en") ? "Unspecified" : "غير محدد",
    ),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
