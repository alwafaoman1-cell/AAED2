import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("WhatsApp Cloud API security contract", () => {
  const root = process.cwd();
  const migration = readFileSync(resolve(root, "supabase/migrations/20260723193000_whatsapp_cloud_api_readiness.sql"), "utf8");
  const messagingService = readFileSync(resolve(root, "src/lib/messaging/messagingService.ts"), "utf8");
  const partsWhatsApp = readFileSync(resolve(root, "src/lib/partsWhatsApp.ts"), "utf8");
  const whatsappShare = readFileSync(resolve(root, "src/lib/whatsappShare.ts"), "utf8");
  const unifiedSend = readFileSync(resolve(root, "supabase/functions/unified-message-send/index.ts"), "utf8");
  const metaSend = readFileSync(resolve(root, "supabase/functions/whatsapp-meta-send/index.ts"), "utf8");
  const webhookPath = resolve(root, "supabase/functions/whatsapp-webhook/index.ts");
  const webhook = readFileSync(webhookPath, "utf8");
  const integrations = readFileSync(resolve(root, "src/pages/settings/IntegrationsSettingsPage.tsx"), "utf8");
  const integrationTest = readFileSync(resolve(root, "supabase/functions/integration-test/index.ts"), "utf8");
  const messagesCenter = readFileSync(resolve(root, "src/pages/MessagesCenter.tsx"), "utf8");

  it("routes frontend WhatsApp sends through unified-message-send only", () => {
    expect(messagingService).toContain('supabase.functions.invoke("unified-message-send"');
    expect(partsWhatsApp).toContain("sendUnifiedMessage");
    expect(whatsappShare).toContain("sendUnifiedMessage");
    expect(partsWhatsApp).not.toContain('functions.invoke("whatsapp-meta-send"');
    expect(whatsappShare).not.toContain('functions.invoke("whatsapp-meta-send"');
  });

  it("keeps whatsapp-meta-send internal and rejects browser/direct invocation", () => {
    expect(unifiedSend).toContain('/functions/v1/whatsapp-meta-send');
    expect(unifiedSend).toContain("Authorization: `Bearer ${SERVICE_KEY}`");
    expect(unifiedSend).toContain('"x-aaed-internal-secret"');
    expect(unifiedSend).toContain("WHATSAPP_INTERNAL_SHARED_SECRET");
    expect(metaSend).toContain("WHATSAPP_INTERNAL_SHARED_SECRET");
    expect(metaSend).toContain('req.headers.get("x-aaed-internal-secret")');
    expect(metaSend).toContain('return json({ ok: false, error: "forbidden" }, 403)');
    expect(metaSend).not.toContain('"Access-Control-Allow-Origin": "*"');
  });

  it("does not store or expose Meta secrets in frontend ordinary-table flows", () => {
    expect(integrations).toContain('.select("provider, enabled, config, last_test_at, last_test_status, last_test_error")');
    expect(integrations).not.toContain(".select(\"provider, enabled, config, secrets");
    expect(integrations).toContain("forbiddenMetaSecretKeys");
    expect(integrations).toContain('provider === "meta_whatsapp") payload.secrets = {}');
    expect(integrations).not.toContain('{ key: "verify_token"');
    expect(integrations).not.toContain('{ key: "app_secret"');
    expect(integrations).not.toContain('{ key: "access_token"');
    expect(integrationTest).toContain("META_WHATSAPP_ACCESS_TOKEN");
    expect(integrationTest).not.toContain("const token = sec.access_token");
  });

  it("verifies webhook signature before JSON parsing and before insert", () => {
    expect(existsSync(webhookPath)).toBe(true);
    const verifyIndex = webhook.indexOf("verifyRawSignature(req, raw)");
    const parseIndex = webhook.indexOf("JSON.parse(raw");
    const insertIndex = webhook.indexOf('.from("whatsapp_webhook_events").insert');
    expect(verifyIndex).toBeGreaterThan(0);
    expect(parseIndex).toBeGreaterThan(verifyIndex);
    expect(insertIndex).toBeGreaterThan(parseIndex);
    expect(webhook).toContain("META_WHATSAPP_APP_SECRET");
    expect(webhook).toContain("missing_signature");
    expect(webhook).toContain("app_secret_missing");
    expect(webhook).toContain("return json({ ok: false, error: signature.error }, 403)");
  });

  it("prevents status regression and duplicate status side effects", () => {
    expect(webhook).toContain("STATUS_RANK");
    expect(webhook).toContain("if (state === current.status || nextRank < currentRank) return");
    expect(webhook).toContain("sanitizeStatus");
    expect(webhook).toContain("sanitizeInboundMessage");
  });

  it("adds safe status constraints, idempotency RPC, RLS, and attachment validation", () => {
    expect(migration).toContain("message_logs_status_whatsapp_ready_check");
    expect(migration).toContain("whatsapp_logs_status_whatsapp_ready_check");
    expect(migration).toContain("'pending','queued','sent','delivered','read','failed','received','dry_run','cancelled'");
    expect(migration).toContain("create or replace function public.reserve_message_idempotency");
    expect(migration).toContain("unique (tenant_id, idempotency_key)");
    expect(migration).toContain("admin read provider whatsapp logs");
    expect(migration).toContain("admin read whatsapp webhook events");
    expect(migration).toContain('drop policy if exists "tenant read message idempotency"');
    expect(migration).toContain("message_attachments_https_url_check");
    expect(migration).toContain("message_attachments_mime_check");
    expect(migration).toContain("message_attachments_size_check");
    expect(migration).toContain("not valid");
  });

  it("sanitizes provider responses and attachment metadata", () => {
    expect(unifiedSend).toContain("sanitizeProviderResponse");
    expect(metaSend).toContain("sanitizeProviderResponse");
    expect(metaSend).toContain("validateAttachment");
    expect(whatsappShare).toContain("fileSize: uploaded.size");
    expect(whatsappShare).toContain("storagePath: uploaded.path");
    expect(metaSend).not.toContain("Authorization header");
    expect(unifiedSend).not.toContain("provider_response: wa || {}");
    expect(metaSend).not.toContain("provider_response: j");
  });

  it("uses atomic idempotency protections", () => {
    expect(unifiedSend).toContain('admin.rpc("reserve_message_idempotency"');
    expect(unifiedSend).toContain("findExistingMessageLog");
    expect(unifiedSend).toContain("duplicate_blocked");
    expect(metaSend).toContain("duplicate: true");
    expect(migration).toContain("on conflict (tenant_id, idempotency_key) do nothing");
  });

  it("keeps MessagesCenter paginated and realtime-scoped", () => {
    expect(messagesCenter).toContain("const PAGE_SIZE = 50");
    expect(messagesCenter).toContain('supabase.rpc("get_user_tenant_id")');
    expect(messagesCenter).toContain("range(0, PAGE_SIZE - 1)");
    expect(messagesCenter).toContain("filter: `tenant_id=eq.${tenantId}`");
    expect(messagesCenter).toContain("setLogs((current)");
    expect(messagesCenter).toContain("setConversations((current)");
    expect(messagesCenter).not.toContain("limit(500)");
  });
});
