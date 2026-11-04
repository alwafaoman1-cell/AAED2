import {beforeEach,describe,expect,it,vi} from "vitest";
import {assertVehicleEntryWorkOrderLink} from "@/lib/vehicleEntryWorkOrderLink";
import {confirmVehicleEntryWorkOrderLink} from "@/lib/vehicleEntryService";
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mock.rpc}}));
vi.mock("@/lib/cloud/createCloudStore",()=>({getCurrentTenantId:mock.tenant}));
const entry={id:"entry",tenant_id:"tenant",vehicle_id:"car",insurance_claim_id:"claim",work_order_id:null,converted_work_order_id:null};
const order={id:"order",tenant_id:"tenant",vehicle_id:"car",vehicle_entry_id:null,claim_id:"claim",work_order_type:"insurance",order_number:"WO-I-26-0001"};
beforeEach(()=>{vi.clearAllMocks();mock.tenant.mockResolvedValue("tenant");});
describe("entry/work-order identity and explicit existing-only confirmation",()=>{
  it("allows a unique same-vehicle candidate without requiring the visitor to be the historical financial customer",()=>{
    expect(()=>assertVehicleEntryWorkOrderLink(entry,order)).not.toThrow();
    expect(()=>assertVehicleEntryWorkOrderLink({...entry,work_order_id:order.id},{...order,parent_work_order_id:"parent",vehicle_entry_id:entry.id})).not.toThrow();
  });
  it.each([
    {...order,vehicle_id:"another-car"},{...order,tenant_id:"another-tenant"},{...order,vehicle_entry_id:"another-visit"},
    {...order,deleted_at:"2026-11-01"},{...order,parent_work_order_id:"parent"},
  ])("rejects an unavailable or conflicting order before opening/linking it (%j)",(wrong)=>{
    expect(()=>assertVehicleEntryWorkOrderLink(entry,wrong)).toThrow();
  });
  it("rejects contradictory forward IDs and cash/insurance mixing",()=>{
    expect(()=>assertVehicleEntryWorkOrderLink({...entry,work_order_id:"other"},order)).toThrow();
    expect(()=>assertVehicleEntryWorkOrderLink({...entry,converted_claim_id:"other-claim"},order)).toThrow();
    expect(()=>assertVehicleEntryWorkOrderLink(entry,{...order,work_order_type:"general_customer"})).toThrow();
    expect(()=>assertVehicleEntryWorkOrderLink(entry,{...order,claim_id:"other-claim"})).toThrow();
  });
  it("confirms both directions from one cloud transaction and never inserts another order",async()=>{
    mock.rpc.mockResolvedValue({data:{entry:{...entry,work_order_id:order.id,converted_work_order_id:order.id},order:{...order,vehicle_entry_id:entry.id}},error:null});
    await expect(confirmVehicleEntryWorkOrderLink(entry.id,order.id,"version")).resolves.toMatchObject({existing:true,work_order_id:order.id,order_number:order.order_number});
    expect(mock.rpc).toHaveBeenCalledOnce();expect(mock.rpc).toHaveBeenCalledWith("confirm_vehicle_entry_work_order_link",{p_entry_id:entry.id,p_order_id:order.id,p_expected_updated_at:"version"});
  });
  it.each([
    null,{entry:{...entry,work_order_id:order.id,converted_work_order_id:order.id},order},
    {entry:{...entry,tenant_id:"foreign",work_order_id:order.id,converted_work_order_id:order.id},order:{...order,vehicle_entry_id:entry.id}},
    {entry:{...entry,work_order_id:order.id,converted_work_order_id:order.id},order:{...order,vehicle_id:"other-car",vehicle_entry_id:entry.id}},
  ])("does not report a partial/cross-tenant/conflicting response as success (%j)",async data=>{
    mock.rpc.mockResolvedValue({data,error:null});await expect(confirmVehicleEntryWorkOrderLink(entry.id,order.id,"version")).rejects.toThrow();
  });
  it("fails closed on stale saves, failed transport and missing tenant",async()=>{
    mock.rpc.mockResolvedValue({data:null,error:{message:"VEHICLE_ENTRY_LINK_STALE"}});await expect(confirmVehicleEntryWorkOrderLink(entry.id,order.id,"version")).rejects.toThrow();
    mock.rpc.mockRejectedValue(new Error("Failed to fetch"));await expect(confirmVehicleEntryWorkOrderLink(entry.id,order.id,"version")).rejects.toThrow("Failed to fetch");
    mock.rpc.mockClear();mock.tenant.mockResolvedValue(null);await expect(confirmVehicleEntryWorkOrderLink(entry.id,order.id,"version")).rejects.toThrow();expect(mock.rpc).not.toHaveBeenCalled();
  });
});
