import type { AuditAction, AuditEntity, AuditEntry } from "./auditLogStore";
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

const MAX = 200;
let cache: NotificationItem[] = [];
const subs = new Set<() => void>();

function persistSessionOnly() {
  subs.forEach((listener) => listener());
}

export const notificationsStore = {
  list(): NotificationItem[] {
    return [...cache];
  },
  unreadCount(): number {
    return cache.filter((notification) => !notification.read).length;
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
    cache.unshift(item);
    if (cache.length > MAX) cache.length = MAX;
    persistSessionOnly();
    try { notificationSound.play(); } catch {}
  },
  markRead(id: string) {
    const item = cache.find((notification) => notification.id === id);
    if (item && !item.read) {
      item.read = true;
      persistSessionOnly();
    }
  },
  markAllRead() {
    let changed = false;
    for (const notification of cache) {
      if (!notification.read) {
        notification.read = true;
        changed = true;
      }
    }
    if (changed) persistSessionOnly();
  },
  clear() {
    cache = [];
    persistSessionOnly();
  },
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};

export function getEntityRoute(entity: AuditEntity, entityId: string): string {
  switch (entity) {
    case "work_order": return `/work-orders/${entityId}`;
    case "invoice": return "/sales";
    case "customer": return `/customers/${entityId}`;
    case "vehicle": return "/vehicles";
    case "claim": return `/insurance/${entityId}`;
    case "inspection": return "/inspection";
    case "expense": return "/accounting";
    case "receipt": return "/accounting/receipts";
    case "deposit": return "/customers";
    case "cashbox": return "/accounting";
    default: return "/";
  }
}
