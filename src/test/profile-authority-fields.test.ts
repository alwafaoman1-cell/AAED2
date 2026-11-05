import { readFileSync,readdirSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const filename=readdirSync('supabase/migrations').find(name=>name.endsWith('_profiles_browser_authority_fields_guard.sql'))!;
const sql=readFileSync(`supabase/migrations/${filename}`,'utf8');
describe('profile platform/account authority is server managed',()=>{
  it('protects INSERT and UPDATE, including direct browser profile requests',()=>{
    expect(sql).toContain('before insert or update on public.profiles');
    expect(sql).toContain("coalesce(auth.role(),'') in ('anon','authenticated')");
    expect(sql).toContain("coalesce(current_setting('role',true),'') in ('anon','authenticated')");
    expect(sql).toContain("TG_OP='INSERT'");
    for(const field of ['user_id','is_platform_admin','account_status','disabled_at','disabled_by','invited_at'])
      expect(sql).toContain(`NEW.${field} is distinct from OLD.${field}`);
  });
  it('keeps profile details and existing role/tenant policies intact',()=>{
    expect(sql).toContain('EXISTING_ROLE_TENANT_GUARD_REQUIRED');
    expect(sql).not.toMatch(/alter policy|disable trigger|update public|delete from/i);
    for(const field of ['full_name','phone','avatar_url','last_seen_at','last_sign_in_at'])expect(sql).not.toContain(`NEW.${field}`);
    expect(sql).toContain("using errcode='42501'");
  });
  it('does not add a privileged public RPC or change historical accounts',()=>{
    expect(sql).toContain("returns trigger language plpgsql security definer set search_path=''");
    expect(sql).toContain('from public,anon,authenticated');
    expect(sql).not.toMatch(/\b(?:insert into|update public|delete from|truncate)\b/i);
  });
});

