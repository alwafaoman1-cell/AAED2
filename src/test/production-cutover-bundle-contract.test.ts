import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
describe("atomic Production migration bundle", () => {
  it("has explicit SQL boundaries between all individually verified components", () => {
    const root = resolve(process.cwd(), "supabase/migrations");
    const path = readdirSync(root).find(file => file.endsWith("_production_finance_security_inspection_cutover.sql"));
    expect(path).toBeTruthy();
    const source = readFileSync(resolve(root, path!), "utf8");
    expect(source.match(/^-- COMPONENT /gm)).toHaveLength(20);
    expect(source.match(/^;\r?\n-- COMPONENT /gm)).toHaveLength(20);
    expect(source).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(source).not.toContain("rrhyglrnlveygyiandhs");
  });
});
