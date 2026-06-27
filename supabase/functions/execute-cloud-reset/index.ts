import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_TABLES = [
  "whatsapp_logs",
  "import_export_operations",
  "job_orders",
  "insurance_claims",
  "insurance_estimates",
  "insurance_invoices",
  "claim_payments",
  "customer_advances",
  "expenses",
  "sales_documents",
  "vehicles",
  "customers",
];

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("unauthorized");
    const body = await req.json().catch(() => ({}));
    if (body.confirmPhrase !== "DELETE CLOUD DATA") throw new Error("invalid_confirmation_phrase");
    if (!/^\d{6}$/.test(String(body.otp || ""))) throw new Error("invalid_otp_format");

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id,role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("profile_not_found");
    if (!["admin", "manager"].includes(profile.role)) throw new Error("admin_required");

    const expectedHash = await sha256(`${profile.tenant_id}:${userData.user.id}:cloud_reset:${body.otp}`);
    const { data: otpRow } = await admin
      .from("security_action_otps")
      .select("id,expires_at,consumed_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", "cloud_reset")
      .eq("code_hash", expectedHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!otpRow?.id) throw new Error("otp_invalid_or_expired");
    await admin.from("security_action_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otpRow.id);

    const dryRun = body.dryRun !== false;
    const results: Record<string, number | string> = {};
    for (const table of TENANT_TABLES) {
      const countResult = await admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", profile.tenant_id);
      if (countResult.error) {
        results[`${table}_error`] = countResult.error.message;
        continue;
      }
      results[table] = countResult.count || 0;
      if (!dryRun && (countResult.count || 0) > 0) {
        const { error } = await admin.from(table).delete().eq("tenant_id", profile.tenant_id);
        if (error) results[`${table}_error`] = error.message;
      }
    }

    await admin.from("cloud_reset_audit_log").insert({
      tenant_id: profile.tenant_id,
      requested_by: userData.user.id,
      status: dryRun ? "dry_run" : "executed",
      reason: body.reason || null,
    });

    return new Response(JSON.stringify({ ok: true, dryRun, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
