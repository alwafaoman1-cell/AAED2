// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClaimDeliverySection from "@/components/insurance/ClaimDeliverySection";

const mocks = vi.hoisted(() => ({
  language: "en",
  navigate: vi.fn(),
  fetchOrder: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderFromCloudByIdentifier: mocks.fetchOrder }));
vi.mock("@/lib/vehicleMediaUrls", () => ({
  resolveVehicleMediaUrls: async (references: Array<{ storage_path: string }>) => references.map(({ storage_path }) => ({ url: storage_path })),
}));
vi.mock("@/components/ai/AiExtractButton", () => ({ default: ({ label }: { label: string }) => <span>{label}</span> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: mocks.update }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));

const initial = {
  receiver_name: "Original recipient",
  receiver_id_number: "12345678",
  delivery_notes: "Original notes",
  delivery_photos: ["https://example.test/delivery.jpg"],
  satisfaction_photos: ["https://example.test/satisfaction.pdf"],
  receiver_id_photo: "https://example.test/id.jpg",
};
const props = { claimId: "claim-1", workOrderId: "order-1", initial };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = "en";
  mocks.fetchOrder.mockResolvedValue({ id: "order-1", displayNumber: "WO-I-26/0057" });
  mocks.save.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.save });
});
afterEach(cleanup);

describe("claim delivery handover entry point", () => {
  it.each(["ar", "en"])("renders one handover action and explicit labels/direction in %s", async (language) => {
    mocks.language = language;
    const { container } = render(<ClaimDeliverySection {...props} />);
    const action = screen.getByRole("button", { name: language === "ar" ? "متابعة واعتماد الخروج والتسليم" : "Continue to vehicle handover" });
    expect(action).toHaveClass("min-h-11", "whitespace-normal");
    expect(action).toBeEnabled();
    expect(container.firstElementChild).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
    expect(screen.getByRole("button", { name: language === "ar" ? "حفظ المسودة" : "Save draft" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "نموذج خروج وتسليم المركبة" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تجهيز أوراق التسليم للتأمين" })).toBeNull();
    if (language === "en") expect(container.textContent).not.toMatch(/[\u0600-\u06ff]/);
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
  });

  it("passes the current local draft to the canonical handover route without saving or finalizing", async () => {
    const { rerender } = render(<ClaimDeliverySection {...props} />);
    fireEvent.change(screen.getByLabelText("Recipient name"), { target: { value: "Updated recipient" } });
    fireEvent.change(screen.getByLabelText("Recipient ID number"), { target: { value: "98765432" } });
    fireEvent.change(screen.getByLabelText("Delivery date"), { target: { value: "2026-11-15" } });
    fireEvent.change(screen.getByLabelText("Delivery notes"), { target: { value: "Updated notes" } });
    mocks.language = "ar";
    rerender(<ClaimDeliverySection {...props} />);
    expect(screen.getByLabelText("اسم المستلم")).toHaveValue("Updated recipient");
    fireEvent.click(screen.getByRole("button", { name: "متابعة واعتماد الخروج والتسليم" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/work-orders/WO-I-26%2F0057/delivery", {
      state: {
        returnTo: "/insurance/claim-1",
        deliveryDraft: {
          date: "2026-11-15", receiverType: "customer", receiverName: "Updated recipient", receiverIdNumber: "98765432",
          satisfactionNotes: "Updated notes", idPhotoDataUrl: initial.receiver_id_photo, deliveryPhotoUrls: initial.delivery_photos,
        },
      },
    }));
    expect(mocks.fetchOrder).toHaveBeenCalledWith("order-1");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the handover action disabled while saving, and saves draft fields without delivery status", async () => {
    let completeSave!: (result: { error: null }) => void;
    mocks.save.mockReturnValue(new Promise((resolve) => { completeSave = resolve; }));
    const onSaved = vi.fn();
    render(<ClaimDeliverySection {...props} onSaved={onSaved} />);
    const action = screen.getByRole("button", { name: "Continue to vehicle handover" });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(action).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    fireEvent.click(action);
    expect(mocks.fetchOrder).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      delivery_photos: initial.delivery_photos, satisfaction_photos: initial.satisfaction_photos, receiver_id_photo: initial.receiver_id_photo,
      receiver_name: initial.receiver_name, receiver_id_number: initial.receiver_id_number, delivery_notes: initial.delivery_notes,
    });
    expect(mocks.save).toHaveBeenCalledWith("id", "claim-1");
    await act(async () => { completeSave({ error: null }); });
    expect(action).toBeEnabled();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("blocks missing/deleted work orders and repeated launches while the order is loading", async () => {
    const { rerender } = render(<ClaimDeliverySection {...props} workOrderId={undefined} />);
    expect(screen.getByRole("button", { name: "Continue to vehicle handover" })).toBeDisabled();
    expect(screen.getByText("A linked work order is required to prepare the vehicle handover documents.")).toBeInTheDocument();
    let completeLoad!: (order: { id: string; deletedAt: string }) => void;
    mocks.fetchOrder.mockReturnValue(new Promise((resolve) => { completeLoad = resolve; }));
    rerender(<ClaimDeliverySection {...props} />);
    const action = screen.getByRole("button", { name: "Continue to vehicle handover" });
    fireEvent.click(action);
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(mocks.fetchOrder).toHaveBeenCalledOnce();
    await act(async () => { completeLoad({ id: "order-1", deletedAt: "2026-11-15T00:00:00Z" }); });
    expect(action).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("has been deleted"));
  });

  it("provides visible touch-sized named removal controls and retains the remaining media in the draft", async () => {
    render(<ClaimDeliverySection {...props} />);
    const removeDeliveryPhoto = screen.getAllByRole("button", { name: "Remove attachment 1" })[0];
    expect(removeDeliveryPhoto).toHaveClass("h-11", "w-11");
    expect(removeDeliveryPhoto.className).not.toMatch(/opacity-0|group-hover/);
    fireEvent.click(removeDeliveryPhoto);
    fireEvent.click(screen.getByRole("button", { name: "Remove recipient ID attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      delivery_photos: [], satisfaction_photos: initial.satisfaction_photos, receiver_id_photo: null,
    }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
