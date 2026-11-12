import { describe, it, expect } from "vitest";
import { localSignatureMediaUrl } from "@/lib/vehicleSignatureMedia";
const endpoint = "http://127.0.0.1:5196/vehicle-entry-signature-media";
const dev = "https://rrhyglrnlveygyiandhs.supabase.co";
describe("local signature service cannot redirect release traffic", () => {
  it("requires the explicit URL, Development project, and a loopback page", () => {
    expect(localSignatureMediaUrl(endpoint, dev, "127.0.0.1")).toBe(endpoint);
    expect(localSignatureMediaUrl(undefined, dev, "127.0.0.1")).toBeNull();
    expect(localSignatureMediaUrl(endpoint, "https://other.supabase.co", "127.0.0.1")).toBeNull();
    expect(localSignatureMediaUrl(endpoint, dev, "aaed-2.vercel.app")).toBeNull();
  });
  it.each([endpoint + "?token=secret", endpoint + "#fragment", endpoint.replace("5196", "9999"), endpoint.replace("127.0.0.1", "evil.test"), endpoint.replace("http://", "http://user:password@")])("rejects alternate endpoints %s", candidate => {
    expect(localSignatureMediaUrl(candidate, dev, "127.0.0.1")).toBeNull();
  });
});
