// @ts-nocheck
// ينشئ طلب موافقة ويعيد الرابط — الإرسال الفعلي يحصل من العميل
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: authErr } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (authErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const userId = claims.claims.sub;

  try {
    const body = await req.json();
    const { job_order_id, supplement_ids, customer_name, customer_phone, app_origin } = body || {};
    if (!job_order_id || !Array.isArray(supplement_ids) || supplement_ids.length === 0) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: prof } = await svc.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
    if (!prof?.tenant_id) {
      return new Response(JSON.stringify({ error: "no_tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = generateToken();
    const { data: req_row, error: insErr } = await svc.from("supplement_approval_requests").insert({
      tenant_id: prof.tenant_id,
      job_order_id,
      token,
      supplement_ids,
      customer_name_snapshot: customer_name ?? null,
      customer_phone_snapshot: customer_phone ?? null,
      created_by: userId,
    }).select().single();
    if (insErr) throw insErr;

    const link = `${app_origin || ""}/c/approve/${token}`;

    await svc.from("supplement_audit_logs").insert({
      tenant_id: prof.tenant_id,
      job_order_id,
      request_id: req_row.id,
      action: "link_created",
      actor: "staff",
      user_id: userId,
      details: { supplement_ids, link_sent_to: customer_phone ?? null },
    });

    return new Response(JSON.stringify({ ok: true, token, link, request_id: req_row.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
