// @vitest-environment jsdom
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';
import type {WorkOrder} from '@/lib/workOrdersStore';
import i18n from '@/i18n';

const mocks=vi.hoisted(()=>({load:vi.fn(),history:vi.fn(),save:vi.fn(),finalize:vi.fn()}));
vi.mock('@/hooks/useWorkflowRequirements',()=>({useWorkflowRequirements:()=>({requirementsEnabled:true})}));
vi.mock('@/lib/vehicleDeliveryReceipt',()=>({loadVehicleDeliveryReceiptDraft:mocks.load,listVehicleHandoverHistory:mocks.history,saveVehicleDeliveryReceiptDraft:mocks.save,finalizeVehicleDeliveryReceipt:mocks.finalize,
  buildDeliveryReceiptData:vi.fn(),DEFAULT_HANDOVER_DECLARATION_AR:'إقرار تجريبي',DEFAULT_HANDOVER_DECLARATION_EN:'Test declaration',getDefaultDeliveryWarrantyNotes:()=>'',getDeliveredDateInputValue:()=>'2026-11-07',getDeliveredTimeInputValue:()=>'12:30:00',combineDeliveryDateTime:(date:string,time:string)=>`${date}T${time}+04:00`}));
vi.mock('@/lib/workOrderInvoiceSync',()=>({isInsuranceWorkOrder:()=>true,syncWorkOrderInvoiceFromExpenses:vi.fn()}));
vi.mock('@/lib/salesStore',()=>({salesStore:{getAll:()=>[]}}));
vi.mock('@/lib/pdfGenerator',()=>({getVehicleDeliveryReceiptHtml:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:vi.fn()}}));
vi.mock('@/components/PdfPreviewDialog',()=>({default:()=>null}));
vi.mock('@/components/vehicle-entry/VehicleIntakeReceiptForOrder',()=>({default:()=>null}));
vi.mock('@/components/ui/responsive-dialog',()=>({
  ResponsiveDialog:({children}:PropsWithChildren)=> <div>{children}</div>,
  ResponsiveDialogHeader:({children}:PropsWithChildren)=><div>{children}</div>,
  ResponsiveDialogTitle:({children}:PropsWithChildren)=><h2>{children}</h2>,
  ResponsiveDialogFooter:({children}:PropsWithChildren)=><div>{children}</div>,
}));
import VehicleDeliveryReceiptDialog from '@/components/workorders/VehicleDeliveryReceiptDialog';
const order={id:'WO-I-26-0001',cloudId:'00000000-0000-4000-8000-000000000001',customer:'Synthetic visitor',plate:'QA 1',status:'جاهز للتسليم',partsNeeded:[]} as WorkOrder;
function show(){return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><VehicleDeliveryReceiptDialog open order={order} presentation="page" onOpenChange={vi.fn()}/></MemoryRouter></QueryClientProvider>);}
beforeEach(async()=>{vi.clearAllMocks();mocks.history.mockResolvedValue([]);await i18n.changeLanguage('ar');});
describe('handover draft read before editing',()=>{
  it('does not expose recipient fields before a delayed cloud draft finishes reading',async()=>{
    let resolve!:(value:null)=>void;
    mocks.load.mockReturnValue(new Promise<null>(done=>{resolve=done;}));show();
    expect(screen.queryByText('رقم هوية المستلم')).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();
    await act(async()=>resolve(null));
    const label=await screen.findByText('رقم هوية المستلم');
    const input=label.parentElement!.querySelector('input')!;
    fireEvent.change(input,{target:{value:'QA-TEST-ID'}});
    expect(input.value).toBe('QA-TEST-ID');expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'حفظ المسودة'}).parentElement!.className).toContain('sm:flex-wrap');
  });
  it('keeps a failed read explicit and blocks editing until a successful retry',async()=>{
    mocks.load.mockRejectedValueOnce(new Error('Synthetic read failure'));show();
    await screen.findByText('Synthetic read failure');expect(screen.queryByText('رقم هوية المستلم')).toBeNull();
    mocks.load.mockResolvedValueOnce(null);fireEvent.click(screen.getByRole('button',{name:'إعادة قراءة المسودة'}));
    await screen.findByText('رقم هوية المستلم');expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
