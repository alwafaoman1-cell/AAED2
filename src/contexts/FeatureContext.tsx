import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURE_DEFINITIONS, type FeatureKey, listTenantFeatures } from "@/lib/saasAdmin";
import { useAuth } from "@/contexts/AuthContext";

interface FeatureContextValue {
  loading: boolean;
  enabled: Record<FeatureKey, boolean>;
  settings: Partial<Record<FeatureKey, Record<string, unknown>>>;
  isEnabled: (key: FeatureKey) => boolean;
  refresh: () => Promise<void>;
}

const defaults = Object.fromEntries(FEATURE_DEFINITIONS.map(([key]) => [key, true])) as Record<FeatureKey, boolean>;
const emptySettings: FeatureContextValue["settings"] = {};
const FeatureContext = createContext<FeatureContextValue>({
  loading: true,
  enabled: defaults,
  settings: {},
  isEnabled: () => true,
  refresh: async () => undefined,
});

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || null;
  const requestVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<FeatureKey, boolean>>(defaults);
  const [settings, setSettings] = useState<Partial<Record<FeatureKey, Record<string, unknown>>>>({});
  const [loadedTenantId, setLoadedTenantId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestVersion.current;
    if (!tenantId) {
      setEnabled(defaults);
      setSettings(emptySettings);
      setLoadedTenantId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTenantFeatures(tenantId);
      if (requestId !== requestVersion.current) return;
      const next = { ...defaults };
      const nextSettings: Partial<Record<FeatureKey, Record<string, unknown>>> = {};
      rows.forEach((row) => {
        next[row.feature_key] = row.enabled;
        nextSettings[row.feature_key] = row.settings || {};
      });
      setEnabled(next);
      setSettings(nextSettings);
      setLoadedTenantId(tenantId);
    } catch {
      if (requestId !== requestVersion.current) return;
      // Keep the application usable before the SaaS migration is deployed.
      setEnabled(defaults);
      setSettings(emptySettings);
      setLoadedTenantId(tenantId);
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return () => { requestVersion.current += 1; };
    const channel = supabase
      .channel(`tenant-features:${tenantId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tenant_features",
        filter: `tenant_id=eq.${tenantId}`,
      }, () => void refresh())
      .subscribe();
    return () => {
      requestVersion.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [tenantId, refresh]);

  // Never expose another workshop's cached feature settings during a switch.
  const visibleEnabled = loadedTenantId === tenantId ? enabled : defaults;
  const visibleSettings = loadedTenantId === tenantId ? settings : emptySettings;

  const value = useMemo<FeatureContextValue>(() => ({
    loading: loading || loadedTenantId !== tenantId,
    enabled: visibleEnabled,
    settings: visibleSettings,
    isEnabled: (key) => visibleEnabled[key] !== false,
    refresh,
  }), [loading, loadedTenantId, tenantId, visibleEnabled, visibleSettings, refresh]);

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}

export function useFeatures() {
  return useContext(FeatureContext);
}

export const PATH_FEATURES: Array<[string, FeatureKey]> = [
  ["/insurance/accounting", "insurance_accounting"],
  ["/insurance", "insurance"],
  ["/work-orders", "workshop"],
  ["/inventory", "inventory"],
  ["/reports", "reports"],
  ["/supervisor", "supervisor_app"],
  ["/supervisor-app", "supervisor_app"],
  ["/sales", "sales_invoices"],
  ["/messages", "whatsapp"],
];

export function featureForPath(path: string): FeatureKey | null {
  return PATH_FEATURES.find(([prefix]) => path.startsWith(prefix))?.[1] || null;
}
