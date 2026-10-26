import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type FeatureKey, listTenantFeatures } from "@/lib/saasAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { FeatureContext, defaultFeatures, emptyFeatureSettings, type FeatureContextValue } from "@/contexts/featureContextState";

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || null;
  const requestVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<FeatureKey, boolean>>(defaultFeatures);
  const [settings, setSettings] = useState<Partial<Record<FeatureKey, Record<string, unknown>>>>({});
  const [loadedTenantId, setLoadedTenantId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestVersion.current;
    if (!tenantId) {
      setEnabled(defaultFeatures);
      setSettings(emptyFeatureSettings);
      setLoadedTenantId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTenantFeatures(tenantId);
      if (requestId !== requestVersion.current) return;
      const next = { ...defaultFeatures };
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
      setEnabled(defaultFeatures);
      setSettings(emptyFeatureSettings);
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
  const visibleEnabled = loadedTenantId === tenantId ? enabled : defaultFeatures;
  const visibleSettings = loadedTenantId === tenantId ? settings : emptyFeatureSettings;

  const value = useMemo<FeatureContextValue>(() => ({
    loading: loading || loadedTenantId !== tenantId,
    enabled: visibleEnabled,
    settings: visibleSettings,
    isEnabled: (key) => visibleEnabled[key] !== false,
    refresh,
  }), [loading, loadedTenantId, tenantId, visibleEnabled, visibleSettings, refresh]);

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}
