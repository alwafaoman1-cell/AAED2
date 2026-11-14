// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElectronicSignaturePad from "@/components/ElectronicSignaturePad";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("canonical customer signature format", () => {
  it("emits PNG from real pointer drawing when compact output is disabled", () => {
    const context = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 0, lineCap: "round", lineJoin: "round" };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((type) => type === "image/png" ? "data:image/png;base64,iVBORw0KGgo=" : "data:image/webp;base64,invalid-for-canonical-api");
    const onChange = vi.fn();
    render(<ElectronicSignaturePad onChange={onChange} compactOutput={false} title="Customer signature" />);
    const canvas = screen.getByLabelText("Customer signature");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 900, height: 220, left: 0, top: 0 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(context.stroke).toHaveBeenCalled();
    expect(encode).toHaveBeenCalledExactlyOnceWith("image/png");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^data:image\/png;base64,/));
  });
});
