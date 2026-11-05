-- Development-only rollback proof. Uses the existing test manager; preserves all data.
begin;
set local statement_timeout='10s';
do $setup$ declare actor uuid; begin
 select user_id into actor from public.profiles where role::text='manager' and account_status='active' limit 1;
 if actor is null then raise exception 'DEVELOPMENT_MANAGER_REQUIRED'; end if;
 perform set_config('security_audit.profile_actor',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
end $setup$;
set local role authenticated;
do $self$ declare n integer; begin
 update public.profiles set full_name=full_name where user_id=auth.uid();
 get diagnostics n=row_count;
 if n is distinct from 1 then raise exception 'OWN_PROFILE_UPDATE_NOT_CONFIRMED';end if;
end $self$;
reset role;
do $anon_setup$ begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','anon',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
end $anon_setup$;
set local role anon;
do $anonymous$ declare denied boolean:=false; n integer:=0; begin
 begin
  update public.profiles set full_name=full_name where user_id=current_setting('security_audit.profile_actor')::uuid;
  get diagnostics n=row_count;
  denied:=n=0;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'ANONYMOUS_PROFILE_UPDATE_NOT_DENIED';end if;
end $anonymous$;
reset role;
select jsonb_build_object('own_profile_update_confirmed',true,'anonymous_update_denied',true,'rolled_back',true) verification;
rollback;

