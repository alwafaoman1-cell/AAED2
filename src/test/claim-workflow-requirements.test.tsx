// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mock=vi.hoisted(()=>({strict:true,fixture:{} as Record<string,unknown>,create:vi.fn(),readPolicy:vi.fn(),
 navigate:vi.fn(),error:vi.fn(),writeDraft:vi.fn(),params:new URLSearchParams('resumeDraft=1')}));
const tenant='00000000-0000-4000-8000-000000000101';
const customer='00000000-0000-4000-8000-000000000201';
const vehicle='00000000-0000-4000-8000-000000000301';
const company='00000000-0000-4000-8000-000000000401';
const created='00000000-0000-4000-8000-000000000501';
vi.mock('react-router-dom',()=>({useNavigate:()=>mock.navigate,useSearchParams:()=>[mock.params]}));
vi.mock('react-i18next',async importOriginal=>({...await importOriginal<typeof import('react-i18next')>(),useTranslation:()=>({t:(key:string)=>key,i18n:{language:'ar'}})}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'00000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useWorkflowRequirements',()=>({useWorkflowRequirements:()=>({requirementsEnabled:mock.strict})}));
vi.mock('@/components/WorkflowRequirementsBanner',()=>({default:()=>null}));
vi.mock('@/lib/workflowRequirements',()=>({readWorkflowRequirementPolicy:mock.readPolicy}));
vi.mock('@/hooks/useInsuranceClaims',()=>({useCreateClaim:()=>({mutateAsync:mock.create})}));
vi.mock('@/hooks/useInsuranceCompanies',()=>({useInsuranceCompanies:()=>({data:[]}),findOrCreateInsuranceCompany:vi.fn()}));
vi.mock('@/lib/cloud/createCloudStore',()=>({getCurrentTenantId:async()=> '00000000-0000-4000-8000-000000000101'}));
vi.mock('@/lib/cloudSettings',()=>({
 readCloudSetting:async()=>({savedAt:Date.now(),data:structuredClone(mock.fixture)}),
 subscribeCloudSetting:()=>()=>{},writeCloudSetting:mock.writeDraft,
}));
vi.mock('@/lib/vehicleIdentity',()=>({
 findExistingVehicle:async()=>({id:'00000000-0000-4000-8000-000000000301',customer_id:'00000000-0000-4000-8000-000000000201'}),
 ensureVehicleForCustomer:vi.fn(),
}));
vi.mock('@/lib/documentExtraction/persistence',()=>({linkDocumentFile:vi.fn()}));
vi.mock('@/lib/unsavedWork',()=>({markClean:vi.fn(),markDirty:vi.fn()}));
vi.mock('sonner',()=>({toast:{error:mock.error,info:vi.fn(),success:vi.fn(),warning:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 const q:Record<string,unknown>={};
 for(const name of ['select','eq','is','ilike','limit','neq','not'])q[name]=()=>q;
 q.maybeSingle=async()=>({data:table==='customers'?{id:'00000000-0000-4000-8000-000000000201',name:'Fixture owner',phone:'+96899112233'}:null,error:null});
 q.then=(resolve:(value:unknown)=>unknown)=>resolve({data:[],error:null});return q;
}}}));
vi.mock('@/components/insurance/InsuranceCompanyAutocomplete',()=>({default:({value,onChange}:{value:string;onChange:(value:string,id:null)=>void})=><input aria-label="Fixture insurer" value={value} onChange={e=>onChange(e.target.value,null)}/>}));
vi.mock('@/components/insurance/VehicleMakeModelPicker',()=>({default:()=> <div data-testid="fixture-vehicle-picker">Vehicle lookup fixture</div>}));
vi.mock('@/components/insurance/InsuranceEmployeeSelect',()=>({default:()=>null}));
vi.mock('@/components/insurance/UplItemsEditor',()=>({default:()=>null}));
vi.mock('@/components/customers/CustomerPhoneLookup',()=>({default:()=>null}));
vi.mock('@/components/ai/AiExtractButton',()=>({default:()=>null}));
vi.mock('@/components/ai/AiWriteButton',()=>({default:()=>null}));

import NewInsuranceClaim from '@/pages/insurance/NewInsuranceClaim';

