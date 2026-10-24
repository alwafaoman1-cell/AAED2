import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

const BUCKET = "hr-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp",
  "image/heic", "image/heif", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

async function tenantIdOrThrow(): Promise<string> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("HR_DOCUMENT_NO_TENANT");
  return tenantId;
}

export async function uploadHrDocument(employeeId: string, file: File): Promise<string> {
  if (!/^[\w-]+$/.test(employeeId)) throw new Error("HR_DOCUMENT_EMPLOYEE_INVALID");
  if (!ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
    throw new Error("HR_DOCUMENT_FILE_INVALID");
  }
  const tenantId = await tenantIdOrThrow();
  const path = `${tenantId}/${employeeId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

function assertTenantPath(path: string, tenantId: string): void {
  if (!path.startsWith(`${tenantId}/`)) throw new Error("HR_DOCUMENT_TENANT_MISMATCH");
}

export async function removeNewHrDocument(path: string): Promise<void> {
  const tenantId = await tenantIdOrThrow();
  assertTenantPath(path, tenantId);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export async function downloadHrDocument(path: string, fileName: string): Promise<void> {
  const tenantId = await tenantIdOrThrow();
  assertTenantPath(path, tenantId);
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw error || new Error("HR_DOCUMENT_DOWNLOAD_FAILED");
  const url = URL.createObjectURL(data);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName || "document";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
