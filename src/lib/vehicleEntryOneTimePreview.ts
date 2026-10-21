import { buildVehicleEntryHtml } from "@/lib/vehicleEntryService";

export interface SignedEntryPreviewPayload {
  entry_number: string;
  arrival_date?: string;
  arrival_time?: string;
  arrival_method?: string;
  vehicle_location?: string;
  vehicle_location_bay?: string;
  received_by_name?: string;
  customer_snapshot?: Record<string, unknown>;
  vehicle_snapshot?: Record<string, unknown>;
  insurance_snapshot?: Record<string, unknown>;
  delivered_by?: Record<string, unknown>;
  vehicle_condition?: Record<string, unknown>;
  vehicle_contents?: Record<string, unknown>;
  damage_marks?: Array<Record<string, unknown>>;
  declaration_ar?: string;
  declaration_en?: string;
  receiver_signature_data_url?: string | null;
}

export interface SignedEntryPhoto {
  id: string;
  url: string;
  category?: string;
  file_name?: string;
}

export interface EntrySignatureSubmitResult {
  ok?: boolean;
  already_signed?: boolean;
  signed_at?: string;
  preview_entry?: SignedEntryPreviewPayload;
}

/** A replayed signature never receives a preview payload from the server. */
export function canShowOneTimeEntryPreview(result: EntrySignatureSubmitResult | null): result is EntrySignatureSubmitResult & {
  signed_at: string;
  preview_entry: SignedEntryPreviewPayload;
} {
  return Boolean(
    result?.ok &&
    !result.already_signed &&
    result.signed_at &&
    result.preview_entry?.entry_number,
  );
}

export function buildOneTimeEntryPreviewHtml(
  payload: SignedEntryPreviewPayload,
  photos: SignedEntryPhoto[],
  signatureDataUrl: string,
): string {
  const entry = {
    ...payload,
    vehicle_media: photos.map((photo) => ({
      id: photo.id,
      media_type: "image",
      url: photo.url,
      category: photo.category,
      file_name: photo.file_name,
    })),
    vehicle_entry_signatures: [
      { signature_role: "delivered_by", signature_data_url: signatureDataUrl },
      ...(payload.receiver_signature_data_url
        ? [{ signature_role: "receiver", signature_data_url: payload.receiver_signature_data_url }]
        : []),
    ],
  };

  // Reuse the canonical print template, but the customer view has no print or
  // download controls. The sandboxed iframe is destroyed after ten seconds.
  return buildVehicleEntryHtml(entry).replace(
    "</head>",
    "<style>@media print{html,body{display:none!important}}</style></head>",
  );
}
