// @vitest-environment jsdom
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import i18n from '@/i18n';
const mocks=vi.hoisted(()=>({save:vi.fn(),load:vi.fn(),prepare:vi.fn(),paper:vi.fn(),success:vi.fn(),error:vi.fn(),presence:'in_workshop'}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({profile:{tenant_id:'tenant',full_name:'QA supervisor'},user:{id:'staff'}})}));
vi.mock('@/lib/vehicleEntryService',()=>({getVehicleEntry:async()=>({id:'entry',tenant_id:'tenant',status:'Issued',entry_number:'QA-ENTRY',customer_snapshot:{name:'Visit customer',id_number:'QA-ID',phone:'80000119'},vehicle_snapshot:{make:'Synthetic'},vehicle_media:[]}),getVehicleEntryPresence:()=>mocks.presence}));
vi.mock('@/lib/pdfGenerator',()=>({getTemplateSettingsAsync:vi.fn()}));
vi.mock('@/lib/messaging/messagingService',()=>({openWhatsAppDraft:vi.fn()}));
vi.mock('@/lib/messaging/vehicleVisitMessages',()=>({prepareVehicleVisitMessage:mocks.prepare}));
vi.mock('@/components/supervisor/SupervisorVisitMessages',()=>({default:()=><div>Recorded messages panel</div>}));
vi.mock('@/lib/vehicleInspectionRelease',async original=>({...await original<object>(),getInspectionRelease:mocks.load,listInspectionReleases:async()=>[],saveInspectionRelease:mocks.save,finalizeInspectionReleasePaper:mocks.paper}));
import Page from '@/pages/vehicle-entry/VehicleInspectionReleasePage';
const form={inspection_summary:'Visual inspection only',pending_action:'Awaiting customer decision',exit_condition:'Driving condition not tested',recipient_name:'Visit customer',recipient_id_number:'QA-ID',recipient_phone:'80000119'};
const record={id:'release',tenant_id:'tenant',vehicle_entry_id:'entry',release_number:'QA-TEMP',status:'draft',form_data:form};
async function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={client}><MemoryRouter><Page workspace="supervisor" entryId="entry"/></MemoryRouter></QueryClientProvider>);await screen.findByRole('button',{name:'Visual inspection only'});fireEvent.click(screen.getByRole('button',{name:'Visual inspection only'}));fireEvent.click(screen.getByRole('button',{name:'Awaiting customer decision'}));fireEvent.click(screen.getByRole('button',{name:'Driving condition not tested'}));return client;}
beforeEach(async()=>{vi.clearAllMocks();mocks.presence='in_workshop';mocks.load.mockResolvedValue(null);await i18n.changeLanguage('en');});
describe('supervisor temporary release cloud confirmation',()=>{
  it('requires retained paper confirmation and verifies the saved exit before announcing success',async()=>{
    const draft={...record,updated_at:'2026-11-08T09:00:00Z'};
    mocks.save.mockResolvedValue(draft);mocks.paper.mockImplementation(async()=>{mocks.presence='with_customer';return{...draft,status:'signed',entry_snapshot:{release_acknowledgement:{method:'paper',confirmed:true}}};});
    await show();fireEvent.click(screen.getByRole('button',{name:'Paper signature'}));
    const button=screen.getByRole('button',{name:'Approve paper signature and record exit'});expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText(/I confirm the vehicle has left/));fireEvent.click(button);
    await waitFor(()=>expect(mocks.paper).toHaveBeenCalledWith('release','2026-11-08T09:00:00Z',expect.any(String),true));
    await waitFor(()=>expect(mocks.success).toHaveBeenCalledWith('Paper signature acknowledged — temporary exit recorded'));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('offers options and saved visitor details; waits for verified save before creating one link',async()=>{
    let resolve!:(value:typeof record)=>void;mocks.save.mockReturnValue(new Promise(done=>{resolve=done;}));mocks.prepare.mockImplementation(async()=>{mocks.load.mockResolvedValue({...record,status:'awaiting_signature'});return{url:'https://example.invalid/sign',idempotencyKey:'QA-key'};});
    await show();expect(screen.getByText('QA-ID')).toBeTruthy();expect(screen.getByText('Optional additional details').closest('details')?.open).toBe(false);
    const button=screen.getByRole('button',{name:'Save, verify and prepare customer link'});fireEvent.click(button);fireEvent.click(button);
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));expect(mocks.success).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
    await act(async()=>resolve(record));await screen.findByText('Recorded messages panel');
    expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(mocks.prepare).toHaveBeenCalledWith({entryId:'entry'},'temporary_release_signature','en','tenant');
    expect(screen.getByText('Report and link creation verified · QA-TEMP')).toBeTruthy();
  });
  it('does not create a capability or confirm success after failed save',async()=>{
    mocks.save.mockRejectedValue(new Error('Cloud write rejected'));await show();fireEvent.click(screen.getByRole('button',{name:'Save, verify and prepare customer link'}));
    await waitFor(()=>expect(mocks.error).toHaveBeenCalledWith('Cloud write rejected'));expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.success).not.toHaveBeenCalled();
  });
  it('distinguishes a verified draft from a failed link, so retry does not imply creation succeeded',async()=>{
    mocks.save.mockResolvedValue(record);mocks.prepare.mockRejectedValue(new Error('Link unavailable'));await show();fireEvent.click(screen.getByRole('button',{name:'Save, verify and prepare customer link'}));
    await waitFor(()=>expect(mocks.error).toHaveBeenCalledWith('Link unavailable'));expect(screen.getByText('Cloud save verified · QA-TEMP')).toBeTruthy();expect(screen.queryByText(/Report and link creation verified/)).toBeNull();expect(mocks.success).not.toHaveBeenCalled();
  });
});
