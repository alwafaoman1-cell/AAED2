import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("phase 4 performance architecture contracts", () => {
  it("reads only the requested tenant setting with scoped cache and realtime invalidation", () => {
    const source = read("src/lib/cloudSettings.ts");

    expect(source).not.toContain("loadAllCloudSettings");
    expect(source).toContain('.select("value,version")');
    expect(source).toContain('.eq("key", key)');
    expect(source).toContain("scopedKey");
    expect(source).toContain("clearCloudSettingsCache");
    expect(source).toContain("pendingReads");
    expect(source).toContain('.channel(`tenant_settings:${tenantId}:');
  });

  it("uses vehicle_media metadata for Media Studio initial vehicle view instead of recursive storage listing", () => {
    const source = read("src/pages/MediaStudio.tsx");

    expect(source).toContain('useState<string>("__vehicles__")');
    expect(source).toContain("listVehicleMediaIndex");
    expect(source).toContain('.from("vehicle_media" as any)');
    expect(source).toContain("loadVehicleMediaIndex()");
    expect(source).toContain("vehicleGroups.slice(0, 20)");
  });

  it("keeps signed URL generation cached and de-duplicated", () => {
    const source = read("src/lib/refreshSignedUrls.ts");

    expect(source).toContain("signedUrlCache");
    expect(source).toContain("pendingSignedUrlRequests");
    expect(source).toContain("requestSignedUrls");
  });
});
