import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const OWNER = "20000000-0000-4000-8000-000000000001";
const VISITOR = "20000000-0000-4000-8000-000000000002";
const VEHICLE = "30000000-0000-4000-8000-000000000001";
const CLAIM = "40000000-0000-4000-8000-000000000001";

describe("claim draft JSON state", () => {
  it("round-trips a cleared draft without SQL null or a resumable timestamp", async () => {
    const { createEmptyClaimDraft } = await import("@/lib/insurance/claimPayloadService");
    const blank = { customerId: null, claimNumber: "", ownerPhone: "" };
    const value = createEmptyClaimDraft(blank);
    expect(JSON.parse(JSON.stringify(value))).toEqual({ savedAt: 0, data: blank });
    expect(value).not.toBeNull();
    expect(Boolean(value.savedAt)).toBe(false);
    expect(blank).toEqual({ customerId: null, claimNumber: "", ownerPhone: "" });
  });
});

const cloud = vi.hoisted(() => ({
  tenant: "",
  tables: {} as Record<string, Record<string, any>[]>,
  writes: [] as Array<{ table: string; operation: string; payload: Record<string, any>; filters: Array<[string, any]> }>,
  queries: [] as Array<{ table: string; filters: Array<[string, any]> }>,
  rpcRows: null as null | Record<string, any>[],
  rpcError: null as any,
  readError: null as any,
  insertError: null as any,
  vehicleUpdateDenied: false,
  beforeUpdate: null as null | (() => void),
  afterRead: null as null | (() => void),
  tenantContext: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: cloud.tenantContext }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string, args: Record<string, string>) => ({
      data: name === "next_vehicle_entry_number" ? "ENT-2026-TEST" : cloud.rpcRows ?? cloud.tables.vehicles.filter((row) => row.tenant_id === cloud.tenant &&
        row.plate_letters === args.p_letters && row.plate_number === args.p_digits && row.plate_country === args.p_country),
      error: cloud.rpcError,
    })),
    from: (table: string) => {
      const filters: Array<[string, any]> = [];
      let operation = "read";
      let payload: Record<string, any> = {};
      let vin = "";
      let maximum = Infinity;
      const execute = async (single: boolean) => {
        cloud.queries.push({ table, filters: [...filters] });
        if (operation === "read" && cloud.readError) return { data: null, error: cloud.readError };
        if (table === "vehicles" && operation === "update" && cloud.vehicleUpdateDenied) {
          throw new Error("vehicles_update_not_permitted");
        }
        if (operation === "update") cloud.beforeUpdate?.();
        const matches = (row: Record<string, any>) => filters.every(([key, value]) =>
          (row[key] ?? null) === value) && (!vin || row.vin === vin || row.vin_number === vin);
        let rows = (cloud.tables[table] || []).filter(matches).slice(0, maximum);
        if (operation !== "read") {
          cloud.writes.push({ table, operation, payload: { ...payload }, filters: [...filters] });
          if (operation === "insert") {
            if (cloud.insertError) return { data: null, error: cloud.insertError };
            rows = [{ ...payload, id: "30000000-0000-4000-8000-000000000009" }];
            cloud.tables[table].push(...rows);
          } else {
            rows.forEach((row) => Object.assign(row, payload));
          }
        }
        const data = structuredClone(single ? rows[0] || null : rows);
        cloud.afterRead?.();
        return { data, error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => { filters.push([key, value]); return query; },
        is: (key: string, value: any) => { filters.push([key, value]); return query; },
        ilike: (key: string, value: string) => {
          // Claim-number fixtures are already canonical; comparisons are exact here.
          filters.push([key, value]); return query;
        },
        or: (filter: string) => { vin = filter.split(",")[0].split(".eq.")[1]; return query; },
        limit: (value: number) => { maximum = value; return query; },
        update: (value: Record<string, any>) => { operation = "update"; payload = value; return query; },
        delete: () => { operation = "delete"; return query; },
        insert: (value: Record<string, any>) => { operation = "insert"; payload = value; return query; },
        maybeSingle: () => execute(true),
        single: () => execute(true),
        then: (resolve: (value: any) => unknown, reject: (reason: any) => unknown) => execute(false).then(resolve, reject),
      };
      return query;
    },
  },
}));

