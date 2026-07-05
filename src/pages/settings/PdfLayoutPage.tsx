import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, FileCheck2, FileText, Image as ImageIcon, RotateCcw, Save, Stamp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { smartBack } from "@/lib/smartBack";
import {
  buildPageMarginCss,
  buildPdfLayoutRuntimeCss,
  DEFAULT_PDF_LAYOUT,
  pdfLayoutStore,
  type PdfCompactStrength,
  type PdfLayoutSettings,
  type PdfLogoPosition,
  type PdfPageSize,
  type PdfQrPosition,
  type PdfSignatureLayout,
  type PdfTextAlign,
  type PdfVehicleDisplayMode,
} from "@/lib/pdfLayoutSettings";
import { buildPdfV2Html } from "@/lib/pdf-v2/pdfEngine";
import { getTemplateSettings, saveTemplateSettings, subscribeTemplateSettings, type PdfTemplateSettings } from "@/lib/pdfGenerator";

type NumberKey = {
  [K in keyof PdfLayoutSettings]: PdfLayoutSettings[K] extends number ? K : never;
}[keyof PdfLayoutSettings];

type BooleanKey = {
  [K in keyof PdfLayoutSettings]: PdfLayoutSettings[K] extends boolean ? K : never;
}[keyof PdfLayoutSettings];

