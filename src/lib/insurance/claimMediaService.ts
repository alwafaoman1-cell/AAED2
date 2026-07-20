import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";

export type ClaimMediaType = "image" | "document";

export type ClaimMediaCategory =
  | "damage_photo"
  | "vehicle_receipt"
  | "inspection"
  | "estimate"
  | "lpo"
  | "invoice"
  | "police_report"
  | "customer_document"
  | "repair_progress"
  | "delivery"
  | "other"
  | string;

export interface ClaimMediaRecord {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  media_type: ClaimMediaType;
  category: ClaimMediaCategory;
  stage: string | null;
  caption: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  sort_order: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  deleted_at: string | null;
  url?: string;
}

export interface UploadClaimMediaInput {
  claimId: string;
  tenantId?: string | null;
  workOrderId?: string | null;
  vehicleId?: string | null;
  file: File;
  mediaType: ClaimMediaType;
  category: ClaimMediaCategory;
  description?: string | null;
  source?: string | null;
}

function isMissingMediaSchema(error: unknown) {
  const text = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return text.includes("schema cache") || text.includes("could not find") || text.includes("does not exist") || text.includes("pgrst204");
}

function safeFileName(name: string) {
  const cleaned = String(name || "file").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "file";
}

function isImageFile(file: File) {
  return /^image\//i.test(file.type || "");
}

async function resolveTenantId(explicit?: string | null) {
  if (explicit && isUuid(explicit)) return explicit;
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error) throw error;
  if (!data || !isUuid(String(data))) throw new Error("Tenant was not loaded for claim media");
  return String(data);
}

async function getLegacyClaimMediaFallback(claimId: string): Promise<ClaimMediaRecord[]> {
  const { data, error } = await supabase
    .from("insurance_claims")
    .select("id, tenant_id, vehicle_id, job_order_id, auto_job_order_id, documents, damage_photos")
    .eq("id", claimId)
    .maybeSingle();

  if (error || !data) return [];
  const claim = data as any;
  const workOrderId = claim.job_order_id || claim.auto_job_order_id || null;
  const photos = Array.isArray(claim.damage_photos) ? claim.damage_photos : [];
  const docs = Array.isArray(claim.documents) ? claim.documents : [];
  const now = new Date().toISOString();

  const imageRows: ClaimMediaRecord[] = photos.filter(Boolean).map((url: string, index: number) => ({
    id: `legacy-photo-${index}`,
    tenant_id: claim.tenant_id,
    vehicle_id: claim.vehicle_id || null,
    claim_id: claim.id,
    work_order_id: workOrderId,
    storage_bucket: "insurance-docs",
    storage_path: url,
    public_url: /^https?:\/\//i.test(url) ? url : null,
    media_type: "image",
    category: "damage_photo",
    stage: null,
    caption: null,
    file_name: url.split("/").pop() || `photo-${index + 1}`,
    mime_type: null,
    file_size: null,
    description: null,
    sort_order: index,
    uploaded_at: now,
    uploaded_by: null,
    deleted_at: null,
    url,
  }));

  const docRows: ClaimMediaRecord[] = docs.map((doc: any, index: number) => {
    const url = doc?.url || doc?.storage_path || doc?.file_path || doc?.path || "";
    return {
      id: `legacy-document-${index}`,
      tenant_id: claim.tenant_id,
      vehicle_id: claim.vehicle_id || null,
      claim_id: claim.id,
      work_order_id: workOrderId,
      storage_bucket: doc?.bucket || "insurance-docs",
      storage_path: url,
      public_url: /^https?:\/\//i.test(url) ? url : null,
      media_type: "document",
      category: doc?.type || doc?.category || "other",
      stage: null,
      caption: null,
      file_name: doc?.name || doc?.file_name || url.split("/").pop() || `document-${index + 1}`,
      mime_type: doc?.mime_type || null,
      file_size: null,
      description: null,
      sort_order: index,
      uploaded_at: now,
      uploaded_by: null,
      deleted_at: null,
      url,
    };
  }).filter((item: ClaimMediaRecord) => !!item.storage_path);

  return [...imageRows, ...docRows];
}

