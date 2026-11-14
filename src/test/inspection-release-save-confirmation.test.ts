// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({tenant:vi.fn(),from:vi.fn(),rpc:vi.fn(),portal:vi.fn(),row:null as any}));
vi.mock('@/lib/cloud/createCloudStore',()=>({getCurrentTenantId:mocks.tenant}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:mocks.from,rpc:mocks.rpc}}));
vi.mock('@/lib/pdfGenerator',()=>({getTemplateSettings:()=>({})}));
vi.mock('@/lib/htmlToPdf',()=>({generatePdfFromHtml:vi.fn(),DEFAULT_MARGINS:{}}));
vi.mock('@/lib/vehicleTechnicalDeclaration',()=>({buildTechnicalDeclarationConditionSummary:()=>[]}));
vi.mock('@/lib/unifiedVehiclePortal',()=>({ensureVehicleCustomerPortal:mocks.portal,buildUnifiedVehiclePortalUrl:(token:string)=>`https://example.invalid/customer/vehicle/${token}`}));
import {emptyInspectionReleaseForm,normalizeInspectionReleaseForm,saveInspectionRelease,createInspectionReleaseLink,getInspectionReleaseById,finalizeInspectionReleasePaper} from '@/lib/vehicleInspectionRelease';
const tenant='00000000-0000-4000-8000-000000000001',entry='00000000-0000-4000-8000-000000000002',release='00000000-0000-4000-8000-000000000003';
const form={...emptyInspectionReleaseForm,inspection_summary:'Visual inspection only',pending_action:'Awaiting customer decision',exit_condition:'Driving condition not tested',recipient_name:'QA Visitor',recipient_id_number:'QA-ID',recipient_phone:'80000119'};
beforeEach(()=>{
  vi.clearAllMocks();mocks.tenant.mockResolvedValue(tenant);
  mocks.portal.mockResolvedValue({token:'canonical-token',enabled:true,expires_at:null});
  mocks.row={id:release,tenant_id:tenant,vehicle_entry_id:entry,status:'draft',form_data:form,release_number:'QA-VIR',updated_at:'2026-11-07T10:00:00Z'};
  mocks.from.mockImplementation(()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:mocks.row,error:null})};return q;});
  mocks.rpc.mockImplementation(async(name:string)=>name==='save_vehicle_inspection_release'?{data:mocks.row,error:null}:name==='create_vehicle_inspection_release_link'?(mocks.row={...mocks.row,status:'awaiting_signature'},{data:{token:'a'.repeat(64),release_id:release,expires_at:'2099-01-01'},error:null}):{data:{release_number:'QA-VIR',signed:false},error:null});
});
describe('inspection release confirmed persistence',()=>{
  it('rejects paper acknowledgement without confirmation before any write',async()=>{
    await expect(finalizeInspectionReleasePaper(release,'2026-11-08T09:00:00Z','2026-11-08T10:00:00Z',false)).rejects.toThrow('PAPER_EVIDENCE_REQUIRED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('confirms paper exit by reading the persisted record, without inventing a signature image',async()=>{
    mocks.rpc.mockImplementationOnce(async()=>{
      mocks.row={...mocks.row,status:'signed',signature_data_url:null,returned_at:null,released_at:'2026-11-08T10:00:00+00:00',entry_snapshot:{release_acknowledgement:{method:'paper',confirmed:true}}};
      return {data:{id:release},error:null};
    });
    expect(await finalizeInspectionReleasePaper(release,'2026-11-08T09:00:00Z','2026-11-08T10:00:00Z',true)).toMatchObject({status:'signed',signature_data_url:null});
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_vehicle_inspection_release_paper',{p_release_id:release,p_expected_updated_at:'2026-11-08T09:00:00Z',p_released_at:'2026-11-08T10:00:00Z',p_paper_confirmed:true});
  });
  it('rejects nominal paper success when the cloud record is still a draft',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{id:release},error:null});
    await expect(finalizeInspectionReleasePaper(release,'2026-11-08T09:00:00Z','2026-11-08T10:00:00Z',true)).rejects.toThrow('EXIT_UNCONFIRMED');
  });
  it('normalizes to the existing server field limits without inventing facts',()=>{
    expect(normalizeInspectionReleaseForm({...form,recipient_id_number:' '+ 'x'.repeat(100)+' ',pending_action:' Decision '})).toMatchObject({recipient_id_number:'x'.repeat(80),pending_action:'Decision'});
    expect(normalizeInspectionReleaseForm(emptyInspectionReleaseForm).inspection_summary).toBe('');
  });
  it('returns only a read-back-verified draft with the same entry and exact persisted fields',async()=>{
    expect(await saveInspectionRelease(entry,form)).toEqual(mocks.row);
    expect(mocks.from).toHaveBeenCalledWith('vehicle_inspection_releases');
    expect(mocks.rpc).toHaveBeenCalledWith('save_vehicle_inspection_release',{p_vehicle_entry_id:entry,p_form:form});
  });
  it('does not accept a nominal successful RPC whose stored values differ',async()=>{
    const acknowledged={...mocks.row};mocks.rpc.mockResolvedValueOnce({data:acknowledged,error:null});mocks.row={...mocks.row,form_data:{...form,pending_action:'Concurrent edit'}};
    await expect(saveInspectionRelease(entry,form)).rejects.toThrow('SAVE_UNCONFIRMED');
  });
  it('rejects a foreign tenant before accepting the save or read result',async()=>{
    mocks.row={...mocks.row,tenant_id:'another-tenant'};
    await expect(saveInspectionRelease(entry,form)).rejects.toThrow('SAVE_UNCONFIRMED');
    await expect(getInspectionReleaseById(release)).rejects.toThrow('READ_UNCONFIRMED');
  });
  it('verifies canonical awaiting-signature cloud state then returns only the unified portal URL',async()=>{
    const link=await createInspectionReleaseLink(release);
    expect(link.url).toBe('https://example.invalid/customer/vehicle/canonical-token');
    expect(mocks.portal).toHaveBeenCalledWith(entry);
    expect(mocks.rpc.mock.calls.map(([name])=>name)).not.toContain('get_vehicle_inspection_release_for_signature');
  });
  it('never calls an invalid or unavailable capability a working link',async()=>{
    mocks.rpc.mockImplementation(async()=>({data:{token:'invalid',release_id:release,expires_at:'2099-01-01'},error:null}));
    await expect(createInspectionReleaseLink(release)).rejects.toThrow();
    expect(mocks.portal).not.toHaveBeenCalled();
  });
  it('never returns a working link for a paused portal',async()=>{
    mocks.portal.mockResolvedValue({token:'canonical-token',enabled:false,expires_at:null});
    await expect(createInspectionReleaseLink(release)).rejects.toThrow('CUSTOMER_PORTAL_UNAVAILABLE');
  });
});
