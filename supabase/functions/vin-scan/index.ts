// Edge function: VIN OCR via Lovable AI Gateway (Gemini vision)
// Accepts { imageBase64: string } => returns { vin?: string, year?: string, raw?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Multi-provider AI key resolver. Order: Lovable AI Gateway → OpenAI → Google Gemini.
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
    // Require an authenticated user to prevent AI credit abuse
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageBase64 } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Cap payload size (~1.5MB decoded) to prevent AI credit abuse / DoS
    const MAX_B64_LEN = 2_000_000;
    if (imageBase64.length > MAX_B64_LEN) {
      return new Response(
        JSON.stringify({ error: "Image too large (max ~1.5MB)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Validate base64 / data-URL shape
    const b64Body = imageBase64.startsWith("data:")
      ? imageBase64.split(",")[1] || ""
      : imageBase64;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64Body)) {
      return new Response(
        JSON.stringify({ error: "Invalid base64 image data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }




    const provider = pickAiProvider();
    if (!provider) {
      return new Response(JSON.stringify({ error: "No AI key configured. Add LOVABLE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure data URL
    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const resp = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: "system",
            content:
              "You are an OCR engine specialized in reading vehicle VIN (chassis) numbers and manufacturing year from photos of VIN plates, dashboards, registration cards, or stickers. Return ONLY a strict JSON object with keys: vin (17-char alphanumeric without I/O/Q, or empty), year (4-digit year between 1980 and current year+1, or empty). No prose, no markdown.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the VIN and the model year from this image. Respond as JSON only." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI request failed", details: txt }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";

    let vin = "";
    let year = "";
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        vin = String(parsed.vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
        year = String(parsed.year || "").replace(/[^0-9]/g, "").slice(0, 4);
      }
    } catch (_) {
      // fallback regex on raw text
      const vinMatch = raw.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
      if (vinMatch) vin = vinMatch[0];
      const yMatch = raw.match(/\b(19[89]\d|20[0-4]\d)\b/);
      if (yMatch) year = yMatch[0];
    }

    return new Response(JSON.stringify({ vin, year, raw }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
