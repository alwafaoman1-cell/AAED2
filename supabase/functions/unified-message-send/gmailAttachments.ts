export const CLAIM_EMAIL_LIMIT_BYTES = 20 * 1024 * 1024;
export const CLAIM_EMAIL_TECHNICAL_PDF_BYTES = 3 * 1024 * 1024;
export const CLAIM_EMAIL_REQUEST_BYTES = 12 * 1024 * 1024;
export const CLAIM_EMAIL_GENERATED_TOTAL_BYTES = 8 * 1024 * 1024;
export const CLAIM_EMAIL_MIME_BYTES = 35 * 1024 * 1024;

export class ClaimEmailError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export async function readBoundedMessageJson(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared < 0) throw new ClaimEmailError("invalid_request");
  if (declared > CLAIM_EMAIL_REQUEST_BYTES) throw new ClaimEmailError("payload_too_large");
  if (!req.body) throw new ClaimEmailError("invalid_request");
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CLAIM_EMAIL_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ClaimEmailError("payload_too_large");
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), byteLength: size };
  } catch { throw new ClaimEmailError("invalid_request"); }
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const owned = new Uint8Array(input.byteLength);
  owned.set(input);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export function checkedHeader(value: unknown, code = "claim_email_invalid_header", max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || hasControlCharacters(value)) throw new ClaimEmailError(code);
  return value.trim();
}

export function checkedEmail(value: unknown): string {
  const email = checkedHeader(value, "claim_email_invalid_email", 254);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) throw new ClaimEmailError("claim_email_invalid_email");
  return email;
}

export function checkedFilename(value: unknown): string {
  checkedHeader(value, "claim_email_invalid_filename", 255);
  const name = value as string;
  if (/[\\/]/.test(name)) throw new ClaimEmailError("claim_email_invalid_filename");
  return name;
}

export interface EmailBinaryAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
}

export function validAttachmentMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
  return false;
}

export function decodeTechnicalPdf(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > 4 * Math.ceil(CLAIM_EMAIL_TECHNICAL_PDF_BYTES / 3)
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ClaimEmailError("claim_email_technical_pdf_invalid");
  let binary: string;
  try { binary = atob(value); } catch { throw new ClaimEmailError("claim_email_technical_pdf_invalid"); }
  if (binary.length > CLAIM_EMAIL_TECHNICAL_PDF_BYTES) throw new ClaimEmailError("claim_email_too_large");
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!validAttachmentMagic(bytes, "application/pdf")) throw new ClaimEmailError("claim_email_technical_pdf_invalid");
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function wrappedBase64(bytes: Uint8Array): string {
  const encoded = base64(bytes);
  const lines: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += 76) lines.push(encoded.slice(offset, offset + 76));
  return lines.join("\r\n");
}

function subjectHeader(subject: string): string {
  const encoder = new TextEncoder();
  if (!/^[\x20-\x7e]+$/.test(subject)) {
    // Every encoded word is independently valid UTF-8 and shorter than RFC2047's
    // 75-character limit. Adjacent encoded-word whitespace is not subject text.
    const words: string[] = [];
    let chunk = "", size = 0;
    for (const char of subject) {
      const bytes = encoder.encode(char).byteLength;
      if (size + bytes > 42 && chunk) { words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`); chunk = ""; size = 0; }
      chunk += char; size += bytes;
    }
    if (chunk) words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`);
    return "Subject: " + words.join("\r\n ");
  }
  const lines: string[] = [];
  let line = "Subject: " + subject;
  while (line.length > 78) {
    const split = line.lastIndexOf(" ", 78);
    if (split < 1) break;
    lines.push(line.slice(0, split)); line = line.slice(split);
  }
  lines.push(line);
  if (lines.some(value => encoder.encode(value).byteLength > 998)) throw new ClaimEmailError("claim_email_invalid_subject");
  // Keep the original space at each fold, so unfolding reproduces exact text.
  return lines.join("\r\n");
}

function filenameDisposition(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, "_");
  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(ascii)?.[0] || "";
  const fallback = ascii.length <= 60 ? ascii : ascii.slice(0, 60 - extension.length) + extension;
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  // RFC2231 continuations are concatenated before percent/UTF-8 decoding. Keep
  // every %HH octet intact and bound even long non-Latin filenames per line.
  const chunks: string[] = [];
  let chunk = "";
  for (const token of encoded.match(/%[A-F0-9]{2}|./g) || []) {
    if (chunk.length + token.length > 42) { chunks.push(chunk); chunk = ""; }
    chunk += token;
  }
  if (chunk) chunks.push(chunk);
  const parameters = [`filename="${fallback}"`];
  if (chunks.length === 1) parameters.push(`filename*=UTF-8''${chunks[0]}`);
  else chunks.forEach((value, index) => parameters.push(`filename*${index}*=${index === 0 ? "UTF-8''" : ""}${value}`));
  return "Content-Disposition: attachment;\r\n " + parameters.join(";\r\n ");
}

