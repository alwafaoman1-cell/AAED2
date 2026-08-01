export const ACCOUNTING_REPORTS_ROUTE_PREFIX="/accounting/reports";
export function isAccountingReportsFeatureEnabled(){
  return import.meta.env.DEV || import.meta.env.VITE_ACCOUNTING_REPORTS_ENABLED==="true";
}
