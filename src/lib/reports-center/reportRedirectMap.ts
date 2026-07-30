export const REPORT_REDIRECT_MAP: Record<string, string> = {
  "/reports/center": "/reports-center",
  "/insurance/reports": "/reports-center?category=insurance&businessType=insurance",
  "/accounting/reports": "/reports-center?category=invoices",
};

export function reportCenterUrlFromLegacy(pathname: string): string | null {
  return REPORT_REDIRECT_MAP[pathname] ?? null;
}
