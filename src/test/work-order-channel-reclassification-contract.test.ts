import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261012100000_work_order_channel_number_alignment.sql");
const repair = read("supabase/production/work-orders/20261012_reclassify_wo_c_26_0070.sql");
const store = read("src/lib/workOrdersStore.ts");
const detail = read("src/pages/WorkOrderDetail.tsx");
const list = read("src/pages/WorkOrders.tsx");

describe("work-order channel reclassification contract", () => {
  it("uses the authoritative claim/type, original year and atomic typed allocator", () => {
    expect(migration).toContain("trg_reassign_work_order_number_for_channel");
    expect(migration).toContain("before update of work_order_type, claim_id, insurance_claim_number, insurance_company, order_number, status");
    expect(migration).toContain("new.claim_id is not null or new.work_order_type = 'insurance'");
    expect(migration).toContain("if v_new_channel = v_old_channel then");
    expect(migration).toContain("2000 + substring(upper(btrim(old.order_number))");
    expect(migration).toContain("public.allocate_typed_work_order_number(");
    expect(migration).not.toMatch(/update\s+public\.job_orders\s+set\s+order_number/i);
  });

  it("keeps old URLs and dependent references in the same transaction", () => {
    expect(migration).toContain("insert into public.work_order_number_renumber_audit");
    expect(migration).toContain("after update on public.job_orders");
    expect(migration).toContain("when (old.order_number is distinct from new.order_number)");
    expect(migration).toContain("e.work_order_id = new.id");
    expect(migration).toContain("set linked_work_order_id = new.order_number");
    expect(migration).toContain("work_order_channel = v_channel");
    expect(migration).toContain("('vehicle_stay_notifications', 'work_order_number')");
    expect(migration).toContain("revoke all on function public.align_work_order_number_with_channel()");
    expect(migration).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });

  it("fails closed when a cash invoice, insurance link or unresolved expense makes conversion unsafe", () => {
    expect(migration).toContain("WORK_ORDER_CHANNEL_CHANGE_HAS_CASH_INVOICE");
    expect(migration).toContain("WORK_ORDER_CHANNEL_CHANGE_HAS_INSURANCE_LINK");
    expect(migration).toContain("WORK_ORDER_CHANNEL_CHANGE_HAS_UNRESOLVED_EXPENSE");
    expect(migration).toContain("WORK_ORDER_CLAIM_TENANT_MISMATCH");
    expect(migration).toContain("new.tenant_id is distinct from old.tenant_id");
  });

  it("does not auto-run the one-record repair or touch the other insurance 0070 order", () => {
    expect(repair).toContain("WO-C-26-0070");
    expect(repair).toContain("704/0501/2026/C/000023");
    expect(repair).toContain("v_matches <> 1");
    expect(repair).toContain("where id = v_id and tenant_id = v_tenant_id");
    expect(repair).toContain("WO-I-26-0070 is a different UUID and is not touched");
    expect(repair).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });

  it("uses the database-confirmed new number and refreshes the page after saving", () => {
    expect(store).toContain("const saved = await mapSavedJobOrder(verified)");
    expect(store).toContain("const idx = cache.findIndex((o) => o.id === saved.id || o.id === previousOrderNumber");
    expect(store).not.toContain("syncRenamedWorkOrderReferences");
    expect(detail).toContain("if (saved.id !== order.id)");
    expect(detail).toContain("navigate(`/work-orders/${encodeURIComponent(saved.id)}`, { replace: true })");
    expect(list).toContain("void workOrdersPageQuery.refetch()");
  });
});
