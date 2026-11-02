import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { homeForRole } from "@/lib/homeRoute";

describe("vehicle visit landing route", () => {
  it("opens the visit center for workshop and insurance staff", () => {
    expect(homeForRole("admin")).toBe("/vehicle-entry");
    expect(homeForRole("manager")).toBe("/vehicle-entry");
    expect(homeForRole("insurance")).toBe("/vehicle-entry");
  });

  it("preserves specialist apps for their roles", () => {
    expect(homeForRole("supervisor")).toBe("/supervisor");
    expect(homeForRole("technician")).toBe("/technician");
    expect(homeForRole("accountant")).toBe("/accountant");
  });

  it("keeps shortcuts and dashboard accessible after the root redirect", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const sidebar = readFileSync("src/components/AppSidebar.tsx", "utf8");
    expect(app).toContain('<Route path="/" element={<RoleHome />} />');
    expect(app).toContain('<Route path="/home" element={<HomeShortcuts />} />');
    expect(app).toContain('<Route path="/dashboard" element={<Dashboard />} />');
    expect(sidebar).toContain('path: "/vehicle-entry", labelKey: "vehicleVisit.title"');
    expect(sidebar).toContain('path: "/home", labelKey: "nav.shortcuts"');
    expect(sidebar).toContain('path: "/dashboard", labelKey: "nav.dashboard"');
  });
});
