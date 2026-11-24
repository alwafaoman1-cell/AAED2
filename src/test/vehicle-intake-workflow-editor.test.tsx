// @vitest-environment jsdom
import {act,renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({strict:true}));
vi.mock('react-router-dom',()=>({useParams:()=>({}),useSearchParams:()=>[new URLSearchParams('channel=cash&purpose=workshop')],useNavigate:()=>vi.fn()}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:undefined,isLoading:false}),useQueryClient:()=>({setQueryData:vi.fn(),invalidateQueries:vi.fn().mockResolvedValue(undefined)})}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'user'},profile:{full_name:'Receiver',tenant_id:'tenant'}})}));
vi.mock('@/hooks/useInsuranceEmployees',()=>({useInsuranceEmployees:()=>({data:[]})}));
vi.mock('@/hooks/useVehicleMakesModels',()=>({useVehicleMakes:()=>({data:[]})}));
vi.mock('@/hooks/useWorkflowRequirements',()=>({useWorkflowRequirements:()=>({requirementsEnabled:mock.strict})}));
import {useVehicleEntryEditor} from '@/hooks/useVehicleEntryEditor';
beforeEach(()=>{mock.strict=true;});
it('relaxes only the deliverer requirement and re-enables it without clearing the intake draft',()=>{
 const view=renderHook(()=>useVehicleEntryEditor());
 act(()=>{view.result.current.patchCustomer({phone:'99112233'});view.result.current.patchVehicle({plate_number:'24680',make:'Toyota'});});
 expect(view.result.current.canSave).toBe(false);
 mock.strict=false;view.rerender();
 expect(view.result.current.canSave).toBe(true);
 expect(view.result.current.form.delivered_by.full_name).toBe('');
 expect(view.result.current.form.condition.running_status).toBe('unknown');
 mock.strict=true;view.rerender();
 expect(view.result.current.canSave).toBe(false);
 expect(view.result.current.form.customer.phone).toBe('99112233');
 expect(view.result.current.form.vehicle.plate_number).toBe('24680');
});
it('keeps vehicle/customer identity and actual arrival time required when operational requirements are disabled',()=>{
 mock.strict=false;const view=renderHook(()=>useVehicleEntryEditor());
 expect(view.result.current.canSave).toBe(false);
 act(()=>{view.result.current.patchCustomer({phone:'99112233'});view.result.current.patchVehicle({plate_number:'24680',make:'Toyota'});});
 expect(view.result.current.canSave).toBe(true);
 act(()=>view.result.current.patch({arrival_time:''}));
 expect(view.result.current.canSave).toBe(false);
});
