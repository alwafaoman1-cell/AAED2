// Edge function: AI-powered data extraction from images (and rasterized PDFs).
// Accepts an image (base64) + a preset schema and returns structured JSON
// using vision + tool-calling. Supports multiple AI providers (Lovable / OpenAI / Gemini).
// @ts-nocheck

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ───────── Provider resolver ─────────
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

async function resolveProvider(admin: any, tenantId: string | null) {
  if (tenantId) {
    const { data: row } = await admin
      .from("tenant_integrations")
      .select("provider,config,secrets,enabled")
      .eq("tenant_id", tenantId)
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

// ───────── Schemas / Tool definitions ─────────
// Each preset = a tool function description + JSON schema for structured extraction.
const SCHEMAS: Record<string, { description: string; system: string; parameters: any }> = {
  vehicle_customer: {
    description: "Extract vehicle and customer/owner data from a vehicle registration card (مَلكية / استمارة), driver license, insurance certificate, or any vehicle document.",
    system: "You are a data-extraction engine for an auto-workshop. Read the document image carefully (it may be Arabic, English, or both). Extract ONLY what you see — if a field is missing, return empty string. Plate numbers stay in original characters. Year is 4 digits. Phone uses local Oman/GCC digit format.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "اسم العميل/المالك" },
        customer_phone: { type: "string", description: "رقم الجوال إن وجد" },
        plate: { type: "string", description: "رقم اللوحة" },
        make: { type: "string", description: "ماركة السيارة (مثل Toyota, Nissan)" },
        model: { type: "string", description: "موديل السيارة" },
        year: { type: "string", description: "سنة الصنع (4 أرقام)" },
        color: { type: "string", description: "لون السيارة بالعربية" },
        vin: { type: "string", description: "رقم الهيكل VIN (17 خانة)" },
        mileage: { type: "string", description: "قراءة العداد إن ظهرت" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  insurance_claim: {
    description: "Extract insurance claim data from a claim document, repair estimate, accident report, police report, or insurance approval letter.",
    system: "You are a data-extraction engine for an auto-workshop in Oman. The document may be Arabic or English. Extract claim fields, vehicle, owner, and damage description.",
    parameters: {
      type: "object",
      properties: {
        insurance_company: { type: "string", description: "اسم شركة التأمين" },
        claim_number: { type: "string", description: "رقم المطالبة/البلاغ" },
        owner_name: { type: "string", description: "اسم صاحب السيارة" },
        owner_phone: { type: "string", description: "رقم جوال المالك" },
        plate: { type: "string" },
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "string" },
        color: { type: "string" },
        vin: { type: "string" },
        incident_date: { type: "string", description: "تاريخ الحادث (YYYY-MM-DD) إن وُجد" },
        damage_description: { type: "string", description: "وصف الأضرار باختصار" },
        estimated_cost: { type: "string", description: "المبلغ المعتمد أو المقدّر (أرقام فقط)" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  estimate_document: {
    description: "Extract structured repair estimate / quotation data from an image or PDF. It may be Arabic, English, or bilingual.",
    system: [
      "You are a strict data-extraction engine for an Oman automotive workshop.",
      "Extract only values visible in the document. Do not invent missing data.",
      "The document may be a repair estimate, insurance estimate, parts quotation, inspection report, claim document, or invoice.",
      "All money values are VAT exclusive unless the document explicitly separates VAT.",
      "Return OMR amounts as plain numbers with dot decimal separators.",
      "If line items are visible, return items_json as a JSON array of objects with category, description, quantity, unit_price, and line_total.",
      "Valid categories are labor, parts, paint_materials, mechanical, electrical, programming, diagnosis, sublet, transport, other.",
      "If VAT is visible, return vat_detected as true and include vat_rate, vat_amount, subtotal, and total when available.",
      "Never decide whether to apply VAT; only report what is visible.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        estimate_number: { type: "string" },
        estimate_date: { type: "string", description: "YYYY-MM-DD if visible" },
        document_type: { type: "string" },
        currency: { type: "string" },
        valid_until: { type: "string", description: "YYYY-MM-DD if visible" },
        customer_name: { type: "string" },
        customer_phone: { type: "string" },
        customer_email: { type: "string" },
        customer_code: { type: "string" },
        vehicle_make: { type: "string" },
        vehicle_model: { type: "string" },
        vehicle_year: { type: "string" },
        plate_number: { type: "string" },
        plate_letters: { type: "string" },
        vin: { type: "string" },
        color: { type: "string" },
        insurance_company: { type: "string" },
        claim_number: { type: "string" },
        policy_number: { type: "string" },
        surveyor: { type: "string" },
        insurance_employee: { type: "string" },
        subtotal: { type: "string" },
        vat_detected: { type: "string", description: "true or false" },
        vat_rate: { type: "string" },
        vat_amount: { type: "string" },
        total: { type: "string" },
        accident_description: { type: "string" },
        visible_damage: { type: "string" },
        hidden_damage: { type: "string" },
        parts_notes: { type: "string" },
        general_notes: { type: "string" },
        terms: { type: "string" },
        items_json: {
          type: "string",
          description: "JSON array string. Example: [{\"category\":\"labor\",\"description\":\"Front bumper repair\",\"quantity\":1,\"unit_price\":50,\"line_total\":50}]",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  expense_receipt: {
    description: "Extract data from an expense receipt or purchase invoice (فاتورة مصروف/شراء).",
    system: "You are a bookkeeping data-extraction engine. The receipt may be Arabic or English.",
    parameters: {
      type: "object",
      properties: {
        vendor: { type: "string", description: "اسم المورد/المتجر" },
        date: { type: "string", description: "التاريخ (YYYY-MM-DD)" },
        total: { type: "string", description: "الإجمالي بعد الضريبة (أرقام)" },
        vat_amount: { type: "string", description: "قيمة الضريبة فقط" },
        currency: { type: "string", description: "العملة (OMR/SAR/AED…)" },
        invoice_number: { type: "string" },
        category: { type: "string", description: "تصنيف مقترح: قطع غيار/وقود/كهرباء/إيجار/أخرى" },
        notes: { type: "string", description: "ملاحظات قصيرة عن البنود" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  spare_part: {
    description: "Extract spare-part data from a part label, box sticker, or supplier invoice line.",
    system: "You are a parts-catalog data-extraction engine.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "اسم القطعة" },
        part_number: { type: "string", description: "رقم القطعة OEM" },
        brand: { type: "string", description: "العلامة التجارية/المصنع" },
        fits: { type: "string", description: "السيارات/الموديلات التي تناسبها" },
        price: { type: "string", description: "السعر إن وجد" },
        barcode: { type: "string", description: "الباركود/EAN" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  delivery_receipt: {
    description: "Extract vehicle delivery/handover info from a delivery receipt, customer satisfaction form, ID card (front or back), passport, driving licence, or any handover acknowledgment document — Arabic or English.",
    system: [
      "You are a data-extraction engine for an auto-workshop in Oman.",
      "You will receive ONE OR MORE images (pages, or front/back of an ID card).",
      "SCAN EVERY PAGE/IMAGE carefully. The receiver name and ID number can appear on any page, in Arabic OR English (or both).",
      "Receiver name labels include but are not limited to: 'اسم المستلم', 'الاسم', 'اسم العميل', 'اسم المالك', 'اسم السائق', 'المُستلِم', 'Name', 'Full Name', 'Receiver', 'Customer Name', 'Owner Name', 'Holder'.",
      "ID number labels include: 'رقم الهوية', 'الرقم المدني', 'رقم البطاقة', 'رقم البطاقة الشخصية', 'رقم جواز السفر', 'رقم الرخصة', 'Civil No', 'Civil Number', 'ID No', 'ID Number', 'Passport No', 'Licence No', 'License No', 'National ID'.",
      "Omani Civil ID is typically 8 digits; GCC IDs can be 9-11 digits; passports are alphanumeric. Return digits only when it's purely numeric; otherwise keep the original characters.",
      "Prefer the printed full name over a signature. If both Arabic and English names exist, return the Arabic one.",
      "Return dates as YYYY-MM-DD. If a field truly does not appear anywhere, return empty string. Do not invent data.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        receiver_name: { type: "string", description: "اسم المستلم الكامل (عربي مفضّل، أو إنجليزي إذا لم يتوفر العربي)" },
        receiver_id_number: { type: "string", description: "رقم هوية/بطاقة/جواز/رخصة المستلم" },
        delivered_at: { type: "string", description: "تاريخ التسليم YYYY-MM-DD" },
        delivery_notes: { type: "string", description: "ملاحظات/حالة المركبة عند التسليم" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  diagnostic_report: {
    description: "Analyze an automotive computer diagnostic report and extract fault codes, problem descriptions, and severity only.",
    system: [
      "You analyze automotive computer diagnostic reports for a professional workshop.",
      "Extract only fault codes and problems explicitly supported by the report.",
      "Classify severity as low, medium, high, or critical.",
      "Do not provide repair instructions, procedures, parts recommendations, or troubleshooting steps.",
      "The report can be Arabic or English. Keep fault codes exactly as printed.",
      "If a value is not visible, return an empty string. Never invent a code or diagnosis.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        fault_codes: { type: "string", description: "Comma-separated diagnostic trouble codes exactly as printed" },
        problems: { type: "string", description: "Concise problem descriptions only, one per line, without repair advice" },
        severity: { type: "string", description: "Overall severity: low, medium, high, or critical" },
        summary: { type: "string", description: "Short factual summary of the report without repair instructions" },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" });
    }

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Validate the JWT against Supabase Auth (header presence alone is not enough).
    let tenantId: string | null = null;
    let admin: any = null;
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
      admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: userData } = await sb.auth.getUser();
      if (!userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: resolvedTenantId } = await sb.rpc("get_user_tenant_id");
      tenantId = resolvedTenantId;
      const { data: aiFeature } = await sb.from("tenant_features")
        .select("enabled")
        .eq("tenant_id", tenantId)
        .eq("feature_key", "ai_assistant")
        .maybeSingle();
      if (aiFeature?.enabled === false) {
        return new Response(JSON.stringify({ error: "AI feature is disabled for this workshop" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (_) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageBase64, mimeType, schema, images } = await req.json();

    // Build a normalized list of pages (1..N). Backwards-compatible with single image.
    type Page = { b64: string; mime: string };
    const pages: Page[] = Array.isArray(images) && images.length > 0
      ? images
          .filter((p: any) => p && typeof p.b64 === "string")
          .map((p: any) => ({ b64: p.b64, mime: p.mime || "image/jpeg" }))
      : (typeof imageBase64 === "string" && imageBase64.length > 0
          ? [{ b64: imageBase64, mime: mimeType || "image/jpeg" }]
          : []);

    if (pages.length === 0) {
      return json({ ok: false, error: "imageBase64 or images required" });
    }
    const preset = SCHEMAS[schema];
    if (!preset) {
      return json({ ok: false, error: `Unknown schema. Use one of: ${Object.keys(SCHEMAS).join(", ")}` });
    }

    // Cap total payload (~ 24 MB raw base64 across all pages) to protect the model.
    const MAX_PAGES = 8;
    const safePages = pages.slice(0, MAX_PAGES);
    const totalSize = safePages.reduce((s, p) => s + p.b64.length, 0);
    if (totalSize > 33_000_000) {
      return json({ ok: false, error: "Pages too large in total (max ~24MB)" });
    }

    const provider = await resolveProvider(admin, tenantId);
    if (!provider) {
      return json({ ok: false, error: "AI provider is not configured" });
    }

    const toDataUrl = (p: Page) =>
      p.b64.startsWith("data:") ? p.b64 : `data:${p.mime};base64,${p.b64}`;

    const userContent: any[] = [
      {
        type: "text",
        text: safePages.length > 1
          ? `You are given ${safePages.length} page/image(s) from the same document. Scan ALL of them (Arabic and English). Call the function with the data you can see. Leave unknown fields as empty strings.`
          : `Read this document image and call the function with the data you can see. Leave unknown fields as empty strings.`,
      },
      ...safePages.map((p) => ({ type: "image_url", image_url: { url: toDataUrl(p) } })),
    ];

    const openAiBody = {
      model: provider.model,
      messages: [
        { role: "system", content: preset.system },
        { role: "user", content: userContent },
      ],
      tools: [{
        type: "function",
        function: { name: "extract", description: preset.description, parameters: preset.parameters },
      }],
      tool_choice: { type: "function", function: { name: "extract" } },
      temperature: 0,
    };

    const resp = provider.type === "anthropic"
      ? await fetch(provider.url, {
          method: "POST",
          headers: {
            "x-api-key": provider.key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.model,
            max_tokens: 1200,
            system: preset.system,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: userContent[0].text },
                ...safePages.map((p) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: p.mime || "image/jpeg",
                    data: p.b64.replace(/^data:[^;]+;base64,/, ""),
                  },
                })),
              ],
            }],
            tools: [{
              name: "extract",
              description: preset.description,
              input_schema: preset.parameters,
            }],
            tool_choice: { type: "tool", name: "extract" },
            temperature: 0,
          }),
        })
      : await fetch(provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(openAiBody),
        });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("ai-extract-data error:", resp.status, txt);
      if (resp.status === 429) {
        return json({ ok: false, error: "Rate limit exceeded, try again shortly" });
      }
      if (resp.status === 402) {
        return json({ ok: false, error: "AI credits exhausted" });
      }
      return json({ ok: false, error: "AI request failed", details: txt });
    }

    const data = await resp.json();
    const choice = data?.choices?.[0]?.message;
    const anthropicTool = Array.isArray(data?.content) ? data.content.find((c: any) => c?.type === "tool_use") : null;
    const toolCall = choice?.tool_calls?.[0];
    let extracted: Record<string, string> = {};

    if (anthropicTool?.input) {
      extracted = anthropicTool.input;
    } else if (toolCall?.function?.arguments) {
      try {
        extracted = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Failed to parse tool args:", e, toolCall.function.arguments);
      }
    } else if (choice?.content) {
      // Some providers may return JSON content directly without tools
      try {
        const cleaned = String(choice.content).replace(/```json|```/g, "").trim();
        extracted = JSON.parse(cleaned);
      } catch { /* ignore */ }
    }

    return json({ ok: true, data: extracted });
  } catch (e) {
    console.error("ai-extract-data exception:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
  }
});
