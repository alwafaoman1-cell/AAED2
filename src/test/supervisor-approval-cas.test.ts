// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
const m = vi.hoisted(() => ({ from: vi.fn(), write: vi.fn(), filters: [] as unknown[][],
  current: { id: "claim", tenant_id: "tenant", status: "pending" } as Record<string, unknown>,
  response: {} as {data?: unknown; error?: unknown}, audit: vi.fn(), post: vi.fn(), success: vi.fn(), failed: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: m.invalidate }), useMutation: (options: unknown) => options }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {from: m.from} }));
vi.mock("sonner", () => ({toast: {success: m.success, error: m.failed}}));
vi.mock("@/lib/insuranceAccounting", () => ({postInsuranceClaimApproval: m.post, removeInsuranceClaimJournal: vi.fn()}));
vi.mock("@/lib/supabasePayload", () => ({sanitizeClaimWritePayload: vi.fn()}));
vi.mock("@/lib/insurance/claimPayloadService", () => ({createClaimInCloud: vi.fn()}));
vi.mock("@/lib/cloud/createCloudStore", () => ({getCurrentTenantId: vi.fn()}));
import { useUpdateClaimStatus } from "@/hooks/useInsuranceClaims";
beforeEach(() => {
  vi.clearAllMocks(); m.filters=[]; m.current={id:"claim",tenant_id:"tenant",status:"pending"};
  m.response={data:{id:"claim",tenant_id:"tenant",status:"approved",approved_amount:105},error:null};
  m.from.mockImplementation((table: string) => {
    if (table === "claim_audit_logs") return {insert:m.audit.mockResolvedValue({error:null})};
    const read: any = {select:()=>read,eq:()=>read,maybeSingle:async()=>({data:m.current,error:null})};
    const write: any = {eq:(...args:unknown[])=>{m.filters.push(args);return write;},select:()=>write,single:async()=>m.response};
    read.update=m.write.mockImplementation(()=>write);return read;
  });
});
afterEach(cleanup);
const mutation=()=>renderHook(()=>useUpdateClaimStatus({notify:false})).result.current as unknown as {
  mutationFn:(value:{id:string;status:"approved";approved_amount:number;expected_status?:"pending"})=>Promise<unknown>;
  onSuccess:(data:unknown,variables:{id:string})=>void;
  onError:(error:Error)=>void;
};
const approval={id:"claim",status:"approved" as const,approved_amount:105,expected_status:"pending" as const};
describe("reviewed supervisor approval compare-and-set",()=>{
  it("rejects a status changed before the fresh read without writing",async()=>{
    m.current.status="cancelled";
    await expect(mutation().mutationFn(approval)).rejects.toThrow("CLAIM_STATUS_CHANGED");
    expect(m.write).not.toHaveBeenCalled();expect(m.audit).not.toHaveBeenCalled();
  });
  it("guards the actual write by exact tenant and pending state, so a concurrent winner cannot be overwritten",async()=>{
    m.response={data:null,error:{code:"PGRST116",message:"No matching row"}};
    await expect(mutation().mutationFn(approval)).rejects.toThrow("No matching row");
    expect(m.filters).toEqual([["id","claim"],["tenant_id","tenant"],["status","pending"]]);
    expect(m.audit).not.toHaveBeenCalled();expect(m.post).not.toHaveBeenCalled();
  });
  it("returns confirmed approval and permits the embedded UI to own localized feedback",async()=>{
    const hook=mutation();const saved=await hook.mutationFn(approval);
    expect(saved).toMatchObject({id:"claim",status:"approved",approved_amount:105});expect(m.audit).toHaveBeenCalledOnce();
    hook.onSuccess(saved,{id:"claim"});hook.onError(new Error("review"));
    expect(m.success).not.toHaveBeenCalled();expect(m.failed).not.toHaveBeenCalled();
    expect(m.invalidate).toHaveBeenCalledWith({queryKey:["vehicle_visit"]});expect(m.invalidate).toHaveBeenCalledWith({queryKey:["job_orders"]});
  });
  it("keeps unguarded existing callers on their original API",async()=>{
    await mutation().mutationFn({id:"claim",status:"approved",approved_amount:105});
    expect(m.filters).toEqual([["id","claim"]]);
  });
});
