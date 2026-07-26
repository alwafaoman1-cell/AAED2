// Internal provider function for Meta WhatsApp Cloud API.
// Browser clients must call unified-message-send only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface Body {
  tenantId: string;
  userId: string;
  to: string;
  type?: "text" | "template" | "document" | "image";
  text?: string;
  template?: { name: string; language: string; components?: unknown[] };
  mediaUrl?: string;
  filename?: string;
  mimeType?: string;
  fileSize?: number;
  storagePath?: string;
  caption?: string;
  customerId?: string | null;
  vehicleId?: string | null;
  insuranceClaimId?: string | null;
  jobOrderId?: string | null;
  recipientName?: string;
  recipientType?: "customer" | "supplier" | "insurance" | "other";
  messageKind?: string;
  messageLogId?: string;
  idempotencyKey?: string;
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeProviderResponse(payload: any) {
  return {
    messages: Array.isArray(payload?.messages)
      ? payload.messages.map((m: any) => ({ id: m?.id || null, message_status: m?.message_status || null }))
      : [],
    contacts: Array.isArray(payload?.contacts)
      ? payload.contacts.map((c: any) => ({ wa_id: c?.wa_id || null }))
      : [],
    error: payload?.error
      ? {
          message: payload.error.message || null,
          type: payload.error.type || null,
          code: payload.error.code || null,
          error_subcode: payload.error.error_subcode || null,
        }
      : null,
  };
}

