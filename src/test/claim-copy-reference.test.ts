import { describe, expect, it } from "vitest";
import { buildClaimCopyReference } from "@/lib/claimCopyReference";

describe("claim copy reference", () => {
  it("builds the exact claim, vehicle and plate line", () => {
    expect(buildClaimCopyReference({
      claimNumber: "C/044/01/26/2539/00003",
      vehicleMake: "Toyota",
      vehicleModel: "RAV4",
      plateNumber: "8335",
      plateLetters: "RR",
    })).toBe("C/044/01/26/2539/00003 TOYOTA RAV4 8335/RR");
  });

  it("does not repeat plate letters already included in the plate", () => {
    expect(buildClaimCopyReference({
      claimNumber: "C-1",
      vehicleMake: "Toyota",
      vehicleModel: "RAV4",
      plateNumber: "8335 / rr",
      plateLetters: "RR",
    })).toBe("C-1 TOYOTA RAV4 8335/RR");
  });

  it("omits missing values without leaving extra spaces", () => {
    expect(buildClaimCopyReference({
      claimNumber: " C-2 ",
      vehicleMake: " لكزس ",
      plateNumber: " 100 ",
    })).toBe("C-2 لكزس 100");
  });
});
