// Offline queue backed by IndexedDB. Operations enqueued while offline are
// flushed automatically when the browser regains connectivity.
import { get, set, del, keys } from "idb-keyval";

export interface QueuedOp {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
  attempts: number;
}

const PREFIX = "op:";

type Handler = (payload: any) => Promise<void> | void;
const handlers: Record<string, Handler> = {};

export function registerOpHandler(type: string, fn: Handler) {
  handlers[type] = fn;
}

export async function enqueueOp(type: string, payload: any): Promise<QueuedOp> {
  const op: QueuedOp = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await set(PREFIX + op.id, op);
  notifyListeners();
  return op;
}

export async function pendingCount(): Promise<number> {
  const ks = await keys();
  return ks.filter((k) => typeof k === "string" && k.startsWith(PREFIX)).length;
}

export async function listPending(): Promise<QueuedOp[]> {
  const ks = (await keys()).filter((k) => typeof k === "string" && (k as string).startsWith(PREFIX)) as string[];
  const out: QueuedOp[] = [];
  for (const k of ks) {
    const v = await get<QueuedOp>(k);
    if (v) out.push(v);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  if (!navigator.onLine) return { ok: 0, failed: 0 };
  const ops = await listPending();
  let ok = 0;
  let failed = 0;
  for (const op of ops) {
    const handler = handlers[op.type];
    if (!handler) continue;
    try {
      await handler(op.payload);
      await del(PREFIX + op.id);
      ok++;
    } catch {
      op.attempts++;
      await set(PREFIX + op.id, op);
      failed++;
    }
  }
  notifyListeners();
  return { ok, failed };
}

const listeners = new Set<() => void>();
export function subscribeQueue(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyListeners() { listeners.forEach((l) => l()); }

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { flushQueue(); });
}
