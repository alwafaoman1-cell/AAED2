import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SMOKE_TENANT_ID",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = createClient(url, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tenantId = process.env.SMOKE_TENANT_ID;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const refs = {
  customerId: null,
  vehicleIds: [],
  claimId: null,
  jobOrderId: null,
  extraJobOrderIds: [],
  invoiceId: null,
  portalTokenId: null,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertOne(table, payload) {
  const { data, error } = await admin.from(table).insert(payload).select("*").single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data;
}

async function expectUniqueViolation(label, operation) {
  const { error } = await operation();
  assert(error, `${label}: duplicate was accepted`);
  assert(error.code === "23505", `${label}: expected 23505, received ${error.code || error.message}`);
}

async function cleanup() {
  const steps = [
    refs.invoiceId && ["insurance_invoices", refs.invoiceId],
    refs.portalTokenId && ["customer_portal_tokens", refs.portalTokenId],
    refs.claimId && ["insurance_claims", refs.claimId],
    ...refs.extraJobOrderIds.map((id) => ["job_orders", id]),
    refs.jobOrderId && ["job_orders", refs.jobOrderId],
    ...refs.vehicleIds.map((id) => ["vehicles", id]),
    refs.customerId && ["customers", refs.customerId],
  ].filter(Boolean);
  for (const [table, id] of steps) {
    const { error } = await admin.from(table).delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) console.warn(`Cleanup warning (${table}/${id}): ${error.message}`);
  }
}

