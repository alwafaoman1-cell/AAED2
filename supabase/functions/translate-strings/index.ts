// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Multi-provider AI key resolver. Order: Lovable AI Gateway → OpenAI → Google Gemini.
// Allows self-hosted deployments (after migrating off Lovable Cloud) to keep AI working
// by setting OPENAI_API_KEY or GEMINI_API_KEY in their Supabase edge function secrets.
function pickAiProvider(): { url: string; key: string; model: string } | null {
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  if (lovable) return { url: "https://ai.gateway.lovable.dev/v1/chat/completions", key: lovable, model: "google/gemini-2.5-flash" };
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { url: "https://api.openai.com/v1/chat/completions", key: openai, model: "gpt-4o-mini" };
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: gemini, model: "gemini-2.0-flash" };
  return null;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Require authenticated caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { strings } = await req.json();
    if (!Array.isArray(strings) || strings.length === 0) {
      return new Response(JSON.stringify({ error: "strings[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Input limits to prevent quota abuse
    if (strings.length > 200) {
      return new Response(JSON.stringify({ error: "Too many strings (max 200)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const totalChars = strings.reduce((n: number, s: any) => n + (typeof s === "string" ? s.length : 0), 0);
    if (totalChars > 50000) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick a provider: Lovable AI (default in Lovable Cloud) → OpenAI → Gemini.
    // Self-hosted deployments can add OPENAI_API_KEY or GEMINI_API_KEY from Settings → AI Keys.
    const provider = pickAiProvider();
    if (!provider) {
      return new Response(JSON.stringify({ error: "No AI key configured. Add LOVABLE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt =
      "Translate each Arabic UI string to concise, professional English (workshop ERP context). " +
      "Return ONLY a JSON object mapping each Arabic string to its English translation. " +
      "Preserve placeholders like *, %, ..., parentheses, special chars. Keep proper nouns. " +
      "If a string contains both Arabic and English, only translate the Arabic.\n\n" +
      "Strings:\n" + JSON.stringify(strings);

    const r = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "You are a professional UI translator. Output strict JSON only, no markdown fences." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("translate-strings AI gateway error:", r.status, t);
      return new Response(JSON.stringify({ error: "Translation service error" }), {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    let content = (data.choices?.[0]?.message?.content || "").trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }
    let translations = {};
    try {
      translations = JSON.parse(content);
    } catch {
      translations = {};
    }

    return new Response(JSON.stringify({ translations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate-strings unhandled error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