function bounded(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export default function PdfLayoutPage() {
  const navigate = useNavigate();
  const [s, setS] = useState<PdfLayoutSettings>({ ...DEFAULT_PDF_LAYOUT, ...pdfLayoutStore.get() });
  const [templateSettings, setTemplateSettings] = useState<PdfTemplateSettings>(getTemplateSettings());
  const stampInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => pdfLayoutStore.subscribe(() => setS({ ...DEFAULT_PDF_LAYOUT, ...pdfLayoutStore.get() })), []);
  useEffect(() => subscribeTemplateSettings(() => setTemplateSettings(getTemplateSettings())), []);

  const patch = (next: Partial<PdfLayoutSettings>) => setS((prev) => ({ ...prev, ...next }));

  const save = () => {
    pdfLayoutStore.update(s);
    toast.success("تم حفظ إعدادات PDF في Supabase tenant settings");
  };

  const reset = () => {
    pdfLayoutStore.reset();
    setS({ ...DEFAULT_PDF_LAYOUT });
    toast.success("تمت استعادة إعدادات PDF الافتراضية");
  };

  const applyPreset = (preset: "classic" | "compact" | "formal") => {
    if (preset === "compact") {
      patch({
        ...DEFAULT_PDF_LAYOUT,
        compactMode: true,
        compactStrength: "high",
        marginTopMm: 9,
        marginRightMm: 10,
        marginBottomMm: 12,
        marginLeftMm: 10,
        logoWidthMm: 20,
        logoHeightMm: 22,
        companyNameFontSize: 17,
        companyEnglishNameFontSize: 11,
        companyMetaFontSize: 9,
        bodyFontSize: 9.2,
        tableBodyFontSize: 9,
        spaceBetweenSectionsMm: 2,
        spaceBeforeSignatureMm: 3,
        vehicleBoxHeightMm: 20,
        signatureBoxHeightMm: 15,
        stampBoxHeightMm: 15,
      });
      return;
    }
    if (preset === "formal") {
      patch({
        ...DEFAULT_PDF_LAYOUT,
        marginTopMm: 16,
        marginRightMm: 16,
        marginBottomMm: 18,
        marginLeftMm: 16,
        companyNameFontSize: 21,
        bodyFontSize: 11,
        sectionTitleFontSize: 12,
        cardPaddingMm: 3.5,
        spaceBetweenSectionsMm: 4,
        footerReservedHeightMm: 14,
      });
      return;
    }
    patch({ ...DEFAULT_PDF_LAYOUT });
  };

  const uploadStamp = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يجب أن يكون ملف الختم صورة");
      return;
    }
    try {
      const { uploadCompanyStampToStorage } = await import("@/lib/pdfStampStorage");
      const stampUrl = await uploadCompanyStampToStorage(file);
      const next = { ...templateSettings, stampUrl, stampEnabled: true };
      setTemplateSettings(next);
      await saveTemplateSettings(next);
      toast.success("تم رفع ختم الشركة وحفظه في Supabase");
    } catch (error: any) {
      toast.error(error?.message || "تعذر رفع ختم الشركة");
    } finally {
      if (stampInputRef.current) stampInputRef.current.value = "";
    }
  };

  const uploadSignature = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يجب أن يكون ملف التوقيع صورة");
      return;
    }
    try {
      const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
      const signatureUrl = await fileToWebpDataUrl(file, { maxDimension: 800, quality: 0.9 });
      const next = { ...templateSettings, signatureUrl, stampEnabled: true };
      setTemplateSettings(next);
      await saveTemplateSettings(next);
      toast.success("تم حفظ التوقيع");
    } catch (error: any) {
      toast.error(error?.message || "تعذر رفع التوقيع");
    } finally {
      if (signatureInputRef.current) signatureInputRef.current.value = "";
    }
  };

  const removeStamp = async () => {
    const previousStampUrl = templateSettings.stampUrl;
    const next = { ...templateSettings, stampUrl: undefined };
    setTemplateSettings(next);
    try {
      await saveTemplateSettings(next);
      const { removeCompanyStampFromStorage } = await import("@/lib/pdfStampStorage");
      await removeCompanyStampFromStorage(previousStampUrl);
      toast.success("تم حذف ختم الشركة من إعدادات PDF");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حذف ختم الشركة");
    } finally {
      if (stampInputRef.current) stampInputRef.current.value = "";
    }
  };

  const removeSignature = async () => {
    const next = { ...templateSettings, signatureUrl: undefined };
    setTemplateSettings(next);
    await saveTemplateSettings(next);
    if (signatureInputRef.current) signatureInputRef.current.value = "";
    toast.success("تم حذف التوقيع");
  };

  const warning = s.showSignatureSection && (s.signatureBoxHeightMm > 34 || s.stampBoxHeightMm > 34) && !s.compactMode;

  const previewHtml = useMemo(() => {
    const vehicleBox = s.showVehicleBox
      ? `<section class="pdf-v2-vehicle-strip">
          <div><b>Vehicle</b>Kia Sportage - 2021</div>
          <div><b>VIN</b>KNAPM81BAJ7123456</div>
          <div><b>Color</b>White</div>
          <div class="plate-box"><div class="plate-no">5651</div><div class="plate-label">PLATE</div></div>
        </section>`
      : "";
    const html = `
      <div class="pdf-v2-title-band"><strong>Tax Invoice Preview</strong><span>INV-PREVIEW</span></div>
      ${vehicleBox}
      <section class="pdf-v2-card">
        <h3>Insurance / Claim Details</h3>
        <p>Al Madina Takaful — Claim C/004/01/26/2503/00155</p>
      </section>
      <table>
        <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
        <tbody><tr><td>1</td><td>Vehicle repair claim</td><td>1</td><td>1,200.000</td><td>1,200.000</td></tr></tbody>
      </table>
      <section class="summary-box">
        <div class="pdf-v2-totals">Subtotal 1,200.000<br/>VAT 60.000<br/><strong>Total 1,260.000 OMR</strong></div>
        <div class="qr-box"><div class="qr-frame">QR</div><div class="qr-caption">Short Link QR</div></div>
      </section>
      <section class="pdf-signature-stamp">
        <div class="pdf-signature-box"><div class="pdf-signature-title">Signature</div><div class="pdf-signature-line"></div></div>
        <div><div class="pdf-stamp-title">Company Stamp / ختم الشركة</div><div class="pdf-stamp-box">${templateSettings.stampUrl ? `<img src="${templateSettings.stampUrl}" alt="Company Stamp" />` : ""}</div></div>
      </section>`;
    return buildPdfV2Html({
      meta: {
        documentType: "generic",
        title: "PDF Layout Preview",
        documentNumber: "PREVIEW",
        documentDate: new Date().toISOString().slice(0, 10),
        companyName: templateSettings.companyNameEn || "Al Wafa Integrated Business Company LLC",
        companyDetails: ["CR 1537908", "VAT OM1100499048", "Muscat, Sultanate of Oman"],
        language: "en",
        layout: s.pageSize === "a4-landscape" ? "a4-landscape" : "a4-portrait",
      },
      html,
    }).replace("</style>", `${buildPdfLayoutRuntimeCss(s)}</style>`);
  }, [s, templateSettings.stampUrl, templateSettings.companyNameEn]);

  const openPreview = () => {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      toast.error("تعذر فتح نافذة PDF");
      return;
    }
    win.document.open();
    win.document.write(previewHtml);
    win.document.close();
  };

  const testPrint = () => {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    win.document.open();
    win.document.write(previewHtml);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
              <FileText className="text-primary" />
              PDF Layout Control
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              إعدادات tenant محفوظة في Supabase وتؤثر مباشرة على pdf-v2 والـ Preview/Print.
            </p>
          </div>
        </div>

        {warning && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            قد يخرج التوقيع خارج الصفحة، قلل الحجم أو فعّل compact mode.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <PresetCard title="Classic Old Style" body="Blue/gold, compact vehicle box, logo right of text." onClick={() => applyPreset("classic")} />
          <PresetCard title="Compact One Page" body="Smaller spacing and fonts for one-page invoices." onClick={() => applyPreset("compact")} />
          <PresetCard title="Formal A4" body="Larger margins for reports and formal documents." onClick={() => applyPreset("formal")} />
        </div>

        <Section title="Page / Margins" description="A4 size, margins, header/footer reserved space, and compact mode.">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectControl label="Page size" value={s.pageSize} onValueChange={(value) => patch({ pageSize: value as PdfPageSize })} options={[["a4-portrait", "A4 Portrait"], ["a4-landscape", "A4 Landscape"]]} />
            <SwitchControl label="Force settings on PDFs" checked={s.enforce} onCheckedChange={(enforce) => patch({ enforce })} />
            <SwitchControl label="One-page compact mode" checked={s.compactMode} onCheckedChange={(compactMode) => patch({ compactMode })} />
            <SelectControl label="Compact strength" value={s.compactStrength} onValueChange={(value) => patch({ compactStrength: value as PdfCompactStrength })} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
            <NumberControl label="Margin top mm" value={s.marginTopMm} min={0} max={40} onChange={(value) => patch({ marginTopMm: value, verticalMm: value })} />
            <NumberControl label="Margin right mm" value={s.marginRightMm} min={0} max={40} onChange={(value) => patch({ marginRightMm: value, horizontalMm: value })} />
            <NumberControl label="Margin bottom mm" value={s.marginBottomMm} min={0} max={45} onChange={(value) => patch({ marginBottomMm: value })} />
            <NumberControl label="Margin left mm" value={s.marginLeftMm} min={0} max={40} onChange={(value) => patch({ marginLeftMm: value })} />
            <NumberControl label="Header reserved mm" value={s.headerReservedHeightMm} min={0} max={60} onChange={(value) => patch({ headerReservedHeightMm: value })} />
            <NumberControl label="Footer reserved mm" value={s.footerReservedHeightMm} min={0} max={45} onChange={(value) => patch({ footerReservedHeightMm: value })} />
          </div>
        </Section>

        <Section title="Logo / Company Block" description="Logo position, dimensions, company text visibility and typography.">
          <div className="grid gap-4 md:grid-cols-3">
            <SwitchControl label="Show logo" checked={s.showLogo} onCheckedChange={(showLogo) => patch({ showLogo })} />
            <SelectControl label="Logo position" value={s.logoPosition} onValueChange={(value) => patch({ logoPosition: value as PdfLogoPosition })} options={[["right-of-company", "Right of company text"], ["left-of-company", "Left of company text"], ["above-company", "Above company text"]]} />
            <SelectControl label="Company alignment" value={s.companyBlockAlignment} onValueChange={(value) => patch({ companyBlockAlignment: value as PdfTextAlign })} options={[["start", "Start"], ["center", "Center"], ["end", "End"]]} />
            <NumberControl label="Logo width mm" value={s.logoWidthMm} min={6} max={60} onChange={(value) => patch({ logoWidthMm: value })} />
            <NumberControl label="Logo height mm" value={s.logoHeightMm} min={6} max={60} onChange={(value) => patch({ logoHeightMm: value })} />
            <NumberControl label="Logo top offset mm" value={s.logoTopOffsetMm} min={-20} max={30} onChange={(value) => patch({ logoTopOffsetMm: value })} />
            <NumberControl label="Logo inline offset mm" value={s.logoInlineOffsetMm} min={-30} max={30} onChange={(value) => patch({ logoInlineOffsetMm: value })} />
            <NumberControl label="Logo/text gap mm" value={s.logoCompanyGapMm} min={0} max={20} onChange={(value) => patch({ logoCompanyGapMm: value })} />
            <NumberControl label="Company top offset mm" value={s.companyBlockTopOffsetMm} min={-10} max={20} onChange={(value) => patch({ companyBlockTopOffsetMm: value })} />
            <NumberControl label="Company name font" value={s.companyNameFontSize} min={10} max={28} onChange={(value) => patch({ companyNameFontSize: value })} />
            <NumberControl label="English name font" value={s.companyEnglishNameFontSize} min={8} max={22} onChange={(value) => patch({ companyEnglishNameFontSize: value })} />
            <NumberControl label="CR/VAT/contact font" value={s.companyMetaFontSize} min={7} max={16} onChange={(value) => patch({ companyMetaFontSize: value })} />
            <NumberControl label="Company line spacing" value={s.companyLineSpacing} min={1} max={2.2} step={0.05} onChange={(value) => patch({ companyLineSpacing: value })} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            {([
              ["showCr", "Show CR"],
              ["showVat", "Show VAT"],
              ["showEmail", "Show email"],
              ["showPhone", "Show phone"],
              ["showAddress", "Show address"],
            ] as Array<[BooleanKey, string]>).map(([key, label]) => (
              <SwitchControl key={key} label={label} checked={Boolean(s[key])} onCheckedChange={(value) => patch({ [key]: value } as Partial<PdfLayoutSettings>)} />
            ))}
          </div>
        </Section>

        <Section title="Fonts" description="Document title, section title, body, table, footer and QR label font sizes.">
          <div className="grid gap-4 md:grid-cols-4">
            <NumberControl label="Document title" value={s.documentTitleFontSize} min={8} max={24} onChange={(value) => patch({ documentTitleFontSize: value })} />
            <NumberControl label="Section title" value={s.sectionTitleFontSize} min={8} max={20} onChange={(value) => patch({ sectionTitleFontSize: value })} />
            <NumberControl label="Body font" value={s.bodyFontSize} min={7} max={16} step={0.1} onChange={(value) => patch({ bodyFontSize: value })} />
            <NumberControl label="Table header" value={s.tableHeaderFontSize} min={7} max={15} step={0.1} onChange={(value) => patch({ tableHeaderFontSize: value })} />
            <NumberControl label="Table body" value={s.tableBodyFontSize} min={7} max={15} step={0.1} onChange={(value) => patch({ tableBodyFontSize: value })} />
            <NumberControl label="Footer font" value={s.footerFontSize} min={6} max={13} step={0.1} onChange={(value) => patch({ footerFontSize: value })} />
            <NumberControl label="QR label font" value={s.qrLabelFontSize} min={6} max={16} step={0.1} onChange={(value) => patch({ qrLabelFontSize: value })} />
          </div>
        </Section>

        <Section title="Spacing" description="Controls that prevent footer/signature overflow.">
          <div className="grid gap-4 md:grid-cols-4">
            {([
              ["headerHeightMm", "Header height mm", 0, 60],
              ["spaceAfterHeaderMm", "Space after header", 0, 20],
              ["spaceBetweenSectionsMm", "Between sections", 0, 18],
              ["spaceBeforeTotalsMm", "Before totals", 0, 20],
              ["spaceBeforeSignatureMm", "Before signature", 0, 30],
              ["spaceBeforeFooterMm", "Before footer", 0, 24],
              ["tableRowHeightMm", "Table row height", 3, 24],
              ["cardPaddingMm", "Card padding", 0.5, 10],
              ["vehicleBoxPaddingMm", "Vehicle padding", 0.5, 10],
              ["totalsBoxPaddingMm", "Totals padding", 1, 12],
            ] as Array<[NumberKey, string, number, number]>).map(([key, label, min, max]) => (
              <NumberControl key={key} label={label} value={Number(s[key])} min={min} max={max} step={0.5} onChange={(value) => patch({ [key]: value } as Partial<PdfLayoutSettings>)} />
            ))}
          </div>
        </Section>

        <Section title="Vehicle Box" description="Controls vehicle strip, plate box and VIN/vehicle font sizes.">
          <div className="grid gap-4 md:grid-cols-3">
            <SwitchControl label="Show vehicle box" checked={s.showVehicleBox} onCheckedChange={(showVehicleBox) => patch({ showVehicleBox })} />
            <SwitchControl label="Show color field" checked={s.showColorField} onCheckedChange={(showColorField) => patch({ showColorField })} />
            <SelectControl label="Make/model display" value={s.vehicleDisplayMode} onValueChange={(value) => patch({ vehicleDisplayMode: value as PdfVehicleDisplayMode })} options={[["make-only-if-model-empty", "Make only if model empty"], ["make-model-year", "Make + model + year"]]} />
            <NumberControl label="Vehicle box height" value={s.vehicleBoxHeightMm} min={6} max={60} onChange={(value) => patch({ vehicleBoxHeightMm: value })} />
            <NumberControl label="Plate box width" value={s.plateBoxWidthMm} min={18} max={70} onChange={(value) => patch({ plateBoxWidthMm: value })} />
            <NumberControl label="Plate box height" value={s.plateBoxHeightMm} min={10} max={60} onChange={(value) => patch({ plateBoxHeightMm: value })} />
            <NumberControl label="Plate font" value={s.plateNumberFontSize} min={9} max={36} onChange={(value) => patch({ plateNumberFontSize: value })} />
            <NumberControl label="Vehicle title font" value={s.vehicleTitleFontSize} min={8} max={22} onChange={(value) => patch({ vehicleTitleFontSize: value })} />
            <NumberControl label="VIN font" value={s.vinFontSize} min={7} max={16} onChange={(value) => patch({ vinFontSize: value })} />
          </div>
        </Section>

        <Section title="Signature / Stamp" description="Uses the real uploaded company stamp only. No fake stamp is rendered.">
          <div className="grid gap-4 md:grid-cols-3">
            <SwitchControl label="Show signature section" checked={s.showSignatureSection} onCheckedChange={(showSignatureSection) => patch({ showSignatureSection })} />
            <SwitchControl label="Placeholder when no stamp" checked={s.stampPlaceholderEnabled} onCheckedChange={(stampPlaceholderEnabled) => patch({ stampPlaceholderEnabled })} />
            <SelectControl label="Layout" value={s.signatureLayout} onValueChange={(value) => patch({ signatureLayout: value as PdfSignatureLayout })} options={[["side-by-side", "Side by side"], ["stacked", "Stacked"]]} />
            <NumberControl label="Signature box width" value={s.signatureBoxWidthMm} min={15} max={90} onChange={(value) => patch({ signatureBoxWidthMm: value })} />
            <NumberControl label="Signature box height" value={s.signatureBoxHeightMm} min={8} max={60} onChange={(value) => patch({ signatureBoxHeightMm: value })} />
            <NumberControl label="Signature line width" value={s.signatureLineWidthMm} min={15} max={90} onChange={(value) => patch({ signatureLineWidthMm: value })} />
            <NumberControl label="Stamp box width" value={s.stampBoxWidthMm} min={18} max={100} onChange={(value) => patch({ stampBoxWidthMm: value })} />
            <NumberControl label="Stamp box height" value={s.stampBoxHeightMm} min={8} max={60} onChange={(value) => patch({ stampBoxHeightMm: value })} />
            <NumberControl label="Space below signature" value={s.spaceBelowSignatureMm} min={0} max={20} onChange={(value) => patch({ spaceBelowSignatureMm: value })} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ImageUploadBox title="Company Stamp / ختم الشركة" imageUrl={templateSettings.stampUrl} inputRef={stampInputRef} onUpload={uploadStamp} onRemove={removeStamp} />
            <ImageUploadBox title="Signature / التوقيع" imageUrl={templateSettings.signatureUrl} inputRef={signatureInputRef} onUpload={uploadSignature} onRemove={removeSignature} />
          </div>
        </Section>

        <Section title="QR" description="Controls QR size, position, label and border. QR data still comes from short links.">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectControl label="QR position" value={s.qrPosition} onValueChange={(value) => patch({ qrPosition: value as PdfQrPosition })} options={[["right-totals-box", "Right totals box"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]]} />
            <SwitchControl label="Show QR label" checked={s.qrLabelVisible} onCheckedChange={(qrLabelVisible) => patch({ qrLabelVisible })} />
            <SwitchControl label="QR border" checked={s.qrBorderVisible} onCheckedChange={(qrBorderVisible) => patch({ qrBorderVisible })} />
            <NumberControl label="QR size mm" value={s.qrSizeMm} min={10} max={70} onChange={(value) => patch({ qrSizeMm: value })} />
            <NumberControl label="QR margin mm" value={s.qrMarginMm} min={0} max={20} onChange={(value) => patch({ qrMarginMm: value })} />
          </div>
        </Section>

        <Section title="Live Preview" description="Preview uses pdf-v2 HTML with the current unsaved settings. Save persists to Supabase.">
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} className="gap-2"><Save size={16} /> Save</Button>
            <Button variant="outline" onClick={openPreview} className="gap-2"><Eye size={16} /> Open PDF</Button>
            <Button variant="outline" onClick={testPrint}>Test Print</Button>
            <Button variant="outline" onClick={reset} className="gap-2"><RotateCcw size={16} /> Reset defaults</Button>
            <Button variant="outline" onClick={() => navigate("/settings/pdf-qa")} className="gap-2"><FileCheck2 size={16} /> PDF QA</Button>
          </div>
          <div className="mt-4 overflow-auto rounded-xl border border-border bg-muted/30 p-3">
            <iframe title="PDF layout preview" srcDoc={previewHtml} className="h-[720px] w-full rounded-lg bg-white" />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">Show generated CSS</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/40 p-2 text-[10px]">{buildPageMarginCss(s, s.pageSize === "a4-landscape" ? "landscape" : "portrait")}</pre>
          </details>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function PresetCard({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-border bg-card p-4 text-start shadow-card transition hover:border-primary/50">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </button>
  );
}

function NumberControl({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const safe = bounded(value, min, max);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <Input type="number" min={min} max={max} step={step} value={safe} onChange={(event) => onChange(bounded(Number(event.target.value), min, max))} className="h-8 w-24 text-center" />
      </div>
      <Slider value={[safe]} min={min} max={max} step={step} onValueChange={(value) => onChange(bounded(value[0], min, max))} />
    </div>
  );
}

function SwitchControl({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
      <span className="text-xs font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SelectControl({ label, value, options, onValueChange }: { label: string; value: string; options: Array<[string, string]>; onValueChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ImageUploadBox({
  title,
  imageUrl,
  inputRef,
  onUpload,
  onRemove,
}: {
  title: string;
  imageUrl?: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <input ref={inputRef} type="file" accept="image/*" onChange={onUpload} className="hidden" />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="gap-2">
          <ImageIcon size={14} />
          {imageUrl ? "Change" : "Upload"}
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-28 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-card">
          {imageUrl ? <img src={imageUrl} alt={title} className="max-h-full max-w-full object-contain p-2" /> : <span className="px-3 text-center text-xs text-muted-foreground">{title}</span>}
        </div>
        {imageUrl && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="gap-2 text-destructive">
            <X size={14} />
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
