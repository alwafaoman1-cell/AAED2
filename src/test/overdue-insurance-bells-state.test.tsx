// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { readFileSync } from "node:fs";
import NotificationsBell from "@/components/NotificationsBell";
import InsuranceOverdueBell from "@/components/insurance/InsuranceOverdueBell";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";
import type { OverdueCompany } from "@/hooks/useOverdueInsuranceAlerts";

const runtime = vi.hoisted(() => ({ query: {
  data: undefined as OverdueCompany[] | undefined,
  isSuccess: false, isError: false, isFetching: true,
  fetchStatus: "fetching" as "idle" | "fetching" | "paused",
  refetch: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("@/hooks/useOverdueInsuranceAlerts", () => ({ useOverdueInsuranceAlerts: () => runtime.query }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children, dir }: PropsWithChildren<{ dir: string }>) => <div dir={dir}>{children}</div>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: PropsWithChildren) => <>{children}</>,
  TabsList: ({ children }: PropsWithChildren) => <>{children}</>,
  TabsTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  TabsContent: ({ children, value }: PropsWithChildren<{ value: string }>) => value === "alerts" ? <>{children}</> : null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }>) => <button {...props}>{children}</button>,
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/notificationsStore", () => ({ notificationsStore: { list: () => [], subscribe: () => () => {} }, getEntityRoute: () => "/" }));
vi.mock("@/lib/auditLogStore", () => ({ getActionLabel: () => "", getEntityLabel: () => "" }));
vi.mock("@/lib/notificationSound", () => ({ notificationSound: { enabled: () => false, subscribe: () => () => {} } }));
vi.mock("@/lib/adminNotificationsStore", () => ({ adminNotificationsStore: { init: () => Promise.resolve(), list: () => [], subscribe: () => () => {} } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const i18n = createInstance();
const i18nReady = i18n.use(initReactI18next).init({
  lng: "en", fallbackLng: "en", interpolation: { escapeValue: false },
  resources: { en: { translation: en }, ar: { translation: ar } },
});
const warning: OverdueCompany = { companyId: "co1", name: "Insurer One", remaining: 70, oldestDays: 120, claimsCount: 2, termsDays: 90 };

describe.each([NotificationsBell, InsuranceOverdueBell])("%s overdue query integration", (Bell) => {
  beforeEach(async () => {
    Object.assign(runtime.query, { data: undefined, isSuccess: false, isError: false, isFetching: true, fetchStatus: "fetching" });
    runtime.query.refetch.mockClear();
    await i18nReady;
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);
  const mount = async () => { await act(async () => { render(<I18nextProvider i18n={i18n}><Bell /></I18nextProvider>); }); };
  const expectNotHealthyZero = () => {
    expect(screen.queryByText(en.overdueInsuranceAlerts.empty)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  };

  it("shows translated pending state rather than an empty result", async () => {
    await mount();
    expect(screen.getByRole("status").textContent).toBe(en.overdueInsuranceAlerts.loading);
    expectNotHealthyZero();
  });

  it.each([{ label: "undefined", data: undefined }, { label: "empty", data: [] }])("shows errors even when cached data is $label, with an explicit retry", async ({ data }) => {
    Object.assign(runtime.query, { data, isError: true, isFetching: false, fetchStatus: "idle" });
    await mount();
    expect(screen.getByRole("alert").textContent).toContain(en.overdueInsuranceAlerts.loadError);
    expectNotHealthyZero();
    fireEvent.click(screen.getByRole("button", { name: en.overdueInsuranceAlerts.retry }));
    expect(runtime.query.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(["idle", "paused"] as const)("shows unknown state for an unconfirmed %s read", async (fetchStatus) => {
    Object.assign(runtime.query, { isFetching: false, fetchStatus });
    await mount();
    expect(screen.getByRole("status").textContent).toBe(en.overdueInsuranceAlerts.unknown);
    expectNotHealthyZero();
  });

  it("does not display cached empty as healthy while paused or refreshing", async () => {
    Object.assign(runtime.query, { data: [], isSuccess: true, isFetching: false, fetchStatus: "paused" });
    await mount();
    expect(screen.getByRole("status").textContent).toBe(en.overdueInsuranceAlerts.unknown);
    expectNotHealthyZero();
    cleanup();
    Object.assign(runtime.query, { isFetching: true, fetchStatus: "fetching" });
    await mount();
    expect(screen.getByRole("status").textContent).toBe(en.overdueInsuranceAlerts.loading);
    expectNotHealthyZero();
  });

  it("shows the empty message only after a successful complete read", async () => {
    Object.assign(runtime.query, { data: [], isSuccess: true, isFetching: false, fetchStatus: "idle" });
    await mount();
    expect(screen.getByText(en.overdueInsuranceAlerts.empty)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps cached warnings and payment navigation visible alongside a refresh error", async () => {
    Object.assign(runtime.query, { data: [warning], isError: true, isFetching: false, fetchStatus: "idle" });
    await mount();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(warning.name)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.overdueInsuranceAlerts.openPayments })).toBeTruthy();
    expectNotHealthyZero();
  });

  it("renders Arabic error state and retry using the same resource keys", async () => {
    await i18n.changeLanguage("ar");
    Object.assign(runtime.query, { isError: true, isFetching: false, fetchStatus: "idle" });
    await mount();
    expect(screen.getByRole("alert").textContent).toContain(ar.overdueInsuranceAlerts.loadError);
    expect(screen.getByRole("button", { name: ar.overdueInsuranceAlerts.retry })).toBeTruthy();
    expect(screen.queryByText(en.overdueInsuranceAlerts.loadError)).toBeNull();
  });
});

describe("overdue bell source regression", () => {
  it("keeps the third consumer's payment KPI and alert list on confirmed query data", () => {
    const source = readFileSync("src/pages/insurance/InsurancePayments.tsx", "utf8");
    expect(source).toContain("const overdue = useOverdueInsuranceAlerts()");
    expect(source).toContain("const overdueList = overdue.data");
    expect(source).not.toContain("const overdueList = useOverdueInsuranceAlerts()");
    expect(source).not.toMatch(/overdue\.(?:reduce|map|length)\b/);
    expect(source).not.toMatch(/overdue\.data\s*\?\?\s*\[\]/);
    expect(source).toContain("const overdueAmount = overdueKnown && overdueList ? overdueList.reduce");
    expect(source).toContain(", 0) : null");
    expect(source).toContain('stats.overdueAmount === null ? "—"');
    expect(source).toContain('overdue.isError ? "loadError"');
    expect(source).toContain('overdue.fetchStatus !== "paused"');
    expect(source).toContain("overdueList && (overdueKnown || overdueList.length > 0)");
    expect(source).toContain('role={overdue.isError ? "alert" : "status"}');
    expect(source).toContain("void overdue.refetch()");
  });

  it.each(["src/components/NotificationsBell.tsx", "src/components/insurance/InsuranceOverdueBell.tsx"])("keeps %s on the query-result contract, not the old array API", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/overdue\.(?:length|map)\b/);
    expect(source).not.toMatch(/overdue\.data\s*\?\?\s*\[\]/);
    expect(source).toContain('overdue.isError ? "loadError"');
    expect(source).toContain('overdue.fetchStatus !== "paused"');
    expect(source).toContain("overdueKnown &&");
    expect(source).toContain('role={overdue.isError ? "alert" : "status"}');
  });

  it("provides identical Arabic/English keys with English-only English messages", () => {
    expect(Object.keys(en.overdueInsuranceAlerts).sort()).toEqual(Object.keys(ar.overdueInsuranceAlerts).sort());
    for (const value of Object.values(en.overdueInsuranceAlerts)) expect(value).not.toMatch(/[\u0600-\u06ff]/);
  });
});
