// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import ClaimWorkspaceNavigation from "@/components/insurance/ClaimWorkspaceNavigation";
import ClaimAmountSummary, { type ClaimAmountSummaryItem } from "@/components/insurance/ClaimAmountSummary";

const originalLanguage = i18n.language;

beforeEach(async () => { await i18n.changeLanguage("en"); });
afterEach(async () => { cleanup(); await i18n.changeLanguage(originalLanguage); });

function NavigationFixture({ isNew = false, onChange }: { isNew?: boolean; onChange?: (value: string) => void }) {
  const [value, setValue] = useState("inspect");
  return (
    <Tabs value={value} onValueChange={(next) => { onChange?.(next); setValue(next); }}>
      <ClaimWorkspaceNavigation isNew={isNew} />
      <TabsContent value="inspect">Inspection content</TabsContent>
      <TabsContent value="estimate">Estimate content</TabsContent>
      <TabsContent value="delivery">Delivery content</TabsContent>
      <TabsContent value="payments">Billing content</TabsContent>
    </Tabs>
  );
}

describe("claim workspace navigation", () => {
  it("selects the existing stage in its parent tabs without its own navigation state", () => {
    const onChange = vi.fn();
    render(<NavigationFixture onChange={onChange} />);
    const navigation = screen.getByRole("tablist", { name: "Claim stages" });
    expect(within(navigation).getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "Inspection & photos" })).toHaveAttribute("aria-selected", "true");

    fireEvent.focus(screen.getByRole("tab", { name: "Estimate" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("estimate");
    expect(screen.getByRole("tab", { name: "Estimate" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Estimate content");
    expect(screen.getByRole("tab", { name: "Amounts & billing" })).toBeEnabled();
  });

  it("keeps delivery and billing unavailable until the claim has been saved", () => {
    const onChange = vi.fn();
    render(<NavigationFixture isNew onChange={onChange} />);
    for (const label of ["Delivery", "Amounts & billing"]) {
      const tab = screen.getByRole("tab", { name: label });
      expect(tab).toBeDisabled();
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Inspection & photos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Approval" })).toBeEnabled();
  });

  it("updates the accessible navigation names and direction when the language changes", async () => {
    const { container } = render(<NavigationFixture />);
    expect(container.textContent).not.toMatch(/[\u0600-\u06ff]/);
    await act(async () => { await i18n.changeLanguage("ar"); });
    const navigation = screen.getByRole("tablist", { name: "مراحل المطالبة" });
    expect(navigation).toHaveAttribute("dir", "rtl");
    expect(within(navigation).getByRole("tab", { name: "الفحص والصور" })).toBeVisible();
    expect(within(navigation).getByRole("tab", { name: "المبالغ والفوترة" })).toBeVisible();
  });
});

describe("claim amount summary", () => {
  it("retains complete caller-formatted amounts and long labels in an accessible read-only summary", () => {
    const items: readonly ClaimAmountSummaryItem[] = Object.freeze([
      Object.freeze({ label: "Estimated repair amount including all approved repair items", value: "999,999,999.999 OMR", detail: "UPL estimate with the customer's complete vehicle repair description" }),
      Object.freeze({ label: "Approved amount", value: "100.000 OMR", tone: "success" as const }),
      Object.freeze({ label: "Final LPO amount", value: "—", detail: "Awaiting insurer LPO" }),
      Object.freeze({ label: "Remaining invoice amount", value: "49.950 OMR", tone: "warning" as const }),
    ]);
    render(<ClaimAmountSummary items={items} />);
    const summary = screen.getByRole("region", { name: "Amount summary" });
    expect(within(summary).getByRole("heading", { name: "Amount summary", level: 2 })).toBeVisible();
    expect(within(summary).getAllByRole("term")).toHaveLength(4);
    expect(within(summary).getAllByRole("definition")).toHaveLength(4);
    for (const item of items) {
      expect(within(summary).getByText(item.label)).toBeVisible();
      const value = within(summary).getByText(item.value);
      expect(value).toBeVisible();
      expect(value).toHaveAttribute("dir", "ltr");
      expect(value).toHaveAttribute("data-amount", "true");
      if (item.detail) expect(within(summary).getByText(item.detail)).toBeVisible();
    }
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
    expect(within(summary).queryByRole("textbox")).not.toBeInTheDocument();
    expect(items[0].value).toBe("999,999,999.999 OMR");
  });

  it("uses an Arabic summary name while preserving the supplied Latin amount", async () => {
    await i18n.changeLanguage("ar");
    render(<ClaimAmountSummary items={[{ label: "المبلغ المعتمد", value: "1,234.567 OMR" }]} />);
    expect(screen.getByRole("region", { name: "ملخص المبالغ" })).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("1,234.567 OMR")).toHaveAttribute("dir", "ltr");
  });
});
