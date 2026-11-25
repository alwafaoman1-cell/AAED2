import { resolveClaimEngineerPacket } from "./claimEngineerPacket.ts";
import { buildClaimEmailMime, checkedEmail, checkedFilename, ClaimEmailError, CLAIM_EMAIL_LIMIT_BYTES, CLAIM_EMAIL_GENERATED_TOTAL_BYTES, decodeTechnicalPdf, hasControlCharacters, refreshGmailToken, sendGmailMime, sha256Hex, validAttachmentMagic, type EmailBinaryAttachment } from "./gmailAttachments.ts";
import { claimEmailBody, claimEmailTemplateId, CLAIM_EMAIL_OWNER_TEST_ADDRESS } from "./claimEngineerEmailTemplates.ts";

export type ClaimEngineerResolver = typeof resolveClaimEngineerPacket;
type ActionContext = {
  admin: any; caller: any; profile: { tenant_id: string; role: string }; userId: string;
  body: any; request: typeof fetch; resolvePacket?: ClaimEngineerResolver;
  rateAllowed: (recipient: string) => Promise<boolean>;
};
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACTION = "claim_engineer_email";

async function gmailConfiguration(admin: any, tenantId: string) {
  const result = await admin.from("tenant_integrations").select("enabled,config,secrets").eq("tenant_id", tenantId).eq("provider", "gmail").maybeSingle();
  if (result.error) throw new ClaimEmailError("claim_email_gmail_status_unavailable");
  const config = result.data?.config || {}, secrets = result.data?.secrets || {};
  let fromEmail = "";
  try { fromEmail = checkedEmail(config.from_email); } catch { /* Safe status remains incomplete. */ }
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "";
  const credentials = { clientId: text(config.client_id), clientSecret: text(secrets.client_secret), refreshToken: text(secrets.refresh_token) };
  return { safe: { enabled: result.data?.enabled === true, configured: Boolean(fromEmail && credentials.clientId && credentials.clientSecret && credentials.refreshToken), fromEmail }, credentials };
}

function summary(packet: any, language: "ar" | "en") {
  if (Array.isArray(packet.statusSummary)) return claimEmailBody(packet, language);
  return language === "en"
    ? `Dear ${packet.recipient.name},\n\nPlease find the selected attachments for ${packet.subject}.\nVehicle entry: ${packet.entryNumber}\n\nKind regards,\nAl Wafa Auto`
    : `السيد/السيدة ${packet.recipient.name}،\n\nنرفق لكم الملفات المحددة للمطالبة ${packet.subject}.\nدخول المركبة: ${packet.entryNumber}\n\nمع التحية،\nالوفاء للسيارات`;
}

async function currentDuplicate(admin: any, tenantId: string, key: string) {
  const reservation = await admin.from("message_idempotency_keys").select("message_log_id,status").eq("tenant_id", tenantId).eq("idempotency_key", key).maybeSingle();
  if (reservation.error) throw new ClaimEmailError("claim_email_log_unavailable");
  if (!reservation.data) return null;
  const logId = reservation.data.message_log_id;
  if (logId) {
    const log = await admin.from("message_logs").select("id,status,provider_message_id,metadata").eq("tenant_id", tenantId).eq("id", logId).maybeSingle();
    if (log.error) throw new ClaimEmailError("claim_email_log_unavailable");
    if (log.data?.status === "sent" && log.data?.provider_message_id) return { ok: true, status: "sent", duplicate: true, logId, providerMessageId: log.data.provider_message_id, idempotencyKey: key };
    if (log.data?.metadata?.delivery_uncertain) return { ok: false, status: "unconfirmed", error: "claim_email_delivery_unconfirmed", logId };
  }
  return { ok: false, status: "duplicate_blocked", error: "claim_email_duplicate_blocked", logId: logId || undefined };
}

