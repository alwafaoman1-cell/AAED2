import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";

export interface VehicleAvatarRecord {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  media_type: "image";
  category: "vehicle_avatar";
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  deleted_at?: string | null;
  url?: string;
}

const SIGNED_URL_TTL_MS = 55 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function safeFileName(name: string) {
  const cleaned = String(name || "vehicle-avatar").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "vehicle-avatar";
}

function isMissingSchema(error: unknown) {
  const text = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return text.includes("schema cache") || text.includes("could not find") || text.includes("does not exist") || text.includes("pgrst204");
}

async function resolveTenantId(explicit?: string | null) {
  if (explicit && isUuid(explicit)) return explicit;
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error) throw error;
  if (!data || !isUuid(String(data))) throw new Error("Tenant was not loaded for vehicle avatar");
  return String(data);
}

async function createSignedUrl(row: Pick<VehicleAvatarRecord, "storage_bucket" | "storage_path" | "public_url">) {
  if (/^https?:\/\//i.test(row.storage_path)) return row.storage_path;
  const cacheKey = `${row.storage_bucket || "insurance-docs"}:${row.storage_path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data } = await supabase.storage
    .from(row.storage_bucket || "insurance-docs")
    .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7);
  const url = data?.signedUrl || row.public_url || "";
  if (url) signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
  return url;
}

export async function getVehicleAvatar(vehicleId?: string | null): Promise<VehicleAvatarRecord | null> {
  if (!vehicleId || !isUuid(vehicleId)) return null;
  const query = supabase
    .from("vehicle_media" as any)
    .select("*")
    .eq("vehicle_id", vehicleId)
    .eq("media_type", "image")
    .eq("category", "vehicle_avatar")
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(1);

  let { data, error } = await query;

  if (error && isMissingSchema(error)) {
    const retry = await supabase
      .from("vehicle_media" as any)
      .select("*")
      .eq("vehicle_id", vehicleId)
      .eq("media_type", "image")
      .eq("category", "vehicle_avatar")
      .order("uploaded_at", { ascending: false })
      .limit(1);
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  const row = ((data || [])[0] || null) as unknown as VehicleAvatarRecord | null;
  if (!row) return null;
  return { ...row, url: await createSignedUrl(row) };
}

export async function uploadVehicleAvatar(input: {
  vehicleId: string;
  tenantId?: string | null;
  file: File;
  claimId?: string | null;
  workOrderId?: string | null;
}) {
  if (!input.vehicleId || !isUuid(input.vehicleId)) throw new Error("Vehicle must be saved before uploading avatar");
  if (!/^image\//i.test(input.file.type || "")) throw new Error("Only image files are accepted");

  const tenantId = await resolveTenantId(input.tenantId);
  const { data: auth } = await supabase.auth.getUser();
  const bucket = "insurance-docs";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const cleanName = safeFileName(input.file.name);
  const storagePath = `${tenantId}/vehicles/${input.vehicleId}/avatar/${stamp}-${cleanName}`;

  let fileToUpload: File | Blob = input.file;
  let uploadName = cleanName;
  try {
    const { convertImageToWebp } = await import("@/lib/imageToWebp");
    const optimized = await convertImageToWebp(input.file);
    fileToUpload = optimized;
    uploadName = safeFileName(optimized.name || cleanName);
  } catch {
    fileToUpload = input.file;
  }

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileToUpload, { contentType: (fileToUpload as File).type || input.file.type || "image/jpeg" });
  if (uploadError) throw uploadError;

  try {
    await supabase
      .from("vehicle_media" as any)
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq("tenant_id", tenantId)
      .eq("vehicle_id", input.vehicleId)
      .eq("media_type", "image")
      .eq("category", "vehicle_avatar")
      .is("deleted_at", null);
  } catch {
    // Older deployments may not have deleted_at yet. The unique index in the migration
    // becomes the authoritative active-avatar guard after migration is applied.
  }

  const insertPayload = {
    tenant_id: tenantId,
    vehicle_id: input.vehicleId,
    claim_id: input.claimId || null,
    work_order_id: input.workOrderId || null,
    storage_bucket: bucket,
    storage_path: storagePath,
    public_url: null,
    media_type: "image",
    category: "vehicle_avatar",
    file_name: uploadName,
    mime_type: (fileToUpload as File).type || input.file.type || null,
    file_size: (fileToUpload as File).size || input.file.size || null,
    source: "vehicle_avatar",
    uploaded_by: auth.user?.id || null,
    uploaded_at: new Date().toISOString(),
  };

  let { data, error } = await supabase.from("vehicle_media" as any).insert(insertPayload as any).select("*").single();
  if (error && isMissingSchema(error)) {
    const legacyPayload = {
      tenant_id: tenantId,
      vehicle_id: input.vehicleId,
      claim_id: input.claimId || null,
      work_order_id: input.workOrderId || null,
      storage_bucket: bucket,
      storage_path: storagePath,
      public_url: null,
      media_type: "image",
      category: "vehicle_avatar",
      source: "vehicle_avatar",
      uploaded_by: auth.user?.id || null,
      uploaded_at: new Date().toISOString(),
    };
    const retry = await supabase.from("vehicle_media" as any).insert(legacyPayload as any).select("*").single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => undefined);
    throw error;
  }

  const row = data as unknown as VehicleAvatarRecord;
  return { ...row, url: await createSignedUrl(row) };
}

export async function deleteVehicleAvatar(vehicleId: string) {
  if (!vehicleId || !isUuid(vehicleId)) throw new Error("Invalid vehicle id");
  const { error } = await supabase
    .from("vehicle_media" as any)
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq("vehicle_id", vehicleId)
    .eq("media_type", "image")
    .eq("category", "vehicle_avatar")
    .is("deleted_at", null);
  if (error) throw error;
  return { vehicleId };
}
