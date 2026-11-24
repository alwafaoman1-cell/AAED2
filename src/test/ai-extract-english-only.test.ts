import { describe, expect, it } from "vitest";
import { englishOnlyExtractedValue as serverValue } from "../../supabase/functions/_shared/englishExtraction";
import { englishOnlyValue as clientValue } from "@/lib/documentExtraction/languagePolicy";

describe("English-only extraction validation at both trust boundaries", () => {
  it.each(["Ahmed علي", "أحمد ALI", "١٢٣٤٥", "ABC، DEF", "شركة تجريبية", { owner: "TEST" }, true, null, Infinity])("never accepts Arabic or non-scalar provider values", value => {
    expect(serverValue(value)).toBe("");
    expect(clientValue(value)).toBe("");
  });
  it.each(["C/004/01/26/9999/00001", "1HGCM82633A004352", "47782 B", "TEST OWNER", "Replace front bumper", 105.5])("preserves English identifiers and printed values", value => {
    expect(serverValue(value)).toBe(String(value));
    expect(clientValue(value)).toBe(String(value));
  });
  it("removes display-direction controls without translating a value", () => {
    expect(serverValue("\u200eTEST OWNER\u200f")).toBe("TEST OWNER");
    expect(clientValue("\u200eTEST OWNER\u200f")).toBe("TEST OWNER");
  });
});
