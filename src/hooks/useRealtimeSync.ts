import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { hasUnsavedWork, subscribeUnsavedWork } from "@/lib/unsavedWork";

const RESUME_DELAY_MS = 2_000;
const STALE_AFTER_HIDDEN_MS = 30_000;

const TABLES_TO_KEYS: Record<string, string[]> = {
  insurance_claims: ["insurance_claims", "insurance_invoices", "work_order_financials", "vehicle_360", "monthly-vehicle-profitability"],
  insurance_invoices: ["insurance_invoices", "work_order_financials", "vehicle_360", "monthly-vehicle-profitability"],
  job_orders: ["job_orders", "insurance_claims", "invoices", "work_order_financials", "vehicle_360", "monthly-vehicle-profitability"],
  invoices: ["invoices"],
  claim_payments: ["claim_payments", "insurance_claims", "work_order_financials", "vehicle_360", "accounting_receipts_page", "monthly-vehicle-profitability"],
  accounting_receipts: ["accounting_receipts_page"],
  customers: ["customers"],
  vehicles: ["vehicles", "customers", "vehicle_360"],
  vehicle_media: ["vehicle_media", "vehicles", "vehicle_360"],
  vehicle_entries: ["vehicle_entries", "vehicle_360"],
  vehicle_entry_signatures: ["vehicle_entries", "vehicle_360"],
  vehicle_handover_records: ["vehicle_handover_records", "vehicle_360"],
  inventory: ["inventory"],
  job_order_parts: ["job_order_parts", "inventory", "job_orders", "vehicle_360"],
  insurance_companies: ["insurance_companies"],
  daily_tasks: ["daily_tasks"],
  sms_logs: ["sms_logs"],
  tenant_sms_settings: ["tenant_sms_settings"],
  claim_audit_logs: ["claim_audit_logs", "insurance_claims", "vehicle_360"],
  inspections: ["inspections"],
  damage_markers: ["damage_markers", "inspections"],
  job_order_logs: ["job_order_logs", "job_orders"],
  print_templates: ["print_templates"],
  profiles: ["profiles"],
  vehicle_makes: ["vehicle_makes"],
  vehicle_models: ["vehicle_models"],
  expenses: ["expenses", "expense_management", "job_orders", "journal_entries", "vehicle_360", "monthly-vehicle-profitability", "monthly-workshop-report"],
  sales_documents: ["sales_documents", "sales_documents_search", "sales_financial_summary", "invoices", "work_order_financials", "vehicle_360", "monthly-vehicle-profitability"],
  sales_payments: ["sales_payments", "sales_documents", "sales_financial_summary", "cash_sales_payments", "work_order_financials", "vehicle_360", "accounting_receipts_page", "monthly-vehicle-profitability"],
  journal_entries: ["journal_entries"],
  journal_lines: ["journal_lines", "journal_entries"],
};

