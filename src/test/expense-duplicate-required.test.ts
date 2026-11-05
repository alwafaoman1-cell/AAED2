import {beforeEach,describe,expect,it,vi} from "vitest";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc}}));
import {checkExpenseDuplicates} from "@/lib/expenses/expenseDuplicateGuard";
const candidate={date:"2026-11-05",total:10,work_order_id:"10000000-0000-4000-8000-000000000001"};
beforeEach(()=>rpc.mockReset());
describe("required cloud expense duplicate protection",()=>{
  it("does not convert a missing RPC into a successful duplicate check",async()=>{
    rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"Could not find expense_duplicate_candidates_rpc"}});
    await expect(checkExpenseDuplicates(candidate,null,{required:true})).rejects.toThrow("EXPENSE_DUPLICATE_GUARD_UNAVAILABLE");
  });
  it.each([null,{}, {exact:[],potential:null}])("fails closed on an invalid response %o",async(data)=>{
    rpc.mockResolvedValue({data,error:null});
    await expect(checkExpenseDuplicates(candidate,null,{required:true})).rejects.toThrow("EXPENSE_DUPLICATE_GUARD_UNAVAILABLE");
  });
  it("accepts a confirmed empty check and keeps the exact exclusion identity",async()=>{
    rpc.mockResolvedValue({data:{exact:[],potential:[]},error:null});
    expect(await checkExpenseDuplicates(candidate,candidate.work_order_id,{required:true})).toEqual({exact:[],potential:[]});
    expect(rpc).toHaveBeenCalledWith("expense_duplicate_candidates_rpc",{p_candidate:candidate,p_exclude_id:candidate.work_order_id});
  });
  it("leaves explicitly legacy callers compatible without changing their API",async()=>{
    rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
    expect(await checkExpenseDuplicates(candidate)).toEqual({exact:[],potential:[]});
  });
});
