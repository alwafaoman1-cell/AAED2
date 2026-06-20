// Simple per-technician clock in/out and per-order timer log (localStorage).
const KEY_CLOCK = "tech_clock_v1";
const KEY_NOTES = "tech_notes_v1";

interface ClockState {
  technician: string;
  startedAt: string; // ISO
  orderId?: string;
}

const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }
export function subscribeTechStore(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

export function getActiveClock(): ClockState | null {
  try { return JSON.parse(localStorage.getItem(KEY_CLOCK) || "null"); } catch { return null; }
}
export function clockIn(technician: string, orderId?: string) {
  const s: ClockState = { technician, startedAt: new Date().toISOString(), orderId };
  localStorage.setItem(KEY_CLOCK, JSON.stringify(s));
  notify();
}
export function clockOut(): { minutes: number; orderId?: string } | null {
  const s = getActiveClock();
  if (!s) return null;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000));
  localStorage.removeItem(KEY_CLOCK);
  // Log to a per-day journal
  const dayKey = `tech_clock_log_${new Date().toISOString().slice(0,10)}`;
  try {
    const arr = JSON.parse(localStorage.getItem(dayKey) || "[]");
    arr.push({ ...s, endedAt: new Date().toISOString(), minutes });
    localStorage.setItem(dayKey, JSON.stringify(arr));
  } catch {}
  notify();
  return { minutes, orderId: s.orderId };
}
export function getTodayLogs(): any[] {
  const dayKey = `tech_clock_log_${new Date().toISOString().slice(0,10)}`;
  try { return JSON.parse(localStorage.getItem(dayKey) || "[]"); } catch { return []; }
}

// ---- Per-order quick notes ----
export interface TechNote {
  id: string;
  orderId: string;
  technician: string;
  text: string;
  createdAt: string;
}
export function listNotes(orderId: string): TechNote[] {
  try {
    const all: TechNote[] = JSON.parse(localStorage.getItem(KEY_NOTES) || "[]");
    return all.filter((n) => n.orderId === orderId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch { return []; }
}
export function addNote(orderId: string, technician: string, text: string): TechNote {
  const note: TechNote = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    orderId, technician, text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  try {
    const all: TechNote[] = JSON.parse(localStorage.getItem(KEY_NOTES) || "[]");
    all.push(note);
    localStorage.setItem(KEY_NOTES, JSON.stringify(all));
  } catch {}
  notify();
  return note;
}
export function deleteNote(id: string) {
  try {
    const all: TechNote[] = JSON.parse(localStorage.getItem(KEY_NOTES) || "[]");
    localStorage.setItem(KEY_NOTES, JSON.stringify(all.filter((n) => n.id !== id)));
  } catch {}
  notify();
}
