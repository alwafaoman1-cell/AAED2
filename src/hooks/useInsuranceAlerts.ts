import { useMemo } from "react";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";

export interface InsuranceAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  type: "delivered_without_invoice" | "policy_expiring" | "cheque_due" | "invoice_overdue" | "stale_pending" | "unpaid_approved";
  title: string;
  description: string;
  href?: string;
  meta?: Record<string, any>;
}

const today = () => new Date();
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

export function useInsuranceAlerts() {
  const { data: claims = [] } = useInsuranceClaims();
  const { data: payments = [] } = useClaimPayments();
  const { data: invoices = [] } = useInsuranceInvoices();

  return useMemo<InsuranceAlert[]>(() => {
    const alerts: InsuranceAlert[] = [];
    const now = today();

    // 1) Stale pending claims > 7 days
    for (const c of claims) {
      if (c.status === "pending") {
        const age = daysBetween(now, new Date(c.created_at));
        if (age >= 7) {
          alerts.push({
            id: `stale-${c.id}`,
            severity: age >= 14 ? "critical" : "warning",
            type: "stale_pending",
            title: `مطالبة معلقة منذ ${age} يوم`,
            description: `${c.claim_number} — ${c.insurance_company}`,
            href: `/insurance/${c.id}`,
          });
        }
      }
    }

    // 2) Delivered vehicle but no invoice issued
    for (const c of claims) {
      if (c.delivered_at && c.status !== "paid" && c.status !== "cancelled" && c.status !== "rejected") {
        const invoice = invoices.find((i) => i.claim_id === c.id);
        if (!invoice) {
          const age = daysBetween(now, new Date(c.delivered_at));
          if (age >= 1) {
            alerts.push({
              id: `delivered-no-invoice-${c.id}`,
              severity: age >= 7 ? "critical" : "warning",
              type: "delivered_without_invoice",
              title: "مطالبة مسلّمة بدون فاتورة",
              description: `${c.claim_number} منذ ${age} يوم — ${c.insurance_company}`,
              href: `/insurance/${c.id}`,
            });
          }
        }
      }
    }

    // 3) Policy expiring within 30 days
    for (const c of claims) {
      if (c.policy_expiry_date) {
        const exp = new Date(c.policy_expiry_date);
        const diff = daysBetween(exp, now);
        if (diff >= 0 && diff <= 30) {
          alerts.push({
            id: `pol-${c.id}`,
            severity: diff <= 7 ? "critical" : "warning",
            type: "policy_expiring",
            title: `وثيقة تنتهي خلال ${diff} يوم`,
            description: `${c.claim_number} — وثيقة ${c.policy_number || ""}`,
            href: `/insurance/${c.id}`,
          });
        }
      }
    }

    // 4) Cheque due soon
    for (const p of payments) {
      if (p.payment_method === "cheque" && p.status === "pending" && p.cheque_due_date) {
        const due = new Date(p.cheque_due_date);
        const diff = daysBetween(due, now);
        if (diff >= 0 && diff <= 7) {
          alerts.push({
            id: `chq-${p.id}`,
            severity: diff <= 2 ? "critical" : "warning",
            type: "cheque_due",
            title: `شيك مستحق خلال ${diff} يوم`,
            description: `${p.payment_number} — ${p.amount.toLocaleString()} OMR`,
          });
        }
      }
    }

    // 5) Overdue invoices
    for (const inv of invoices) {
      if (inv.status !== "paid" && inv.status !== "cancelled" && inv.due_date) {
        const due = new Date(inv.due_date);
        const overdue = daysBetween(now, due);
        if (overdue > 0) {
          alerts.push({
            id: `inv-${inv.id}`,
            severity: overdue > 30 ? "critical" : "warning",
            type: "invoice_overdue",
            title: `فاتورة متأخرة ${overdue} يوم`,
            description: `${inv.invoice_number} — ${inv.insurance_company_name} — ${inv.total.toLocaleString()} OMR`,
          });
        }
      }
    }

    // sort: critical → warning → info
    const order = { critical: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [claims, payments, invoices]);
}
