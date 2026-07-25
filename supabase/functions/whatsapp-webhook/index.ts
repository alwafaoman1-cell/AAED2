// Meta WhatsApp webhook endpoint.
// Security rule: verify X-Hub-Signature-256 over raw body before JSON processing or persistence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 9,
  received: 9,
  dry_run: 9,
  cancelled: 9,
};

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyRawSignature(req: Request, rawBody: string) {
  const appSecret = Deno.env.get("META_WHATSAPP_APP_SECRET") || Deno.env.get("WHATSAPP_META_APP_SECRET") || "";
  if (!appSecret) return { ok: false, error: "app_secret_missing" };
  const header = req.headers.get("x-hub-signature-256");
  if (!header) return { ok: false, error: "missing_signature" };
  const got = header.replace(/^sha256=/, "").trim();
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return { ok: safeEqual(got, expected), error: "invalid_signature" };
}

function firstValue(payload: any) {
  return payload?.entry?.[0]?.changes?.[0]?.value || {};
}

function getPhoneNumberId(payload: any) {
  const value = firstValue(payload);
  return value?.metadata?.phone_number_id || null;
}

async function resolveTenantByPhoneId(admin: any, phoneNumberId: string | null) {
  if (!phoneNumberId) return null;
  const { data } = await admin.from("tenant_integrations")
    .select("tenant_id,config,enabled")
    .eq("provider", "meta_whatsapp")
    .eq("enabled", true);
  return (data || []).find((row: any) => String(row?.config?.phone_number_id || "") === String(phoneNumberId)) || null;
}

async function findCustomer(admin: any, tenantId: string, phone: string) {
  if (!phone) return null;
  const local = phone.startsWith("968") ? phone.slice(3) : phone;
  const { data } = await admin.from("customers")
    .select("id,name,phone")
    .eq("tenant_id", tenantId)
    .or(`phone.ilike.%${phone}%,phone.ilike.%${local}%`)
    .limit(2);
  return data?.length === 1 ? data[0] : null;
}

