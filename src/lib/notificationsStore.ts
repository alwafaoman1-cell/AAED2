// نظام إشعارات بسيط (مثل Facebook) — يعتمد على localStorage
// كل نشاط من auditLogStore يُولّد إشعاراً جديداً.
import type { AuditEntry, AuditEntity, AuditAction } from "./auditLogStore";
import { notificationSound } from "./notificationSound";

export interface NotificationItem {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  label: string;
  description?: string;
  amount?: number;
  read: boolean;
}

const KEY = "alwafa_notifications_v1";
const MAX = 200;
let cache: NotificationItem[] | null = null;
const subs = new Set<() => void>();

function load(): NotificationItem[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  return cache!;
}
function persist() {
  if (!cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  subs.forEach((f) => f());
}

export const notificationsStore = {
  list(): NotificationItem[] {
    return [...load()];
  },
  unreadCount(): number {
    return load().filter((n) => !n.read).length;
  },
  addFromAudit(entry: AuditEntry) {
    const item: NotificationItem = {
      id: entry.id,
      timestamp: entry.timestamp,
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      label: entry.label,
      description: entry.description,
      amount: entry.amount,
      read: false,
    };
    const list = load();
    list.unshift(item);
    if (list.length > MAX) list.length = MAX;
    persist();
    // تشغيل صوت تنبيه قصير
    try { notificationSound.play(); } catch {}
  },
  markRead(id: string) {
    const list = load();
    const i = list.findIndex((n) => n.id === id);
    if (i >= 0 && !list[i].read) { list[i].read = true; persist(); }
  },
  markAllRead() {
    const list = load();
    let changed = false;
    for (const n of list) if (!n.read) { n.read = true; changed = true; }
    if (changed) persist();
  },
  clear() {
    cache = [];
    persist();
  },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
};

/** يحدد مسار التنقّل لكل كيان عند الضغط على الإشعار */
export function getEntityRoute(entity: AuditEntity, entityId: string): string {
  switch (entity) {
    case "work_order": return `/work-orders/${entityId}`;
    case "invoice": return `/sales`;
    case "customer": return `/customers/${entityId}`;
    case "vehicle": return `/vehicles`;
    case "claim": return `/insurance/${entityId}`;
    case "inspection": return `/inspection`;
    case "expense": return `/accounting`;
    case "receipt": return `/accounting/receipts`;
    case "deposit": return `/customers`;
    case "cashbox": return `/accounting`;
    default: return `/`;
  }
}
