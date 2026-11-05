// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {VehicleVisitControlPanel} from "@/pages/vehicle-entry/VehicleVisitControlPanel";
import i18n from "@/i18n";
const mock=vi.hoisted(()=>({get:vi.fn(),confirm:vi.fn(),success:vi.fn(),error:vi.fn(),role:"manager"}));
vi.mock("sonner",()=>({toast:{success:mock.success,error:mock.error}}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:"user"},hasRole:(...roles:string[])=>roles.includes(mock.role)})}));
vi.mock("@/lib/vehicleEntryService",async importOriginal=>({...await importOriginal<typeof import("@/lib/vehicleEntryService")>(),confirmVehicleEntryWorkOrderLink:mock.confirm}));
vi.mock("@/lib/vehicleVisitLifecycle",()=>({getVehicleVisitDetail:mock.get,listVehicleVisitStaff:async()=>[],canReconcileVehicleVisitCustody:()=>false,getVehicleVisitBillingKind:()=>"insurance",getVehicleVisitNextBlocker:()=>null,getVehicleVisitReverseBlocker:()=>null,advanceVehicleVisit:vi.fn(),reconcileVehicleVisitCustody:vi.fn()}));
function fixture(){return{
  entry:{id:"entry",tenant_id:"tenant",entry_number:"ENT-1",updated_at:"baseline",vehicle_id:"car",insurance_claim_id:"claim",work_order_id:null,converted_work_order_id:null,__inferredOrderLink:true,
    work_order:{id:"order",tenant_id:"tenant",vehicle_id:"car",vehicle_entry_id:null,work_order_type:"insurance",claim_id:"claim",order_number:"WO-I-26-0001"},claim:{id:"claim",status:"approved"}},
  stage:"needs_review",operationalStage:"approved",reviewReason:"work_order_link_conflict",workflow:null,hasFinalHandover:false,
  transitions:[],handovers:[],releases:[],documents:[],documentFiles:[],expenses:[],cashInvoices:[],insuranceInvoices:[],mediaCount:0,
};}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={client}><MemoryRouter><VehicleVisitControlPanel entryId="entry"/></MemoryRouter></QueryClientProvider>);return client;}
beforeEach(async()=>{vi.clearAllMocks();mock.role="manager";await i18n.changeLanguage("en");mock.get.mockResolvedValue(fixture());mock.confirm.mockResolvedValue({existing:true,work_order_id:"order"});});
afterEach(()=>cleanup());
describe("explicit existing order link correction",()=>{
  it("offers a manager the exact candidate and only reports success after fresh cloud readback",async()=>{
    mount();const button=await screen.findByRole("button",{name:/Confirm existing work-order link/});
    const saved=fixture();Object.assign(saved.entry,{work_order_id:"order",converted_work_order_id:"order",__inferredOrderLink:false});saved.reviewReason=null;
    mock.get.mockResolvedValue(saved);fireEvent.click(button);
    await waitFor(()=>expect(mock.success).toHaveBeenCalledOnce());
    expect(mock.confirm).toHaveBeenCalledWith("entry","order","baseline");expect(mock.error).not.toHaveBeenCalled();
    expect(await screen.findByRole("link",{name:"WO-I-26-0001"})).toHaveAttribute("href","/work-orders/WO-I-26-0001");
  });
  it.each(["insurance","supervisor","technician"])("does not offer manager repair to %s",async role=>{
    mock.role=role;mount();await screen.findByText("Visit operational file");
    expect(screen.queryByRole("button",{name:/Confirm existing work-order link/})).not.toBeInTheDocument();
  });
  it.each(["vehicle","visit"])("does not offer a relink when the %s differs",async kind=>{
    const row=fixture();if(kind==="vehicle")row.entry.work_order.vehicle_id="other";else row.entry.work_order.vehicle_entry_id="other";
    mock.get.mockResolvedValue(row);mount();await screen.findByText("Visit operational file");
    expect(screen.queryByRole("button",{name:/Confirm existing work-order link/})).not.toBeInTheDocument();
  });
  it("does not report success when a saved link cannot be confirmed by reading the entry again",async()=>{
    mount();fireEvent.click(await screen.findByRole("button",{name:/Confirm existing work-order link/}));
    await waitFor(()=>expect(mock.error).toHaveBeenCalled());expect(mock.success).not.toHaveBeenCalled();
  });
});