async function loadOriginal(admin: any, file: any): Promise<EmailBinaryAttachment> {
  checkedFilename(file.fileName);
  if (!Number.isSafeInteger(file.byteSize) || file.byteSize <= 0 || file.byteSize > 12 * 1024 * 1024
    || typeof file.bucket !== "string" || typeof file.storagePath !== "string" || !file.storagePath || /(^|\/)\.\.(\/|$)|\\/.test(file.storagePath) || hasControlCharacters(file.storagePath)) throw new ClaimEmailError("claim_email_attachment_unavailable");
  const downloaded = await admin.storage.from(file.bucket).download(file.storagePath);
  if (downloaded.error || !downloaded.data || downloaded.data.size !== file.byteSize) throw new ClaimEmailError("claim_email_attachment_unavailable");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (bytes.byteLength !== file.byteSize || !validAttachmentMagic(bytes, file.mimeType)) throw new ClaimEmailError("claim_email_attachment_changed");
  const hash = await sha256Hex(bytes);
  if (file.sha256 && (!HASH.test(file.sha256) || hash !== file.sha256)) throw new ClaimEmailError("claim_email_attachment_changed");
  return { id: file.id, fileName: file.fileName, mimeType: file.mimeType, bytes, sha256: hash };
}

/** This dedicated action never trusts client subjects, recipients, URLs or paths. */
export async function handleClaimEngineerEmailAction(ctx: ActionContext): Promise<Record<string, any>> {
  const { admin, caller, profile, userId, body, request } = ctx;
  const tenantId = profile.tenant_id;
  let logId: string | null = null, key: string | null = null;
  let metadata: Record<string, any> = {}, providerStarted = false, providerId: string | null = null;
  const updateKey = (status: string) => admin.from("message_idempotency_keys").update({ status, ...(logId ? { message_log_id: logId } : {}) }).eq("tenant_id", tenantId).eq("idempotency_key", key);
  try {
    if (!UUID.test(String(body.claim_id || "")) || (body.entry_id != null && !UUID.test(String(body.entry_id)))) throw new ClaimEmailError("claim_email_invalid_context");
    if (body.language !== "en" && body.language !== "ar") throw new ClaimEmailError("claim_email_invalid_language");
    const language: "ar" | "en" = body.language;
    const templateId = claimEmailTemplateId(body.template_id);
    if (body.test_mode !== undefined && typeof body.test_mode !== "boolean") throw new ClaimEmailError("claim_email_invalid_recipient_mode");
    const recipientMode = body.recipient_mode ?? (body.test_mode === true ? "owner_test" : "engineer");
    if (!["engineer", "owner_test"].includes(recipientMode) || (recipientMode === "owner_test" && body.test_mode !== true) || (recipientMode === "engineer" && body.test_mode === true)) throw new ClaimEmailError("claim_email_invalid_recipient_mode");
    const testMode = recipientMode === "owner_test";
    if (testMode && profile.role !== "admin") throw new ClaimEmailError("claim_email_owner_test_forbidden");
    if (testMode && body.action === "send_claim_engineer_email" && body.confirm_owner_test !== true) throw new ClaimEmailError("claim_email_owner_test_confirmation_required");
    const resolveInput = { admin, caller, tenantId, claimId: body.claim_id, entryId: body.entry_id || undefined, language, role: profile.role, templateId, testMode };
    const resolvedPacket = await (ctx.resolvePacket || resolveClaimEngineerPacket)(resolveInput);
    const configuration = await gmailConfiguration(admin, tenantId);
    const ownerMailboxMatches = configuration.safe.fromEmail.toLowerCase() === CLAIM_EMAIL_OWNER_TEST_ADDRESS.toLowerCase();
    const ownerTestAllowed = profile.role === "admin" && ownerMailboxMatches;
    if (testMode && !ownerMailboxMatches) throw new ClaimEmailError("claim_email_owner_test_mailbox_mismatch");
    const packet = { ...resolvedPacket, templateId, recipient: testMode ? { id: "owner_test", name: "Owner", email: CLAIM_EMAIL_OWNER_TEST_ADDRESS } : resolvedPacket.recipient, recipientMode, ownerTestAllowed };
    // The resolver has already enforced the saved engineer, claim and visit scope.
    const recipientEmail = checkedEmail(packet.recipient.email);
    if (body.action === "prepare_claim_engineer_email") return { ok: true, packet: { ...packet, gmail: configuration.safe, body: summary(packet, language), limitBytes: CLAIM_EMAIL_LIMIT_BYTES } };
    if (body.action !== "send_claim_engineer_email") throw new ClaimEmailError("claim_email_invalid_action");
    if (!configuration.safe.enabled) throw new ClaimEmailError("claim_email_gmail_disabled");
    if (!configuration.safe.configured) throw new ClaimEmailError("claim_email_gmail_not_configured");
    if (typeof body.context_hash !== "string" || !HASH.test(body.context_hash) || body.context_hash !== packet.contextHash) throw new ClaimEmailError("claim_email_context_changed");
    const note = body.note === undefined ? "" : body.note;
    if (typeof note !== "string" || note.length > 2000 || note.includes("\0")) throw new ClaimEmailError("claim_email_invalid_note");
    if (!Array.isArray(body.selected_attachment_ids) || body.selected_attachment_ids.length > 500 || body.selected_attachment_ids.some((id: unknown) => typeof id !== "string")) throw new ClaimEmailError("claim_email_invalid_selection");
    const selectedIds = [...new Set<string>(body.selected_attachment_ids)].sort();
    if (selectedIds.length !== body.selected_attachment_ids.length) throw new ClaimEmailError("claim_email_invalid_selection");
    const modernDescriptors = Array.isArray(packet.generatedDocuments) ? packet.generatedDocuments : null;
    const generatedDescriptors = modernDescriptors || (packet.technicalDeclaration ? [{ id: "technical:" + packet.technicalDeclaration.id, kind: "technical_declaration", sourceKind: "technical_declaration", sourceId: packet.technicalDeclaration.id, sourceHash: packet.technicalDeclaration.sourceHash, fileName: packet.technicalDeclaration.fileName }] : []);
    // Legacy callers send technical_pdf separately. Modern callers select every
    // generated document explicitly and may omit the optional technical form.
    const technicalDescriptor = generatedDescriptors.find(file => file.kind === "technical_declaration");
    if ((!modernDescriptors || body.technical_pdf != null) && technicalDescriptor && !selectedIds.includes(technicalDescriptor.id)) selectedIds.push(technicalDescriptor.id);
    selectedIds.sort();
    const allowedIds = new Set([...packet.attachments.map(file => file.id), ...generatedDescriptors.map(file => file.id)]);
    if (selectedIds.some(id => !allowedIds.has(id))) throw new ClaimEmailError("claim_email_context_changed");
    const originals = packet.attachments.filter(file => selectedIds.includes(file.id));
    const selectedGenerated = generatedDescriptors.filter(file => selectedIds.includes(file.id)).sort((a, b) => a.id.localeCompare(b.id));
    if (body.generated_pdfs !== undefined && !Array.isArray(body.generated_pdfs)) throw new ClaimEmailError("claim_email_invalid_selection");
    const submittedPdfs: any[] = body.generated_pdfs || [];
    if (submittedPdfs.length > 100 || new Set(submittedPdfs.map(file => file?.id)).size !== submittedPdfs.length || submittedPdfs.some(file => !file || typeof file.id !== "string" || !selectedGenerated.some(source => source.id === file.id))) throw new ClaimEmailError("claim_email_invalid_selection");
    const attachments: EmailBinaryAttachment[] = [];
    let generatedBytes = 0;
    for (const descriptor of selectedGenerated) {
      const submitted = submittedPdfs.find(file => file.id === descriptor.id) || (descriptor.kind === "technical_declaration" ? body.technical_pdf : null);
      if (!submitted || submitted.sourceHash !== descriptor.sourceHash || !HASH.test(String(submitted.sha256 || ""))) throw new ClaimEmailError("claim_email_context_changed");
      const bytes = decodeTechnicalPdf(submitted.base64);
      const hash = await sha256Hex(bytes);
      if (hash !== submitted.sha256) throw new ClaimEmailError("claim_email_technical_pdf_invalid");
      generatedBytes += bytes.byteLength;
      if (generatedBytes > CLAIM_EMAIL_GENERATED_TOTAL_BYTES) throw new ClaimEmailError("claim_email_too_large");
      attachments.push({ id: descriptor.id, fileName: checkedFilename(descriptor.fileName), mimeType: "application/pdf", bytes, sha256: hash });
    }
    if (!technicalDescriptor && body.technical_pdf != null) throw new ClaimEmailError("claim_email_context_changed");
    if (!originals.length && !attachments.length) throw new ClaimEmailError("claim_email_empty_selection");
    const expectedBytes = originals.reduce((sum, file) => sum + file.byteSize, 0) + attachments.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes > CLAIM_EMAIL_LIMIT_BYTES) throw new ClaimEmailError("claim_email_too_large");
    key = "claim-engineer-email:v2:" + await sha256Hex(JSON.stringify({ tenantId, action: ACTION, contextHash: packet.contextHash, templateId, recipientMode, recipientEmail, selectedIds, note: note.trim(), language, generatedSources: selectedGenerated.map(file => ({ id: file.id, sourceHash: file.sourceHash })) }));
    const existing = await currentDuplicate(admin, tenantId, key);
    if (existing) return existing;
    if (!await ctx.rateAllowed(recipientEmail)) throw new ClaimEmailError("rate_limited");
    // Only trusted bucket/path references from the resolver reach Storage SDK.
    // Sequential reads bound memory; all selected files must pass before Gmail.
    for (const file of originals) attachments.push(await loadOriginal(caller, file));
    const message = summary(packet, language) + (note.trim() ? "\n\n" + note.trim() : "");
    if (message.length > 16000) throw new ClaimEmailError("claim_email_message_too_long");
    const rfcMessageId = `<${key.replaceAll(":", "-")}@aaed2.invalid>`;
    const mime = buildClaimEmailMime({ from: configuration.safe.fromEmail, to: recipientEmail, subject: packet.subject, text: message, messageId: rfcMessageId, attachments });
    // Refresh can fail without any possible delivery. Do it before reservation.
    const token = await refreshGmailToken(configuration.credentials, request);
    // Downloads and OAuth can take time. Fence saved engineer/visit/signature
    // changes once more immediately before owning a send attempt.
    const currentPacket = await (ctx.resolvePacket || resolveClaimEngineerPacket)(resolveInput);
    if (currentPacket.contextHash !== packet.contextHash) throw new ClaimEmailError("claim_email_context_changed");
    const currentConfiguration = await gmailConfiguration(admin, tenantId);
    if (testMode && currentConfiguration.safe.fromEmail.toLowerCase() !== CLAIM_EMAIL_OWNER_TEST_ADDRESS.toLowerCase()) throw new ClaimEmailError("claim_email_owner_test_mailbox_mismatch");
    if (!currentConfiguration.safe.enabled) throw new ClaimEmailError("claim_email_gmail_disabled");
    if (!currentConfiguration.safe.configured) throw new ClaimEmailError("claim_email_gmail_not_configured");
    if (currentConfiguration.safe.fromEmail !== configuration.safe.fromEmail || JSON.stringify(currentConfiguration.credentials) !== JSON.stringify(configuration.credentials)) throw new ClaimEmailError("claim_email_context_changed");
    const reservation = await admin.from("message_idempotency_keys").insert({ tenant_id: tenantId, idempotency_key: key, channel: "email", recipient: recipientEmail, logical_action: ACTION, status: "reserved" });
    if (reservation.error) {
      if (reservation.error.code === "23505") return await currentDuplicate(admin, tenantId, key) || { ok: false, error: "claim_email_duplicate_blocked" };
      throw new ClaimEmailError("claim_email_log_unavailable");
    }
    metadata = { action: ACTION, subject: packet.subject, entry_id: packet.entryId, entry_number: packet.entryNumber, engineer_id: testMode ? null : packet.recipient.id, template_id: templateId, recipient_mode: recipientMode, owner_test_confirmed: testMode, context_hash: packet.contextHash, language, rfc_message_id: rfcMessageId, status_summary: packet.statusSummary || [], attachments: attachments.map(file => {
      const source = originals.find(original => original.id === file.id);
      const generatedSource = selectedGenerated.find(descriptor => descriptor.id === file.id);
      return { id: file.id, file_name: file.fileName, mime_type: file.mimeType, file_size: file.bytes.byteLength, sha256: file.sha256, source_kind: source?.sourceKind || generatedSource?.sourceKind, source_id: source?.sourceId || generatedSource?.sourceId, storage_bucket: source?.bucket || null, storage_path: source?.storagePath || null, source_hash: generatedSource?.sourceHash || null, technical_source_hash: generatedSource?.kind === "technical_declaration" ? generatedSource.sourceHash : null };
    }), total_attachment_bytes: attachments.reduce((sum, file) => sum + file.bytes.byteLength, 0), mime_bytes: mime.byteLength };
    const inserted = await admin.from("message_logs").insert({ tenant_id: tenantId, user_id: userId, created_by: userId, claim_id: packet.claimId, channel: "email", direction: "outbound", message_type: "document", template_key: ACTION, template_type: ACTION, recipient_email: recipientEmail, message, body: message, status: "queued", provider: "gmail", queued_at: new Date().toISOString(), idempotency_key: key, metadata }).select("id").single();
    if (inserted.error || !inserted.data?.id) { await updateKey("failed"); throw new ClaimEmailError("claim_email_log_unavailable"); }
    logId = inserted.data.id;
    const savedAttachments = await admin.from("message_attachments").insert(metadata.attachments.map((file: any) => ({ tenant_id: tenantId, message_log_id: logId, storage_path: file.storage_path, file_name: file.file_name, mime_type: file.mime_type, file_size: file.file_size, attachment_type: file.mime_type.startsWith("image/") ? "image" : "document", direction: "outbound" })));
    if (savedAttachments.error || (await updateKey("queued")).error) throw new ClaimEmailError("claim_email_log_unavailable");
    providerStarted = true;
    providerId = await sendGmailMime(mime, token, request);
    const saved = await admin.from("message_logs").update({ status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString(), metadata: { ...metadata, provider_accepted: true }, provider_response: { status: "accepted", providerMessageId: providerId } }).eq("tenant_id", tenantId).eq("id", logId).in("status", ["pending", "queued"]).select("id,status,provider_message_id").maybeSingle();
    if (saved.error || saved.data?.id !== logId || saved.data.status !== "sent" || saved.data.provider_message_id !== providerId || (await updateKey("sent")).error) throw new ClaimEmailError("claim_email_delivery_unconfirmed", true);
    return { ok: true, status: "sent", logId, providerMessageId: providerId, idempotencyKey: key };
  } catch (error) {
    const candidate = error as { code?: string; message?: string; entries?: unknown[]; uncertain?: boolean };
    const code = /^claim_email_[a-z_]+$/.test(candidate.code || candidate.message || "") ? (candidate.code || candidate.message)! : candidate.code === "rate_limited" ? "rate_limited" : "claim_email_unavailable";
    const uncertain = candidate.uncertain === true || (providerStarted && !(error instanceof ClaimEmailError));
    if (logId) {
      // Never turn an unknown Gmail outcome into a safely retryable failure.
      const patch = uncertain ? { metadata: { ...metadata, delivery_uncertain: true, ...(providerId ? { accepted_provider_message_id: providerId } : {}) }, failure_code: "claim_email_delivery_unconfirmed", failure_reason: "Provider outcome or message persistence is unconfirmed." }
        : { status: "failed", failed_at: new Date().toISOString(), failure_code: code, failure_reason: code };
      try { await admin.from("message_logs").update(patch).eq("tenant_id", tenantId).eq("id", logId).in("status", ["pending", "queued"]); await updateKey(uncertain ? "queued" : "failed"); } catch { /* The existing reservation still blocks a second send. */ }
    }
    return { ok: false, ...(uncertain ? { status: "unconfirmed" } : {}), error: uncertain ? "claim_email_delivery_unconfirmed" : code, ...(logId ? { logId } : {}), ...(Array.isArray(candidate.entries) ? { entries: candidate.entries } : {}) };
  }
}
