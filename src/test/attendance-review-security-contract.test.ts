import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20261027090208_hr_attendance_review_and_coverage.sql"), "utf8");
const cloud = readFileSync(resolve(root, "src/lib/attendance/attendanceCloud.ts"), "utf8");

describe("audited attendance reviews", () => {
  it("uses append-only tenant-scoped manager reviews, not edits to device punches", () => {
    expect(migration).toContain("alter table public.hr_attendance_day_reviews enable row level security");
    expect(migration).toContain("alter table public.hr_attendance_month_reviews enable row level security");
    expect(migration).toContain("tenant_id = (select public.get_user_tenant_id())");
    expect(migration).toContain("'manager'::public.app_role");
    expect(migration).toContain("created_by = (select auth.uid())");
    expect(migration).toContain("grant select, insert on public.hr_attendance_month_reviews, public.hr_attendance_day_reviews to authenticated");
    expect(migration).not.toMatch(/grant\s+[^;]*(?:update|delete)\s+on\s+public\.hr_attendance_(?:day|month)_reviews/i);
    expect(cloud).not.toMatch(/from\("hr_attendance_punches"\)[\s\S]{0,50}\.(?:update|delete)\(/);
  });

  it("requires explicit month coverage and read-back after each correction", () => {
    expect(cloud).toContain("isCompletedAttendanceDate(coverageEnd)");
    expect(cloud).toContain('from("hr_attendance_month_reviews").insert(');
    expect(cloud).toContain('from("hr_attendance_day_reviews").insert(');
    expect(cloud.match(/\.select\("\*"\)\.single\(\)/g)).toHaveLength(2);
  });
});
