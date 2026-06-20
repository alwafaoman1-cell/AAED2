// Lightweight local notifications for technicians.
// Watches localStorage work orders and fires browser notifications when:
//  - one of "my" orders changes status
//  - delivery date is near (heuristic: status becomes "جاهز للتسليم")
import { subscribeWorkOrders, getWorkOrders } from "@/lib/workOrdersStore";

const KEY_SNAPSHOT = "tech_notify_snapshot_v1";

export function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return "denied";
  if (Notification.permission === "default") {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

function loadSnapshot(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY_SNAPSHOT) || "{}"); } catch { return {}; }
}
function saveSnapshot(s: Record<string, string>) {
  try { localStorage.setItem(KEY_SNAPSHOT, JSON.stringify(s)); } catch {}
}

function fire(title: string, body: string, tag?: string) {
  if (!canNotify() || Notification.permission !== "granted") return;
  try { new Notification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png" }); } catch {}
}

export function startTechNotifications(getMyName: () => string) {
  if (typeof window === "undefined") return () => {};
  // initialise snapshot
  let snap = loadSnapshot();
  if (Object.keys(snap).length === 0) {
    const orders = getWorkOrders();
    for (const o of orders) snap[o.id] = o.status;
    saveSnapshot(snap);
  }
  const unsub = subscribeWorkOrders(() => {
    const myName = (getMyName() || "").trim();
    const orders = getWorkOrders();
    const next: Record<string, string> = {};
    for (const o of orders) {
      next[o.id] = o.status;
      const prev = snap[o.id];
      if (prev && prev !== o.status) {
        const mine = myName && (o.technician || "").trim() === myName;
        if (mine) {
          fire(`تحديث ${o.id}`, `${o.customer} — ${o.status}`, `wo-${o.id}`);
        }
        if (o.status === "جاهز للتسليم") {
          fire(`قارب التسليم: ${o.id}`, `السيارة جاهزة — ${o.customer}`, `delivery-${o.id}`);
        }
      }
    }
    snap = next;
    saveSnapshot(snap);
  });
  return unsub;
}
