// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionRecord } from "@/lib/inspectionsStore";
import InspectionReportPage from "@/pages/InspectionReportPage";
import { PDF_HTML_SANDBOX, sanitizePdfHtml } from "@/lib/safeHtml";

const mocks = vi.hoisted(() => ({
  id: "DR-00007", loadById: vi.fn(), getById: vi.fn(), getAll: vi.fn(), subscribe: vi.fn(),
  loadInsurance: vi.fn(), getInsurance: vi.fn(), subscribeInsurance: vi.fn(),
  generalHtml: vi.fn(), insuranceHtml: vi.fn(), generatePdf: vi.fn(), printPdf: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: mocks.id }), useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/lib/inspectionsStore", () => ({ inspectionsStore: {
  loadById: mocks.loadById, getById: mocks.getById, getAll: mocks.getAll, subscribe: mocks.subscribe,
} }));
vi.mock("@/lib/insuranceInspectionStore", () => ({ insuranceInspectionStore: {
  load: mocks.loadInsurance, get: mocks.getInsurance, subscribe: mocks.subscribeInsurance,
} }));
vi.mock("@/lib/pdfGenerator", () => ({ getInspectionHtml: mocks.generalHtml }));
vi.mock("@/lib/insuranceInspectionPdf", () => ({ buildInsuranceInspectionHtml: mocks.insuranceHtml, generateInsuranceInspectionPdfBlob: vi.fn() }));
vi.mock("@/lib/htmlToPdf", () => ({ generatePdfFromHtml: mocks.generatePdf, DEFAULT_MARGINS: {} }));
vi.mock("@/lib/safePdfWindow", () => ({ printPdfBlob: mocks.printPdf }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));

const record: InspectionRecord = { id: "DR-00007", workOrder: "WO-7", customer: "Customer", vehicle: "Toyota", date: "2026-11-06", damageType: "Body", photos: 2, status: "pending", kind: "general", details: { notes: "Preserve" } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.id = record.id;
  mocks.subscribe.mockReturnValue(() => undefined);
  mocks.subscribeInsurance.mockReturnValue(() => undefined);
  mocks.generalHtml.mockReturnValue("<html><body>Report</body></html>");
  mocks.insuranceHtml.mockReturnValue("<html><body>Insurance report</body></html>");
});
afterEach(cleanup);

describe("explicit inspection report loading", () => {
  it("shows loading on a direct link, then renders one full record without fetching the list", async () => {
    const pending = deferred<InspectionRecord>();
    mocks.loadById.mockReturnValue(pending.promise);
    render(<InspectionReportPage />);
    expect(screen.getByRole("status").textContent).toContain("Loading inspection report");
    expect(screen.queryByText(/لم يتم العثور/)).toBeNull();
    expect(mocks.loadById).toHaveBeenCalledWith(record.id);
    expect(mocks.subscribe).toHaveBeenCalledWith(expect.any(Function), { loadSummaries: false });
    await act(async () => { pending.resolve(record); });
    expect(screen.getByTitle(`Inspection ${record.id}`)).toBeTruthy();
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.loadInsurance).not.toHaveBeenCalled();
  });

  it("shows failed reads as errors with retry, not missing reports or a false refresh-success toast", async () => {
    mocks.loadById.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(record);
    render(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));
    expect(screen.queryByText("Inspection report not found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTitle(`Inspection ${record.id}`)).toBeTruthy());
    expect(mocks.loadById).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("only shows not-found after a successful empty detail lookup", async () => {
    mocks.loadById.mockResolvedValue(undefined);
    render(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Inspection report not found"));
    expect(screen.queryByTitle(`Inspection ${record.id}`)).toBeNull();
    expect(mocks.generalHtml).not.toHaveBeenCalled();
  });

  it("waits for legacy insurance payload hydration and does not print a minimal fallback after a failed detail read", async () => {
    mocks.loadById.mockResolvedValue({ ...record, kind: "insurance", details: {} });
    mocks.loadInsurance.mockRejectedValue(new Error("archive offline"));
    render(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("archive offline"));
    expect(mocks.insuranceHtml).not.toHaveBeenCalled();
    expect(mocks.generatePdf).not.toHaveBeenCalled();
    expect(screen.queryByTitle(`Inspection ${record.id}`)).toBeNull();
  });

  it("uses embedded insurance details without an additional details/archive request", async () => {
    const report = { reportNo: record.id, annotatedImages: [{ dataUrl: "photo" }], sections: [] };
    mocks.loadById.mockResolvedValue({ ...record, kind: "insurance", details: { insuranceInspectionReport: report } });
    mocks.getInsurance.mockReturnValue(report);
    render(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByTitle(`Inspection ${record.id}`)).toBeTruthy());
    expect(mocks.insuranceHtml).toHaveBeenCalledWith(report);
    expect(mocks.loadInsurance).not.toHaveBeenCalled();
  });

  it("refreshes the selected record from the server, not just the render tick", async () => {
    mocks.loadById.mockResolvedValueOnce(record).mockRejectedValueOnce(new Error("refresh offline"));
    render(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByTitle(`Inspection ${record.id}`)).toBeTruthy());
    fireEvent.click(screen.getByTitle("تحديث من آخر بيانات محفوظة"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("refresh offline"));
    expect(mocks.loadById).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByTitle(`Inspection ${record.id}`)).toBeNull();
  });

  it("does not show a previous route's late detail response after changing reports", async () => {
    const pending = deferred<InspectionRecord>();
    mocks.loadById.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...record, id: "DR-00008" });
    const view = render(<InspectionReportPage />);
    mocks.id = "DR-00008";
    view.rerender(<InspectionReportPage />);
    await waitFor(() => expect(screen.getByTitle("Inspection DR-00008")).toBeTruthy());
    await act(async () => { pending.resolve(record); });
    expect(screen.getByTitle("Inspection DR-00008")).toBeTruthy();
    expect(screen.queryByTitle(`Inspection ${record.id}`)).toBeNull();
    expect(mocks.getAll).not.toHaveBeenCalled();
  });
});

