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

async function audit(admin: any, payload: Record<string, unknown>) {
  try {
    await admin.from("security_otp_audit_log").insert(payload);
  } catch {
    // Audit logging must never break the OTP response.
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("server_env_not_configured");
    const authHeader = req.headers.get("Authorization") || "";
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const admin = createClient(supabaseUrl, serviceKey);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("unauthorized");
    const body = await req.json().catch(() => ({}));
    const action = body.action === "cloud_reset" ? "cloud_reset" : "login_otp";
    const code = String(body.otp || "");
    if (!/^\d{6}$/.test(code)) throw new Error("invalid_otp_format");

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("profile_not_found");

    const now = new Date().toISOString();
    const { data: latestOtp } = await admin
      .from("security_action_otps")
      .select("id,attempt_count,locked_until,expires_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", action)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestOtp?.locked_until && latestOtp.locked_until > now) {
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action,
        event: "verify",
        status: "locked",
        ip,
        details: { lockedUntil: latestOtp.locked_until },
      });
      throw new Error("otp_locked");
    }
    if (latestOtp?.expires_at && latestOtp.expires_at <= now) throw new Error("otp_expired");

    const expectedHash = await sha256(`${profile.tenant_id}:${userData.user.id}:${action}:${code}`);
    const { data: otpRow } = await admin
      .from("security_action_otps")
      .select("id")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", userData.user.id)
      .eq("action", action)
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
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action,
        event: "verify",
        status: lockedUntil ? "locked_after_failure" : "failed",
        ip,
        details: { attempts, lockedUntil },
      });
      throw new Error(lockedUntil ? "otp_locked" : "otp_invalid_or_expired");
    }

    await admin
      .from("security_action_otps")
      .update({ consumed_at: now, last_attempt_at: now })
      .eq("id", otpRow.id);
    await audit(admin, {
      tenant_id: profile.tenant_id,
      user_id: userData.user.id,
      action,
      event: "verify",
      status: "success",
      ip,
      details: {},
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    return new Response(JSON.stringify({ ok: false, error: code, code, message: code }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
