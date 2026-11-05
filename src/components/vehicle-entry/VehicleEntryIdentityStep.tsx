import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CarFront, Truck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PlateInput from "@/components/vehicles/PlateInput";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import InsuranceCompanyAutocomplete from "@/components/insurance/InsuranceCompanyAutocomplete";
import type { VehicleEntryEditor } from "@/hooks/useVehicleEntryEditor";
import { Field, Section } from "./VehicleEntryFields";
import "@/lib/i18n/vehicleIntakeWizard";

// The Arabic values remain the persisted contract; translate display labels only.
const ARRIVAL_METHODS = [
  { value: "العميل أحضر المركبة", key: "arrivalOwner", type: "owner" },
  { value: "سائق أحضر المركبة", key: "arrivalDriver", type: "driver" },
  { value: "وصلت بواسطة رافعة", key: "arrivalTow", type: "tow" },
] as const;
type VehicleResult = { id: string; plate_letters?: string; plate_number?: string; plate_country?: string; brand?: string; model?: string; year?: string | number; archived?: boolean; archived_at?: string; deleted_at?: string; customers?: { name?: string } };

export function VehicleEntryIdentityStep({ editor }: { editor: VehicleEntryEditor }) {
  const { t } = useTranslation();
  const { form, patch, patchCustomer, patchVehicle, patchInsurance, patchDeliveredBy, chooseDeliveredBy,
    deliveryDataSource, setDeliveryDataSource, customerSearch, setCustomerSearch, vehicleSearch, setVehicleSearch,
    customerResults, vehicleResults, selectCustomer, selectVehicle, insuranceEmployees, detail } = editor;
  const [pickedVehicle, setPickedVehicle] = useState<VehicleResult | null>(null);
  const savedEntry = detail.data;
  const selectedVehicle = pickedVehicle?.id === form.vehicle_id ? pickedVehicle : savedEntry?.vehicle;
  const center = editor.visit?.data;
  const stage = center?.operationalStage || center?.stage;
  const knownStage = stage && ["arrived", "approved", "in_progress", "ready", "delivered", "cancelled", "needs_review"].includes(stage);
  const stageLabel = !form.id ? t("vehicleIntakeWizard.newStage") : knownStage ? t(`vehicleVisit.${stage}`) : t("vehicleIntakeWizard.views.managedInCenter");
  const location = !form.id ? "داخل الورشة" : center?.entry?.vehicle_location ?? savedEntry?.vehicle_location ?? form.vehicle_location;
  const locationLabel = location === "داخل الورشة" || location === "in_workshop" ? t("vehicleIntakeWizard.inside")
    : location === "مع العميل" || location === "with_customer" ? t("vehicleIntakeWizard.withCustomer") : location || t("vehicleIntakeWizard.views.locationUnconfirmed");

  return <>
    <Section title={t("vehicleIntakeWizard.arrival")} desc={t("vehicleIntakeWizard.statusHint")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label={t("vehicleIntakeWizard.arrivalDate")}><Input type="date" value={form.arrival_date} onChange={(e) => patch({ arrival_date: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.arrivalTime")}><Input type="time" value={form.arrival_time} onChange={(e) => patch({ arrival_time: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.views.arrivalMethod")}>
          <Select value={form.arrival_method} onValueChange={(value) => { const method = ARRIVAL_METHODS.find((item) => item.value === value); if (method) chooseDeliveredBy(method.type); }}>
            <SelectTrigger aria-label={t("vehicleIntakeWizard.views.arrivalMethod")}><SelectValue /></SelectTrigger>
            <SelectContent>{ARRIVAL_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{t(`vehicleIntakeWizard.views.${method.key}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t("vehicleIntakeWizard.receiver")}><Input value={form.received_by_name} onChange={(e) => patch({ received_by_name: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.location")}><Input value={locationLabel} readOnly /></Field>
        <Field label={t("vehicleIntakeWizard.bay")}><Input value={form.vehicle_location_bay} disabled={location !== "داخل الورشة" && location !== "in_workshop"} onChange={(e) => patch({ vehicle_location_bay: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.centerStatus")}><Input value={stageLabel} readOnly /></Field>
        {editor.centerPath !== "/supervisor" && <Button type="button" variant="outline" asChild className="self-end"><Link to={editor.centerPath || "/vehicle-entry"}>{t("vehicleIntakeWizard.views.openCenter")}</Link></Button>}
      </div>
    </Section>
    <Section title={t("vehicleIntakeWizard.customerTitle")} desc={t("vehicleIntakeWizard.customerHint")}>
      <Field label={t("vehicleIntakeWizard.customerSearch")}><Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder={t("vehicleIntakeWizard.customerSearch")} /></Field>
      {customerResults.isError && <p role="alert" className="text-sm text-destructive">{t("vehicleIntakeWizard.views.customerSearchError")}</p>}
      {customerResults.isFetching && <p role="status" className="text-sm text-muted-foreground">{t("vehicleIntakeWizard.loading")}</p>}
      {!!customerResults.data?.length && <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{customerResults.data.map((customer) =>
        <button type="button" key={customer.id} onClick={() => selectCustomer(customer)} className="ui-touch-target rounded-lg border border-border p-3 text-start hover:bg-muted">
          <div className="font-semibold">{customer.name}</div><div className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.code")}: <bdi>{customer.customer_code || t("vehicleIntakeWizard.views.notProvided")}</bdi></div><div className="text-xs text-muted-foreground" dir="ltr">{customer.phone || ""}</div>
        </button>)}</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {([{ key: "name", label: "customerName" }, { key: "phone", label: "phone" }, { key: "alternate_phone", label: "alternatePhone" }, { key: "id_number", label: "idNumber" }, { key: "address", label: "address" }] as const).map(({ key, label }) =>
          <Field key={key} label={t(`vehicleIntakeWizard.${label}`)}><Input dir={key === "phone" || key === "alternate_phone" || key === "id_number" ? "ltr" : undefined} value={form.customer[key]} onChange={(e) => patchCustomer({ [key]: e.target.value })} /></Field>)}
        <Field label={t("vehicleIntakeWizard.code")}><Input dir="ltr" value={form.customer.customer_code || (savedEntry?.customer && savedEntry.customer.id === form.customer_id ? savedEntry.customer.customer_code : "") || ""} readOnly /></Field>
        <Field label={t("vehicleIntakeWizard.views.customerType")}><Select value={form.customer.customer_type} onValueChange={(value) => { if (value === "individual" || value === "company") patchCustomer({ customer_type: value }); }}>
          <SelectTrigger aria-label={t("vehicleIntakeWizard.views.customerType")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="individual">{t("vehicleIntakeWizard.views.individual")}</SelectItem><SelectItem value="company">{t("vehicleIntakeWizard.views.company")}</SelectItem></SelectContent>
        </Select></Field>
        <div className="md:col-span-2"><Field label={t("vehicleIntakeWizard.notes")}><Textarea value={form.customer.notes} onChange={(e) => patchCustomer({ notes: e.target.value })} rows={2} /></Field></div>
      </div>
    </Section>
    <Section title={t("vehicleIntakeWizard.vehicleTitle")} desc={t("vehicleIntakeWizard.views.vehicleSearchHint")}>
      {form.vehicle_id && <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-sm font-semibold">{t("vehicleIntakeWizard.views.selectedVehicle")}: <bdi>{[form.vehicle.plate_letters, form.vehicle.plate_number, form.vehicle.plate_country].filter(Boolean).join(" ")}</bdi></p>
        <p className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.vehicleHint")}</p>
        {(selectedVehicle?.archived || selectedVehicle?.archived_at) && <p role="status" className="text-sm text-warning">{t("vehicleIntakeWizard.archivedReuse")}</p>}
        <Button type="button" variant="outline" onClick={() => patch({ vehicle_id: null })}>{t("vehicleIntakeWizard.clearVehicle")}</Button>
      </div>}
      <Field label={t("vehicleIntakeWizard.vehicleSearch")}><Input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder={t("vehicleIntakeWizard.vehicleSearch")} /></Field>
      {vehicleResults.isError && <p role="alert" className="text-sm text-destructive">{t("vehicleIntakeWizard.views.vehicleSearchError")}</p>}
      {vehicleResults.isFetching && <p role="status" className="text-sm text-muted-foreground">{t("vehicleIntakeWizard.loading")}</p>}
      {!!vehicleResults.data?.length && <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{vehicleResults.data.map((vehicle: VehicleResult) =>
        <button type="button" key={vehicle.id} disabled={!!vehicle.deleted_at} onClick={() => { setPickedVehicle(vehicle); selectVehicle(vehicle); }} className="ui-touch-target rounded-lg border border-border p-3 text-start hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60">
          <div className="font-semibold" dir="ltr">{[vehicle.plate_letters, vehicle.plate_number, vehicle.plate_country].filter(Boolean).join(" ")}</div><div className="text-xs text-muted-foreground">{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</div>
          {vehicle.customers?.name && <div className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.views.registeredOwner")}: {vehicle.customers.name}</div>}
          {(vehicle.archived || vehicle.archived_at) && <p className="mt-1 text-xs text-warning">{t("vehicleIntakeWizard.archivedReuse")}</p>}{vehicle.deleted_at && <p className="mt-1 text-xs text-destructive">{t("vehicleIntakeWizard.views.deletedVehicle")}</p>}
        </button>)}</div>}
      <PlateInput key={form.vehicle_id || "new"} value={[form.vehicle.plate_letters, form.vehicle.plate_number].filter(Boolean).join(" ")} defaultCountry={form.vehicle.plate_country} onChange={() => undefined} onPartsChange={(parts) => patchVehicle({ plate_letters: parts.letters, plate_number: parts.digits, plate_country: parts.country })} showCountry checkDuplicate={!form.vehicle_id} />
      <VehicleMakeModelPicker make={form.vehicle.make} model={form.vehicle.model} plate={[form.vehicle.plate_letters, form.vehicle.plate_number].filter(Boolean).join(" ")} year={form.vehicle.year} color={form.vehicle.color} vin={form.vehicle.vin} hideFields={["plate"]} onChange={(next) => patchVehicle({ make: next.make ?? form.vehicle.make, model: next.model ?? form.vehicle.model, year: next.year ?? form.vehicle.year, color: next.color ?? form.vehicle.color, vin: next.vin ?? form.vehicle.vin })} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={t("vehicleIntakeWizard.odometer")}><Input dir="ltr" inputMode="numeric" value={form.vehicle.mileage} onChange={(e) => patchVehicle({ mileage: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.views.registeredOwner")}><Input value={form.vehicle.current_owner_name} readOnly /></Field>
        <Field label={t("vehicleIntakeWizard.views.printHighlight")}><div className="flex flex-wrap items-center gap-2">
          <Input type="color" aria-label={t("vehicleIntakeWizard.views.printHighlight")} className="h-11 w-16 p-1" value={form.vehicle.highlight_color} onChange={(e) => patchVehicle({ highlight_color: e.target.value })} />
          {([{ color: "#dc2626", key: "red" }, { color: "#2563eb", key: "blue" }, { color: "#15803d", key: "green" }, { color: "#111827", key: "dark" }] as const).map(({ color, key }) => <button key={color} type="button" aria-label={t("vehicleIntakeWizard.views.chooseHighlight", { color: t(`vehicleIntakeWizard.views.${key}`) })} aria-pressed={form.vehicle.highlight_color === color} className="ui-touch-target h-9 w-9 rounded-full border-2 border-input shadow aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-2 ring-offset-background" style={{ backgroundColor: color }} onClick={() => patchVehicle({ highlight_color: color })} />)}
        </div></Field>
      </div>
    </Section>
    {form.insurance.is_insurance_related && <Section title={t("vehicleIntakeWizard.insuranceTitle")}>
      {form.insurance_claim_id && <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{t("vehicleIntakeWizard.views.linkedInsurance")}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={t("vehicleIntakeWizard.insurer")}><InsuranceCompanyAutocomplete value={form.insurance.company_name} companyId={form.insurance_company_id || null} aria-label={t("vehicleIntakeWizard.insurer")} placeholder={t("vehicleIntakeWizard.insurer")} onChange={(name, companyId) => patch({ insurance_company_id: companyId, insurance: { ...form.insurance, company_name: name, employee_id: companyId === form.insurance_company_id ? form.insurance.employee_id : "", employee_name: companyId === form.insurance_company_id ? form.insurance.employee_name : "" } })} /></Field>
        <Field label={t("vehicleIntakeWizard.insuranceOfficer")}><Select value={form.insurance.employee_id || "none"} disabled={!form.insurance_company_id} onValueChange={(employeeId) => { const employee = insuranceEmployees.find((item) => item.id === employeeId); patchInsurance({ employee_id: employeeId === "none" ? "" : employeeId, employee_name: employee?.name || "" }); }}>
          <SelectTrigger aria-label={t("vehicleIntakeWizard.insuranceOfficer")}><SelectValue placeholder={t("vehicleIntakeWizard.views.chooseOfficer")} /></SelectTrigger><SelectContent><SelectItem value="none">{t("vehicleIntakeWizard.noOfficer")}</SelectItem>{insuranceEmployees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}{employee.title ? ` — ${employee.title}` : ""}</SelectItem>)}</SelectContent>
        </Select></Field>
        {([{ key: "claim_number", label: "claimNumber" }, { key: "policy_number", label: "policyNumber" }, { key: "police_report_number", label: "policeNumber" }, { key: "lpo_number", label: "lpo" }, { key: "surveyor_name", label: "surveyor" }, { key: "surveyor_phone", label: "surveyorPhone" }] as const).map(({ key, label }) => <Field key={key} label={t(`vehicleIntakeWizard.${label}`)}><Input value={form.insurance[key]} onChange={(e) => patchInsurance({ [key]: e.target.value })} /></Field>)}
        <div className="md:col-span-3"><Field label={t("vehicleIntakeWizard.views.insuranceNotes")}><Textarea rows={2} value={form.insurance.notes} onChange={(e) => patchInsurance({ notes: e.target.value })} /></Field></div>
      </div>
    </Section>}
    <Section title={t("vehicleIntakeWizard.deliveredBy")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{([{ type: "owner", key: "customerBrought", Icon: UserRound }, { type: "driver", key: "driver", Icon: CarFront }, { type: "tow", key: "tow", Icon: Truck }] as const).map(({ type, key, Icon }) => <Button key={type} type="button" aria-pressed={form.delivered_by.delivery_type === type} variant={form.delivered_by.delivery_type === type ? "default" : "outline"} onClick={() => chooseDeliveredBy(type)} className="h-auto min-h-11 gap-2 whitespace-normal py-2 text-start"><Icon size={16} aria-hidden="true" />{t(`vehicleIntakeWizard.${key}`)}</Button>)}</div>
      {form.delivered_by.delivery_type === "owner" && <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">{t("vehicleIntakeWizard.views.visitorDetailsHint")}</p>}
      {form.delivered_by.delivery_type !== "owner" && <Field label={t("vehicleIntakeWizard.views.personSource")}><Select value={deliveryDataSource === "owner" ? "customer" : deliveryDataSource} onValueChange={(source) => { if (source !== "manual" && source !== "customer") return; setDeliveryDataSource(source); if (source === "customer") patchDeliveredBy({ full_name: form.customer.name, phone: form.customer.phone, id_number: form.customer.id_number }); }}>
        <SelectTrigger aria-label={t("vehicleIntakeWizard.views.personSource")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">{t("vehicleIntakeWizard.views.manualSource")}</SelectItem><SelectItem value="customer">{t("vehicleIntakeWizard.views.customerSource")}</SelectItem></SelectContent>
      </Select></Field>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={`${t(`vehicleIntakeWizard.views.${form.delivered_by.delivery_type === "driver" ? "driverName" : form.delivered_by.delivery_type === "tow" ? "towDriverName" : "customerPersonName"}`)} *`}><Input value={form.delivered_by.full_name} onChange={(e) => patchDeliveredBy({ full_name: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.phone")}><Input dir="ltr" value={form.delivered_by.phone} onChange={(e) => patchDeliveredBy({ phone: e.target.value })} /></Field>
        <Field label={t("vehicleIntakeWizard.idNumber")}><Input dir="ltr" value={form.delivered_by.id_number} onChange={(e) => patchDeliveredBy({ id_number: e.target.value })} /></Field>
        {form.delivered_by.delivery_type === "tow" && <Field label={t("vehicleIntakeWizard.towCompany")}><Input value={form.delivered_by.towing_company} onChange={(e) => patchDeliveredBy({ towing_company: e.target.value })} /></Field>}
        {form.delivered_by.delivery_type === "tow" && <Field label={t("vehicleIntakeWizard.towPlate")}><Input dir="ltr" value={form.delivered_by.towing_plate} onChange={(e) => patchDeliveredBy({ towing_plate: e.target.value })} /></Field>}
        <div className="md:col-span-3"><Field label={t("vehicleIntakeWizard.notes")}><Textarea rows={2} value={form.delivered_by.notes} onChange={(e) => patchDeliveredBy({ notes: e.target.value })} /></Field></div>
      </div>
    </Section>
  </>;
}
