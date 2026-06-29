import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_PROVIDER = "resend_email";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskKey(value?: string | null) {
  if (!value) return null;
  const tail = value.slice(-4);
  const prefix = value.startsWith("re_") ? "re_" : "";
  return `${prefix}****${tail}`;
}

function isOwnerOrSuperAdmin(profile: any) {
  return ["admin", "owner", "super_admin"].includes(String(profile?.role || "")) || !!profile?.is_platform_admin;
}

async function audit(admin: any, payload: Record<string, unknown>) {
  try {
    await admin.from("security_otp_audit_log").insert(payload);
  } catch {
    // Audit must never break settings save/status.
  }
}

async function resolveContext(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("server_env_not_configured");

  const authHeader = req.headers.get("Authorization") || "";
  const admin = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) throw new Error("unauthorized");

  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id,role,is_platform_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!profile?.tenant_id) throw new Error("profile_not_found");
  return { admin, user: userData.user, profile };
}

async function getStatus(admin: any, tenantId: string) {
  const { data: row, error } = await admin
    .from("tenant_integrations")
    .select("provider,enabled,config,secrets,last_test_at,last_test_status,last_test_error")
    .eq("tenant_id", tenantId)
    .eq("provider", EMAIL_PROVIDER)
    .maybeSingle();
  if (error) throw error;
  const cfg = (row?.config || {}) as Record<string, string>;
  const sec = (row?.secrets || {}) as Record<string, string>;
  return {
    configured: !!row && !!sec.api_key && !!cfg.from_email,
    enabled: !!row?.enabled,
    provider: row?.provider || EMAIL_PROVIDER,
    activeProvider: row?.enabled ? "Resend" : null,
    fromEmail: cfg.from_email || "",
    fromName: cfg.from_name || "",
    domain: cfg.domain || "",
    maskedKey: maskKey(sec.api_key),
    lastTestAt: row?.last_test_at || null,
    lastTestStatus: row?.last_test_status || null,
    lastTestError: row?.last_test_error || null,
    smtpStatus: "coming_soon",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const { admin, user, profile } = await resolveContext(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");

    if (action === "status") {
      const status = await getStatus(admin, profile.tenant_id);
      return json({ ok: true, status });
    }

    if (!isOwnerOrSuperAdmin(profile)) throw new Error("owner_or_super_admin_required");

    if (action !== "save") throw new Error("unsupported_action");
    const enabled = !!body.enabled;
    const fromEmail = String(body.fromEmail || "").trim();
    const fromName = String(body.fromName || "").trim();
    const domain = String(body.domain || "").trim();
    const apiKey = String(body.apiKey || "").trim();

    if (enabled && (!fromEmail || !/^.+@.+\..+$/.test(fromEmail))) throw new Error("from_email_required");
    if (apiKey && !apiKey.startsWith("re_")) throw new Error("invalid_resend_api_key");

    const { data: existing, error: existingError } = await admin
      .from("tenant_integrations")
      .select("secrets")
      .eq("tenant_id", profile.tenant_id)
      .eq("provider", EMAIL_PROVIDER)
      .maybeSingle();
    if (existingError) throw existingError;

    const existingSecrets = (existing?.secrets || {}) as Record<string, string>;
    const nextSecrets = { ...existingSecrets };
    if (apiKey) nextSecrets.api_key = apiKey;

    if (enabled && !nextSecrets.api_key) throw new Error("resend_api_key_required");

    // Only one active email provider for this tenant.
    await admin
      .from("tenant_integrations")
      .update({ enabled: false })
      .eq("tenant_id", profile.tenant_id)
      .in("provider", [EMAIL_PROVIDER, "smtp_email"]);

    const { error } = await admin
      .from("tenant_integrations")
      .upsert({
        tenant_id: profile.tenant_id,
        provider: EMAIL_PROVIDER,
        enabled,
        config: { from_email: fromEmail, from_name: fromName, domain },
        secrets: nextSecrets,
      }, { onConflict: "tenant_id,provider" });
    if (error) throw error;

    await audit(admin, {
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: "email_provider",
      event: existing ? "email provider updated" : "email provider added",
      status: "success",
      details: { provider: "resend", enabled, fromEmail, domain },
    });
    if (enabled) {
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: "email_provider",
        event: "email provider activated",
        status: "success",
        details: { provider: "resend" },
      });
    }

    const status = await getStatus(admin, profile.tenant_id);
    return json({ ok: true, status });
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    return json({ ok: false, error: code, code, message: code });
  }
});
