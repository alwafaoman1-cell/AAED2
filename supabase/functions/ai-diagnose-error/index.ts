// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY غير مهيأ" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
    const raw = (data?.choices?.[0]?.message?.content ?? "{}").toString();
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
