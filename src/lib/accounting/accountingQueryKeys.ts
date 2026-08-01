export const accountingQueryKeys = {
  root: ["accounting-cloud"] as const,
  accounts: (tenantId: string) => ["accounting-cloud", tenantId, "accounts"] as const,
  fiscalYears: (tenantId: string) => ["accounting-cloud", tenantId, "fiscal-years"] as const,
  periods: (tenantId: string, fiscalYearId?: string) => ["accounting-cloud", tenantId, "periods", fiscalYearId ?? "all"] as const,
  costCenters: (tenantId: string) => ["accounting-cloud", tenantId, "cost-centers"] as const,
  journal: (tenantId: string, entryId: string) => ["accounting-cloud", tenantId, "journal", entryId] as const,
  journalLines: (tenantId: string, entryId: string) => ["accounting-cloud", tenantId, "journal", entryId, "lines"] as const,
  mappings: (tenantId: string) => ["accounting-cloud", tenantId, "mappings"] as const,
} as const;
