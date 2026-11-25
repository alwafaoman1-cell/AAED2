// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createUnifiedMessageHandler } from "../../supabase/functions/unified-message-send/handler.ts";
import { buildClaimEmailMime, CLAIM_EMAIL_REQUEST_BYTES, CLAIM_EMAIL_TECHNICAL_PDF_BYTES, decodeTechnicalPdf, readBoundedMessageJson, sha256Hex } from "../../supabase/functions/unified-message-send/gmailAttachments.ts";

const TENANT = "11111111-1111-4111-8111-111111111111", USER = "22222222-2222-4222-8222-222222222222";
const CLAIM = "33333333-3333-4333-8333-333333333333", ENTRY = "44444444-4444-4444-8444-444444444444";
const PDF = new TextEncoder().encode("%PDF-1.7\nOriginal claim document\n%%EOF");
const PHOTO = new Uint8Array([255, 216, 255, 0, 128, 42, 255, 217]);
const TECH = new TextEncoder().encode("%PDF-1.7\nSigned declaration\n%%EOF");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function fixture() {
  const packet = { claimId: CLAIM, entryId: ENTRY, entryNumber: "ENT-TEST-01", subject: "C/004/15/26/2510/00103 HONDA ACCORD 61905/M", recipient: { id: "engineer-1", name: "Test Engineer", email: "engineer@example.invalid" }, contextHash: "a".repeat(64), attachments: [
    { id: "document:original-1", kind: "source_document", sourceKind: "document_file", sourceId: "file-1", fileName: "Original Claim.pdf", mimeType: "application/pdf", byteSize: PDF.length, sha256: await sha256Hex(PDF), bucket: "temo-documents", storagePath: TENANT + "/operational/original.pdf" },
    { id: "media:original-2", kind: "vehicle_photo", sourceKind: "vehicle_media", sourceId: "media-2", fileName: "صورة المركبة.jpg", mimeType: "image/jpeg", byteSize: PHOTO.length, bucket: "vehicle-media", storagePath: TENANT + "/vehicle/original.jpg" },
  ], technicalDeclaration: { id: "declaration-1", revision: 1, sourceHash: "b".repeat(64), formData: { signature: "preserved" }, fileName: "Technical Declaration.pdf" }, warnings: [], limitBytes: 20 * 1024 * 1024 };
  const state = { authenticated: true, active: true, enabled: true, configured: true, role: "insurance", resolverError: null as any, rateError: false,
    oauthFails: false, changeDuringRefresh: false, provider: "success", logInsertFails: false, attachmentLogFails: false, sentLogFails: false, logReadbackMissing: false,
    keys: new Map<string, any>(), logs: new Map<string, any>(), attachmentRows: [] as any[], downloaded: [] as string[], requests: [] as { url: string; options: RequestInit }[], mime: [] as Uint8Array[],
    unavailable: false, tampered: false, wrongSize: false, callerStorageDenied: false, fromEmail: "workshop@example.invalid", changeSenderDuringRefresh: false };
  function from(table: string) {
    let action = "select", payload: any, head = false;
    const filters: Record<string, any> = {};
    const chain: any = {
      select(_columns: string, options?: any) { head = Boolean(options?.head); return chain; },
      insert(value: any) { action = "insert"; payload = value; return chain; },
      update(value: any) { action = "update"; payload = value; return chain; },
      eq(key: string, value: any) { filters[key] = value; return chain; },
      in(key: string, value: any) { filters[key] = value; return chain; },
      gte() { return chain; },
      single: () => execute(), maybeSingle: () => execute(),
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
    };
    async function execute(): Promise<any> {
      if (table === "profiles") return { data: { user_id: USER, tenant_id: TENANT, role: state.role, account_status: state.active ? "active" : "disabled", disabled_at: null } };
      if (table === "tenant_integrations") {
        expect(filters.tenant_id).toBe(TENANT); expect(filters.provider).toBe("gmail");
        return { data: { enabled: state.enabled, config: { from_email: state.fromEmail, client_id: "test-client" }, secrets: state.configured ? { client_secret: "test-secret", refresh_token: "test-refresh" } : {} } };
      }
      if (table === "message_idempotency_keys") {
        if (action === "insert") {
          if (state.keys.has(payload.idempotency_key)) return { error: { code: "23505" } };
          state.keys.set(payload.idempotency_key, { ...payload }); return { data: null };
        }
        const row = state.keys.get(filters.idempotency_key);
        if (row && action === "update") Object.assign(row, payload);
        return { data: row ? { ...row } : null };
      }
      if (table === "message_logs") {
        if (head) return state.rateError ? { error: { code: "57014" } } : { count: 0 };
        if (action === "insert") {
          if (state.logInsertFails) return { error: { code: "57014" } };
          const id = crypto.randomUUID(); state.logs.set(id, { ...payload, id }); return { data: { id } };
        }
        const row = state.logs.get(filters.id);
        if (action === "update" && row) {
          if (payload.status === "sent" && state.sentLogFails) return { error: { code: "57014" } };
          if (!filters.status || filters.status.includes(row.status)) Object.assign(row, payload);
          if (payload.status === "sent" && state.logReadbackMissing) return { data: null };
        }
        return { data: row ? { ...row } : null };
      }
      if (table === "message_attachments" && action === "insert") {
        if (state.attachmentLogFails) return { error: { code: "57014" } };
        state.attachmentRows.push(...payload); return { data: null };
      }
      throw new Error("Unexpected table " + table);
    }
    return chain;
  }
  const admin = { from, storage: { from: (bucket: string) => ({ download: async (path: string) => {
    state.downloaded.push(bucket + "/" + path);
    if (state.unavailable) return { data: null, error: { code: "404" } };
    let bytes = path.endsWith(".pdf") ? PDF : PHOTO;
    if (state.tampered && path.endsWith(".pdf")) { bytes = bytes.slice(); bytes[bytes.length - 1] ^= 1; }
    if (state.wrongSize) bytes = bytes.subarray(1);
    return { data: new Blob([bytes]), error: null };
  } }) } };
  const request = async (input: any, options: RequestInit = {}) => {
    const url = String(input); state.requests.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") {
      if (state.changeDuringRefresh) packet.contextHash = "c".repeat(64);
      if (state.changeSenderDuringRefresh) state.fromEmail = "other-workshop@example.invalid";
      return state.oauthFails ? Response.json({ error: "invalid_grant" }, { status: 401 }) : Response.json({ access_token: "test-access-token" });
    }
    expect(url).toBe("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media");
    expect(new Headers(options.headers).get("content-type")).toBe("message/rfc822");
    state.mime.push(new Uint8Array(await new Response(options.body).arrayBuffer()));
    if (state.provider === "timeout") throw new Error("Synthetic ambiguous network outcome");
    if (state.provider === "missing_id") return Response.json({});
    if (state.provider === "server_error") return Response.json({ error: "private provider detail" }, { status: 503 });
    if (state.provider === "reject") return Response.json({ error: "private provider detail" }, { status: 400 });
    return Response.json({ id: "gmail_test_123" });
  };
  const handler = createUnifiedMessageHandler({
    createClient: (_url, key) => key === "anon" ? { storage: { from: (bucket: string) => ({ download: async (path: string) => state.callerStorageDenied ? { data: null, error: { code: "403" } } : admin.storage.from(bucket).download(path) }) }, auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: USER } : null } }) } } : admin,
    env: name => ({ SUPABASE_URL: "https://development.invalid", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "test-service" } as any)[name],
    request: request as typeof fetch,
    resolveClaimEngineerPacket: (async (context: any) => {
      expect(context.tenantId).toBe(TENANT); expect(context.claimId).toBe(CLAIM); expect(context.entryId).toBe(ENTRY);
      if (state.resolverError) throw state.resolverError;
      return structuredClone(packet);
    }) as any,
  });
  const defaults = { action: "send_claim_engineer_email", claim_id: CLAIM, entry_id: ENTRY, language: "en", context_hash: packet.contextHash, selected_attachment_ids: packet.attachments.map(file => file.id), note: "Reviewed original files", technical_pdf: { sourceHash: packet.technicalDeclaration.sourceHash, base64: b64(TECH), sha256: await sha256Hex(TECH) } };
  async function send(extra: Record<string, any> = {}) {
    const response = await handler(new Request("https://development.invalid/functions/v1/unified-message-send", { method: "POST", headers: { Authorization: "Bearer test-user", "Content-Type": "application/json" }, body: JSON.stringify({ ...defaults, ...extra }) }));
    return { status: response.status, body: await response.json() };
  }
  return { state, packet, defaults, handler, send };
}

