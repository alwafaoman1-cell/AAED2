// Global dirty-work tracker. Forms/uploads call markDirty(scopeId) while
// they hold unsaved changes, then markClean(scopeId) when saved/aborted.
// The Cloud Update System checks hasUnsavedWork() before applying an update.

const dirtyScopes = new Set<string>();
const listeners = new Set<(hasDirty: boolean) => void>();
let beforeUnloadInstalled = false;
let beforeUnloadUnsubscribe: (() => void) | null = null;

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedWork()) return;
  event.preventDefault();
  event.returnValue = "";
}

function emit() {
  const has = dirtyScopes.size > 0;
  listeners.forEach((cb) => { try { cb(has); } catch { /* noop */ } });
}

export function markDirty(scopeId: string): void {
  if (!scopeId) return;
  dirtyScopes.add(scopeId);
  emit();
}

export function markClean(scopeId: string): void {
  if (!scopeId) return;
  if (dirtyScopes.delete(scopeId)) emit();
}

export function hasUnsavedWork(): boolean {
  return dirtyScopes.size > 0;
}

export function getUnsavedWorkScopes(): string[] {
  return Array.from(dirtyScopes);
}

export function subscribeUnsavedWork(cb: (hasDirty: boolean) => void): () => void {
  listeners.add(cb);
  cb(dirtyScopes.size > 0);
  return () => { listeners.delete(cb); };
}

export function installUnsavedWorkBeforeUnloadGuard(): void {
  if (typeof window === "undefined" || beforeUnloadInstalled) return;
  beforeUnloadInstalled = true;
  beforeUnloadUnsubscribe = subscribeUnsavedWork((hasDirty) => {
    if (hasDirty) window.addEventListener("beforeunload", handleBeforeUnload);
    else window.removeEventListener("beforeunload", handleBeforeUnload);
  });
}

export function uninstallUnsavedWorkBeforeUnloadGuard(): void {
  if (typeof window === "undefined" || !beforeUnloadInstalled) return;
  beforeUnloadUnsubscribe?.();
  beforeUnloadUnsubscribe = null;
  beforeUnloadInstalled = false;
  window.removeEventListener("beforeunload", handleBeforeUnload);
}
