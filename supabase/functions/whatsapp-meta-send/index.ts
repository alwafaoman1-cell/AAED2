// إرسال رسالة WhatsApp عبر Meta Cloud API (نص أو قالب أو media)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  to: string;                  // E.164 رقم بدون +
  type?: "text" | "template" | "document" | "image";
  text?: string;
  template?: { name: string; language: string; components?: unknown[] };
  mediaUrl?: string;
  filename?: string;
  caption?: string;
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

    const body = (await req.json()) as Body;
    if (!body.to) throw new Error("to_required");

    const { data: integ, error } = await supabase
      .from("tenant_integrations")
      .select("config, secrets, enabled")
      .eq("provider", "meta_whatsapp")
      .maybeSingle();
    if (error) throw error;
    if (!integ || !integ.enabled) throw new Error("integration_disabled");

    const cfg = integ.config as Record<string, string>;
    const sec = integ.secrets as Record<string, string>;
    const phoneId = cfg.phone_number_id;
    const token = sec.access_token;
    if (!phoneId || !token) throw new Error("missing_credentials");

    const to = String(body.to).replace(/\D/g, "");
    const type = body.type || "text";
    let payload: Record<string, unknown> = { messaging_product: "whatsapp", to };

    if (type === "text") {
      payload = { ...payload, type: "text", text: { body: body.text || "" } };
    } else if (type === "template") {
      const t = body.template!;
      payload = {
        ...payload,
        type: "template",
        template: { name: t.name, language: { code: t.language }, components: t.components || [] },
      };
    } else if (type === "document") {
      payload = {
        ...payload,
        type: "document",
        document: { link: body.mediaUrl, filename: body.filename || "document.pdf", caption: body.caption },
      };
    } else if (type === "image") {
      payload = { ...payload, type: "image", image: { link: body.mediaUrl, caption: body.caption } };
    }

    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || "send_failed");

    return new Response(JSON.stringify({ ok: true, id: j.messages?.[0]?.id }), {
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
