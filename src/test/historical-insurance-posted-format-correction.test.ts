import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("posted historical insurance number format correction", () => {
  const migration = read("supabase/migrations/20261025144615_historical_insurance_posted_format_correction.sql");
  const existingRpc = read("supabase/migrations/20261024074710_historical_insurance_invoice_number_correction.sql");
  const runtime = read("supabase/tests/issued_invoice_number_correction_runtime.sql");

  it("changes only the guard definition, never financial or existing invoice rows", () => {
    expect(migration).toContain("create or replace function public.guard_historical_insurance_number_window()");
    expect(migration).not.toMatch(/^\s*(update|delete|insert)\s+(?:into\s+|from\s+)?public\./im);
    expect(migration).not.toContain("set_config(");
  });

  it("permits only same-sequence registered corrections with matching posted snapshots", () => {
    expect(migration).toContain("r.source_table = 'insurance_invoices'");
    expect(migration).toContain("r.source_id = old.id");
    expect(migration).toContain("r.invoice_number = new.invoice_number");
    expect(migration).toContain("r.sequence_number = nullif(ltrim(old.invoice_number, '0'), '')::bigint");
    expect(migration).toContain("l.source_number_snapshot is distinct from old.invoice_number");
    expect(migration).toContain("e.status is distinct from 'posted'");
    expect(migration).toContain("l.source_type is distinct from 'insurance_invoice'");
    expect(migration).toContain("INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED");
    expect(migration).toContain("INVOICE_NUMBER_CORRECTION_FINALIZED");
    expect(migration).toContain("INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED");
  });

  it("keeps the existing audited RPC and tests journal invariants", () => {
    expect(existingRpc).toContain("'old_invoice_number', v_old_number");
    expect(existingRpc).toContain("v_sequence <> ltrim(v_old_number, '0')::bigint");
    expect(runtime).toContain("TEST_POSTED_DIRECT_NUMBER_CHANGE_ALLOWED");
    expect(runtime).toContain("TEST_POSTED_HISTORICAL_FORMAT_CORRECTION_FAILED");
    expect(runtime).toContain("source_number_snapshot");
    expect(runtime).toContain("where source_id = x.posted_insurance_id");
    expect(runtime).toContain("fixtures rolled back");
  });
});
