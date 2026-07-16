// تنبيهات التأخر — يحسب الشركات المتأخرة عن payment_terms_days من تاريخ الاعتماد
import { useMemo } from "react";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";

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
  const { data: companies } = useInsuranceCompanies();
  const { data: invoices } = useInsuranceInvoices();

  return useMemo<OverdueCompany[]>(() => {
    const map = new Map<string, OverdueCompany>();
    const now = Date.now();

    (claims ?? []).forEach((c) => {
      const claimInvoices = (invoices ?? []).filter((invoice) => invoice.claim_id === c.id && invoice.status !== "cancelled");
      const invoiced = claimInvoices.reduce((s, invoice) => s + Number(invoice.total || 0), 0);
      const paid = claimInvoices.reduce((s, invoice) => s + Number(invoice.paid_amount || 0), 0);
      const rem = invoiced - paid;
      if (invoiced <= 0) return;
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
  }, [claims, invoices, companies]);
}
