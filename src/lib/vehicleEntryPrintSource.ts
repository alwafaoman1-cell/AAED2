import i18n from "@/i18n";
import { getIntakeReceiptContext, getIntakeReceiptDocument } from "@/lib/vehicleIntakeReceipt";

interface PrintableVehicleEntry {
  id?: string;
  entry_number?: string;
  intake_revision?: number | null;
  vehicle_entry_signatures?: readonly { signature_role?: string; intake_revision?: number | null }[];
  [key: string]: unknown;
}

/** Signed forms always use their frozen entry, media and signature together.
 * Unversioned legacy ink retains the existing detail-page handling; it is never
 * treated as a signature authorizing a current versioned receipt. */
export async function getVehicleEntryPrintSource(entry: PrintableVehicleEntry): Promise<PrintableVehicleEntry> {
  const signed = (entry.vehicle_entry_signatures || []).some((signature) =>
    signature.signature_role === "delivered_by"
    && signature.intake_revision != null
    && signature.intake_revision === entry.intake_revision,
  );
  if (!signed) return entry;
  if (!entry.id) throw new Error(i18n.t("vehicleEntry.pdfSourceMissing"));

  const context = await getIntakeReceiptContext(entry.id);
  const receipt = context.receipts.find((candidate) => candidate.revision === entry.intake_revision);
  if (!receipt) throw new Error(i18n.t("vehicleEntry.pdfSourceMissing"));
  const document = await getIntakeReceiptDocument(receipt.id);
  if (!document.entry || document.entry.id !== entry.id || document.revision !== entry.intake_revision) {
    throw new Error(i18n.t("vehicleEntry.pdfSourceMissing"));
  }
  return document.entry;
}
