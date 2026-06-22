// إرسال رسالة WhatsApp عبر Meta Cloud API (نص أو قالب أو media)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  to: string;                  // E.164 رقم بدون +
  type?: "text" | "template" | "document" | "image";
  text?: string;
  template?: { name: string; language: string; components?: unknown[] };
  mediaUrl?: string;
  filename?: string;
  caption?: string;
  customerId?: string;
  vehicleId?: string;
  insuranceClaimId?: string;
  jobOrderId?: string;
  recipientName?: string;
  recipientType?: "customer" | "supplier" | "insurance" | "other";
  messageKind?: string;
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
    if (!body.to) throw new Error("to_required");
    const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
    if (tenantError || !tenantId) throw new Error("tenant_not_found");

    let jobOrderId = body.jobOrderId || null;
    let customerId = body.customerId || null;
    let vehicleId = body.vehicleId || null;
    let insuranceClaimId = body.insuranceClaimId || null;
    if (jobOrderId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobOrderId);
      const orderQuery = supabase.from("job_orders")
        .select("id,customer_id,vehicle_id,insurance_claim_number")
        .eq("tenant_id", tenantId);
      const { data: orderRow } = isUuid
        ? await orderQuery.eq("id", jobOrderId).maybeSingle()
        : await orderQuery.eq("order_number", jobOrderId).maybeSingle();
      if (orderRow) {
        jobOrderId = orderRow.id;
        customerId ||= orderRow.customer_id;
        vehicleId ||= orderRow.vehicle_id;
        if (!insuranceClaimId && orderRow.insurance_claim_number) {
          const { data: claimRow } = await supabase.from("insurance_claims").select("id")
            .eq("tenant_id", tenantId)
            .eq("claim_number", orderRow.insurance_claim_number)
            .maybeSingle();
          insuranceClaimId = claimRow?.id || null;
        }
      } else {
        jobOrderId = null;
      }
    }

    const { data: integ, error } = await supabase
      .from("tenant_integrations")
      .select("config, secrets, enabled")
      .eq("provider", "meta_whatsapp")
      .maybeSingle();
    if (error) throw error;
    if (!integ || !integ.enabled) throw new Error("integration_disabled");

    const cfg = integ.config as Record<string, string>;
    const sec = integ.secrets as Record<string, string>;
    const phoneId = cfg.phone_number_id;
    const token = sec.access_token;
    if (!phoneId || !token) throw new Error("missing_credentials");

    const to = String(body.to).replace(/\D/g, "");
    const type = body.type || "text";
    const messageBody = type === "text"
      ? (body.text || "")
      : (body.caption || body.filename || body.template?.name || "");

    const { data: logRow, error: logError } = await supabase
      .from("whatsapp_logs")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        insurance_claim_id: insuranceClaimId,
        job_order_id: jobOrderId,
        recipient_type: body.recipientType || "customer",
        recipient_name: body.recipientName || null,
        recipient_phone: to,
        message_kind: body.messageKind || type,
        message_body: messageBody,
        media_url: body.mediaUrl || null,
        status: "pending",
        sent_by: userData.user.id,
      })
      .select("id")
      .single();
    if (logError) throw logError;
    let payload: Record<string, unknown> = { messaging_product: "whatsapp", to };

    if (type === "text") {
      payload = { ...payload, type: "text", text: { body: body.text || "" } };
    } else if (type === "template") {
      const t = body.template!;
      payload = {
        ...payload,
        type: "template",
        template: { name: t.name, language: { code: t.language }, components: t.components || [] },
      };
    } else if (type === "document") {
      payload = {
        ...payload,
        type: "document",
        document: { link: body.mediaUrl, filename: body.filename || "document.pdf", caption: body.caption },
      };
    } else if (type === "image") {
      payload = { ...payload, type: "image", image: { link: body.mediaUrl, caption: body.caption } };
    }

    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) {
      const sendError = j.error?.message || "send_failed";
      await supabase.from("whatsapp_logs").update({
        status: "failed",
        error_message: sendError,
        updated_at: new Date().toISOString(),
      }).eq("id", logRow.id);
      throw new Error(sendError);
    }

    const providerMessageId = j.messages?.[0]?.id || null;
    await supabase.from("whatsapp_logs").update({
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return new Response(JSON.stringify({ ok: true, id: providerMessageId, logId: logRow.id }), {
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
