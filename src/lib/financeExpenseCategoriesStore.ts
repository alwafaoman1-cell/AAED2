import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

/** Read-only compatibility view for legacy expense forms. The canonical source is expense_categories. */
export interface FinanceCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  active: boolean;
  createdAt: string;
}

let rows: FinanceCategory[] = [];
let tenantId: string | null = null;
let requestVersion = 0;
let started = false;
let activeUserId: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch (error) { console.warn("[expense categories] subscriber failed", error); }
  }
}

function clear() {
  requestVersion += 1;
  tenantId = null;
  rows = [];
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  notify();
}

function watchTenant(id: string) {
  if (tenantId === id) return;
  clear();
  tenantId = id;
  channel = supabase.channel(`expense_categories_${id}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "expense_categories", filter: `tenant_id=eq.${id}`,
    }, () => { void expenseCategoriesStore.refresh().catch((error) => console.warn("[expense categories] realtime refresh failed", error)); })
    .subscribe();
}

function toFinanceCategory(row: Record<string, unknown>): FinanceCategory {
  return {
    id: String(row.id || ""),
    name: String(row.name_ar || row.name_en || row.name || ""),
    description: String(row.description_ar || row.description_en || row.description || ""),
    color: String(row.color || ""),
    active: row.is_active === true || (row.is_active == null && row.active === true),
    createdAt: String(row.created_at || ""),
  };
}

function legacyMutationBlocked(): never {
  throw new Error("إدارة تصنيفات المصروفات تتم من صفحة /accounting/expenses/categories مع الاسمين العربي والإنجليزي.");
}

export const expenseCategoriesStore = {
  getAll(): FinanceCategory[] {
    if (!started) {
      started = true;
      queueMicrotask(() => { void expenseCategoriesStore.refresh().catch((error) => console.warn("[expense categories] initial read failed", error)); });
    }
    return rows;
  },
  getById(id: string) { return rows.find((row) => row.id === id); },
  subscribe(listener: () => void) {
    listeners.add(listener);
    expenseCategoriesStore.getAll();
    return () => { listeners.delete(listener); };
  },
  async refresh(): Promise<void> {
    started = true;
    const version = ++requestVersion;
    const currentTenantId = await getCurrentTenantId();
    if (version !== requestVersion) return;
    if (!currentTenantId) { clear(); return; }
    watchTenant(currentTenantId);
    const readVersion = requestVersion;
    const { data, error } = await supabase.from("expense_categories")
      .select("id,name,name_ar,name_en,description,description_ar,description_en,color,active,is_active,created_at")
      .eq("tenant_id", currentTenantId);
    if (readVersion !== requestVersion || await getCurrentTenantId() !== currentTenantId) return;
    if (error) {
      rows = [];
      notify();
      throw new Error(error.message || "تعذر قراءة تصنيفات المصروفات");
    }
    rows = (data || []).map((row) => toFinanceCategory(row as Record<string, unknown>))
      .filter((row) => row.id && row.name);
    notify();
  },
  add(_item: FinanceCategory): void { legacyMutationBlocked(); },
  update(_id: string, _patch: Partial<FinanceCategory>): void { legacyMutationBlocked(); },
  remove(_id: string): FinanceCategory | undefined { legacyMutationBlocked(); },
};

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user?.id ?? null;
    if (userId === activeUserId) return;
    activeUserId = userId;
    clear();
    setTimeout(() => { void expenseCategoriesStore.refresh().catch((error) => console.warn("[expense categories] auth refresh failed", error)); }, 0);
  });
}