export async function getClaimMedia(claimId?: string | null): Promise<ClaimMediaRecord[]> {
  if (!claimId || !isUuid(claimId)) return [];
  let { data, error } = await supabase
    .from("vehicle_media" as any)
    .select("*")
    .eq("claim_id", claimId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("uploaded_at", { ascending: false });

  if (error) {
    if (isMissingMediaSchema(error)) {
      const retry = await supabase
        .from("vehicle_media" as any)
        .select("*")
        .eq("claim_id", claimId)
        .order("uploaded_at", { ascending: false });
      if (!retry.error) {
        data = retry.data;
      } else {
        return getLegacyClaimMediaFallback(claimId);
      }
    } else {
      throw error;
    }
  }

  const rows = (data || []) as unknown as ClaimMediaRecord[];
  const signed = await Promise.all(rows.map(async (row) => {
    if (/^https?:\/\//i.test(row.storage_path)) return row.storage_path;
    const { data: urlData } = await supabase.storage
      .from(row.storage_bucket || "insurance-docs")
      .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7);
    return urlData?.signedUrl || row.public_url || "";
  }));

  return rows.map((row, index) => ({ ...row, url: signed[index] || row.public_url || row.storage_path }));
}

export async function uploadClaimMedia(input: UploadClaimMediaInput): Promise<ClaimMediaRecord> {
  if (!input.claimId || !isUuid(input.claimId)) throw new Error("Claim must be saved before uploading media");
  const tenantId = await resolveTenantId(input.tenantId);
  const { data: auth } = await supabase.auth.getUser();
  const bucket = "insurance-docs";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const cleanName = safeFileName(input.file.name);
  const storagePath = `${tenantId}/${input.claimId}/${input.mediaType}/${input.category}/${stamp}-${cleanName}`;

  let fileToUpload: File | Blob = input.file;
  let uploadName = cleanName;
  if (input.mediaType === "image" && isImageFile(input.file)) {
    try {
      const { convertImageToWebp } = await import("@/lib/imageToWebp");
      const optimized = await convertImageToWebp(input.file);
      fileToUpload = optimized;
      uploadName = safeFileName(optimized.name || cleanName);
    } catch {
      fileToUpload = input.file;
    }
  }

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileToUpload, { contentType: (fileToUpload as File).type || input.file.type || "application/octet-stream" });
  if (uploadError) throw uploadError;

  const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  const publicUrl = signed?.signedUrl || null;

  const insertPayload = {
    tenant_id: tenantId,
    claim_id: input.claimId,
    work_order_id: input.workOrderId || null,
    vehicle_id: input.vehicleId || null,
    storage_bucket: bucket,
    storage_path: storagePath,
    public_url: publicUrl,
    media_type: input.mediaType,
    category: input.category,
    file_name: uploadName,
    mime_type: (fileToUpload as File).type || input.file.type || null,
    file_size: (fileToUpload as File).size || input.file.size || null,
    description: input.description || null,
    caption: input.description || null,
    source: input.source || "claim",
    uploaded_by: auth.user?.id || null,
    uploaded_at: new Date().toISOString(),
  };

  let { data, error: insertError } = await supabase
    .from("vehicle_media" as any)
    .upsert(insertPayload as any, { onConflict: "tenant_id,storage_bucket,storage_path" })
    .select("*")
    .single();

  if (insertError) {
    if (isMissingMediaSchema(insertError)) {
      const legacyPayload = {
        tenant_id: tenantId,
        claim_id: input.claimId,
        work_order_id: input.workOrderId || null,
        vehicle_id: input.vehicleId || null,
        storage_bucket: bucket,
        storage_path: storagePath,
        public_url: publicUrl,
        media_type: input.mediaType,
        category: input.category,
        caption: input.description || null,
        source: input.source || "claim",
        uploaded_by: auth.user?.id || null,
        uploaded_at: new Date().toISOString(),
      };
      const retry = await supabase
        .from("vehicle_media" as any)
        .upsert(legacyPayload as any, { onConflict: "tenant_id,storage_bucket,storage_path" })
        .select("*")
        .single();
      data = retry.data;
      insertError = retry.error;
    }
    if (insertError) {
      await supabase.storage.from(bucket).remove([storagePath]).catch(() => undefined);
      throw insertError;
    }
  }

  return { ...(data as unknown as ClaimMediaRecord), url: publicUrl || storagePath };
}

export async function updateClaimMedia(mediaId: string, updates: { category?: string; description?: string | null; sort_order?: number }) {
  if (!mediaId || !isUuid(mediaId)) throw new Error("Invalid media id");
  const { data, error } = await supabase
    .from("vehicle_media" as any)
    .update({
      category: updates.category,
      description: updates.description,
      caption: updates.description,
      sort_order: updates.sort_order,
    } as any)
    .eq("id", mediaId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as ClaimMediaRecord;
}

export async function deleteClaimMedia(mediaId: string) {
  if (!mediaId || !isUuid(mediaId)) throw new Error("Invalid media id");
  const { data, error } = await supabase
    .from("vehicle_media" as any)
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq("id", mediaId)
    .select("id")
    .single();
  if (error) throw error;
  return data as unknown as { id: string };
}

export function mediaToLegacyPhotoUrls(media: ClaimMediaRecord[]) {
  return media
    .filter((item) => item.media_type === "image")
    .map((item) => item.url || item.public_url || item.storage_path)
    .filter(Boolean);
}

export function mediaToLegacyDocuments(media: ClaimMediaRecord[]) {
  return media
    .filter((item) => item.media_type === "document")
    .map((item) => ({
      url: item.url || item.public_url || item.storage_path,
      name: item.file_name || item.storage_path.split("/").pop() || "document",
      type: item.category || "other",
    }));
}
