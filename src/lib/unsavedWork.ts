// Global dirty-work tracker. Forms/uploads call markDirty(scopeId) while
// they hold unsaved changes, then markClean(scopeId) when saved/aborted.
// The Cloud Update System checks hasUnsavedWork() before applying an update.

const dirtyScopes = new Set<string>();
const listeners = new Set<(hasDirty: boolean) => void>();

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

export function subscribeUnsavedWork(cb: (hasDirty: boolean) => void): () => void {
  listeners.add(cb);
  cb(dirtyScopes.size > 0);
  return () => { listeners.delete(cb); };
}
