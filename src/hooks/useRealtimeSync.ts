import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";


/**
 * Global Realtime sync — يستمع لكل التحديثات على جميع الجداول العامة
 * ويُبطل الكاش تلقائياً ليُحدّث الواجهة في كل الصفحات (مزامنة فورية شاملة).
 *
 * تحسينات الأداء:
 *  - Debounce على invalidate لتجميع الأحداث المتقاربة (تحديثات دفعية) في نداء واحد
 *  - قناة فريدة لكل تبويب لمنع تعارض الاشتراكات
 *  - يشمل جداول المحاسبة والمبيعات لتحديث اللوحات لحظياً
 */
const TABLES_TO_KEYS: Record<string, string[]> = {
  insurance_claims: ["insurance_claims", "insurance_invoices"],
  insurance_invoices: ["insurance_invoices"],
  job_orders: ["job_orders", "insurance_claims", "invoices"],
  invoices: ["invoices"],
  claim_payments: ["claim_payments", "insurance_claims"],
  customers: ["customers"],
  vehicles: ["vehicles", "customers"],
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
  // محاسبة ومبيعات — لتحديث لوحات KPI والتقارير لحظياً
  expenses: ["expenses", "journal_entries"],
  sales_documents: ["sales_documents", "invoices"],
  sales_payments: ["sales_payments", "sales_documents"],
  journal_entries: ["journal_entries"],
  journal_lines: ["journal_lines", "journal_entries"],
};

export function useRealtimeSync() {
  const qc = useQueryClient();
  // Stable channel name per mount — avoids leaking subscriptions during HMR
  // or React Strict Mode double-mounts (Math.random() in render produced a new
  // channel every render).
  const channelNameRef = useRef(`global_sync_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    // Debounce: تجميع الأحداث المتقاربة (≤120ms) في موجة invalidate واحدة لكل مفتاح
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const keys = Array.from(pending);
      pending.clear();
      for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
    };
    const schedule = (keys: string[]) => {
      for (const k of keys) pending.add(k);
      if (!timer) timer = setTimeout(flush, 120);
    };

    let channel = supabase.channel(channelNameRef.current);
    for (const [table, keys] of Object.entries(TABLES_TO_KEYS)) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => schedule(keys),
      );
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

