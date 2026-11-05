import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWorkOrderInWorkshop } from "@/lib/workOrderPresence";

describe("staff app workshop presence", () => {
  it("excludes delivered and customer-held orders even when the old work status remains active", () => {
    expect(isWorkOrderInWorkshop({ status: "تحت الإصلاح", vehiclePresenceStatus: "with_customer" })).toBe(false);
    expect(isWorkOrderInWorkshop({ status: "تم التسليم", vehiclePresenceStatus: "in_workshop" })).toBe(false);
    expect(isWorkOrderInWorkshop({ status: "تحت الإصلاح", vehiclePresenceStatus: "in_workshop" })).toBe(true);
  });
  it("uses canonical visits for supervisor and the synchronized order mirror for technicians", () => {
    const supervisor = readFileSync(join(process.cwd(), "src/pages/apps/SupervisorApp.tsx"), "utf8");
    const technician = readFileSync(join(process.cwd(), "src/pages/tech/TechnicianApp.tsx"), "utf8");
    const sync = readFileSync(join(process.cwd(), "src/hooks/useRealtimeSync.ts"), "utf8");
    const projection=readFileSync(join(process.cwd(), "src/lib/supervisorWorkspace.ts"), "utf8");
    expect(supervisor).toContain("listSupervisorVisits");
    expect(projection).toContain("listVehicleVisitCenterPage");
    expect(projection).toContain("custody: getVehicleEntryPresence(entry)");
    expect(technician).toContain("isWorkOrderInWorkshop(o)");
    expect(technician).toContain("useRealtimeSync()");
    expect(supervisor).toContain("useRealtimeSync()");
    expect(supervisor).not.toContain("useStaffWorkOrderSync()");
    expect(sync).toContain('scope: "supervisor"');
    expect(technician).toContain("useStaffWorkOrderSync()");
    expect(sync).toContain('scope: "technician"');
    expect(sync).toContain('vehicle_inspection_releases: ["vehicle_visit"');
    const publication = readFileSync(join(process.cwd(), "supabase/migrations/20261103184447_vehicle_visit_realtime_publication.sql"), "utf8");
    expect(publication).toContain("'vehicle_entries', 'vehicle_handover_records', 'vehicle_inspection_releases'");
    expect(publication).toContain("c.relrowsecurity");
    expect(publication).not.toMatch(/update public\.|delete from public\./i);
  });
});
