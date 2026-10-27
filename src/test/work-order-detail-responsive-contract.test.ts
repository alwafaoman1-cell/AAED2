import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("work-order detail responsive layout", () => {
  const detail = read("src/pages/WorkOrderDetail.tsx");
  const list = read("src/pages/WorkOrders.tsx");
  const neededParts = read("src/components/workorders/NeededPartsManager.tsx");
  const receptionForm = read("src/components/workorders/WorkOrderForm.tsx");
  const stagePhotos = read("src/components/workorders/StagePhotosDialog.tsx");
  const receptionSection = read("src/components/workorders/VehicleReceptionSection.tsx");
  const supplementsSection = read("src/components/workorders/SupplementsSection.tsx");

  it("shows one full number, one progress display, and grouped actions", () => {
    expect(detail.match(/data-testid="work-order-control-center"/g)).toHaveLength(1);
    expect(detail).toContain('className="shrink-0 whitespace-nowrap font-mono');
    expect(detail.match(/role="progressbar"/g)).toHaveLength(1);
    expect(detail).toContain('aria-controls="work-order-secondary-actions"');
    expect(detail).toContain('id="work-order-secondary-actions"');
    expect(detail).toContain('"hidden lg:flex"');
    expect(detail).toContain('sm:ms-auto lg:hidden');
    expect(detail).toContain('handleDownloadPhotosPdf');
  });

  it("keeps all operational dialogs and financial actions reachable", () => {
    for (const marker of [
      "<WorkOrderStatusDialog", "<StagePhotosDialog", "<WorkOrderBulkExpenseDialog",
      "<WhatsAppCenter", "<QrLabel", "<UnifiedAddPaymentDialog", "<PdfPreviewDialog",
      "<ConfirmDeleteDialog", "<CustomerPortalLink", "<SmartCustomerSendBar",
    ]) expect(detail).toContain(marker);
    expect(detail).toContain("navigate(`/sales/invoices/new?fromWorkOrder=${order.id}`)");
    expect(detail).toContain("handlePrintWorkOrder");
  });

  it("exposes frequent list actions on desktop and keeps the full menu on smaller screens", () => {
    expect(list).toContain('bg-muted/25 p-1 lg:flex');
    expect(list).toContain('onClick={() => setEditOrder(order)}');
    expect(list).toContain('onClick={() => setPhotosOrderId(order.id)}');
    expect(list).toContain('cursor-pointer lg:hidden');
    expect(list).toContain('<DropdownMenuContent align="end"');
  });

  it("separates inspection photos from vehicle photos without another storage source", () => {
    expect(detail).toContain('photo.phase !== "inspection"');
    expect(detail).toContain('photo.phase === "inspection"');
    expect(detail).toContain('mergeWorkOrderMedia(unifiedMedia, [...resolvedLegacyPhotos, ...attachedPhotos])');
    expect(detail).toContain('"Open claim documents"');
  });

  it("routes reception and stage uploads through one bounded photo pipeline", () => {
    expect(receptionForm).toContain("uploadStagePhoto({ orderId: orderNumber, photoId, file })");
    expect(receptionForm).not.toContain('.from("work-order-photos")');
    expect(stagePhotos).toContain("for (const file of allowed)");
    expect(stagePhotos).toContain("disabled={!dirty || uploading}");
    expect(receptionSection).toContain("optimizeWorkOrderPhoto(file)");
    expect(receptionSection).toContain("disabled={saving || uploadingPhoto}");
    expect(supplementsSection).toContain("optimizeWorkOrderPhoto(file)");
    expect(supplementsSection).toContain("disabled={uploadingPhoto}>حفظ");
  });

  it("shows the parts editor only after an explicit add action", () => {
    expect(neededParts).toContain('const [isAdding, setIsAdding] = useState(false)');
    expect(neededParts).toContain('aria-controls="needed-parts-editor"');
    expect(neededParts).toContain("{allowEdit && isAdding && (");
    expect(neededParts).toContain("await addNeededPartToOrder(order.id");
    expect(neededParts).toContain("await addNeededPartsBulkToOrder(order.id");
  });
});
