import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("work-order detail responsive layout", () => {
  const detail = read("src/pages/WorkOrderDetail.tsx");
  const neededParts = read("src/components/workorders/NeededPartsManager.tsx");

  it("shows one full number, one progress display, and grouped actions", () => {
    expect(detail.match(/data-testid="work-order-control-center"/g)).toHaveLength(1);
    expect(detail).toContain('className="shrink-0 whitespace-nowrap font-mono');
    expect(detail.match(/role="progressbar"/g)).toHaveLength(1);
    expect(detail).toContain('aria-controls="work-order-secondary-actions"');
    expect(detail).toContain('id="work-order-secondary-actions"');
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

  it("separates inspection photos from vehicle photos without another storage source", () => {
    expect(detail).toContain('photo.phase !== "inspection"');
    expect(detail).toContain('photo.phase === "inspection"');
    expect(detail).toContain('mergeWorkOrderMedia(unifiedMedia, [...resolvedLegacyPhotos, ...attachedPhotos])');
    expect(detail).toContain('"Open claim documents"');
  });

  it("shows the parts editor only after an explicit add action", () => {
    expect(neededParts).toContain('const [isAdding, setIsAdding] = useState(false)');
    expect(neededParts).toContain('aria-controls="needed-parts-editor"');
    expect(neededParts).toContain("{allowEdit && isAdding && (");
    expect(neededParts).toContain("await addNeededPartToOrder(order.id");
    expect(neededParts).toContain("await addNeededPartsBulkToOrder(order.id");
  });
});
