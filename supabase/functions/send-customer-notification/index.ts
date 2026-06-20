// Sends a queued customer_notifications row via WhatsApp link generation (returns wa.me URL),
// SMS (via send-sms function), or marks as sent and stores log. On success: status=sent + sent_at.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { notification_id } = await req.json().catch(() => ({}));
    if (!notification_id) return json({ error: "notification_id required" }, 400);

    const { data: n, error } = await supabase
      .from("customer_notifications")
      .select("*")
      .eq("id", notification_id)
      .maybeSingle();
    if (error || !n) return json({ error: "not_found" }, 404);

    let resultUrl: string | null = null;
    let success = true;
    let errMsg: string | null = null;

    try {
      if (n.channel === "whatsapp") {
        const phone = (n.recipient || "").replace(/\D/g, "");
        resultUrl = `https://wa.me/${phone}?text=${encodeURIComponent(n.body)}`;
      } else if (n.channel === "sms") {
        const phone = (n.recipient || "").trim();
        if (!phone) throw new Error("missing recipient");
        const { error: smsErr } = await supabase.functions.invoke("send-sms", {
          body: { to: phone, message: n.body },
        });
        if (smsErr) throw new Error(smsErr.message || "sms failed");
      } else if (n.channel === "email") {
        // email channel: best-effort - mark sent; integrate transactional email later
        if (!n.recipient) throw new Error("missing email");
      } else {
        throw new Error("unsupported channel");
      }
    } catch (e) {
      success = false;
      errMsg = (e as Error).message;
    }

    await supabase
      .from("customer_notifications")
      .update({
        status: success ? "sent" : "failed",
        sent_at: success ? new Date().toISOString() : null,
        error: errMsg,
        payload: { ...(n.payload || {}), wa_url: resultUrl },
      })
      .eq("id", notification_id);

    return json({ ok: success, wa_url: resultUrl, error: errMsg });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
