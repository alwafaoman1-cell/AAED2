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

async function auditOtp(admin: any, payload: Record<string, unknown>) {
  await admin.from("security_otp_audit_log").insert(payload).catch(() => {});
}

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
      .select("tenant_id,role,is_platform_admin")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("profile_not_found");
    if (!["admin", "owner"].includes(String(profile.role || "")) && !profile.is_platform_admin) throw new Error("owner_or_super_admin_required");

    const now = new Date().toISOString();
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const { data: latestOtp } = await admin
      .from("security_action_otps")
      .select("id,attempt_count,locked_until")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", "cloud_reset")
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestOtp?.locked_until && latestOtp.locked_until > now) {
      await auditOtp(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "cloud_reset",
        event: "verify",
        status: "locked",
        ip,
        details: { lockedUntil: latestOtp.locked_until },
      });
      throw new Error("otp_locked");
    }
    const expectedHash = await sha256(`${profile.tenant_id}:${userData.user.id}:cloud_reset:${body.otp}`);
    const { data: otpRow } = await admin
      .from("security_action_otps")
      .select("id,expires_at,consumed_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", "cloud_reset")
      .eq("code_hash", expectedHash)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!otpRow?.id) {
      const attempts = Number(latestOtp?.attempt_count || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      if (latestOtp?.id) {
        await admin
          .from("security_action_otps")
          .update({ attempt_count: attempts, locked_until: lockedUntil, last_attempt_at: now })
          .eq("id", latestOtp.id);
      }
      await auditOtp(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "cloud_reset",
        event: "verify",
        status: lockedUntil ? "locked_after_failure" : "failed",
        ip,
        details: { attempts, lockedUntil },
      });
      throw new Error(lockedUntil ? "otp_locked" : "otp_invalid_or_expired");
    }
    await admin.from("security_action_otps").update({ consumed_at: now, last_attempt_at: now }).eq("id", otpRow.id);
    await auditOtp(admin, {
      tenant_id: profile.tenant_id,
      user_id: userData.user.id,
      action: "cloud_reset",
      event: "verify",
      status: "success",
      ip,
      details: { dryRun: body.dryRun !== false },
    });

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
