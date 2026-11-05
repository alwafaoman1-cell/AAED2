import {beforeEach,describe,expect,it,vi} from 'vitest';
import {defaultVehicleEntryForm,formFromVehicleEntry,getVehicleVisitBillingKind,saveVehicleEntry} from '@/lib/vehicleEntryService';
import {emptyVehicleTechnicalDeclaration} from '@/lib/vehicleTechnicalDeclaration';
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('@/lib/cloud/createCloudStore',()=>({getCurrentTenantId:mock.tenant}));
beforeEach(()=>{vi.clearAllMocks();mock.tenant.mockResolvedValue('tenant');});
const form=()=>({...defaultVehicleEntryForm(),customer:{...defaultVehicleEntryForm().customer,name:'Visit customer',phone:'99112233'},vehicle:{...defaultVehicleEntryForm().vehicle,plate_number:'24680',make:'Dodge',model:'Ram'}});
describe('atomic vehicle intake save',()=>{
  it('preserves letters from a pasted legacy combined plate instead of saving a digit-only duplicate',async()=>{
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'}},error:null});
    const input=form();input.vehicle.plate_number='W 86765';input.vehicle.plate_letters='';
    await saveVehicleEntry(input);
    expect(mock.rpc.mock.calls[0][1].p_form.vehicle).toMatchObject({plate_number:'86765',plate_letters:'W',plate_country:'OM'});
  });
  it('keeps an explicitly selected insurance intake in the insurance channel before a claim is linked',()=>{
    expect(getVehicleVisitBillingKind({insurance_snapshot:{is_insurance_related:true}})).toBe('insurance');
    expect(getVehicleVisitBillingKind({insurance_snapshot:{is_insurance_related:false}})).toBe('cash');
  });
  it('sends one atomic RPC without prewriting vehicle/customer/marks or technical copies',async()=>{
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'},technical:{id:'technical',revision:1}},error:null});
    const input={...form(),technical_declaration:{form:{...emptyVehicleTechnicalDeclaration,cranking:'yes' as const},revision:null}};
    await expect(saveVehicleEntry(input)).resolves.toMatchObject({id:'entry',vehicle_technical_declaration:{id:'technical'}});
    expect(mock.rpc).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledWith('save_vehicle_entry_intake',expect.objectContaining({p_entry_id:null,p_expected_updated_at:null,p_technical:input.technical_declaration.form,p_technical_revision:null,
      p_form:expect.objectContaining({customer_phone_changed:false,customer:expect.objectContaining({phone:'+96899112233'})})}));
  });
  it('denies names alone before a request, but accepts a selected customer code',async()=>{
    const input=form();input.customer.phone='';await expect(saveVehicleEntry(input)).rejects.toThrow();expect(mock.rpc).not.toHaveBeenCalled();
    input.customer.customer_code='CUST-0042';mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'}},error:null});await expect(saveVehicleEntry(input)).resolves.toMatchObject({id:'entry'});
  });
  it('does not report success on denied/stale writes, missing technical response or wrong tenant',async()=>{
    mock.rpc.mockResolvedValue({data:null,error:{message:'VEHICLE_INTAKE_STALE'}});await expect(saveVehicleEntry(form())).rejects.toThrow();
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'another'}},error:null});await expect(saveVehicleEntry(form())).rejects.toThrow();
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'}},error:null});await expect(saveVehicleEntry({...form(),technical_declaration:{form:emptyVehicleTechnicalDeclaration,revision:null}})).rejects.toThrow();
  });
  it('hydrates and sends both entry and technical concurrency baselines and preserves hidden historical values',async()=>{
    const input=formFromVehicleEntry({id:'entry',updated_at:'2026-11-04T10:00:00Z',customer_id:'visitor',customer_snapshot:{name:'Visitor',phone:'99112233',email:'old@example.test'},vehicle_snapshot:{plate_number:'24680',engine_number:'HIST-ENGINE',transmission:'auto'},vehicle_condition:{visit_purpose:'inspection',flags:['legacy']},vehicle_technical_declaration:{form_data:{...emptyVehicleTechnicalDeclaration,cranking:'yes'},revision:7}});
    expect(input.vehicle.engine_number).toBe('HIST-ENGINE');expect(input.vehicle.transmission).toBe('auto');expect(input.customer.email).toBe('old@example.test');expect(input.condition.flags).toEqual(['legacy']);
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'},technical:{id:'technical'}},error:null});await saveVehicleEntry(input);
    expect(mock.rpc).toHaveBeenCalledWith('save_vehicle_entry_intake',expect.objectContaining({p_entry_id:'entry',p_expected_updated_at:'2026-11-04T10:00:00Z',p_technical_revision:7,p_form:expect.objectContaining({customer_phone_changed:false})}));
  });
  it('marks an explicitly edited phone and does not impersonate actor/tenant in RPC arguments',async()=>{
    mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'}},error:null});
    const input={...form(),customer_id:'visitor',customer_phone_before_edit:'99112234'};await saveVehicleEntry(input,'forged-user');
    const args=mock.rpc.mock.calls[0][1];expect(args.p_form.customer_phone_changed).toBe(true);expect(args).not.toHaveProperty('p_actor');expect(args).not.toHaveProperty('p_tenant');
  });
  it('fails closed if no current tenant',async()=>{mock.tenant.mockResolvedValue(null);await expect(saveVehicleEntry(form())).rejects.toThrow();expect(mock.rpc).not.toHaveBeenCalled();});
});