/** One MIME message; each original byte stream is an independent attachment. */
export function buildClaimEmailMime(input: { from: string; to: string; subject: string; text: string; messageId: string; attachments: EmailBinaryAttachment[] }): Uint8Array {
  const from = checkedEmail(input.from), to = checkedEmail(input.to), subject = checkedHeader(input.subject, "claim_email_invalid_subject", 998);
  const messageId = checkedHeader(input.messageId);
  if (!/^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$/.test(messageId)) throw new ClaimEmailError("claim_email_invalid_header");
  if (!input.attachments.length || input.attachments.reduce((sum, file) => sum + file.bytes.byteLength, 0) > CLAIM_EMAIL_LIMIT_BYTES) throw new ClaimEmailError("claim_email_too_large");
  const boundary = "aaed2_" + crypto.randomUUID().replaceAll("-", "");
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  const add = (text: string) => {
    const bytes = encoder.encode(text); length += bytes.byteLength;
    if (length > CLAIM_EMAIL_MIME_BYTES) throw new ClaimEmailError("claim_email_too_large");
    parts.push(bytes);
  };
  add(`From: ${from}\r\nTo: ${to}\r\n${subjectHeader(subject)}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`);
  add(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedBase64(encoder.encode(input.text))}\r\n`);
  for (const file of input.attachments) {
    const name = checkedFilename(file.fileName);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.mimeType)) throw new ClaimEmailError("claim_email_unsupported_mime");
    add(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n${filenameDisposition(name)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedBase64(file.bytes)}\r\n`);
  }
  add(`--${boundary}--\r\n`);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export async function refreshGmailToken(credentials: { clientId: string; clientSecret: string; refreshToken: string }, request: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await request("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(25000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }) });
  } catch { throw new ClaimEmailError("claim_email_gmail_refresh_failed"); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token || /[\r\n]/.test(payload.access_token)) throw new ClaimEmailError(payload.error === "invalid_grant" || response.status === 401 ? "claim_email_gmail_reconnect_required" : "claim_email_gmail_refresh_failed");
  return payload.access_token;
}

/** Raw media avoids a second Base64 copy of the complete MIME message. */
export async function sendGmailMime(mime: Uint8Array, token: string, request: typeof fetch): Promise<string> {
  let response: Response;
  const upload = new Uint8Array(mime.byteLength);
  upload.set(mime);
  try {
    response = await request("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", { method: "POST", signal: AbortSignal.timeout(25000), headers: { Authorization: "Bearer " + token, "Content-Type": "message/rfc822" }, body: upload.buffer });
  } catch { throw new ClaimEmailError("claim_email_delivery_unconfirmed", true); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) throw new ClaimEmailError("claim_email_delivery_unconfirmed", true);
    throw new ClaimEmailError(response.status === 401 ? "claim_email_gmail_reconnect_required" : response.status === 429 ? "claim_email_gmail_rate_limited" : "claim_email_gmail_send_rejected");
  }
  if (typeof payload.id !== "string" || !/^[A-Za-z0-9_-]{1,250}$/.test(payload.id)) throw new ClaimEmailError("claim_email_delivery_unconfirmed", true);
  return payload.id;
}
