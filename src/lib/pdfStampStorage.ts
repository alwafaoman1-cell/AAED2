import { supabase } from "@/integrations/supabase/client";

const STAMP_BUCKET = "avatars";
const MAX_STAMP_BYTES = 5 * 1024 * 1024;

async function getCurrentTenantAndUser() {
  const { data: userRow, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userRow.user?.id;
  if (!userId) throw new Error("not_authenticated");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  const tenantId = profile?.tenant_id;
  if (!tenantId) throw new Error("no_tenant");

  return { tenantId, userId };
}

function safeStampExtension(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return ext;
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/jpeg") return "jpg";
  return "png";
}

export async function uploadCompanyStampToStorage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("stamp_file_must_be_image");
  if (file.size > MAX_STAMP_BYTES) throw new Error("stamp_file_too_large");

  const { tenantId } = await getCurrentTenantAndUser();
  const ext = safeStampExtension(file);
  const path = `${tenantId}/pdf-assets/company-stamp-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(STAMP_BUCKET)
    .upload(path, file, {
      contentType: file.type || `image/${ext}`,
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(STAMP_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("stamp_public_url_missing");
  return data.publicUrl;
}

export async function removeCompanyStampFromStorage(publicUrl?: string): Promise<void> {
  if (!publicUrl) return;
  const marker = `/object/public/${STAMP_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(publicUrl.slice(idx + marker.length).split("?")[0] || "");
  if (!path) return;
  await supabase.storage.from(STAMP_BUCKET).remove([path]);
}