function validateAttachment(body: Body) {
  const type = body.type || "text";
  if (type !== "document" && type !== "image") return;
  if (!/^https:\/\//i.test(body.mediaUrl || "")) throw new Error("secure_https_link_required");
  const mime = String(body.mimeType || "").toLowerCase();
  const allowed = type === "image"
    ? ["image/jpeg", "image/png", "image/webp"]
    : ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (mime && !allowed.includes(mime)) throw new Error("unsupported_attachment_mime");
  const maxBytes = type === "image" ? 5 * 1024 * 1024 : 12 * 1024 * 1024;
  if (body.fileSize && body.fileSize > maxBytes) throw new Error("attachment_too_large");
}

function assertSafeHeaderValue(name: string, value: string) {
  if (!value || /[\r\n]/.test(value) || /\bselect\s+/i.test(value)) {
    throw new Error(`${name}_invalid`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: false, error: "forbidden" }, 403);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const expectedInternalSecret = Deno.env.get("WHATSAPP_INTERNAL_SHARED_SECRET") || "";
  const gotInternalSecret = req.headers.get("x-aaed-internal-secret") || "";
  if (!expectedInternalSecret || gotInternalSecret !== expectedInternalSecret) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let logRowIdForFailure: string | null = null;
  let adminForFailure: any = null;
  try {
    const body = (await req.json()) as Body;
    const tenantId = body.tenantId;
    const userId = body.userId;
    const to = digits(body.to);
    if (!tenantId || !userId) throw new Error("missing_internal_context");
    if (!to) throw new Error("to_required");

    validateAttachment(body);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    adminForFailure = admin;

    const { data: featureRow, error: featureError } = await admin
      .from("tenant_features")
      .select("enabled")
      .eq("tenant_id", tenantId)
      .eq("feature_key", "whatsapp")
      .maybeSingle();
    if (featureError) throw featureError;
    if (featureRow?.enabled !== true) throw new Error("feature_disabled");

    const { data: integ, error } = await admin
      .from("tenant_integrations")
      .select("config, enabled")
      .eq("tenant_id", tenantId)
      .eq("provider", "meta_whatsapp")
      .maybeSingle();
    if (error) throw error;
    if (!integ?.enabled) throw new Error("integration_disabled");

    const cfg = integ.config || {};
    const phoneId = cfg.phone_number_id || Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID") || "";
    const token = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN") || "";
    if (!phoneId || !token) throw new Error("missing_credentials");
    assertSafeHeaderValue("meta_whatsapp_access_token", token);
    assertSafeHeaderValue("meta_whatsapp_phone_number_id", phoneId);

    const type = body.type || "text";
    const messageBody = type === "text"
      ? (body.text || "")
      : (body.caption || body.filename || body.template?.name || "");

    if (body.idempotencyKey) {
      const { data: existingLog } = await admin
        .from("whatsapp_logs")
        .select("id, status, provider_message_id, meta_message_id")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", body.idempotencyKey)
        .maybeSingle();
      if (existingLog?.id) {
        const existingProviderId = existingLog.provider_message_id || existingLog.meta_message_id || null;
        return json({
          ok: existingLog.status === "sent",
          duplicate: true,
          id: existingProviderId,
          providerMessageId: existingProviderId,
          logId: existingLog.id,
          status: existingLog.status,
        });
      }
    }

    const { data: logRow, error: logError } = await admin
      .from("whatsapp_logs")
      .insert({
        tenant_id: tenantId,
        customer_id: body.customerId || null,
        vehicle_id: body.vehicleId || null,
        insurance_claim_id: body.insuranceClaimId || null,
        job_order_id: body.jobOrderId || null,
        message_log_id: body.messageLogId || null,
        idempotency_key: body.idempotencyKey || null,
        recipient_type: body.recipientType || "customer",
        recipient_name: body.recipientName || null,
        recipient_phone: to,
        message_kind: body.messageKind || type,
        message_body: messageBody,
        media_url: body.mediaUrl || null,
        status: "pending",
        direction: "outbound",
        sent_by: userId,
      })
      .select("id")
      .single();
    logRowIdForFailure = logRow?.id || null;
    if (logError) {
      if (body.idempotencyKey) {
        const { data: existingLog } = await admin
          .from("whatsapp_logs")
          .select("id, status, provider_message_id, meta_message_id")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", body.idempotencyKey)
          .maybeSingle();
        if (existingLog?.id) {
          const existingProviderId = existingLog.provider_message_id || existingLog.meta_message_id || null;
          return json({
            ok: existingLog.status === "sent",
            duplicate: true,
            id: existingProviderId,
            providerMessageId: existingProviderId,
            logId: existingLog.id,
            status: existingLog.status,
          });
        }
      }
      throw logError;
    }

    if (body.mediaUrl || body.storagePath) {
      await admin.from("message_attachments").insert({
        tenant_id: tenantId,
        message_log_id: body.messageLogId || null,
        whatsapp_log_id: logRow.id,
        storage_path: body.storagePath || null,
        public_url: body.mediaUrl || null,
        file_name: body.filename || null,
        mime_type: body.mimeType || null,
        file_size: body.fileSize || null,
        attachment_type: type === "image" ? "image" : "document",
        direction: "outbound",
      });
    }

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
    const providerPayload = await r.json().catch(() => ({}));
    const providerResponse = sanitizeProviderResponse(providerPayload);
    if (!r.ok) {
      const sendError = providerResponse.error?.message || "send_failed";
      await admin.from("whatsapp_logs").update({
        status: "failed",
        error_message: sendError,
        failed_at: new Date().toISOString(),
        failure_reason: sendError,
        failure_code: providerResponse.error?.code ? String(providerResponse.error.code) : null,
        provider_response: providerResponse,
        updated_at: new Date().toISOString(),
      }).eq("id", logRow.id);
      throw new Error(sendError);
    }

    const providerMessageId = providerResponse.messages?.[0]?.id || null;
    await admin.from("whatsapp_logs").update({
      status: "sent",
      provider_message_id: providerMessageId,
      meta_message_id: providerMessageId,
      provider_response: providerResponse,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return json({ ok: true, id: providerMessageId, providerMessageId, logId: logRow.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    if (adminForFailure && logRowIdForFailure) {
      await adminForFailure.from("whatsapp_logs").update({
        status: "failed",
        error_message: msg,
        failed_at: new Date().toISOString(),
        failure_reason: msg,
        provider_response: sanitizeProviderResponse({ error: { message: msg } }),
        updated_at: new Date().toISOString(),
      }).eq("id", logRowIdForFailure);
    }
    return json({ ok: false, error: msg }, 200);
  }
});