import { ensureVehicleForCustomer, ensureVehicleForVisit, findExistingVehicle, normalizeVehiclePlate } from "@/lib/vehicleIdentity";
import { createClaimInCloud, prepareClaimPayload } from "@/lib/insurance/claimPayloadService";
import { resolveClaimVehicleForWorkOrder } from "@/lib/claimVehicleResolver";
import { defaultVehicleEntryForm, saveVehicleEntry } from "@/lib/vehicleEntryService";

const visit = (overrides: Record<string, any> = {}) => ({
  customerId: VISITOR, plate: "AA 1234", make: "Toyota", confirmedNewVisit: true, ...overrides,
});
const claimInput = () => ({
  tenant_id: TENANT, customer_id: VISITOR, vehicle_id: VEHICLE, claim_number: "CLM-NEW", vehicle_plate: "AA 1234",
});

beforeEach(() => {
  vi.clearAllMocks();
  cloud.tenant = TENANT;
  cloud.tenantContext.mockImplementation(async () => cloud.tenant);
  cloud.tables = {
    customers: [{ id: OWNER, tenant_id: TENANT }, { id: VISITOR, tenant_id: TENANT }],
    vehicles: [{
      id: VEHICLE, tenant_id: TENANT, customer_id: OWNER, plate_letters: "AA", plate_number: "1234", plate_country: "OM",
      brand: "Toyota", model: "Camry", vin: "VIN123", vin_number: "VIN123", archived: false, deleted_at: null,
      customers: { name: "Historical owner", phone: "+96890000001" },
    }],
    insurance_claims: [],
    vehicle_entries: [],
    vehicle_entry_damage_marks: [],
    vehicle_entry_audit_logs: [],
    job_orders: [{ id: "historical-order", customer_id: OWNER, vehicle_id: VEHICLE }],
    invoices: [{ id: "historical-invoice", customer_id: OWNER, vehicle_id: VEHICLE }],
  };
  cloud.writes = [];
  cloud.queries = [];
  cloud.rpcRows = cloud.rpcError = cloud.readError = cloud.insertError = null;
  cloud.beforeUpdate = cloud.afterRead = null;
  cloud.vehicleUpdateDenied = false;
});

describe("new entry archived vehicle regression", () => {
  function newEntry() {
    const form = defaultVehicleEntryForm();
    form.customer_id = VISITOR;
    form.vehicle_id = VEHICLE;
    form.vehicle.plate_number = "1234";
    form.vehicle.plate_letters = "AA";
    form.vehicle.plate_country = "OM";
    form.vehicle.make = "Toyota";
    form.vehicle.model = "Camry";
    form.delivered_by.full_name = "Visit customer";
    return form;
  }

  it.each(["Draft", "Issued"] as const)("saves a %s entry using the archived vehicle and current visitor without registry updates", async (status) => {
    const form = newEntry();
    form.status = status;
    Object.assign(cloud.tables.vehicles[0], { archived: true, archived_at: "2026-10-01" });
    cloud.vehicleUpdateDenied = true;
    const before = structuredClone(cloud.tables.vehicles);
    const saved = await saveVehicleEntry(form);
    expect(saved).toMatchObject({ vehicle_id: VEHICLE, customer_id: VISITOR, status });
    expect(cloud.tables.vehicle_entries).toHaveLength(1);
    expect(cloud.tables.vehicles).toEqual(before);
    expect(cloud.writes.filter((write) => write.table === "vehicles")).toEqual([]);
    expect(cloud.tables.job_orders).toHaveLength(1);
    expect(cloud.tables.insurance_claims).toEqual([]);
    expect(cloud.tables.invoices).toHaveLength(1);
  });

  it("also resolves an archived full plate when it was typed instead of selected", async () => {
    const form = newEntry();
    form.vehicle_id = "";
    form.vehicle.plate_number = "AA 1234";
    form.vehicle.plate_letters = "";
    cloud.tables.vehicles[0].archived = true;
    const saved = await saveVehicleEntry(form);
    expect(saved.vehicle_id).toBe(VEHICLE);
    expect(cloud.tables.vehicles).toHaveLength(1);
    expect(cloud.writes.filter((write) => write.table === "vehicles")).toEqual([]);
  });

  it("never changes the archive or owner if the entry insert is rejected", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.insertError = { code: "23505", message: "duplicate visit" };
    const before = structuredClone(cloud.tables.vehicles);
    await expect(saveVehicleEntry(newEntry())).rejects.toMatchObject({ code: "23505" });
    expect(cloud.tables.vehicle_entries).toEqual([]);
    expect(cloud.tables.vehicles).toEqual(before);
    expect(cloud.writes.filter((write) => write.table === "vehicles")).toEqual([]);
  });

  it.each(["deleted", "foreign tenant", "missing customer"])("rejects %s before writing an entry", async (reason) => {
    cloud.tables.vehicles[0].archived = true;
    if (reason === "deleted") cloud.tables.vehicles[0].deleted_at = "2026-10-01";
    if (reason === "foreign tenant") cloud.tables.vehicles[0].tenant_id = OTHER_TENANT;
    if (reason === "missing customer") cloud.tables.customers = cloud.tables.customers.filter((customer) => customer.id !== VISITOR);
    await expect(saveVehicleEntry(newEntry())).rejects.toThrow();
    expect(cloud.tables.vehicle_entries).toEqual([]);
    expect(cloud.writes).toEqual([]);
  });

  it("does not reuse the new-visit permission to reactivate a historical edit", async () => {
    const form = newEntry();
    form.id = "50000000-0000-4000-8000-000000000001";
    cloud.tables.vehicle_entries.push({ id: form.id, tenant_id: TENANT, vehicle_location: form.vehicle_location });
    cloud.tables.vehicles[0].archived = true;
    await expect(saveVehicleEntry(form)).rejects.toThrow("archived_vehicle_requires_confirmation");
    expect(cloud.writes).toEqual([]);
  });
});

