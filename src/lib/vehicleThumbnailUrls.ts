import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { parseMediaStorageReference } from "@/lib/vehicleMediaUrls";

type ThumbnailReference = {
  storage_bucket?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  url?: string | null;
};
type ThumbnailSize = { width: number; height: number };
type SignJob = { generation: number; run: () => Promise<string | null>; resolve: (url: string | null) => void };

const SIGNED_TTL_SECONDS = 3_600;
const EXPIRY_SKEW_MS = 60_000;
const MAX_CONCURRENT_SIGNS = 4;
const MAX_CACHED_URLS = 500;
const thumbnailCache = new Map<string, { url: string; expiresAt: number }>();
const pendingThumbnails = new Map<string, Promise<string | null>>();
const signQueue: SignJob[] = [];
let activeSigns = 0;
let generation = 0;
let activeTenantId: string | null = null;
let activeUserId: string | null = null;
let lastAuthUserId: string | null = null;

/** Memory only: never persist thumbnail URLs or upload a second Storage object. */
export function clearVehicleThumbnailCache(): void {
  generation += 1;
  activeTenantId = null;
  activeUserId = null;
  thumbnailCache.clear();
  pendingThumbnails.clear();
  signQueue.splice(0).forEach((job) => job.resolve(null));
  // Old running requests retain their slots until completion: auth changes
  // must not let overlapping batches exceed the global concurrency limit.
}

supabase.auth.onAuthStateChange((event, session) => {
  const userId = session?.user?.id ?? null;
  if (event === "SIGNED_OUT" || event === "USER_UPDATED" || userId !== lastAuthUserId) {
    clearVehicleThumbnailCache();
  }
  lastAuthUserId = userId;
});

function drainSignQueue(): void {
  while (activeSigns < MAX_CONCURRENT_SIGNS && signQueue.length) {
    const job = signQueue.shift()!;
    if (job.generation !== generation) {
      job.resolve(null);
      continue;
    }
    activeSigns += 1;
    void job.run().then(job.resolve, () => job.resolve(null)).finally(() => {
      activeSigns -= 1;
      drainSignQueue();
    });
  }
}

function isTransformedSignedUrl(url: string, bucket: string, path: string): boolean {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/storage\/v1\/render\/image\/sign\/([^/]+)\/(.+)$/);
    return parsed.origin === new URL(import.meta.env.VITE_SUPABASE_URL).origin &&
      !!match && decodeURIComponent(match[1]) === bucket && decodeURIComponent(match[2]) === path &&
      !!parsed.searchParams.get("token");
  } catch {
    return false;
  }
}

function signThumbnail(tenantId: string, bucket: string, path: string, size: ThumbnailSize): Promise<string | null> {
  const transform = { width: size.width, height: size.height, resize: "cover" as const, quality: 65 };
  const key = JSON.stringify([tenantId, bucket, path, transform]);
  const cached = thumbnailCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    thumbnailCache.delete(key);
    thumbnailCache.set(key, cached);
    return Promise.resolve(cached.url);
  }
  if (cached) thumbnailCache.delete(key);
  const pending = pendingThumbnails.get(key);
  if (pending) return pending;

  const requestGeneration = generation;
  const request = new Promise<string | null>((resolve) => {
    signQueue.push({
      generation: requestGeneration,
      resolve,
      run: async () => {
        const startedAt = Date.now();
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL_SECONDS, { transform });
        if (requestGeneration !== generation) return null;
        if (error || !data?.signedUrl || !isTransformedSignedUrl(data.signedUrl, bucket, path)) {
          // No original/public URL fallback: that would download the full-size
          // image and conceal an unavailable or disabled transformation service.
          console.warn("[vehicleThumbnailUrls] Private thumbnail unavailable; original not substituted.");
          return null;
        }
        const expiresAt = startedAt + SIGNED_TTL_SECONDS * 1_000 - EXPIRY_SKEW_MS;
        if (expiresAt <= Date.now()) return null;
        thumbnailCache.set(key, { url: data.signedUrl, expiresAt });
        while (thumbnailCache.size > MAX_CACHED_URLS) thumbnailCache.delete(thumbnailCache.keys().next().value!);
        return data.signedUrl;
      },
    });
    drainSignQueue();
  });
  pendingThumbnails.set(key, request);
  void request.finally(() => {
    if (pendingThumbnails.get(key) === request) pendingThumbnails.delete(key);
  });
  return request;
}

/**
 * Rear-list thumbnails only. Same canonical bucket/path as the original, served
 * through private Image Transformations (existing Pro+ capability required).
 * Previews/PDFs continue using resolveVehicleMediaUrls without transformations.
 */
export async function resolveVehicleThumbnailUrls<T extends ThumbnailReference>(
  tenantId: string,
  rows: T[],
  size: ThumbnailSize = { width: 144, height: 144 },
): Promise<Array<T & { url: string }>> {
  const empty = () => rows.map((row) => ({ ...row, url: "" }));
  const dimensions = { width: size.width, height: size.height };
  if (!tenantId || !rows.length || ![dimensions.width, dimensions.height].every((value) => Number.isInteger(value) && value >= 1 && value <= 2_500)) return empty();
  const startedGeneration = generation;
  const startedTenant = activeTenantId;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return empty();
    const userId = data.session?.user?.id;
    if (!userId) {
      if (generation === startedGeneration) clearVehicleThumbnailCache();
      return empty();
    }
    const currentTenant = await getCurrentTenantId();
    if (startedGeneration !== generation && !(
      startedTenant === null && activeTenantId === tenantId && activeUserId === userId && generation === startedGeneration + 1
    )) return empty();
    if (currentTenant !== tenantId) {
      if (activeTenantId === tenantId || !currentTenant) clearVehicleThumbnailCache();
      return empty();
    }
    if (activeTenantId !== tenantId || activeUserId !== userId) {
      clearVehicleThumbnailCache();
      activeTenantId = tenantId;
      activeUserId = userId;
    }
    lastAuthUserId = userId;
    const requestGeneration = generation;
    const urls = await Promise.all(rows.map(async (row) => {
      const bucket = row.storage_bucket || "insurance-docs";
      const source = parseMediaStorageReference(row.storage_path || "", bucket) ||
        parseMediaStorageReference(row.public_url || row.url || "", bucket);
      // RLS remains authoritative; reject cross-tenant/traversal references
      // before signing too. Inline/external legacy media is not duplicated.
      if (!source || !source.path.startsWith(`${tenantId}/`) || source.path.includes("\\") ||
        source.path.split("/").some((part) => part === "." || part === "..")) return "";
      return await signThumbnail(tenantId, source.bucket, source.path, dimensions) || "";
    }));
    if (requestGeneration !== generation) return empty();
    return rows.map((row, index) => ({ ...row, url: urls[index] }));
  } catch {
    return empty();
  }
}
