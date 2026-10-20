import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("guarded soft-deleted work order restoration", () => {
  it("restores one tenant-owned order atomically without reopening delivered vehicles", () => {
    const sql = read("supabase/migrations/20261019120000_guarded_work_order_restore.sql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("auth.uid() is null or v_tenant is null");
    expect(sql).toContain("public.get_user_role()::text not in ('admin', 'manager')");
    expect(sql).toContain("where id = p_order_id and tenant_id = v_tenant");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_old.deleted_at is distinct from p_expected_deleted_at");
    expect(sql).toContain("when lower(coalesce(v_old.status::text, '')) in ('delivered', 'closed'");
    expect(sql).toContain("then coalesce(v_old.archived_at, v_old.vehicle_delivered_at, v_old.completed_at, v_old.deleted_at)");
    expect(sql).toContain("where id = v_old.id and tenant_id = v_tenant");
    expect(sql).toContain("update public.app_trash");
    expect(sql).toContain("insert into public.operational_audit_log");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toContain("update public.insurance_claims");
    expect(sql).not.toContain("update public.sales_documents");
    expect(sql).not.toContain("update public.expenses");
  });

  it("refuses stale or mismatched records and never touches peer work orders", () => {
    const store = read("src/lib/workOrdersStore.ts");
    const restore = store.slice(
      store.indexOf("export async function restoreWorkOrderFromTrash"),
      store.indexOf("export async function refreshWorkOrdersFromCloud"),
    );
    expect(restore).toContain('if (!isUuid(cloudId))');
    expect(restore).toContain('eq("tenant_id", ctx.tenantId)');
    expect(restore).toContain('eq("id", cloudId)');
    expect(restore).toContain("current.order_number?.toUpperCase() !== expectedNumber.toUpperCase()");
    expect(restore).toContain('rpc("restore_deleted_work_order"');
    expect(restore).toContain("p_expected_deleted_at: current.deleted_at");
    expect(restore).not.toContain(".neq(");
    expect(restore).not.toContain(".gte(");
    expect(restore).not.toContain(".update(");
  });

  it("shows a read-only deleted state with a restore action and delivery link", () => {
    const detail = read("src/pages/WorkOrderDetail.tsx");
    const delivery = read("src/pages/WorkOrderDeliveryPage.tsx");
    expect(detail).toContain("deleted_at,");
    expect(detail).toContain("deletedAt: (data as any).deleted_at || undefined");
    expect(detail).toContain("if (order.deletedAt) {");
    expect(detail).toContain("استعادة أمر العمل");
    expect(detail).toContain("restoreWorkOrderFromTrash(order)");
    expect(detail.indexOf("if (order.deletedAt) {")).toBeLessThan(detail.indexOf("const currentIdx ="));
    expect(delivery).toContain("فتح الأمر المحذوف واستعادته");
    expect(delivery).toContain("result?.deletedAt");
  });
});
