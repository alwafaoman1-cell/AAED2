// Local-only regression verification. No credentials, hosted clients or row copies.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {PGlite}=await import(pathToFileURL(path.join(root,'output/workflow-requirements-db-runtime/node_modules/@electric-sql/pglite/dist/index.js')).href);
const db=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=name=>fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
function fn(source,name){const re=new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name.replaceAll('.','\\.')}\\s*\\(`,'ig');const match=[...source.matchAll(re)].at(-1);assert.ok(match);const rest=source.slice(match.index);const body=/\bas\s+(\$[a-zA-Z_]*\$)/i.exec(rest);const end=rest.indexOf(body[1],body.index+body[0].length);return rest.slice(0,rest.indexOf(';',end+body[1].length)+1);}
const migrationFile='20261124143324_defer_claim_order_approval_guard.sql';
const result={engine:'PGlite 0.6.0 (local PostgreSQL/WASM)',scope:'Minimal synthetic support schema; actual core-policy/claim-gate migrations and actual auto-create, type-inference, reuse and single-primary trigger functions. No hosted connection.',migrationFile,checks:[],productionWrites:0,
 limitations:['Synthetic support tables omit unrelated historical RLS, accounting, Storage and lifecycle triggers; this isolates the real approval/order guard interaction.','No hosted Development or Production connections. Local WASM runtime is an existing temporary dependency under output/workflow-requirements-db-runtime.']};
const check=async(name,run)=>{await run();result.checks.push({name,passed:true});console.log('PASS',name);};
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const count=async(n)=>(await rows('select count(*)::int n from public.job_orders where claim_id=$1',[id(n)]))[0].n;
async function expectFailure(sql,args,pattern){await assert.rejects(db.query(sql,args),pattern);}
async function claim(n,{tenant=100,status='pending',deleted=null}={}){await db.query("insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,status,estimated_amount,estimate_date,vehicle_model,deleted_at) values($1,$2,$3,$4,$5,$6,100,current_date,'Accord',$7)",[id(n),id(tenant),id(200),id(300),'CLAIM-'+n,status,deleted]);}
async function approve(n){await db.query("update public.insurance_claims set status='approved',approved_amount=100 where id=$1",[id(n)]);}
async function createOrder(n,{tenant=100,status='received'}={}){return (await rows("insert into public.job_orders(tenant_id,claim_id,status,work_order_type) values($1,$2,$3,'insurance') returning id",[id(tenant),id(n),status]))[0].id;}
async function policy(enabled,reason){const current=(await rows('select public.get_workflow_requirement_policy() p'))[0].p;return (await rows('select public.set_workflow_requirement_policy($1,$2,$3) p',[enabled,reason,current.revision]))[0].p;}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema app_private;
 create table public.tenants(id uuid primary key);
 create table public.profiles(user_id uuid primary key,tenant_id uuid,role text,account_status text,disabled_at timestamptz,full_name text);
 create function auth.uid() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
 create function public.get_user_tenant_id() returns uuid language sql stable as $$select '${id(100)}'::uuid$$;
 insert into public.tenants values('${id(100)}'),('${id(102)}');insert into public.profiles values('${id(1)}','${id(100)}','admin','active',null,'Synthetic administrator');
 create type public.job_status as enum('received','inspection','waiting_parts','in_progress','completed','delivered');
 create table public.insurance_claims(id uuid primary key,tenant_id uuid,customer_id uuid,vehicle_id uuid,claim_number text,status text default 'pending',auto_job_order_id uuid,job_order_id uuid,incident_description text,insurance_company text,vehicle_make text,vehicle_model text,vehicle_plate text,approved_amount numeric,estimated_amount numeric,estimate_date date,deleted_at timestamptz,created_at timestamptz default now());
 create table public.job_orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,vehicle_id uuid,claim_id uuid references public.insurance_claims(id),description text,diagnosis text,labor_cost numeric,parts_cost numeric,status public.job_status,insurance_claim_number text,insurance_company text,insurance_approved boolean,work_order_type text,archived_at timestamptz,deleted_at timestamptz,parent_work_order_id uuid);
 create table public.claim_audit_logs(tenant_id uuid,claim_id uuid,user_id uuid,action text,details jsonb);`);
 await db.exec(await read('20261123140431_workflow_requirement_policy.sql'));
 await db.exec(fn(await read('20260701170000_fix_auto_job_order_approved_amount_classification.sql'),'public.auto_create_job_order_on_approval'));
 await db.exec(fn(await read('20260623090000_work_order_control_center.sql'),'public.enforce_job_order_type'));
 const primarySource=await read('20261021100000_guard_primary_claim_work_order_creation.sql');
 for(const name of ['app_private.reuse_primary_claim_work_order_on_approval','app_private.guard_one_primary_work_order_per_claim']) await db.exec(fn(primarySource,name));
 await db.exec(`create trigger trg_auto_create_job_order before update on public.insurance_claims for each row execute function public.auto_create_job_order_on_approval();
 create trigger trg_00_reuse_primary_claim_order before update of status on public.insurance_claims for each row execute function app_private.reuse_primary_claim_work_order_on_approval();
 create trigger trg_enforce_job_order_type before insert or update of work_order_type,claim_id,insurance_claim_number,insurance_company,status on public.job_orders for each row execute function public.enforce_job_order_type();
 create trigger trg_guard_single_primary_claim_order before insert or update of tenant_id,claim_id,insurance_claim_number,work_order_type,parent_work_order_id,deleted_at,status on public.job_orders for each row execute function app_private.guard_one_primary_work_order_per_claim();`);
 await check('baseline real BEFORE approval creates exactly one primary order',async()=>{await claim(10);await approve(10);assert.equal(await count(10),1);});
 await db.exec(await read('20261123141053_workflow_requirement_claim_gates.sql'));
 await check('regression: immediate AFTER guard rejects automatic order and atomically rolls claim approval back',async()=>{
  await claim(11);await assert.rejects(approve(11),/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
  assert.deepEqual((await rows('select status,auto_job_order_id,job_order_id from public.insurance_claims where id=$1',[id(11)]))[0],{status:'pending',auto_job_order_id:null,job_order_id:null});assert.equal(await count(11),0);
 });
 const beforeFunction=(await rows("select pg_get_functiondef('app_private.guard_workflow_claim_order_requirements()'::regprocedure) body"))[0].body;
 await db.exec(await read(migrationFile));
 await check('candidate changes only trigger timing and retains the exact check function',async()=>{
  const trigger=(await rows("select tgdeferrable,tginitdeferred from pg_trigger where tgname='job_order_workflow_claim_requirements'"))[0];
  assert.equal(trigger.tgdeferrable,true);assert.equal(trigger.tginitdeferred,true);
  assert.equal((await rows("select pg_get_functiondef('app_private.guard_workflow_claim_order_requirements()'::regprocedure) body"))[0].body,beforeFunction);
 });
 await check('candidate strict approval persists claim, both order pointers and exactly one inferred insurance primary order together',async()=>{
  await approve(11);const saved=(await rows('select * from public.insurance_claims where id=$1',[id(11)]))[0];
  assert.equal(saved.status,'approved');assert.ok(saved.auto_job_order_id);assert.equal(saved.auto_job_order_id,saved.job_order_id);assert.equal(await count(11),1);
  const order=(await rows('select * from public.job_orders where id=$1',[saved.auto_job_order_id]))[0];assert.equal(order.work_order_type,'insurance');assert.equal(order.claim_id,id(11));assert.equal(order.insurance_approved,true);assert.equal(Number(order.labor_cost),0);assert.equal(Number(order.parts_cost),0);
 });
 await check('candidate still rolls back a direct order insert for an unapproved claim at commit',async()=>{await claim(12);await assert.rejects(createOrder(12),/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);assert.equal(await count(12),0);});
 await check('candidate still rejects cancelled and rejected claims, deleted claims and cross-tenant links',async()=>{
  await claim(13,{status:'cancelled'});await claim(14,{status:'rejected'});await claim(15,{deleted:'2026-11-24T00:00:00Z'});await claim(16,{tenant:102});
  for(const n of [13,14]) await assert.rejects(createOrder(n),/WORKFLOW_CLAIM_CLOSED/);
  for(const n of [15,16]) await assert.rejects(createOrder(n),/WORKFLOW_CLAIM_IDENTITY_REQUIRED/);
  for(const n of [13,14,15,16]) assert.equal(await count(n),0);
 });
 await check('candidate reapproval is idempotent and does not create duplicate orders or extra automatic-order audit',async()=>{
  await approve(11);await db.query("update public.insurance_claims set status='pending' where id=$1",[id(11)]);await approve(11);
  assert.equal(await count(11),1);assert.equal((await rows("select count(*)::int n from public.claim_audit_logs where claim_id=$1 and action='job_order_created'",[id(11)]))[0].n,1);
 });
 let relaxedOrder;
 await check('candidate relaxed mode preserves canonical exception actor, reason and revision for real unapproved-order creation',async()=>{
  const p=await policy(false,'Synthetic documented unapproved-order creation');await claim(17);relaxedOrder=await createOrder(17);
  const audits=await rows("select * from public.workflow_requirement_audit where entity_id=$1 and action='create_order_without_claim_approval'",[relaxedOrder]);assert.equal(audits.length,1);assert.equal(audits[0].actor_id,id(1));assert.equal(audits[0].reason,p.reason);assert.equal(audits[0].policy_revision,p.revision);assert.equal(audits[0].details.claim_status,'pending');
 });
 await check('candidate strict mode blocks advancing an existing relaxed pending-claim order and rolls its status back',async()=>{
  await policy(true,'Synthetic strict controls restored');
  await expectFailure("update public.job_orders set status='in_progress' where id=$1",[relaxedOrder],/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
  assert.equal((await rows('select status from public.job_orders where id=$1',[relaxedOrder]))[0].status,'received');
  assert.equal((await rows("select count(*)::int n from public.workflow_requirement_audit where entity_id=$1 and action='advance_order_without_claim_approval'",[relaxedOrder]))[0].n,0);
 });
 await check('candidate unchanged-status historical metadata edits stay permitted without new overrides',async()=>{
  await db.query("update public.job_orders set description='Local unchanged-status edit' where id=$1",[relaxedOrder]);
  assert.equal((await rows('select description from public.job_orders where id=$1',[relaxedOrder]))[0].description,'Local unchanged-status edit');
 });
 await check('candidate approval reuses the existing relaxed primary order without a duplicate',async()=>{
  await approve(17);assert.equal(await count(17),1);assert.equal((await rows('select auto_job_order_id from public.insurance_claims where id=$1',[id(17)]))[0].auto_job_order_id,relaxedOrder);
 });
 await check('candidate deferred commit rejects a transaction that creates an order then returns the claim to pending',async()=>{
  await claim(18);await db.exec('begin');await approve(18);await db.query("update public.insurance_claims set status='pending' where id=$1",[id(18)]);
  await assert.rejects(db.exec('commit'),/VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED/);
  assert.equal(await count(18),0);assert.equal((await rows('select status from public.insurance_claims where id=$1',[id(18)]))[0].status,'pending');
 });
 await check('candidate legitimate approval in relaxed mode has no spurious before-approval override',async()=>{
  await policy(false,'Synthetic optional controls');await claim(19);await approve(19);
  const order=(await rows('select auto_job_order_id from public.insurance_claims where id=$1',[id(19)]))[0].auto_job_order_id;
  assert.equal(await count(19),1);assert.equal((await rows("select count(*)::int n from public.workflow_requirement_audit where entity_id=$1 and action='create_order_without_claim_approval'",[order]))[0].n,0);
  await assert.rejects(createOrder(13),/WORKFLOW_CLAIM_CLOSED/);
 });
 result.passed=result.checks.length;result.failed=0;
 const out=path.join(root,'output/claim-approval');await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'database-verification.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.passed,failed:0,productionWrites:0,receipt:'output/claim-approval/database-verification.json',migrationFile},null,2));
} finally {await db.close();}
