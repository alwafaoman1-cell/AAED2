import { supabase } from "@/integrations/supabase/client";

const listeners = new Set<() => void>();

interface ClockState {
  id: string;
  technician: string;
  startedAt: string;
  orderId?: string;
}

export interface TechNote {
  id: string;
  orderId: string;
  technician: string;
  text: string;
  createdAt: string;
}

let activeClock: ClockState | null = null;
let todayLogs: any[] = [];
let notesCache: TechNote[] = [];
let initialized = false;

function notify() {
  listeners.forEach((listener) => listener());
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    const next = char === "x" ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

async function getTenantId(): Promise<string> {
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error || !data) throw new Error(error?.message || "تعذر تحديد المؤسسة الحالية");
  return String(data);
}

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || null;
}

async function refreshTechStore() {
  const tenantId = await getTenantId();
  const userId = await getUserId();
  const today = new Date().toISOString().slice(0, 10);

  const [activeResult, logsResult, notesResult] = await Promise.all([
    (supabase.from("technician_time_logs" as any) as any)
      .select("id,technician_name,work_order_id,clock_in")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("technician_id", userId)
      .order("clock_in", { ascending: false })
      .limit(1),
    (supabase.from("technician_time_logs" as any) as any)
      .select("id,technician_name,work_order_id,clock_in,clock_out,minutes,status")
      .eq("tenant_id", tenantId)
      .gte("clock_in", `${today}T00:00:00.000Z`)
      .order("clock_in", { ascending: false }),
    (supabase.from("technician_notes" as any) as any)
      .select("id,technician_name,work_order_id,note,created_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (activeResult.error) throw activeResult.error;
  if (logsResult.error) throw logsResult.error;
  if (notesResult.error) throw notesResult.error;

  const active = activeResult.data?.[0];
  activeClock = active ? {
    id: active.id,
    technician: active.technician_name,
    startedAt: active.clock_in,
    orderId: active.work_order_id || undefined,
  } : null;

  todayLogs = (logsResult.data || []).map((row: any) => ({
    id: row.id,
    technician: row.technician_name,
    startedAt: row.clock_in,
    endedAt: row.clock_out,
    minutes: row.minutes,
    orderId: row.work_order_id || undefined,
    status: row.status,
  }));

  notesCache = (notesResult.data || []).map((row: any) => ({
    id: row.id,
    orderId: row.work_order_id,
    technician: row.technician_name,
    text: row.note,
    createdAt: row.created_at,
  }));
  notify();
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  void refreshTechStore().catch(() => undefined);
  supabase
    .channel("technician_cloud_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "technician_time_logs" }, () => {
      void refreshTechStore().catch(() => undefined);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "technician_notes" }, () => {
      void refreshTechStore().catch(() => undefined);
    })
    .subscribe();
}

export function subscribeTechStore(callback: () => void) {
  ensureInitialized();
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getActiveClock(): ClockState | null {
  ensureInitialized();
  return activeClock;
}

export function clockIn(technician: string, orderId?: string) {
  ensureInitialized();
  const id = safeUuid();
  const startedAt = new Date().toISOString();
  activeClock = { id, technician, startedAt, orderId };
  notify();
  void (async () => {
    const tenantId = await getTenantId();
    const userId = await getUserId();
    const { error } = await (supabase.from("technician_time_logs" as any) as any).insert({
      id,
      tenant_id: tenantId,
      technician_id: userId,
      technician_name: technician,
      work_order_id: orderId || null,
      clock_in: startedAt,
      status: "active",
    });
    if (error) throw error;
    await refreshTechStore();
  })().catch(() => {
    activeClock = null;
    notify();
  });
}

export function clockOut(): { minutes: number; orderId?: string } | null {
  ensureInitialized();
  const current = activeClock;
  if (!current) return null;
  const endedAt = new Date().toISOString();
  const minutes = Math.max(1, Math.round((Date.now() - new Date(current.startedAt).getTime()) / 60000));
  activeClock = null;
  todayLogs = [{ ...current, endedAt, minutes, status: "completed" }, ...todayLogs];
  notify();
  void (async () => {
    const { error } = await (supabase.from("technician_time_logs" as any) as any)
      .update({
        clock_out: endedAt,
        minutes,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);
    if (error) throw error;
    await refreshTechStore();
  })().catch(() => undefined);
  return { minutes, orderId: current.orderId };
}

export function getTodayLogs(): any[] {
  ensureInitialized();
  return todayLogs;
}

export function listNotes(orderId: string): TechNote[] {
  ensureInitialized();
  return notesCache
    .filter((note) => note.orderId === orderId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addNote(orderId: string, technician: string, text: string): TechNote {
  ensureInitialized();
  const note: TechNote = {
    id: safeUuid(),
    orderId,
    technician,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  notesCache = [note, ...notesCache];
  notify();
  void (async () => {
    const tenantId = await getTenantId();
    const userId = await getUserId();
    const { error } = await (supabase.from("technician_notes" as any) as any).insert({
      id: note.id,
      tenant_id: tenantId,
      technician_id: userId,
      technician_name: technician,
      work_order_id: orderId,
      note: note.text,
    });
    if (error) throw error;
    await refreshTechStore();
  })().catch(() => {
    notesCache = notesCache.filter((item) => item.id !== note.id);
    notify();
  });
  return note;
}

export function deleteNote(id: string) {
  ensureInitialized();
  const previous = notesCache;
  notesCache = notesCache.filter((note) => note.id !== id);
  notify();
  void (async () => {
    const { error } = await (supabase.from("technician_notes" as any) as any)
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  })().catch(() => {
    notesCache = previous;
    notify();
  });
}
