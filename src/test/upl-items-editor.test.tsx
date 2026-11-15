// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n";
import UplItemsEditor from "@/components/insurance/UplItemsEditor";
import { DEFAULT_UPL_ITEMS, type UplItem } from "@/components/insurance/uplItems";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const originalLanguage = i18n.language;

beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage("en"); });
afterEach(async () => { cleanup(); await i18n.changeLanguage(originalLanguage); });

function EditorFixture({ initialItems }: { initialItems: UplItem[] }) {
  const [items, setItems] = useState(initialItems);
  return <UplItemsEditor items={items} onChange={setItems} />;
}

describe("responsive UPL item editor", () => {
  it("retains long descriptions and recalculates row and overall totals through the labelled fields", () => {
    const description = "Front bumper repair including brackets, clips, reinforcement and the complete inspection notes supplied by the insurer";
    render(<EditorFixture initialItems={[
      { description, quantity: 2, unit_price: 10.5 },
      { description: "Labour", quantity: 1, unit_price: 5 },
    ]} />);
    const item = screen.getByRole("group", { name: "Item 1" });
    const descriptionInput = within(item).getByRole("textbox", { name: "Description" });
    expect(descriptionInput.tagName).toBe("TEXTAREA");
    expect(descriptionInput).toHaveValue(description);
    expect(screen.getByRole("status", { name: "Items total" })).toHaveTextContent("26.000 OMR");

    fireEvent.change(within(item).getByRole("textbox", { name: "Quantity" }), { target: { value: "3" } });
    fireEvent.change(within(item).getByRole("textbox", { name: "Unit price (OMR)" }), { target: { value: "2.125" } });

    expect(within(item).getByRole("status", { name: "Item total" })).toHaveTextContent("6.375 OMR");
    const total = screen.getByRole("status", { name: "Items total" });
    expect(total).toHaveTextContent("11.375 OMR");
    expect(total).toHaveAttribute("dir", "ltr");
    expect(total).toHaveAttribute("data-amount", "true");
    expect(descriptionInput).toHaveValue(description);
    fireEvent.click(within(item).getByRole("button", { name: "Remove item 1" }));
    expect(screen.getByRole("status", { name: "Items total" })).toHaveTextContent("5.000 OMR");
  });

  it("adds pasted items without replacing rows or repeating existing and duplicate lines", () => {
    const existing = { description: "Front bumper", quantity: 2, unit_price: 12.5 };
    const onChange = vi.fn();
    render(<UplItemsEditor items={[existing]} onChange={onChange} />);
    const bulk = screen.getByRole("textbox", { name: "Add multiple items" });
    fireEvent.change(bulk, { target: { value: "1. front bumper\n- Headlight\nHeadlight\n\n2. Door" } });
    fireEvent.click(screen.getByRole("button", { name: "Add list to items" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      existing,
      { description: "Headlight", quantity: 1, unit_price: "" },
      { description: "Door", quantity: 1, unit_price: "" },
    ]);
    expect(existing).toEqual({ description: "Front bumper", quantity: 2, unit_price: 12.5 });
    expect(bulk).toHaveValue("");
    expect(toast.success).toHaveBeenCalledWith("Added 2 items to the UPL estimate. Enter prices manually, then save the claim.");
  });

  it("preserves default and suggested-price assignment rules", () => {
    const onChange = vi.fn();
    render(<UplItemsEditor items={[]} onChange={onChange} suggestedAmount={125.5} />);
    fireEvent.click(screen.getByRole("button", { name: "Spare parts + labour charges" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_UPL_ITEMS);
    fireEvent.click(screen.getByRole("button", { name: "Apply suggested price to parts" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_UPL_ITEMS.map((item, index) => ({ ...item, unit_price: index === 0 ? 125.5 : 0 })));
    fireEvent.click(screen.getByRole("button", { name: "Apply suggested price to labour" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_UPL_ITEMS.map((item, index) => ({ ...item, unit_price: index === 1 ? 125.5 : 0 })));
    expect(DEFAULT_UPL_ITEMS.map((item) => item.unit_price)).toEqual([0, 0]);
  });

  it("keeps read-only fields disabled and exposes no item mutation controls", () => {
    render(<UplItemsEditor items={[{ description: "Stored item", quantity: 1, unit_price: 15 }]} onChange={vi.fn()} readOnly suggestedAmount={100} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    for (const field of screen.getAllByRole("textbox")) expect(field).toBeDisabled();
    expect(screen.getByRole("status", { name: "Items total" })).toHaveTextContent("15.000 OMR");
  });

  it("switches every UI label and currency to Arabic without changing stored descriptions", async () => {
    const { container } = render(<UplItemsEditor items={[{ description: "Custom stored item", quantity: 1, unit_price: 7.25 }]} onChange={vi.fn()} suggestedAmount={100} />);
    expect(container.textContent).not.toMatch(/[\u0600-\u06ff]/);
    await act(async () => { await i18n.changeLanguage("ar"); });
    const editor = screen.getByRole("region", { name: "بنود التقدير (UPL)" });
    expect(editor).toHaveAttribute("dir", "rtl");
    expect(within(editor).getByRole("button", { name: "تعبئة السعر في قطع الغيار" })).toBeVisible();
    expect(within(editor).getByRole("textbox", { name: "الوصف" })).toHaveValue("Custom stored item");
    expect(within(editor).getByRole("status", { name: "إجمالي البنود" })).toHaveTextContent("7.250 ر.ع.");
    expect(editor.textContent).not.toMatch(/Estimate items|Description|Quantity|Unit price|OMR|Apply suggested|Add item/);
  });
});