describe("operational visit vehicle identity", () => {
  it("reuses the unique plate for another customer without modifying ownership, identity or history", async () => {
    const before = structuredClone(cloud.tables);
    const input = visit({ make: "Changed make", model: "Changed model", vin: "DIFFERENTVIN" });
    const result = await ensureVehicleForVisit(input);
    expect(result).toMatchObject({ vehicleId: VEHICLE, created: false, ownershipConflict: true, reactivated: false });
    expect(input.customerId).toBe(VISITOR);
    expect(result.existing?.customer_id).toBe(OWNER);
    expect(cloud.tables).toEqual(before);
    expect(cloud.writes).toEqual([]);
  });

  it("does not fill an unowned vehicle's customer_id from a new visitor", async () => {
    cloud.tables.vehicles[0].customer_id = null;
    await ensureVehicleForVisit(visit());
    expect(cloud.tables.vehicles[0].customer_id).toBeNull();
    expect(cloud.writes).toEqual([]);
  });

  it("leaves archives unchanged on search and denied/unconfirmed saves", async () => {
    cloud.tables.vehicles[0].archived = true;
    expect(await findExistingVehicle({ plate: "AA 1234", reactivateArchived: true })).toMatchObject({ archived: true, deleted: false });
    await expect(ensureVehicleForVisit(visit({ confirmedNewVisit: false }))).rejects.toThrow("new_visit_requires_confirmation");
    await expect(ensureVehicleForCustomer({ customerId: OWNER, plate: "AA 1234" })).rejects.toThrow("archived_vehicle_requires_confirmation");
    expect(cloud.writes).toEqual([]);
  });

  it("resolves an archive without prewriting it; reactivation is pending the committed NEW operation", async () => {
    Object.assign(cloud.tables.vehicles[0], { archived: true, archived_at: "2026-10-01", archived_reason: "delivered" });
    const result = await ensureVehicleForVisit(visit());
    expect(result).toMatchObject({ vehicleId: VEHICLE, reactivated: false, pendingReactivation: true, created: false });
    expect(cloud.writes).toEqual([]);
    expect(cloud.tables.vehicles[0]).toMatchObject({ archived: true, archived_at: "2026-10-01", archived_reason: "delivered" });
    expect(cloud.tables.vehicles[0].customer_id).toBe(OWNER);
  });

  it.each([false, true])("denies soft-deleted records independently of archival state (%s)", async (archived) => {
    Object.assign(cloud.tables.vehicles[0], { archived, deleted_at: "2026-10-01" });
    expect(await findExistingVehicle({ plate: "AA 1234" })).toMatchObject({ deleted: true, archived });
    await expect(ensureVehicleForVisit(visit())).rejects.toThrow("deleted_vehicle_requires_restore");
    await expect(ensureVehicleForCustomer({ customerId: OWNER, plate: "AA 1234", reactivateArchived: true })).rejects.toThrow("deleted_vehicle_requires_restore");
    expect(cloud.writes).toEqual([]);
  });

  it("denies a concurrent soft delete during the final tenant-scoped read without any UPDATE", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.afterRead = () => {
      if (cloud.queries.filter((query) => query.table === "vehicles").length === 1) cloud.tables.vehicles[0].deleted_at = "2026-11-04";
    };
    await expect(ensureVehicleForVisit(visit())).rejects.toThrow("deleted_vehicle_requires_restore");
    expect(cloud.tables.vehicles[0]).toMatchObject({ archived: true, deleted_at: "2026-11-04", customer_id: OWNER });
    expect(cloud.writes).toEqual([]);
  });

  it.each(["insurance", "supervisor"])("can resolve an archived vehicle when %s has no registry UPDATE permission", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.vehicleUpdateDenied = true;
    expect(await ensureVehicleForVisit(visit())).toMatchObject({ vehicleId: VEHICLE, reactivated: false, pendingReactivation: true });
    expect(cloud.writes).toEqual([]);
    expect(cloud.tables.vehicles[0].archived).toBe(true);
  });

  it("keeps the default customer/admin path strict without explicit flags", async () => {
    await expect(ensureVehicleForCustomer({ customerId: VISITOR, plate: "AA 1234" })).rejects.toThrow("موجودة مسبقًا");
    expect(cloud.writes).toEqual([]);
    await ensureVehicleForCustomer({ customerId: OWNER, plate: "AA 1234", make: "Lexus" });
    expect(cloud.writes[0].payload).toEqual({ brand: "Lexus" });
  });

  it("requires VIN-only confirmation and never rewrites the canonical plate on reuse", async () => {
    await expect(ensureVehicleForVisit(visit({ plate: "BB 5678", vin: "VIN123" }))).rejects.toThrow("vin_candidate_requires_user_confirmation");
    const result = await ensureVehicleForVisit(visit({ plate: "BB 5678", vin: "VIN123", allowVinCandidate: true }));
    expect(result).toMatchObject({ vehicleId: VEHICLE, created: false });
    expect(cloud.tables.vehicles[0].plate_letters).toBe("AA");
    expect(cloud.writes).toEqual([]);
  });

  it.each([{ plate: "BB 1234" }, { plateCountry: "AE" }])("does not match by digits alone or ignore country (%j)", async (overrides) => {
    const result = await ensureVehicleForVisit(visit(overrides));
    expect(result.created).toBe(true);
    expect(result.vehicleId).not.toBe(VEHICLE);
    expect(cloud.writes).toHaveLength(1);
  });

  it("denies new records with incomplete plate identity", async () => {
    await expect(ensureVehicleForVisit(visit({ plate: "1234" }))).rejects.toThrow("vehicle_plate_letters_required");
    expect(cloud.writes).toEqual([]);
  });

  it("rejects an explicit foreign-tenant vehicle instead of falling back to plate/create", async () => {
    cloud.tables.vehicles[0].tenant_id = OTHER_TENANT;
    await expect(ensureVehicleForVisit(visit({ vehicleId: VEHICLE }))).rejects.toThrow("selected_vehicle_unavailable");
    expect(cloud.writes).toEqual([]);
  });

  it("never returns an unverified RPC row when a tenant-scoped detail read is empty", async () => {
    cloud.rpcRows = [{ ...cloud.tables.vehicles[0], tenant_id: OTHER_TENANT }];
    cloud.tables.vehicles = [];
    await expect(findExistingVehicle({ plate: "AA 1234" })).rejects.toThrow("selected_vehicle_unavailable");
    expect(cloud.writes).toEqual([]);
  });

  it("rejects a foreign/deleted selected customer before touching vehicles", async () => {
    cloud.tables.customers[1].tenant_id = OTHER_TENANT;
    await expect(ensureVehicleForVisit(visit())).rejects.toThrow("selected_customer_unavailable");
    expect(cloud.queries.map((query) => query.table)).toEqual(["customers"]);
    expect(cloud.writes).toEqual([]);
  });

  it("does not write if the tenant changes during identity resolution", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.afterRead = () => { cloud.tenant = OTHER_TENANT; };
    await expect(ensureVehicleForVisit(visit({ vehicleId: VEHICLE }))).rejects.toThrow("vehicle_tenant_changed");
    expect(cloud.writes).toEqual([]);
  });

  it("fails closed on lookup errors rather than creating a duplicate", async () => {
    cloud.rpcError = new Error("lookup unavailable");
    await expect(ensureVehicleForVisit(visit())).rejects.toThrow("lookup unavailable");
    expect(cloud.writes).toEqual([]);
  });

  it("fails closed on ambiguous plate and VIN matches", async () => {
    cloud.rpcRows = [cloud.tables.vehicles[0], cloud.tables.vehicles[0]];
    await expect(ensureVehicleForVisit(visit())).rejects.toThrow("ambiguous_vehicle_identity");
    cloud.rpcRows = [];
    cloud.tables.vehicles.push({ ...cloud.tables.vehicles[0], id: "another-id" });
    await expect(ensureVehicleForVisit(visit({ plate: "BB 5678", vin: "VIN123" }))).rejects.toThrow("ambiguous_vehicle_identity");
    expect(cloud.writes).toEqual([]);
  });

  it("does not retry duplicate insertion or report it as a successful new vehicle", async () => {
    cloud.insertError = { code: "23505", message: "duplicate key" };
    await expect(ensureVehicleForVisit(visit({ plate: "BB 5678" }))).rejects.toThrow("موجودة مسبقًا");
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.tables.vehicles).toHaveLength(1);
  });
});

