import { createContext, useContext } from "react";
import { FEATURE_DEFINITIONS, type FeatureKey } from "@/lib/saasAdmin";

export interface FeatureContextValue {
  loading: boolean;
  enabled: Record<FeatureKey, boolean>;
  settings: Partial<Record<FeatureKey, Record<string, unknown>>>;
  isEnabled: (key: FeatureKey) => boolean;
  refresh: () => Promise<void>;
}

export const defaultFeatures = Object.fromEntries(FEATURE_DEFINITIONS.map(([key]) => [key, true])) as Record<FeatureKey, boolean>;
export const emptyFeatureSettings: FeatureContextValue["settings"] = {};
export const FeatureContext = createContext<FeatureContextValue>({
  loading: true,
  enabled: defaultFeatures,
  settings: {},
  isEnabled: () => true,
  refresh: async () => undefined,
});

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
