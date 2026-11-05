// @vitest-environment jsdom
import {act,render,renderHook,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {useVehicleEntryEditor} from '@/hooks/useVehicleEntryEditor';
import {VehicleEntryIdentityStep} from '@/components/vehicle-entry/VehicleEntryIdentityStep';
const mock=vi.hoisted(()=>({data:undefined as any,params:{} as any,search:'channel=cash&purpose=inspection',save:vi.fn(),get:vi.fn()}));
vi.mock('react-router-dom',()=>({useParams:()=>mock.params,useSearchParams:()=>[new URLSearchParams(mock.search)],useNavigate:()=>vi.fn(),Link:({children,to}:any)=><a href={to}>{children}</a>}));
vi.mock('@/components/insurance/VehicleMakeModelPicker',()=>({default:()=>null}));
vi.mock('@/components/insurance/InsuranceCompanyAutocomplete',()=>({default:()=>null}));
vi.mock('@/components/vehicles/PlateInput',()=>({default:()=>null}));
vi.mock('@tanstack/react-query',()=>({useQuery:(o:any)=>({data:o.queryKey[0]==='vehicle_entries'?mock.data:undefined,isLoading:false}),useQueryClient:()=>({setQueryData:vi.fn(),invalidateQueries:vi.fn().mockResolvedValue(undefined)})}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'user'},profile:{full_name:'Test receiver',tenant_id:'tenant'}})}));
vi.mock('@/hooks/useInsuranceEmployees',()=>({useInsuranceEmployees:()=>({data:[]})}));
vi.mock('@/hooks/useVehicleMakesModels',()=>({useVehicleMakes:()=>({data:[]})}));
vi.mock('@/lib/vehicleVisitLifecycle',()=>({getVehicleVisitDetail:vi.fn()}));
vi.mock('@/lib/vehicleEntryService',async importOriginal=>({...await importOriginal<any>(),saveVehicleEntry:mock.save,getVehicleEntry:mock.get}));
beforeEach(()=>{vi.clearAllMocks();mock.params={};mock.data=undefined;});
describe('visit editor identity and wizard',()=>{
  it('resolves a new visitor after changing the phone without editing the previously selected customer',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.selectCustomer({id:'previous',name:'Visitor',phone:'99112233',customer_code:'CUST-0022'}));
    act(()=>result.current.patchCustomer({phone:'99223344'}));
    expect(result.current.form.customer_id).toBeNull();
    expect(result.current.form.customer.customer_code).toBe('');
    expect(result.current.form.customer_phone_before_edit).toBeUndefined();
    expect(result.current.form.delivered_by.phone).toBe('99223344');
  });
  it('keeps explicit customer identity for formatting-only phone edits and existing receipt edits',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.selectCustomer({id:'visitor',name:'Visitor',phone:'99112233',customer_code:'CUST-0022'}));
    act(()=>result.current.patchCustomer({phone:'+96899112233'}));
    expect(result.current.form.customer_id).toBe('visitor');
    expect(result.current.form.customer.customer_code).toBe('CUST-0022');
    act(()=>result.current.patch({id:'entry'}));
    act(()=>result.current.patchCustomer({phone:'99223344'}));
    expect(result.current.form.customer_id).toBe('visitor');
    expect(result.current.form.customer_phone_before_edit).toBe('99112233');
  });
  it('renders the new-entry customer step before any customer or saved entry exists',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());render(<VehicleEntryIdentityStep editor={result.current}/>);
    expect(screen.getByLabelText(/كود العميل|Customer code/)).toHaveValue('');
  });
  it('selects a vehicle without switching to its historical owner',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.selectCustomer({id:'visitor',name:'New visitor',phone:'99112233',customer_code:'CUST-0022'}));
    act(()=>result.current.selectVehicle({id:'vehicle',customer_id:'old-owner',brand:'Dodge',model:'Ram',plate_number:'24680',archived:true,customers:{name:'Old owner',phone:'99110000'}}));
    expect(result.current.form.customer_id).toBe('visitor');expect(result.current.form.customer.name).toBe('New visitor');expect(result.current.form.customer.phone).toBe('99112233');expect(result.current.form.customer.customer_code).toBe('CUST-0022');
    expect(result.current.form.delivered_by.full_name).toBe('New visitor');expect(result.current.form.vehicle_id).toBe('vehicle');
  });
  it('does not use the historical owner for customer arrival autofill',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.patchVehicle({current_owner_name:'Old owner'}));act(()=>result.current.patchCustomer({name:'Visitor',phone:'99112233'}));act(()=>result.current.chooseDeliveredBy('owner'));
    expect(result.current.form.delivered_by.full_name).toBe('Visitor');expect(result.current.form.delivered_by.phone).toBe('99112233');
  });
  it('does not rewrite delivered-by details when the plate input reports its unchanged value',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.patchCustomer({name:'Visit customer',phone:'99112233'}));
    act(()=>result.current.patchDeliveredBy({delivery_type:'owner',full_name:'Person handing over',phone:'99115566',relation:'Customer representative'}));
    const before=result.current.form.delivered_by;
    act(()=>result.current.patchVehicle({plate_number:result.current.form.vehicle.plate_number,plate_letters:result.current.form.vehicle.plate_letters}));
    expect(result.current.form.delivered_by).toEqual(before);
    act(()=>result.current.patchVehicle({make:'Dodge'}));expect(result.current.form.delivered_by).toEqual(before);
  });
  it('requires customer phone/code and retains inspection inside until an actual exit',()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());
    expect(result.current.purpose).toBe('inspection');expect(result.current.form.vehicle_location).toBe('داخل الورشة');
    act(()=>result.current.goNext());expect(result.current.step).toBe(2);
    act(()=>result.current.patchCustomer({name:'Name only'}));act(()=>result.current.patchVehicle({plate_number:'24680',make:'Dodge'}));expect(result.current.canSave).toBe(false);
    act(()=>result.current.patchCustomer({phone:'99112233'}));expect(result.current.canSave).toBe(true);
    act(()=>result.current.goNext());expect(result.current.step).toBe(3);act(()=>result.current.setTechnicalForm({...result.current.technicalForm,cranking:'yes'}));act(()=>result.current.goNext());expect(result.current.step).toBe(4);expect(result.current.form.technical_declaration?.form.cranking).toBe('yes');
  });
  it('prevents double-clicks from issuing two saves and never reports a rejected save as persisted',async()=>{
    const {result}=renderHook(()=>useVehicleEntryEditor());act(()=>result.current.selectCustomer({id:'visitor',name:'Visitor',phone:'99112233'}));act(()=>result.current.patchVehicle({plate_number:'24680',make:'Dodge'}));
    let reject:(reason:Error)=>void=()=>{};mock.save.mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
    let first:Promise<void>;let second:Promise<void>;act(()=>{first=result.current.handleSave('Issued');second=result.current.handleSave('Issued');});
    expect(mock.save).toHaveBeenCalledOnce();await act(async()=>{reject(new Error('denied'));await Promise.all([first,second]);});await waitFor(()=>expect(result.current.saving).toBe(false));expect(result.current.form.id).toBeUndefined();
  });
  it('does not overwrite unsaved inputs when media/realtime refreshes an already hydrated entry',()=>{
    mock.params={id:'entry'};mock.data={id:'entry',updated_at:'2026-11-04T10:00:00Z',vehicle_condition:{visit_purpose:'workshop'},customer_snapshot:{name:'Visitor',phone:'99112233'}};
    const {result,rerender}=renderHook(()=>useVehicleEntryEditor());
    act(()=>result.current.patchCustomer({name:'Unsaved edit'}));
    mock.data={...mock.data,updated_at:'2026-11-04T10:01:00Z'};rerender();
    expect(result.current.form.customer.name).toBe('Unsaved edit');expect(result.current.form.updated_at_before_edit).toBe('2026-11-04T10:00:00Z');
  });
  it('refreshes a pristine saved form when the canonical technical record changes elsewhere',()=>{
    mock.params={id:'entry'};mock.data={id:'entry',updated_at:'2026-11-04T10:00:00Z',vehicle_condition:{visit_purpose:'inspection'},customer_snapshot:{name:'Visitor',phone:'99112233'}};
    const {result,rerender}=renderHook(()=>useVehicleEntryEditor());
    mock.data={...mock.data,updated_at:'2026-11-04T10:01:00Z',customer_snapshot:{name:'Updated visitor',phone:'99112233'}};rerender();
    expect(result.current.form.customer.name).toBe('Updated visitor');expect(result.current.form.updated_at_before_edit).toBe('2026-11-04T10:01:00Z');
  });
});
