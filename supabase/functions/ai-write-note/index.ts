// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fallbackAiProvider(): { type: string; url: string; key: string; model: string } | null {
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

async function resolveAiProvider(admin: any, userId: string) {
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
  return fallbackAiProvider();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const instruction: string = (body?.instruction ?? "").toString().slice(0, 2000);
    const currentText: string = (body?.currentText ?? "").toString().slice(0, 5000);
    const context: string = (body?.context ?? "").toString().slice(0, 3000);
    const mode: string = (body?.mode ?? "generate").toString(); // generate | improve | summarize | translate
    const language: string = (body?.language ?? "ar").toString();
    const tone: string = (body?.tone ?? "professional").toString(); // professional | friendly | formal | concise

    if (!instruction && !currentText) {
      return new Response(JSON.stringify({ error: "instruction or currentText required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const provider = await resolveAiProvider(admin, userData.user.id);
    if (!provider) {
      return new Response(JSON.stringify({ error: "AI provider is not configured. Configure Settings → AI Keys." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const systemPrompt = `أنت مساعد كتابة محترف لورشة سيارات ومحاسبة وتأمين. اكتب ملاحظات وتعليقات واضحة ومختصرة بنبرة ${tone === "friendly" ? "ودودة" : tone === "formal" ? "رسمية" : tone === "concise" ? "مختصرة جداً" : "مهنية"} باللغة ${language === "ar" ? "العربية" : "الإنجليزية"}.
- اكتب نصاً جاهزاً للنسخ مباشرة بدون مقدمات أو شرح.
- لا تستخدم Markdown أو رموز خاصة.
- استخدم الأرقام اللاتينية (0-9) دائماً.
- إذا ذُكر سياق (سيارة/عميل/مبلغ) فادمجه طبيعياً في النص.`;

    let userPrompt = "";
    if (mode === "improve" && currentText) {
      userPrompt = `حسّن النص التالي وأعد صياغته:\n${currentText}${instruction ? `\n\nتوجيه إضافي: ${instruction}` : ""}${context ? `\n\nالسياق: ${context}` : ""}`;
    } else if (mode === "summarize" && currentText) {
      userPrompt = `لخّص ما يلي في 2-3 جمل:\n${currentText}`;
    } else if (mode === "translate" && currentText) {
      userPrompt = `ترجم النص التالي إلى ${language === "ar" ? "العربية" : "الإنجليزية"}:\n${currentText}`;
    } else {
      userPrompt = `اكتب ملاحظة/تعليق وفق التوجيه التالي:\n${instruction}${context ? `\n\nالسياق: ${context}` : ""}${currentText ? `\n\nالنص الحالي للاستئناس: ${currentText}` : ""}`;
    }

    const resp = provider.type === "anthropic"
      ? await fetch(provider.url, {
          method: "POST",
          headers: { "x-api-key": provider.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            max_tokens: 800,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            temperature: 0.7,
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
            temperature: 0.7,
          }),
        });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: "AI provider error", details: text }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const out = provider.type === "anthropic"
      ? (data?.content?.[0]?.text ?? "").toString().trim()
      : (data?.choices?.[0]?.message?.content ?? "").toString().trim();

    return new Response(JSON.stringify({ text: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
