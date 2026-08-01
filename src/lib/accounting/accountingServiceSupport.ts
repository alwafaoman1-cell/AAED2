export function requireTenantId(tenantId: string): string {
  const normalized = tenantId.trim();
  if (!normalized) throw new Error("ACCOUNTING_TENANT_REQUIRED");
  return normalized;
}
export function unwrapAccountingResult<T>(result: { data: unknown; error: { message?: string } | null }, label: string): T {
  if (result.error) throw new Error(result.error.message || label);
  return result.data as T;
}
