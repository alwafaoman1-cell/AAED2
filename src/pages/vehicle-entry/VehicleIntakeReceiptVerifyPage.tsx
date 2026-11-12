import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import VehicleIntakeReceiptCheck from "@/components/vehicle-entry/VehicleIntakeReceiptCheck";
export default function VehicleIntakeReceiptVerifyPage() {
  const [params] = useSearchParams(); const { i18n } = useTranslation(); const [receiptId, setReceiptId] = useState<string | null>(null);
  const entry = params.get("entry") || "";
  return <main className="mx-auto max-w-2xl space-y-4 p-5"><h1 className="text-xl font-bold">{i18n.language.startsWith("en") ? "Verify vehicle intake receipt" : "التحقق من وصل استلام المركبة"}</h1>{entry && <VehicleIntakeReceiptCheck entryId={entry} initialReference={params.get("reference") || ""} receiptId={receiptId} onChange={setReceiptId} />}</main>;
}
