// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { installEnglishDigitGuards } from "@/lib/formatters/englishDigitsRuntime";

const originalNumber = Number.prototype.toLocaleString;
const originalDate = Date.prototype.toLocaleString;
const originalDateOnly = Date.prototype.toLocaleDateString;
const originalTime = Date.prototype.toLocaleTimeString;
let listeners: Array<[string, EventListenerOrEventListenerObject]>;
beforeAll(() => {
  const added = vi.spyOn(document, "addEventListener");
  installEnglishDigitGuards();
  listeners = added.mock.calls.filter(([type, , capture]) => (type === "input" || type === "change") && capture === true).map(([type, listener]) => [type, listener]);
  added.mockRestore();
});
afterEach(cleanup);
afterAll(() => {
  for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
  Number.prototype.toLocaleString = originalNumber;
  Date.prototype.toLocaleString = originalDate;
  Date.prototype.toLocaleDateString = originalDateOnly;
  Date.prototype.toLocaleTimeString = originalTime;
});

function ControlledField({ multiline = false, changed }: { multiline?: boolean; changed: (value: string, selection: [number | null, number | null, string | null]) => void }) {
  const [value, setValue] = useState("");
  const props = {
    "aria-label": multiline ? "Notes" : "Identity or plate",
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      changed(event.currentTarget.value, [event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.currentTarget.selectionDirection]);
      setValue(event.currentTarget.value);
    },
  };
  return <>{multiline ? <Textarea {...props} /> : <Input {...props} />}<output data-testid="controlled-value">{value}</output></>;
}

describe("global English digit capture with controlled React fields", () => {
  it.each([
    ["٠٠١۲۳AB", "00123AB"],
    ["۰۰۱٢٣AB", "00123AB"],
    ["٧٧٢٢١", "77221"],
    ["۷۷۲۲۱", "77221"],
  ])("updates controlled ID/plate state once for %s", (raw, expected) => {
    const changed = vi.fn(); render(<ControlledField changed={changed} />);
    const field = screen.getByRole("textbox");
    fireEvent.input(field, { target: { value: raw } });
    expect(field).toHaveValue(expected);
    expect(screen.getByTestId("controlled-value")).toHaveTextContent(expected);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(expected, expect.any(Array));
    // The later native change event must not duplicate the original input.
    fireEvent.change(field, { target: { value: expected } });
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("preserves the selection range and direction through controlled normalization", () => {
    const changed = vi.fn(); render(<ControlledField changed={changed} />);
    const field = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(field, { target: { value: "٠٠١۲۳AB", selectionStart: 2, selectionEnd: 6, selectionDirection: "backward" } });
    expect(changed).toHaveBeenCalledExactlyOnceWith("00123AB", [2, 6, "backward"]);
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 6, "backward"]);
  });
  it("updates controlled textarea state without losing text or line breaks", () => {
    const changed = vi.fn(); render(<ControlledField multiline changed={changed} />);
    const field = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.input(field, { target: { value: "ملاحظة ٠٠١\nرقم ۲۳" } });
    expect(field).toHaveValue("ملاحظة 001\nرقم 23");
    expect(changed).toHaveBeenCalledExactlyOnceWith("ملاحظة 001\nرقم 23", expect.any(Array));
    expect(screen.getByTestId("controlled-value").textContent).toBe("ملاحظة 001\nرقم 23");
  });
  it("keeps an ASCII identity unchanged and emits only its original change", () => {
    const changed = vi.fn(); render(<ControlledField changed={changed} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "000AB001" } });
    expect(screen.getByTestId("controlled-value")).toHaveTextContent("000AB001");
    expect(changed).toHaveBeenCalledExactlyOnceWith("000AB001", expect.any(Array));
  });
  it("does not install duplicate capture handlers or locale wrappers", () => {
    const currentNumber = Number.prototype.toLocaleString;
    const added = vi.spyOn(document, "addEventListener");
    installEnglishDigitGuards(); installEnglishDigitGuards();
    expect(added).not.toHaveBeenCalled();
    expect(Number.prototype.toLocaleString).toBe(currentNumber);
    added.mockRestore();
    const changed = vi.fn(); render(<ControlledField changed={changed} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "٠٠١" } });
    expect(changed).toHaveBeenCalledExactlyOnceWith("001", expect.any(Array));
  });
});
