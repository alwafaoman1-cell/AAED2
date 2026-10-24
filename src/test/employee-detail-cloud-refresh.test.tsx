// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeDetail from "@/pages/staff/EmployeeDetail";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en", dir: () => "ltr" }, t: (key: string) => key }) }));

const mock = vi.hoisted(() => ({
  employee: null as null | Record<string, unknown>,
  listener: null as null | (() => void),
  saveEmployee: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mock.toastError, success: mock.toastSuccess } }));

vi.mock("@/lib/hrStore", () => ({
  HR_DEPARTMENTS_AR: [],
  HR_POSITIONS_AR: [],
  hrStore: {
    subscribe: (listener: () => void) => { mock.listener = listener; return () => { mock.listener = null; }; },
    loadState: () => "ready",
    saveEmployee: (...args: unknown[]) => mock.saveEmployee(...args),
    getEmployee: (id: string) => mock.employee?.id === id ? mock.employee : undefined,
    summary: () => ({ monthBonuses: 0, monthDeductions: 0, advanceMonthlyRepay: 0, totalAdvancesOutstanding: 0 }),
    listAdvances: () => [],
    listDeductions: () => [],
    listBonuses: () => [],
    listPayslips: () => [],
    listLeaves: () => [],
    listAttendance: () => [],
    listDocuments: () => [],
    listReviews: () => [],
  },
}));

beforeEach(() => {
  mock.employee = null;
  mock.listener = null;
  mock.saveEmployee.mockReset();
  mock.toastError.mockReset();
  mock.toastSuccess.mockReset();
});

describe("employee detail cloud refresh", () => {
  it("shows the employee after the asynchronous cloud store update", async () => {
    render(
      <MemoryRouter initialEntries={["/staff/employee-1"]}>
        <Routes><Route path="/staff/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Not found")).toBeTruthy();

    act(() => {
      mock.employee = {
        id: "employee-1", employeeNumber: "EMP-0001", name: "Test Employee",
        position: "Technician", employmentStatus: "active", baseSalary: 200,
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      };
      mock.listener?.();
    });

    await waitFor(() => expect(screen.getByText("Test Employee")).toBeTruthy());
    expect(screen.getByText("EMP-0001")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("Test Employee"), { target: { value: "Unsaved edit" } });
    act(() => {
      mock.employee = { ...mock.employee, position: "Senior Technician" };
      mock.listener?.();
    });
    expect(screen.getByDisplayValue("Unsaved edit")).toBeTruthy();
  });

  it("preserves the edited form and never claims success when the cloud rejects it", async () => {
    mock.employee = {
      id: "employee-1", employeeNumber: "EMP-0001", name: "Test Employee",
      position: "Technician", employmentStatus: "active", baseSalary: 200,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    };
    mock.saveEmployee.mockRejectedValue(new Error("cloud rejected"));
    render(
      <MemoryRouter initialEntries={["/staff/employee-1"]}>
        <Routes><Route path="/staff/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByDisplayValue("Test Employee"), { target: { value: "Edited locally" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.toastError).toHaveBeenCalledOnce());
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Edited locally")).toBeTruthy();
  });
});
