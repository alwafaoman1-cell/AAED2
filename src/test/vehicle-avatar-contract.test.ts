import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("vehicle avatar unified component contract", () => {
  it("uses vehicle_media hooks and supports hover, dialog, upload, and delete", () => {
    const component = read("src/components/vehicles/VehicleAvatar.tsx");
    const hooks = read("src/hooks/useVehicleAvatar.ts");
    const service = read("src/lib/vehicleAvatarService.ts");

    expect(component).toContain("HoverCard");
    expect(component).toContain("Dialog");
    expect(component).toContain("useVehicleAvatar");
    expect(component).toContain("useUploadVehicleAvatar");
    expect(component).toContain("useDeleteVehicleAvatar");
    expect(component).toContain("loading=\"lazy\"");
    expect(component).toContain("object-contain");

    expect(hooks).toContain("queryKeys.vehicleMedia.avatar");
    expect(service).toContain('.from("vehicle_media" as any)');
    expect(service).toContain('category", "vehicle_avatar"');
    expect(service).toContain("deleteVehicleAvatar");
  });

  it("passes vehicleId in the main vehicle avatar surfaces", () => {
    expect(read("src/pages/WorkOrders.tsx")).toMatch(/<VehicleAvatar[\s\S]*vehicleId=\{order\.vehicleId\}/);
    expect(read("src/pages/WorkOrderDetail.tsx")).toMatch(/<VehicleAvatar[\s\S]*vehicleId=\{order\.vehicleId\}/);
    expect(read("src/pages/insurance/InsuranceClaimsList.tsx")).toContain("vehicleId={c.vehicle_id}");
    expect(read("src/pages/insurance/InsuranceClaimDetail.tsx")).toContain("vehicleId={vehicleId || (vehicle as any)?.id || (existing as any)?.vehicle_id}");
    expect(read("src/pages/VehicleDetail.tsx")).toContain("vehicleId={vehicle.cloudId}");
    expect(read("src/pages/Vehicles.tsx")).toContain("vehicleId={v.cloudId}");
  });

  it("adds a non destructive avatar uniqueness migration", () => {
    const migration = read("supabase/migrations/20260720143000_vehicle_avatar_media.sql");
    expect(migration).toContain("vehicle_media_one_active_avatar_idx");
    expect(migration).toContain("category = 'vehicle_avatar'");
    expect(migration).toContain("deleted_at is null");
    expect(migration).not.toMatch(/\bdrop\s+table\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
