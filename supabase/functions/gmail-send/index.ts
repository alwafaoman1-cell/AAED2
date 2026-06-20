// إرسال بريد عبر Gmail API (OAuth refresh_token لكل tenant)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: { filename: string; mimeType: string; base64: string }[];
}

function buildMime(from: string, b: Body): string {
  const boundary = `bd_${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [];
  parts.push(`From: ${from}`);
  parts.push(`To: ${b.to}`);
  parts.push(`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(b.subject)))}?=`);
  parts.push("MIME-Version: 1.0");
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  parts.push("");
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/html; charset=UTF-8`);
  parts.push("Content-Transfer-Encoding: base64");
  parts.push("");
  parts.push(btoa(unescape(encodeURIComponent(b.html || b.text || ""))));
  for (const a of b.attachments || []) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
    parts.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(a.base64);
  }
  parts.push(`--${boundary}--`);
  return parts.join("\r\n");
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
    if (!body.to || !body.subject) throw new Error("to_subject_required");

    const { data: integ, error } = await supabase
      .from("tenant_integrations")
      .select("config, secrets, enabled")
      .eq("provider", "gmail")
      .maybeSingle();
    if (error) throw error;
    if (!integ || !integ.enabled) throw new Error("integration_disabled");
    const cfg = integ.config as Record<string, string>;
    const sec = integ.secrets as Record<string, string>;
    if (!cfg.client_id || !sec.client_secret || !sec.refresh_token) throw new Error("missing_credentials");

    // 1) refresh access token
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: sec.client_secret,
        refresh_token: sec.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tj = await tr.json();
    if (!tr.ok || !tj.access_token) throw new Error(tj.error_description || "refresh_failed");

    // 2) send
    const mime = buildMime(cfg.from_email || "me", body);
    const raw = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const sj = await sr.json();
    if (!sr.ok) throw new Error(sj.error?.message || "send_failed");

    return new Response(JSON.stringify({ ok: true, id: sj.id }), {
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
