import { useEffect, useState } from "react";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";

export const SYSTEM_PREFERENCES_KEY = "system_preferences_v1";

export interface SystemThemePreset {
  id: string;
  name: string;
  primary: string;
  accent?: string;
}

export interface SystemPreferences {
  defaultCountryCode: string;
  activeThemeId: string;
  themes: SystemThemePreset[];
}

export const DEFAULT_SYSTEM_PREFERENCES: SystemPreferences = {
  defaultCountryCode: "968",
  activeThemeId: "gold",
  themes: [
    { id: "gold", name: "Al Wafa Gold", primary: "#d4a537", accent: "#b98318" },
    { id: "blue", name: "Service Blue", primary: "#2563eb", accent: "#0ea5e9" },
    { id: "green", name: "Workshop Green", primary: "#16a34a", accent: "#22c55e" },
  ],
};

export function normalizeCountryCode(code?: string | null): string {
  const cleaned = String(code || "").replace(/\D/g, "");
  return cleaned || "968";
}

export function mergeSystemPreferences(value?: Partial<SystemPreferences> | null): SystemPreferences {
  const themes = Array.isArray(value?.themes) && value?.themes?.length
    ? value.themes.map((theme, index) => ({
        id: theme.id || `theme-${index + 1}`,
        name: theme.name || `Theme ${index + 1}`,
        primary: theme.primary || DEFAULT_SYSTEM_PREFERENCES.themes[0].primary,
        accent: theme.accent || theme.primary || DEFAULT_SYSTEM_PREFERENCES.themes[0].accent,
      }))
    : DEFAULT_SYSTEM_PREFERENCES.themes;
  const activeThemeId = value?.activeThemeId && themes.some((theme) => theme.id === value.activeThemeId)
    ? value.activeThemeId
    : themes[0].id;
  return {
    defaultCountryCode: normalizeCountryCode(value?.defaultCountryCode || DEFAULT_SYSTEM_PREFERENCES.defaultCountryCode),
    activeThemeId,
    themes,
  };
}

export async function readSystemPreferences(): Promise<SystemPreferences> {
  const value = await readCloudSetting<Partial<SystemPreferences>>(SYSTEM_PREFERENCES_KEY, DEFAULT_SYSTEM_PREFERENCES);
  return mergeSystemPreferences(value);
}

export async function saveSystemPreferences(next: SystemPreferences): Promise<void> {
  await writeCloudSetting(SYSTEM_PREFERENCES_KEY, mergeSystemPreferences(next));
}

export function hexToHslTriplet(hex: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function applySystemTheme(prefs: SystemPreferences): void {
  if (typeof document === "undefined") return;
  const active = prefs.themes.find((theme) => theme.id === prefs.activeThemeId) || prefs.themes[0];
  const primary = hexToHslTriplet(active.primary);
  const accent = hexToHslTriplet(active.accent || active.primary);
  if (!primary) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-ring", primary);
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--sidebar-accent", `${accent.split(" ")[0]} ${accent.split(" ")[1]} 16%`);
  }
  root.style.setProperty("--gradient-gold", `linear-gradient(135deg, hsl(${primary}), hsl(${accent || primary}))`);
  root.style.setProperty("--shadow-gold", `0 4px 20px -4px hsl(${primary} / 0.28)`);
}

export function useSystemPreferences() {
  const [preferences, setPreferences] = useState<SystemPreferences>(DEFAULT_SYSTEM_PREFERENCES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readSystemPreferences().then((value) => {
      if (cancelled) return;
      setPreferences(value);
      applySystemTheme(value);
      setLoading(false);
    });
    const unsubscribe = subscribeCloudSetting<Partial<SystemPreferences>>(SYSTEM_PREFERENCES_KEY, (value) => {
      const merged = mergeSystemPreferences(value);
      setPreferences(merged);
      applySystemTheme(merged);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function save(next: SystemPreferences) {
    const merged = mergeSystemPreferences(next);
    setPreferences(merged);
    applySystemTheme(merged);
    await saveSystemPreferences(merged);
  }

  return { preferences, loading, save };
}
