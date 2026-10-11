import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production smoke safety", () => {
  it("blocks the legacy mutating smoke test unless write authority is explicit", () => {
    const script = resolve("scripts/production-smoke.mjs");
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, SMOKE_ALLOW_WRITES: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Write smoke blocked");
  });

  it("keeps the read-only probe free of database mutations and service-role access", () => {
    const script = readFileSync(resolve("scripts/production-readonly-smoke.mjs"), "utf8");
    expect(script).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
    expect(script).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(script).toContain("anonymous row exposure");
  });
});
