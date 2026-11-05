import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getTenant:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("@/lib/cloud/createCloudStore",()=>({getCurrentTenantId:mocks.getTenant}));
import {customerPhoneEdit,defaultVehicleEntryForm,formFromVehicleEntry,saveVehicleEntry} from "@/lib/vehicleEntryService";
function editedEntry(){
  return {...defaultVehicleEntryForm(),id:"entry-1",updated_at_before_edit:"2026-11-04T10:00:00Z",entry_number:"ENT-2026-00001",customer_id:"customer-1",customer_phone_before_edit:"90000000",
    customer:{...defaultVehicleEntryForm().customer,phone:"91234567"}};
}
describe("vehicle entry customer phone sync",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.getTenant.mockResolvedValue("tenant-1");mocks.rpc.mockResolvedValue({data:{entry:{id:"entry-1",tenant_id:"tenant-1"}},error:null});});
  it("loads live customer phone and row revision rather than an old snapshot",()=>{
    const form=formFromVehicleEntry({id:"entry-1",updated_at:"2026-11-04T10:00:00Z",customer_id:"customer-1",customer_snapshot:{phone:"90000000"},customer:{phone:"+96891111111"}});
    expect(form.customer.phone).toBe("+96891111111");expect(form.customer_phone_before_edit).toBe("+96891111111");expect(customerPhoneEdit(form)).toBeNull();
    expect(form.updated_at_before_edit).toBe("2026-11-04T10:00:00Z");
  });
  it("requests a phone CAS in the same atomic save with the original raw baseline",async()=>{
    await saveVehicleEntry(editedEntry(),"user-1");expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("save_vehicle_entry_intake",expect.objectContaining({p_entry_id:"entry-1",p_expected_updated_at:"2026-11-04T10:00:00Z",
      p_form:expect.objectContaining({customer_id:"customer-1",customer_phone_changed:true,customer_phone_before_edit:"90000000",customer:expect.objectContaining({phone:"+96891234567"})})}));
  });
  it("does not normalize/overwrite the master phone while saving unrelated changes",async()=>{
    const form=editedEntry();form.customer.phone="90000000";await saveVehicleEntry(form);
    expect(mocks.rpc.mock.calls[0][1].p_form.customer_phone_changed).toBe(false);
  });
  it.each([undefined,"entry-1"])("does not treat equivalent phone formatting as a customer mutation (entry=%s)",async(id)=>{
    const form={...editedEntry(),id,customer_phone_before_edit:"91234567"};
    form.customer.phone="+96891234567";
    expect(customerPhoneEdit(form)).toBeNull();
    await saveVehicleEntry(form);
    expect(mocks.rpc.mock.calls[0][1].p_form.customer_phone_changed).toBe(false);
  });
  it("rejects a stale entry/release atomically without a misleading partial-save identity",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:"VEHICLE_INTAKE_STALE"}});
    await expect(saveVehicleEntry(editedEntry())).rejects.toBeInstanceOf(Error);
    await expect(saveVehicleEntry(editedEntry())).rejects.not.toHaveProperty("savedEntry");
  });
  it("rejects a duplicate phone rather than claiming the entry saved before the phone failed",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:"VEHICLE_INTAKE_PHONE_CONFLICT"}});
    await expect(saveVehicleEntry(editedEntry())).rejects.toThrow();
    await expect(saveVehicleEntry(editedEntry())).rejects.not.toHaveProperty("savedEntry");
  });
});
