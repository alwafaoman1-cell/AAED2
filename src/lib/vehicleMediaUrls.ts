import { refreshSignedUrls } from "@/lib/refreshSignedUrls";

type MediaReference = {
  storage_bucket?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  url?: string | null;
};

/** Storage path, not a signed URL, is the durable identity of an image. */
export function parseMediaStorageReference(reference: string, bucketHint?: string | null) {
  if (!reference || reference.startsWith("data:") || reference.startsWith("blob:")) return null;
  if (!/^https?:\/\//i.test(reference)) {
    return bucketHint && bucketHint !== "legacy-inline" ? { bucket: bucketHint, path: reference } : null;
  }
  try {
    const pathname = new URL(reference).pathname;
    const match = pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/i);
    if (!match) return null;
    return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

export function mediaStorageKey(bucket: string, reference: string) {
  const parsed = parseMediaStorageReference(reference, bucket);
  return parsed ? `${parsed.bucket}:${parsed.path}` : reference;
}

export function canonicalMediaReference(reference: string, bucket: string) {
  const parsed = parseMediaStorageReference(reference, bucket);
  return parsed?.bucket === bucket ? parsed.path : reference;
}

/** Re-sign each unique file once per read. Never persist the resulting expiring URL. */
export async function resolveVehicleMediaUrls<T extends MediaReference>(rows: T[]): Promise<Array<T & { url: string }>> {
  const groups = new Map<string, Set<string>>();
  const references = rows.map((row) => {
    const bucket = row.storage_bucket || "insurance-docs";
    const parsed = parseMediaStorageReference(row.storage_path || "", bucket)
      || parseMediaStorageReference(row.public_url || row.url || "", bucket);
    if (parsed) {
      if (!groups.has(parsed.bucket)) groups.set(parsed.bucket, new Set());
      groups.get(parsed.bucket)!.add(parsed.path);
    }
    return parsed;
  });
  const urls = new Map<string, string>();
  await Promise.all(Array.from(groups.entries()).map(async ([bucket, paths]) => {
    const uniquePaths = Array.from(paths);
    for (let index = 0; index < uniquePaths.length; index += 100) {
      const signed = await refreshSignedUrls(bucket, uniquePaths.slice(index, index + 100));
      signed.forEach((url, path) => urls.set(`${bucket}:${path}`, url));
    }
  }));
  return rows.map((row, index) => {
    const parsed = references[index];
    const signed = parsed ? urls.get(`${parsed.bucket}:${parsed.path}`) : null;
    const fallback = [row.url, row.public_url, row.storage_path].find((value) =>
      value && (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")));
    return { ...row, url: signed || fallback || "" };
  });
}

export async function resolveImageReferences(references: string[], bucket: string): Promise<string[]> {
  const rows = references.map((storage_path) => ({ storage_bucket: bucket, storage_path }));
  return (await resolveVehicleMediaUrls(rows)).map((row) => row.url);
}