async function upsertConversation(admin: any, args: any) {
  const { data: existing } = await admin.from("whatsapp_conversations")
    .select("id,unread_count")
    .eq("tenant_id", args.tenant_id)
    .eq("phone", args.phone)
    .maybeSingle();
  if (existing?.id) {
    await admin.from("whatsapp_conversations").update({
      customer_id: args.customer_id || null,
      customer_name_snapshot: args.customer_name_snapshot || null,
      last_message_at: args.last_message_at,
      last_message_preview: args.last_message_preview,
      unread_count: (existing.unread_count || 0) + (args.direction === "inbound" ? 1 : 0),
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin.from("whatsapp_conversations").insert({
    tenant_id: args.tenant_id,
    customer_id: args.customer_id || null,
    vehicle_id: args.vehicle_id || null,
    work_order_id: args.work_order_id || null,
    claim_id: args.claim_id || null,
    phone: args.phone,
    customer_name_snapshot: args.customer_name_snapshot || null,
    last_message_at: args.last_message_at,
    last_message_preview: args.last_message_preview,
    unread_count: args.direction === "inbound" ? 1 : 0,
    status: "open",
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

function sanitizeStatus(status: any) {
  return {
    id: status?.id || status?.message_id || null,
    status: status?.status || null,
    timestamp: status?.timestamp || null,
    recipient_id: status?.recipient_id || null,
    errors: Array.isArray(status?.errors)
      ? status.errors.map((e: any) => ({ code: e?.code || null, title: e?.title || null, message: e?.message || null }))
      : [],
  };
}

function sanitizeInboundMessage(msg: any) {
  return {
    id: msg?.id || null,
    from: msg?.from || null,
    timestamp: msg?.timestamp || null,
    type: msg?.type || null,
    text: msg?.text?.body ? { body: String(msg.text.body).slice(0, 4000) } : null,
    media: msg?.image || msg?.document || msg?.audio
      ? {
          id: (msg.image || msg.document || msg.audio)?.id || null,
          mime_type: (msg.image || msg.document || msg.audio)?.mime_type || null,
          filename: (msg.image || msg.document || msg.audio)?.filename || null,
        }
      : null,
  };
}

async function processStatus(admin: any, tenantId: string, status: any) {
  const metaId = status.id || status.message_id;
  if (!metaId) return;
  const state = String(status.status || "unknown");
  if (!(state in STATUS_RANK)) return;
  const ts = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
  const failure = status.errors?.[0];
  const { data: current } = await admin.from("whatsapp_logs")
    .select("id,status,message_log_id")
    .eq("tenant_id", tenantId)
    .or(`provider_message_id.eq.${metaId},meta_message_id.eq.${metaId}`)
    .maybeSingle();
  if (!current?.id) return;
  const currentRank = STATUS_RANK[current.status] ?? 0;
  const nextRank = STATUS_RANK[state] ?? 0;
  if (state === current.status || nextRank < currentRank) return;

  const sanitized = sanitizeStatus(status);
  const update: any = { status: state, updated_at: new Date().toISOString(), provider_response: sanitized };
  if (state === "delivered") update.delivered_at = ts;
  if (state === "read") update.read_at = ts;
  if (state === "failed") {
    update.failed_at = ts;
    update.failure_code = failure?.code ? String(failure.code) : null;
    update.failure_reason = failure?.title || failure?.message || null;
    update.error_message = update.failure_reason;
  }
  await admin.from("whatsapp_logs").update(update).eq("id", current.id);
  if (current.message_log_id) {
    const messageUpdate: any = { status: state, provider_response: sanitized };
    if (state === "delivered") messageUpdate.delivered_at = ts;
    if (state === "read") messageUpdate.read_at = ts;
    if (state === "failed") {
      messageUpdate.failed_at = ts;
      messageUpdate.failure_code = failure?.code ? String(failure.code) : null;
      messageUpdate.failure_reason = failure?.title || failure?.message || null;
      messageUpdate.error = messageUpdate.failure_reason;
    }
    await admin.from("message_logs").update(messageUpdate).eq("id", current.message_log_id);
  }
}

async function processInboundMessage(admin: any, tenantId: string, msg: any) {
  const from = digits(msg.from || "");
  const messageType = msg.type || "text";
  const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || msg.document?.filename || msg.image?.caption || `[${messageType}]`;
  const customer = await findCustomer(admin, tenantId, from);
  const conversationId = await upsertConversation(admin, {
    tenant_id: tenantId,
    customer_id: customer?.id || null,
    phone: from,
    customer_name_snapshot: customer?.name || null,
    last_message_at: new Date().toISOString(),
    last_message_preview: String(text).slice(0, 240),
    direction: "inbound",
  });
  const sanitized = sanitizeInboundMessage(msg);
  const { data: log, error } = await admin.from("message_logs").insert({
    tenant_id: tenantId,
    customer_id: customer?.id || null,
    conversation_id: conversationId,
    channel: "whatsapp",
    provider: "meta_whatsapp",
    direction: "inbound",
    message_type: messageType,
    template_key: "inbound",
    template_type: "inbound",
    recipient_phone: from,
    message: String(text || ""),
    body: String(text || ""),
    status: "received",
    provider_message_id: msg.id || null,
    provider_response: sanitized,
    sent_at: null,
  }).select("id").single();
  if (error) throw error;
  await admin.from("whatsapp_logs").insert({
    tenant_id: tenantId,
    message_log_id: log.id,
    meta_message_id: msg.id || null,
    provider_message_id: msg.id || null,
    recipient_phone: from,
    message_kind: "inbound",
    message_body: String(text || ""),
    status: "received",
    direction: "inbound",
    payload: sanitized,
    provider_response: sanitized,
  });
  const media = msg.image || msg.document || msg.audio || null;
  if (media?.id) {
    await admin.from("message_attachments").insert({
      tenant_id: tenantId,
      message_log_id: log.id,
      provider_media_id: media.id,
      file_name: media.filename || null,
      mime_type: media.mime_type || null,
      attachment_type: messageType,
      direction: "inbound",
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    const verifyToken = Deno.env.get("META_WHATSAPP_VERIFY_TOKEN") || Deno.env.get("WHATSAPP_META_VERIFY_TOKEN") || "";
    if (mode !== "subscribe") return new Response("invalid mode", { status: 400, headers: corsHeaders });
    if (!verifyToken || !token || token !== verifyToken) return new Response("invalid verify token", { status: 403, headers: corsHeaders });
    return new Response(challenge, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const raw = await req.text();
  const signature = await verifyRawSignature(req, raw);
  if (!signature.ok) return json({ ok: false, error: signature.error }, 403);

  let payload: any;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const value = firstValue(payload);
  const phoneNumberId = getPhoneNumberId(payload);
  const integration = await resolveTenantByPhoneId(admin, phoneNumberId);
  if (!integration?.tenant_id) return json({ ok: false, error: "tenant_not_found_for_phone_number_id" }, 403);

  const tenantId = integration.tenant_id;
  const eventHash = await sha256Hex(raw);
  const { data: existing } = await admin.from("whatsapp_webhook_events").select("id,status").eq("event_hash", eventHash).maybeSingle();
  if (existing?.id) return json({ ok: true, duplicate: true, eventId: existing.id });

  const { data: eventRow, error: eventError } = await admin.from("whatsapp_webhook_events").insert({
    tenant_id: tenantId,
    event_hash: eventHash,
    event_type: value?.messages?.length ? "messages" : value?.statuses?.length ? "statuses" : "unknown",
    phone_number_id: phoneNumberId,
    meta_message_id: value?.messages?.[0]?.id || value?.statuses?.[0]?.id || null,
    payload: {
      object: payload?.object || null,
      entry_count: Array.isArray(payload?.entry) ? payload.entry.length : 0,
      message_ids: (value?.messages || []).map((m: any) => m?.id).filter(Boolean),
      status_ids: (value?.statuses || []).map((s: any) => s?.id).filter(Boolean),
    },
    status: "received",
  }).select("id").single();
  if (eventError) throw eventError;

  try {
    for (const status of value?.statuses || []) await processStatus(admin, tenantId, status);
    for (const msg of value?.messages || []) await processInboundMessage(admin, tenantId, msg);
    await admin.from("whatsapp_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", eventRow.id);
    return json({ ok: true, eventId: eventRow.id });
  } catch (error) {
    const msg = String(error?.message || error || "webhook_failed");
    await admin.from("whatsapp_webhook_events").update({ status: "failed", error: msg, processed_at: new Date().toISOString() }).eq("id", eventRow.id);
    return json({ ok: false, error: msg }, 200);
  }
});
