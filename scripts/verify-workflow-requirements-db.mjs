// Isolated PostgreSQL/WASM verification. No connection string or hosted client is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime=path.join(root,'output/workflow-requirements-db-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(runtime).href);
const db=await PGlite.create();
const checks=[];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function check(name,run){await run();checks.push({name,passed:true});console.log('PASS',name);}
async function fails(sql,params,pattern){await assert.rejects(db.query(sql,params),pattern);}
async function actor(n){await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id(n)}',false); set role authenticated;`);}
async function value(sql,params=[]){return (await db.query(sql,params)).rows[0]?.value;}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create table public.tenants(id uuid primary key);
    create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid unique,tenant_id uuid,role text,account_status text,disabled_at timestamptz,full_name text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.get_user_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where user_id=auth.uid()$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),public.get_user_tenant_id() to authenticated,anon,service_role;
    grant select on public.profiles to authenticated;
    alter table public.profiles enable row level security;
    create policy profiles_own_read on public.profiles for select to authenticated using(user_id=auth.uid());
    insert into public.tenants values('${id(101)}'),('${id(102)}');
    insert into public.profiles(user_id,tenant_id,role,account_status,full_name) values
      ('${id(1)}','${id(101)}','admin','active','Admin A'),
      ('${id(2)}','${id(101)}','manager','active','Manager A'),
      ('${id(3)}','${id(102)}','admin','active','Admin B');
  `);
  await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261123140431_workflow_requirement_policy.sql'),'utf8'));
  await actor(1);
  await check('missing policy defaults to requirements enabled',async()=>{
    const p=await value('select public.get_workflow_requirement_policy() as value');assert.equal(p.requirements_enabled,true);assert.equal(p.revision,0);
  });
  await check('empty change reason is rejected',()=>fails('select public.set_workflow_requirement_policy(false,$1,0)',[' '],/WORKFLOW_POLICY_REASON_REQUIRED/));
  await check('explicit expected tenant blocks an auth-switch write before mutation',()=>fails('select public.set_workflow_requirement_policy(false,$1,0,$2)',['wrong workspace',id(102)],/WORKFLOW_POLICY_SCOPE_CHANGED/));
  await check('admin disables with canonical reason and revision',async()=>{
    const p=await value('select public.set_workflow_requirement_policy(false,$1,0) as value',['Authorized local exception']);assert.equal(p.requirements_enabled,false);assert.equal(p.revision,1);assert.equal(p.updated_by,id(1));
  });
  await check('stale settings cannot overwrite a newer revision',()=>fails('select public.set_workflow_requirement_policy(true,$1,0)',['stale'],/WORKFLOW_POLICY_CHANGED/));
  await check('authenticated users cannot directly edit policy or forge audit',async()=>{
    await fails('update public.workflow_requirement_settings set requirements_enabled=true',[],/permission denied/i);
    await fails(`insert into public.workflow_requirement_audit(tenant_id) values($1)`,[id(101)],/permission denied/i);
    await fails('select app_private.workflow_requirements_enforced($1)',[id(101)],/permission denied/i);
  });
  await db.exec(`reset role; create function public.test_workflow_operation(p_entity uuid) returns uuid language plpgsql security definer set search_path='' as $$begin return app_private.record_workflow_requirement_override(public.get_user_tenant_id(),'test_entity',p_entity,'test_override','{}'::jsonb);end$$; revoke all on function public.test_workflow_operation(uuid) from public; grant execute on function public.test_workflow_operation(uuid) to authenticated;`);
  await actor(2);
  await check('manager reads but cannot toggle',async()=>{
    assert.equal((await value('select public.get_workflow_requirement_policy() as value')).requirements_enabled,false);
    await fails('select public.set_workflow_requirement_policy(true,$1,1)',['manager attempt'],/WORKFLOW_POLICY_ADMIN_REQUIRED/);
  });
  let eventId;
  await check('exception is audited by database actor and saved policy reason',async()=>{
    eventId=await value('select public.test_workflow_operation($1) as value',[id(501)]);assert.ok(eventId);
    await db.exec('reset role');
    const r=(await db.query('select * from public.workflow_requirement_audit where id=$1',[eventId])).rows[0];
    assert.equal(r.actor_id,id(2));assert.equal(r.reason,'Authorized local exception');assert.equal(r.policy_revision,1);assert.equal(r.entity_id,id(501));
    await actor(2);
  });
  await check('non-admin cannot read audit history',async()=>assert.equal((await db.query('select * from public.workflow_requirement_audit')).rows.length,0));
  await actor(3);
  await check('other tenant remains strict and cannot see tenant A audit',async()=>{
    assert.equal((await value('select public.get_workflow_requirement_policy() as value')).requirements_enabled,true);
    assert.equal(await value('select public.test_workflow_operation($1) as value',[id(502)]),null);
    assert.equal((await db.query('select * from public.workflow_requirement_audit')).rows.length,0);
  });
  await actor(1);
  await check('reenabling stops further overrides and retains prior evidence',async()=>{
    const p=await value('select public.set_workflow_requirement_policy(true,$1,1) as value',['Return to normal requirements']);assert.equal(p.requirements_enabled,true);assert.equal(p.revision,2);
    assert.equal(await value('select public.test_workflow_operation($1) as value',[id(503)]),null);
    assert.equal((await db.query('select * from public.workflow_requirement_audit where id=$1',[eventId])).rows.length,1);
  });
  await check('audit cannot be rewritten even through a privileged table operation',async()=>{
    await db.exec('reset role');await fails('update public.workflow_requirement_audit set reason=$1 where id=$2',['changed',eventId],/WORKFLOW_AUDIT_IMMUTABLE/);await actor(1);
  });
  await check('anonymous caller cannot read or change policy',async()=>{
    await db.exec('reset role;set role anon;');await fails('select public.get_workflow_requirement_policy()',[],/permission denied/i);await actor(1);
  });
  await db.exec('reset role');
  await db.exec(`create table public.insurance_claims(id uuid primary key default gen_random_uuid(),tenant_id uuid,deleted_at timestamptz,status text,estimated_amount numeric,estimate_date date,vehicle_model text);
    create table public.job_orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,deleted_at timestamptz,claim_id uuid,status text default 'received',inferred_claim_id uuid,metadata jsonb default '{}');
    grant select,insert,update on public.insurance_claims,public.job_orders to authenticated;`);
  await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261123141053_workflow_requirement_claim_gates.sql'),'utf8'));
  await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261124143324_defer_claim_order_approval_guard.sql'),'utf8'));
  await actor(1);
  await db.query('insert into public.insurance_claims(id,tenant_id,status,estimated_amount) values($1,$2,$3,0)',[id(601),id(101),'pending']);
  await check('stale relaxed wizard provenance cannot bypass newly restored server completeness',()=>fails(
    'insert into public.insurance_claims(tenant_id,status,estimated_amount,workflow_requirement_revision) values($1,$2,0,1)',[id(101),'pending'],/WORKFLOW_CLAIM_FORM_DETAILS_REQUIRED/));
  await check('existing alternate draft creation stays valid without full-wizard provenance',async()=>{
    const row=(await db.query('select * from public.insurance_claims where id=$1',[id(601)])).rows[0];
    assert.equal(row.estimated_amount,'0');assert.equal(row.estimate_date,null);assert.equal(row.workflow_requirement_revision,null);
  });
  await check('a complete strict wizard claim is accepted with actual unapproved status',async()=>{
    const row=(await db.query("insert into public.insurance_claims(tenant_id,status,estimated_amount,estimate_date,vehicle_model,workflow_requirement_revision) values($1,'pending',100,current_date,'Fixture model',0) returning *",[id(101)])).rows[0];
    assert.equal(row.status,'pending');assert.equal(row.workflow_requirement_revision,0);
  });
  await check('strict claim approval dependency rejects a pending claim order',()=>fails('insert into public.job_orders(tenant_id,claim_id) values($1,$2)',[id(101),id(601)],/CLAIM_APPROVAL_REQUIRED/));
  await value('select public.set_workflow_requirement_policy(false,$1,2) as value',['Proceed without approval evidence']);
  await check('disabled dependency creates an audited order while claim stays pending',async()=>{
    const row=(await db.query('insert into public.job_orders(tenant_id,claim_id) values($1,$2) returning id',[id(101),id(601)])).rows[0];
    assert.equal((await db.query('select status from public.insurance_claims where id=$1',[id(601)])).rows[0].status,'pending');
    const audit=(await db.query(`select * from public.workflow_requirement_audit where entity_id=$1 and action='create_order_without_claim_approval'`,[row.id])).rows[0];assert.ok(audit);assert.equal(audit.reason,'Proceed without approval evidence');
  });
  await check('incomplete new claim is audited without fake approved amount',async()=>{
    await db.query('insert into public.insurance_claims(id,tenant_id,status,estimated_amount,workflow_requirement_revision) values($1,$2,$3,0,0)',[id(602),id(101),'pending']);
    const audits=(await db.query(`select * from public.workflow_requirement_audit where entity_id=$1 and action='create_claim_with_incomplete_operational_details'`,[id(602)])).rows;
    assert.equal(audits.length,1);assert.equal(audits[0].policy_revision,3);assert.equal(audits[0].reason,'Proceed without approval evidence');
  });
  await value('select public.set_workflow_requirement_policy(true,$1,3) as value',['Normal controls restored']);
  await db.exec(`reset role;create function public.test_infer_order_claim() returns trigger language plpgsql as $$begin if new.inferred_claim_id is not null then new.claim_id:=new.inferred_claim_id;end if;return new;end$$;create trigger zz_infer_order_claim before insert or update on public.job_orders for each row execute function public.test_infer_order_claim();`);
  await actor(1);
  await check('claim inferred by another BEFORE trigger cannot bypass approval',()=>fails('insert into public.job_orders(tenant_id,inferred_claim_id) values($1,$2)',[id(101),id(601)],/CLAIM_APPROVAL_REQUIRED/));
  await check('reenabling blocks a new status transition on an exempt pending-claim order',()=>fails(`update public.job_orders set status='completed' where claim_id=$1`,[id(601)],/CLAIM_APPROVAL_REQUIRED/));
  await check('unrelated notes or metadata updates do not invalidate prior exempt records',async()=>{
    await db.query('update public.job_orders set inferred_claim_id=null where claim_id=$1',[id(601)]);
    assert.equal((await db.query('select count(*)::integer as n from public.job_orders where claim_id=$1',[id(601)])).rows[0].n,1);
  });
  await check('claim creation provenance cannot be removed or rewritten afterwards',()=>fails(
    'update public.insurance_claims set workflow_requirement_revision=null where id=$1',[id(602)],/WORKFLOW_CLAIM_PROVENANCE_IMMUTABLE/));
  const completionAction='complete_order_with_workflow_exception';
  const completionAudit=async orderId=>(await db.query('select * from public.workflow_requirement_audit where entity_id=$1 and action=$2 order by created_at',[orderId,completionAction])).rows;
  await value('select public.set_workflow_requirement_policy(false,$1,4) as value',['Completion exception approved by administrator']);
  await actor(2);
  await db.query("insert into public.job_orders(id,tenant_id,status) values($1,$2,'received')",[id(701),id(101)]);
  await check('cash order completion atomically records the actual operator and canonical policy without a fake closing review',async()=>{
    await db.query("update public.job_orders set status='completed',metadata=$2 where id=$1",[id(701),{client_reason:'FORGED REASON',policy_revision:999}]);
    await actor(1);
    const [audit]=await completionAudit(id(701));assert.ok(audit);
    assert.equal(audit.actor_id,id(2));assert.equal(audit.actor_name,'Manager A');assert.equal(audit.policy_revision,5);
    assert.equal(audit.reason,'Completion exception approved by administrator');assert.equal(audit.requirements_enabled,false);
    assert.deepEqual(audit.details,{operation:'UPDATE',from_status:'received',to_status:'completed',claim_id:null,closing_review_recorded:false});
    assert.equal(await value("select metadata->'closingReview' as value from public.job_orders where id=$1",[id(701)]),null);
  });
  await check('an already approved insurance claim also gets a completion exception without changing its approval or amount',async()=>{
    await db.query("insert into public.insurance_claims(id,tenant_id,status,estimated_amount,estimate_date,vehicle_model) values($1,$2,'approved',123,current_date,'Existing model')",[id(703),id(101)]);
    await db.query("insert into public.job_orders(id,tenant_id,claim_id,status) values($1,$2,$3,'received')",[id(702),id(101),id(703)]);
    await db.query("update public.job_orders set status='completed' where id=$1",[id(702)]);
    const [audit]=await completionAudit(id(702));assert.ok(audit);assert.equal(audit.details.claim_id,id(703));
    assert.equal(await value('select status as value from public.insurance_claims where id=$1',[id(703)]),'approved');
    assert.equal(await value('select estimated_amount::integer as value from public.insurance_claims where id=$1',[id(703)]),123);
    assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='advance_order_without_claim_approval'",[id(702)]),0);
  });
  await check('unchanged completion status and unrelated metadata never create another completion exception',async()=>{
    await db.query("update public.job_orders set status=status,metadata=metadata||'{\"note\":\"preserved\"}'::jsonb where id=$1",[id(701)]);
    await db.query("update public.job_orders set metadata=metadata||'{\"another_note\":true}'::jsonb where id=$1",[id(701)]);
    assert.equal((await completionAudit(id(701))).length,1);
  });
  await check('nonfinal statuses and soft-deleted completion inserts create no completion exception',async()=>{
    await db.query("insert into public.job_orders(id,tenant_id,status) values($1,$2,'received')",[id(704),id(101)]);
    await db.query("update public.job_orders set status='in_progress' where id=$1",[id(704)]);
    await db.query("insert into public.job_orders(id,tenant_id,status,deleted_at) values($1,$2,'completed',now())",[id(705),id(101)]);
    assert.equal((await completionAudit(id(704))).length,0);assert.equal((await completionAudit(id(705))).length,0);
  });
  await check('a completed insert and a real transition to delivered each retain their own canonical completion event',async()=>{
    await db.query("insert into public.job_orders(id,tenant_id,status) values($1,$2,'completed')",[id(706),id(101)]);
    const [inserted]=await completionAudit(id(706));assert.equal(inserted.details.operation,'INSERT');assert.equal(inserted.details.from_status,null);
    await db.query("update public.job_orders set status='delivered' where id=$1",[id(706)]);
    const events=await completionAudit(id(706));assert.equal(events.length,2);assert.equal(events[1].details.from_status,'completed');assert.equal(events[1].details.to_status,'delivered');
  });
  await check('rolling back completion rolls back its exception in the same transaction',async()=>{
    await db.exec('begin');
    try {
      await db.query("update public.job_orders set status='completed' where id=$1",[id(704)]);
      assert.equal((await completionAudit(id(704))).length,1);
    } finally {await db.exec('rollback');}
    assert.equal(await value('select status as value from public.job_orders where id=$1',[id(704)]),'in_progress');
    assert.equal((await completionAudit(id(704))).length,0);
  });
  await check('completion uses the current server revision after a preflight policy read becomes stale',async()=>{
    const stale=await value('select public.get_workflow_requirement_policy() as value');assert.equal(stale.revision,5);
    await value('select public.set_workflow_requirement_policy(true,$1,5) as value',['Restored after stale preflight']);
    await value('select public.set_workflow_requirement_policy(false,$1,6) as value',['New canonical completion exception']);
    await db.query("update public.job_orders set status='completed',metadata=jsonb_build_object('policy_revision',$2::integer,'client_reason','stale preflight') where id=$1",[id(704),stale.revision]);
    const [audit]=await completionAudit(id(704));assert.equal(audit.policy_revision,7);assert.equal(audit.reason,'New canonical completion exception');
  });
  await check('restoring requirements stops completion exception records and retains historical evidence',async()=>{
    await value('select public.set_workflow_requirement_policy(true,$1,7) as value',['Normal closing checks restored']);
    await db.query("insert into public.job_orders(id,tenant_id,status) values($1,$2,'received')",[id(707),id(101)]);
    await db.query("update public.job_orders set status='completed',metadata='{\"closingReview\":{\"status\":\"جاهز للتسليم\"}}' where id=$1",[id(707)]);
    assert.equal((await completionAudit(id(707))).length,0);assert.equal((await completionAudit(id(704))).length,1);
  });
  const out=path.resolve(root,process.env.AAED_WORKFLOW_REQUIREMENTS_PROOF_DIR||'output/workflow-requirements');await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'database-verification.json'),JSON.stringify({engine:'PGlite 0.6.0 (local PostgreSQL/WASM)',scope:'isolated synthetic schema; no hosted connection',passed:checks.length,failed:0,checks},null,2));
  console.log(`PASS ${checks.length} isolated PostgreSQL checks`);
} catch(error) {
  console.error('FAIL',error.message);
  if(error.query) console.error('SQL',error.query);
  process.exitCode=1;
} finally {await db.close();}
