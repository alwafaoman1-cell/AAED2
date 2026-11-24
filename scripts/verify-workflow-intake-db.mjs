// Executes the actual intake gate migration in an isolated PostgreSQL/WASM DB.
// Only the unrelated atomic identity/save plumbing is stubbed below. It persists
// metadata so the real new triggers, review RPC and durable proofs are exercised.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {PGlite}=await import(pathToFileURL(path.join(root,'output/workflow-requirements-db-runtime/node_modules/@electric-sql/pglite/dist/index.js')).href);
const db=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const checks=[];
async function check(name,run){await run();checks.push({name,passed:true});console.log('PASS',name);}
async function value(sql,params=[]){return(await db.query(sql,params)).rows[0]?.value;}
async function fails(sql,params,pattern){await assert.rejects(db.query(sql,params),pattern);}
async function actor(n){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`);}
async function owner(){await db.exec('reset role');}
const migration=name=>fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
const callReview=`select public.create_vehicle_review_return($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::boolean,$8::numeric,$9::text,$10::boolean,$11::text) as value`;
const reviewArgs=(source,request,complete=false)=>[source,request,complete?'Brake review':'',complete?'Running':'','',complete?'Driver':'',true,complete?1200:null,complete?'running':'unknown',complete?false:null,''];
const saveForm=(patch={})=>({status:'Issued',customer_id:id(201),vehicle_id:id(301),customer:{name:'Customer'},vehicle:{plate_number:'1001',make:'Toyota'},condition:{running_status:'unknown',visit_purpose:'workshop'},delivered_by:{full_name:'Driver'},arrival_date:'2026-11-23',arrival_time:'10:00',...patch});
async function save(form){return value('select public.save_vehicle_entry_intake(null,null,$1::jsonb,null,null) as value',[JSON.stringify(form)]);}
async function source(n,{signed=true,tenant=id(101),stage='delivered'}={}){
 const entry=id(n),handover=id(n+1),customer=id(n+2),vehicle=id(n+3);
 await owner();
 await db.query('insert into public.customers(id,tenant_id,name,phone)values($1,$2,$3,$4)',[customer,tenant,'Source customer','+96899112233']);
 await db.query('insert into public.vehicles(id,tenant_id,plate_number,plate_letters,plate_country,brand,model,year)values($1,$2,$3,$4,$5,$6,$7,$8)',[vehicle,tenant,String(n),'AA','OM','Toyota','Camry','2022']);
 await db.query(`insert into public.vehicle_entries(id,tenant_id,vehicle_id,customer_id,status,delivered_by,vehicle_condition,entry_number,arrival_date,arrival_time)
  values($1,$2,$3,$4,'Issued','{"full_name":"Source driver"}','{"running_status":"running"}',$5,'2026-11-20','10:00')`,[entry,tenant,vehicle,customer,`ENT-${n}`]);
 await db.query(`insert into public.vehicle_handover_records(id,tenant_id,vehicle_entry_id,vehicle_id,status,delivered_at,finalized_at,signature_data_url,receipt_number)
  values($1,$2,$3,$4,'finalized',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',$5,$6)`,[handover,tenant,entry,vehicle,signed?'synthetic-signature':null,`HAND-${n}`]);
 await db.query('insert into public.vehicle_visit_workflows(entry_id,tenant_id,stage)values($1,$2,$3)',[entry,tenant,stage]);
 return{entry,handover,customer,vehicle,tenant};
}
async function auditProof(rowId,{tenant=id(101),entity=rowId,actorId=id(1),action='create_review_return'}={}){
 await owner();
 return value(`insert into public.workflow_requirement_audit(tenant_id,entity_type,entity_id,action,actor_id,actor_name,policy_revision,reason,requirements_enabled,details)
  values($1,'vehicle_review_return',$2,$3,$4,'Synthetic negative-test actor',1,'Synthetic proof fixture',false,'{}')returning id as value`,[tenant,entity,action,actorId]);
}
async function insertReview(rowId,proof,s,entry){return db.query(`insert into public.vehicle_review_returns(id,tenant_id,request_id,source_entry_id,source_handover_id,return_entry_id,reason,arrival_condition,arrived_at,recorded_by,requirements_exception_id)
 values($1,$2,$3,$4,$5,$6,'','',clock_timestamp(),$7,$8)`,[rowId,s.tenant,id(Number(rowId.slice(-12))+1),s.entry,s.handover,entry,id(1),proof]);}

try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema app_private;
 create table public.tenants(id uuid primary key);
 create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid unique,tenant_id uuid,role text,account_status text,disabled_at timestamptz,full_name text);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.get_user_tenant_id()returns uuid language sql stable security definer as $$select tenant_id from public.profiles where user_id=auth.uid()$$;
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant execute on function auth.uid(),public.get_user_tenant_id() to authenticated,anon,service_role;
 grant select on public.profiles to authenticated;
 alter table public.profiles enable row level security;
 create policy profiles_own_read on public.profiles for select to authenticated using(user_id=auth.uid());
 insert into public.tenants values('${id(101)}'),('${id(102)}');
 insert into public.profiles(user_id,tenant_id,role,account_status,full_name)values
 ('${id(1)}','${id(101)}','admin','active','Admin A'),('${id(2)}','${id(101)}','manager','active','Manager A'),('${id(3)}','${id(102)}','admin','active','Admin B');
 create table public.customers(id uuid primary key,tenant_id uuid,name text,phone text,deleted_at timestamptz);
 create table public.vehicles(id uuid primary key,tenant_id uuid,plate_number text,plate_letters text,plate_country text,brand text,model text,year text,color text,vin text,vin_number text,deleted_at timestamptz);
 create table public.vehicle_entries(id uuid primary key default gen_random_uuid(),tenant_id uuid,vehicle_id uuid,customer_id uuid,status text,
  delivered_by jsonb default '{}',vehicle_condition jsonb default '{}',vehicle_snapshot jsonb default '{}',intake_revision integer default 1,custody_receipt_required boolean default true,
  entry_number text,arrival_date date,arrival_time time,insurance_claim_id uuid,converted_claim_id uuid,insurance_snapshot jsonb default '{}',declaration_ar text,declaration_en text,deleted_at timestamptz);
 create table public.vehicle_handover_records(id uuid primary key,tenant_id uuid,vehicle_entry_id uuid,vehicle_id uuid,status text,delivered_at timestamptz,finalized_at timestamptz,signature_data_url text,snapshot_json jsonb default '{}',receipt_number text);
 create table public.vehicle_visit_workflows(entry_id uuid primary key,tenant_id uuid,stage text);
 create table public.vehicle_entry_audit_logs(id uuid default gen_random_uuid(),tenant_id uuid,vehicle_entry_id uuid,user_id uuid,action text,new_value jsonb);
 create function public.save_vehicle_entry_intake(p_entry_id uuid,p_expected_updated_at timestamptz,p_form jsonb,p_technical jsonb default null,p_technical_revision integer default null)
 returns jsonb language plpgsql security definer set search_path='' as $$declare e public.vehicle_entries;begin
  insert into public.vehicle_entries(tenant_id,vehicle_id,customer_id,status,delivered_by,vehicle_condition,vehicle_snapshot,entry_number,arrival_date,arrival_time,insurance_snapshot,declaration_ar,declaration_en)
  values(public.get_user_tenant_id(),(p_form->>'vehicle_id')::uuid,(p_form->>'customer_id')::uuid,p_form->>'status',p_form->'delivered_by',p_form->'condition',p_form->'vehicle',gen_random_uuid()::text,(p_form->>'arrival_date')::date,(p_form->>'arrival_time')::time,coalesce(p_form->'insurance','{}'::jsonb),p_form->>'declaration_ar',p_form->>'declaration_en')returning *into e;
  return jsonb_build_object('entry',to_jsonb(e));end$$;
 revoke all on function public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)from public,anon,service_role;
 grant execute on function public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)to authenticated;`);
 await db.exec(await migration('20261123140431_workflow_requirement_policy.sql'));
 const oldReceipts=await migration('20261112094812_vehicle_intake_custody_receipts.sql');
 const immutable=oldReceipts.match(/create function app_private\.custody_immutable\(\)[\s\S]*?\$\$;/i)?.[0];assert.ok(immutable);
 await db.exec(immutable);
 const oldReview=await migration('20261114075025_vehicle_review_return_and_receipt_delivery_confirmation.sql');
 await db.exec(oldReview.slice(oldReview.indexOf('create table public.vehicle_review_returns'),oldReview.indexOf('create function public.create_vehicle_review_return')));
 const oldPortal=await migration('20261114143701_unified_vehicle_customer_portal.sql');
 await db.exec(oldPortal.slice(oldPortal.indexOf('create function app_private.guard_new_intake_running_status'),oldPortal.indexOf('create or replace function app_private.advance_review_visit')));
 await db.exec(await migration('20261123140433_workflow_requirement_intake_gates.sql'));
 await db.exec(`create function public.test_handover_exception(p_id uuid)returns uuid language plpgsql security definer set search_path=''as $$begin return app_private.record_workflow_requirement_override(public.get_user_tenant_id(),'vehicle_handover',p_id,'finalize_handover','{"missing_fields":["signature"]}');end$$;revoke all on function public.test_handover_exception(uuid)from public;grant execute on function public.test_handover_exception(uuid)to authenticated;`);
 await actor(1);
 await check('strict new issued intake requires a running observation',()=>assert.rejects(save(saveForm()),/VEHICLE_INTAKE_RUNNING_STATUS_REQUIRED/));
 await check('strict new intake requires the deliverer field without affecting historic records',()=>assert.rejects(save(saveForm({condition:{running_status:'running'},delivered_by:{full_name:''}})),/VEHICLE_INTAKE_INVALID_FORM/));
 await check('strict draft keeps the existing editor deliverer-name requirement',()=>assert.rejects(save(saveForm({status:'Draft',delivered_by:{full_name:''}})),/VEHICLE_INTAKE_INVALID_FORM/));
 await value('select public.set_workflow_requirement_policy(false,$1,0)as value',['Local intake exception']);
 let relaxedEntry;
 await check('relaxed intake stores unknown observations and audits the exact missing fields',async()=>{
  relaxedEntry=(await save(saveForm({delivered_by:{full_name:''}}))).entry;
  assert.equal(relaxedEntry.vehicle_condition.running_status,'unknown');assert.equal(relaxedEntry.delivered_by.full_name,'');
  await owner();const audit=(await db.query(`select *from public.workflow_requirement_audit where entity_id=$1 and action='save_vehicle_entry'`,[relaxedEntry.id])).rows[0];
  assert.deepEqual(audit.details.missing_fields,['running_status','delivered_by']);assert.equal(audit.actor_id,id(1));assert.equal(audit.reason,'Local intake exception');await actor(1);
 });
 await check('relaxed blank draft is saved and audits only the waived deliverer field',async()=>{
  const entry=(await save(saveForm({status:'Draft',delivered_by:{full_name:''}}))).entry;assert.equal(entry.status,'Draft');
  await owner();const audit=(await db.query(`select *from public.workflow_requirement_audit where entity_id=$1 and action='save_vehicle_entry'`,[entry.id])).rows[0];
  assert.deepEqual(audit.details.missing_fields,['delivered_by']);assert.equal(entry.vehicle_condition.running_status,'unknown');await actor(1);
 });
 const signed=await source(1000);await actor(1);let review;
 await check('relaxed review allows blank fields only with the real bound audit proof',async()=>{
  review=await value(callReview,reviewArgs(signed.entry,id(1100)));
  assert.ok(review.requirements_exception_id);await owner();
  const row=(await db.query('select *from public.vehicle_review_returns where return_entry_id=$1',[review.entry_id])).rows[0];
  const entry=(await db.query('select *from public.vehicle_entries where id=$1',[review.entry_id])).rows[0];
  const audit=(await db.query('select *from public.workflow_requirement_audit where id=$1',[row.requirements_exception_id])).rows[0];
  assert.equal(row.reason,'');assert.equal(row.arrival_condition,'');assert.equal(audit.entity_id,row.id);assert.equal(audit.action,'create_review_return');
  assert.equal(audit.actor_id,row.recorded_by);assert.equal(audit.reason,'Local intake exception');
  assert.equal(entry.vehicle_snapshot.mileage,null);assert.equal(entry.vehicle_condition.new_damage,null);assert.equal(entry.vehicle_condition.running_status,'unknown');
  assert.equal(entry.vehicle_condition.review_return.requirements_exception_id,row.requirements_exception_id);assert.equal(entry.vehicle_condition.review_return.source_handover_id,signed.handover);
  assert.equal((await db.query('select signature_data_url from public.vehicle_handover_records where id=$1',[signed.handover])).rows[0].signature_data_url,'synthetic-signature');await actor(1);
 });
 await check('physical arrival and invalid observation values never become optional',async()=>{
  const args=reviewArgs(signed.entry,id(1101));args[6]=false;await fails(callReview,args,/REVIEW_RETURN_DETAILS_REQUIRED/);
  args[6]=true;args[7]=-1;await fails(callReview,args,/REVIEW_RETURN_DETAILS_REQUIRED/);args[7]=null;args[8]='fake-running';await fails(callReview,args,/REVIEW_RETURN_DETAILS_REQUIRED/);
 });
 for(const[name,change]of Object.entries({tenant:{tenant:id(102)},actor:{actorId:id(2)},entity:{entity:id(4999)},action:{action:'different_action'}})){
  await check(`review exception proof rejects a mismatched ${name}`,async()=>{
   const rowId=id(2000+checks.length*10);const proof=await auditProof(rowId,change);
   const entry=(await save(saveForm({condition:{running_status:'running'}}))).entry;
   await assert.rejects(insertReview(rowId,proof,signed,entry.id),/REVIEW_RETURN_EXCEPTION_PROOF_INVALID/);
  });
 }
 const unsigned=await source(3000,{signed:false});await actor(1);
 await check('unsigned source delivery without its own durable exception is rejected',()=>fails(callReview,reviewArgs(unsigned.entry,id(3100),true),/REVIEW_RETURN_DELIVERY_REQUIRED/));
 await value('select public.test_handover_exception($1)as value',[unsigned.handover]);
 await check('unsigned source delivery with its own durable audited finalization is accepted without fabricating a signature',async()=>{
  const result=await value(callReview,reviewArgs(unsigned.entry,id(3100),true));assert.ok(result.entry_id);await owner();
  assert.equal((await db.query('select signature_data_url from public.vehicle_handover_records where id=$1',[unsigned.handover])).rows[0].signature_data_url,null);await actor(1);
 });
 await value('select public.set_workflow_requirement_policy(true,$1,1)as value',['Restore normal intake requirements']);
 await check('reenabling preserves old relaxed rows and idempotent retries',async()=>{
  const again=await value(callReview,reviewArgs(signed.entry,id(1100)));assert.equal(again.entry_id,review.entry_id);assert.equal(again.existing,true);
  await owner();await db.exec('alter table public.vehicle_review_returns validate constraint vehicle_review_returns_reason_check;alter table public.vehicle_review_returns validate constraint vehicle_review_returns_arrival_condition_check;');
  assert.equal((await db.query('select requirements_exception_id from public.vehicle_review_returns where return_entry_id=$1',[review.entry_id])).rows[0].requirements_exception_id,review.requirements_exception_id);await actor(1);
 });
 const fresh=await source(4000);await actor(1);
 await check('reenabling rejects new incomplete reviews',()=>fails(callReview,reviewArgs(fresh.entry,id(4100)),/REVIEW_RETURN_DETAILS_REQUIRED/));
 await check('review exceptions and source links cannot be rewritten',async()=>{
  await owner();await fails('update public.vehicle_review_returns set requirements_exception_id=null where return_entry_id=$1',[review.entry_id],/CUSTODY_SIGNED_EVIDENCE_IMMUTABLE/);await actor(1);
 });
 await check('another tenant cannot use a source entry from this tenant',async()=>{
  await actor(3);await fails(callReview,reviewArgs(signed.entry,id(4200),true),/REVIEW_RETURN_SOURCE_INVALID/);await actor(1);
 });
 await check('anonymous caller cannot create a review intake',async()=>{
  await db.exec('reset role;set role anon;');await fails(callReview,reviewArgs(signed.entry,id(4300),true),/permission denied/i);await actor(1);
 });
 await check('reenabling still permits cancelling a historical blank draft',async()=>{
  await owner();await db.exec('alter table public.vehicle_entries disable trigger new_intake_running_status');
  await db.query(`insert into public.vehicle_entries(id,tenant_id,status)values($1,$2,'Draft')`,[id(5000),id(101)]);
  await db.exec('alter table public.vehicle_entries enable trigger new_intake_running_status');
  await db.query(`update public.vehicle_entries set status='Cancelled'where id=$1`,[id(5000)]);
  assert.equal((await db.query('select status from public.vehicle_entries where id=$1',[id(5000)])).rows[0].status,'Cancelled');await actor(1);
 });
 const out=path.join(root,'output/workflow-requirements');await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'intake-db.json'),JSON.stringify({engine:'PGlite 0.6.0 (isolated PostgreSQL/WASM)',scope:'Actual migration433, corepolicy, realintaketrigger/reviewRPC/proofconstraints; atomiccustomer/vehicleidentitysaveplumbing is a metadata-persisting stub; no hostedconnection',passed:checks.length,failed:0,checks},null,2));
 console.log(`PASS ${checks.length} isolated intake PostgreSQL checks`);
}catch(error){console.error('FAIL',error.message);if(error.query)console.error('SQL',error.query);process.exitCode=1;}finally{await db.close();}
