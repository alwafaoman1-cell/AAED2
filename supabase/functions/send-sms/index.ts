import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { to, message, test } = body || {};

    if (!to || typeof to !== "string" || !/^\+?[1-9]\d{6,15}$/.test(to.replace(/\s/g, ""))) {
      return json({ error: "رقم غير صالح (يجب بصيغة E.164 مثل +9689xxxxxxx)" }, 400);
    }
    if (!message || typeof message !== "string" || message.length === 0 || message.length > 1600) {
      return json({ error: "نص الرسالة مطلوب (1-1600 حرف)" }, 400);
    }

    // get user's tenant + sms settings
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile?.tenant_id) return json({ error: "Tenant not found" }, 403);

    const { data: settings } = await supabase
      .from("tenant_sms_settings")
      .select("account_sid, auth_token, from_number, enabled")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();

    if (!settings || !settings.enabled || !settings.account_sid || !settings.auth_token || !settings.from_number) {
      return json({ error: "إعدادات SMS غير مكتملة. يرجى ضبطها من /settings/sms" }, 400);
    }

    const cleanTo = to.replace(/\s/g, "");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${settings.account_sid}/Messages.json`;
    const auth = btoa(`${settings.account_sid}:${settings.auth_token}`);

    const params = new URLSearchParams({
      To: cleanTo,
      From: settings.from_number,
      Body: message,
    });

    const twRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const twData = await twRes.json();

    if (!twRes.ok) {
      await supabase.from("sms_logs").insert({
        tenant_id: profile.tenant_id,
        user_id: userId,
        to_number: cleanTo,
        body: message,
        status: "failed",
        error: twData?.message || `HTTP ${twRes.status}`,
      });
      return json({ error: twData?.message || "فشل الإرسال", details: twData }, 502);
    }

    await supabase.from("sms_logs").insert({
      tenant_id: profile.tenant_id,
      user_id: userId,
      to_number: cleanTo,
      body: message,
      status: "sent",
      provider_sid: twData?.sid,
    });

    return json({ success: true, sid: twData.sid, test: !!test });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
