import { supabase } from "@/integrations/supabase/client";

const TTL = 60 * 60 * 24 * 7; // 7 days
const CACHE_SKEW_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = TTL * 1000 - CACHE_SKEW_MS;

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const pendingSignedUrlRequests = new Map<string, Promise<string | null>>();

function cacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function readCachedSignedUrl(bucket: string, path: string): string | null {
  const key = cacheKey(bucket, path);
  const cached = signedUrlCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    signedUrlCache.delete(key);
    return null;
  }
  return cached.url;
}

function writeCachedSignedUrl(bucket: string, path: string, url: string) {
  signedUrlCache.set(cacheKey(bucket, path), {
    url,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function requestSignedUrls(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!paths.length) return map;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, TTL);
    if (!error && data) {
      data.forEach((row: any, index: number) => {
        const path = row?.path || paths[index];
        if (path && row?.signedUrl) map.set(path, row.signedUrl);
      });
    }
  } catch (e) {
    console.warn("[refreshSignedUrls] batch failed", e);
  }

  const missing = paths.filter((path) => !map.has(path));
  if (missing.length) {
    try {
      const { data, error } = await supabase.functions.invoke("sign-storage-url", {
        body: { bucket, paths: missing, expiresIn: TTL },
      });
      if (!error && data?.urls) {
        (data.urls as Array<{ path: string; signedUrl: string | null }>).forEach((row) => {
          if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
        });
      }
    } catch (e) {
      console.warn("[refreshSignedUrls] fallback failed", e);
    }
  }

  map.forEach((url, path) => writeCachedSignedUrl(bucket, path, url));
  return map;
}

/**
 * Refresh signed Storage URLs for paths in one bucket.
 * Uses in-memory TTL cache and in-flight de-duplication to avoid re-signing the
 * same file repeatedly while navigating between pages.
 */
export async function refreshSignedUrls(
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cleaned = Array.from(new Set(paths.filter((p) => !!p)));
  if (!cleaned.length) return map;

  const freshPaths: string[] = [];
  const pendingResults: Array<Promise<void>> = [];

  for (const path of cleaned) {
    const cached = readCachedSignedUrl(bucket, path);
    if (cached) {
      map.set(path, cached);
      continue;
    }

    const key = cacheKey(bucket, path);
    const pending = pendingSignedUrlRequests.get(key);
    if (pending) {
      pendingResults.push(pending.then((url) => {
        if (url) map.set(path, url);
      }));
      continue;
    }

    freshPaths.push(path);
  }

  if (freshPaths.length) {
    const batchPromise = requestSignedUrls(bucket, freshPaths);
    freshPaths.forEach((path) => {
      const key = cacheKey(bucket, path);
      const pending = batchPromise.then((result) => result.get(path) ?? null);
      pendingSignedUrlRequests.set(key, pending);
      pending.finally(() => pendingSignedUrlRequests.delete(key));
      pendingResults.push(pending.then((url) => {
        if (url) map.set(path, url);
      }));
    });
  }

  if (pendingResults.length) {
    await Promise.all(pendingResults);
  }

  return map;
}

/**
 * Refresh a single signed URL. Used as a preview-dialog fallback.
 */
export async function refreshSignedUrl(bucket: string, path: string): Promise<string | null> {
  if (!path) return null;
  const urls = await refreshSignedUrls(bucket, [path]);
  return urls.get(path) ?? null;
}
