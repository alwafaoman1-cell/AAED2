import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { complianceCutoff, complianceTypeFromSelection, complianceTypeSelection, daysUntilExpiry, deriveHrComplianceEntries } from "@/lib/compliance/complianceService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("licences and contracts register", () => {
  it("uses three calendar months and handles expired dates", () => {
    expect(complianceCutoff("2026-10-10")).toBe("2027-01-10");
    expect(complianceCutoff("2026-01-31")).toBe("2026-04-30");
    expect(daysUntilExpiry("2026-10-10", "2026-10-10")).toBe(0);
    expect(daysUntilExpiry("2026-10-09", "2026-10-10")).toBe(-1);
  });

  it("derives employee contracts and documents from HR without duplicates or deleted workers", () => {
    const entries = deriveHrComplianceEntries({
      employees: [
        { id: "e1", name: "Worker One", contractEndDate: "2027-01-10" },
        { id: "e2", name: "Deleted", contractEndDate: "2026-10-10", isDeleted: true },
        { id: "e3", name: "Bad Date", contractEndDate: "2026-02-30" },
        { id: "e4", name: "Former worker", employmentStatus: "terminated", contractEndDate: "2026-11-10" },
      ],
      documents: [
        { id: "d1", employeeId: "e1", name: "Signed contract", type: "contract", expiryDate: "2027-01-10" },
        { id: "d2", employeeId: "e1", name: "Permit", type: "license", expiryDate: "2026-11-10" },
        { id: "d3", employeeId: "e2", name: "Hidden", expiryDate: "2026-11-10" },
        { id: "d4", employeeId: "e4", name: "Former worker document", expiryDate: "2026-11-10" },
      ],
    });
    expect(entries.map((item) => item.id)).toEqual(["hr-document:d2", "hr-contract:e1"]);
    expect(entries.every((item) => item.href === "/staff/e1" && item.source === "hr")).toBe(true);
  });

  it("keeps RLS strict, document storage private, history immutable, and forbids deletes", () => {
    const sql = read("supabase/migrations/20261010120000_compliance_register.sql");
    expect(sql).toContain("alter table public.compliance_records enable row level security");
    expect(sql).toContain("alter table public.compliance_record_audit enable row level security");
    expect(sql.match(/tenant_id = public\.get_user_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("'admin'::app_role, 'manager'::app_role");
    expect(sql).not.toMatch(/create policy [^\n]+ for delete/i);
    expect(sql).toContain("grant select, insert, update on public.compliance_records to authenticated");
    expect(sql).toContain("grant select on public.compliance_record_audit to authenticated");
    expect(sql).toContain("'compliance-documents', 'compliance-documents', false");
    expect(sql).toContain("compliance_records_active_reference_unique");
    expect(sql).not.toMatch(/update\s+public\.(?:employees|tenant_settings|expenses|job_orders)/i);
  });

  it("exposes guarded full pages and visible alerts without altering HR contracts", () => {
    const app = read("src/App.tsx");
    const sidebar = read("src/components/AppSidebar.tsx");
    const breadcrumb = read("src/components/AutoBreadcrumb.tsx");
    const dashboard = read("src/pages/Dashboard.tsx");
    const service = read("src/lib/compliance/complianceService.ts");
    expect(app).toContain('path="/compliance" element={<ProtectedRoute roles={["admin", "manager"]}>');
    expect(app).toContain('path="/compliance/new"');
    expect(sidebar).toContain('path: "/compliance"');
    expect(breadcrumb).toContain('compliance: { ar: "التراخيص والعقود", en: "Licences & Contracts" }');
    expect(sidebar).toContain("complianceAlerts.total > 0");
    expect(dashboard).toContain("<ComplianceAlertsBanner />");
    expect(service).toContain('.eq("key", "alwafa_hr_v1").maybeSingle()');
    expect(service).not.toContain("writeCloudSetting");
  });

  it("preserves built-in kinds and resolves company and worker custom types", () => {
    const id = "58e9d13f-efaa-4c5a-a236-977695a96e16";
    const custom = { id, tenant_id: "tenant", kind: "other" as const, name_ar: "مثال", name_en: "Example" };
    expect(complianceTypeFromSelection("commercial_registration")).toEqual({ kind: "commercial_registration", custom_type_id: null });
    expect(complianceTypeFromSelection(`custom:${id}`, custom)).toEqual({ kind: "other", custom_type_id: id });
    expect(complianceTypeFromSelection(`custom:${id}`, { ...custom, kind: "employee_permit" })).toEqual({ kind: "employee_permit", custom_type_id: id });
    expect(complianceTypeSelection({ kind: "other", custom_type_id: id })).toBe(`custom:${id}`);
    expect(complianceTypeSelection({ kind: "other", custom_type_id: null })).toBe("other");
    expect(() => complianceTypeFromSelection("custom:invalid")).toThrow("COMPLIANCE_TYPE_INVALID");
    expect(() => complianceTypeFromSelection(`custom:${id}`)).toThrow("COMPLIANCE_TYPE_INVALID");
    expect(() => complianceTypeFromSelection("unknown")).toThrow("COMPLIANCE_TYPE_INVALID");
  });

  it("adds reusable bilingual tenant types without changing or backfilling old records", () => {
    const sql = read("supabase/migrations/20261011100000_compliance_custom_types.sql");
    const picker = read("src/components/compliance/ComplianceTypeSelect.tsx");
    const list = read("src/pages/compliance/ComplianceRegisterPage.tsx");
    const detail = read("src/pages/compliance/ComplianceRecordPage.tsx");
    const service = read("src/lib/compliance/complianceService.ts");
    expect(sql).toContain("create table if not exists public.compliance_record_types");
    expect(sql).toContain("name_ar text not null");
    expect(sql).toContain("name_en text not null");
    expect(sql).toContain("alter table public.compliance_record_types enable row level security");
    expect(sql).toContain("check (custom_type_id is null or kind in ('other', 'employee_permit'))");
    expect(sql).toContain("foreign key (tenant_id, custom_type_id, kind)");
    expect(sql).not.toContain("drop index if exists public.compliance_records_active_reference_unique");
    expect(sql).not.toMatch(/update\s+public\.compliance_records/i);
    expect(sql).not.toMatch(/create policy [^\n]+ for (?:update|delete)/i);
    expect(picker).toContain("+ إضافة نوع سجل أو ترخيص");
    expect(picker).toContain("Type name in English");
    expect(picker).toContain("const created = await createComplianceType");
    expect(list).toContain("<ComplianceTypeSelect");
    expect(detail).toContain("<ComplianceTypeSelect");
    expect(detail).toContain('form.kind === "employee_permit"');
    expect(service).toContain('.eq("custom_type_id", customTypeId)');
  });
});
