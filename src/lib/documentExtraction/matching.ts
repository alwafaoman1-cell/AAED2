import { supabase } from "@/integrations/supabase/client";
import type { EntityMatch, ExtractedField, ExtractionIssue } from "./types";

export interface MatchingResult {
  matches: EntityMatch[];
  issues: ExtractionIssue[];
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u064b-\u065f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function nameSimilarity(left: string, right: string): number {
  const a = normalizedName(left);
  const b = normalizedName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aParts = Array.from({ length: Math.max(0, a.length - 1) }, (_, index) => a.slice(index, index + 2));
  const bParts = Array.from({ length: Math.max(0, b.length - 1) }, (_, index) => b.slice(index, index + 2));
  const remaining = new Map<string, number>();
  for (const part of bParts) remaining.set(part, (remaining.get(part) || 0) + 1);
  let common = 0;
  for (const part of aParts) {
    const count = remaining.get(part) || 0;
    if (count) { common++; remaining.set(part, count - 1); }
  }
  return aParts.length + bParts.length ? 2 * common / (aParts.length + bParts.length) : 0;
}

function addUnique(matches: EntityMatch[], next: EntityMatch) {
  if (!matches.some((item) => item.entity === next.entity && item.id === next.id)) matches.push(next);
}

/** Read-only, bounded, tenant-filtered lookups. No entity is created or merged here. */
export async function matchExtractedEntities(tenantId: string, fields: Record<string, ExtractedField>): Promise<MatchingResult> {
  const matches: EntityMatch[] = [];
  const issues: ExtractionIssue[] = [];
  const vin = fields.vin?.normalizedValue;
  const plate = fields.plate_number?.normalizedValue;
  const letters = fields.plate_letters?.normalizedValue || "";
  const country = fields.plate_country?.normalizedValue || "OM";
  const foundByVin = new Set<string>();
  const foundByPlate = new Set<string>();

  if (vin && fields.vin.validation === "valid") {
    for (const column of ["vin", "vin_number"] as const) {
      const { data, error } = await supabase.from("vehicles")
        .select("id,plate_number,plate_letters,plate_country,brand,model")
        .eq("tenant_id", tenantId).is("deleted_at", null).eq(column, vin).limit(3);
      if (error) throw error;
      for (const vehicle of data || []) {
        foundByVin.add(vehicle.id);
        addUnique(matches, { entity: "vehicle", id: vehicle.id, label: `${vehicle.brand || ""} ${vehicle.model || ""} · ${vehicle.plate_number || ""}`.trim(), confidence: 0.99, reason: "VIN exact", exact: true });
      }
    }
  }
  if (plate && fields.plate_number.validation === "valid" && letters) {
    const { data, error } = await supabase.from("vehicles")
      .select("id,plate_number,plate_letters,plate_country,brand,model")
      .eq("tenant_id", tenantId).is("deleted_at", null)
      .eq("plate_number", plate).eq("plate_letters", letters).eq("plate_country", country).limit(4);
    if (error) throw error;
    for (const vehicle of data || []) {
      foundByPlate.add(vehicle.id);
      addUnique(matches, { entity: "vehicle", id: vehicle.id, label: `${vehicle.brand || ""} ${vehicle.model || ""} · ${vehicle.plate_number || ""}`.trim(), confidence: 0.98, reason: "Plate digits + letters + country exact", exact: true });
    }
  }
  if (plate && !letters) issues.push({ code: "PLATE_IDENTITY_INCOMPLETE", severity: "warning", field: "plate_letters", message: "Plate code is missing. Verify digits, code and country before linking a vehicle." });
  if (foundByVin.size && foundByPlate.size && !Array.from(foundByVin).some((id) => foundByPlate.has(id))) {
    issues.push({ code: "VEHICLE_IDENTITY_CONFLICT", severity: "error", message: "VIN and plate match different existing vehicles. Do not create or overwrite a vehicle until reviewed." });
  }
  if (foundByVin.size || foundByPlate.size) {
    if (fields.vin && foundByVin.size) fields.vin.confidence = Math.max(fields.vin.confidence, 0.98);
    if (fields.plate_number && foundByPlate.size) fields.plate_number.confidence = Math.max(fields.plate_number.confidence, 0.97);
  }

  const phone = fields.owner_phone?.normalizedValue;
  if (phone && fields.owner_phone.validation === "valid") {
    const digits = phone.replace(/\D/g, "");
    const { data, error } = await supabase.from("customers")
      .select("id,name,phone").eq("tenant_id", tenantId).is("deleted_at", null)
      .ilike("phone", `%${digits.slice(-8)}%`).limit(10);
    if (error) throw error;
    for (const customer of data || []) if (customer.phone?.replace(/\D/g, "").slice(-8) === digits.slice(-8))
      addUnique(matches, { entity: "customer", id: customer.id, label: customer.name, confidence: 0.98, reason: "Phone last 8 digits", exact: true });
  }
  const owner = fields.owner_name?.normalizedValue || fields.insured_name?.normalizedValue;
  if (owner && !matches.some((match) => match.entity === "customer")) {
    const { data, error } = await supabase.from("customers")
      .select("id,name").eq("tenant_id", tenantId).is("deleted_at", null).ilike("name", owner).limit(5);
    if (error) throw error;
    for (const customer of data || []) addUnique(matches, { entity: "customer", id: customer.id, label: customer.name, confidence: 0.8, reason: "Name only — review before linking", exact: normalizedName(customer.name) === normalizedName(owner) });
  }

  const vatin = fields.supplier_vatin?.normalizedValue;
  if (vatin) {
    const { data, error } = await supabase.from("suppliers").select("id,name,tax_number")
      .eq("tenant_id", tenantId).eq("tax_number", vatin).limit(5);
    if (error) throw error;
    for (const supplier of data || []) addUnique(matches, { entity: "supplier", id: supplier.id, label: supplier.name, confidence: 0.99, reason: "VATIN exact", exact: true });
  }
  const supplierName = fields.supplier_name?.normalizedValue;
  if (supplierName && !matches.some((match) => match.entity === "supplier")) {
    const { data, error } = await supabase.from("suppliers").select("id,name,tax_number")
      .eq("tenant_id", tenantId).ilike("name", supplierName).limit(5);
    if (error) throw error;
    for (const supplier of data || []) addUnique(matches, { entity: "supplier", id: supplier.id, label: supplier.name, confidence: 0.85, reason: "Supplier name — verify VATIN", exact: normalizedName(supplier.name) === normalizedName(supplierName) });
    if (!data?.length) {
      const anchor = normalizedName(supplierName).split(" ").find((token) => token.length >= 3);
      if (anchor) {
        const safeAnchor = anchor.replace(/[%_\\]/g, "").slice(0, 5);
        const suggestions = await supabase.from("suppliers").select("id,name")
          .eq("tenant_id", tenantId).ilike("name", `%${safeAnchor}%`).limit(30);
        if (suggestions.error) throw suggestions.error;
        for (const candidate of (suggestions.data || []).map((row) => ({ ...row, score: nameSimilarity(row.name, supplierName) }))
          .filter((row) => row.score >= 0.72).sort((a, b) => b.score - a.score).slice(0, 3)) {
          addUnique(matches, { entity: "supplier", id: candidate.id, label: candidate.name,
            confidence: Math.min(0.84, candidate.score), reason: "Fuzzy supplier suggestion — manual selection required", exact: false });
        }
      }
    }
  }
  if (vatin && supplierName) {
    const named = matches.find((match) => match.entity === "supplier" && match.reason.startsWith("Supplier name"));
    if (named) issues.push({ code: "SUPPLIER_VATIN_NOT_MATCHED", severity: "warning", field: "supplier_vatin", message: "A supplier name matched but the VATIN did not. Verify before linking." });
  }

  const insuranceName = fields.insurance_company?.normalizedValue;
  if (insuranceName) {
    const { data, error } = await supabase.from("insurance_companies")
      .select("id,name").eq("tenant_id", tenantId).ilike("name", insuranceName).limit(5);
    if (error) throw error;
    for (const company of data || []) addUnique(matches, { entity: "insurance_company", id: company.id, label: company.name, confidence: 0.94, reason: "Company name", exact: normalizedName(company.name) === normalizedName(insuranceName) });
  }

  const claimNumber = fields.claim_number?.normalizedValue;
  if (claimNumber) {
    const { data, error } = await supabase.from("insurance_claims")
      .select("id,claim_number").eq("tenant_id", tenantId).is("deleted_at", null).eq("claim_number", claimNumber).limit(5);
    if (error) throw error;
    for (const claim of data || []) addUnique(matches, { entity: "claim", id: claim.id, label: claim.claim_number || "Claim", confidence: 1, reason: "Claim number already exists", exact: true });
    if (data?.length) issues.push({ code: "DUPLICATE_CLAIM_SUSPECTED", severity: "error", field: "claim_number", message: "This claim number already exists. Open the existing claim instead of creating another." });
  }

  const invoiceNumber = fields.invoice_number?.normalizedValue;
  if (invoiceNumber) {
    const { data, error } = await supabase.from("purchase_invoices")
      .select("id,invoice_number,supplier_invoice_number,supplier_id,supplier_name")
      .eq("tenant_id", tenantId).eq("supplier_invoice_number", invoiceNumber).limit(8);
    if (error) throw error;
    const supplierIds = new Set(matches.filter((match) => match.entity === "supplier" && match.exact).map((match) => match.id));
    for (const invoice of data || []) {
      const supplierMatches = supplierIds.has(invoice.supplier_id || "") || (supplierName && normalizedName(invoice.supplier_name || "") === normalizedName(supplierName));
      if (!supplierMatches) continue;
      addUnique(matches, { entity: "invoice", id: invoice.id, label: invoice.supplier_invoice_number || invoice.invoice_number, confidence: 1, reason: "Supplier + invoice number already exists", exact: true });
      issues.push({ code: "DUPLICATE_INVOICE_SUSPECTED", severity: "error", field: "invoice_number", message: "An invoice with this supplier and invoice number already exists." });
    }
    const expenses = await supabase.from("expenses").select("id,supplier_id,beneficiary,supplier_invoice_number")
      .eq("tenant_id", tenantId).is("deleted_at", null).eq("supplier_invoice_number", invoiceNumber).limit(8);
    if (expenses.error) throw expenses.error;
    for (const expense of expenses.data || []) {
      const supplierMatches = supplierIds.has(expense.supplier_id || "") ||
        !!supplierName && normalizedName(expense.beneficiary || "") === normalizedName(supplierName);
      if (!supplierMatches) continue;
      addUnique(matches, { entity: "invoice", id: expense.id, label: expense.supplier_invoice_number || "Existing expense", confidence: 1,
        reason: "Existing expense with supplier invoice number", exact: true });
      issues.push({ code: "DUPLICATE_EXPENSE_RECEIPT_SUSPECTED", severity: "error", field: "invoice_number", message: "This supplier invoice is already attached to an expense." });
    }
  }
  return { matches, issues };
}
