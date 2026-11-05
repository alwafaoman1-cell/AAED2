import { useTranslation } from "react-i18next";
import { Section } from "./VehicleEntryFields";
import type { VehicleEntryEditor } from "@/hooks/useVehicleEntryEditor";
import AiExtractButton from "@/components/ai/AiExtractButton";
import {toast} from "sonner";
import "@/lib/i18n/vehicleIntakeWizard";

export function VehicleEntryExtraction({editor}:{editor:VehicleEntryEditor}) {
const {t}=useTranslation();
const {form,patchCustomer,patchVehicle,patchInsurance,setPendingDocumentFileId,vehicleMakes}=editor;
return <Section title={t("vehicleIntakeWizard.extraction")} desc={t("vehicleIntakeWizard.views.extractionHint")}>
        <AiExtractButton
          schema="insurance_claim"
          expectedDocumentType="auto"
          vehicleMakes={vehicleMakes.map((make) => make.name)}
          label={t("vehicleIntakeWizard.views.extractionButton")}
          hint={t("vehicleIntakeWizard.noAutoSave")}
          onExtracted={(data, document) => {
            if (document) {
              setPendingDocumentFileId(document.fileId);
              if (Object.keys(data).length === 0) {
                toast.info(t("vehicleIntakeWizard.views.documentStaged"));
                return;
              }
              const existingVehicle = document.result.matches.find((match) => match.entity === "vehicle" && match.exact);
              if (existingVehicle) toast.warning(t("vehicleIntakeWizard.views.existingVehicleFound"));
            }
            // Apply only supplied, reviewed fields. Never guess missing identities,
            // replace selected records or infer the service channel from a document.
            const customer: Partial<typeof form.customer> = {};
            const vehicle: Partial<typeof form.vehicle> = {};
            const insurance: Partial<typeof form.insurance> = {};
            for (const [source, target] of [["owner_name", "name"], ["owner_phone", "phone"], ["owner_id", "id_number"]] as const) {
              const value = typeof data[source] === "string" ? data[source].trim() : "";
              if (value && value !== form.customer[target]) customer[target] = value;
            }
            for (const key of ["plate_number", "plate_letters", "plate_country", "make", "model", "year", "color", "vin"] as const) {
              const value = typeof data[key] === "string" ? data[key].trim() : "";
              if (value && value !== form.vehicle[key]) vehicle[key] = value;
            }
            for (const [source, target] of [["insurance_company", "company_name"], ["claim_number", "claim_number"], ["lpo_number", "lpo_number"]] as const) {
              const value = typeof data[source] === "string" ? data[source].trim() : "";
              if (value && value !== form.insurance[target]) insurance[target] = value;
            }
            let applied = false;
            if (Object.keys(customer).length) {
              if (form.customer_id) toast.warning(t("vehicleIntakeWizard.views.extractionCustomerLocked"));
              else { patchCustomer(customer); applied = true; }
            }
            if (Object.keys(vehicle).length) {
              if (form.vehicle_id) toast.warning(t("vehicleIntakeWizard.views.extractionVehicleLocked"));
              else { patchVehicle(vehicle); applied = true; }
            }
            if (Object.keys(insurance).length) {
              if (!form.insurance.is_insurance_related) toast.warning(t("vehicleIntakeWizard.views.extractionInsuranceSkipped"));
              else { patchInsurance(insurance); applied = true; }
            }
            if (applied) toast.success(t("vehicleIntakeWizard.extracted"));
            else toast.info(t("vehicleIntakeWizard.views.extractionNoChanges"));
          }}
        />
      </Section>;
}

