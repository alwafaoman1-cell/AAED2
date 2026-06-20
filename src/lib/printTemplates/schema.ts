// Print Template Schema — JSON structure for designable templates
// Compatible with wkhtmltopdf 0.12.2 (table-based, no flex/grid)

export type DocType =
  | "tax_invoice"
  | "insurance_tax_invoice"
  | "quote"
  | "work_order"
  | "inspection"
  | "claim_estimate"
  | "delivery_proof"
  | "payment_voucher"
  | "deposit_receipt"
  | "vehicle_card"
  | "stage_photos_album"
  | "needed_parts_request"
  | "account_statement"
  | "insurance_statement";

export type BlockType =
  | "header"
  | "logo"
  | "title"
  | "info_grid"
  | "items_table"
  | "totals"
  | "qr_zatca"
  | "stamp"
  | "signature"
  | "spacer"
  | "text"
  | "image"
  | "divider"
  | "footer"
  | "estimation_badge"; // LUMP SUM / UPL

export interface BlockStyle {
  paddingTop?: number;       // mm
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginBottom?: number;
  fontFamily?: "Cairo" | "Amiri" | "Tajawal" | "Inter" | "Arial";
  fontSize?: number;         // pt
  fontWeight?: "normal" | "bold" | "600" | "700";
  color?: string;            // hex
  backgroundColor?: string;
  textAlign?: "right" | "center" | "left" | "justify";
  borderTop?: string;        // e.g. "1px solid #d4d4d4"
  borderBottom?: string;
  borderRadius?: number;
  height?: number;           // mm (optional fixed height)
  visible?: boolean;         // show/hide
}

export interface BlockProps {
  // Common
  text?: string;             // for text/title blocks (supports {{placeholders}})
  textEn?: string;
  // Header / Logo
  logoSize?: number;         // mm
  logoPosition?: "right" | "center" | "left";
  showCompanyName?: boolean;
  showCompanyDetails?: boolean;
  // Info grid
  fields?: Array<{ label: string; labelEn?: string; bind: string }>;
  columns?: 1 | 2 | 3 | 4;
  // Items table
  itemsBind?: string;        // "items"
  columnsConfig?: Array<{ key: string; label: string; labelEn?: string; width?: number; align?: "right" | "center" | "left" }>;
  showRowNumbers?: boolean;
  zebra?: boolean;
  // Totals
  totalsItems?: Array<{ label: string; labelEn?: string; bind: string; bold?: boolean }>;
  // Estimation badge
  badgeText?: string;        // LUMP SUM / UPL
  badgeColor?: string;
  // QR
  qrSize?: number;           // mm
  qrPosition?: "right" | "center" | "left";
  // Image
  src?: string;
  width?: number;
  // Spacer
  size?: number;             // mm
  // Stamp / Signature
  stampSize?: number;
  signatureLabel?: string;
}

export type BlockZone = "header" | "body" | "footer";

export interface TemplateBlock {
  id: string;
  type: BlockType;
  zone?: BlockZone; // default: "body"
  style?: BlockStyle;
  props?: BlockProps;
}

export interface TemplatePage {
  size: "A4" | "A5" | "Letter";
  orientation: "portrait" | "landscape";
  marginTop: number;    // mm
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  rtl: boolean;
  primaryColor: string;
  secondaryColor: string;
  baseFontFamily: "Cairo" | "Amiri" | "Tajawal" | "Inter" | "Arial";
  baseFontSize: number; // pt
  showPageNumbers?: boolean;
  watermarkText?: string;
}

export interface TemplateSchema {
  version: 1;
  page: TemplatePage;
  blocks: TemplateBlock[];
}

export const DEFAULT_PAGE: TemplatePage = {
  size: "A4",
  orientation: "portrait",
  marginTop: 12,
  marginRight: 12,
  marginBottom: 12,
  marginLeft: 12,
  rtl: true,
  primaryColor: "#1f2937",
  secondaryColor: "#6b7280",
  baseFontFamily: "Cairo",
  baseFontSize: 10,
  showPageNumbers: true,
};

export function emptySchema(): TemplateSchema {
  return { version: 1, page: { ...DEFAULT_PAGE }, blocks: [] };
}

let _id = 0;
export const newBlockId = () => `b_${Date.now().toString(36)}_${(++_id).toString(36)}`;