const ROUTE_TABLE_SCOPES: Array<{ scope: string; test: (path: string) => boolean; tables: string[] }> = [
  {
    scope: "dashboard",
    test: (path) => path === "/" || path === "/dashboard",
    tables: ["sales_documents", "sales_payments"],
  },
  {
    scope: "sales",
    test: (path) => path === "/sales" || path.startsWith("/sales/"),
    tables: ["sales_documents", "sales_payments"],
  },
  {
    scope: "work_order_detail",
    test: (path) => /^\/work-orders\/[^/]+/.test(path),
    tables: ["job_orders", "job_order_parts", "job_order_logs", "insurance_claims", "insurance_invoices", "claim_payments", "sales_documents", "sales_payments", "expenses"],
  },
  {
    scope: "work_orders_list",
    test: (path) => path === "/work-orders",
    tables: ["job_orders", "expenses", "insurance_claims", "insurance_invoices", "claim_payments", "sales_documents", "sales_payments"],
  },
  {
    scope: "supervisor",
    test: (path) => path === "/supervisor" || path === "/supervisor-app",
    tables: ["job_orders", "job_order_parts", "expenses"],
  },
  {
    scope: "claim_detail",
    test: (path) =>
      /^\/insurance\/claims\/[^/]+/.test(path) ||
      (
        /^\/insurance\/[^/]+/.test(path) &&
        !path.startsWith("/insurance/accounting") &&
        !path.startsWith("/insurance/companies") &&
        !path.startsWith("/insurance/new") &&
        !path.startsWith("/insurance/pipeline") &&
        !path.startsWith("/insurance/estimates") &&
        !path.startsWith("/insurance/documents")
      ),
    tables: ["insurance_claims", "claim_audit_logs", "claim_payments", "insurance_invoices", "vehicle_media", "expenses"],
  },
  {
    scope: "claims_list",
    test: (path) => path === "/insurance/claims" || path.startsWith("/insurance/pipeline"),
    tables: ["insurance_claims"],
  },
  {
    scope: "vehicle_entry_detail",
    test: (path) => /^\/vehicle-entry\/[^/]+/.test(path) && !path.startsWith("/vehicle-entry/sign/"),
    tables: ["vehicle_entries", "vehicle_entry_signatures"],
  },
  {
    scope: "vehicle_detail",
    test: (path) => /^\/vehicles\/[^/]+/.test(path),
    tables: ["vehicles", "vehicle_media", "vehicle_entries", "vehicle_handover_records", "job_orders", "job_order_parts", "insurance_claims", "claim_audit_logs", "insurance_invoices", "claim_payments", "expenses", "sales_documents", "sales_payments"],
  },
  {
    scope: "customers_list",
    test: (path) => path === "/customers",
    tables: ["customers"],
  },
  {
    scope: "vehicles_list",
    test: (path) => path === "/vehicles",
    tables: ["vehicles", "vehicle_media"],
  },
  {
    scope: "inspections",
    test: (path) => path === "/inspection" || path.startsWith("/inspection/"),
    tables: ["inspections", "damage_markers"],
  },
  {
    scope: "accounting",
    test: (path) => path.startsWith("/accounting") || path.startsWith("/insurance/accounting"),
    tables: ["insurance_invoices", "claim_payments", "expenses", "sales_documents", "sales_payments", "accounting_receipts"],
  },
  {
    scope: "operations_apps",
    test: (path) => path === "/manager-app" || path === "/accountant" || path === "/dashboard/executive",
    tables: ["job_orders", "expenses", "sales_documents", "sales_payments", "insurance_invoices", "claim_payments"],
  },
  {
    scope: "reports",
    test: (path) => path.startsWith("/reports"),
    tables: [],
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
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const realtimeScope = useMemo(() => getRealtimeScope(pathname), [pathname]);

  useEffect(() => {
    if (!profile?.tenant_id || realtimeScope.tables.length === 0) return;

    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hiddenAt: number | null = null;
    let resumedAt: number | null = null;

    const now = () => Date.now();
    const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const isRecentlyReturnedToTab = () => resumedAt !== null && now() - resumedAt < RESUME_DELAY_MS;

    const scheduleFlush = () => {
      if (timer || pending.size === 0 || !isVisible() || hasUnsavedWork()) return;
      const delay = Math.max(1_500, RESUME_DELAY_MS - (resumedAt === null ? RESUME_DELAY_MS : now() - resumedAt));
      timer = setTimeout(flush, delay);
    };

    const queueStaleActiveQueries = () => {
      for (const table of realtimeScope.tables) {
        for (const key of TABLES_TO_KEYS[table] ?? []) {
          if (qc.getQueryCache().findAll({ queryKey: [key], type: "active" })
            .some((query) => query.state.dataUpdatedAt < now() - STALE_AFTER_HIDDEN_MS)) {
            pending.add(key);
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      if (!isVisible()) {
        hiddenAt = now();
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      resumedAt = now();
      if (hiddenAt !== null && resumedAt - hiddenAt >= STALE_AFTER_HIDDEN_MS) queueStaleActiveQueries();
      hiddenAt = null;
      scheduleFlush();
    };

    const flush = () => {
      timer = null;
      if (!isVisible() || hasUnsavedWork()) return;
      if (isRecentlyReturnedToTab()) { scheduleFlush(); return; }
      const keys = Array.from(pending);
      pending.clear();
      for (const key of keys) {
        // Only mounted readers refetch. A tab return never reloads the page or
        // hydrates whole legacy stores while a form is being edited.
        void qc.invalidateQueries({ queryKey: [key], refetchType: "active" });
      }
    };

    const schedule = (keys: string[]) => {
      for (const key of keys) pending.add(key);
      scheduleFlush();
    };

    const unsubscribeDirty = subscribeUnsavedWork((dirty) => {
      if (!dirty) scheduleFlush();
    });

    let channel = supabase.channel(`rt_${realtimeScope.scope}`);
    for (const table of realtimeScope.tables) {
      const keys = TABLES_TO_KEYS[table];
      if (!keys) continue;
      channel = channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter: `tenant_id=eq.${profile.tenant_id}`,
      }, (payload) => {
        // Work-order screens still consume the compatibility store. Apply the
        // changed row directly so another device is reflected immediately;
        // query invalidation alone does not update that store.
        if (table === "job_orders") {
          void import("@/lib/workOrdersStore")
            .then(({ applyWorkOrderRealtimeChange }) => applyWorkOrderRealtimeChange(payload))
            .catch((error) => console.warn("[realtime:job_orders]", error));
        }
        if (table === "expenses") {
          void import("@/lib/expensesStore")
            .then(({ applyExpenseRealtimeChange }) => applyExpenseRealtimeChange(payload))
            .catch((error) => console.warn("[realtime:expenses]", error));
          if (realtimeScope.scope === "work_orders_list") {
            void import("@/lib/workOrdersStore")
              .then(({ refreshWorkOrderActualCostFromExpenseChange }) => refreshWorkOrderActualCostFromExpenseChange(payload))
              .catch((error) => console.warn("[realtime:work-order-costs]", error));
          }
        }
        if (table === "inspections") {
          void import("@/lib/inspectionsStore")
            .then(({ applyInspectionRealtimeChange }) => applyInspectionRealtimeChange(payload))
            .catch((error) => console.warn("[realtime:inspections]", error));
        }
        schedule(keys);
      });
    }

    channel.subscribe();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    if (import.meta.env.DEV) {
      console.debug("[realtime]", {
        scope: realtimeScope.scope,
        tables: realtimeScope.tables,
        channel: `rt_${realtimeScope.scope}`,
      });
    }

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeDirty();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      void supabase.removeChannel(channel);
    };
  }, [profile?.tenant_id, qc, realtimeScope]);
}
