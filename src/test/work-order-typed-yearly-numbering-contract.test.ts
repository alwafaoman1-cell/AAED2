import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260910100000_work_order_cash_insurance_yearly_numbering.sql"),
  "utf8",
);

describe("typed yearly work-order numbering migration", () => {
  it("partitions historical rows by tenant, year and cash/insurance channel", () => {
    expect(sql).toContain("partition by");
    expect(sql).toContain("jo.tenant_id");
    expect(sql).toContain("extract(year from coalesce(jo.entry_date::timestamptz");
    expect(sql).toContain("case when jo.claim_id is not null or jo.work_order_type = 'insurance' then 'I' else 'C' end");
    expect(sql).toContain("'WO-' || channel || '-' || right(order_year::text, 2) || '-' || lpad(sequence_number::text, 4, '0')");
  });

  it("excludes deleted rows, retains archived rows and orders deterministic ties by UUID", () => {
    expect(sql).toContain("where jo.deleted_at is null");
    expect(sql).not.toContain("jo.archived_at is null");
    expect(sql).toContain("jo.created_at nulls last");
    expect(sql).toContain("jo.id");
  });

  it("keeps aliases and text references without changing UUID relations", () => {
    expect(sql).toContain("work_order_number_renumber_audit");
    expect(sql).toContain("old_order_number");
    expect(sql).toContain("new_order_number");
    expect(sql).toContain("UUID foreign keys are left");
    expect(sql).not.toMatch(/set\s+id\s*=/i);
    expect(sql).not.toContain("('expenses', 'linked_work_order_id')");
    expect(sql).not.toContain("('expenses', 'source_work_order_id')");
  });

  it("uses an atomic database allocator scoped by tenant, year and channel", () => {
    expect(sql).toContain("primary key (tenant_id, order_year, channel)");
    expect(sql).toContain("on conflict (tenant_id, order_year, channel) do update");
    expect(sql).toContain("next_value = public.work_order_number_series.next_value + 1");
    expect(sql).toContain("before insert on public.job_orders");
  });

  it("contains no destructive data deletion", () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
  });
});
