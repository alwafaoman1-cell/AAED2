// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveClaimEngineerPacket } from "../../supabase/functions/unified-message-send/claimEngineerPacket.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = id(1), CLAIM = id(2), ENTRY = id(3), COMPANY = id(4), ENGINEER = id(5), VEHICLE = id(6), CUSTOMER = id(7);
type Row = Record<string, any>;
function fixture() {
  const tables: Record<string, Row[]> = {
    insurance_claims: [{ id: CLAIM, tenant_id: TENANT, customer_id: CUSTOMER, vehicle_id: VEHICLE, vehicle_entry_id: ENTRY, claim_number: "C/004/15/26/2510/00103", insurance_company_id: COMPANY, insurance_employee_id: ENGINEER, vehicle_make: "Honda", vehicle_model: "Accord", updated_at: "2026-11-24T12:00:00Z", deleted_at: null }],
    vehicle_entries: [{ id: ENTRY, tenant_id: TENANT, customer_id: CUSTOMER, vehicle_id: VEHICLE, entry_number: "ENT-2026-1", arrival_date: "2026-11-24", status: "Issued", insurance_company_id: COMPANY, insurance_claim_id: CLAIM, converted_claim_id: CLAIM, intake_revision: 2, updated_at: "2026-11-24T12:00:00Z", deleted_at: null }],
    insurance_company_employees: [{ id: ENGINEER, tenant_id: TENANT, insurance_company_id: COMPANY, name: "Selected engineer", email: "engineer@example.test", is_active: true, updated_at: "2026-11-24T12:00:00Z" }],
    vehicles: [{ id: VEHICLE, tenant_id: TENANT, brand: "Honda", model: "Accord", plate_number: "61905", plate_letters: "M", plate_country: "OM", updated_at: "2026-11-24T12:00:00Z", deleted_at: null }],
    document_files: [{ id: id(101), tenant_id: TENANT, sha256: "a".repeat(64), original_file_name: "Original police scan.PDF", mime_type: "application/pdf", byte_size: 10, access_scope: "operational", storage_bucket: "temo-documents", storage_path: `${TENANT}/operational/original.pdf`, created_at: "2026-11-24T10:00:00Z" }],
    document_links: [{ id: id(111), tenant_id: TENANT, file_id: id(101), entity_type: "claim", entity_id: CLAIM, linked_at: "2026-11-24T12:00:00Z", removed_at: null }],
    vehicle_media: [{ id: id(201), tenant_id: TENANT, vehicle_id: VEHICLE, vehicle_entry_id: ENTRY, claim_id: CLAIM, storage_bucket: "insurance-docs", storage_path: `${TENANT}/vehicle-entry/${ENTRY}/original.JPG`, file_name: "Original.JPG", mime_type: "image/jpeg", file_size: 4, media_type: "image", category: "front_view", source: "vehicle_entry", deleted_at: null }],
    vehicle_entry_signatures: [],
    vehicle_technical_declarations: [{ id: id(301), tenant_id: TENANT, vehicle_entry_id: ENTRY, revision: 3, form_data: { claim_number: "C/004/15/26/2510/00103", other_observations: "Actual saved observations", signature_data_url: "data:image/png;base64,ACTUAL-TECHNICAL-INK" }, updated_at: "2026-11-24T11:00:00Z" }],
  };
  const state = { hiddenFiles: new Set<string>(), errorTable: "", rowCap: Infinity, rpcError: false, context: null as any, frozen: null as any, calls: [] as Array<{ scope: string; table: string; filters: Row }>, rpcCalls: [] as string[], storageReads: [] as string[] };
  function client(scope: string) {
    return {
      storage: { from: (bucket: string) => ({ info: async (path: string) => { state.storageReads.push(bucket + "/" + path); return { data: { size: 50 }, error: null }; } }) },
      from(table: string) {
        const filters: Row = {}, predicates: Array<(row: Row) => boolean> = [];
        let max = Infinity, single = false;
        const query: any = {
          select() { return query; }, eq(key: string, value: any) { filters[key] = value; predicates.push(row => row[key] === value); return query; },
          is(key: string, value: any) { predicates.push(row => value === null ? row[key] == null : row[key] === value); return query; },
          in(key: string, values: any[]) { predicates.push(row => values.includes(row[key])); return query; },
          or(value: string) { predicates.push(row => value.split(",").some(filter => { const [key, operator, expected] = filter.split("."); return operator === "eq" && row[key] === expected; })); return query; },
          order() { return query; }, limit(value: number) { max = value; return query; },
          maybeSingle() { single = true; return execute(); },
          then(resolve: any, reject: any) { return execute().then(resolve, reject); },
        };
        async function execute() {
          state.calls.push({ scope, table, filters });
          if (state.errorTable === table) return { data: null, error: new Error("DB unavailable") };
          let result = (tables[table] || []).filter(row => predicates.every(predicate => predicate(row)));
          if (scope === "caller" && table === "document_files") result = result.filter(row => !state.hiddenFiles.has(row.id));
          const count = result.length;
          result = result.slice(0, single ? max : Math.min(max, state.rowCap)).map(row => structuredClone(row));
          return single ? { data: result.length === 1 ? result[0] : null, error: result.length > 1 ? new Error("Multiple rows") : null } : { data: result, count, error: null };
        }
        return query;
      },
      async rpc(name: string) { state.rpcCalls.push(name); return { data: name === "vehicle_intake_receipt_context" ? state.context : state.frozen, error: state.rpcError ? new Error("Forbidden") : null }; },
    };
  }
  const caller = client("caller"), admin = client("admin");
  const run = (extra: Row = {}) => resolveClaimEngineerPacket({ admin, caller, tenantId: TENANT, claimId: CLAIM, language: "en", role: "insurance", ...extra });
  function sign() {
    tables.vehicle_entry_signatures.push({ id: id(401), tenant_id: TENANT, vehicle_entry_id: ENTRY, intake_revision: 2, signature_role: "delivered_by" });
    state.context = { entry_id: ENTRY, revision: 2, receipts: [{ id: id(402), revision: 2 }] };
    state.frozen = { revision: 2, entry: { id: ENTRY, tenant_id: TENANT, vehicle_id: VEHICLE, vehicle_entry_signatures: [{ id: id(401), intake_revision: 2, signature_role: "delivered_by", signature_data_url: "data:image/png;base64,ORIGINALFROZENINK" }], vehicle_technical_declaration: { ...tables.vehicle_technical_declarations[0], revision: 2, form_data: { other_observations: "FROZEN original observations", signature_data_url: "ORIGINAL FROZEN INK" } } } };
  }
  return { tables, state, run, sign };
}

