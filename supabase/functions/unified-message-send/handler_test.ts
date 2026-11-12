import { createUnifiedMessageHandler } from "./handler.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
function fixture() {
  const state = { active: true, authenticated: true, rateError: false, keyError: false, statusError: false,
    providerId: "wamid.test", providerFails: false, fastDelivery: false, requests: 0, writes: 0,
    keys: new Map<string, any>(), logs: new Map<string, any>() };
  function from(table: string) {
    let action = "select", payload: any, head = false;
    const filters: Record<string, any> = {};
    const chain: any = {
      select(_columns: string, options?: any) { head = Boolean(options?.head); return chain; },
      insert(value: any) { action = "insert"; payload = value; return chain; },
      update(value: any) { action = "update"; payload = value; return chain; },
      eq(key: string, value: any) { filters[key] = value; return chain; },
      in(key: string, value: any) { filters[key] = value; return chain; },
      gte() { return chain; },
      single: () => execute(), maybeSingle: () => execute(),
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
    };
    async function execute(): Promise<any> {
      if (table === "profiles") return { data: { user_id: USER, tenant_id: TENANT, role: "supervisor", account_status: state.active ? "active" : "disabled", disabled_at: null } };
      if (table === "message_idempotency_keys") {
        if (state.keyError) return { error: { code: "42P01" } };
        if (action === "insert") {
          if (state.keys.has(payload.idempotency_key)) return { error: { code: "23505" } };
          state.keys.set(payload.idempotency_key, { ...payload }); state.writes++; return { data: null };
        }
        const row = state.keys.get(filters.idempotency_key);
        if (action === "update" && row) { Object.assign(row, payload); state.writes++; }
        return { data: row || null };
      }
      if (table === "message_logs") {
        if (head) return state.rateError ? { error: { code: "57014" } } : { count: 0 };
        if (action === "insert") {
          const id = crypto.randomUUID();state.logs.set(id, { ...payload, id });state.writes++;return { data: { id } };
        }
        const row = filters.id ? state.logs.get(filters.id) : [...state.logs.values()].find(x => x.idempotency_key === filters.idempotency_key);
        if (action === "update") {
          if (state.statusError) return { error: { code: "57014" } };
          if (row && (!filters.status || filters.status.includes(row.status))) { Object.assign(row, payload);state.writes++; }
        }
        return { data: row || null };
      }
      return { data: null }; // No foreign or unknown linked entities are visible.
    }
    return chain;
  }
  const handler = createUnifiedMessageHandler({
    createClient: (_url, key) => key === "anon" ? { auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: USER } : null } }) } } : { from },
    env: name => ({ SUPABASE_URL: "https://development.invalid", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", WHATSAPP_INTERNAL_SHARED_SECRET: "internal" })[name],
    request: async (_input, options) => {
      state.requests++; const body = JSON.parse(String(options?.body));
      assert(body.to === "96890000000", "Unexpected recipient");
      assert(new Headers(options?.headers).get("x-aaed-internal-secret") === "internal");
      if (state.providerFails) throw new Error("provider_outcome_unknown");
      if (state.fastDelivery) state.logs.get(body.messageLogId).status = "delivered";
      return Response.json({ ok: true, providerMessageId: state.providerId || null });
    },
  });
  const send = async (extra: any = {}, key = "unit-single-event") => {
    const response = await handler(new Request("https://development.invalid/functions/v1/unified-message-send", { method: "POST", headers: { Authorization: "Bearer test-user", "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", recipient_phone: "96890000000", body: "Synthetic test only", idempotency_key: key, ...extra }) }));
    return { status: response.status, body: await response.json() };
  };
  return { state, handler, send };
}

Deno.test("preflight works; unsupported methods and unauthenticated requests cannot write", async () => {
  const f = fixture();
  assert((await f.handler(new Request("https://development.invalid", { method: "OPTIONS" }))).status === 200);
  assert((await f.handler(new Request("https://development.invalid"))).status === 405);
  f.state.authenticated = false;assert((await f.send()).status === 401);assert(f.state.writes === 0);
});
Deno.test("disabled staff and a caller-supplied foreign tenant cannot send", async () => {
  const f = fixture();f.state.active = false;assert((await f.send()).status === 403);
  f.state.active = true;assert((await f.send({tenant_id: FOREIGN})).body.error === "message_tenant_mismatch");
  assert(f.state.writes === 0 && f.state.requests === 0);
});
Deno.test("foreign customer, vehicle, claim, order and invoice references fail before reservation", async () => {
  for (const key of ["customer_id","vehicle_id","claim_id","work_order_id","invoice_id"]) {
    const f=fixture();assert((await f.send({[key]:FOREIGN})).body.error === "message_link_unavailable");assert(f.state.writes === 0);
  }
});
Deno.test("database rate and reservation failures are fail-closed", async () => {
  const f=fixture();f.state.rateError=true;assert(!(await f.send()).body.ok);assert(f.state.writes===0);
  f.state.rateError=false;f.state.keyError=true;assert((await f.send()).body.error==='message_reservation_unavailable');assert(f.state.requests===0);
});
Deno.test("concurrent requests own exactly one reservation and send exactly once", async () => {
  const f=fixture();const results=await Promise.all(Array.from({length:10},()=>f.send()));
  assert(results.filter(x=>x.body.ok).length===1);assert(results.filter(x=>x.body.status==='duplicate_blocked').length===9);
  assert(f.state.requests===1&&f.state.logs.size===1);
});
Deno.test("an existing reservation without a log never owns the send", async () => {
  const f=fixture();f.state.keys.set('unit-single-event',{status:'reserved',message_log_id:null});
  assert((await f.send()).body.status==='duplicate_blocked');assert(f.state.requests===0&&f.state.logs.size===0);
});
Deno.test("a network-ambiguous failure cannot be retried as a second send", async () => {
  const f=fixture();f.state.providerFails=true;assert(!(await f.send()).body.ok);
  f.state.providerFails=false;assert((await f.send()).body.status==='duplicate_blocked');assert(f.state.requests===1);
});
Deno.test("provider ok without an actual provider id is not successful", async () => {
  const f=fixture();f.state.providerId='';const r=await f.send();assert(!r.body.ok&&r.body.error==='provider_acceptance_unconfirmed');
});
Deno.test("an already-delivered webhook state cannot be regressed to sent", async () => {
  const f=fixture();f.state.fastDelivery=true;assert((await f.send()).body.ok);assert([...f.state.logs.values()][0].status==='delivered');
});
Deno.test("unconfirmed status persistence is visible and never falsely reports success", async () => {
  const f=fixture();f.state.statusError=true;const r=await f.send();assert(!r.body.ok&&r.body.error==='message_status_persistence_unconfirmed');
});
Deno.test("dry-run is explicit and performs zero provider requests", async () => {
  const f=fixture();assert((await f.send({dry_run:true})).body.status==='dry_run');assert(f.state.requests===0);
  assert((await f.send({dry_run:'false'},'different-event')).status===400);
});
Deno.test("invalid and oversized attachments cannot reserve or send", async () => {
  const f=fixture();assert(!(await f.send({attachment:{url:'http://unsafe.invalid/a.pdf'}})).body.ok);
  assert(!(await f.send({attachment:{url:'https://example.invalid/a.pdf',fileSize:13*1024*1024}})).body.ok);
  assert(f.state.writes===0&&f.state.requests===0);
});
