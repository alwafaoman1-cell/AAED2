import {beforeEach,describe,expect,it,vi} from "vitest";
import {getVehicleVisitDetail} from "@/lib/vehicleVisitLifecycle";
const mock=vi.hoisted(()=>({entry:null as any,traces:[] as Array<{table:string;filters:Array<[string,unknown]>}>}));
vi.mock("@/lib/vehicleEntryService",async original=>({...await original<any>(),getVehicleEntry:async()=>mock.entry}));
vi.mock("@/lib/cloud/createCloudStore",()=>({getCurrentTenantId:async()=>"tenant"}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:(table:string)=>{
  const trace={table,filters:[] as Array<[string,unknown]>};mock.traces.push(trace);
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{trace.filters.push([k,v]);return q;},is:(k:string,v:unknown)=>{trace.filters.push([k,v]);return q;},in:(k:string,v:unknown)=>{trace.filters.push([k,v]);return q;},or:(s:string)=>{trace.filters.push(["or",s]);return q;},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null,error:null}),then:(resolve:any)=>resolve({data:[],error:null})};return q;
}}}));
beforeEach(()=>{mock.traces=[];mock.entry={id:"entry",tenant_id:"tenant",vehicle_id:"car",status:"Received",vehicle_location:"داخل الورشة",customer_id:"visitor",work_order_id:"order",insurance_claim_id:"claim",vehicle_media:[],
  claim:{id:"claim",tenant_id:"tenant",vehicle_id:"car",status:"approved"},work_order:{id:"order",tenant_id:"tenant",vehicle_id:"car",vehicle_entry_id:"entry",claim_id:"claim",work_order_type:"insurance",order_number:"WO-I-26-0001",status:"received"}};});
describe("an invalid entry/order FK cannot expose another car's financial file",()=>{
  it("keeps real mismatch visible while not querying that order's expenses, cash invoices or files",async()=>{
    mock.entry.work_order.vehicle_id="another-car";
    const result=await getVehicleVisitDetail("entry");
    expect(result.reviewReason).toBe("work_order_link_conflict");
    expect(mock.traces.some(t=>["expenses","sales_documents"].includes(t.table))).toBe(false);
    const links=mock.traces.find(t=>t.table==="document_links");expect(links.filters).toContainEqual(["entity_id",["entry","claim"]]);
    expect(mock.traces.find(t=>t.table==="vehicle_media").filters).toContainEqual(["or","claim_id.eq.claim"]);
  });
  it("retains expense/invoice reads for a fully confirmed same-visit order",async()=>{
    const result=await getVehicleVisitDetail("entry");expect(result.reviewReason).toBeNull();
    expect(mock.traces.filter(t=>t.table==="expenses")).toHaveLength(2);expect(mock.traces.some(t=>t.table==="sales_documents")).toBe(true);
  });
  it("does not treat an inferred legacy candidate as a confirmed financial link",async()=>{
    mock.entry.work_order_id=null;mock.entry.work_order.vehicle_entry_id=null;mock.entry.__inferredOrderLink=true;
    const result=await getVehicleVisitDetail("entry");expect(result.reviewReason).toBe("work_order_link_conflict");
    expect(mock.traces.some(t=>["expenses","sales_documents"].includes(t.table))).toBe(false);
  });
  it("does not read a different claim's invoice through an inconsistent vehicle link",async()=>{
    mock.entry.claim.vehicle_id="another-car";
    const result=await getVehicleVisitDetail("entry");expect(result.reviewReason).toBe("claim_link_conflict");
    expect(mock.traces.some(t=>t.table==="insurance_invoices")).toBe(false);
  });
});
