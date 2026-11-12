// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkOrder } from "@/lib/workOrdersStore";
vi.mock("@/lib/pdfGenerator", () => ({ getTrackingUrl: (token: string) => token ? `https://example.test/p/${token}` : "" }));
vi.mock("@/lib/safePdfWindow", () => ({ openAndPrintWindow: vi.fn() }));
vi.mock("@/lib/customerPortalTokens", () => ({ ensureCustomerPortalToken: vi.fn(async () => ({ token: "existing-token" })) }));
import QrLabel from "@/components/workorders/QrLabel";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("opens the existing QR action with an accessible title, retained print controls and working close", async () => {
  const errors = vi.spyOn(console, "error"); const onClose = vi.fn();
  const order = { id: "WO-C-26-0001", cloudId: "11111111-1111-4111-8111-111111111111", workOrderType: "general_customer", plate: "QA 123", vehicleType: "Synthetic", model: "Audit", year: "2026", phone: "99990000", trackingToken: "existing-token" } as WorkOrder;
  render(<QrLabel order={order} open onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "ملصق QR / QR Label" });
  await waitFor(() => expect(dialog.querySelector("svg#qr-svg-WO-C-26-0001")).not.toBeNull());
  expect(screen.getByText(order.plate)).toBeDefined();
  expect(screen.getByRole("button", { name: "طباعة الملصق / Print Label" })).toBeDefined();
  expect(errors).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "إغلاق" })); expect(onClose).toHaveBeenCalledOnce();
});
