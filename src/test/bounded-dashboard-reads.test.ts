import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: db }));
import { fetchExpenseDashboardSummary, fetchInsuranceHubSummary } from "@/lib/dashboardReadSummaries";
import { EXPENSE_CATEGORY_COLUMNS, invalidateExpenseCategoryRows, readExpenseCategoryRows, setExpenseCategoryQueryClient } from "@/lib/expenses/expenseCategoryReader";
import { listCategoryAudit } from "@/lib/expenses/expenseClassificationService";
beforeEach(() => { vi.clearAllMocks(); setExpenseCategoryQueryClient(new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})); });
describe("bounded, verified dashboard reads", () => {
  it("keeps every displayed audit column without downloading unused before/after snapshots", async () => {
    const select=vi.fn().mockReturnThis(),eq=vi.fn().mockReturnThis(),order=vi.fn().mockReturnThis(),limit=vi.fn().mockResolvedValue({data:[{id:"audit",action:"update",category_id:"category",user_id:"actor",created_at:"2026-11-07"}],error:null});
    db.from.mockReturnValue({select,eq,order,limit});
    expect(await listCategoryAudit("tenant")).toEqual([expect.objectContaining({id:"audit",action:"update"})]);
    expect(select).toHaveBeenCalledWith("id,created_at,action,category_id,user_id");expect(eq).toHaveBeenCalledWith("tenant_id","tenant");expect(limit).toHaveBeenCalledWith(100);
  });
  it("reads only the expense summary, keeps real zero totals and rejects partial or failed responses", async () => {
    db.rpc.mockResolvedValueOnce({data:{total:0,count:0,monthly:[],categories:[]},error:null});
    expect((await fetchExpenseDashboardSummary("tenant")).total).toBe(0);
    expect(db.rpc).toHaveBeenCalledWith("accounting_expense_summary_rpc", {p_tenant_id:"tenant"});
    db.rpc.mockResolvedValueOnce({data:{total:10,count:1,monthly:[{month:"2026-07",expenses:null}],categories:[]},error:null});
    await expect(fetchExpenseDashboardSummary("tenant")).rejects.toThrow("INVALID_RESPONSE");
    db.rpc.mockResolvedValueOnce({data:null,error:new Error("denied")});
    await expect(fetchExpenseDashboardSummary("tenant")).rejects.toThrow("denied");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("fails closed if an insurance aggregate is incomplete rather than showing reassuring zeroes", async () => {
    db.rpc.mockResolvedValue({data:{stats:{total:1},topCompanies:[],monthlyTrend:[],agingBuckets:[],recentClaims:[],criticalAlerts:[]},error:null});
    await expect(fetchInsuranceHubSummary("tenant")).rejects.toThrow("INVALID_RESPONSE");
    expect(db.rpc).toHaveBeenCalledWith("insurance_hub_summary_rpc",expect.objectContaining({p_tenant_id:"tenant",p_timezone:expect.any(String),p_now:expect.any(String)}));
  });
  it("deduplicates canonical and legacy category consumers using the same tenant-scoped QueryClient", async () => {
    const result={data:[{id:"category",name_ar:"صبغ",name_en:"Paint",is_active:true}],error:null};
    const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};
    db.from.mockReturnValue(query);
    const [a,b]=await Promise.all([readExpenseCategoryRows("a"),readExpenseCategoryRows("a")]);
    expect(a).toEqual(b);expect(db.from).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith(EXPENSE_CATEGORY_COLUMNS);expect(EXPENSE_CATEGORY_COLUMNS).not.toContain("*");
    await readExpenseCategoryRows("a");expect(db.from).toHaveBeenCalledTimes(1);
    await readExpenseCategoryRows("b");expect(query.eq).toHaveBeenCalledWith("tenant_id","b");expect(db.from).toHaveBeenCalledTimes(2);
    await invalidateExpenseCategoryRows("a");await readExpenseCategoryRows("a");expect(db.from).toHaveBeenCalledTimes(3);
  });
  it("does not turn a category failure into a cached empty successful list", async () => {
    const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:new Error("offline")}).then(resolve)};
    db.from.mockReturnValue(query);await expect(readExpenseCategoryRows("a")).rejects.toThrow("offline");
    await expect(readExpenseCategoryRows("a")).rejects.toThrow("offline");expect(db.from).toHaveBeenCalledTimes(2);
  });
});
