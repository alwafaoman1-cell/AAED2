// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAutoTranslate, stopAutoTranslate } from "@/i18n/autoTranslate";

describe("UI auto translation runtime", () => {
  beforeEach(() => {
    stopAutoTranslate(true);
    document.body.innerHTML = "";
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(Date.now()), 0)
    ));
    window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    stopAutoTranslate(true);
    document.body.innerHTML = "";
  });

  it("translates existing labels and visible attributes, then restores Arabic", () => {
    document.body.innerHTML = `
      <button title="تعديل">حذف</button>
      <input placeholder="بحث" aria-label="بحث" />
    `;

    startAutoTranslate();

    expect(document.querySelector("button")?.textContent).toBe("Delete");
    expect(document.querySelector("button")?.getAttribute("title")).toBe("Edit");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("Search");
    expect(document.querySelector("input")?.getAttribute("aria-label")).toBe("Search");

    stopAutoTranslate(true);

    expect(document.querySelector("button")?.textContent).toBe("حذف");
    expect(document.querySelector("button")?.getAttribute("title")).toBe("تعديل");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("بحث");
  });

  it("translates newly rendered UI without retaining or wrapping DOM nodes", async () => {
    startAutoTranslate();
    const button = document.createElement("button");
    button.textContent = "اعتماد المطالبة";
    document.body.append(button);

    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(button.textContent).toBe("Approve Claim");
    expect(button.parentElement).toBe(document.body);
    expect(button.childNodes).toHaveLength(1);
  });

  it("does not translate explicitly excluded content", () => {
    document.body.innerHTML = `
      <code>حذف</code>
      <span data-no-auto-translate>تعديل</span>
      <span data-no-translate>إضافة</span>
      <span translate="no">بحث</span>
      <svg><text>حذف</text></svg>
      <section data-pdf-layout="invoice"><span>تعديل</span></section>
    `;
    startAutoTranslate();

    expect(document.querySelector("code")?.textContent).toBe("حذف");
    expect(document.querySelector("[data-no-auto-translate]")?.textContent).toBe("تعديل");
    expect(document.querySelector("[data-no-translate]")?.textContent).toBe("إضافة");
    expect(document.querySelector('[translate="no"]')?.textContent).toBe("بحث");
    expect(document.querySelector("svg")?.textContent).toBe("حذف");
    expect(document.querySelector("[data-pdf-layout]")?.textContent).toBe("تعديل");
  });

  it("does not let the browser-translation guard on html disable app translation", () => {
    document.documentElement.setAttribute("translate", "no");
    document.body.innerHTML = `<div id="root" translate="no"><button>حذف</button></div>`;
    startAutoTranslate();

    expect(document.querySelector("button")?.textContent).toBe("Delete");
  });

  it("preserves input values and sensitive business identifiers", () => {
    document.body.innerHTML = `
      <input value="اسم عميل عربي" placeholder="بحث" />
      <span>WO-2026-0001</span>
      <span>INV-2026-00005</span>
      <span>WVWZZZ1JZXW000001</span>
      <span>customer@example.com</span>
      <span>مستند.pdf</span>
    `;
    startAutoTranslate();

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("اسم عميل عربي");
    expect(input.placeholder).toBe("Search");
    expect(document.body.textContent).toContain("WO-2026-0001");
    expect(document.body.textContent).toContain("INV-2026-00005");
    expect(document.body.textContent).toContain("WVWZZZ1JZXW000001");
    expect(document.body.textContent).toContain("customer@example.com");
    expect(document.body.textContent).toContain("مستند.pdf");
  });

  it("keeps one observer and stops translating after cleanup", async () => {
    startAutoTranslate();
    startAutoTranslate();
    stopAutoTranslate(true);

    const label = document.createElement("span");
    label.textContent = "حذف";
    document.body.append(label);
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(label.textContent).toBe("حذف");
  });
});
