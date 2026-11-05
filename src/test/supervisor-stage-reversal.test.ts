import {describe,expect,it} from "vitest";
import {getVehicleVisitReverseBlocker,type VehicleVisitItem} from "@/lib/vehicleVisitLifecycle";
const visit=(entry:Record<string,unknown>,handover=false):VehicleVisitItem=>({entry:{id:"entry",vehicle_id:"vehicle",vehicle_location:"داخل الورشة",...entry},workflow:null,stage:"in_progress",operationalStage:"in_progress",reviewReason:null,hasFinalHandover:handover});
describe("source-first visit reversal guidance",()=>{
  it("does not let a stage reversal conceal a recorded work start even if status alone was edited",()=>{
    expect(getVehicleVisitReverseBlocker("approved",visit({work_order:{status:"inspection",work_started_at:"2026-11-05T08:00:00Z"}}))).toBe("reverseSourceFirst");
  });
  it("permits reversal when no later source evidence remains, leaving permissions and reason to the RPC",()=>{
    expect(getVehicleVisitReverseBlocker("approved",visit({work_order:{status:"inspection"}}))).toBeNull();
  });
  it("preserves claim approval, completion and final handover evidence",()=>{
    expect(getVehicleVisitReverseBlocker("arrived",visit({claim:{status:"approved",vehicle_id:"vehicle"}}))).toBe("reverseSourceFirst");
    expect(getVehicleVisitReverseBlocker("in_progress",visit({work_order:{status:"completed"}}))).toBe("reverseSourceFirst");
    expect(getVehicleVisitReverseBlocker("ready",visit({work_order:{status:"delivered"}},true))).toBe("reverseSourceFirst");
  });
});
