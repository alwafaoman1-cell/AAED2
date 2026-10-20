// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getClaimVehicleLocation } from "@/lib/claimVehicleLocation";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import {
  buildInspectionReleaseHtml,
  emptyInspectionReleaseForm,
  inspectionReleaseInitialForm,
  inspectionReleaseMissingFields,
  type InspectionReleaseRecord,
} from "@/lib/vehicleInspectionRelease";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261020100000_vehicle_inspection_temporary_release.sql");
const triggerGrants = read("supabase/migrations/20261020101000_vehicle_inspection_release_trigger_grants.sql");

describe("vehicle inspection and temporary release", () => {
  it("has separate tenant-scoped, immutable signed records and one-time hashed links", () => {
    expect(migration).toContain("create table if not exists public.vehicle_inspection_releases");
    expect(migration).toContain("create table if not exists public.vehicle_inspection_release_links");
    expect(migration).toContain("token_hash text not null unique");
    expect(migration).toContain("extensions.digest(v_token, 'sha256')");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("grant select on public.vehicle_inspection_releases to authenticated");
    expect(migration).toContain("revoke all on public.vehicle_inspection_release_links from public, anon, authenticated");
    expect(migration).toContain("status <> 'draft'");
    expect(migration).toContain("for update");
    expect(migration).toContain("photo_is_part_of_inspection_release");
    expect(migration).toContain("create or replace function public.mark_vehicle_inspection_return");
    expect(migration).toContain("signer_must_match_named_recipient");
    expect(triggerGrants).toContain("revoke all on function public.protect_signed_inspection_media() from public, anon, authenticated");
    expect(triggerGrants).toContain("revoke all on function public.protect_signed_inspection_entry() from public, anon, authenticated");
    expect(migration).toContain("coalesce(v_order.status::text,'')");
    expect(migration).toContain("'Received','Issued','Converted to Claim','Converted to Work Order'");
    expect(migration).not.toMatch(/delete from public\.(vehicle_entries|insurance_claims|job_orders)/i);
    expect(migration).not.toMatch(/update public\.(invoices|sales_invoices|payments)/i);
  });

  it("only changes vehicle presence, not final delivery or financial status", () => {
    const signature = migration.slice(migration.indexOf("create or replace function public.submit_vehicle_inspection_release_signature"), migration.indexOf("-- The signed report"));
    expect(signature).toContain("vehicle_presence_status = 'with_customer'");
    expect(signature).toContain("temporary_inspection_release_id = v_release.id");
    expect(signature).toContain("vehicle_location = 'مع العميل'");
    expect(signature).not.toMatch(/set\s+status\s*=\s*'delivered'/i);
    expect(signature).not.toMatch(/set\s+delivered_at\s*=/i);
    expect(signature).not.toMatch(/invoice_status\s*=/i);
  });

  it("keeps server-side claim filters consistent with the temporary release marker", () => {
    expect(migration).toContain("create or replace function public.insurance_claims_list_rpc");
    expect(migration).toContain("c.temporary_inspection_release_id is not null");
    expect(migration).toContain("and c.vehicle_presence_status = 'with_customer' then 'with_customer'");
  });

  it("keeps public signing separate from the original entry signature", () => {
    const app = read("src/App.tsx");
    const detail = read("src/pages/vehicle-entry/VehicleEntryDetail.tsx");
    const publicPage = read("src/pages/public/VehicleInspectionReleaseSignPage.tsx");
    const media = read("supabase/functions/vehicle-entry-signature-media/index.ts");
    expect(app).toContain('path="/vehicle-entry/:id/inspection-release"');
    expect(app).toContain('path="/vehicle-entry/inspection-release/sign/:token"');
    expect(detail).toContain("معاينة وخروج مؤقت");
    expect(publicPage).toContain("get_vehicle_inspection_release_for_signature");
    expect(publicPage).toContain("submit_vehicle_inspection_release_signature");
    expect(publicPage).toContain("p_signer_name: signerName.trim()");
    expect(publicPage).not.toContain("submit_vehicle_entry_customer_signature");
    expect(media).toContain('body?.purpose === "inspection_release"');
    expect(media).toContain('.from("vehicle_inspection_release_links")');
    expect(media).toContain("photoIds.length ? mediaQuery.in");
  });

  it("prefills from the entry, but blocks a link until key exit/recipient facts are present", () => {
    const form = inspectionReleaseInitialForm({
      customer: { name: "Amal", phone: "99000000", id_number: "12345" },
      vehicle_contents: { keys_count: "2", notes: "Registration card" },
      vehicle_condition: { condition_description: "Running", visible_damage: "Front bumper" },
    });
    expect(form.recipient_name).toBe("Amal");
    expect(form.keys_handed_over).toBe("2");
    expect(inspectionReleaseMissingFields(form)).toEqual(["inspection_summary", "pending_action"]);
  });

  it("prints one language at a time and escapes customer-controlled fields", () => {
    const release = {
      id: "release-1",
      tenant_id: "tenant-1",
      vehicle_entry_id: "entry-1",
      claim_id: null,
      work_order_id: null,
      release_number: "VIR-2026-0001",
      status: "signed",
      entry_snapshot: {
        entry_number: "ENT-2026-0010",
        customer: { name: "<script>bad</script>" },
        vehicle: { make: "Toyota", model: "Corolla", plate_number: "1234", plate_letters: "A" },
        insurance: {},
        damage_marks: [],
      },
      form_data: {
        ...emptyInspectionReleaseForm,
        inspection_summary: "Checked", pending_action: "Approval", exit_condition: "Running",
        recipient_name: "Customer", recipient_id_number: "123", recipient_phone: "90000000",
      },
      photo_media_ids: ["photo-1"],
      declaration_ar: "إقرار عربي",
      declaration_en: "English acknowledgement",
      signature_data_url: "data:image/png;base64,aGVsbG8=",
      signer_name: "Customer",
      signed_at: "2026-10-20T10:00:00Z",
      released_at: "2026-10-20T10:00:00Z",
      returned_at: null,
    } satisfies InspectionReleaseRecord;
    const en = buildInspectionReleaseHtml(release, [{ id: "photo-1", url: "https://example.com/photo.jpg" }], "en");
    const ar = buildInspectionReleaseHtml(release, [], "ar");
    expect(en).toContain("English acknowledgement");
    expect(en).not.toContain("إقرار عربي");
    expect(ar).toContain("إقرار عربي");
    expect(ar).not.toContain("English acknowledgement");
    expect(en).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(en).not.toContain("<script>bad</script>");
    expect(en).toContain("https://example.com/photo.jpg");
  });

  it("does not misclassify historical arrivals without a signed temporary-release marker", () => {
    const claim = {
      status: "pending", delivered_at: null, workshop_arrival_date: "2026-10-01",
      vehicle_presence_status: "with_customer", temporary_inspection_release_id: null,
    } as InsuranceClaim;
    expect(getClaimVehicleLocation(claim)).toBe("in_workshop");
    expect(getClaimVehicleLocation({ ...claim, temporary_inspection_release_id: "release-1" })).toBe("with_customer");
    expect(getClaimVehicleLocation({ ...claim, temporary_inspection_release_id: "release-1", vehicle_presence_status: "in_workshop" })).toBe("in_workshop");
    expect(getClaimVehicleLocation({ ...claim, status: "cancelled", temporary_inspection_release_id: "release-1" })).toBe("cancelled");
  });
});
