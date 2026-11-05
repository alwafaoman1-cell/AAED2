import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),insert:vi.fn(),update:vi.fn(),number:vi.fn(),duplicates:vi.fn(),from:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:mock.from}}));
vi.mock("@/lib/expenseVoucherNumbering",()=>({nextExpenseVoucherNumber:mock.number}));
vi.mock("@/lib/expenses/expenseDuplicateGuard",()=>({checkExpenseDuplicates:mock.duplicates,duplicateExpenseMessage:()=>null,exactDuplicateErrorFromDatabase:()=>null,
  ExpenseExactDuplicateError:class extends Error{},ExpensePotentialDuplicateError:class extends Error{}}));
import {ExpenseCreateRetryConflictError,saveExpense,type ExpenseInput} from "@/lib/expenses/expenseClassificationService";

const requestId="10000000-0000-4000-8000-000000000001";
const user="10000000-0000-4000-8000-000000000002";
const input:ExpenseInput={tenant_id:"tenant-a",date:"2026-11-05",expense_scope:"work_order",work_order_id:"order-a",department_id:"dept-a",expense_category_id:"category-a",
  payment_method:"cash",description:"Workshop parts",subtotal:10,vat_amount:0,total:10,is_vat_applicable:false};
const durable=()=>({...input,id:requestId,created_by:user,amount:10,voucher_number:"PAY-TEST-1"});
beforeEach(()=>{
  vi.clearAllMocks();mock.read.mockResolvedValue({data:null,error:null});mock.number.mockResolvedValue("PAY-TEST-1");mock.duplicates.mockResolvedValue({exact:[],potential:[]});
  mock.write.mockResolvedValue({data:durable(),error:null});
  mock.from.mockImplementation(()=>{
    const query:any={select:()=>query,eq:()=>query,maybeSingle:mock.read,single:mock.write};
    query.insert=(value:any)=>{mock.insert(value);return query};query.update=(value:any)=>{mock.update(value);return query};return query;
  });
});
describe("expense create request identity",()=>{
  it("reuses one UUID after a committed insert loses its response without allocating another voucher",async()=>{
    mock.write.mockRejectedValueOnce(new Error("response lost after commit"));
    await expect(saveExpense(input,user,undefined,undefined,requestId)).rejects.toThrow("response lost");
    mock.read.mockResolvedValueOnce({data:durable(),error:null});
    const confirmed=await saveExpense(input,user,undefined,undefined,requestId);
    expect(confirmed.id).toBe(requestId);expect(mock.insert).toHaveBeenCalledTimes(1);expect(mock.number).toHaveBeenCalledTimes(1);
    expect(mock.insert.mock.calls[0][0].id).toBe(requestId);expect(mock.update).not.toHaveBeenCalled();
  });
  it("does not silently overwrite a durable voucher when the retried draft changed",async()=>{
    mock.read.mockResolvedValue({data:durable(),error:null});
    await expect(saveExpense({...input,total:20},user,undefined,undefined,requestId)).rejects.toBeInstanceOf(ExpenseCreateRetryConflictError);
    expect(mock.insert).not.toHaveBeenCalled();expect(mock.update).not.toHaveBeenCalled();
  });
  it.each([{tenant_id:"tenant-b"},{created_by:"another-user"},{deleted_at:"2026-11-05"},{work_order_id:"other-order"}])("denies conflicting recovery identity %o",async(patch)=>{
    mock.read.mockResolvedValue({data:{...durable(),...patch},error:null});
    await expect(saveExpense(input,user,undefined,undefined,requestId)).rejects.toBeInstanceOf(ExpenseCreateRetryConflictError);
  });
  it("recovers a concurrent same-request insert only when the cloud payload matches",async()=>{
    mock.read.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:durable(),error:null});
    mock.write.mockResolvedValueOnce({data:null,error:{code:"23505",message:"duplicate id"}});
    expect((await saveExpense(input,user,undefined,undefined,requestId)).id).toBe(requestId);
    expect(mock.insert).toHaveBeenCalledTimes(1);expect(mock.update).not.toHaveBeenCalled();
  });
  it("keeps old callers on their original insert path",async()=>{
    await saveExpense(input,user);
    expect(mock.read).not.toHaveBeenCalled();expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(mock.insert.mock.calls[0][0].id).toBeUndefined();
  });
});
