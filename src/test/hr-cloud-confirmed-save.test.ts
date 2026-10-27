import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser, getSession: mocks.getSession }, from: mocks.from },
}));

type HrData = Record<string, Array<{ id: string; employeeNumber?: string; [key: string]: unknown }>>;
const emptyHr = (): HrData => ({
  employees: [], advances: [], deductions: [], bonuses: [], leaves: [],
  attendance: [], payslips: [], documents: [], reviews: [],
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getCurrentTenantId.mockResolvedValue("tenant-dev");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-dev" } }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-dev" } } }, error: null });
});

describe("HR confirmed cloud writes", () => {
  it("keeps attendance deductions outside payroll until a manager approves", async () => {
    let row: { value: HrData; version: number } = { value: { ...emptyHr(), employees: [{ id: "employee-1", employeeNumber: "EMP-0014" }] }, version: 1 };
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = { eq: () => query, maybeSingle: async () => ({ data: structuredClone(row), error: null }) };
        return query;
      },
      update: (payload: { value: HrData }) => {
        let expectedVersion = 0;
        const query: any = {
          eq: (column: string, value: number) => { if (column === "version") expectedVersion = value; return query; },
          select: () => query,
          maybeSingle: async () => {
            if (expectedVersion !== row.version) return { data: null, error: null };
            row = { value: payload.value, version: row.version + 1 };
            return { data: { version: row.version }, error: null };
          },
        };
        return query;
      },
    }));
    const settings = await import("@/lib/cloudSettings");
    settings.setCloudSettingsTenantScope("tenant-dev");
    const { hrStore } = await import("@/lib/hrStore");
    const proposed = await hrStore.proposeAttendanceDeduction("employee-1", "2026-10", 12.5, "Reviewed late arrival");
    expect(hrStore.summary("employee-1", "2026-10")).toMatchObject({ monthDeductions: 0, proposedAttendanceDeductions: 12.5 });
    await expect(hrStore.proposeAttendanceDeduction("employee-1", "2026-10", 10, "Duplicate pending"))
      .rejects.toThrow("ATTENDANCE_SETTLEMENT_PENDING");
    await hrStore.decideAttendanceDeduction(proposed.id, "rejected", "manager-1");
    const revised = await hrStore.proposeAttendanceDeduction("employee-1", "2026-10", 10, "Reviewed revised amount");
    expect(revised.id).not.toBe(proposed.id);
    expect(hrStore.listAttendanceSettlements("employee-1", "2026-10")).toHaveLength(2);
    expect(hrStore.listAttendanceSettlements("employee-1", "2026-10")[1]).toMatchObject({ id: proposed.id, approvalStatus: "rejected" });
    expect(hrStore.summary("employee-1", "2026-10")).toMatchObject({ monthDeductions: 0, proposedAttendanceDeductions: 10 });
    await hrStore.decideAttendanceDeduction(revised.id, "approved", "manager-1");
    expect(hrStore.summary("employee-1", "2026-10")).toMatchObject({ monthDeductions: 10, proposedAttendanceDeductions: 0 });
    await expect(hrStore.removeDeduction(proposed.id)).rejects.toThrow("ATTENDANCE_SETTLEMENT_IMMUTABLE");
    const priorMonth = await hrStore.proposeAttendanceDeduction("employee-1", "2026-09", 3, "Late records reviewed later");
    row.value.payslips.push({ id: "paid-slip", employeeId: "employee-1", month: "2026-09", paidAt: "2026-10-01" });
    await expect(hrStore.decideAttendanceDeduction(priorMonth.id, "approved", "manager-1"))
      .rejects.toThrow("ATTENDANCE_PAYSLIP_ALREADY_PAID");
    expect(hrStore.summary("employee-1", "2026-09")).toMatchObject({ monthDeductions: 0, proposedAttendanceDeductions: 3 });
  });

  it("keeps an employee out of the local list when the database rejects the save", async () => {
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
        return query;
      },
      insert: () => {
        const query: any = {
          select: () => query,
          maybeSingle: async () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
        };
        return query;
      },
    }));
    const settings = await import("@/lib/cloudSettings");
    settings.setCloudSettingsTenantScope("tenant-dev");
    const { hrStore } = await import("@/lib/hrStore");
    const employee = {
      id: "employee-a", employeeNumber: "EMP-0001", name: "Test", position: "Technician",
      employmentStatus: "active" as const, baseSalary: 100, createdAt: "2026-10-22", updatedAt: "2026-10-22",
    };

    await expect(hrStore.saveEmployee(employee)).rejects.toMatchObject({ code: "42501" });
    expect(hrStore.getEmployee(employee.id)).toBeUndefined();
  });

  it("retries concurrent HR writes and allocates distinct employee numbers", async () => {
    let row = { value: emptyHr(), version: 1 };
    let reads = 0;
    let conflicts = 0;
    const firstReads: Array<(value: unknown) => void> = [];
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = {
          eq: () => query,
          maybeSingle: () => {
            const snapshot = { data: { value: structuredClone(row.value), version: row.version }, error: null };
            reads += 1;
            if (reads > 2) return Promise.resolve(snapshot);
            return new Promise((resolve) => {
              firstReads.push(resolve);
              if (firstReads.length === 2) firstReads.forEach((done) => done(snapshot));
            });
          },
        };
        return query;
      },
      update: (payload: { value: HrData }) => {
        let expectedVersion = 0;
        const query: any = {
          eq: (column: string, value: number) => {
            if (column === "version") expectedVersion = value;
            return query;
          },
          select: () => query,
          maybeSingle: async () => {
            if (expectedVersion !== row.version) {
              conflicts += 1;
              return { data: null, error: null };
            }
            row = { value: payload.value, version: row.version + 1 };
            return { data: { version: row.version }, error: null };
          },
        };
        return query;
      },
    }));
    const settings = await import("@/lib/cloudSettings");
    settings.setCloudSettingsTenantScope("tenant-dev");
    const { hrStore } = await import("@/lib/hrStore");
    const employee = (id: string) => ({
      id, employeeNumber: "EMP-0001", name: id, position: "Technician",
      employmentStatus: "active" as const, baseSalary: 100, createdAt: "2026-10-22", updatedAt: "2026-10-22",
    });

    const saved = await Promise.all([hrStore.saveEmployee(employee("a")), hrStore.saveEmployee(employee("b"))]);
    expect(conflicts).toBe(1);
    expect(saved.map((item) => item.employeeNumber).sort()).toEqual(["EMP-0001", "EMP-0002"]);
    expect(row.value.employees.map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("rejects a stale employee edit instead of overwriting another user's changes", async () => {
    const latest = {
      id: "employee-a", employeeNumber: "EMP-0001", name: "Latest cloud name",
      position: "Technician", employmentStatus: "active" as const, baseSalary: 100,
      createdAt: "2026-10-22T10:00:00.000Z", updatedAt: "2026-10-22T11:00:00.000Z",
    };
    const update = vi.fn();
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = {
          eq: () => query,
          maybeSingle: async () => ({ data: { value: { ...emptyHr(), employees: [latest] }, version: 2 }, error: null }),
        };
        return query;
      },
      update,
    }));
    const settings = await import("@/lib/cloudSettings");
    settings.setCloudSettingsTenantScope("tenant-dev");
    const { hrStore } = await import("@/lib/hrStore");

    await expect(hrStore.saveEmployee({ ...latest, name: "Stale form name", updatedAt: "2026-10-22T10:00:00.000Z" }))
      .rejects.toThrow("HR_RECORD_CONFLICT");
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a private document cleanup pointer until object deletion is confirmed", async () => {
    let row = { value: emptyHr(), version: 1 };
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = { eq: () => query, maybeSingle: async () => ({ data: structuredClone(row), error: null }) };
        return query;
      },
      update: (payload: { value: HrData }) => {
        let expectedVersion = 0;
        const query: any = {
          eq: (column: string, value: number) => { if (column === "version") expectedVersion = value; return query; },
          select: () => query,
          maybeSingle: async () => {
            if (expectedVersion !== row.version) return { data: null, error: null };
            row = { value: payload.value, version: row.version + 1 };
            return { data: { version: row.version }, error: null };
          },
        };
        return query;
      },
    }));
    const settings = await import("@/lib/cloudSettings");
    settings.setCloudSettingsTenantScope("tenant-dev");
    const { hrStore } = await import("@/lib/hrStore");
    const document = {
      id: "document-1", employeeId: "employee-1", name: "Contract", type: "contract" as const,
      storagePath: "tenant-dev/employee-1/file", uploadedAt: "2026-10-22T10:00:00Z",
    };
    await hrStore.saveDocument(document);
    await hrStore.removeDocument(document.id);
    expect(hrStore.listDocuments(document.employeeId)).toEqual([]);
    expect(hrStore.pendingDocumentCleanup(document.employeeId)[0]).toMatchObject({ storagePath: document.storagePath });
    await hrStore.finishDocumentCleanup(document.id);
    expect(hrStore.pendingDocumentCleanup(document.employeeId)).toEqual([]);
    expect(row.value.documents).toEqual([]);
  });
});