const unsafeReportHtml = `<!doctype html><html lang="ar" dir="rtl"><head>
  <style>.inspection-page{padding:12mm;color:#123456}</style>
  <meta http-equiv="refresh" content="0;url=https://attacker.test/">
  </head><body onload="alert(1)"><main class="inspection-page">
  <h1>Vehicle inspection / تقرير الفحص</h1><table id="report-items"><tbody><tr><td>Repair body panel</td></tr></tbody></table>
  <img id="report-photo" src="data:image/png;base64,aW1hZ2U=">
  <img id="bad-photo" src="javascript:alert(1)" onerror="alert(1)">
  <a id="bad-link" href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>
  <iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><script>alert(1)</script>
  </main></body></html>`;

describe("InspectionReportPage central sanitized HTML boundary", () => {
  it.each(["general", "insurance"] as const)("sanitizes the %s preview with the real central helper and script-free sandbox", async (kind) => {
    const insuranceReport = { reportNo: record.id, annotatedImages: ["data:image/png;base64,aW1hZ2U="], sections: [] };
    mocks.loadById.mockResolvedValue({ ...record, kind, details: kind === "insurance" ? { insuranceInspectionReport: insuranceReport } : record.details });
    mocks.getInsurance.mockReturnValue(kind === "insurance" ? insuranceReport : undefined);
    mocks.generalHtml.mockReturnValue(unsafeReportHtml);
    mocks.insuranceHtml.mockReturnValue(unsafeReportHtml);
    render(<InspectionReportPage />);
    const frame = await screen.findByTitle(`Inspection ${record.id}`);
    const renderedHtml = frame.getAttribute("srcdoc") || "";
    expect(frame.getAttribute("sandbox")).toBe(PDF_HTML_SANDBOX);
    expect(frame.getAttribute("sandbox")?.split(/\s+/)).not.toContain("allow-scripts");
    expect(renderedHtml).toBe(sanitizePdfHtml(unsafeReportHtml));
    const doc = new DOMParser().parseFromString(renderedHtml, "text/html");
    expect(doc.querySelector("script,iframe,object,embed,base,form,[onload],[onerror],[onclick],[srcdoc]")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("script-src 'none'");
    expect(doc.querySelector("#bad-photo")?.hasAttribute("src")).toBe(false);
    expect(doc.querySelector("#bad-link")?.hasAttribute("href")).toBe(false);
    // Safety must not discard printable structure, RTL, image references or CSS.
    expect(doc.documentElement.getAttribute("dir")).toBe("rtl");
    expect(doc.querySelector("style")?.textContent).toContain("padding:12mm");
    expect(doc.querySelector("#report-items")?.textContent).toContain("Repair body panel");
    expect(doc.querySelector("#report-photo")?.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
    expect(mocks.loadById).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).not.toHaveBeenCalled();
  });

  it("passes exactly the sanitized preview HTML to general-report print and download", async () => {
    const pdf = new Blob(["%PDF-sanitized-report"], { type: "application/pdf" });
    mocks.loadById.mockResolvedValue(record);
    mocks.generalHtml.mockReturnValue(unsafeReportHtml);
    mocks.generatePdf.mockResolvedValue(pdf);
    mocks.printPdf.mockResolvedValue(undefined);
    render(<InspectionReportPage />);
    const frame = await screen.findByTitle(`Inspection ${record.id}`);
    const safePreview = frame.getAttribute("srcdoc");
    expect(safePreview).toBe(sanitizePdfHtml(unsafeReportHtml));
    const printButton = screen.getByRole("button", { name: /طباعة|Print/i });
    fireEvent.click(printButton);
    await waitFor(() => expect(mocks.printPdf).toHaveBeenCalledWith(pdf));
    expect(mocks.generatePdf).toHaveBeenNthCalledWith(1, expect.objectContaining({ htmlContent: safePreview, download: false, fileName: `Inspection_${record.id}` }));
    await waitFor(() => expect(printButton).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /تنزيل PDF|Download/i }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.generatePdf).toHaveBeenNthCalledWith(2, expect.objectContaining({ htmlContent: safePreview, download: true, fileName: `Inspection_${record.id}` }));
    expect(mocks.printPdf).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).not.toHaveBeenCalled();
  });
});
