// Public-shell and optional anonymous-RLS checks only. This script has no
// service-role client and performs no SQL, mutations, or authenticated writes.
const origin = new URL(process.env.APP_ORIGIN || "https://aaed-2.vercel.app");
const routes = ["/", "/sales/invoices", "/work-orders", "/customers", "/vehicles", "/insurance/claims", "/accounting/reports"];
const protectedTables = ["profiles", "customers", "vehicles", "job_orders", "insurance_claims"];

async function read(url, headers) {
  const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  return response;
}

let failures = 0;
let assetPath = "";
for (const route of routes) {
  try {
    const response = await read(new URL(route, origin));
    const body = await response.text();
    const html = response.headers.get("content-type")?.includes("text/html");
    if (!response.ok || !html || body.length < 100) throw new Error(`HTTP ${response.status}, invalid HTML shell`);
    if (!assetPath) assetPath = body.match(/src="(\/assets\/index-[^"\s]+\.js)"/)?.[1] || "";
    console.log(`PASS route ${route} HTTP ${response.status}`);
  } catch (error) {
    failures++;
    console.error(`FAIL route ${route}: ${error.message}`);
  }
}

if (assetPath) {
  try {
    const response = await read(new URL(assetPath, origin));
    const source = await response.text();
    if (!response.ok || source.length < 100) throw new Error(`HTTP ${response.status}, empty bundle`);
    console.log(`PASS deployed bundle ${assetPath} HTTP ${response.status}`);
  } catch (error) {
    failures++;
    console.error(`FAIL deployed bundle ${assetPath}: ${error.message}`);
  }
} else {
  failures++;
  console.error("FAIL no main JS asset found in the HTML shell");
}

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (supabaseUrl && anonKey) {
  for (const table of protectedTables) {
    try {
      const url = new URL(`/rest/v1/${table}?select=id&limit=1`, supabaseUrl);
      const response = await read(url, { apikey: anonKey, Authorization: `Bearer ${anonKey}` });
      if (response.status === 401 || response.status === 403) {
        console.log(`PASS anonymous ${table}: denied`);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 0) throw new Error("anonymous row exposure or unexpected response");
      console.log(`PASS anonymous ${table}: zero visible rows`);
    } catch (error) {
      failures++;
      console.error(`FAIL anonymous ${table}: ${error.message}`);
    }
  }
} else {
  console.log("SKIP anonymous RLS checks: supply SUPABASE_URL and SUPABASE_ANON_KEY (do not print keys)");
}

console.log(`Read-only smoke: ${failures === 0 ? "PASS" : "FAIL"}; authenticated workflows are not covered.`);
if (failures > 0) process.exitCode = 1;
