// Local PostgreSQL/WASM only. Uses real migration function bodies and triggers;
// it never connects to Supabase, reads credentials, or changes a hosted project.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {PGlite}=await import(pathToFileURL(path.join(root,'output/workflow-requirements-db-runtime/node_modules/@electric-sql/pglite/dist/index.js')).href);
const db=await PGlite.create();
const checks=[];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=name=>fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
const sources={
 core:await read('20260829100000_vehicle_exit_handover_ssot.sql'),
 workflow:await read('20261102084428_vehicle_visit_lifecycle_center.sql'),
 evidence:await read('20261102085503_vehicle_visit_delivery_evidence_guard.sql'),
 custody:await read('20261102091108_vehicle_visit_custody_and_link_guards.sql'),
 receipt:await read('20261112094812_vehicle_intake_custody_receipts.sql'),
 review:await read('20261114131838_review_visit_reuses_prior_workflow.sql'),
 manager:await read('20261117082245_vehicle_visit_manager_controls.sql'),
};
function functionDDL(source,name){
 const pattern=new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name.replaceAll('.','\\.')}\\s*\\(`,'ig');
 const matches=[...source.matchAll(pattern)];assert.ok(matches.length,`Missing actual function ${name}`);
 const start=matches.at(-1).index;
 const rest=source.slice(start);const body=/\bas\s+(\$[a-zA-Z_]*\$)/i.exec(rest);assert.ok(body,`Missing function body ${name}`);
 const end=rest.indexOf(body[1],body.index+body[0].length);assert.ok(end>=0);
 return rest.slice(0,rest.indexOf(';',end+body[1].length)+1);
}
function tableDDL(source,name){
 const pattern=new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${name.replaceAll('.','\\.')}\\s*\\(`,'i');
 const start=source.search(pattern);assert.ok(start>=0,`Missing actual table ${name}`);
 const end=source.indexOf('\n);',start);assert.ok(end>start);return source.slice(start,end+3);
}
async function loadFunction(source,name){await db.exec(functionDDL(source,name));}
async function check(name,run){await run();checks.push({name,passed:true});console.log('PASS',name);}
async function value(sql,args=[]){return (await db.query(sql,args)).rows[0]?.value;}
async function fails(sql,args,pattern){await assert.rejects(db.query(sql,args),pattern);}
async function actor(n=1){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`);}
async function policy(enabled){
 const p=await value('select public.get_workflow_requirement_policy() as value');
 return value('select public.set_workflow_requirement_policy($1,$2,$3) as value',[enabled,'Local synthetic documented exception',p.revision]);
}
async function fixture(n,{claimStatus='pending',orderStatus='received',recipient='',signature=null,receipt=false}={}){
 await db.exec("reset role;select set_config('app.vehicle_visit_manual_transition','on',false)");
 const ids={entry:id(n),vehicle:id(n+1000),customer:id(n+2000),claim:id(n+3000),order:id(n+4000),handover:id(n+5000),signature:id(n+6000),revision:id(n+7000),receipt:id(n+8000)};
 await db.query('insert into public.vehicles(id) values($1)',[ids.vehicle]);
 await db.query('insert into public.customers(id) values($1)',[ids.customer]);
 await db.query(`insert into public.vehicle_entries(id,tenant_id,vehicle_id,customer_id,entry_number,insurance_claim_id,work_order_id)
  values($1,$2,$3,$4,$5,$6,$7)`,[ids.entry,id(101),ids.vehicle,ids.customer,`ENT-${n}`,ids.claim,ids.order]);
 await db.query(`insert into public.insurance_claims(id,tenant_id,vehicle_id,customer_id,vehicle_entry_id,status,claim_number)
  values($1,$2,$3,$4,$5,$6,$7)`,[ids.claim,id(101),ids.vehicle,ids.customer,ids.entry,claimStatus,`CLAIM-${n}`]);
 await db.query(`insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,vehicle_entry_id,claim_id,status,work_order_type,order_number)
  values($1,$2,$3,$4,$5,$6,$7,'insurance',$8)`,[ids.order,id(101),ids.vehicle,ids.customer,ids.entry,ids.claim,orderStatus,`WO-${n}`]);
 await db.query(`insert into public.vehicle_visit_workflows(entry_id,tenant_id,vehicle_id,stage) values($1,$2,$3,'arrived')`,[ids.entry,id(101),ids.vehicle]);
 if(receipt){
  await db.query(`insert into public.vehicle_entry_signatures(id,tenant_id,vehicle_entry_id,intake_revision,signature_role,signature_data_url) values($1,$2,$3,1,'delivered_by','ORIGINAL-INTAKE-SIGNATURE')`,[ids.signature,id(101),ids.entry]);
  await db.query(`insert into public.vehicle_entry_signed_revisions(id,tenant_id,vehicle_entry_id,revision,signature_id,snapshot,signed_at) values($1,$2,$3,1,$4,$5,now())`,[ids.revision,id(101),ids.entry,ids.signature,JSON.stringify({frozen:'ORIGINAL-INTAKE-SNAPSHOT'})]);
  await db.query(`insert into public.vehicle_entry_custody_receipts(id,tenant_id,vehicle_entry_id,vehicle_id,revision_id,signature_id,receipt_number) values($1,$2,$3,$4,$5,$6,$7)`,[ids.receipt,id(101),ids.entry,ids.vehicle,ids.revision,ids.signature,`VR-${n}`]);
 }
 await db.exec("select set_config('app.vehicle_visit_manual_transition','',false)");await actor();
 await db.query(`insert into public.vehicle_handover_records(id,tenant_id,work_order_id,claim_id,vehicle_id,customer_id,vehicle_entry_id,recipient_name,signature_data_url,snapshot_json)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[ids.handover,id(101),ids.order,ids.claim,ids.vehicle,ids.customer,ids.entry,recipient,signature,JSON.stringify(receipt?{custodyReceiptId:ids.receipt,paperSignatureConfirmed:false}:{paperSignatureConfirmed:false})]);
 return ids;
}
try{
 // Synthetic supporting schema: financial calculations/storage/public portal
 // are intentionally outside this verifier. No business guard is replaced by a stub.
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;create schema app_private;create table auth.users(id uuid primary key);
  create type public.app_role as enum('admin','owner','manager','insurance','supervisor','technician','customer');
  create table public.tenants(id uuid primary key);
  create table public.profiles(user_id uuid primary key,tenant_id uuid,role public.app_role,account_status text,disabled_at timestamptz,full_name text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function public.get_user_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where user_id=auth.uid()$$;
  create function public.get_user_role() returns public.app_role language sql stable security definer as $$select role from public.profiles where user_id=auth.uid()$$;
  create table public.tenant_settings(tenant_id uuid,key text,value jsonb);
  create table public.vehicles(id uuid primary key);create table public.customers(id uuid primary key);
  create table public.vehicle_entries(id uuid primary key,tenant_id uuid,vehicle_id uuid,customer_id uuid,entry_number text,
   status text not null default 'Received',deleted_at timestamptz,arrival_date date default (current_date-2),arrival_time time default '09:00',
   intake_revision integer not null default 1,custody_receipt_required boolean not null default true,
   vehicle_location text default 'داخل الورشة',vehicle_location_bay text,insurance_claim_id uuid,converted_claim_id uuid,work_order_id uuid,converted_work_order_id uuid,
   insurance_company_id uuid,insurance_snapshot jsonb default '{}',vehicle_condition jsonb default '{}',customer_snapshot jsonb default '{}',vehicle_snapshot jsonb default '{}',
   updated_at timestamptz default now(),updated_by uuid);
  create table public.insurance_claims(id uuid primary key,tenant_id uuid,vehicle_id uuid,customer_id uuid,vehicle_entry_id uuid,claim_number text,status text,deleted_at timestamptz,
   approved_at timestamptz,insurance_approved_at timestamptz,work_started_at timestamptz,work_completed_at timestamptz,delivered_at timestamptz,vehicle_delivered_at timestamptz,
   vehicle_presence_status text default 'in_workshop',repair_stage text,receiver_name text,receiver_id_number text,receiver_id_photo text,delivery_notes text,
   vehicle_location_note text,vehicle_location_section text,vehicle_location_bay text,vehicle_location_updated_at timestamptz,vehicle_location_updated_by uuid,updated_at timestamptz default now());
  create table public.job_orders(id uuid primary key,tenant_id uuid,vehicle_id uuid,customer_id uuid,vehicle_entry_id uuid,claim_id uuid,order_number text,
   work_order_type text,status text,deleted_at timestamptz,parent_work_order_id uuid,visit_number integer,work_started_at timestamptz,work_completed_at timestamptz,vehicle_delivered_at timestamptz,
   vehicle_presence_status text default 'in_workshop',vehicle_location_note text,vehicle_location_section text,vehicle_location_bay text,updated_at timestamptz default now());
  create table public.claim_work_order_operations(id uuid,tenant_id uuid,work_order_id uuid,claim_id uuid,vehicle_delivered_at timestamptz,vehicle_presence_status text,
   operational_status text,repair_stage text,vehicle_location_note text,vehicle_location_section text,vehicle_location_bay text,vehicle_location_updated_at timestamptz,
   vehicle_location_updated_by uuid,updated_at timestamptz,last_changed_from text,last_changed_by uuid);
  create table public.vehicle_entry_signatures(id uuid primary key,tenant_id uuid,vehicle_entry_id uuid,intake_revision integer,signature_role text,signature_data_url text);
  create table public.vehicle_review_returns(id uuid primary key,tenant_id uuid,source_entry_id uuid,source_handover_id uuid,return_entry_id uuid unique);
  create table public.vehicle_inspection_releases(id uuid,tenant_id uuid,vehicle_entry_id uuid,work_order_id uuid,claim_id uuid,status text,returned_at timestamptz,returned_by uuid,
   released_at timestamptz,signature_data_url text,entry_snapshot jsonb,updated_at timestamptz);
  create table public.vehicle_entry_audit_logs(tenant_id uuid,vehicle_entry_id uuid,user_id uuid,action text,old_value jsonb,new_value jsonb,reason text,created_at timestamptz default now());
  grant usage on schema public,auth to authenticated,anon,service_role;
  grant select on public.profiles to authenticated;
  alter table public.profiles enable row level security;
  create policy profiles_own_read on public.profiles for select to authenticated using(user_id=auth.uid());
  insert into public.tenants values('${id(101)}'),('${id(102)}');
  insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
  insert into public.profiles values('${id(1)}','${id(101)}','admin','active',null,'Admin A'),
   ('${id(2)}','${id(102)}','admin','active',null,'Admin B'),('${id(3)}','${id(101)}','technician','active',null,'Tech A'),('${id(4)}','${id(101)}','admin','disabled',now(),'Disabled A');
 `);
 for(const name of ['public.vehicle_handover_sequences','public.vehicle_handover_records']) await db.exec(tableDDL(sources.core,name));
 await db.exec('alter table public.vehicle_handover_records add column review_return_id uuid references public.vehicle_review_returns(id)');
 for(const name of ['public.vehicle_visit_workflows','public.vehicle_visit_transitions']) await db.exec(tableDDL(sources.workflow,name));
 await db.exec("alter table public.vehicle_visit_workflows add column manager_adjustment jsonb not null default '{}'");
 for(const name of ['public.vehicle_entry_signed_revisions','public.vehicle_entry_custody_receipts','public.vehicle_entry_custody_audit']) await db.exec(tableDDL(sources.receipt,name));
 // Maintain real uniqueness and immutability for the receipt/visit evidence.
 await db.exec(`create unique index vehicle_entry_one_active_custody_receipt on public.vehicle_entry_custody_receipts(tenant_id,vehicle_entry_id) where status='issued';
  create unique index vehicle_visit_one_open_per_vehicle on public.vehicle_visit_workflows(tenant_id,vehicle_id) where stage not in ('delivered','cancelled');
  create unique index vehicle_handover_one_draft_per_work_order on public.vehicle_handover_records(tenant_id,work_order_id) where status='draft';
  create unique index vehicle_handover_one_active_final_per_work_order on public.vehicle_handover_records(tenant_id,work_order_id) where status='finalized' and review_return_id is null;
  create unique index vehicle_handover_one_final_per_review on public.vehicle_handover_records(tenant_id,review_return_id) where status='finalized' and review_return_id is not null;`);
 await db.exec('set check_function_bodies=false');
 for(const [source,names] of [
  [sources.workflow,['public.vehicle_visit_stage_rank','public.vehicle_visit_has_conflicting_entry','public.vehicle_visit_source_changed']],
  [sources.receipt,['app_private.custody_can','app_private.custody_immutable','app_private.custody_consume_at_delivery']],
  [sources.review,['app_private.review_visit_context','app_private.bind_vehicle_handover_visit','app_private.guard_review_handover_relation','public.finalize_vehicle_handover','public.guard_vehicle_handover_immutability','public.vehicle_visit_evidence_stage','public.vehicle_intake_receipt_document']],
  [sources.evidence,['public.vehicle_visit_handover_changed']],
  [sources.custody,['public.vehicle_visit_handover_custody']],
  [sources.manager,['app_private.vehicle_visit_manager_presence','app_private.vehicle_visit_manager_stage_active','app_private.vehicle_visit_manager_stage_dates','app_private.vehicle_visit_manager_context','public.adjust_vehicle_visit_manager','app_private.guard_vehicle_handover_manager_time','app_private.guard_vehicle_visit_manager_adjustment','app_private.clear_vehicle_visit_manager_presence']],
 ]) for(const name of names) await loadFunction(source,name);
 const actualManagerBodies=[...sources.manager.matchAll(/execute \$manager_definition\$([\s\S]*?)\$manager_definition\$;/g)].map(m=>m[1]);
 for(const name of ['app_private.advance_review_visit','public.advance_vehicle_visit','public.sync_vehicle_visit_from_source','app_private.custody_guard_exit_projection']) {
  const body=actualManagerBodies.find(s=>s.includes(`FUNCTION ${name}(`));assert.ok(body,`Missing latest manager body ${name}`);await db.exec(body);
 }
 await db.exec(`
  create trigger trg_00_bind_vehicle_handover_visit before insert or update on public.vehicle_handover_records for each row execute function app_private.bind_vehicle_handover_visit();
  create trigger trg_01_review_handover_relation before insert or update on public.vehicle_handover_records for each row execute function app_private.guard_review_handover_relation();
  create trigger trg_guard_vehicle_handover_immutability before update or delete on public.vehicle_handover_records for each row execute function public.guard_vehicle_handover_immutability();
  create trigger trg_vehicle_handover_manager_time before update of status on public.vehicle_handover_records for each row execute function app_private.guard_vehicle_handover_manager_time();
  create trigger zz_custody_consume_at_delivery before update of status on public.vehicle_handover_records for each row execute function app_private.custody_consume_at_delivery();
  create trigger trg_vehicle_visit_handover_custody after update of status on public.vehicle_handover_records for each row execute function public.vehicle_visit_handover_custody();
  create trigger trg_vehicle_visit_handover_changed after update of status on public.vehicle_handover_records for each row execute function public.vehicle_visit_handover_changed();
  create trigger custody_revision_immutable before update or delete on public.vehicle_entry_signed_revisions for each row execute function app_private.custody_immutable();
  create trigger custody_audit_immutable before update or delete on public.vehicle_entry_custody_audit for each row execute function app_private.custody_immutable();
  create trigger custody_signature_immutable before update or delete on public.vehicle_entry_signatures for each row execute function app_private.custody_immutable();
  create trigger zz_custody_guard_exit before update on public.job_orders for each row execute function app_private.custody_guard_exit_projection();
  create trigger zz_custody_guard_exit before update on public.insurance_claims for each row execute function app_private.custody_guard_exit_projection();
  create trigger zz_custody_guard_exit before update on public.vehicle_entries for each row execute function app_private.custody_guard_exit_projection();
  create trigger trg_vehicle_visit_order_changed after insert or update of status,work_started_at,work_completed_at,vehicle_delivered_at,deleted_at on public.job_orders for each row execute function public.vehicle_visit_source_changed();
  create trigger trg_vehicle_visit_claim_changed after insert or update of status,repair_stage,work_started_at,work_completed_at,vehicle_delivered_at,delivered_at,approved_at,insurance_approved_at,deleted_at on public.insurance_claims for each row execute function public.vehicle_visit_source_changed();
  create trigger trg_00_vehicle_visit_manager_adjustment before insert or update on public.vehicle_visit_workflows for each row execute function app_private.guard_vehicle_visit_manager_adjustment();
  create trigger trg_vehicle_visit_manager_presence_changed after update of vehicle_location on public.vehicle_entries for each row execute function app_private.clear_vehicle_visit_manager_presence();
 `);
 await db.exec('set check_function_bodies=true');
 await db.exec(await read('20261123140431_workflow_requirement_policy.sql'));
 await check('migration435 applies to actual baseline finalizer and latest manager function bodies',()=>read('20261123140435_workflow_requirement_lifecycle_gates.sql').then(sql=>db.exec(sql)));
 await db.exec(`create trigger trg_vehicle_visit_delivery_guard before update of stage on public.vehicle_visit_workflows for each row execute function public.vehicle_visit_delivery_guard();
  grant select on all tables in schema public to authenticated;
  grant insert,update on public.vehicle_handover_records to authenticated;
  revoke all on function app_private.custody_guard_exit_projection(),app_private.workflow_handover_exception(uuid,uuid) from public,anon,authenticated,service_role;
  grant execute on function public.finalize_vehicle_handover(uuid),public.advance_vehicle_visit(uuid,integer,text,timestamptz,text,text,uuid,jsonb),public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text,timestamptz),public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text),public.vehicle_intake_receipt_document(uuid) to authenticated;
 `);
 await actor();
 const blank=await fixture(201);
 await check('strict finalization rejects missing actual recipient without allocating delivery or audit',()=>fails('select public.finalize_vehicle_handover($1)',[blank.handover],/VEHICLE_HANDOVER_RECIPIENT_REQUIRED/));
 const noSignature=await fixture(202,{recipient:'Actual recipient'});
 await check('strict finalization rejects missing electronic or paper evidence',()=>fails('select public.finalize_vehicle_handover($1)',[noSignature.handover],/VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED/));
 const noReceipt=await fixture(203,{recipient:'Actual recipient',signature:'data:image/png;base64,TkVX'});
 await check('strict finalization rejects a missing visit receipt and rolls back number allocation',async()=>{
  await fails('select public.finalize_vehicle_handover($1)',[noReceipt.handover],/CUSTODY_RECEIPT_REQUIRED/);
  assert.equal(await value('select count(*)::integer as value from public.vehicle_handover_sequences'),0);
 });
 await check('strict stage advance rejects an unapproved insurance claim',()=>fails('select public.advance_vehicle_visit($1,0,$2,now(),null,null,null,\'{}\'::jsonb)',[blank.entry,'approved'],/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/));
 await policy(false);
 let blankFinal;
 await check('disabled policy finalizes without inventing recipient, signature, paper confirmation or receipt',async()=>{
  blankFinal=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[blank.handover]);
  assert.equal(blankFinal.status,'finalized');assert.equal(blankFinal.recipient_name,'');assert.equal(blankFinal.signature_data_url,null);
  assert.equal(blankFinal.snapshot_json.paperSignatureConfirmed,false);assert.ok(blankFinal.snapshot_json.workflowRequirementOverrideId);
  assert.equal(await value('select count(*)::integer as value from public.vehicle_entry_custody_receipts where vehicle_entry_id=$1',[blank.entry]),0);
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[blank.claim]),'pending');
  assert.equal(await value('select stage as value from public.vehicle_visit_workflows where entry_id=$1',[blank.entry]),'delivered');
 });
 await check('exception actor, reason, entity and policy revision are canonical and immutable',async()=>{
  const audit=await value('select to_jsonb(a) as value from public.workflow_requirement_audit a where id=$1',[blankFinal.snapshot_json.workflowRequirementOverrideId]);
  assert.equal(audit.actor_id,id(1));assert.equal(audit.entity_id,blank.handover);assert.equal(audit.action,'finalize_handover');assert.equal(audit.reason,'Local synthetic documented exception');
  await db.exec('reset role');await fails('update public.workflow_requirement_audit set reason=\'changed\' where id=$1',[audit.id],/WORKFLOW_AUDIT_IMMUTABLE/);await actor();
 });
 await check('repeat finalization returns the same final record without a duplicate number or audit',async()=>{
  const repeated=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[blank.handover]);assert.equal(repeated.receipt_number,blankFinal.receipt_number);
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='finalize_handover'",[blank.handover]),1);
 });
 const supplied=await fixture(204,{receipt:true});
 await check('a supplied valid receipt is consumed exactly once even with an unrecorded recipient',async()=>{
  const result=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[supplied.handover]);
  const receipt=await value('select to_jsonb(c) as value from public.vehicle_entry_custody_receipts c where id=$1',[supplied.receipt]);
  assert.equal(receipt.status,'used');assert.equal(receipt.handover_id,supplied.handover);assert.equal(receipt.actual_recipient_name,null);
  assert.equal(receipt.workflow_requirement_override_id,result.snapshot_json.workflowRequirementOverrideId);
 });
 const wrong=await fixture(205);
 await db.query('update public.vehicle_handover_records set snapshot_json=jsonb_build_object(\'custodyReceiptId\',$2::text) where id=$1',[wrong.handover,supplied.receipt]);
 await check('a wrong-visit receipt cannot be excused by disabled policy',()=>fails('select public.finalize_vehicle_handover($1)',[wrong.handover],/CUSTODY_WRONG_VISIT/));
 await db.query('update public.vehicle_handover_records set snapshot_json=jsonb_build_object(\'custodyReceiptId\',$2::text) where id=$1',[wrong.handover,id(999999)]);
 await check('a nonexistent supplied receipt cannot be ignored by disabled policy',()=>fails('select public.finalize_vehicle_handover($1)',[wrong.handover],/CUSTODY_NOT_VALID/));
 const reuse=id(99001);
 await db.query(`insert into public.vehicle_handover_records(id,tenant_id,work_order_id,claim_id,vehicle_id,customer_id,vehicle_entry_id,snapshot_json)
  values($1,$2,$3,$4,$5,$6,$7,jsonb_build_object('custodyReceiptId',$8::text))`,[reuse,id(101),supplied.order,supplied.claim,supplied.vehicle,supplied.customer,supplied.entry,supplied.receipt]);
 await check('a consumed receipt cannot be reused for the same vehicle and visit',()=>fails('select public.finalize_vehicle_handover($1)',[reuse],/CUSTODY_NOT_VALID/));
 const advance=await fixture(206);
 await check('disabled approval prerequisite advances the visit while preserving pending claim truth and audit',async()=>{
  const row=await value('select to_jsonb(public.advance_vehicle_visit($1,0,\'approved\',now(),null,null,null,\'{}\'::jsonb)) as value',[advance.entry]);assert.equal(row.stage,'approved');
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[advance.claim]),'pending');
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='advance_vehicle_visit'",[advance.entry]),1);
 });
 await check('optimistic revision, actual vehicle links and roles stay enforced with requirements off',async()=>{
  await fails('select public.advance_vehicle_visit($1,0,\'in_progress\',now(),null,null,null,\'{}\'::jsonb)',[advance.entry],/VEHICLE_VISIT_STALE_REVISION/);
  await actor(3);await fails('select public.finalize_vehicle_handover($1)',[wrong.handover],/VEHICLE_HANDOVER_PERMISSION_DENIED/);await actor();
 });
 await policy(true);
 await check('restoring requirements preserves exception delivery evidence and consumed receipt confirmation',async()=>{
  assert.equal((await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[blank.handover])).receipt_number,blankFinal.receipt_number);
  const doc=await value('select public.vehicle_intake_receipt_document($1) as value',[supplied.receipt]);assert.equal(doc.delivery_confirmation.handover_id,supplied.handover);
  assert.ok(doc.delivery_confirmation.workflow_requirement_override_id);assert.equal(doc.delivery_confirmation.signature_data_url,null);assert.equal(doc.delivery_confirmation.paper_signature_confirmed,false);
 });
 await check('signed intake snapshots, signatures and finalized handovers remain immutable',async()=>{
  await db.exec('reset role');
  await fails('update public.vehicle_entry_signed_revisions set snapshot=\'{}\' where id=$1',[supplied.revision],/CUSTODY_SIGNED_EVIDENCE_IMMUTABLE/);
  await fails('update public.vehicle_entry_signatures set signature_data_url=\'changed\' where id=$1',[supplied.signature],/CUSTODY_SIGNED_EVIDENCE_IMMUTABLE/);
  await fails('update public.vehicle_handover_records set recipient_name=\'changed\' where id=$1',[supplied.handover],/VEHICLE_HANDOVER_FINALIZED_IMMUTABLE/);
  assert.deepEqual(await value('select snapshot as value from public.vehicle_entry_signed_revisions where id=$1',[supplied.revision]),{frozen:'ORIGINAL-INTAKE-SNAPSHOT'});await actor();
 });
 await check('strict prerequisites return for the next unfinished visit',()=>fails('select public.finalize_vehicle_handover($1)',[noSignature.handover],/VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED/));
 await check('source synchronization retains a prior audited exception after re-enabling without approving the claim',async()=>{
  await db.exec('reset role');await db.query('update public.insurance_claims set status=status where id=$1',[advance.claim]);await actor();
  const workflow=await value('select to_jsonb(w) as value from public.vehicle_visit_workflows w where entry_id=$1',[advance.entry]);
  assert.equal(workflow.stage,'approved');assert.equal(workflow.review_reason,null);
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[advance.claim]),'pending');
  await fails('select public.advance_vehicle_visit($1,1,\'in_progress\',now(),null,null,null,\'{}\'::jsonb)',[advance.entry],/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
 });
 await check('durable stage exception does not hide broken identity or genuine cancellation',async()=>{
  await db.exec('reset role');await db.query('update public.insurance_claims set vehicle_id=$2,status=status where id=$1',[advance.claim,wrong.vehicle]);
  assert.equal(await value('select review_reason as value from public.vehicle_visit_workflows where entry_id=$1',[advance.entry]),'source_regressed');
  await db.query('update public.insurance_claims set vehicle_id=$2,status=status where id=$1',[advance.claim,advance.vehicle]);
  assert.equal(await value('select review_reason as value from public.vehicle_visit_workflows where entry_id=$1',[advance.entry]),null);
  await db.query("update public.insurance_claims set status='cancelled' where id=$1",[advance.claim]);
  assert.equal(await value('select stage as value from public.vehicle_visit_workflows where entry_id=$1',[advance.entry]),'cancelled');await actor();
 });
 const normal=await fixture(207,{recipient:'Signed recipient',signature:'data:image/png;base64,TkVX',receipt:true});
 await check('normal signed delivery with a valid receipt still succeeds when requirements are enabled',async()=>{
  const record=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[normal.handover]);assert.equal(record.status,'finalized');
  assert.equal(record.snapshot_json.workflowRequirementOverrideId,undefined);assert.equal(record.signature_data_url,'data:image/png;base64,TkVX');
  assert.equal(await value('select status as value from public.vehicle_entry_custody_receipts where id=$1',[normal.receipt]),'used');
 });
 await policy(false);
 const stale=await fixture(208,{receipt:true});
 await db.exec('reset role');await db.query('update public.vehicle_entries set intake_revision=2 where id=$1',[stale.entry]);await actor();
 await check('a receipt for an earlier intake revision stays invalid with requirements disabled',()=>fails('select public.finalize_vehicle_handover($1)',[stale.handover],/CUSTODY_NOT_VALID/));
 const cycle=await fixture(209);
 await check('complete disabled-policy cycle saves approval, repair, ready and final delivery without falsifying financial approval',async()=>{
  let revision=0;
  for(const stage of ['approved','in_progress','ready']){
   const row=await value('select to_jsonb(public.advance_vehicle_visit($1,$2,$3,clock_timestamp(),null,null,null,\'{}\'::jsonb)) as value',[cycle.entry,revision,stage]);
   assert.equal(row.stage,stage);revision=row.revision;
  }
  assert.equal(await value('select status as value from public.job_orders where id=$1',[cycle.order]),'in_progress');
  await db.exec('reset role');await db.query('update public.job_orders set status=status where id=$1',[cycle.order]);await actor();
  assert.equal(await value('select review_reason as value from public.vehicle_visit_workflows where entry_id=$1',[cycle.entry]),null);
  const record=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[cycle.handover]);assert.equal(record.status,'finalized');
  assert.equal(await value('select stage as value from public.vehicle_visit_workflows where entry_id=$1',[cycle.entry]),'delivered');
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[cycle.claim]),'pending');
  assert.equal(await value('select vehicle_location as value from public.vehicle_entries where id=$1',[cycle.entry]),'مع العميل');
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='advance_vehicle_visit'",[cycle.entry]),3);
 });
 // Review creation itself is covered by the intake verifier; this fixture starts
 // from its canonical linked relation and exercises the real lifecycle/delivery RPCs.
 await db.exec('reset role');
 await db.query(`insert into public.vehicle_entries(id,tenant_id,vehicle_id,customer_id,entry_number,arrival_date,arrival_time)
  select $1,tenant_id,vehicle_id,customer_id,'REVIEW-TEST',(delivered_at at time zone 'Asia/Muscat')::date,(delivered_at at time zone 'Asia/Muscat')::time from public.vehicle_handover_records where id=$2`,[id(301),blank.handover]);
 await db.query('insert into public.vehicle_review_returns values($1,$2,$3,$4,$5)',[id(302),id(101),blank.entry,blank.handover,id(301)]);
 await db.query("insert into public.vehicle_visit_workflows(entry_id,tenant_id,vehicle_id,stage) values($1,$2,$3,'arrived')",[id(301),id(101),blank.vehicle]);await actor();
 await check('review work starts with audited missing intake signature and leaves historical financial links untouched',async()=>{
  const row=await value('select to_jsonb(public.advance_vehicle_visit($1,0,\'in_progress\',clock_timestamp(),\'\',null,null,\'{}\'::jsonb)) as value',[id(301)]);assert.equal(row.stage,'in_progress');
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='advance_review_visit'",[id(301)]),1);
  assert.equal(await value('select work_order_id as value from public.vehicle_entries where id=$1',[id(301)]),null);
  assert.equal(await value('select insurance_claim_id as value from public.vehicle_entries where id=$1',[id(301)]),null);
 });
 let reviewFinal;const requestId=id(303);
 await check('review delivery before ready uses a documented exception and no new claim or order',async()=>{
  const before=await value('select count(*)::integer as value from public.job_orders');
  reviewFinal=await value('select to_jsonb(public.deliver_vehicle_review_visit($1,$2,null,\'\',\'\',\'\',clock_timestamp())) as value',[id(301),requestId]);
  assert.equal(reviewFinal.status,'finalized');assert.equal(reviewFinal.recipient_name,'');assert.equal(reviewFinal.signature_data_url,null);
  assert.equal(reviewFinal.review_return_id,id(302));assert.ok(reviewFinal.snapshot_json.workflowRequirementOverrideId);
  assert.equal(await value('select stage as value from public.vehicle_visit_workflows where entry_id=$1',[id(301)]),'delivered');
  assert.equal(await value('select count(*)::integer as value from public.job_orders'),before);
  assert.equal(await value('select status as value from public.job_orders where id=$1',[blank.order]),'delivered');
 });
 await policy(true);
 await check('review delivery retries remain idempotent after restoring strict requirements; conflicts still reject',async()=>{
  const repeat=await value('select to_jsonb(public.deliver_vehicle_review_visit($1,$2,null,\'\',\'\',\'\',$3)) as value',[id(301),requestId,reviewFinal.delivered_at]);assert.equal(repeat.id,reviewFinal.id);
  const wrapper=await value('select to_jsonb(public.deliver_vehicle_review_visit($1,$2,null,\'\',\'\',\'\')) as value',[id(301),requestId]);assert.equal(wrapper.id,reviewFinal.id);
  await fails('select public.deliver_vehicle_review_visit($1,$2,null,\'Changed recipient\',\'\',\'\',$3)',[id(301),requestId,reviewFinal.delivered_at],/REVIEW_RETURN_REQUEST_CONFLICT/);
 });
 // Couple the independently verified claim guards with lifecycle/receipt triggers.
 // Earlier fixtures represent pre-existing records. Only supporting columns are
 // added here; the new pending claim/order below run with every installed trigger
 // enabled and under the authenticated actor. No operation uses a setup bypass.
 await db.exec(`reset role;alter table public.insurance_claims add column estimated_amount numeric,add column estimate_date date,add column vehicle_model text;
  grant insert,update on public.insurance_claims,public.job_orders,public.vehicle_entries to authenticated;`);
 await check('claim-order migration applies alongside lifecycle and receipt guards',()=>read('20261123141053_workflow_requirement_claim_gates.sql').then(sql=>db.exec(sql)));
 await actor();const coupledPolicy=await policy(false);
 const coupled={entry:id(401),vehicle:id(402),customer:id(403),claim:id(404),order:id(405),handover:id(406)};
 await db.exec('reset role');
 await db.query('insert into public.vehicles(id) values($1)',[coupled.vehicle]);await db.query('insert into public.customers(id) values($1)',[coupled.customer]);
 await actor();
 await db.query("insert into public.vehicle_entries(id,tenant_id,vehicle_id,customer_id,entry_number) values($1,$2,$3,$4,'COUPLED-TEST')",[coupled.entry,id(101),coupled.vehicle,coupled.customer]);
 await check('new pending claim and actual order are created normally with both canonical audits',async()=>{
  await db.query(`insert into public.insurance_claims(id,tenant_id,vehicle_id,customer_id,vehicle_entry_id,status,claim_number,estimated_amount,workflow_requirement_revision)
   values($1,$2,$3,$4,$5,'pending','COUPLED-CLAIM',0,$6)`,[coupled.claim,id(101),coupled.vehicle,coupled.customer,coupled.entry,coupledPolicy.revision]);
  await db.query('update public.vehicle_entries set insurance_claim_id=$2 where id=$1',[coupled.entry,coupled.claim]);
  await db.query(`insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,vehicle_entry_id,claim_id,status,work_order_type,order_number)
   values($1,$2,$3,$4,$5,$6,'received','insurance','COUPLED-WO')`,[coupled.order,id(101),coupled.vehicle,coupled.customer,coupled.entry,coupled.claim]);
  await db.query('update public.vehicle_entries set work_order_id=$2 where id=$1',[coupled.entry,coupled.order]);
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='create_claim_with_incomplete_operational_details'",[coupled.claim]),1);
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='create_order_without_claim_approval'",[coupled.order]),1);
  assert.equal(await value('select revision as value from public.vehicle_visit_workflows where entry_id=$1',[coupled.entry]),0);
 });
 let coupledFinal;
 await check('coupled pending-claim order completes every lifecycle stage and finalization with real AFTER guards enabled',async()=>{
  await db.query(`insert into public.vehicle_handover_records(id,tenant_id,work_order_id,claim_id,vehicle_id,customer_id,vehicle_entry_id,snapshot_json)
   values($1,$2,$3,$4,$5,$6,$7,'{"paperSignatureConfirmed":false}'::jsonb)`,[coupled.handover,id(101),coupled.order,coupled.claim,coupled.vehicle,coupled.customer,coupled.entry]);
  let revision=0;
  for(const stage of ['approved','in_progress','ready']){
   const saved=await value('select to_jsonb(public.advance_vehicle_visit($1,$2,$3,clock_timestamp(),null,null,null,\'{}\'::jsonb)) as value',[coupled.entry,revision,stage]);assert.equal(saved.stage,stage);revision=saved.revision;
  }
  coupledFinal=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[coupled.handover]);assert.equal(coupledFinal.status,'finalized');
  assert.ok(coupledFinal.snapshot_json.workflowRequirementOverrideId);assert.equal(coupledFinal.recipient_name,'');assert.equal(coupledFinal.signature_data_url,null);
  assert.equal(await value('select stage as value from public.vehicle_visit_workflows where entry_id=$1',[coupled.entry]),'delivered');
  assert.equal(await value('select status as value from public.job_orders where id=$1',[coupled.order]),'delivered');
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[coupled.claim]),'pending');
  assert.equal(await value('select estimated_amount::integer as value from public.insurance_claims where id=$1',[coupled.claim]),0);
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='advance_order_without_claim_approval'",[coupled.order]),2);
  // Relaxing the visit's ready prerequisite does not fabricate a completed
  // order status; this fixture first changes the actual order at final delivery.
  assert.equal(await value("select count(*)::integer as value from public.workflow_requirement_audit where entity_id=$1 and action='complete_order_with_workflow_exception'",[coupled.order]),1);
  assert.equal(await value("select details->>'to_status' as value from public.workflow_requirement_audit where entity_id=$1 and action='complete_order_with_workflow_exception'",[coupled.order]),'delivered');
 });
 await policy(true);
 await check('coupled historical delivery updates and retries survive restoring strict without changing evidence or approval',async()=>{
  await db.query('update public.job_orders set status=status,vehicle_location_note=\'Local historic metadata check\' where id=$1',[coupled.order]);
  await db.query('update public.insurance_claims set status=status where id=$1',[coupled.claim]);
  const saved=await value('select to_jsonb(public.finalize_vehicle_handover($1)) as value',[coupled.handover]);assert.equal(saved.receipt_number,coupledFinal.receipt_number);
  assert.equal(saved.snapshot_json.workflowRequirementOverrideId,coupledFinal.snapshot_json.workflowRequirementOverrideId);
  assert.equal(await value('select review_reason as value from public.vehicle_visit_workflows where entry_id=$1',[coupled.entry]),null);
  assert.equal(await value('select status as value from public.insurance_claims where id=$1',[coupled.claim]),'pending');
 });
 await check('coupled strict policy again blocks new pending-claim orders and new status advances',async()=>{
  await fails(`insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,claim_id,status,work_order_type,order_number)
   values($1,$2,$3,$4,$5,'received','insurance','COUPLED-BLOCKED')`,[id(407),id(101),coupled.vehicle,coupled.customer,coupled.claim],/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
  await fails("update public.job_orders set status='inspection' where id=$1",[wrong.order],/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
  assert.equal(await value('select status as value from public.job_orders where id=$1',[coupled.order]),'delivered');
 });
 const out=path.join(root,'output/workflow-requirements');await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'lifecycle-db.json'),JSON.stringify({engine:'PGlite 0.6.0',scope:'isolated synthetic database; real lifecycle/receipt/manager function bodies and evidence triggers; no hosted connection',limitations:['Supporting business tables use minimal synthetic columns. Profile and policy RLS are included; all historical business-table RLS policies and triggers are not loaded. Full historical migration chain, accounting calculations, review creation, Storage, portal and UI are outside this verifier.'],passed:checks.length,failed:0,checks},null,2));
 console.log(`PASS ${checks.length} isolated lifecycle PostgreSQL checks`);
}catch(error){console.error('FAIL',error.message);if(error.where)console.error('CONTEXT',error.where);process.exitCode=1;}finally{await db.close();}
