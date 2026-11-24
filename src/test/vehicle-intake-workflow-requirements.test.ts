import {beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:vi.fn(),policy:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('@/lib/cloud/createCloudStore',()=>({getCurrentTenantId:mock.tenant}));
vi.mock('@/lib/workflowRequirements',()=>({readWorkflowRequirementPolicy:mock.policy}));
import {defaultVehicleEntryForm,saveVehicleEntry} from '@/lib/vehicleEntryService';

const intake=()=>{
 const form=defaultVehicleEntryForm();
 return {...form,status:'Issued' as const,customer:{...form.customer,phone:'99112233'},
  vehicle:{...form.vehicle,plate_number:'24680',make:'Toyota'},
  condition:{...form.condition,visit_purpose:'workshop' as const,running_status:'unknown' as const}};
};
beforeEach(()=>{
 vi.clearAllMocks();mock.tenant.mockResolvedValue('tenant');
 mock.policy.mockResolvedValue({tenant_id:'tenant',requirements_enabled:true,revision:0});
 mock.rpc.mockResolvedValue({data:{entry:{id:'entry',tenant_id:'tenant'}},error:null});
});
describe('intake workflow requirement policy',()=>{
 it('keeps the new issued intake running observation required when strict or unavailable',async()=>{
  await expect(saveVehicleEntry(intake())).rejects.toThrow();
  mock.policy.mockRejectedValueOnce(new Error('offline'));
  await expect(saveVehicleEntry(intake())).rejects.toThrow();
  expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('saves an unknown observation without inventing a running state or signature when explicitly relaxed',async()=>{
  mock.policy.mockResolvedValue({tenant_id:'tenant',requirements_enabled:false,revision:2});
  await expect(saveVehicleEntry(intake())).resolves.toMatchObject({id:'entry'});
  expect(mock.policy).toHaveBeenCalledWith('tenant');
  const payload=mock.rpc.mock.calls[0][1].p_form;
  expect(payload.condition.running_status).toBe('unknown');
  expect(payload.delivered_by.full_name).toBe('');
  expect(payload).not.toHaveProperty('signature_data_url');
  expect(mock.rpc.mock.calls[0][0]).toBe('save_vehicle_entry_intake');
 });
 it('does not relax customer identity or a tenant switch while the policy read is in flight',async()=>{
  mock.policy.mockResolvedValue({tenant_id:'tenant',requirements_enabled:false,revision:2});
  const form=intake();form.customer.phone='';
  await expect(saveVehicleEntry(form)).rejects.toThrow();
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.tenant.mockResolvedValueOnce('tenant').mockResolvedValue('another');
  await expect(saveVehicleEntry(intake())).rejects.toThrow();
  expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('keeps legacy unknown observations editable without retroactively requiring an exception',async()=>{
  await expect(saveVehicleEntry({...intake(),id:'entry'})).resolves.toMatchObject({id:'entry'});
  expect(mock.policy).not.toHaveBeenCalled();
 });
});
