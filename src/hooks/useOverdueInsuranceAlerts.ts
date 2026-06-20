// تنبيهات التأخر — يحسب الشركات المتأخرة عن payment_terms_days من تاريخ الاعتماد
import { useMemo } from "react";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";

export interface OverdueCompany {
  companyId: string | null;
  name: string;
  termsDays: number;
  remaining: number;
  oldestDays: number;
  claimsCount: number;
}

const DEFAULT_TERMS = 90;

export function useOverdueInsuranceAlerts() {
  const { data: claims } = useInsuranceClaims();
  const { data: payments } = useClaimPayments();
  const { data: companies } = useInsuranceCompanies();

  return useMemo<OverdueCompany[]>(() => {
    const map = new Map<string, OverdueCompany>();
    const now = Date.now();

    (claims ?? []).forEach((c) => {
      if (c.status !== "approved") return;
      const cPayments = (payments ?? []).filter((p) => p.claim_id === c.id && p.status !== "bounced");
      const paid = cPayments.reduce((s, p) => s + Number(p.amount), 0);
      const approved = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
      const rem = approved - paid;
      if (rem <= 0.01) return;

      const baseDate = c.approved_at ? new Date(c.approved_at).getTime() : new Date(c.created_at).getTime();
      const days = Math.floor((now - baseDate) / 86400000);

      const company = companies?.find((co) => co.id === (c as any).insurance_company_id);
      const terms = company?.payment_terms_days ?? DEFAULT_TERMS;
      if (days <= terms) return; // ليس متأخراً

      const key = (c as any).insurance_company_id || c.insurance_company || "غير محدد";
      const name = company?.name || c.insurance_company || "غير محدد";
      const existing = map.get(key) || {
        companyId: (c as any).insurance_company_id || null,
        name, termsDays: terms, remaining: 0, oldestDays: 0, claimsCount: 0,
      };
      existing.remaining += rem;
      existing.oldestDays = Math.max(existing.oldestDays, days);
      existing.claimsCount += 1;
      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.oldestDays - a.oldestDays);
  }, [claims, payments, companies]);
}
