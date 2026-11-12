import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared mobile status-bar inset", () => {
  it("does not force the English toolbar back into RTL", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).not.toMatch(/html\s*\{\s*direction:\s*rtl/);
    expect(css).toMatch(/html:not\(\[dir\]\)\s*\{\s*direction:\s*rtl/);
  });
  it("keeps the toolbar, fixed menu and drawer below the same iOS safe area", () => {
    const css = readFileSync("src/index.css", "utf8");
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    const sidebar = readFileSync("src/components/AppSidebar.tsx", "utf8");
    expect(css).toContain("--app-safe-area-top: env(safe-area-inset-top, 0px)");
    expect(css).toContain("padding-block-start: calc(var(--app-safe-area-top) + 0.5rem)");
    expect(css).toContain("top: calc(var(--app-safe-area-top) + 0.75rem)");
    expect(layout).toContain("app-top-bar sticky top-0");
    expect(layout).toContain("ps-14 pe-2");
    expect(layout).toContain("sm:ps-16 sm:pe-4 md:pe-6 lg:px-8");
    expect(layout).not.toContain("md:px-6");
    expect(sidebar).toContain("app-mobile-menu-toggle fixed start-3");
    expect(sidebar).not.toContain("fixed top-2");
    expect(sidebar).toContain("h-[100dvh]");
    expect(sidebar).toContain("app-sidebar-safe");
  });
});
