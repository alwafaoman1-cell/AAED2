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

function isOwnerOrSuperAdmin(profile: any) {
  return ["admin", "owner", "super_admin"].includes(String(profile?.role || "")) || !!profile?.is_platform_admin;
}

async function audit(admin: any, payload: Record<string, unknown>) {
  try {
    await admin.from("security_otp_audit_log").insert(payload);
  } catch {
    // Audit must never break the test response.
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

function resendFrom(config: Record<string, string>) {
  const email = config.from_email;
  const name = config.from_name || "AAED2";
  return name ? `${name} <${email}>` : email;
}

async function sendResendEmail(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `resend_failed_${response.status}`);
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  let context: Awaited<ReturnType<typeof resolveContext>> | null = null;
  try {
    context = await resolveContext(req);
    const { admin, user, profile } = context;
    if (!isOwnerOrSuperAdmin(profile)) throw new Error("owner_or_super_admin_required");

    const { data: row, error } = await admin
      .from("tenant_integrations")
      .select("config,secrets,enabled")
      .eq("tenant_id", profile.tenant_id)
      .eq("provider", EMAIL_PROVIDER)
      .maybeSingle();
    if (error) throw error;
    const config = (row?.config || {}) as Record<string, string>;
    const secrets = (row?.secrets || {}) as Record<string, string>;
    if (!row?.enabled || !secrets.api_key || !config.from_email) throw new Error("email_provider_not_configured");
    if (!user.email) throw new Error("user_email_not_found");

    await sendResendEmail({
      apiKey: secrets.api_key,
      from: resendFrom(config),
      to: user.email,
      subject: "AAED2 Email Provider Test",
      text: "AAED2 email provider test succeeded. OTP emails can now be delivered from this tenant provider.",
    });

    await admin
      .from("tenant_integrations")
      .update({ last_test_at: new Date().toISOString(), last_test_status: "success", last_test_error: null })
      .eq("tenant_id", profile.tenant_id)
      .eq("provider", EMAIL_PROVIDER);
    await audit(admin, {
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: "email_provider",
      event: "email provider tested",
      status: "success",
      details: { provider: "resend", to: user.email },
    });

    return json({ ok: true, status: "Connected", info: "Connected" });
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    if (context) {
      const { admin, user, profile } = context;
      await admin
        .from("tenant_integrations")
        .update({ last_test_at: new Date().toISOString(), last_test_status: "failed", last_test_error: code })
        .eq("tenant_id", profile.tenant_id)
        .eq("provider", EMAIL_PROVIDER);
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: "email_provider",
        event: "email provider tested",
        status: "failed",
        details: { provider: "resend", error: code },
      });
    }
    return json({ ok: false, status: code === "email_provider_not_configured" ? "Not Configured" : "Failed", error: code, code, message: code });
  }
});
