// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import NavHistoryButtons from "@/components/NavHistoryButtons";
import AutoBreadcrumb from "@/components/AutoBreadcrumb";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), setTheme: vi.fn() }));
vi.mock("react-router-dom", async (original) => ({ ...await original<object>(), useNavigate: () => mocks.navigate }));
vi.mock("@/contexts/useTheme", () => ({ useTheme: () => ({ theme: "dark", resolved: "dark", setTheme: mocks.setTheme }) }));
afterEach(() => { cleanup(); mocks.navigate.mockClear(); mocks.setTheme.mockClear(); });
describe("compact mobile navigation", () => {
  it.each(["ar", "en"])("retains navigation, readable labels and correct direction in %s", async language => {
    await i18n.changeLanguage(language);
    render(<NavHistoryButtons />);
    const back = screen.getByRole("button", { name: language === "ar" ? "رجوع" : "Back" });
    const forward = screen.getByRole("button", { name: language === "ar" ? "للأمام" : "Forward" });
    fireEvent.click(back); fireEvent.click(forward);
    expect(mocks.navigate.mock.calls).toEqual([[-1], [1]]);
    expect(back.querySelector("svg")).toHaveAttribute("width", "16");
    expect(back.querySelector("svg")).toHaveClass(language === "ar" ? "lucide-chevron-right" : "lucide-chevron-left");
    expect(back).toHaveClass("h-9", "w-9", "shadow-none");
    expect(back.className).not.toMatch(/scale-105|shadow-md/);
    expect(back).toHaveAttribute("title", back.getAttribute("aria-label"));
  });
  it.each(["ar", "en"])("names the center breadcrumb instead of exposing the raw route in %s", async language => {
    await i18n.changeLanguage(language);
    render(<MemoryRouter initialEntries={["/vehicle-entry"]}><AutoBreadcrumb /></MemoryRouter>);
    expect(screen.getByText(language === "ar" ? "مركز دورة المركبة" : "Vehicle Operations Center")).toBeTruthy();
    expect(screen.queryByText("vehicle-entry")).toBeNull();
  });
  it.each(["ar", "en"])("keeps a single named language control with a compact mobile target in %s", async language => {
    await i18n.changeLanguage(language);
    render(<LanguageSwitcher compactOnMobile />);
    const control = screen.getByRole("button", { name: new RegExp(i18n.t("lang.switch")) });
    expect(control).toHaveClass("h-9", "w-9");
    expect(control).toHaveAttribute("title", control.getAttribute("aria-label"));
    expect(control.querySelector("span")).toHaveClass("hidden", "sm:inline");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.keyDown(control, { key: "Enter" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
  it.each(["ar", "en"])("names appearance options explicitly rather than relying on automatic text translation in %s", async language => {
    await i18n.changeLanguage(language);
    render(<ThemeToggle />);
    fireEvent.keyDown(screen.getByRole("button", { name: language === "ar" ? "تبديل المظهر" : "Switch appearance" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: language === "ar" ? "فاتح" : "Light" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });
});
