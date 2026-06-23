import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
const FeatureContext = createContext<FeatureContextValue>({
  loading: true,
  enabled: defaults,
  settings: {},
  isEnabled: () => true,
  refresh: async () => undefined,
});

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<FeatureKey, boolean>>(defaults);
  const [settings, setSettings] = useState<Partial<Record<FeatureKey, Record<string, unknown>>>>({});

  async function refresh() {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTenantFeatures(profile.tenant_id);
      const next = { ...defaults };
      const nextSettings: Partial<Record<FeatureKey, Record<string, unknown>>> = {};
      rows.forEach((row) => {
        next[row.feature_key] = row.enabled;
        nextSettings[row.feature_key] = row.settings || {};
      });
      setEnabled(next);
      setSettings(nextSettings);
    } catch {
      // Keep the application usable before the SaaS migration is deployed.
      setEnabled(defaults);
      setSettings({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    if (!profile?.tenant_id) return;
    const channel = supabase
      .channel(`tenant-features:${profile.tenant_id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tenant_features",
        filter: `tenant_id=eq.${profile.tenant_id}`,
      }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.tenant_id]);

  const value = useMemo<FeatureContextValue>(() => ({
    loading,
    enabled,
    settings,
    isEnabled: (key) => enabled[key] !== false,
    refresh,
  }), [loading, enabled, settings]);

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
  ["/supervisor-app", "supervisor_app"],
  ["/sales", "sales_invoices"],
  ["/messages", "whatsapp"],
];

export function featureForPath(path: string): FeatureKey | null {
  return PATH_FEATURES.find(([prefix]) => path.startsWith(prefix))?.[1] || null;
}
