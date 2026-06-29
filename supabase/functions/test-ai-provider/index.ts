// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = ["openai", "gemini", "anthropic", "custom"] as const;

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAdmin(profile: any) {
  return ["admin", "owner", "super_admin"].includes(String(profile?.role || "")) || !!profile?.is_platform_admin;
}

function endpoint(provider: string, config: any) {
  if (provider === "openai") return { url: "https://api.openai.com/v1/chat/completions", model: config.model || "gpt-4o-mini" };
  if (provider === "gemini") return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: config.model || "gemini-2.0-flash" };
  if (provider === "anthropic") return { url: "https://api.anthropic.com/v1/messages", model: config.model || "claude-3-5-haiku-latest" };
  return { url: config.base_url, model: config.model };
}

async function testProvider(provider: string, apiKey: string, config: any) {
  const ep = endpoint(provider, config);
  if (!ep.url || !ep.model) throw new Error("ai_provider_not_configured");

  if (provider === "anthropic") {
    const r = await fetch(ep.url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ep.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.slice(0, 500) || `ai_test_failed_${r.status}`);
    return;
  }

  const r = await fetch(ep.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ep.model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 16,
      temperature: 0,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text.slice(0, 500) || `ai_test_failed_${r.status}`);
}

async function audit(admin: any, payload: Record<string, unknown>) {
  await admin.from("security_otp_audit_log").insert(payload).catch?.(() => undefined);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id,role,is_platform_admin")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ ok: false, error: "tenant_not_found" }, 400);
    if (!isAdmin(profile)) return json({ ok: false, error: "owner_or_super_admin_required" }, 403);

    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider || "");
    if (!PROVIDERS.includes(provider as any)) return json({ ok: false, status: "Failed", error: "unsupported_ai_provider" }, 200);

    const { data: row } = await admin
      .from("tenant_integrations")
      .select("id,config,secrets,enabled")
      .eq("tenant_id", profile.tenant_id)
      .eq("provider", `ai_${provider}`)
      .maybeSingle();
    const apiKey = row?.secrets?.api_key;
    if (!row || !apiKey) return json({ ok: false, status: "Not Configured", error: "ai_provider_not_configured" }, 200);

    try {
      await testProvider(provider, apiKey, row.config || {});
      await admin.from("tenant_integrations").update({
        status: "connected",
        last_test_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", row.id);
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "ai_provider_test",
        event: "ai provider tested",
        status: "success",
        details: { provider },
      });
      return json({ ok: true, status: "Connected" });
    } catch (error) {
      const message = String(error?.message || error || "ai_test_failed");
      await admin.from("tenant_integrations").update({
        status: "failed",
        last_test_at: new Date().toISOString(),
        last_error: message,
      }).eq("id", row.id);
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "ai_provider_test",
        event: "ai provider tested",
        status: "failed",
        details: { provider, error: message },
      });
      return json({ ok: false, status: "Failed", error: message, message });
    }
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    return json({ ok: false, status: "Failed", error: code, message: code }, 200);
  }
});