describe("new insurance operation callers", () => {
  it("creates and verifies the claim with its selected customer when the registry owner is deleted",async()=>{
    cloud.tables.customers[0].deleted_at="2026-10-01";
    const result=await createClaimInCloud(claimInput());
    expect(result).toMatchObject({customer_id:VISITOR,vehicle_id:VEHICLE,tenant_id:TENANT});
    expect(cloud.writes).toHaveLength(1);expect(cloud.writes[0]).toMatchObject({table:"insurance_claims",operation:"insert",payload:{customer_id:VISITOR}});
    expect(cloud.tables.vehicles[0].customer_id).toBe(OWNER);expect(cloud.tables.customers[0].deleted_at).toBe("2026-10-01");
  });
  it("does not report success or retry creation if cloud readback changes the selected customer",async()=>{
    cloud.afterRead=()=>{if(cloud.tables.insurance_claims.length)cloud.tables.insurance_claims[0].customer_id=OWNER;};
    await expect(createClaimInCloud(claimInput())).rejects.toThrow("could not be read back");
    expect(cloud.writes.filter(w=>w.table==="insurance_claims"&&w.operation==="insert")).toHaveLength(1);
  });
  it("never switches a valid selected customer to the vehicle's deleted historical owner", async () => {
    cloud.tables.customers[0].deleted_at="2026-10-01";
    const before=structuredClone(cloud.tables);
    const payload=await prepareClaimPayload(claimInput());
    expect(payload.customer_id).toBe(VISITOR);
    expect(cloud.tables).toEqual(before);expect(cloud.writes).toEqual([]);
  });
  it("still denies a deleted selected customer; it must not substitute the vehicle owner", async () => {
    cloud.tables.customers[1].deleted_at="2026-10-01";
    await expect(prepareClaimPayload(claimInput())).rejects.toThrow("العميل غير موجود في Supabase");
    expect(cloud.writes).toEqual([]);
  });
  it("retains plate letters when a legacy importer puts the full plate in plateNumber", () => {
    expect(normalizeVehiclePlate({plateNumber:"W 86765",plateLetters:"",plateCountry:"OM"})).toEqual({letters:"W",digits:"86765",country:"OM"});
    expect(normalizeVehiclePlate({plateNumber:"9707",plateLetters:"MS",plateCountry:"OM"})).toEqual({letters:"MS",digits:"9707",country:"OM"});
  });
  it("keeps the selected claim customer even when the vehicle has a different historical owner", async () => {
    const before = structuredClone(cloud.tables);
    const payload = await prepareClaimPayload(claimInput());
    expect(payload).toMatchObject({ customer_id: VISITOR, vehicle_id: VEHICLE });
    expect(cloud.tables).toEqual(before);
    expect(cloud.writes).toEqual([]);
  });

  it("reuses archived vehicles for final claim save, but denies soft deletion", async () => {
    cloud.tables.vehicles[0].archived = true;
    expect(await prepareClaimPayload(claimInput())).toMatchObject({ customer_id: VISITOR, vehicle_id: VEHICLE });
    expect(cloud.tables.vehicles[0].archived).toBe(true);
    expect(cloud.writes).toEqual([]);
    cloud.writes = [];
    cloud.tables.vehicles[0].deleted_at = "2026-10-01";
    await expect(prepareClaimPayload(claimInput())).rejects.toThrow("deleted_vehicle_requires_restore");
    expect(cloud.writes).toEqual([]);
  });

  it("does not reactivate archives when the claim number already exists", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.tables.insurance_claims.push({ id: CLAIM, tenant_id: TENANT, claim_number: "CLM-NEW" });
    await expect(prepareClaimPayload(claimInput())).rejects.toThrow("claim_number_exists");
    expect(cloud.writes).toEqual([]);
  });

  it("rejects a payload for a different tenant", async () => {
    await expect(prepareClaimPayload({ ...claimInput(), tenant_id: OTHER_TENANT })).rejects.toThrow("vehicle_tenant_changed");
    expect(cloud.writes).toEqual([]);
  });

  it("links a previously unlinked claim without assigning ownership of an unowned vehicle", async () => {
    cloud.tables.vehicles[0].customer_id = null;
    cloud.tables.insurance_claims.push({ id: CLAIM, tenant_id: TENANT, customer_id: VISITOR, vehicle_id: null });
    expect(await resolveClaimVehicleForWorkOrder({ claimId: CLAIM, customerId: VISITOR, plate: "AA 1234", confirmedNewVisit: true })).toBe(VEHICLE);
    expect(cloud.tables.vehicles[0].customer_id).toBeNull();
    expect(cloud.writes).toEqual([{
      table: "insurance_claims", operation: "update", payload: { vehicle_id: VEHICLE },
      filters: [["tenant_id", TENANT], ["id", CLAIM], ["deleted_at", null], ["vehicle_id", null]],
    }]);
  });

  it("does not reactivate a vehicle during ordinary claim approval/resolution", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.tables.insurance_claims.push({ id: CLAIM, tenant_id: TENANT, customer_id: VISITOR, vehicle_id: VEHICLE });
    await expect(resolveClaimVehicleForWorkOrder({ claimId: CLAIM, customerId: VISITOR, vehicleId: VEHICLE })).rejects.toThrow("archived_vehicle_requires_confirmation");
    expect(cloud.writes).toEqual([]);
    expect(await resolveClaimVehicleForWorkOrder({ claimId: CLAIM, customerId: VISITOR, vehicleId: VEHICLE, confirmedNewVisit: true })).toBe(VEHICLE);
    expect(cloud.writes).toEqual([]);
    expect(cloud.tables.vehicles[0].archived).toBe(true);
  });

  it("allows an independent visitor without rewriting an existing claim's insurance financial customer", async () => {
    cloud.tables.insurance_claims.push({ id: CLAIM, tenant_id: TENANT, customer_id: OWNER, vehicle_id: VEHICLE });
    expect(await resolveClaimVehicleForWorkOrder({ claimId: CLAIM, customerId: VISITOR, vehicleId: VEHICLE, confirmedNewVisit: true })).toBe(VEHICLE);
    expect(cloud.tables.insurance_claims[0].customer_id).toBe(OWNER);
    expect(cloud.writes).toEqual([]);
  });

  it("denies foreign/deleted claims before resolving or reactivating their vehicle", async () => {
    cloud.tables.vehicles[0].archived = true;
    cloud.tables.insurance_claims.push({ id: CLAIM, tenant_id: OTHER_TENANT, customer_id: VISITOR, vehicle_id: VEHICLE });
    await expect(resolveClaimVehicleForWorkOrder({ claimId: CLAIM, customerId: VISITOR, vehicleId: VEHICLE, confirmedNewVisit: true })).rejects.toThrow("selected_claim_unavailable");
    expect(cloud.writes).toEqual([]);
  });
});
