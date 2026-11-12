// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import i18n from '@/i18n';
const mocks=vi.hoisted(()=>({role:true,changed:vi.fn(),detail:vi.fn(),returned:vi.fn(),arrival:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({hasRole:()=>mocks.role})}));
vi.mock('@/lib/vehicleVisitLifecycle',async original=>({...await original<object>(),getVehicleVisitDetail:mocks.detail,registerVehicleVisitArrival:mocks.arrival}));
vi.mock('@/lib/vehicleInspectionRelease',async original=>({...await original<object>(),markInspectionVehicleReturned:mocks.returned}));
vi.mock('@/pages/vehicle-entry/VehicleInspectionReleasePage',()=>({default:()=> <div>Canonical temporary release form</div>}));
import {VehicleVisitLocationPanel} from '@/components/vehicle-entry/VehicleVisitLocationPanel';
const inside:any={entry:{id:'entry',vehicle_id:'vehicle',vehicle_location:'داخل الورشة'},stage:'arrived',operationalStage:'arrived',reviewReason:null,hasFinalHandover:false,releases:[]};
function show(visit=inside){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><VehicleVisitLocationPanel visit={visit} onChanged={mocks.changed}/></QueryClientProvider>);}
beforeEach(async()=>{vi.clearAllMocks();mocks.role=true;mocks.changed.mockResolvedValue(undefined);await i18n.changeLanguage('en');});
describe('canonical location choices',()=>{
 it('opens the release document instead of directly changing custody when With customer is selected',async()=>{
  show();fireEvent.click(screen.getByRole('button',{name:'Inspection and temporary release'}));await screen.findByText('Canonical temporary release form');
  expect(mocks.returned).not.toHaveBeenCalled();expect(mocks.arrival).not.toHaveBeenCalled();expect(mocks.changed).not.toHaveBeenCalled();
 });
 it('requires physical arrival confirmation and cloud readback before a temporary-release return',async()=>{
  const outside={...inside,entry:{...inside.entry,vehicle_location:'مع العميل'},hasSignedTemporaryRelease:true,releases:[{id:'release',status:'signed',returned_at:null}]};
  mocks.detail.mockResolvedValueOnce(outside).mockResolvedValueOnce({...inside,releases:[{id:'release',status:'signed',returned_at:'2026-11-08T12:00:00Z'}]});
  mocks.returned.mockResolvedValue({returned_at:'2026-11-08T12:00:00Z'});show(outside);
  fireEvent.click(screen.getByRole('button',{name:'In workshop'}));
  const save=screen.getByRole('button',{name:'Register actual workshop arrival'});expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByLabelText('I confirm the vehicle has physically arrived'));fireEvent.click(save);
  await waitFor(()=>expect(mocks.returned).toHaveBeenCalledWith('release'));await waitFor(()=>expect(mocks.changed).toHaveBeenCalledTimes(1));
 });
 it('does not offer a writable custody choice to an unauthorized role',()=>{
  mocks.role=false;show();expect(screen.getByRole('button',{name:/With customer/}).hasAttribute('disabled')).toBe(true);
  expect(mocks.arrival).not.toHaveBeenCalled();expect(mocks.returned).not.toHaveBeenCalled();
 });
});
