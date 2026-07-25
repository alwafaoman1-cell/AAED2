import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phoneUtils";
import { readSystemPreferences } from "@/lib/systemPreferences";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

export type MessageChannel = "whatsapp" | "email" | "phone";
export type MessageDirection = "outbound" | "inbound";
export type MessageAttachmentType = "document" | "image" | "audio" | "pdf" | "link";

export interface UnifiedMessageAttachment {
  type: MessageAttachmentType;
  url?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  storagePath?: string;
  caption?: string;
}

export interface SendUnifiedMessageArgs {
  channel: MessageChannel;
  body?: string;
  subject?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  templateType?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: unknown[];
  messageType?: "text" | "template" | "document" | "image";
  idempotencyKey?: string;
  customerId?: string | null;
  vehicleId?: string | null;
  workOrderId?: string | null;
  claimId?: string | null;
  invoiceId?: string | null;
  shortLink?: string | null;
  attachments?: UnifiedMessageAttachment[];
  callResult?: string;
  callNotes?: string;
  followUpAt?: string | null;
  dryRun?: boolean;
}

export interface SendUnifiedMessageResult {
  ok: boolean;
  status?: string;
  error?: string | null;
  logId?: string;
  providerMessageId?: string | null;
  waUrl?: string;
}

async function normalizeRecipientPhone(phone?: string | null): Promise<string> {
  const prefs = await readSystemPreferences();
  return normalizePhone(phone, prefs.defaultCountryCode);
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

export function buildMessageIdempotencyKey(args: {
  tenantHint?: string | null;
  channel: MessageChannel;
  recipient?: string | null;
  templateType?: string | null;
  body?: string | null;
  workOrderId?: string | null;
  claimId?: string | null;
  invoiceId?: string | null;
  attachmentUrl?: string | null;
}) {
  const logical = [
    args.tenantHint || "tenant",
    args.channel,
    args.recipient || "",
    args.templateType || "general",
    args.workOrderId || "",
    args.claimId || "",
    args.invoiceId || "",
    args.attachmentUrl || "",
    stableHash(args.body || ""),
  ].join("|");
  return stableHash(logical);
}

export async function sendUnifiedMessage(args: SendUnifiedMessageArgs): Promise<SendUnifiedMessageResult> {
  const recipientPhone = args.channel === "whatsapp" || args.channel === "phone"
    ? await normalizeRecipientPhone(args.recipientPhone)
    : "";
  if ((args.channel === "whatsapp" || args.channel === "phone") && !recipientPhone) {
    throw new Error("رقم الهاتف غير صالح");
  }
  if (args.channel === "email" && !args.recipientEmail?.trim()) {
    throw new Error("البريد الإلكتروني مطلوب");
  }

  const firstAttachment = args.attachments?.[0];
  const idempotencyKey = args.idempotencyKey || buildMessageIdempotencyKey({
    channel: args.channel,
    recipient: recipientPhone || args.recipientEmail || "",
    templateType: args.templateType || args.templateName || "general",
    body: args.body || firstAttachment?.caption || "",
    workOrderId: args.workOrderId || null,
    claimId: args.claimId || null,
    invoiceId: args.invoiceId || null,
    attachmentUrl: firstAttachment?.url || firstAttachment?.storagePath || null,
  });

  const { data, error } = await supabase.functions.invoke("unified-message-send", {
    body: {
      channel: args.channel,
      body: args.body || firstAttachment?.caption || "",
      subject: args.subject,
      recipient_phone: recipientPhone,
      recipient_email: args.recipientEmail,
      template_type: args.templateType || args.templateName || "general",
      template_name: args.templateName,
      template_language: args.templateLanguage,
      template_components: args.templateComponents,
      message_type: args.messageType || (firstAttachment?.type === "image" ? "image" : firstAttachment ? "document" : "text"),
      idempotency_key: idempotencyKey,
      customer_id: args.customerId,
      vehicle_id: args.vehicleId,
      work_order_id: args.workOrderId,
      claim_id: args.claimId,
      invoice_id: args.invoiceId,
      short_link: args.shortLink,
      attachment: firstAttachment,
      attachments: args.attachments || [],
      call_result: args.callResult,
      call_notes: args.callNotes,
      follow_up_at: args.followUpAt,
      dry_run: args.dryRun,
    },
  });

  if (error || !data?.ok) {
    throw new Error(getFunctionErrorMessage(error, data));
  }
  return data as SendUnifiedMessageResult;
}

export function openWhatsAppDraft(args: { phone?: string | null; text: string }) {
  const cleaned = String(args.phone || "").replace(/\D/g, "");
  const url = cleaned
    ? `https://wa.me/${cleaned}?text=${encodeURIComponent(args.text)}`
    : `https://wa.me/?text=${encodeURIComponent(args.text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}
