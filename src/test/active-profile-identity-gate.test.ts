import { readFileSync,readdirSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const file=readdirSync('supabase/migrations').find(x=>x.endsWith('_active_profile_identity_gate.sql'))!;
const source=readFileSync('supabase/migrations/'+file,'utf8');
describe('active database identity is required for financial and workshop authorization',()=>{
 it('guards all shared identity helpers without changing account or role records',()=>{
  for(const name of ['get_user_role','get_user_tenant_id','has_role','is_platform_admin'])expect(source).toContain('function public.'+name+'(');
  expect(source.match(/p\.account_status='active' and p\.disabled_at is null/g)).toHaveLength(4);
  expect(source).not.toMatch(/\b(insert into|update public|delete from|grant |revoke |nextval\(|setval\()/i);
  expect(source).toContain('IDENTITY_GATE_SOURCE_DRIFT');
 });
 it('does not revive orphaned roles or use user-editable metadata to authorize',()=>{
  expect(source).toContain('ur.tenant_id=p.tenant_id');
  expect(source).toContain('p.user_id=(select auth.uid())');
  expect(source).not.toContain('user_metadata');
  expect(source).not.toContain('auth.jwt()');
  expect(source).toContain("when 'admin' then 1 when 'manager' then 2");
  expect(source.match(/set search_path=''/g)).toHaveLength(4);
 });
});
