import { DEFAULT_EXTRACTION_POLICY } from "./types";

export type SupportedDocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

const EXTENSIONS: Record<SupportedDocumentMime, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export class DocumentFileError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DocumentFileError";
  }
}

function detectSignature(bytes: Uint8Array): SupportedDocumentMime | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function validateDocumentFile(file: File, maxBytes = DEFAULT_EXTRACTION_POLICY.maxFileBytes): Promise<SupportedDocumentMime> {
  if (!file.size || file.size > maxBytes) {
    throw new DocumentFileError("DOCUMENT_SIZE_INVALID", `Document must be between 1 byte and ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectSignature(prefix);
  if (!detected) throw new DocumentFileError("DOCUMENT_UNSUPPORTED", "Unsupported or unreadable document. Use PDF, JPG, PNG or WEBP.");
  const declared = file.type.toLowerCase();
  if (declared && declared !== detected && !(declared === "image/jpg" && detected === "image/jpeg")) {
    throw new DocumentFileError("DOCUMENT_MIME_MISMATCH", "File contents do not match the declared MIME type.");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!EXTENSIONS[detected].includes(extension)) {
    throw new DocumentFileError("DOCUMENT_EXTENSION_MISMATCH", "File extension does not match its contents.");
  }
  return detected;
}

export async function sha256File(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new DocumentFileError("DOCUMENT_HASH_UNAVAILABLE", "Secure file hashing is unavailable in this browser.");
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
