// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = ["openai", "gemini", "anthropic", "custom", "ollama"] as const;
const GEMINI_FREE_VISION_MODEL = "gemini-3-flash-preview";
const TEST_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  if (provider === "gemini") return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: config.model || GEMINI_FREE_VISION_MODEL };
  if (provider === "anthropic") return { url: "https://api.anthropic.com/v1/messages", model: config.model || "claude-3-5-haiku-latest" };
  if (provider === "ollama") {
    const base = String(config.base_url || (config.connection_type === "local" ? "http://localhost:11434" : "https://ollama.com")).replace(/\/+$/, "");
    const apiBase = base.endsWith("/api") ? base : `${base}/api`;
    return { url: `${apiBase}/chat`, model: config.model || "llama3.2-vision" };
  }
  return { url: config.base_url, model: config.model };
}

async function testVisionProvider(provider: string, apiKey: string, config: any) {
  const ep = endpoint(provider, config);
  if (!ep.url || !ep.model) throw new Error("ai_provider_not_configured");

  if (provider === "ollama") {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch(ep.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ep.model,
        stream: false,
        format: "json",
        messages: [{
          role: "user",
          content: "This is a tiny test image. Return JSON only: {\"vision_ok\":\"yes\"}.",
          images: [TEST_IMAGE_DATA_URL.split(",")[1]],
        }],
      }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.slice(0, 500) || `vision_test_failed_${r.status}`);
    if (!text.toLowerCase().includes("vision_ok") && !text.toLowerCase().includes("yes")) throw new Error("vision_test_invalid_response");
    return;
  }

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
        max_tokens: 64,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "This is a tiny test image. Return JSON only: {\"vision_ok\":\"yes\"}." },
            { type: "image", source: { type: "base64", media_type: "image/png", data: TEST_IMAGE_DATA_URL.split(",")[1] } },
          ],
        }],
      }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text.slice(0, 500) || `vision_test_failed_${r.status}`);
    if (!text.toLowerCase().includes("vision_ok") && !text.toLowerCase().includes("yes")) throw new Error("vision_test_invalid_response");
    return;
  }

  const r = await fetch(ep.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ep.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "This is a tiny test image. Return JSON only: {\"vision_ok\":\"yes\"}." },
          { type: "image_url", image_url: { url: TEST_IMAGE_DATA_URL } },
        ],
      }],
      max_tokens: 64,
      temperature: 0,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text.slice(0, 500) || `vision_test_failed_${r.status}`);
  if (!text.toLowerCase().includes("vision_ok") && !text.toLowerCase().includes("yes")) throw new Error("vision_test_invalid_response");
}

async function testProvider(provider: string, apiKey: string, config: any) {
  const ep = endpoint(provider, config);
  if (!ep.url || !ep.model) throw new Error("ai_provider_not_configured");

  if (provider === "ollama") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), Math.max(5000, Math.min(180000, Number(config.request_timeout_ms || 45000))));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const r = await fetch(ep.url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: ep.model,
          messages: [{ role: "user", content: "Reply with OK." }],
          stream: false,
        }),
      });
      const text = await r.text();
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) throw new Error("Invalid API key");
        if (r.status === 404) throw new Error("Model not found");
        throw new Error(text.slice(0, 500) || `ollama_test_failed_${r.status}`);
      }
      const data = JSON.parse(text || "{}");
      const content = data?.message?.content || data?.response || "";
      if (!content) throw new Error("Invalid Ollama response");
      return;
    } catch (e) {
      if (String(e?.message || e).toLowerCase().includes("abort")) throw new Error("Request timeout");
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

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

function isMissingColumnError(error: any) {
  const text = String(error?.message || error?.details || error?.hint || error || "").toLowerCase();
  return text.includes("schema cache") || text.includes("could not find") || text.includes("column");
}

async function updateTestStatus(admin: any, id: string, payload: Record<string, unknown>) {
  const result = await admin.from("tenant_integrations").update(payload).eq("id", id);
  if (!result.error || isMissingColumnError(result.error)) return;
  throw result.error;
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
    const testType = String(body.testType || "connection");
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
      if (testType === "vision") {
        await testVisionProvider(provider, apiKey, row.config || {});
      } else {
        await testProvider(provider, apiKey, row.config || {});
      }
      await updateTestStatus(admin, row.id, {
        last_test_status: testType === "vision" ? "vision_connected" : "connected",
        last_test_at: new Date().toISOString(),
        last_test_error: null,
      });
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "ai_provider_test",
        event: "ai provider tested",
        status: "success",
        details: { provider, testType },
      });
      return json({ ok: true, status: testType === "vision" ? "Vision Connected" : "Connected" });
    } catch (error) {
      const message = String(error?.message || error || "ai_test_failed");
      await updateTestStatus(admin, row.id, {
        last_test_status: "failed",
        last_test_at: new Date().toISOString(),
        last_test_error: message,
      });
      await audit(admin, {
        tenant_id: profile.tenant_id,
        user_id: userData.user.id,
        action: "ai_provider_test",
        event: "ai provider tested",
        last_test_status: "failed",
        details: { provider, testType, error: message },
      });
      return json({ ok: false, status: "Failed", error: message, message });
    }
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    return json({ ok: false, status: "Failed", error: code, message: code }, 200);
  }
});
