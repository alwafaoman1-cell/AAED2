// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({strict:true,rpc:vi.fn(),single:vi.fn(),navigate:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>mock.navigate}));
vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en',dir:()=> 'ltr'}})}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({hasRole:()=>true})}));
vi.mock('@/hooks/useWorkflowRequirements',()=>({useWorkflowRequirements:()=>({requirementsEnabled:mock.strict})}));
vi.mock('sonner',()=>({toast:{success:mock.success,error:mock.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>({select:()=>({eq:()=>({single:mock.single})})})}}));
import {VehicleReviewReturnAction} from '@/components/vehicle-entry/VehicleReviewReturnAction';

beforeEach(()=>{vi.clearAllMocks();mock.strict=true;});
afterEach(cleanup);
function open(){render(<VehicleReviewReturnAction entryId="source"/>);fireEvent.click(screen.getByRole('button',{name:'Return for review'}));}
function receipt(proof:string|null){return {data:{entry_id:'new',existing:false,requirements_exception_id:proof}};}
function readBack(proof:string|null){return {data:{vehicle_snapshot:{mileage:null},custody_receipt_required:true,
 vehicle_condition:{running_status:'unknown',review_return:{source_entry_id:'source',mileage:null,
  running_status:'unknown',new_damage:null,new_damage_notes:'',requirements_exception_id:proof}}}};}

it('keeps review completeness required in strict mode and actual arrival required in exception mode',()=>{
 open();fireEvent.click(screen.getByLabelText('I confirm the vehicle has physically arrived'));
 expect(screen.getByRole('button',{name:'Register review visit'})).toBeDisabled();
 cleanup();mock.strict=false;open();
 expect(screen.getByRole('button',{name:'Register review visit'})).toBeDisabled();
 expect(mock.rpc).not.toHaveBeenCalled();
});
it('keeps blank observations unknown and requires the matching persisted exception proof',async()=>{
 mock.strict=false;mock.rpc.mockResolvedValue(receipt('proof'));mock.single.mockResolvedValue(readBack('proof'));
 open();fireEvent.click(screen.getByLabelText('I confirm the vehicle has physically arrived'));
 fireEvent.click(screen.getByRole('button',{name:'Register review visit'}));
 await waitFor(()=>expect(mock.navigate).toHaveBeenCalledWith('/vehicle-entry/new'));
 expect(mock.rpc.mock.calls[0][1]).toMatchObject({p_confirm_arrival:true,p_reason:'',p_condition:'',p_delivered_by:'',p_mileage:null,p_running_status:'unknown',p_new_damage:null});
 expect(mock.success).toHaveBeenCalled();
});
it('does not report successful relaxed creation without a matching audit proof',async()=>{
 mock.strict=false;mock.rpc.mockResolvedValue(receipt(null));mock.single.mockResolvedValue(readBack(null));
 open();fireEvent.click(screen.getByLabelText('I confirm the vehicle has physically arrived'));
 fireEvent.click(screen.getByRole('button',{name:'Register review visit'}));
 await waitFor(()=>expect(mock.error).toHaveBeenCalled());
 expect(mock.navigate).not.toHaveBeenCalled();expect(mock.success).not.toHaveBeenCalled();
});
it('never treats an invalid odometer as an omitted reading in exception mode',()=>{
 mock.strict=false;open();fireEvent.click(screen.getByLabelText('I confirm the vehicle has physically arrived'));
 fireEvent.change(screen.getByLabelText('Odometer on return (km)'),{target:{value:'-1'}});
 expect(screen.getByRole('button',{name:'Register review visit'})).toBeDisabled();
 expect(mock.rpc).not.toHaveBeenCalled();
});
