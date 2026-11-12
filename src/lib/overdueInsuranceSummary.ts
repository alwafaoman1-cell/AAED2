import { supabase } from "@/integrations/supabase/client";

export interface OverdueCompany {
  companyId: string | null;
  name: string;
  termsDays: number;
  remaining: number;
  oldestDays: number;
  claimsCount: number;
}

export interface OverdueClaimProjection {
  id: string;
  insurance_company_id: string | null;
  insurance_company: string;
  approved_at: string | null;
  created_at: string;
}

export interface OverdueInvoiceProjection {
  id: string;
  claim_id: string | null;
  total: number | string | null;
  paid_amount: number | string | null;
  settlement_discount_amount: number | string | null;
  status: string;
}

export interface OverdueCompanyProjection {
  id: string;
  name: string;
  payment_terms_days: number | null;
}

export const OVERDUE_PAGE_SIZE = 200;
export const OVERDUE_MAX_INVOICES = 2_000;
const LOOKUP_BATCH_SIZE = 100;
export const overdueInsuranceQueryKey = ["insurance_claims", "overdue_summary"] as const;

function amount(value: number | string | null): number {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) throw new Error("Invalid overdue insurance amount");
  return result;
}

/** Same eligibility as the original bell, but O(invoices + claims + companies). */
export function summarizeOverdueInsurance(
  claims: readonly OverdueClaimProjection[],
  invoices: readonly OverdueInvoiceProjection[],
  companies: readonly OverdueCompanyProjection[],
  now = Date.now(),
  unspecifiedName = "غير محدد",
): OverdueCompany[] {
  const balances = new Map<string, { invoiced: number; paid: number; discounts: number }>();
  for (const invoice of invoices) {
    if (invoice.status === "cancelled" || !invoice.claim_id) continue;
    const total = amount(invoice.total);
    const balance = balances.get(invoice.claim_id) ?? { invoiced: 0, paid: 0, discounts: 0 };
    balance.invoiced += total;
    balance.paid += amount(invoice.paid_amount);
    balance.discounts += amount(invoice.settlement_discount_amount);
    balances.set(invoice.claim_id, balance);
  }
  const companiesById = new Map(companies.map((company) => [company.id, company]));
  const groups = new Map<string, OverdueCompany>();
  for (const claim of claims) {
    const balance = balances.get(claim.id);
    if (!balance || balance.invoiced <= 0) continue;
    const remaining = balance.invoiced - balance.paid - balance.discounts;
    if (remaining <= 0.01) continue;
    const baseDate = new Date(claim.approved_at || claim.created_at).getTime();
    if (!Number.isFinite(baseDate)) throw new Error("Invalid overdue insurance date");
    const days = Math.floor((now - baseDate) / 86_400_000);
    const company = companiesById.get(claim.insurance_company_id ?? "");
    const terms = company?.payment_terms_days ?? 90;
    if (!Number.isFinite(terms)) throw new Error("Invalid overdue insurance payment terms");
    if (days <= terms) continue;
    const key = claim.insurance_company_id || claim.insurance_company || unspecifiedName;
    const group = groups.get(key) ?? {
      companyId: claim.insurance_company_id || null,
      name: company?.name || claim.insurance_company || unspecifiedName,
      termsDays: terms, remaining: 0, oldestDays: 0, claimsCount: 0,
    };
    group.remaining += remaining;
    group.oldestDays = Math.max(group.oldestDays, days);
    group.claimsCount += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays);
}

/**
 * No existing read RPC has this bell's approval-age / company-terms semantics.
 * Use only RLS-protected, tenant-bound scalar projections, not report RPCs with
 * different permissions or due-date rules. A cap is an error, never a partial
 * "no overdue balances" result. Do not filter paid invoices: their credits and
 * settlement discounts must still offset other invoices for the same claim.
 */
export async function fetchOverdueInsuranceSummary(
  tenantId: string,
  signal?: AbortSignal,
  unspecifiedName?: string,
): Promise<OverdueCompany[]> {
  if (!tenantId) throw new Error("Missing overdue insurance tenant");
  const requestSignal = signal ?? new AbortController().signal;
  const invoices: OverdueInvoiceProjection[] = [];
  let expectedTotal = 0;
  for (let offset = 0; offset < OVERDUE_MAX_INVOICES; offset += OVERDUE_PAGE_SIZE) {
    const { data, error, count } = await supabase.from("insurance_invoices")
      .select("id,claim_id,total,paid_amount,settlement_discount_amount,status", offset === 0 ? { count: "exact" } : undefined)
      .eq("tenant_id", tenantId).neq("status", "cancelled")
      .order("id").range(offset, offset + OVERDUE_PAGE_SIZE - 1).abortSignal(requestSignal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Missing overdue insurance invoice response");
    if (offset === 0) {
      if (count === null || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("Missing overdue insurance invoice count");
      }
      expectedTotal = count;
      if (expectedTotal > OVERDUE_MAX_INVOICES) {
        throw new Error("Overdue insurance summary exceeds the safe read limit; a server summary is required");
      }
    }
    invoices.push(...data);
    if (invoices.length >= expectedTotal) break;
    if (data.length < OVERDUE_PAGE_SIZE) throw new Error("Incomplete overdue insurance invoice response");
  }
  if (invoices.length !== expectedTotal || new Set(invoices.map((invoice) => invoice.id)).size !== expectedTotal) {
    throw new Error("Overdue insurance invoices changed during the read; retry the summary");
  }
  const claimIds = [...new Set(invoices.map((invoice) => invoice.claim_id).filter((id): id is string => !!id))];
  const claims: OverdueClaimProjection[] = [];
  for (let offset = 0; offset < claimIds.length; offset += LOOKUP_BATCH_SIZE) {
    const { data, error } = await supabase.from("insurance_claims")
      .select("id,insurance_company_id,insurance_company,approved_at,created_at")
      .eq("tenant_id", tenantId).is("deleted_at", null)
      .in("id", claimIds.slice(offset, offset + LOOKUP_BATCH_SIZE))
      .order("id").abortSignal(requestSignal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Missing overdue insurance claim response");
    claims.push(...data);
  }
  const companyIds = [...new Set(claims.map((claim) => claim.insurance_company_id).filter((id): id is string => !!id))];
  const companies: OverdueCompanyProjection[] = [];
  for (let offset = 0; offset < companyIds.length; offset += LOOKUP_BATCH_SIZE) {
    const { data, error } = await supabase.from("insurance_companies")
      .select("id,name,payment_terms_days").eq("tenant_id", tenantId)
      .in("id", companyIds.slice(offset, offset + LOOKUP_BATCH_SIZE))
      .order("id").abortSignal(requestSignal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Missing overdue insurance company response");
    companies.push(...data);
  }
  return summarizeOverdueInsurance(claims, invoices, companies, Date.now(), unspecifiedName);
}
