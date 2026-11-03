import { supabase } from "@/integrations/supabase/client";
import { resolveVehicleMediaUrls } from "@/lib/vehicleMediaUrls";

export interface ClaimRearPhotoTarget {
  id: string;
  vehicle_id: string | null;
  vehicle_entry_id?: string | null;
}

export interface RearPhotoRow {
  id: string;
  vehicle_id: string | null;
  claim_id: string | null;
  vehicle_entry_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  uploaded_at: string | null;
}

/** Prefer a photo from this claim/visit; otherwise use the vehicle's latest rear photo. */
export function selectClaimRearPhotos(
  claims: ClaimRearPhotoTarget[],
  rows: RearPhotoRow[],
): Record<string, RearPhotoRow> {
  const byVehicle = new Map<string, RearPhotoRow[]>();
  for (const row of rows) {
    if (!row.vehicle_id) continue;
    if (!byVehicle.has(row.vehicle_id)) byVehicle.set(row.vehicle_id, []);
    byVehicle.get(row.vehicle_id)!.push(row);
  }
  const selected: Record<string, RearPhotoRow> = {};
  for (const claim of claims) {
    const candidates = claim.vehicle_id ? byVehicle.get(claim.vehicle_id) || [] : [];
    const photo = candidates.find((row) => row.claim_id === claim.id ||
      (claim.vehicle_entry_id && row.vehicle_entry_id === claim.vehicle_entry_id)) || candidates[0];
    if (photo) selected[claim.id] = photo;
  }
  return selected;
}

async function loadRearPhotos(
  tenantId: string,
  column: "vehicle_id" | "vehicle_entry_id",
  ids: string[],
): Promise<RearPhotoRow[]> {
  const rows: RearPhotoRow[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from("vehicle_media" as any)
        .select("id,vehicle_id,claim_id,vehicle_entry_id,storage_bucket,storage_path,public_url,uploaded_at")
        .eq("tenant_id", tenantId)
        .in(column, batch)
        .eq("media_type", "image")
        .eq("category", "rear_view")
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + 499);
      if (error) throw error;
      const page = (data || []) as unknown as RearPhotoRow[];
      rows.push(...page);
      if (page.length < 500) break;
    }
  }
  return rows;
}

async function signSelectedPhotos(selected: Record<string, RearPhotoRow>): Promise<Record<string, string>> {
  const ids = Object.keys(selected);
  if (!ids.length) return {};
  const signed = await resolveVehicleMediaUrls(ids.map((id) => selected[id]));
  return Object.fromEntries(ids.map((id, index) => [id, signed[index].url]).filter(([, url]) => !!url));
}

export async function getClaimRearThumbnailUrls(
  tenantId: string,
  claims: ClaimRearPhotoTarget[],
): Promise<Record<string, string>> {
  const vehicleIds = Array.from(new Set(claims.map((claim) => claim.vehicle_id).filter((id): id is string => !!id)));
  if (!tenantId || !vehicleIds.length) return {};
  const rows = await loadRearPhotos(tenantId, "vehicle_id", vehicleIds);
  return signSelectedPhotos(selectClaimRearPhotos(claims, rows));
}

/** Entry photos are matched by visit ID, so a later visit cannot replace the current visit's thumbnail. */
export async function getEntryRearThumbnailUrls(tenantId: string, entryIds: string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(entryIds.filter(Boolean)));
  if (!tenantId || !ids.length) return {};
  const rows = await loadRearPhotos(tenantId, "vehicle_entry_id", ids);
  const selected: Record<string, RearPhotoRow> = {};
  for (const row of rows) {
    if (row.vehicle_entry_id && !selected[row.vehicle_entry_id]) selected[row.vehicle_entry_id] = row;
  }
  return signSelectedPhotos(selected);
}
