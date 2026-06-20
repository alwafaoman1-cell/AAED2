// اختبار اتصال للتكاملات: twilio_whatsapp / meta_whatsapp / gmail
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  provider: "twilio_whatsapp" | "meta_whatsapp" | "gmail";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("missing_auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error("unauthenticated");

    const { provider } = (await req.json()) as Body;
    if (!provider) throw new Error("provider_required");

    const { data: integ, error } = await supabase
      .from("tenant_integrations")
      .select("config, secrets")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!integ) throw new Error("not_configured");

    const cfg = (integ.config || {}) as Record<string, string>;
    const sec = (integ.secrets || {}) as Record<string, string>;

    let ok = false;
    let info = "";

    if (provider === "twilio_whatsapp") {
      const sid = cfg.account_sid;
      const token = sec.auth_token;
      if (!sid || !token) throw new Error("missing_twilio_credentials");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
      });
      const j = await r.json();
      ok = r.ok;
      info = ok ? `Account: ${j.friendly_name}` : (j.message || "auth_failed");
    } else if (provider === "meta_whatsapp") {
      const phoneId = cfg.phone_number_id;
      const token = sec.access_token;
      if (!phoneId || !token) throw new Error("missing_meta_credentials");
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      ok = r.ok;
      info = ok ? `${j.verified_name} (${j.display_phone_number})` : (j.error?.message || "auth_failed");
    } else if (provider === "gmail") {
      const refresh = sec.refresh_token;
      const clientId = cfg.client_id;
      const clientSecret = sec.client_secret;
      if (!refresh || !clientId || !clientSecret) throw new Error("missing_gmail_credentials");
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh,
          grant_type: "refresh_token",
        }),
      });
      const j = await r.json();
      ok = r.ok && !!j.access_token;
      info = ok ? "Token refreshed OK" : (j.error_description || j.error || "auth_failed");
    } else {
      throw new Error("unknown_provider");
    }

    await supabase
      .from("tenant_integrations")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: ok ? "success" : "failed",
        last_test_error: ok ? null : info,
      })
      .eq("provider", provider);

    return new Response(JSON.stringify({ ok, info }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
