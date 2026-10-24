// مركز إشعارات المدير — يدمج جدول admin_notifications + admin_notification_reads مع Realtime
import { supabase } from "@/integrations/supabase/client";
import { notificationSound } from "./notificationSound";

export type AdminNotifType = "info" | "warning" | "urgent" | "success" | "error";

export interface AdminNotification {
  id: string;
  tenant_id: string;
  sender_id: string;
  sender_name: string | null;
  title: string;
  body: string;
  type: AdminNotifType;
  link: string | null;
  created_at: string;
  read: boolean;
  deleted: boolean;
}

let cache: AdminNotification[] = [];
let currentUser: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
const subs = new Set<() => void>();
let inited = false;
let pendingInit: Promise<void> | null = null;

function emit() { subs.forEach((f) => f()); }

async function reload() {
  if (!currentUser) return;
  const { data: notifs, error: notificationsError } = await supabase
    .from("admin_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (notificationsError) throw notificationsError;
  const { data: reads, error: readsError } = await supabase
    .from("admin_notification_reads")
    .select("notification_id, read_at, deleted_at")
    .eq("user_id", currentUser);
  if (readsError) throw readsError;
  const map = new Map<string, { read: boolean; deleted: boolean }>();
  (reads || []).forEach((r: any) => map.set(r.notification_id, {
    read: !!r.read_at, deleted: !!r.deleted_at,
  }));
  cache = (notifs || []).map((n: any) => ({
    ...n,
    read: map.get(n.id)?.read ?? false,
    deleted: map.get(n.id)?.deleted ?? false,
  }));
  emit();
}

export const adminNotificationsStore = {
  async init() {
    if (inited) return;
    if (pendingInit) return pendingInit;
    const request = (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      currentUser = data.user?.id ?? null;
      if (!currentUser) return;
      await reload();
      channel = supabase
      .channel("admin-notifications-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_notifications" }, async (payload) => {
        try {
          const isInsert = payload.eventType === "INSERT";
          await reload();
          if (isInsert && (payload.new as any)?.sender_id !== currentUser) {
            notificationSound.play();
            const { toast } = await import("sonner");
            const n: any = payload.new;
            const typeMap: Record<string, (msg: string, opts?: any) => void> = {
              urgent: (m, o) => toast.error(m, o),
              error: (m, o) => toast.error(m, o),
              warning: (m, o) => toast.warning(m, o),
              success: (m, o) => toast.success(m, o),
              info: (m, o) => toast.info(m, o),
            };
            (typeMap[n.type] || toast.info)(n.title, { description: n.body });
          }
        } catch (error) {
          console.error("[adminNotifications] realtime refresh failed", error);
        }
      })
      .subscribe();
      inited = true;
    })();
    pendingInit = request;
    try {
      await request;
    } finally {
      if (pendingInit === request) pendingInit = null;
    }
  },
  list(): AdminNotification[] {
    return cache.filter((n) => !n.deleted);
  },
  unreadCount(): number {
    return cache.filter((n) => !n.deleted && !n.read).length;
  },
  async markRead(id: string) {
    if (!currentUser) throw new Error("not_authenticated");
    const { error } = await supabase.from("admin_notification_reads").upsert({
      notification_id: id, user_id: currentUser, read_at: new Date().toISOString(),
    });
    if (error) throw error;
    const it = cache.find((n) => n.id === id);
    if (it) { it.read = true; emit(); }
  },
  async markAllRead() {
    if (!currentUser) throw new Error("not_authenticated");
    const ids = cache.filter((n) => !n.deleted && !n.read).map((n) => n.id);
    if (!ids.length) return;
    const rows = ids.map((id) => ({ notification_id: id, user_id: currentUser, read_at: new Date().toISOString() }));
    const { error } = await supabase.from("admin_notification_reads").upsert(rows);
    if (error) throw error;
    ids.forEach((id) => { const it = cache.find((n) => n.id === id); if (it) it.read = true; });
    emit();
  },
  async hideForMe(id: string) {
    if (!currentUser) throw new Error("not_authenticated");
    const { error } = await supabase.from("admin_notification_reads").upsert({
      notification_id: id, user_id: currentUser,
      read_at: new Date().toISOString(), deleted_at: new Date().toISOString(),
    });
    if (error) throw error;
    const it = cache.find((n) => n.id === id);
    if (it) { it.deleted = true; emit(); }
  },
  async send(input: { title: string; body: string; type: AdminNotifType; link?: string }) {
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) throw new Error("not authenticated");
    const { data: prof } = await supabase
      .from("profiles").select("tenant_id, full_name").eq("user_id", userId).maybeSingle();
    if (!prof?.tenant_id) throw new Error("no tenant");
    const { error } = await supabase.from("admin_notifications").insert({
      tenant_id: prof.tenant_id,
      sender_id: userId,
      sender_name: prof.full_name || null,
      title: input.title.trim().slice(0, 200),
      body: input.body.trim().slice(0, 2000),
      type: input.type,
      link: input.link?.trim() || null,
    });
    if (error) throw error;
    await reload();
  },
  subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; },
  async teardown() {
    if (channel) { await supabase.removeChannel(channel); channel = null; }
    inited = false; pendingInit = null; cache = []; currentUser = null;
  },
};
