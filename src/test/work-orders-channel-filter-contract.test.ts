import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkOrderType } from "@/lib/workOrderType";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260928140000_work_orders_list_channel_filter_alignment.sql"), "utf8");
const page = readFileSync(resolve(root, "src/pages/WorkOrders.tsx"), "utf8");

describe("work-order list channel filter alignment", () => {
  it("treats an insurance work order without claim_id as insurance", () => {
    expect(resolveWorkOrderType({ workOrderType: "insurance", claimId: null })).toBe("insurance");
    expect(migration).toContain("b.claim_id is not null or b.work_order_type = 'insurance'");
    expect(migration).toContain("b.claim_id is null and b.work_order_type <> 'insurance'");
  });

  it("uses the same classification for server-side insurance and cash counts", () => {
    expect(migration).toContain("where claim_id is not null or work_order_type = 'insurance'");
    expect(migration).toContain("where claim_id is null and work_order_type <> 'insurance'");
    expect(migration).toContain("'totalRows', (select count(*) from filtered)");
  });

  it("does not show the previous channel's rows while a new filter loads", () => {
    expect(page).not.toContain("placeholderData: (previous) => previous");
    expect(page).toContain("ownership: ownershipFilter");
    expect(page).toContain("entryFrom: entryFrom || undefined");
    expect(page).toContain("entryTo: entryTo || undefined");
    expect(migration).toContain("b.entry_date >= (p_filters->>'entryFrom')::date");
    expect(migration).toContain("b.entry_date <= (p_filters->>'entryTo')::date");
  });
});