function attachmentParts(mime: Uint8Array) {
  const text = new TextDecoder().decode(mime), boundary = /boundary="([^"]+)"/.exec(text)![1];
  return text.split("--" + boundary).filter(part => part.includes("Content-Disposition: attachment;")).map(part => {
    const split = part.indexOf("\r\n\r\n"), headers = part.slice(0, split);
    const continued = [...headers.matchAll(/filename\*(\d+)\*=([^;\r\n]*)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map(item => item[2]).join("");
    const encoded = continued || /filename\*=([^;\r\n]*)/.exec(headers)![1];
    return { name: decodeURIComponent(encoded.replace(/^UTF-8''/, "")), mime: /Content-Type: ([^\r\n]+)/.exec(headers)![1], bytes: Buffer.from(part.slice(split + 4).trim(), "base64") };
  });
}

describe("claim engineer Gmail packet", () => {
  it("makes technical optional for modern explicit document selection and sends selected generated snapshots individually", async () => {
    const f = await fixture();
    (f.packet as any).generatedDocuments = [{ id: "technical:" + f.packet.technicalDeclaration.id, kind: "technical_declaration", sourceKind: "technical_declaration", sourceId: f.packet.technicalDeclaration.id, sourceHash: f.packet.technicalDeclaration.sourceHash, fileName: "Technical Declaration.pdf" }, { id: "entry:signed-1", kind: "signed_intake", sourceKind: "intake_receipt", sourceId: "signed-1", sourceHash: "c".repeat(64), fileName: "Signed entry.pdf" }];
    (f.packet as any).statusSummary = [{ key: "running_status", label: "Vehicle running condition", value: "Vehicle does not run", source: "vehicle_entry" }];
    const result = await f.send({ template_id: "invoice_submission", technical_pdf: undefined, selected_attachment_ids: [...f.defaults.selected_attachment_ids, "entry:signed-1"], generated_pdfs: [{ id: "entry:signed-1", sourceHash: "c".repeat(64), base64: b64(TECH), sha256: await sha256Hex(TECH) }] });
    expect(result.body.ok).toBe(true); const parts = attachmentParts(f.state.mime[0]); expect(parts.map(part => part.name)).toContain("Signed entry.pdf"); expect(parts.map(part => part.name)).not.toContain("Technical Declaration.pdf");
    const log = [...f.state.logs.values()][0]; expect(log.body).toContain("Vehicle running condition: Vehicle does not run"); expect(log.metadata.template_id).toBe("invoice_submission"); expect(log.metadata.attachments.find((file: any) => file.id === "entry:signed-1")).toMatchObject({ source_kind: "intake_receipt", source_hash: "c".repeat(64) });
  });
  it("strictly validates templates/owner-test mode on prepare and send, with an explicit admin confirmation", async () => {
    const f = await fixture();
    expect((await f.send({ action: "prepare_claim_engineer_email", template_id: "untrusted" })).body.error).toBe("claim_email_invalid_template");
    expect((await f.send({ action: "prepare_claim_engineer_email", recipient_mode: "owner_test", test_mode: true })).body.error).toBe("claim_email_owner_test_forbidden");
    f.state.role = "admin";
    expect((await f.send({ recipient_mode: "owner_test", test_mode: true })).body.error).toBe("claim_email_owner_test_confirmation_required");
    expect((await f.send({ recipient_mode: "engineer", test_mode: true, confirm_owner_test: true })).body.error).toBe("claim_email_invalid_recipient_mode");
    expect((await f.send({ recipient_mode: "owner_test", test_mode: false, confirm_owner_test: true })).body.error).toBe("claim_email_invalid_recipient_mode");
    expect(f.state.requests).toHaveLength(0);
    f.state.fromEmail = "alwafa.oman1@gmail.com";
    const result = await f.send({ recipient_mode: "owner_test", test_mode: true, confirm_owner_test: true, recipient_email: "untrusted@example.invalid" });
    expect(result.body.ok).toBe(true); expect(new TextDecoder().decode(f.state.mime[0])).toContain("To: alwafa.oman1@gmail.com\r\n");
    const log = [...f.state.logs.values()][0]; expect(log.metadata).toMatchObject({ engineer_id: null, recipient_mode: "owner_test", owner_test_confirmed: true });
    expect(f.packet.recipient.email).toBe("engineer@example.invalid");
  });
  it("binds recipient and template into the deterministic send key", async () => {
    const f = await fixture(); f.state.role = "admin"; f.state.fromEmail = "alwafa.oman1@gmail.com"; await f.send(); await f.send({ template_id: "work_order_update" }); await f.send({ recipient_mode: "owner_test", test_mode: true, confirm_owner_test: true });
    expect(f.state.keys.size).toBe(3); expect(f.state.mime).toHaveLength(3);
    expect([...f.state.logs.values()].map(log => log.recipient_email)).toEqual(["engineer@example.invalid", "engineer@example.invalid", "alwafa.oman1@gmail.com"]);
  });
  it("denies another configured workshop mailbox on both owner-test prepare and send without provider calls", async () => {
    const f = await fixture(); f.state.role = "admin"; f.state.fromEmail = "another-workshop@example.invalid"; (f.packet as any).ownerTestAllowed = true;
    const normal = await f.send({ action: "prepare_claim_engineer_email" }); expect(normal.body.packet.ownerTestAllowed).toBe(false);
    const mode = { recipient_mode: "owner_test", test_mode: true, confirm_owner_test: true };
    expect((await f.send({ ...mode, action: "prepare_claim_engineer_email" })).body.error).toBe("claim_email_owner_test_mailbox_mismatch");
    expect((await f.send(mode)).body.error).toBe("claim_email_owner_test_mailbox_mismatch");
    expect(f.state.requests).toHaveLength(0); expect(f.state.downloaded).toHaveLength(0); expect(f.state.keys.size).toBe(0); expect(f.state.logs.size).toBe(0);
    expect((await f.send()).body.ok).toBe(true); // Ordinary engineer delivery is unchanged.
  });
  it("allows the matching configured owner mailbox and rechecks it before sending", async () => {
    const f = await fixture(); f.state.role = "admin"; f.state.fromEmail = " ALWAFA.OMAN1@GMAIL.COM ";
    const mode = { recipient_mode: "owner_test", test_mode: true, confirm_owner_test: true };
    const prepared = await f.send({ ...mode, action: "prepare_claim_engineer_email" }); expect(prepared.body.packet.ownerTestAllowed).toBe(true);
    f.state.changeSenderDuringRefresh = true;
    expect((await f.send(mode)).body.error).toBe("claim_email_owner_test_mailbox_mismatch"); expect(f.state.mime).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it("requires each selected generated PDF to match its own server source hash and ignores unselected snapshots", async () => {
    const f = await fixture(); (f.packet as any).generatedDocuments = [{ id: "entry:one", kind: "signed_intake", sourceKind: "intake_receipt", sourceId: "one", sourceHash: "c".repeat(64), fileName: "Signed Entry.pdf" }];
    const selection = { technical_pdf: undefined, selected_attachment_ids: ["entry:one"], generated_pdfs: [{ id: "entry:one", sourceHash: "d".repeat(64), base64: b64(TECH), sha256: await sha256Hex(TECH) }] };
    expect((await f.send(selection)).body.error).toBe("claim_email_context_changed");
    expect((await f.send({ ...selection, selected_attachment_ids: f.defaults.selected_attachment_ids })).body.error).toBe("claim_email_invalid_selection");
    expect((await f.send({ ...selection, generated_pdfs: [] })).body.error).toBe("claim_email_context_changed"); expect(f.state.requests).toHaveLength(0);
  });
  it("prepares safely without downloads, tokens, logs or exposing credential fields", async () => {
    const f = await fixture(); const result = await f.send({ action: "prepare_claim_engineer_email" });
    expect(result.body.ok).toBe(true); expect(result.body.packet.gmail).toEqual({ enabled: true, configured: true, fromEmail: "workshop@example.invalid" });
    expect(result.body.packet.body).toContain(f.packet.subject); expect(result.body.packet.body).not.toMatch(/[\u0600-\u06ff]/);
    expect(JSON.stringify(result.body)).not.toContain("test-secret"); expect(JSON.stringify(result.body)).not.toContain("test-refresh");
    expect(f.state.requests).toHaveLength(0); expect(f.state.downloaded).toHaveLength(0); expect(f.state.logs.size).toBe(0);
  });
  it("sends ONE email with each exact original and technical PDF as separate named MIME parts", async () => {
    const f = await fixture(); const result = await f.send({ recipient_email: "attacker@example.invalid", subject: "untrusted subject", attachments: [{ url: "https://untrusted.invalid/file" }] });
    expect(result.body).toMatchObject({ ok: true, status: "sent", providerMessageId: "gmail_test_123" }); expect(result.body.logId).toBeTruthy();
    expect(f.state.mime).toHaveLength(1); const text = new TextDecoder().decode(f.state.mime[0]);
    expect(text).toContain("Subject: " + f.packet.subject + "\r\n"); expect(text).toContain("To: engineer@example.invalid\r\n");
    expect(text).not.toContain("attacker@example.invalid"); expect(text).not.toContain("untrusted.invalid");
    const parts = attachmentParts(f.state.mime[0]); expect(parts).toHaveLength(3);
    for (const [name, bytes, mime] of [["Original Claim.pdf", PDF, "application/pdf"], ["صورة المركبة.jpg", PHOTO, "image/jpeg"], ["Technical Declaration.pdf", TECH, "application/pdf"]] as const) {
      const part = parts.find(item => item.name === name)!; expect(part.mime).toBe(mime); expect(part.bytes).toEqual(Buffer.from(bytes));
    }
    expect(f.state.requests.map(call => new URL(call.url).hostname)).toEqual(["oauth2.googleapis.com", "gmail.googleapis.com"]);
    expect(f.state.attachmentRows).toHaveLength(3);
    const log = [...f.state.logs.values()][0]; expect(log).toMatchObject({ status: "sent", provider: "gmail", provider_message_id: "gmail_test_123", claim_id: CLAIM });
    expect(log.metadata.subject).toBe(f.packet.subject); expect(log.metadata.attachments).toHaveLength(3);
    expect(log.metadata.attachments.every((file: any) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });
  it("reserves concurrently and never sends a second copy, including a changed PDF creation timestamp", async () => {
    const f = await fixture(); const results = await Promise.all(Array.from({ length: 8 }, () => f.send()));
    expect(results.some(result => result.body.ok)).toBe(true); expect(f.state.mime).toHaveLength(1); expect(f.state.logs.size).toBe(1); expect(f.state.keys.size).toBe(1);
    const regenerated = new TextEncoder().encode("%PDF-1.7\nSigned declaration different CreationDate\n%%EOF");
    const repeated = await f.send({ technical_pdf: { sourceHash: f.packet.technicalDeclaration.sourceHash, base64: b64(regenerated), sha256: await sha256Hex(regenerated) } });
    expect(repeated.body).toMatchObject({ ok: true, status: "sent", duplicate: true }); expect(f.state.mime).toHaveLength(1);
  });
  it("keys the whole selection and note rather than the first attachment only", async () => {
    const f = await fixture(); await f.send({ selected_attachment_ids: [f.packet.attachments[0].id] }); await f.send(); await f.send({ note: "Explicit changed note" });
    expect(f.state.keys.size).toBe(3); expect(f.state.mime).toHaveLength(3);
  });
  it("returns ambiguous visits explicitly without touching Gmail", async () => {
    const f = await fixture(); f.state.resolverError = Object.assign(new Error("claim_email_visit_required"), { code: "claim_email_visit_required", entries: [{ id: ENTRY, entryNumber: "ENT-TEST-01" }] });
    expect((await f.send({ action: "prepare_claim_engineer_email" })).body).toMatchObject({ ok: false, error: "claim_email_visit_required", entries: [{ id: ENTRY }] }); expect(f.state.requests).toHaveLength(0);
  });
  it.each(["configured", "enabled"] as const)("blocks missing %s with no sends", async field => {
    const f = await fixture(); f.state[field] = false; expect((await f.send()).body.ok).toBe(false); expect(f.state.mime).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it("fails closed on disabled staff or failed rate checks", async () => {
    const f = await fixture(); f.state.active = false; expect((await f.send()).status).toBe(403); expect(f.state.requests).toHaveLength(0);
    f.state.active = true; f.state.rateError = true; expect((await f.send()).body.ok).toBe(false); expect(f.state.mime).toHaveLength(0);
  });
  it("rejects changed context, foreign selection, invalid note and duplicate selected ids", async () => {
    const f = await fixture();
    for (const patch of [{ context_hash: "c".repeat(64) }, { selected_attachment_ids: ["document:foreign"] }, { selected_attachment_ids: [f.packet.attachments[0].id, f.packet.attachments[0].id] }, { note: "x".repeat(2001) }]) expect((await f.send(patch)).body.ok).toBe(false);
    expect(f.state.requests).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it("rechecks saved context after download/token refresh before reserving or sending", async () => {
    const f = await fixture(); f.state.changeDuringRefresh = true;
    expect((await f.send()).body.error).toBe("claim_email_context_changed"); expect(f.state.mime).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it("rejects stale, non-PDF, wrong-hash and missing technical bytes", async () => {
    const f = await fixture();
    for (const technical_pdf of [null, { ...f.defaults.technical_pdf, sourceHash: "c".repeat(64) }, { ...f.defaults.technical_pdf, base64: b64(PHOTO) }, { ...f.defaults.technical_pdf, sha256: "0".repeat(64) }]) expect((await f.send({ technical_pdf })).body.ok).toBe(false);
    expect(f.state.requests).toHaveLength(0);
  });
  it.each(["unavailable", "tampered", "wrongSize"] as const)("sends nothing if any selected source is %s", async field => {
    const f = await fixture(); f.state[field] = true; expect((await f.send()).body.ok).toBe(false); expect(f.state.mime).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it("enforces the authenticated caller's object Storage RLS without a service-role fallback", async () => {
    const f = await fixture(); f.state.callerStorageDenied = true;
    expect((await f.send()).body.error).toBe("claim_email_attachment_unavailable"); expect(f.state.requests).toHaveLength(0); expect(f.state.downloaded).toHaveLength(0);
  });
  it("blocks aggregate >20MiB before downloading or token refresh; never splits or compresses", async () => {
    const f = await fixture(); f.packet.attachments[0].byteSize = 12 * 1024 * 1024; f.packet.attachments[1].byteSize = 9 * 1024 * 1024;
    expect((await f.send()).body.error).toBe("claim_email_too_large"); expect(f.state.requests).toHaveLength(0); expect(f.state.downloaded).toHaveLength(0);
  });
  it("blocks filename/header injection before any email", async () => {
    const f = await fixture(); f.packet.attachments[0].fileName = "file.pdf\r\nBcc: attacker@example.invalid";
    expect((await f.send()).body.error).toBe("claim_email_invalid_filename"); expect(f.state.mime).toHaveLength(0);
    const g = await fixture(); g.packet.subject += "\r\nBcc: attacker@example.invalid"; expect((await g.send()).body.error).toBe("claim_email_invalid_subject"); expect(g.state.mime).toHaveLength(0);
  });
  it("does not reserve or send if OAuth refresh requires reconnection", async () => {
    const f = await fixture(); f.state.oauthFails = true; expect((await f.send()).body.error).toBe("claim_email_gmail_reconnect_required"); expect(f.state.mime).toHaveLength(0); expect(f.state.keys.size).toBe(0);
  });
  it.each(["logInsertFails", "attachmentLogFails"] as const)("never sends when initial %s cannot be persisted", async field => {
    const f = await fixture(); f.state[field] = true; expect((await f.send()).body.error).toBe("claim_email_log_unavailable"); expect(f.state.mime).toHaveLength(0);
  });
  it.each(["timeout", "missing_id", "server_error"])("keeps uncertain %s queued and prevents all automatic repeats", async provider => {
    const f = await fixture(); f.state.provider = provider; const result = await f.send();
    expect(result.body).toMatchObject({ ok: false, status: "unconfirmed", error: "claim_email_delivery_unconfirmed" });
    const log = [...f.state.logs.values()][0]; expect(log.status).toBe("queued"); expect(log.metadata.delivery_uncertain).toBe(true);
    f.state.provider = "success"; expect((await f.send()).body.error).toBe("claim_email_delivery_unconfirmed"); expect(f.state.mime).toHaveLength(1);
  });
  it("never reports success if Gmail accepted but sent-log persistence fails", async () => {
    const f = await fixture(); f.state.sentLogFails = true; expect((await f.send()).body.error).toBe("claim_email_delivery_unconfirmed");
    expect([...f.state.logs.values()][0]).toMatchObject({ status: "queued", metadata: { delivery_uncertain: true, accepted_provider_message_id: "gmail_test_123" } });
    expect((await f.send()).body.ok).toBe(false); expect(f.state.mime).toHaveLength(1);
  });
  it("returns unconfirmed if accepted sent update has no confirmed read-back", async () => {
    const f = await fixture(); f.state.logReadbackMissing = true; expect((await f.send()).body.error).toBe("claim_email_delivery_unconfirmed"); expect(f.state.mime).toHaveLength(1);
  });
  it("records a definite rejection as failed and never exposes raw provider detail", async () => {
    const f = await fixture(); f.state.provider = "reject"; const result = await f.send(); expect(result.body.error).toBe("claim_email_gmail_send_rejected");
    expect([...f.state.logs.values()][0].status).toBe("failed"); expect(JSON.stringify(result.body)).not.toContain("private provider detail");
  });
});

describe("bounded request/MIME helpers", () => {
  it("preserves long Unicode filenames with folded RFC2231 continuations and bounded header lines", () => {
    const name = "ص".repeat(180) + ".pdf";
    const mime = buildClaimEmailMime({ from: "workshop@example.invalid", to: "engineer@example.invalid", subject: "C/004/15/26/2510/00103 HONDA ACCORD 61905/M", text: "Selected attachments", messageId: "<test@aaed2.invalid>", attachments: [{ id: "original", fileName: name, mimeType: "application/pdf", bytes: PDF, sha256: "a".repeat(64) }] });
    const text = new TextDecoder().decode(mime), parts = attachmentParts(mime);
    expect(parts[0].name).toBe(name); expect(parts[0].bytes.equals(Buffer.from(PDF))).toBe(true);
    expect(text).toContain("filename*0*=UTF-8''"); expect(text).toContain("filename*1*=");
    for (const line of text.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(998);
    for (const line of text.split("\r\n").filter(line => line.startsWith(" filename"))) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(78);
    for (const segment of [...text.matchAll(/filename\*\d+\*=([^;\r\n]*)/g)]) expect(segment[1]).not.toMatch(/%(?:[A-F0-9])?$/);
  });
  it("folds subject whitespace losslessly and rejects oversized unbreakable header lines", () => {
    const subject = "CLAIM/123 " + "HONDA ACCORD ".repeat(65).trim();
    const input = { from: "workshop@example.invalid", to: "engineer@example.invalid", subject, text: "Selected attachments", messageId: "<test@aaed2.invalid>", attachments: [{ id: "original", fileName: "Original.pdf", mimeType: "application/pdf", bytes: PDF, sha256: "a".repeat(64) }] };
    const text = new TextDecoder().decode(buildClaimEmailMime(input));
    const field = /Subject: [\s\S]*?(?=\r\n[^ \t])/.exec(text)![0];
    expect(field.replace(/\r\n/g, "")).toBe("Subject: " + subject);
    for (const line of text.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(998);
    expect(() => buildClaimEmailMime({ ...input, subject: "X".repeat(998) })).toThrow("claim_email_invalid_subject");
  });
  it("encodes long non-ASCII subjects as independently valid folded UTF-8 words", () => {
    const subject = "أضرار المركبة ".repeat(40).trim();
    const mime = buildClaimEmailMime({ from: "workshop@example.invalid", to: "engineer@example.invalid", subject, text: "Selected attachments", messageId: "<test@aaed2.invalid>", attachments: [{ id: "original", fileName: "Original.pdf", mimeType: "application/pdf", bytes: PDF, sha256: "a".repeat(64) }] });
    const text = new TextDecoder().decode(mime), field = /Subject: [\s\S]*?(?=\r\n[^ \t])/.exec(text)![0];
    const words = [...field.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    expect(words.map(word => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(word[1], "base64"))).join("")).toBe(subject);
    expect(words.every(word => word[0].length <= 75)).toBe(true);
    for (const line of text.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(998);
  });
  it("accepts a valid technical PDF at the 3MiB boundary and rejects larger data", () => {
    const bytes = new Uint8Array(CLAIM_EMAIL_TECHNICAL_PDF_BYTES); bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
    expect(Buffer.from(decodeTechnicalPdf(b64(bytes))).equals(Buffer.from(bytes))).toBe(true);
    const larger = new Uint8Array(CLAIM_EMAIL_TECHNICAL_PDF_BYTES + 1); larger.set(bytes);
    expect(() => decodeTechnicalPdf(b64(larger))).toThrow();
  });
  it("enforces actual streamed bytes even with omitted or dishonest Content-Length", async () => {
    for (const headers of [{}, { "Content-Length": "1" }]) {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(CLAIM_EMAIL_REQUEST_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
      const request = new Request("https://development.invalid", { method: "POST", headers, body: stream, duplex: "half" } as any);
      await expect(readBoundedMessageJson(request)).rejects.toThrow("payload_too_large");
    }
  });
  it("retains the generic 64KiB request cap", async () => {
    const f = await fixture(); const response = await f.handler(new Request("https://development.invalid", { method: "POST", headers: { Authorization: "Bearer test-user" }, body: JSON.stringify({ channel: "email", body: "a".repeat(65536) }) }));
    expect(response.status).toBe(413); expect(f.state.requests).toHaveLength(0);
  });
  it("rejects unsafe recipient headers and unsupported MIME without making a request", () => {
    expect(() => buildClaimEmailMime({ from: "workshop@example.invalid", to: "engineer@example.invalid\r\nBcc: hidden@example.invalid", subject: "Test", text: "Test", messageId: "<test@aaed2.invalid>", attachments: [{ id: "x", fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF, sha256: "a".repeat(64) }] })).toThrow();
  });
});
