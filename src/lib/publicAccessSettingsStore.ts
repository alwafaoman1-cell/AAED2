import { readCloudSetting, writeCloudSetting, subscribeCloudSetting } from "@/lib/cloudSettings";

const KEY = "public_access_settings";
const CACHE_KEY = "cloud_setting_cache:" + KEY;

export interface PublicAccessSettings {
  /** Empty means disabled. */
  masterPassword: string;
  /** Public base domain for QR/portal links. Empty means use current origin. */
  publicBaseUrl: string;
}

const DEFAULTS: PublicAccessSettings = { masterPassword: "", publicBaseUrl: "" };

type Listener = (s: PublicAccessSettings) => void;
const listeners = new Set<Listener>();

let memoryCache: PublicAccessSettings = readCachedSettings();

function normalizeSettings(value: Partial<PublicAccessSettings> | null | undefined): PublicAccessSettings {
  return {
    masterPassword: String(value?.masterPassword || ""),
    publicBaseUrl: String(value?.publicBaseUrl || "").trim().replace(/\/+$/, ""),
  };
}

function readCachedSettings(): PublicAccessSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULTS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function cacheSettings(next: PublicAccessSettings) {
  memoryCache = normalizeSettings(next);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache)); } catch {}
  listeners.forEach((listener) => listener(memoryCache));
}

/**
 * Synchronous read for code paths that must build links immediately.
 * The source of truth is Supabase; this returns the latest in-memory/cloud cache.
 */
export function getPublicAccessSettings(): PublicAccessSettings {
  return { ...memoryCache };
}

export async function loadPublicAccessSettings(): Promise<PublicAccessSettings> {
  const value = await readCloudSetting<PublicAccessSettings>(KEY, DEFAULTS);
  const normalized = normalizeSettings(value);
  cacheSettings(normalized);
  return normalized;
}

export async function savePublicAccessSettings(s: Partial<PublicAccessSettings>): Promise<PublicAccessSettings> {
  const merged = normalizeSettings({ ...memoryCache, ...s });
  await writeCloudSetting(KEY, merged);
  cacheSettings(merged);
  return merged;
}

export function subscribePublicAccessSettings(listener: Listener) {
  listeners.add(listener);
  const unsubscribeCloud = subscribeCloudSetting<PublicAccessSettings>(KEY, (value) => {
    cacheSettings(normalizeSettings(value));
  });
  return () => {
    listeners.delete(listener);
    unsubscribeCloud();
  };
}

/** Normalize access password: phone-like input becomes digits; text becomes lowercase trimmed. */
export function normalizeAccessPwd(value: string): string {
  const input = (value || "").trim();
  if (/[\d\s+()-]+/.test(input) && /\d/.test(input)) return input.replace(/\D/g, "");
  return input.toLowerCase();
}

export function getMasterPasswordNormalized(): string {
  return normalizeAccessPwd(getPublicAccessSettings().masterPassword);
}

export function getPublicBaseUrl(): string {
  const configured = (getPublicAccessSettings().publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

export function buildPublicUrl(path: string): string {
  const base = getPublicBaseUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
