// Cloud Update System — detects newer versions in `app_versions` via Realtime
// and exposes state to React components. Authoritative version data lives in
// the database; this module only reads.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CURRENT_APP_VERSION, compareVersions } from "./appVersion";
import { clearApplicationShellCaches } from "./chunkRecovery";

export interface AppVersionRow {
  id: string;
  version: string;
  title: string | null;
  changelog: string | null;
  released_at: string;
  mandatory: boolean;
  grace_minutes: number;
}

const DISMISS_KEY = "update_dismissed_version";
const REMIND_KEY = "update_remind_at";

type Listener = (v: AppVersionRow | null) => void;
const listeners = new Set<Listener>();
let latest: AppVersionRow | null = null;
let started = false;

function emit() {
  listeners.forEach((cb) => {
    try {
      cb(latest);
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[updateStore] listener failed", error);
    }
  });
}

function isNewer(row: AppVersionRow | null): boolean {
  if (!row) return false;
  return compareVersions(row.version, CURRENT_APP_VERSION) > 0;
}

async function fetchLatest() {
  const { data, error } = await supabase
    .from("app_versions")
    .select("id,version,title,changelog,released_at,mandatory,grace_minutes")
    .order("released_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (import.meta.env.DEV) console.warn("[updateStore] latest version fetch failed", error.message);
    return;
  }
  if (data && isNewer(data as AppVersionRow)) {
    latest = data as AppVersionRow;
  } else {
    latest = null;
  }
  emit();
}

export function startUpdateWatcher(): () => void {
  if (started) return () => {};
  started = true;

  fetchLatest();

  const channel = supabase
    .channel("app_versions_watch")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_versions" },
      () => { fetchLatest(); },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
    started = false;
  };
}

export function useLatestUpdate(): AppVersionRow | null {
  const [v, setV] = useState<AppVersionRow | null>(latest);
  useEffect(() => {
    const cb: Listener = (val) => setV(val);
    listeners.add(cb);
    cb(latest);
    return () => { listeners.delete(cb); };
  }, []);
  return v;
}

export function isDismissed(version: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === version; } catch { return false; }
}
export function dismissVersion(version: string) {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* noop */ }
}
export function remindLater(minutes = 30) {
  try { localStorage.setItem(REMIND_KEY, String(Date.now() + minutes * 60_000)); } catch { /* noop */ }
}
export function isSnoozed(): boolean {
  try {
    const t = Number(localStorage.getItem(REMIND_KEY) || 0);
    return t > Date.now();
  } catch { return false; }
}

/** Clear caches + unregister SW, then reload exactly once. */
export async function applyUpdateNow(): Promise<void> {
  try {
    await clearApplicationShellCaches();
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[updateStore] cache cleanup failed", error);
  }
  try {
    sessionStorage.setItem("post_update_toast", "1");
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[updateStore] post-update marker failed", error);
  }
  // Hard reload to fetch fresh shell
  window.location.reload();
}
