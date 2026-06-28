const GENERATED_VALUE_ERROR_PATTERNS = [
  "cannot insert a non-default value into column",
  "cannot update column",
  "generated always",
  "is a generated column",
];

export function stripUndefined<T extends Record<string, any>>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
}

export function isGeneratedColumnWriteError(error: unknown): boolean {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return GENERATED_VALUE_ERROR_PATTERNS.some((pattern) => raw.includes(pattern));
}

export function sanitizeComputedFields<T extends Record<string, any>>(
  payload: T,
  fields: string[],
): T {
  const next = { ...payload };
  for (const field of fields) delete next[field];
  return stripUndefined(next);
}

export function sanitizeWorkOrderWritePayload<T extends Record<string, any>>(payload: T): T {
  return sanitizeComputedFields(payload, ["subtotal", "vat", "final_total", "created_at", "updated_at"]);
}

export function sanitizeClaimWritePayload<T extends Record<string, any>>(payload: T): T {
  return sanitizeComputedFields(payload, [
    "subtotal",
    "total",
    "vat",
    "vat_amount",
    "balance",
    "outstanding_amount",
    "created_at",
    "updated_at",
  ]);
}

export function sanitizeInvoiceGeneratedWritePayload<T extends Record<string, any>>(payload: T): T {
  return sanitizeComputedFields(payload, [
    "subtotal",
    "tax_total",
    "vat",
    "vat_amount",
    "total",
    "balance",
    "balance_due",
    "outstanding_amount",
    "created_at",
    "updated_at",
  ]);
}