async function run() {
  console.log("1/8 Checking Phase 3 database objects...");
  for (const relation of [
    "whatsapp_logs",
    "workshop_operations_report",
    "delivered_vehicles_report",
    "claims_archive_report",
    "insurance_statement_report",
    "sales_invoices_archive_report",
  ]) {
    const { error } = await admin.from(relation).select("*", { head: true, count: "exact" }).limit(1);
    if (error) throw new Error(`${relation} is unavailable: ${error.message}`);
  }

  console.log("2/8 Checking existing VIN duplicates...");
  const { data: vehicles, error: vehiclesError } = await admin
    .from("vehicles")
    .select("id,vin,vin_number")
    .eq("tenant_id", tenantId);
  if (vehiclesError) throw vehiclesError;
  const seenVins = new Map();
  const duplicateVins = [];
  for (const vehicle of vehicles || []) {
    const vin = String(vehicle.vin || vehicle.vin_number || "").trim().toLowerCase();
    if (!vin) continue;
    if (seenVins.has(vin)) duplicateVins.push({ vin, ids: [seenVins.get(vin), vehicle.id] });
    else seenVins.set(vin, vehicle.id);
  }
  assert(duplicateVins.length === 0, `Duplicate VINs found: ${JSON.stringify(duplicateVins)}`);

  console.log("3/8 Creating customer and vehicle...");
  const customer = await insertOne("customers", {
    tenant_id: tenantId,
    name: `Phase 3 Smoke ${suffix}`,
    phone: process.env.SMOKE_CUSTOMER_PHONE || "+96890000000",
    notes: "Temporary production smoke-test record",
  });
  refs.customerId = customer.id;
  const vin = `SMOKE${suffix.replace(/\W/g, "").slice(-12).toUpperCase()}`;
  const vehicle = await insertOne("vehicles", {
    tenant_id: tenantId,
    customer_id: customer.id,
    brand: "Smoke",
    model: "Validation",
    plate_number: `S${suffix.slice(-6)}`,
    plate_country: "OM",
    vin,
  });
  refs.vehicleIds.push(vehicle.id);

  console.log("4/8 Creating claim and work order...");
  const claimNumber = `SMOKE-CL-${suffix}`;
  const claim = await insertOne("insurance_claims", {
    tenant_id: tenantId,
    customer_id: customer.id,
    vehicle_id: vehicle.id,
    claim_number: claimNumber,
    insurance_company: "Phase 3 Smoke Insurance",
    estimated_amount: 10,
    status: "approved",
    notes: "Temporary production smoke-test record",
  });
  refs.claimId = claim.id;

  let { data: order } = await admin
    .from("job_orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("insurance_claim_number", claimNumber)
    .maybeSingle();
  if (!order) {
    order = await insertOne("job_orders", {
      tenant_id: tenantId,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      order_number: `SMOKE-WO-${suffix}`,
      insurance_claim_number: claimNumber,
      insurance_company: "Phase 3 Smoke Insurance",
      status: "received",
      notes: "Temporary production smoke-test record",
    });
  }
  refs.jobOrderId = order.id;
  const { data: linkedClaim, error: linkedClaimError } = await admin
    .from("insurance_claims")
    .select("job_order_id,auto_job_order_id")
    .eq("id", claim.id)
    .single();
  if (linkedClaimError) throw linkedClaimError;
  assert(
    linkedClaim.job_order_id === order.id || linkedClaim.auto_job_order_id === order.id,
    "Claim → Work Order synchronization failed",
  );

  console.log("5/8 Checking uniqueness constraints...");
  await expectUniqueViolation("insurance_claims tenant + claim_number", () =>
    admin.from("insurance_claims").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      claim_number: claimNumber,
      insurance_company: "Duplicate Smoke",
      estimated_amount: 1,
    }),
  );
  const duplicateOrderAttempt = await admin.from("job_orders").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      order_number: order.order_number,
    }).select("id,order_number").single();
  if (duplicateOrderAttempt.error) {
    assert(duplicateOrderAttempt.error.code === "23505", `job_orders uniqueness returned ${duplicateOrderAttempt.error.code}`);
  } else {
    refs.extraJobOrderIds.push(duplicateOrderAttempt.data.id);
    assert(
      duplicateOrderAttempt.data.order_number !== order.order_number,
      "job_orders tenant + order_number: an actual duplicate was persisted",
    );
  }
  const duplicateVehicleAttempt = await admin.from("vehicles").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      brand: "Duplicate",
      model: "VIN",
      plate_number: `D${suffix.slice(-6)}`,
      vin,
    }).select("id,vin,vin_number").single();
  if (duplicateVehicleAttempt.error) {
    assert(duplicateVehicleAttempt.error.code === "23505", `vehicles uniqueness returned ${duplicateVehicleAttempt.error.code}`);
  } else {
    refs.vehicleIds.push(duplicateVehicleAttempt.data.id);
    const { data: sameVinRows, error: sameVinError } = await admin
      .from("vehicles")
      .select("id,vin,vin_number")
      .eq("tenant_id", tenantId);
    if (sameVinError) throw sameVinError;
    const normalizedVin = vin.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const matching = (sameVinRows || []).filter((row) =>
      String(row.vin || row.vin_number || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() === normalizedVin
    );
    assert(matching.length === 1, "vehicles tenant + VIN: an actual duplicate was persisted");
  }

  console.log("6/8 Completing delivery and verifying persistence...");
  const deliveredAt = new Date().toISOString();
  const { error: deliveryError } = await admin
    .from("job_orders")
    .update({ status: "delivered", completed_at: deliveredAt })
    .eq("id", order.id)
    .eq("tenant_id", tenantId);
  if (deliveryError) throw deliveryError;
  await admin
    .from("insurance_claims")
    .update({ delivered_at: deliveredAt })
    .eq("id", claim.id)
    .eq("tenant_id", tenantId);
  const { data: refreshedOrder, error: refreshError } = await admin
    .from("job_orders")
    .select("status,completed_at")
    .eq("id", order.id)
    .single();
  if (refreshError) throw refreshError;
  assert(refreshedOrder.status === "delivered", "Delivery status did not persist after a fresh query");

  console.log("7/8 Generating invoice and checking QR lookup...");
  const invoice = await insertOne("insurance_invoices", {
    tenant_id: tenantId,
    claim_id: claim.id,
    insurance_company_name: "Phase 3 Smoke Insurance",
    invoice_number: `SMOKE-INV-${suffix}`,
    status: "issued",
    subtotal: 10,
    vat: 0.5,
    total: 10.5,
    items: [{ description: "Phase 3 insurance repair", quantity: 1, unit_price: 10, total: 10 }],
    vehicle_make: "Smoke",
    vehicle_model: "Validation",
    vehicle_plate: vehicle.plate_number,
    vehicle_vin: vin,
    notes: "Temporary production smoke-test record",
  });
  refs.invoiceId = invoice.id;
  const { data: qrData, error: qrError } = await publicClient.rpc("get_public_work_order", {
    p_key: order.order_number,
    p_password: null,
  });
  if (qrError) throw new Error(`QR lookup failed: ${qrError.message}`);
  assert(Array.isArray(qrData) ? qrData.length > 0 : Boolean(qrData), "QR lookup returned no work order");

  assert(invoice.secure_token, "Insurance invoice secure token was not generated");
  const { data: invoiceQrData, error: invoiceQrError } = await publicClient.rpc("get_public_invoice", {
    p_token: invoice.secure_token,
  });
  if (invoiceQrError) throw new Error(`Invoice QR lookup failed: ${invoiceQrError.message}`);
  assert(invoiceQrData?.invoice?.invoice_number === invoice.invoice_number, "Invoice QR returned the wrong invoice");

  const portalToken = `phase3-${crypto.randomUUID().replaceAll("-", "")}`;
  let { data: portal, error: portalLookupError } = await admin
    .from("customer_portal_tokens")
    .select("*")
    .eq("job_order_id", order.id)
    .maybeSingle();
  if (portalLookupError) throw portalLookupError;
  if (!portal) {
    portal = await insertOne("customer_portal_tokens", {
      tenant_id: tenantId,
      job_order_id: order.id,
      token: portalToken,
    });
  }
  refs.portalTokenId = portal.id;
  const { data: customerQrData, error: customerQrError } = await publicClient.rpc("get_public_tracking", {
    p_token: portal.token,
  });
  if (customerQrError) throw new Error(`Customer portal QR lookup failed: ${customerQrError.message}`);
  assert(Boolean(customerQrData), "Customer portal QR returned no data");

  console.log("8/8 Optional WhatsApp smoke...");
  if (process.env.SMOKE_WHATSAPP_TO) {
    const { data, error } = await admin.functions.invoke("whatsapp-meta-send", {
      body: {
        to: process.env.SMOKE_WHATSAPP_TO,
        type: "text",
        text: `Phase 3 smoke test ${suffix}`,
        jobOrderId: order.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        insuranceClaimId: claim.id,
        messageKind: "custom",
        recipientName: "Phase 3 QA",
        recipientType: "other",
      },
    });
    if (error || !data?.ok) throw new Error(`WhatsApp smoke failed: ${error?.message || data?.error}`);
  } else {
    console.log("Skipped: set SMOKE_WHATSAPP_TO to send a real test message.");
  }

  console.log("Production smoke test passed.");
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
