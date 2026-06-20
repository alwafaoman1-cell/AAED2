// Daily automatic backup — runs via pg_cron
// Iterates every tenant, dumps all listed tables and uploads JSON to `backups/<tenant_id>/`.
// Prunes files older than 30 days.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = [
  "tenants","profiles","customers","vehicles","vehicle_makes","vehicle_models",
  "job_orders","job_order_parts","job_order_logs","inspections","damage_markers",
  "insurance_companies","insurance_claims","insurance_invoices",
  "claim_payments","claim_audit_logs","invoices","inventory","daily_tasks",
  "payment_links","print_templates","sms_logs","tenant_integrations","tenant_sms_settings",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Require shared secret OR service-role bearer (for pg_cron invocation)
  const expected = Deno.env.get("BACKUP_SECRET");
  const provided = req.headers.get("x-backup-secret");
  const auth = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const hasServiceAuth = serviceKey && auth === `Bearer ${serviceKey}`;
  const hasSecret = expected && provided === expected;
  if (!hasServiceAuth && !hasSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: tenants, error: tErr } = await supabase.from("tenants").select("id, name").eq("is_active", true);
  if (tErr) {
    return new Response(JSON.stringify({ error: tErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const tenant of tenants ?? []) {
    try {
      const tables: Record<string, any[]> = {};
      for (const t of TABLES) {
        const all: any[] = [];
        let from = 0; const PAGE = 1000;
        while (true) {
          const q = supabase.from(t).select("*").range(from, from + PAGE - 1);
          // tenants table doesn't have tenant_id column; profiles has tenant_id
          const { data, error } = (t === "tenants")
            ? await supabase.from(t).select("*").eq("id", tenant.id)
            : await q.eq("tenant_id" as any, tenant.id);
          if (error) { console.warn(t, error.message); break; }
          if (!data?.length) break;
          all.push(...data);
          if (data.length < PAGE || t === "tenants") break;
          from += PAGE;
        }
        tables[t] = all;
      }

      const manifest = {
        version: 1,
        generated_at: new Date().toISOString(),
        tenant_id: tenant.id,
        app: "alwafa-erp",
        auto: true,
        tables,
      };

      const filename = `${tenant.id}/auto-${today}.json`;
      const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
      const { error: upErr } = await supabase.storage.from("backups")
        .upload(filename, blob, { upsert: true, contentType: "application/json" });
      if (upErr) throw upErr;

      // prune >30 days (auto-* only)
      const { data: files } = await supabase.storage.from("backups").list(tenant.id, { limit: 1000 });
      const cutoff = Date.now() - 30 * 86400_000;
      const toDelete = (files ?? [])
        .filter((f: any) => f.name?.startsWith("auto-") && new Date(f.created_at).getTime() < cutoff)
        .map((f: any) => `${tenant.id}/${f.name}`);
      if (toDelete.length) await supabase.storage.from("backups").remove(toDelete);

      results.push({ tenant: tenant.id, ok: true, file: filename, pruned: toDelete.length });
    } catch (e: any) {
      results.push({ tenant: tenant.id, ok: false, error: e?.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
