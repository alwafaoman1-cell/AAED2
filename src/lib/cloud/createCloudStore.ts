// Generic Supabase-backed cloud store factory.
// Replaces createStore() (localStorage). Provides:
//   - React Query hooks (useList / useItem) with auto cache + realtime invalidation
//   - Async CRUD helpers (add / update / remove)
//   - tenant_id auto-injection on insert (RLS still enforces it)
//
// Usage:
//   const customersCloud = createCloudStore<CustomerRow>({
//     table: "customers",
//     queryKey: ["customers"],
//     orderBy: { column: "created_at", ascending: false },
//   });
//   // In a component:
//   const { data: customers = [] } = customersCloud.useList();
//   const add = customersCloud.useAdd();
//   await add.mutateAsync({ name: "Ahmed", phone: "..." });

import { supabase } from "@/integrations/supabase/client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;

export interface CloudRow {
  id: string;
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface CloudStoreOpts<T> {
  table: TableName;
  queryKey: readonly unknown[];
  orderBy?: { column: string; ascending?: boolean };
  /** Default columns to select (defaults to "*") */
  select?: string;
}

let cachedTenantId: string | null = null;
let cachedTenantPromise: Promise<string | null> | null = null;

/** Resolve the current user's tenant_id once and cache it for the session. */
export async function getCurrentTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  if (cachedTenantPromise) return cachedTenantPromise;
  cachedTenantPromise = (async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", uid)
      .maybeSingle();
    if (!error && data?.tenant_id) {
      cachedTenantId = data.tenant_id;
      return cachedTenantId;
    }

    const { data: rpcTenant } = await (supabase as any).rpc("get_user_tenant_id");
    if (rpcTenant) {
      cachedTenantId = rpcTenant;
      return cachedTenantId;
    }

    const { data: roleTenant } = await supabase
      .from("user_roles" as any)
      .select("tenant_id")
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();
    if ((roleTenant as any)?.tenant_id) {
      cachedTenantId = (roleTenant as any).tenant_id;
      return cachedTenantId;
    }

    return null;
  })();
  const r = await cachedTenantPromise;
  cachedTenantPromise = null;
  return r;
}

/** Clear the cached tenant_id (call on sign-out). */
export function clearTenantCache() {
  cachedTenantId = null;
  cachedTenantPromise = null;
}

// Listen to auth changes to clear cache automatically.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") clearTenantCache();
  });
}

/**
 * Realtime subscriptions are handled centrally by `useRealtimeSync` (mounted
 * once in AppLayout) which already invalidates the relevant React-Query keys
 * for every public table. Per-table subscriptions here were duplicating that
 * traffic and doubling the load on Realtime + React-Query. Kept as a no-op so
 * callers don't break.
 */
function subscribeRealtime(_table: string, _qc: QueryClient, _queryKey: readonly unknown[]) {
  /* intentionally empty — see useRealtimeSync */
}


export function createCloudStore<T extends CloudRow>(opts: CloudStoreOpts<T>) {
  const { table, queryKey, orderBy, select = "*" } = opts;

  async function fetchAll(): Promise<T[]> {
    let q = (supabase.from(table as any).select(select) as any);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? false });
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async function fetchOne(id: string): Promise<T | null> {
    const { data, error } = await (supabase
      .from(table as any) as any)
      .select(select)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as T) ?? null;
  }

  async function insert(values: Partial<T>): Promise<T> {
    const tenant_id = await getCurrentTenantId();
    const payload: any = { ...values };
    if (tenant_id && !payload.tenant_id) payload.tenant_id = tenant_id;
    const { data, error } = await (supabase
      .from(table as any) as any)
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as T;
  }

  async function update(id: string, patch: Partial<T>): Promise<T> {
    const { data, error } = await (supabase
      .from(table as any) as any)
      .update(patch as any)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as T;
  }

  async function remove(id: string): Promise<void> {
    const { error } = await (supabase.from(table as any) as any).delete().eq("id", id);
    if (error) throw error;
  }

  // ---------------- React hooks ----------------

  function useList(options?: Omit<UseQueryOptions<T[]>, "queryKey" | "queryFn">) {
    const qc = useQueryClient();
    useEffect(() => {
      subscribeRealtime(table as string, qc, queryKey);
    }, [qc]);
    return useQuery<T[]>({
      queryKey,
      queryFn: fetchAll,
      ...options,
    });
  }

  function useItem(id: string | undefined) {
    return useQuery<T | null>({
      queryKey: [...queryKey, id],
      queryFn: () => (id ? fetchOne(id) : Promise.resolve(null)),
      enabled: !!id,
    });
  }

  function useAdd() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (values: Partial<T>) => insert(values),
      onSuccess: () => qc.invalidateQueries({ queryKey }),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<T> }) => update(id, patch),
      onSuccess: () => qc.invalidateQueries({ queryKey }),
    });
  }

  function useRemove() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => remove(id),
      onSuccess: () => qc.invalidateQueries({ queryKey }),
    });
  }

  return {
    // imperative (non-react) helpers
    fetchAll,
    fetchOne,
    insert,
    update,
    remove,
    // react hooks
    useList,
    useItem,
    useAdd,
    useUpdate,
    useRemove,
    // meta
    table,
    queryKey,
  };
}
