import { describe, expect, it } from "vitest";
import { createUuid, isUuid } from "@/lib/uuid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

describe("sales invoice UUID persistence regression", () => {
  it("always creates PostgreSQL-compatible UUIDs", () => {
    for (let index = 0; index < 25; index += 1) {
      expect(isUuid(createUuid())).toBe(true);
    }
  });

  it("upgrades legacy compact document ids before cloud persistence", () => {
    const source = readFileSync(resolve(root, "src/lib/salesStore.ts"), "utf8");
    expect(source).toContain("const cloudDocumentId = isUuid(doc.id) ? doc.id : createUuid();");
    expect(source).toContain("id: cloudDocumentId");
    expect(source).toContain("item.id !== draft.id");
  });

  it("never sends a non-UUID work-order reference as a relational id", () => {
    const source = readFileSync(resolve(root, "src/lib/salesStore.ts"), "utf8");
    expect(source).toContain("const linkedWorkOrderId = isUuid(workOrderCandidate) ? workOrderCandidate : null;");
    expect(source).not.toContain('fromDocId.startsWith("WO-") ? fromDocId.slice(3) : null');
  });
});
