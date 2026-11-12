// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
const api = vi.hoisted(() => ({ permissions: vi.fn(), context: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/vehicleIntakeReceipt", () => ({ getIntakeReceiptPermissions: api.permissions, getIntakeReceiptContext: api.context, verifyIntakeReceipt: api.verify }));
const scanner = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), clear: vi.fn(), file: vi.fn(), decoded: null as null | ((value: string) => void) }));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: class {
  isScanning = false;
  start(...args: unknown[]) { scanner.decoded = args[2] as (value: string) => void; return scanner.start(...args).then(() => { this.isScanning = true; }); }
  stop() { this.isScanning = false; return scanner.stop(); }
  clear() { scanner.clear(); }
  scanFile(file: File, show: boolean) { return scanner.file(file, show); }
} }));
import VehicleIntakeReceiptCheck from "@/components/vehicle-entry/VehicleIntakeReceiptCheck";
function show() {
  const changed = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><VehicleIntakeReceiptCheck entryId="visit" onChange={changed} /></QueryClientProvider>);
  return changed;
}
beforeEach(async () => { vi.clearAllMocks(); scanner.start.mockReset().mockResolvedValue(undefined); scanner.stop.mockResolvedValue(undefined); scanner.file.mockReset(); scanner.decoded = null; await i18n.changeLanguage("en"); api.permissions.mockResolvedValue({ Verify: true, Deliver: true, "Legacy exception": true }); api.context.mockResolvedValue({ required: true, receipts: [] }); });
describe("receipt verification and legacy exception controls", () => {
  it("does not offer an exception for a new visit even with special permission", async () => {
    show(); await waitFor(() => expect(screen.getByRole("button", { name: "Verify receipt" })).toBeDisabled());
    expect(screen.queryByRole("textbox", { name: /Legacy visit exception/ })).toBeNull();
  });
  it("records a reason only for an old visit with the separate permission", async () => {
    api.context.mockResolvedValue({ required: false, receipts: [] }); const changed = show();
    fireEvent.change(await screen.findByRole("textbox", { name: /Legacy visit exception/ }), { target: { value: "Original intake predates receipt activation" } });
    expect(changed).toHaveBeenLastCalledWith(null, "Original intake predates receipt activation");
  });
  it("hides the legacy exception without its special permission", async () => {
    api.context.mockResolvedValue({ required: false, receipts: [] }); api.permissions.mockResolvedValue({ Verify: true, Deliver: true }); show();
    await waitFor(() => expect(api.context).toHaveBeenCalled());
    expect(screen.queryByRole("textbox", { name: /Legacy visit exception/ })).toBeNull();
  });
  it("shows the verified holder and clears authorization when the reference changes", async () => {
    api.verify.mockResolvedValue({ id: "receipt-id", receipt_number: "VIR-1", entry_number: "ENT-1", signer_name: "Actual holder", vehicle: { make: "TEST", plate_number: "123" } });
    const changed = show(); const input = screen.getByRole("textbox", { name: "Receipt number or QR link" });
    fireEvent.change(input, { target: { value: "VIR-1" } });
    const verify = screen.getByRole("button", { name: "Verify receipt" }); await waitFor(() => expect(verify).toBeEnabled()); fireEvent.click(verify);
    await screen.findByText("ENT-1 · Actual holder"); expect(changed).toHaveBeenLastCalledWith("receipt-id", "");
    fireEvent.change(input, { target: { value: "OTHER" } }); expect(changed).toHaveBeenLastCalledWith(null, "");
    expect(screen.queryByText("ENT-1 · Actual holder")).toBeNull();
  });
  it("stops the camera after decoding and requires server verification", async () => {
    const changed = show(); fireEvent.click(screen.getByRole("button", { name: "Scan QR" }));
    await waitFor(() => expect(scanner.start).toHaveBeenCalled());
    await act(async () => { scanner.decoded?.("https://test/vehicle-entry/receipt/verify?entry=visit&reference=token"); });
    expect(screen.getByRole("textbox", { name: "Receipt number or QR link" })).toHaveValue("https://test/vehicle-entry/receipt/verify?entry=visit&reference=token");
    expect(changed).toHaveBeenLastCalledWith(null, ""); expect(api.verify).not.toHaveBeenCalled();
    await waitFor(() => expect(scanner.stop).toHaveBeenCalled()); expect(scanner.clear).toHaveBeenCalled();
  });
  it("handles a denied or absent camera while keeping manual verification available", async () => {
    scanner.start.mockRejectedValue(new Error("NotAllowedError")); show(); fireEvent.click(screen.getByRole("button", { name: "Scan QR" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Camera unavailable");
    expect(screen.getByRole("textbox", { name: "Receipt number or QR link" })).toBeEnabled();
  });
  it("decodes a QR image without accepting it as delivery authorization", async () => {
    scanner.file.mockResolvedValue("VIR-IMAGE"); const changed = show();
    fireEvent.change(screen.getByLabelText("QR code image"), { target: { files: [new File(["test"], "qr.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Receipt number or QR link" })).toHaveValue("VIR-IMAGE"));
    expect(changed).toHaveBeenLastCalledWith(null, ""); expect(api.verify).not.toHaveBeenCalled(); expect(scanner.clear).toHaveBeenCalled();
  });
  it("does not accept an old verification response after the reference is edited", async () => {
    let resolve!: (value: unknown) => void; api.verify.mockReturnValue(new Promise(done => { resolve = done; })); const changed = show();
    const input = screen.getByRole("textbox", { name: "Receipt number or QR link" }); fireEvent.change(input, { target: { value: "VIR-OLD" } });
    const button = screen.getByRole("button", { name: "Verify receipt" }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    fireEvent.change(input, { target: { value: "VIR-NEW" } });
    await act(async () => resolve({ id: "old", receipt_number: "VIR-OLD", entry_number: "old", signer_name: "old", vehicle: {} }));
    expect(changed).toHaveBeenLastCalledWith(null, ""); expect(screen.queryByRole("status")).toBeNull();
  });

});
