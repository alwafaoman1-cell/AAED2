export const ACCOUNTING_SETUP_ROUTE_PREFIX = "/accounting/setup";

export function isAccountingSetupFeatureEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ACCOUNTING_SETUP_ENABLED === "true";
}
