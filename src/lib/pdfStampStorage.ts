import { supabase } from "@/integrations/supabase/client";

const STAMP_BUCKET = "avatars";
const MAX_STAMP_BYTES = 5 * 1024 * 1024;
const STAMP_ADMIN_ROLES = new Set(["owner", "admin", "super_admin", "superadmin"]);

async function getCurrentTenantAndUser() {
  const { data: userRow, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userRow.user?.id;
  if (!userId) throw new Error("not_authenticated");

  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role, is_platform_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError && /is_platform_admin|column/i.test(String(profileError.message || ""))) {
    const fallback = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    profile = fallback.data as any;
    profileError = fallback.error as any;
  }
  if (profileError) throw profileError;
  const tenantId = profile?.tenant_id;
  if (!tenantId) throw new Error("no_tenant");
  const role = String((profile as any)?.role || "").toLowerCase();
  const isAdmin = STAMP_ADMIN_ROLES.has(role) || !!(profile as any)?.is_platform_admin;
  if (!isAdmin) throw new Error("owner_or_admin_required_for_company_stamp");

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

  const { tenantId, userId } = await getCurrentTenantAndUser();
  const ext = safeStampExtension(file);
  // The existing avatars bucket RLS only allows writes under the current user's
  // first path segment. The tenant-level URL is still saved in tenant settings.
  const path = `${userId}/pdf-assets/${tenantId}/company-stamp-${Date.now()}.${ext}`;

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
