// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

function digits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function resendFrom(config: Record<string, string>) {
  const email = config.from_email;
  const name = config.from_name || "AAED2";
  return name ? `${name} <${email}>` : email;
}

async function resolveEmailProvider(admin: any, tenantId: string) {
  const { data: row } = await admin
    .from("tenant_integrations")
    .select("config,secrets,enabled")
    .eq("tenant_id", tenantId)
    .eq("provider", "resend_email")
    .eq("enabled", true)
    .maybeSingle();
  const config = row?.config || {};
  const secrets = row?.secrets || {};
  if (row?.enabled && secrets.api_key && config.from_email) {
    return { apiKey: secrets.api_key, from: resendFrom(config), source: "tenant" };
  }
  const fallbackKey = Deno.env.get("RESEND_API_KEY");
  if (fallbackKey) {
    return { apiKey: fallbackKey, from: Deno.env.get("SECURITY_EMAIL_FROM") || "AAED2 <security@aaed.app>", source: "fallback" };
  }
  return null;
}

async function sendEmail(provider: any, to: string, subject: string, body: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: provider.from, to, subject, text: body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `resend_failed_${response.status}`);
  return payload;
}

async function insertLog(admin: any, payload: Record<string, unknown>) {
  const { data, error } = await admin.from("message_logs").insert(payload).select("id").single();
  if (error) throw error;
  return data?.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("tenant_id").eq("user_id", userData.user.id).maybeSingle();
    if (!profile?.tenant_id) return json({ ok: false, error: "tenant_not_found" }, 200);

    const body = await req.json().catch(() => ({}));
    const channel = String(body.channel || "");
    const templateType = String(body.template_type || body.templateType || "general");
    const messageBody = String(body.body || "").trim();
    if (!["whatsapp", "email", "phone"].includes(channel)) return json({ ok: false, error: "unsupported_channel" }, 200);
    if (!messageBody && channel !== "phone") return json({ ok: false, error: "message_body_required" }, 200);

    const tenantId = profile.tenant_id;
    const customerId = body.customer_id || body.customerId || null;
    const vehicleId = body.vehicle_id || body.vehicleId || null;
    const workOrderId = body.work_order_id || body.workOrderId || null;
    const claimId = body.claim_id || body.claimId || null;
    const invoiceId = body.invoice_id || body.invoiceId || null;
    const recipientPhone = digits(body.recipient_phone || body.recipientPhone || "");
    const recipientEmail = String(body.recipient_email || body.recipientEmail || "").trim();
    const shortLink = body.short_link || body.shortLink || null;

    const duplicateWindowMinutes = templateType === "payment_reminder" ? 24 * 60 : 2;
    const since = new Date(Date.now() - duplicateWindowMinutes * 60 * 1000).toISOString();
    let duplicateQuery = admin
      .from("message_logs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .eq("template_type", templateType)
      .gte("created_at", since)
      .limit(1);
    if (customerId) duplicateQuery = duplicateQuery.eq("customer_id", customerId);
    if (workOrderId) duplicateQuery = duplicateQuery.eq("work_order_id", workOrderId);
    if (claimId) duplicateQuery = duplicateQuery.eq("claim_id", claimId);
    if (invoiceId) duplicateQuery = duplicateQuery.eq("invoice_id", invoiceId);
    const { data: duplicate } = await duplicateQuery;
    if (duplicate?.length) {
      const logId = await insertLog(admin, {
        tenant_id: tenantId,
        user_id: userData.user.id,
        created_by: userData.user.id,
        customer_id: customerId,
        vehicle_id: vehicleId,
        work_order_id: workOrderId,
        claim_id: claimId,
        invoice_id: invoiceId,
        channel,
        template_key: templateType,
        template_type: templateType,
        recipient_phone: recipientPhone || null,
        recipient_email: recipientEmail || null,
        short_link: shortLink,
        message: messageBody || body.call_notes || "Phone call",
        body: messageBody || body.call_notes || "Phone call",
        status: "duplicate_blocked",
        error: "duplicate_blocked",
        provider_response: { duplicateWindowMinutes },
      });
      return json({ ok: false, status: "duplicate_blocked", error: "duplicate_blocked", logId });
    }

    if (channel === "phone") {
      const logId = await insertLog(admin, {
        tenant_id: tenantId,
        user_id: userData.user.id,
        created_by: userData.user.id,
        customer_id: customerId,
        vehicle_id: vehicleId,
        work_order_id: workOrderId,
        claim_id: claimId,
        invoice_id: invoiceId,
        channel,
        template_key: templateType,
        template_type: templateType,
        recipient_phone: recipientPhone || null,
        message: body.call_notes || messageBody || "Phone call",
        body: body.call_notes || messageBody || "Phone call",
        status: "sent",
        call_result: body.call_result || body.callResult || null,
        call_notes: body.call_notes || body.callNotes || null,
        follow_up_at: body.follow_up_at || body.followUpAt || null,
        sent_at: new Date().toISOString(),
      });
      return json({ ok: true, status: "sent", logId });
    }

    if (channel === "email") {
      if (!recipientEmail) return json({ ok: false, status: "missing_email", error: "missing_email" }, 200);
      const provider = await resolveEmailProvider(admin, tenantId);
      if (!provider) {
        const logId = await insertLog(admin, {
          tenant_id: tenantId, user_id: userData.user.id, created_by: userData.user.id,
          customer_id: customerId, vehicle_id: vehicleId, work_order_id: workOrderId, claim_id: claimId, invoice_id: invoiceId,
          channel, template_key: templateType, template_type: templateType, recipient_email: recipientEmail,
          message: messageBody, body: messageBody, status: "failed", error: "Email provider is not configured.",
        });
        return json({ ok: false, status: "Not Configured", error: "Email provider is not configured.", logId }, 200);
      }
      try {
        const providerResponse = await sendEmail(provider, recipientEmail, body.subject || "AAED2 Notification", messageBody);
        const logId = await insertLog(admin, {
          tenant_id: tenantId, user_id: userData.user.id, created_by: userData.user.id,
          customer_id: customerId, vehicle_id: vehicleId, work_order_id: workOrderId, claim_id: claimId, invoice_id: invoiceId,
          channel, template_key: templateType, template_type: templateType, recipient_email: recipientEmail, short_link: shortLink,
          message: messageBody, body: messageBody, status: "sent", sent_at: new Date().toISOString(), provider_response: providerResponse,
        });
        return json({ ok: true, status: "sent", logId });
      } catch (error) {
        const msg = String(error?.message || error || "email_failed");
        const logId = await insertLog(admin, {
          tenant_id: tenantId, user_id: userData.user.id, created_by: userData.user.id,
          customer_id: customerId, vehicle_id: vehicleId, work_order_id: workOrderId, claim_id: claimId, invoice_id: invoiceId,
          channel, template_key: templateType, template_type: templateType, recipient_email: recipientEmail,
          message: messageBody, body: messageBody, status: "failed", error: msg,
        });
        return json({ ok: false, status: "failed", error: msg, logId });
      }
    }

    if (!recipientPhone) return json({ ok: false, status: "missing_phone", error: "missing_phone" }, 200);
    const { data: wa, error: waError } = await caller.functions.invoke("whatsapp-meta-send", {
      body: {
        to: recipientPhone,
        type: "text",
        text: messageBody,
        customerId,
        vehicleId,
        jobOrderId: workOrderId,
        insuranceClaimId: claimId,
        messageKind: templateType,
      },
    });
    const ok = !waError && wa?.ok;
    const logId = await insertLog(admin, {
      tenant_id: tenantId, user_id: userData.user.id, created_by: userData.user.id,
      customer_id: customerId, vehicle_id: vehicleId, work_order_id: workOrderId, claim_id: claimId, invoice_id: invoiceId,
      channel, template_key: templateType, template_type: templateType, recipient_phone: recipientPhone, short_link: shortLink,
      message: messageBody, body: messageBody, status: ok ? "sent" : "failed", error: ok ? null : (wa?.error || waError?.message || "integration_disabled"),
      sent_at: ok ? new Date().toISOString() : null, provider_response: wa || {},
    });
    return json({ ok: !!ok, status: ok ? "sent" : "failed", error: ok ? null : (wa?.error || waError?.message || "integration_disabled"), logId });
  } catch (error) {
    const msg = String(error?.message || error || "server_function_failed");
    return json({ ok: false, error: msg, message: msg }, 200);
  }
});
