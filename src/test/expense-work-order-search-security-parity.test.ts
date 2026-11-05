import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
const file=readdirSync('supabase/migrations').find(name=>name.endsWith('_expense_work_order_lookup_rls_parity_and_private_dedupe_acl.sql'))!;
const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
describe('expense work-order search existing RLS parity',()=>{
  it('denies customer lookup that bypassed base job_orders SELECT restrictions',()=>{
    expect(sql).toContain('auth.uid() is not null');
    expect(sql).toContain("public.get_user_role() <> ''customer''::public.app_role");
    expect(sql).toContain("not public.has_role(auth.uid(), ''customer''::public.app_role)");
    expect(sql).toContain('EXPENSE_WORK_ORDER_LOOKUP_DEFINITION_DRIFT');
    expect(sql).not.toContain('expenses.view');
  });
  it('retains the original function contract and alters no business data',()=>{
    expect(sql).toContain('replace(original,');
    expect(sql).toContain('where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null');
    expect(sql).not.toMatch(/\b(?:insert into|update public|delete from|truncate table)\b/i);
  });
  it('removes browser access to private message dedupe without granting policies',()=>{
    expect(sql).toContain('revoke all on table public.message_idempotency_keys from public,anon,authenticated');
    expect(sql).not.toMatch(/(?:disable row level security|create policy|revoke.*service_role)/i);
  });
});

