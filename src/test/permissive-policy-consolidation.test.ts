import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const name=readdirSync('supabase/migrations').find(x=>x.endsWith('_consolidate_role_scoped_permissive_policies.sql'))!;
const text=readFileSync('supabase/migrations/'+name,'utf8');
const executable=text.replace(/^--.*$/gm,'');
describe('reviewed command-specific policy consolidation',()=>{
 it('requires exact prior policy shapes and keeps explicit authenticated scope',()=>{
  expect(text.match(/RLS_POLICY_DEFINITION_DRIFT:/g)).toHaveLength(29);
  expect(text.match(/drop policy /g)).toHaveLength(89);
  expect(text.match(/create policy /g)).toHaveLength(115);
  expect(text.match(/to authenticated/g)).toHaveLength(115);
  expect(text).not.toMatch(/as restrictive for|for all to/);
 });
 it('retains the original expressions as OR alternatives and implicit write checks',()=>{
  expect(text).toContain(' OR ');
  expect(text).toContain('with check (');
  expect(text).toContain('using (');
  expect(executable).not.toMatch(/\b(?:insert into|update public|delete from|truncate|alter table|grant|revoke)\b/i);
  expect(text).toContain("set local lock_timeout='2s'");
 });
});
