// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeAttendanceTab from "@/pages/staff/EmployeeAttendanceTab";

const mock = vi.hoisted(() => ({
  load: vi.fn(), propose: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
  manual: [] as Array<{ id: string; employeeId: string; date: string; status: "absent"; notes: string; createdAt: string }>,
}));

vi.mock("@/lib/attendance/attendanceCloud", () => ({ loadEmployeePunches: mock.load }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: vi.fn() } } }));
vi.mock("@/lib/employeeHrReports", () => ({ printAttendanceMonth: vi.fn().mockResolvedValue(undefined) }));
vi.mock("sonner", () => ({ toast: { success: mock.toastSuccess, error: mock.toastError } }));
vi.mock("@/lib/hrStore", () => ({
  hrStore: {
    uid: () => "manual-1", nowIso: () => "2026-10-27T00:00:00Z",
    listAttendance: () => mock.manual, listAttendanceSettlements: () => [], listLeaves: () => [],
    proposeAttendanceDeduction: mock.propose, getEmployee: () => ({ id: "employee-1", name: "Test", employeeNumber: "EMP-0014" }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.manual.length = 0;
  mock.load.mockResolvedValue([{ personId: "7", personName: "", deviceKey: "TEMO Attendance", occurredAt: "2026-10-24T08:05:00+04:00", eventCode: 1 }]);
  mock.propose.mockResolvedValue({ id: "proposal-1" });
});

describe("employee attendance review", () => {
  it("labels the 21:00 checkout as estimated and does not auto-deduct payroll", async () => {
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByText(/21:00 estimated checkout/)).toBeTruthy());
    expect(screen.getByText(/Late\/shortfall are review indicators/)).toBeTruthy();
    expect(mock.propose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "2.500" } });
    fireEvent.change(screen.getByPlaceholderText("Documented reason"), { target: { value: "Reviewed late arrival" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose only" }));
    await waitFor(() => expect(mock.propose).toHaveBeenCalledWith("employee-1", expect.stringMatching(/^\d{4}-\d{2}$/), 2.5, "Reviewed late arrival", "late"));
  });

  it("keeps the device punch visible alongside a manual correction for the same date", async () => {
    mock.manual.push({ id: "manual-1", employeeId: "employee-1", date: "2026-10-24", status: "absent", notes: "Manual review", createdAt: "2026-10-27T00:00:00Z" });
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByText(/Device punch · 21:00 estimated checkout/)).toBeTruthy());
    expect(screen.getByText(/Manual record · Manual review/)).toBeTruthy();
  });
});
