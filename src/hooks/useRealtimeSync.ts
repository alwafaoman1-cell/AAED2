import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TABLES_TO_KEYS: Record<string, string[]> = {
  insurance_claims: ["insurance_claims", "insurance_invoices"],
  insurance_invoices: ["insurance_invoices"],
  job_orders: ["job_orders", "insurance_claims", "invoices"],
  invoices: ["invoices"],
  claim_payments: ["claim_payments", "insurance_claims"],
  customers: ["customers"],
  vehicles: ["vehicles", "customers"],
  vehicle_media: ["vehicle_media", "vehicles"],
  inventory: ["inventory"],
  job_order_parts: ["job_order_parts", "inventory", "job_orders"],
  insurance_companies: ["insurance_companies"],
  daily_tasks: ["daily_tasks"],
  sms_logs: ["sms_logs"],
  tenant_sms_settings: ["tenant_sms_settings"],
  claim_audit_logs: ["claim_audit_logs", "insurance_claims"],
  inspections: ["inspections"],
  damage_markers: ["damage_markers", "inspections"],
  job_order_logs: ["job_order_logs", "job_orders"],
  print_templates: ["print_templates"],
  profiles: ["profiles"],
  vehicle_makes: ["vehicle_makes"],
  vehicle_models: ["vehicle_models"],
  expenses: ["expenses", "journal_entries"],
  sales_documents: ["sales_documents", "invoices"],
  sales_payments: ["sales_payments", "sales_documents"],
  journal_entries: ["journal_entries"],
  journal_lines: ["journal_lines", "journal_entries"],
};

const ROUTE_TABLE_SCOPES: Array<{ scope: string; test: (path: string) => boolean; tables: string[] }> = [
  {
    scope: "dashboard",
    test: (path) => path === "/" || path.startsWith("/dashboard"),
    tables: ["job_orders", "insurance_claims", "insurance_invoices", "claim_payments", "expenses", "sales_documents"],
  },
  {
    scope: "work_orders",
    test: (path) => path.startsWith("/work-orders"),
    tables: ["job_orders", "job_order_parts", "job_order_logs", "vehicles", "customers", "insurance_claims"],
  },
  {
    scope: "claims",
    test: (path) => path.startsWith("/insurance/claims"),
    tables: ["insurance_claims", "claim_audit_logs", "claim_payments", "insurance_invoices", "vehicles", "customers", "vehicle_media"],
  },
  {
    scope: "vehicles",
    test: (path) => path.startsWith("/vehicles"),
    tables: ["vehicles", "vehicle_media", "job_orders"],
  },
  {
    scope: "accounting",
    test: (path) => path.startsWith("/accounting") || path.startsWith("/insurance/accounting"),
    tables: ["insurance_invoices", "claim_payments", "expenses", "sales_documents", "sales_payments", "journal_entries"],
  },
  {
    scope: "reports",
    test: (path) => path.startsWith("/reports"),
    tables: ["job_orders", "insurance_claims", "insurance_invoices", "claim_payments", "expenses", "sales_documents"],
  },
  {
    scope: "settings",
    test: (path) => path.startsWith("/settings"),
    tables: ["print_templates", "vehicle_makes", "vehicle_models", "tenant_sms_settings"],
  },
];

function getRealtimeScope(pathname: string) {
  return ROUTE_TABLE_SCOPES.find((scope) => scope.test(pathname)) ?? { scope: "minimal", tables: [] };
}

export function useRealtimeSync() {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const realtimeScope = useMemo(() => getRealtimeScope(pathname), [pathname]);

  useEffect(() => {
    if (realtimeScope.tables.length === 0) return;

    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const keys = Array.from(pending);
      pending.clear();
      for (const key of keys) {
        qc.invalidateQueries({ queryKey: [key], refetchType: "active" });
      }
    };

    const schedule = (keys: string[]) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      for (const key of keys) pending.add(key);
      if (!timer) timer = setTimeout(flush, 1_500);
    };

    let channel = supabase.channel(`rt_${realtimeScope.scope}`);
    for (const table of realtimeScope.tables) {
      const keys = TABLES_TO_KEYS[table];
      if (!keys) continue;
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => schedule(keys));
    }

    channel.subscribe();

    if (import.meta.env.DEV) {
      console.debug("[realtime]", {
        scope: realtimeScope.scope,
        tables: realtimeScope.tables,
        channel: `rt_${realtimeScope.scope}`,
      });
    }

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc, realtimeScope]);
}
