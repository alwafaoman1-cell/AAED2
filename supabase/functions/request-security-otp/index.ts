import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isOwnerOrSuperAdmin(profile: any) {
  return ["admin", "owner"].includes(String(profile?.role || "")) || !!profile?.is_platform_admin;
}

async function audit(admin: any, payload: Record<string, unknown>) {
  await admin.from("security_otp_audit_log").insert(payload).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("unauthorized");

    const body = await req.json().catch(() => ({}));
    const action = body.action === "login_otp" ? "login_otp" : "cloud_reset";
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id,role,is_platform_admin")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("profile_not_found");
    if (action === "cloud_reset" && !isOwnerOrSuperAdmin(profile)) throw new Error("owner_or_super_admin_required");

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("security_action_otps")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", action)
      .gte("created_at", since);
    if ((count || 0) >= 3) {
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action,
        event: "request",
        status: "rate_limited",
        ip,
        details: { windowMinutes: 10, limit: 3 },
      });
      throw new Error("otp_rate_limited");
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await sha256(`${profile.tenant_id}:${userData.user.id}:${action}:${code}`);
    await admin.from("security_action_otps").insert({
      tenant_id: profile.tenant_id,
      user_id: userData.user.id,
      action,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action,
        event: "request",
        status: "email_provider_not_configured",
        ip,
        details: {},
      });
      return new Response(JSON.stringify({ ok: false, error: "email_provider_not_configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("SECURITY_EMAIL_FROM") || "AAED2 Security <security@aaed.app>",
        to: userData.user.email,
        subject: action === "cloud_reset" ? "AAED2 cloud reset verification code" : "AAED2 login verification code",
        text: `Your AAED2 verification code is ${code}. It expires in 10 minutes.`,
      }),
    });

    await audit(admin, {
      tenant_id: profile.tenant_id,
      user_id: userData.user.id,
      action,
      event: "request",
      status: "sent",
      ip,
      details: {},
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
