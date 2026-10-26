// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehicleAnnotationCanvas from "@/components/inspection/VehicleAnnotationCanvas";

const images: FakeImage[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  naturalWidth = 800;
  naturalHeight = 500;
  src = "";
  constructor() { images.push(this); }
}

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => vi.unstubAllGlobals());

describe("vehicle annotation original image failure", () => {
  it("prevents confirming a blank drawing as if the source photo loaded", () => {
    const onSave = vi.fn();
    render(<VehicleAnnotationCanvas imageSrc="broken-photo.jpg" onSave={onSave} />);
    act(() => { images[0].onerror?.(); });

    expect(screen.getByRole("alert").textContent).toContain("تعذر تحميل الصورة الأصلية");
    expect((screen.getByRole("button", { name: "تطبيق التعليقات على مسودة التقرير" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
