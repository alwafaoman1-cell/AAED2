import { supabase } from "@/integrations/supabase/client";
import type { VehicleTechnicalDeclarationForm } from "./vehicleTechnicalDeclaration";
import type { ClaimEngineerEmailDocumentKind, ClaimEngineerEmailRecipientMode, ClaimEngineerEmailTemplateId } from "./claimEngineerEmailTemplates";

export const CLAIM_ENGINEER_EMAIL_LIMIT_BYTES = 20 * 1024 * 1024;
export const CLAIM_ENGINEER_TECHNICAL_PDF_LIMIT_BYTES = 3 * 1024 * 1024;
export const CLAIM_ENGINEER_GENERATED_PDF_LIMIT_BYTES = 3 * 1024 * 1024;
export const CLAIM_ENGINEER_GENERATED_TOTAL_LIMIT_BYTES = 8 * 1024 * 1024;

export interface ClaimEngineerEmailAttachment {
  id: string;
  kind: ClaimEngineerEmailDocumentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256?: string;
  bucket: string;
  storagePath: string;
  defaultSelected?: boolean;
  sourceKind?: string;
  sourceId?: string;
}

export interface ClaimEngineerGeneratedDocument {
  id: string;
  kind: ClaimEngineerEmailDocumentKind;
  sourceKind: string;
  sourceId: string;
  sourceHash: string;
  fileName: string;
  mimeType: "application/pdf";
  renderer: "vehicle_entry" | "technical_declaration" | "work_order" | "claim_estimate" | "estimate" | "quote" | "insurance_invoice";
  data: Record<string, unknown>;
  defaultSelected: boolean;
}

export interface ClaimEngineerGeneratedPdf extends ClaimEngineerTechnicalPdf { id: string }

export interface ClaimEngineerEmailVisit {
  id: string;
  entryNumber: string;
  arrivalDate: string | null;
  status: string;
}

export interface ClaimEngineerEmailPacket {
  claimId: string;
  entryId: string;
  entryNumber: string;
  subject: string;
  recipient: { id: string; name: string; email: string };
  contextHash: string;
  attachments: ClaimEngineerEmailAttachment[];
  technicalDeclaration: {
    id: string;
    revision: number;
    sourceHash: string;
    formData: VehicleTechnicalDeclarationForm;
    fileName: string;
  } | null;
  gmail: { enabled: boolean; configured: boolean; fromEmail: string };
  body: string;
  limitBytes: number;
  warnings: string[];
  generatedDocuments?: ClaimEngineerGeneratedDocument[];
  templates?: { id: ClaimEngineerEmailTemplateId; label: string; description: string; defaultTechnical: boolean }[];
  templateId?: ClaimEngineerEmailTemplateId;
  recipientMode?: ClaimEngineerEmailRecipientMode;
  ownerTestAllowed?: boolean;
  statusSummary?: { key: string; label: string; value: string | number | null; source: string }[];
}

export interface ClaimEngineerTechnicalPdf {
  sourceHash: string;
  base64: string;
  sha256: string;
}

export interface ClaimEngineerEmailFailure {
  ok: false;
  error: string;
  status?: string;
  entries?: ClaimEngineerEmailVisit[];
  logId?: string;
}

export type PrepareClaimEngineerEmailResult = { ok: true; packet: ClaimEngineerEmailPacket } | ClaimEngineerEmailFailure;
export type SendClaimEngineerEmailResult = {
  ok: true;
  status: string;
  logId?: string;
  providerMessageId?: string;
  idempotencyKey?: string;
} | ClaimEngineerEmailFailure;

async function invokePacketAction<T>(body: Record<string, unknown>): Promise<T> {
  // Original attachments stay in Storage. Only their authorized server IDs and
  // PDFs newly rendered from saved versions cross this browser/API boundary.
  const { data, error } = await supabase.functions.invoke("unified-message-send", { body });
  if (!error && data && typeof data.ok === "boolean") return data as T;
  const response = error?.context;
  if (response instanceof Response) {
    const failure = await response.clone().json().catch(() => null);
    if (failure?.ok === false && typeof failure.error === "string") return failure as T;
  }
  throw new Error("claim_email_request_failed");
}

export function prepareClaimEngineerEmail(claimId: string, entryId: string | undefined, language: "ar" | "en",
  options?: { templateId: ClaimEngineerEmailTemplateId; recipientMode: ClaimEngineerEmailRecipientMode }) {
  return invokePacketAction<PrepareClaimEngineerEmailResult>({
    action: "prepare_claim_engineer_email", claim_id: claimId, ...(entryId ? { entry_id: entryId } : {}), language,
    ...(options ? { template_id: options.templateId, recipient_mode: options.recipientMode,
      ...(options.recipientMode === "owner_test" ? { test_mode: true } : {}) } : {}),
  });
}

export function sendClaimEngineerEmail(args: {
  claimId: string;
  entryId: string;
  language: "ar" | "en";
  contextHash: string;
  selectedAttachmentIds: string[];
  note: string;
  technicalPdf?: ClaimEngineerTechnicalPdf;
  templateId?: ClaimEngineerEmailTemplateId;
  recipientMode?: ClaimEngineerEmailRecipientMode;
  confirmOwnerTest?: boolean;
  generatedPdfs?: ClaimEngineerGeneratedPdf[];
}) {
  return invokePacketAction<SendClaimEngineerEmailResult>({
    action: "send_claim_engineer_email", claim_id: args.claimId, entry_id: args.entryId,
    language: args.language, context_hash: args.contextHash,
    selected_attachment_ids: args.selectedAttachmentIds, note: args.note,
    ...(args.technicalPdf ? { technical_pdf: args.technicalPdf } : {}),
    ...(args.templateId ? { template_id: args.templateId } : {}),
    ...(args.recipientMode ? { recipient_mode: args.recipientMode } : {}),
    ...(args.recipientMode === "owner_test" ? { test_mode: true, confirm_owner_test: args.confirmOwnerTest === true } : {}),
    ...(args.generatedPdfs ? { generated_pdfs: args.generatedPdfs } : {}),
  });
}

export async function encodeClaimEngineerTechnicalPdf(blob: Blob, sourceHash: string): Promise<ClaimEngineerTechnicalPdf> {
  if (!blob.size || blob.size > CLAIM_ENGINEER_TECHNICAL_PDF_LIMIT_BYTES) throw new Error("claim_email_technical_pdf_too_large");
  return encodePdf(blob, sourceHash);
}

export async function encodeClaimEngineerGeneratedPdf(blob: Blob, document: Pick<ClaimEngineerGeneratedDocument, "id" | "sourceHash">): Promise<ClaimEngineerGeneratedPdf> {
  if (!blob.size || blob.size > CLAIM_ENGINEER_GENERATED_PDF_LIMIT_BYTES) throw new Error("claim_email_generated_pdf_too_large");
  return { id: document.id, ...await encodePdf(blob, document.sourceHash) };
}

async function encodePdf(blob: Blob, sourceHash: string): Promise<ClaimEngineerTechnicalPdf> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { sourceHash, base64: btoa(binary), sha256 };
}

export function confirmedClaimEngineerEmailSent(result: SendClaimEngineerEmailResult): boolean {
  return result.ok && result.status === "sent" && Boolean(result.logId && result.providerMessageId);
}

export function persistedEntryClaimId(entry: { insurance_claim_id?: string | null; converted_claim_id?: string | null }): string | null {
  const { insurance_claim_id: claim, converted_claim_id: converted } = entry;
  return claim && converted && claim !== converted ? null : claim || converted || null;
}