describe("claim engineer attachment packet metadata", () => {
  it("offers an immutable signed-entry snapshot, technical default per template, and priority original defaults", async () => {
    const f = fixture(); f.sign(); const before = JSON.stringify(f.tables);
    const packet = await f.run();
    expect(packet.generatedDocuments.find(document => document.kind === "signed_intake")).toMatchObject({ id: `entry:${id(402)}`, renderer: "vehicle_entry", defaultSelected: true, data: { entry: { vehicle_entry_signatures: [{ signature_data_url: "data:image/png;base64,ORIGINALFROZENINK" }] } } });
    expect(packet.generatedDocuments.find(document => document.kind === "technical_declaration")?.defaultSelected).toBe(true);
    expect((await f.run({ templateId: "invoice_submission" })).generatedDocuments.find(document => document.kind === "technical_declaration")?.defaultSelected).toBe(false);
    expect(packet.attachments.every(document => document.defaultSelected)).toBe(true); expect(JSON.stringify(f.tables)).toBe(before);
  });
  it("admin owner-test mode never assigns an engineer and cannot be used by another role", async () => {
    const f = fixture(); f.tables.insurance_claims[0].insurance_employee_id = null; const before = JSON.stringify(f.tables);
    const packet = await f.run({ role: "admin", testMode: true }); expect(packet.recipient.email).toBe("alwafa.oman1@gmail.com"); expect(packet.recipientMode).toBe("owner_test"); expect(packet.ownerTestAllowed).toBe(false); // Sender authority is checked by the action, not metadata resolution.
    await expect(f.run({ testMode: true })).rejects.toThrow("claim_email_owner_test_forbidden");
    await expect(f.run()).rejects.toThrow("claim_email_engineer_required"); expect(JSON.stringify(f.tables)).toBe(before);
  });
  it("binds mode/template changes into context and preserves the saved engineer", async () => {
    const f = fixture(); const regular = await f.run(), test = await f.run({ role: "admin", testMode: true }), changedTemplate = await f.run({ templateId: "work_order_update" });
    expect(test.contextHash).not.toBe(regular.contextHash); expect(changedTemplate.contextHash).not.toBe(regular.contextHash); expect(f.tables.insurance_claims[0].insurance_employee_id).toBe(ENGINEER);
  });
  it("generates linked quote/work-order/insurance-invoice fallbacks without adopting cash invoices or another visit", async () => {
    const f = fixture(), order = { id: id(501), tenant_id: TENANT, claim_id: CLAIM, vehicle_id: VEHICLE, vehicle_entry_id: ENTRY, work_order_type: "insurance", order_number: "WO-1", status: "inspection", final_total: 10, deleted_at: null };
    f.tables.job_orders = [order, { ...order, id: id(502), vehicle_entry_id: id(99), order_number: "OTHER-VISIT" }, { ...order, id: id(503), work_order_type: "general_customer", order_number: "CASH-ORDER" }];
    f.tables.estimates = [{ id: id(510), tenant_id: TENANT, claim_id: CLAIM, vehicle_id: VEHICLE, insurance_company_id: COMPANY, work_order_id: order.id, estimate_number: "EST-1", estimate_type: "insurance", status: "issued", subtotal: 10, vat_amount: 0, total: 10 }];
    f.tables.estimate_items = [{ id: id(511), tenant_id: TENANT, estimate_id: id(510), description_en: "Saved repair", quantity: 1, unit_price: 10, line_total: 10 }];
    f.tables.sales_documents = [{ id: id(520), tenant_id: TENANT, work_order_id: order.id, doc_type: "quote", doc_number: "Q-1", status: "draft", items: [{ description: "Original quote line", quantity: 1, unitPrice: 10 }], subtotal: 10, tax_total: 0, total: 10 }, { id: id(521), tenant_id: TENANT, work_order_id: order.id, doc_type: "invoice", doc_number: "CASH-INV", items: [], subtotal: 500, tax_total: 25, total: 525 }];
    f.tables.insurance_invoices = [{ id: id(530), tenant_id: TENANT, claim_id: CLAIM, insurance_company_id: COMPANY, insurance_company_name: "Selected insurer", invoice_number: "INS-1", status: "issued", items: [{ description: "Saved invoice line", quantity: 1, unit_price: 10 }], subtotal: 10, vat: 0, total: 10 }, { id: id(531), tenant_id: TENANT, claim_id: CLAIM, insurance_company_id: id(99), invoice_number: "WRONG-ACCOUNT", status: "issued", items: [] }];
    const packet = await f.run();
    expect(packet.generatedDocuments.map(document => document.renderer)).toEqual(expect.arrayContaining(["work_order", "estimate", "quote", "insurance_invoice"]));
    expect(packet.generatedDocuments.filter(document => document.kind === "invoice")).toHaveLength(1);
    expect(packet.generatedDocuments.find(document => document.id === `invoice:${id(530)}`)?.data).toMatchObject({ subtotal: 10, taxTotal: 0, total: 10 });
    expect(JSON.stringify(packet)).not.toContain("CASH-INV"); expect(JSON.stringify(packet)).not.toContain("WRONG-ACCOUNT"); expect(JSON.stringify(packet)).not.toContain("OTHER-VISIT");
    expect(f.state.calls.filter(call => call.table === "sales_documents").every(call => call.filters.doc_type === "quote")).toBe(true);
  });
  it("prefers saved estimate PDFs, reads missing size only after scoped path validation, and defaults the current repair estimate", async () => {
    const f = fixture(); f.tables.insurance_claims[0].claim_estimate_number = "EST-SAVED"; f.tables.insurance_claims[0].claim_estimate_revision = 1;
    const saved = { ...f.tables.vehicle_media[0], id: id(250), media_type: "document", category: "claim_estimate", source: "generated_claim_document", mime_type: "application/pdf", file_name: "Saved estimate.pdf", file_size: null, storage_path: `${TENANT}/${CLAIM}/claim_estimate/current-estimate.pdf` };
    f.tables.vehicle_media.push(saved); const packet = await f.run();
    expect(packet.attachments.find(item => item.id === `media:${id(250)}`)).toMatchObject({ kind: "repair_estimate", byteSize: 50, defaultSelected: true });
    expect(packet.generatedDocuments.some(document => document.kind === "repair_estimate")).toBe(false); expect(f.state.storageReads).toHaveLength(1);
    saved.storage_path = `${id(99)}/stolen.pdf`; f.state.storageReads = []; await expect(f.run()).rejects.toThrow("claim_email_attachment_unavailable"); expect(f.state.storageReads).toHaveLength(0);
  });
  it("rejects a same-tenant private path belonging to another visit before reading bytes", async () => {
    const f = fixture(); f.tables.vehicle_media[0].storage_path = `${TENANT}/vehicle-entry/${id(99)}/other-visit.JPG`;
    await expect(f.run()).rejects.toThrow("claim_email_visit_mismatch"); expect(f.state.storageReads).toHaveLength(0);
  });
  it("rebuilds a saved changed estimate from current source rather than defaulting an obsolete archived PDF", async () => {
    const f = fixture(); Object.assign(f.tables.insurance_claims[0], { claim_estimate_number: "EST-CHANGED", claim_estimate_revision: 2, claim_estimate_document_status: "modified_after_send", estimated_cost: 42, estimation_type: "lump_sum" });
    f.tables.vehicle_media.push({ ...f.tables.vehicle_media[0], id: id(251), media_type: "document", category: "claim_estimate", source: "generated_claim_document", mime_type: "application/pdf", file_name: "Old estimate.pdf", file_size: 15, storage_path: `${TENANT}/${CLAIM}/claim_estimate/current-estimate.pdf` });
    const packet = await f.run(); expect(packet.attachments.some(item => item.id === `media:${id(251)}`)).toBe(false);
    expect(packet.generatedDocuments.find(item => item.id === `claim-estimate:${CLAIM}`)).toMatchObject({ kind: "repair_estimate", defaultSelected: true, data: { lumpSumAmount: 42 } });
  });
  it("grounds status in exact-visit saved inspection flags and never returns report images or invents findings", async () => {
    const f = fixture(); f.tables.insurance_claims[0].inspection_id = id(550); f.tables.insurance_claims[0].repair_stage = "waiting_parts"; f.tables.insurance_claims[0].status = "pending";
    f.tables.vehicle_entries[0].vehicle_location = "داخل الورشة"; f.tables.vehicle_entries[0].vehicle_condition = { running_status: "not_running", visible_damage: "Saved front impact" };
    f.tables.inspections = [{ id: id(550), tenant_id: TENANT, inspection_kind: "insurance", inspection_code: "DR-00065", details: { vehicleEntryId: ENTRY, claimId: CLAIM, insuranceInspectionReport: { reportNo: "DR-00065", photos: ["data:image/jpeg;base64,DO_NOT_RETURN_PRIVATE_REPORT_PHOTOS"], annotatedImages: ["SECRET_ANNOTATED_IMAGE"], remarks: "Saved inspection note", sections: [{ items: [{ en: "Front bumper", ar: "الصدام الأمامي", repair: true, comment: "Recorded crack" }] }] } } }];
    const packet = await f.run(); expect(packet.statusSummary).toEqual(expect.arrayContaining([{ key: "running_status", label: "Vehicle running condition", value: "Vehicle does not run", source: "vehicle_entry" }, { key: "inspection_findings", label: "Recorded inspection findings", value: "Front bumper: Repair - Recorded crack", source: "inspection" }]));
    expect(JSON.stringify(packet)).not.toContain("DO_NOT_RETURN"); expect(JSON.stringify(packet)).not.toContain("SECRET_ANNOTATED");
    f.tables.inspections[0].details.vehicleEntryId = id(99); const other = await f.run(); expect(other.statusSummary.find(field => field.key === "inspection_findings")?.value).toBe("No findings recorded for this visit");
    expect(other.statusSummary.find(field => field.key === "inspection_reference")?.value).toBe("Not recorded");
  });
  it("uses the saved selected engineer and exact subject, retaining original filename, MIME and hash without source writes or URLs", async () => {
    const f = fixture(), before = JSON.stringify(f.tables);
    const result = await f.run();
    expect(result.subject).toBe("C/004/15/26/2510/00103 HONDA ACCORD 61905/M");
    expect(result.recipient).toEqual({ id: ENGINEER, name: "Selected engineer", email: "engineer@example.test" });
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toMatchObject({ id: `document:${id(101)}`, fileName: "Original police scan.PDF", mimeType: "application/pdf", sha256: "a".repeat(64), byteSize: 10, kind: "source_document" });
    expect(result.attachments[1]).toMatchObject({ fileName: "Original.JPG", mimeType: "image/jpeg", byteSize: 4, kind: "vehicle_photo" });
    expect(result.contextHash).toMatch(/^[a-f0-9]{64}$/); expect(result.limitBytes).toBe(20 * 1024 * 1024); expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("https://"); expect(JSON.stringify(f.tables)).toBe(before);
    expect(f.state.calls.filter(call => call.table === "document_files").every(call => call.scope === "caller")).toBe(true);
  });
  it.each(["", null])("refuses a missing saved engineer instead of selecting a company contact", async missing => {
    const f = fixture(); f.tables.insurance_claims[0].insurance_employee_id = missing;
    await expect(f.run()).rejects.toMatchObject({ code: "claim_email_engineer_required" });
  });
  it("rejects a disabled or wrong-company engineer and malformed/multiple recipients", async () => {
    const f = fixture(); f.tables.insurance_company_employees[0].is_active = false;
    await expect(f.run()).rejects.toThrow("claim_email_engineer_unavailable");
    f.tables.insurance_company_employees[0].is_active = true; f.tables.insurance_company_employees[0].insurance_company_id = id(50);
    await expect(f.run()).rejects.toThrow("claim_email_engineer_unavailable");
    f.tables.insurance_company_employees[0].insurance_company_id = COMPANY; f.tables.insurance_company_employees[0].email = "a@example.test,b@example.test";
    await expect(f.run()).rejects.toThrow("claim_email_engineer_email_required");
  });
  it("requires explicit visit selection for a shared claim without a canonical entry pointer", async () => {
    const f = fixture(); f.tables.insurance_claims[0].vehicle_entry_id = null;
    f.tables.vehicle_entries.push({ ...f.tables.vehicle_entries[0], id: id(8), entry_number: "ENT-REVIEW" });
    await expect(f.run()).rejects.toMatchObject({ code: "claim_email_visit_required", entries: [{ id: ENTRY, entryNumber: "ENT-2026-1" }, { id: id(8), entryNumber: "ENT-REVIEW" }] });
    expect((await f.run({ entryId: ENTRY })).entryId).toBe(ENTRY);
  });
  it("keeps the canonical claim entry instead of selecting a newer visit for the vehicle", async () => {
    const f = fixture(); f.tables.vehicle_entries.push({ ...f.tables.vehicle_entries[0], id: id(8), entry_number: "ENT-NEWER", arrival_date: "2026-11-25" });
    expect((await f.run()).entryId).toBe(ENTRY);
  });
  it("rejects deleted records, another vehicle and contradictory visit claim references", async () => {
    const f = fixture(); f.tables.vehicle_entries[0].deleted_at = "2026-11-24";
    await expect(f.run()).rejects.toThrow("claim_email_visit_unavailable");
    f.tables.vehicle_entries[0].deleted_at = null; f.tables.vehicle_entries[0].vehicle_id = id(60);
    await expect(f.run()).rejects.toThrow("claim_email_visit_mismatch");
    f.tables.vehicle_entries[0].vehicle_id = VEHICLE; f.tables.vehicle_entries[0].converted_claim_id = id(61);
    await expect(f.run()).rejects.toThrow("claim_email_visit_mismatch");
  });
  it("deduplicates an original linked via claim, intake and media, and equal original content", async () => {
    const f = fixture(), file = f.tables.document_files[0];
    f.tables.document_links.push({ ...f.tables.document_links[0], id: id(112), entity_type: "vehicle_entry", entity_id: ENTRY });
    f.tables.document_files.push({ ...file, id: id(102), storage_path: `${TENANT}/operational/duplicate.pdf` });
    f.tables.document_links.push({ ...f.tables.document_links[0], id: id(113), file_id: id(102) });
    f.tables.vehicle_media.push({ ...f.tables.vehicle_media[0], id: id(202), media_type: "document", storage_bucket: file.storage_bucket, storage_path: file.storage_path, file_name: file.original_file_name, mime_type: file.mime_type, file_size: file.byte_size });
    expect((await f.run()).attachments).toHaveLength(2);
  });
  it("excludes removed links, deleted photos and generated estimate/invoice documents", async () => {
    const f = fixture(); f.tables.document_links[0].removed_at = "2026-11-24";
    f.tables.vehicle_media[0].deleted_at = "2026-11-24";
    f.tables.vehicle_media.push({ ...f.tables.vehicle_media[0], id: id(202), media_type: "document", deleted_at: null, category: "claim_estimate", source: "generated_claim_document" });
    const result = await f.run(); expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual(["claim_email_source_documents_missing", "claim_email_vehicle_photos_missing"]);
  });
  it("excludes explicit financial/generated media while retaining linked OCR originals and insurer LPO, quote and approval documents", async () => {
    const f = fixture();
    // The restriction is on media, not the original OCR documents selected by
    // active claim/intake links and still accessible through the caller's RLS.
    f.tables.document_files[0].access_scope = "finance";
    f.tables.document_files[0].storage_bucket = "expense-documents";
    const base = { ...f.tables.vehicle_media[0], media_type: "document", mime_type: "application/pdf", file_size: 10, source: "claim" };
    const excluded: Array<typeof base & { id: string; category: string; file_name: string; storage_path: string; storage_bucket?: string }> = ["invoice", "expense", "expense_receipt", "supplier_invoice", "purchase_invoice", "cash_invoice", "tax_invoice", "insurance_invoice"].map((category, index) => ({
      ...base, id: id(220 + index), category, file_name: `${category}.pdf`, storage_path: `${TENANT}/claim/financial-${index}.pdf`,
    }));
    excluded.push(...["generated_claim_document", "legacy_generated_documents"].map((source, index) => ({
      ...base, id: id(230 + index), source, category: "inspection", file_name: `${source}.pdf`, storage_path: `${TENANT}/claim/generated-${index}.pdf`,
    })), { ...base, id: id(232), category: "other", storage_bucket: "expense-documents", file_name: "expense-attachment.pdf", storage_path: `${TENANT}/expenses/receipt.pdf` });
    const allowed = ["lpo", "quote", "insurance_approval"].map((category, index) => ({
      ...base, id: id(240 + index), category, file_name: `${category}.pdf`, storage_path: `${TENANT}/claim/${category}.pdf`,
    }));
    f.tables.vehicle_media.push(...excluded, ...allowed);
    const result = await f.run();
    expect(result.attachments.map(file => file.id)).toEqual([`document:${id(101)}`, `media:${id(201)}`, ...allowed.map(row => `media:${row.id}`)]);
    expect(result.attachments.find(file => file.sourceId === id(101))).toMatchObject({ kind: "source_document", bucket: "expense-documents", fileName: "Original police scan.PDF", sha256: "a".repeat(64) });
    expect(result.warnings).toEqual([]);
  });
  it("rejects conflicting metadata for the same stored original rather than hiding it through deduplication", async () => {
    const f = fixture(), file = f.tables.document_files[0];
    f.tables.vehicle_media.push({ ...f.tables.vehicle_media[0], id: id(202), media_type: "document", storage_bucket: file.storage_bucket, storage_path: file.storage_path, file_name: file.original_file_name, mime_type: file.mime_type, file_size: file.byte_size + 1 });
    await expect(f.run()).rejects.toThrow("claim_email_attachment_metadata_required");
  });
  it("excludes other-review photos and originals even when the claim is shared", async () => {
    const f = fixture();
    f.tables.vehicle_media.push({ ...f.tables.vehicle_media[0], id: id(202), vehicle_entry_id: id(8), file_name: "Review.JPG" });
    f.tables.document_links.push({ ...f.tables.document_links[0], id: id(112), entity_type: "vehicle_entry", entity_id: id(8) });
    const result = await f.run(); expect(result.attachments).toHaveLength(1); expect(result.attachments[0].sourceId).toBe(id(201));
    expect(result.warnings).toContain("claim_email_source_documents_missing");
  });
  it("does not bypass caller RLS using an admin-visible restricted original", async () => {
    const f = fixture(); f.state.hiddenFiles.add(id(101));
    await expect(f.run()).rejects.toThrow("claim_email_document_unavailable");
  });
  it("fails closed on a query error or a truncated source inventory", async () => {
    const f = fixture(); f.state.errorTable = "document_links";
    await expect(f.run()).rejects.toThrow("claim_email_document_unavailable");
    f.state.errorTable = ""; const original = f.tables.document_links[0];
    f.tables.document_links = Array.from({ length: 501 }, (_, index) => ({ ...original, id: id(1000 + index) }));
    await expect(f.run()).rejects.toThrow("claim_email_source_limit_exceeded");
  });
  it("detects a configured API row cap below the requested inventory limit using the exact count", async () => {
    const f = fixture(); f.state.rowCap = 1;
    f.tables.document_links.push({ ...f.tables.document_links[0], id: id(112) });
    await expect(f.run()).rejects.toThrow("claim_email_source_limit_exceeded");
  });
  it.each(["https://untrusted.test/file.pdf", `${TENANT}/../other/file.pdf`, `${TENANT}/%2e%2e/file.pdf`, `${id(9)}/file.pdf`])("rejects arbitrary or foreign storage reference %s", async path => {
    const f = fixture(); f.tables.document_files[0].storage_path = path;
    await expect(f.run()).rejects.toThrow("claim_email_attachment_unavailable");
  });
  it("enforces original MIME, known size and per-file limits while exposing a large manifest for one-email selection", async () => {
    const f = fixture(); f.tables.document_files[0].mime_type = "text/html";
    await expect(f.run()).rejects.toThrow("claim_email_attachment_metadata_required");
    f.tables.document_files[0].mime_type = "application/pdf"; f.tables.document_files[0].byte_size = 0;
    await expect(f.run()).rejects.toThrow("claim_email_attachment_metadata_required");
    f.tables.document_files[0].byte_size = 13 * 1024 * 1024;
    await expect(f.run()).rejects.toThrow("claim_email_attachment_too_large");
    f.tables.document_files[0].byte_size = 11 * 1024 * 1024; f.tables.vehicle_media[0].file_size = 11 * 1024 * 1024;
    expect((await f.run()).warnings).toContain("claim_email_packet_selection_required");
  });
  it("takes a signed declaration from the exact frozen receipt and never merges the live replacement", async () => {
    const f = fixture(); f.sign(); const result = await f.run();
    expect(result.technicalDeclaration?.formData).toEqual({ other_observations: "FROZEN original observations", signature_data_url: "ORIGINAL FROZEN INK" });
    expect(f.state.rpcCalls).toEqual(["vehicle_intake_receipt_context", "vehicle_intake_receipt_document"]);
    expect(f.state.calls.some(call => call.table === "vehicle_technical_declarations")).toBe(false);
    f.tables.vehicle_technical_declarations[0].form_data.signature_data_url = "NEW LIVE INK";
    expect((await f.run()).contextHash).toBe(result.contextHash);
  });
  it("refuses an absent or wrong frozen source without using a mutable declaration", async () => {
    const f = fixture(); f.sign(); f.state.context.receipts = [];
    await expect(f.run()).rejects.toThrow("claim_email_frozen_source_unavailable");
    f.sign(); f.state.frozen.entry.id = id(80);
    await expect(f.run()).rejects.toThrow("claim_email_frozen_source_unavailable");
  });
  it("warns when the actual signed snapshot has no technical form instead of attaching a later form", async () => {
    const f = fixture(); f.sign(); delete f.state.frozen.entry.vehicle_technical_declaration;
    const result = await f.run(); expect(result.technicalDeclaration).toBeNull(); expect(result.warnings).toContain("claim_email_technical_declaration_missing");
  });
  it("changes the context for persisted recipient, source metadata or declaration revisions and keeps object-order changes stable", async () => {
    const f = fixture(); const first = await f.run();
    f.tables.insurance_company_employees[0].email = "new-engineer@example.test";
    const second = await f.run(); expect(second.contextHash).not.toBe(first.contextHash);
    f.tables.document_files[0].original_file_name = "Renamed original.pdf";
    const third = await f.run(); expect(third.contextHash).not.toBe(second.contextHash);
    f.tables.vehicle_technical_declarations[0].revision++;
    const fourth = await f.run(); expect(fourth.contextHash).not.toBe(third.contextHash);
    f.tables.vehicle_technical_declarations[0].form_data = Object.fromEntries(Object.entries(f.tables.vehicle_technical_declarations[0].form_data).reverse());
    expect((await f.run()).contextHash).toBe(fourth.contextHash);
  });
  it("translates persisted Arabic plate letters/digits and rejects an untrusted role", async () => {
    const f = fixture(); f.tables.vehicles[0].plate_number = "٦١٩٠٥"; f.tables.vehicles[0].plate_letters = "م";
    expect((await f.run()).subject.endsWith("61905/M")).toBe(true);
    await expect(f.run({ role: "customer" })).rejects.toThrow("claim_email_forbidden");
  });
});
