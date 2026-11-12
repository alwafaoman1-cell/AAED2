export interface MessageDependencies {
  createClient: (url: string, key: string, options?: any) => any;
  env: (name: string) => string | undefined;
  request?: typeof fetch;
}
export function createUnifiedMessageHandler({ createClient, env, request = fetch }: MessageDependencies) {

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function userError(code: string) {
  const map: Record<string, string> = {
    integration_disabled: "WhatsApp integration is not enabled.",
    missing_credentials: "Meta WhatsApp credentials are incomplete.",
    rate_limited: "Message limit reached. Please try again later.",
    duplicate_blocked: "This message was already queued or sent.",
    message_body_required: "Message text is required.",
    missing_phone: "A valid recipient phone number is required.",
    missing_email: "Recipient email is required.",
    template_required: "This WhatsApp conversation requires an approved Meta template.",
    unsupported_channel: "Unsupported message channel.",
  };
  return map[code] || code;
}

function buildIdempotencyKey(body: any, tenantId: string) {
  return String(body.idempotency_key || body.idempotencyKey || hashString([
    tenantId,
    body.channel || "whatsapp",
    body.recipient_phone || body.recipientPhone || body.recipient_email || body.recipientEmail || "",
    body.template_type || body.templateType || body.template_name || body.templateName || "general",
    body.work_order_id || body.workOrderId || "",
    body.claim_id || body.claimId || "",
    body.invoice_id || body.invoiceId || "",
    body.attachment?.url || body.attachment?.storagePath || "",
    hashString(String(body.body || body.text || body.call_notes || "")),
  ].join("|")));
}

function sanitizeProviderResponse(payload: any) {
  return {
    ok: !!payload?.ok,
    status: payload?.status || null,
    providerMessageId: payload?.providerMessageId || payload?.id || null,
    error: payload?.error || null,
  };
}

function validateAttachment(attachment: any) {
  if (!attachment) return;
  const url = String(attachment.url || "");
  if (url && !/^https:\/\//i.test(url)) throw new Error("secure_https_link_required");
  const type = String(attachment.type || "document");
  const mime = String(attachment.mimeType || attachment.mime_type || "").toLowerCase();
  const allowed = type === "image"
    ? ["image/jpeg", "image/png", "image/webp"]
    : ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (mime && !allowed.includes(mime)) throw new Error("unsupported_attachment_mime");
  const size = Number(attachment.fileSize || attachment.file_size || 0);
  const maxBytes = type === "image" ? 5 * 1024 * 1024 : 12 * 1024 * 1024;
  if (size > maxBytes) throw new Error("attachment_too_large");
}

async function resolveEmailProvider(admin: any, tenantId: string) {
  const { data: row } = await admin.from("tenant_integrations")
    .select("config,secrets,enabled")
    .eq("tenant_id", tenantId)
    .eq("provider", "resend_email")
    .eq("enabled", true)
    .maybeSingle();
  const config = row?.config || {};
  const secrets = row?.secrets || {};
  if (row?.enabled && secrets.api_key && config.from_email) {
    const from = config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email;
    return { apiKey: secrets.api_key, from, source: "tenant" };
  }
  const fallbackKey = env("RESEND_API_KEY");
  if (fallbackKey) return { apiKey: fallbackKey, from: env("SECURITY_EMAIL_FROM") || "AAED2 <security@aaed.app>", source: "fallback" };
  return null;
}

async function sendEmail(provider: any, to: string, subject: string, body: string) {
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: provider.from, to, subject, text: body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `resend_failed_${response.status}`);
  return payload;
}

async function checkRateLimit(admin: any, tenantId: string, userId: string, channel: string, recipient: string) {
  const sinceTenant = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const sinceUser = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const counts = await Promise.all([
    admin.from("message_logs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("channel", channel).gte("created_at", sinceTenant),
    admin.from("message_logs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("user_id", userId).eq("channel", channel).gte("created_at", sinceUser),
    recipient ? admin.from("message_logs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("channel", channel).eq(channel === "email" ? "recipient_email" : "recipient_phone", recipient).gte("created_at", sinceUser) : Promise.resolve({ count: 0 }),
  ]);
  if (counts.some((row: any) => row.error)) throw new Error("message_rate_check_unavailable");
  const [tenantCount, userCount, recipientCount] = counts.map((row: any) => row.count || 0);
  if (tenantCount >= 300 || userCount >= 80 || recipientCount >= 20) return false;
  return true;
}

async function reserveIdempotency(admin: any, tenantId: string, key: string, payload: any) {
  // The existing RPC's `inserted` flag also reports true for a previously
  // reserved row with no log. Use the existing UNIQUE constraint as the claim
  // of ownership: only the insert winner may create a log or contact a provider.
  const { error } = await admin.from("message_idempotency_keys").insert({
      tenant_id: tenantId,
      idempotency_key: key,
      channel: payload.channel,
      recipient: payload.recipient,
      logical_action: payload.logicalAction,
      status: "reserved",
  });
  if (!error) return { duplicate: false, messageLogId: null };
  if (error.code !== "23505") throw new Error("message_reservation_unavailable");
  const { data: existing, error: readError } = await admin.from("message_idempotency_keys")
    .select("message_log_id,status").eq("tenant_id", tenantId).eq("idempotency_key", key).maybeSingle();
  if (readError) throw new Error("message_reservation_unavailable");
  return { duplicate: true, messageLogId: existing?.message_log_id || null, status: existing?.status || "reserved" };
}

async function validateMessageScope(admin: any, body: any, tenantId: string) {
  if ((body.tenant_id && body.tenant_id !== tenantId) || (body.tenantId && body.tenantId !== tenantId)) throw new Error("message_tenant_mismatch");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [field, alias, table] of [["customer_id","customerId","customers"],["vehicle_id","vehicleId","vehicles"],["claim_id","claimId","insurance_claims"]]) {
    const value = body[field] || body[alias];
    if (!value) continue;
    if (typeof value !== "string" || !uuid.test(value)) throw new Error("message_link_unavailable");
    const row = await admin.from(table).select("id").eq("tenant_id",tenantId).eq("id",value).maybeSingle();
    if (row.error || !row.data) throw new Error("message_link_unavailable");
  }
  const order = body.work_order_id || body.workOrderId;
  if (order) {
    if (typeof order !== "string" || order.length > 120) throw new Error("message_link_unavailable");
    const row = await admin.from("job_orders").select("id").eq("tenant_id",tenantId).eq(uuid.test(order)?"id":"order_number",order).maybeSingle();
    if (row.error || !row.data) throw new Error("message_link_unavailable");
    body.work_order_id = row.data.id;
  }
  const invoice = body.invoice_id || body.invoiceId;
  // Preserve historical free-text invoice references. Only UUID references
  // claim an entity identity, and must resolve in this tenant in exactly one
  // of the still-separated invoice stores. No invoice is written or combined.
  if (invoice && (typeof invoice !== "string" || invoice.length > 120)) throw new Error("message_link_unavailable");
  if (invoice && uuid.test(invoice)) {
    const rows = await Promise.all(["insurance_invoices","sales_documents"].map(table=>admin.from(table).select("id").eq("tenant_id",tenantId).eq("id",invoice).maybeSingle()));
    if (rows.some(row=>row.error) || rows.filter(row=>row.data).length !== 1) throw new Error("message_link_unavailable");
  }
}

async function findExistingMessageLog(admin: any, tenantId: string, idempotencyKey: string) {
  const { data } = await admin
    .from("message_logs")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return data || null;
}

return async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok:false,error:"method_not_allowed" },405);
  if (Number(req.headers.get("content-length")||0)>65536) return json({ok:false,error:"payload_too_large"},413);
  let adminForFailure: any = null;
  let messageLogIdForFailure: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = env("SUPABASE_URL")!;
    const ANON_KEY = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    adminForFailure = admin;
    const { data: userData } = await caller.auth.getUser(authHeader.slice(7));
    if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: profile, error: profileError } = await admin.from("profiles").select("user_id,tenant_id,role,account_status,disabled_at").eq("user_id", userData.user.id).maybeSingle();
    if (profileError || profile?.user_id !== userData.user.id || !profile?.tenant_id || profile.account_status !== "active" || profile.disabled_at
      || !["admin","manager","supervisor","insurance","technician","accountant"].includes(profile.role)) return json({ ok: false, error: "active_profile_required" },403);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.dry_run !== undefined && typeof body.dry_run !== "boolean")) return json({ok:false,error:"invalid_request"},400);
    const channel = String(body.channel || "");
    if (!["whatsapp", "email", "phone"].includes(channel)) return json({ ok: false, error: "unsupported_channel", message: userError("unsupported_channel") }, 200);

    const tenantId = profile.tenant_id;
    await validateMessageScope(admin,body,tenantId);
    const templateType = String(body.template_type || body.templateType || body.template_name || body.templateName || "general");
    const messageType = String(body.message_type || body.messageType || "text");
    const messageBody = String(body.body || body.text || body.call_notes || body.callNotes || "").trim();
    if (messageBody.length>16000) return json({ok:false,error:"message_too_long"},400);
    if (!["text","template","document","image"].includes(messageType)) return json({ok:false,error:"unsupported_message_type"},400);
    const recipientPhone = digits(body.recipient_phone || body.recipientPhone || body.to || "");
    const recipientEmail = String(body.recipient_email || body.recipientEmail || "").trim();
    const recipient = channel === "email" ? recipientEmail : recipientPhone;
    if (channel !== "phone" && !messageBody && messageType === "text") return json({ ok: false, error: "message_body_required", message: userError("message_body_required") }, 200);
    if ((channel === "whatsapp" || channel === "phone") && !recipientPhone) return json({ ok: false, error: "missing_phone", message: userError("missing_phone") }, 200);
    if (channel === "email" && !recipientEmail) return json({ ok: false, error: "missing_email", message: userError("missing_email") }, 200);

    const rateAllowed = await checkRateLimit(admin, tenantId, userData.user.id, channel, recipient);
    if (!rateAllowed) return json({ ok: false, status: "rate_limited", error: "rate_limited", message: userError("rate_limited") }, 200);

    validateAttachment(body.attachment);
    const idempotencyKey = buildIdempotencyKey(body, tenantId);
    if (!idempotencyKey || idempotencyKey.length>250) return json({ok:false,error:"invalid_idempotency_key"},400);
    const reservation = await reserveIdempotency(admin, tenantId, idempotencyKey, { channel, recipient, logicalAction: templateType });
    if (reservation.duplicate) return json({ ok: false, status: "duplicate_blocked", error: "duplicate_blocked", message: userError("duplicate_blocked"), logId: reservation.messageLogId }, 200);

    const commonLog = {
      tenant_id: tenantId,
      user_id: userData.user.id,
      created_by: userData.user.id,
      customer_id: body.customer_id || body.customerId || null,
      vehicle_id: body.vehicle_id || body.vehicleId || null,
      work_order_id: body.work_order_id || body.workOrderId || null,
      claim_id: body.claim_id || body.claimId || null,
      invoice_id: body.invoice_id || body.invoiceId || null,
      channel,
      direction: "outbound",
      message_type: messageType,
      template_key: templateType,
      template_type: templateType,
      recipient_phone: recipientPhone || null,
      recipient_email: recipientEmail || null,
      short_link: body.short_link || body.shortLink || null,
      message: messageBody || body.call_notes || body.callNotes || "Phone call",
      body: messageBody || body.call_notes || body.callNotes || "Phone call",
      status: body.dry_run ? "dry_run" : "queued",
      queued_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      metadata: {
        attachment: body.attachment ? {
          type: body.attachment.type || null,
          fileName: body.attachment.fileName || body.attachment.file_name || null,
          mimeType: body.attachment.mimeType || body.attachment.mime_type || null,
          fileSize: body.attachment.fileSize || body.attachment.file_size || null,
          storagePath: body.attachment.storagePath || body.attachment.storage_path || null,
        } : null,
        template_name: body.template_name || body.templateName || null,
      },
    };

    const { data: inserted, error: insertError } = await admin.from("message_logs").insert(commonLog).select("id").single();
    if (insertError) {
      const existingLog = await findExistingMessageLog(admin, tenantId, idempotencyKey);
      if (existingLog?.id) {
        await admin.from("message_idempotency_keys").update({ message_log_id: existingLog.id, status: existingLog.status || "queued" }).eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey);
        return json({ ok: false, status: "duplicate_blocked", error: "duplicate_blocked", message: userError("duplicate_blocked"), logId: existingLog.id }, 200);
      }
      throw insertError;
    }
    const logId = inserted.id;
    messageLogIdForFailure = logId;
    await admin.from("message_idempotency_keys").update({ message_log_id: logId, status: "queued" }).eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey);

    if (body.dry_run) return json({ ok: true, status: "dry_run", logId, idempotencyKey });

    if (channel === "phone") {
      await admin.from("message_logs").update({ status: "sent", sent_at: new Date().toISOString(), metadata: { call_result: body.call_result || body.callResult || null, follow_up_at: body.follow_up_at || body.followUpAt || null } }).eq("id", logId);
      return json({ ok: true, status: "sent", logId, idempotencyKey });
    }

    if (channel === "email") {
      const provider = await resolveEmailProvider(admin, tenantId);
      if (!provider) {
        await admin.from("message_logs").update({ status: "failed", error: "Email provider is not configured.", failed_at: new Date().toISOString(), failure_reason: "Email provider is not configured." }).eq("id", logId);
        return json({ ok: false, status: "failed", error: "email_provider_not_configured", message: "Email provider is not configured.", logId }, 200);
      }
      try {
        const providerResponse = await sendEmail(provider, recipientEmail, body.subject || "AAED2 Notification", messageBody);
        await admin.from("message_logs").update({ status: "sent", sent_at: new Date().toISOString(), provider_response: sanitizeProviderResponse(providerResponse) }).eq("id", logId);
        return json({ ok: true, status: "sent", logId, providerResponse });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error || "email_failed");
        await admin.from("message_logs").update({ status: "failed", error: msg, failed_at: new Date().toISOString(), failure_reason: msg }).eq("id", logId);
        return json({ ok: false, status: "failed", error: msg, message: msg, logId }, 200);
      }
    }

    const internalSecret = env("WHATSAPP_INTERNAL_SHARED_SECRET") || "";
    if (!internalSecret) {
      await admin.from("message_logs").update({ status: "failed", error: "internal_provider_secret_missing", failed_at: new Date().toISOString(), failure_reason: "internal_provider_secret_missing" }).eq("id", logId);
      return json({ ok: false, status: "failed", error: "internal_provider_secret_missing", message: "WhatsApp internal provider is not configured.", logId }, 200);
    }
    let wa: any = null;
    let waErrorMessage: string | null = null;
    try {
      const providerResponse = await request(`${SUPABASE_URL}/functions/v1/whatsapp-meta-send`, {
        method: "POST",
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          "x-aaed-internal-secret": internalSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
        tenantId,
        userId: userData.user.id,
        to: recipientPhone,
        type: messageType === "template" ? "template" : (body.attachment?.type === "image" ? "image" : body.attachment ? "document" : "text"),
        text: messageBody,
        template: body.template || (body.template_name || body.templateName ? { name: body.template_name || body.templateName, language: body.template_language || body.templateLanguage || "ar", components: body.template_components || body.templateComponents || [] } : undefined),
        mediaUrl: body.attachment?.url,
        filename: body.attachment?.fileName,
        mimeType: body.attachment?.mimeType,
        fileSize: body.attachment?.fileSize,
        storagePath: body.attachment?.storagePath,
        caption: body.attachment?.caption || messageBody,
        customerId: body.customer_id || body.customerId || null,
        vehicleId: body.vehicle_id || body.vehicleId || null,
        jobOrderId: body.work_order_id || body.workOrderId || null,
        insuranceClaimId: body.claim_id || body.claimId || null,
        messageKind: templateType,
        messageLogId: logId,
        idempotencyKey,
        }),
      });
      wa = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) waErrorMessage = wa?.error || ("whatsapp_provider_http_" + providerResponse.status);
    } catch (error) {
      waErrorMessage = error instanceof Error ? error.message : String(error || "whatsapp_provider_failed");
      wa = { ok: false, error: waErrorMessage };
    }
    const providerMessageId = wa?.id || wa?.providerMessageId || null;
    const ok = !waErrorMessage && wa?.ok === true && typeof providerMessageId === "string" && providerMessageId.length>0;
    const failure = wa?.error || waErrorMessage || "provider_acceptance_unconfirmed";
    const savedStatus = await admin.from("message_logs").update({
      status: ok ? "sent" : "failed",
      provider: "meta_whatsapp",
      provider_message_id: providerMessageId,
      error: ok ? null : failure,
      sent_at: ok ? new Date().toISOString() : null,
      failed_at: ok ? null : new Date().toISOString(),
      failure_reason: ok ? null : failure,
      provider_response: sanitizeProviderResponse(wa || {}),
    }).eq("tenant_id",tenantId).eq("id", logId).in("status",["pending","queued"]);
    if (savedStatus.error) return json({ok:false,status:"unconfirmed",error:"message_status_persistence_unconfirmed",logId,providerMessageId});
    return json({ ok: !!ok, status: ok ? "sent" : "failed", error: ok ? null : failure, message: ok ? null : userError(failure), logId, providerMessageId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || "server_function_failed");
    if (adminForFailure && messageLogIdForFailure) {
      await adminForFailure.from("message_logs").update({
        status: "failed",
        error: msg,
        failed_at: new Date().toISOString(),
        failure_reason: msg,
        provider_response: sanitizeProviderResponse({ ok: false, error: msg }),
      }).eq("id", messageLogIdForFailure).in("status",["pending","queued"]);
    }
    return json({ ok: false, error: msg, message: userError(msg) }, 200);
  }
};
}
