// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeAttendanceTab from "@/pages/staff/EmployeeAttendanceTab";

const mock = vi.hoisted(() => ({
  load: vi.fn(), reviewLoad: vi.fn(), propose: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
  manual: [] as Array<{ id: string; employeeId: string; date: string; status: "absent"; notes: string; createdAt: string }>,
}));

vi.mock("@/lib/attendance/attendanceCloud", () => ({ loadEmployeePunches: mock.load, loadAttendanceReviews: mock.reviewLoad }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: vi.fn() } } }));
vi.mock("@/lib/employeeHrReports", () => ({ printAttendanceMonth: vi.fn().mockResolvedValue(undefined) }));
vi.mock("sonner", () => ({ toast: { success: mock.toastSuccess, error: mock.toastError } }));
vi.mock("@/lib/hrStore", () => ({
  hrStore: {
    uid: () => "manual-1", nowIso: () => "2026-10-27T00:00:00Z",
    listAttendance: () => mock.manual, listAttendanceSettlements: () => [], listLeaves: () => [], listPayslips: () => [],
    proposeAttendanceDeduction: mock.propose, getEmployee: () => ({ id: "employee-1", name: "Test", employeeNumber: "EMP-0014" }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.manual.length = 0;
  mock.load.mockResolvedValue([{ personId: "7", personName: "", deviceKey: "TEMO Attendance", occurredAt: "2026-10-24T08:05:00+04:00", eventCode: 1 }]);
  mock.reviewLoad.mockResolvedValue({ monthReview: { id: "coverage-1", coverage_start: "2026-10-24", coverage_end: "2026-10-24", grace_minutes: 0, created_at: "2026-10-27T00:00:00Z" }, dayReviews: [] });
  mock.propose.mockResolvedValue({ id: "proposal-1" });
});

describe("employee attendance review", () => {
  it("does not infer a full day from one morning punch or deduct payroll automatically", async () => {
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByText("AM absent")).toBeTruthy());
    expect(screen.getByText(/no automatic payroll deduction/)).toBeTruthy();
    expect(mock.propose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Settle account" }));
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "2.500" } });
    fireEvent.change(screen.getByPlaceholderText("Documented reason"), { target: { value: "Reviewed late arrival" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose only" }));
    await waitFor(() => expect(mock.propose).toHaveBeenCalledWith("employee-1", expect.stringMatching(/^\d{4}-\d{2}$/), 2.5, "Reviewed late arrival", "late"));
  });

  it("keeps the device punch visible alongside a manual correction for the same date", async () => {
    mock.manual.push({ id: "manual-1", employeeId: "employee-1", date: "2026-10-24", status: "absent", notes: "Manual review", createdAt: "2026-10-27T00:00:00Z" });
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByText(/1 raw punches/)).toBeTruthy());
    expect(screen.getByText(/Legacy manual record/)).toBeTruthy();
  });

  it("does not show a record-based absence while month coverage is unconfirmed", async () => {
    mock.reviewLoad.mockResolvedValue({ monthReview: null, dayReviews: [] });
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByText(/Month import coverage is not confirmed/)).toBeTruthy());
    expect(screen.getByText("Full no-punch days").parentElement?.textContent).toContain("0");
    expect(screen.getByText(/1 raw punches/)).toBeTruthy();
  });

  it("shows immutable raw device times inside the day-review dialog", async () => {
    render(<EmployeeAttendanceTab employeeId="employee-1" isAr={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Review/edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review/edit" }));
    expect(screen.getByText(/Original device punches/)).toBeTruthy();
    expect(screen.getByText(/08:05 \[1\]/)).toBeTruthy();
    expect(screen.getByText(/Original punches remain unchanged/)).toBeTruthy();
  });
});