beforeEach(()=>{
 vi.clearAllMocks();mock.strict=true;mock.params=new URLSearchParams('resumeDraft=1');
 mock.fixture={company:'Fixture insurer',companyId:company,insuranceEmployeeId:null,claimNumber:'CLM-EXCEPTION-001',
  customerId:customer,ownerName:'Fixture owner',ownerPhone:'+96899112233',expectedDeliveryDate:'',
  vehicleId:vehicle,vehicleMake:'Toyota',vehicleModel:'',vehiclePlate:'AA 1001',vehicleYear:'',vehicleColor:'',vehicleVin:'',
  incidentDate:'',damageDescription:'',estimationType:'auto',estimatedCost:'',uplItems:[],notes:''};
 mock.readPolicy.mockResolvedValue({tenant_id:tenant,requirements_enabled:false,revision:2});
 mock.writeDraft.mockResolvedValue(undefined);mock.create.mockResolvedValue({id:created});
});
afterEach(cleanup);
async function open(){render(<NewInsuranceClaim/>);await screen.findByText('مسودة محفوظة');}
function next(){fireEvent.click(screen.getByRole('button',{name:'التالي'}));}
async function review(){await open();next();await screen.findByTestId('fixture-vehicle-picker');next();next();next();await screen.findByText('مراجعة نهائية');}

describe('new claim operational requirements at the parent wizard boundary',()=>{
 it('keeps the missing vehicle model mandatory in strict mode',async()=>{
  await open();next();await screen.findByTestId('fixture-vehicle-picker');next();
  expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('الموديل'));
  expect(screen.getByTestId('fixture-vehicle-picker')).toBeVisible();
  expect(screen.queryByText('مراجعة نهائية')).not.toBeInTheDocument();expect(mock.create).not.toHaveBeenCalled();
 });
 it('allows the actual Next actions through blank model, date and estimate under the confirmed exception',async()=>{
  mock.strict=false;await review();
  expect(mock.error).not.toHaveBeenCalled();
  expect(screen.getAllByText('0.000 OMR').length).toBeGreaterThan(0);
  expect(screen.getByText(/ستُحفظ بحالة "بانتظار الاعتماد"/)).toBeVisible();
  expect(mock.create).not.toHaveBeenCalled();
 });
 it('saves zero pending with null dates and model rather than inventing an approval or repair event',async()=>{
  mock.strict=false;await review();fireEvent.click(screen.getByRole('button',{name:'حفظ وفتح المطالبة'}));
  await waitFor(()=>expect(mock.create).toHaveBeenCalledTimes(1));
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({tenant_id:tenant,customer_id:customer,vehicle_id:vehicle,
   status:'pending',estimated_amount:0,estimated_cost:0,approved_amount:0,estimate_date:null,incident_date:null,
   vehicle_model:null,workshop_arrival_date:null,work_started_at:null,workflow_requirement_revision:2}));
  await waitFor(()=>expect(mock.navigate).toHaveBeenCalledWith(`/insurance/${created}`));
 });
 it.each([['company','شركة التأمين'],['claimNumber','رقم المطالبة']])('retains %s identity under relaxed requirements',async(field,label)=>{
  mock.strict=false;mock.fixture[field]='';await open();next();
  expect(mock.error).toHaveBeenCalledWith(expect.stringContaining(label));expect(screen.queryByTestId('fixture-vehicle-picker')).not.toBeInTheDocument();
  expect(mock.create).not.toHaveBeenCalled();
 });
 it.each([['vehicleMake','الماركة'],['vehiclePlate','رقم اللوحة'],['owner','اسم المالك']])('retains %s identity at the vehicle step under relaxed requirements',async(field,label)=>{
  mock.strict=false;if(field==='owner'){mock.fixture.customerId=null;mock.fixture.ownerName='';mock.fixture.ownerPhone='';}else mock.fixture[field]='';
  await open();next();await screen.findByTestId('fixture-vehicle-picker');next();
  expect(mock.error).toHaveBeenCalledWith(expect.stringContaining(label));expect(screen.queryByText('مراجعة نهائية')).not.toBeInTheDocument();
  expect(mock.create).not.toHaveBeenCalled();
 });
 it('checks the current cloud policy before saving a formerly relaxed draft',async()=>{
  mock.strict=false;await review();mock.readPolicy.mockResolvedValue({tenant_id:tenant,requirements_enabled:true,revision:3});
  fireEvent.click(screen.getByRole('button',{name:'حفظ وفتح المطالبة'}));
  await waitFor(()=>expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('تغيّرت شروط سير العمل')));
  expect(mock.create).not.toHaveBeenCalled();expect(mock.navigate).not.toHaveBeenCalled();
 });
 it('explains a server-side restore during save and keeps the draft available to complete',async()=>{
  mock.strict=false;mock.create.mockRejectedValue(new Error('WORKFLOW_CLAIM_FORM_DETAILS_REQUIRED'));
  await review();fireEvent.click(screen.getByRole('button',{name:'حفظ وفتح المطالبة'}));
  await waitFor(()=>expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('أُعيد تفعيل الشروط أثناء الحفظ')));
  expect(mock.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'حفظ وفتح المطالبة'})).toBeEnabled();
  expect(screen.getByText('مراجعة نهائية')).toBeVisible();
 });
});
