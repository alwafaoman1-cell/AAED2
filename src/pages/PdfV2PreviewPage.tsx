import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPdfV2Html, downloadPdfV2, printPdfV2, type PdfV2DocumentType } from "@/lib/pdf-v2";

export default function PdfV2PreviewPage() {
  const navigate = useNavigate();
  const { documentType = "generic", id = "preview" } = useParams();
  const [search] = useSearchParams();
  const html = search.get("html")
    ? decodeURIComponent(search.get("html") || "")
    : `<section class="pdf-v2-card"><h2>${documentType}</h2><p>${id}</p></section>`;
  const meta = useMemo(() => ({
    documentType: documentType as PdfV2DocumentType,
    documentNumber: id,
    title: search.get("title") || documentType,
    language: (search.get("lang") === "en" ? "en" : "ar") as "ar" | "en",
    layout: (search.get("layout") as any) || undefined,
  }), [documentType, id, search]);
  const srcDoc = useMemo(() => buildPdfV2Html({ html, meta }), [html, meta]);

  return (
    <div className="min-h-screen bg-muted/40 flex flex-col">
      <div className="pdf-v2-toolbar sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 p-3">
        <Button variant="outline" onClick={() => navigate(-1)} className="gap-2"><ArrowLeft size={16} /> Back</Button>
        <div className="flex-1 font-semibold">{meta.title}</div>
        <Button variant="outline" onClick={() => void printPdfV2({ html, meta })} className="gap-2"><Printer size={16} /> Print</Button>
        <Button onClick={() => void downloadPdfV2({ html, meta }, `${documentType}-${id}`)} className="gap-2"><Download size={16} /> Download PDF</Button>
      </div>
      <iframe title="PDF v2 preview" srcDoc={srcDoc} className="flex-1 w-full border-0" />
    </div>
  );
}
