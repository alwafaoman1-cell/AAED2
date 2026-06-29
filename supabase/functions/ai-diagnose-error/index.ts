// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fallbackProvider() {
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  if (lovable) return { type: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", key: lovable, model: "google/gemini-2.5-flash" };
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { type: "openai", url: "https://api.openai.com/v1/chat/completions", key: openai, model: "gpt-4o-mini" };
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) return { type: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: gemini, model: "gemini-2.0-flash" };
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropic) return { type: "anthropic", url: "https://api.anthropic.com/v1/messages", key: anthropic, model: "claude-3-5-haiku-latest" };
  return null;
}

async function resolveProvider(admin: any, userId: string) {
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.tenant_id) {
    const { data: row } = await admin
      .from("tenant_integrations")
      .select("provider,config,secrets,enabled")
      .eq("tenant_id", profile.tenant_id)
      .in("provider", ["ai_openai", "ai_gemini", "ai_anthropic", "ai_custom"])
      .eq("enabled", true)
      .maybeSingle();
    const provider = String(row?.provider || "").replace(/^ai_/, "");
    const config = row?.config || {};
    const apiKey = row?.secrets?.api_key;
    if (row?.enabled && apiKey) {
      if (provider === "openai") return { type: provider, url: "https://api.openai.com/v1/chat/completions", key: apiKey, model: config.model || "gpt-4o-mini" };
      if (provider === "gemini") return { type: provider, url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: apiKey, model: config.model || "gemini-2.0-flash" };
      if (provider === "anthropic") return { type: provider, url: "https://api.anthropic.com/v1/messages", key: apiKey, model: config.model || "claude-3-5-haiku-latest" };
      if (provider === "custom" && config.base_url) return { type: provider, url: config.base_url, key: apiKey, model: config.model };
    }
  }
  return fallbackProvider();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // --- JWT validation ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const errorText: string = (body?.errorText ?? "").toString().slice(0, 8000);
    const stack: string = (body?.stack ?? "").toString().slice(0, 4000);
    const url: string = (body?.url ?? "").toString().slice(0, 500);
    const userContext: string = (body?.context ?? "").toString().slice(0, 2000);
    if (!errorText && !stack) {
      return new Response(JSON.stringify({ error: "errorText or stack required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = await resolveProvider(admin, userData.user.id);
    if (!provider) {
      return new Response(JSON.stringify({ error: "AI provider is not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `أنت مهندس برمجيات خبير في React + TypeScript + Vite + Supabase.
حلّل الخطأ المُعطى وأرجع JSON فقط بالشكل التالي:
{
  "summary": "وصف موجز للخطأ بالعربية (سطر واحد)",
  "rootCause": "السبب الجذري المحتمل",
  "severity": "low|medium|high|critical",
  "category": "ui|data|auth|network|build|runtime|database|other",
  "likelyFiles": ["مسارات الملفات المحتملة"],
  "fixSteps": ["خطوة 1", "خطوة 2", "..."],
  "lovablePrompt": "نص جاهز للنسخ يُعطى لـ Lovable لإصلاح المشكلة تلقائياً، بالعربية، مفصّل وواضح"
}
لا تكتب أي شيء خارج JSON.`;

    const userPrompt = `الخطأ:\n${errorText}\n\nStack:\n${stack}\n\nURL: ${url}\n\nسياق إضافي من المستخدم:\n${userContext}`;

    const resp = provider.type === "anthropic"
      ? await fetch(provider.url, {
          method: "POST",
          headers: { "x-api-key": provider.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            max_tokens: 1200,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        })
      : await fetch(provider.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: "AI gateway error", details: t }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const raw = provider.type === "anthropic"
      ? (data?.content?.[0]?.text ?? "{}").toString()
      : (data?.choices?.[0]?.message?.content ?? "{}").toString();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { summary: raw }; }
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-diagnose-error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
