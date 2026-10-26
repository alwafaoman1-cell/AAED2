// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import AutoTranslateBoot from "@/i18n/AutoTranslateBoot";
import { stopAutoTranslate } from "@/i18n/autoTranslate";

describe("lazy English UI translation boot", () => {
  beforeEach(async () => {
    stopAutoTranslate(true);
    await i18n.changeLanguage("ar");
  });

  afterEach(async () => {
    cleanup();
    stopAutoTranslate(true);
    await i18n.changeLanguage("ar");
  });

  it("keeps Arabic unchanged until English is selected, then restores it", async () => {
    const view = render(
      <>
        <AutoTranslateBoot />
        <button type="button">حذف</button>
      </>,
    );
    const button = view.getByRole("button");
    expect(button).toHaveTextContent("حذف");

    await act(async () => { await i18n.changeLanguage("en"); });
    await waitFor(() => expect(button).toHaveTextContent("Delete"));

    await act(async () => { await i18n.changeLanguage("ar"); });
    expect(button).toHaveTextContent("حذف");
  });

  it("gives every sidebar destination a direct Arabic and English label", () => {
    const sidebar = readFileSync(resolve(process.cwd(), "src/components/AppSidebar.tsx"), "utf8");
    const keys = [...sidebar.matchAll(/labelKey: "(nav\.[^"]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const arabic = i18n.getResource("ar", "translation", key);
      const english = i18n.getResource("en", "translation", key);
      expect(arabic, `Missing Arabic sidebar label: ${key}`).toBeTypeOf("string");
      expect(english, `Missing English sidebar label: ${key}`).toBeTypeOf("string");
      expect(english, `Arabic leaked into English sidebar: ${key}`).not.toMatch(/[\u0600-\u06ff]/);
    }
  });
});
