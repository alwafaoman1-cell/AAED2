// تنبيهات ذكية يومية: ذمم متأخرة >60، مطالبات راكدة 14 يوم، مخزون تحت الحد.
// تكتب الإشعارات في جدول claim_audit_logs كنوع system_alert (لتجميعها بالواجهة لاحقاً).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Require shared secret OR service-role bearer (for pg_cron invocation)
  const expected = Deno.env.get("ALERTS_SECRET");
  const provided = req.headers.get("x-alerts-secret");
  const authHeader = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const hasServiceAuth = serviceKey && authHeader === `Bearer ${serviceKey}`;
  const hasSecret = expected && provided === expected;
  if (!hasServiceAuth && !hasSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date();
    const cutoff60 = new Date(today.getTime() - 60 * 86400000).toISOString().slice(0, 10);
    const cutoff14 = new Date(today.getTime() - 14 * 86400000).toISOString();

    const alerts: any[] = [];

    // 1) ذمم مبيعات متأخرة >60 يوم
    const { data: overdueSales } = await supabase
      .from("sales_documents")
      .select("id,tenant_id,doc_number,customer_name,balance_due,due_date")
      .eq("doc_type", "invoice")
      .gt("balance_due", 0)
      .lt("due_date", cutoff60);
    for (const s of overdueSales || []) {
      alerts.push({
        tenant_id: s.tenant_id, claim_id: s.id, action: "system_alert", category: "overdue_receivable",
        details: { type: "overdue_sales", doc: s.doc_number, customer: s.customer_name, balance: s.balance_due, due_date: s.due_date },
      });
    }

    // 2) ذمم تأمين متأخرة >60 يوم
    const { data: overdueIns } = await supabase
      .from("insurance_invoices")
      .select("id,tenant_id,invoice_number,insurance_company_name,total,paid_amount,due_date")
      .lt("due_date", cutoff60);
    for (const i of overdueIns || []) {
      const bal = Number(i.total) - Number(i.paid_amount);
      if (bal <= 0) continue;
      alerts.push({
        tenant_id: i.tenant_id, claim_id: i.id, action: "system_alert", category: "overdue_insurance",
        details: { type: "overdue_insurance", invoice: i.invoice_number, company: i.insurance_company_name, balance: bal, due_date: i.due_date },
      });
    }

    // 3) مطالبات بدون حركة 14+ يوم
    const { data: staleClaims } = await supabase
      .from("insurance_claims")
      .select("id,tenant_id,claim_number,insurance_company,status,updated_at")
      .neq("status", "delivered")
      .lt("updated_at", cutoff14);
    for (const c of staleClaims || []) {
      alerts.push({
        tenant_id: c.tenant_id, claim_id: c.id, action: "system_alert", category: "stale_claim",
        details: { type: "stale_claim", claim: c.claim_number, company: c.insurance_company, status: c.status, last_update: c.updated_at },
      });
    }

    // 4) مخزون تحت الحد الأدنى
    const { data: lowStock } = await supabase
      .from("inventory")
      .select("id,tenant_id,name,quantity,min_quantity");
    for (const p of lowStock || []) {
      if (Number(p.quantity) > Number(p.min_quantity)) continue;
      alerts.push({
        tenant_id: p.tenant_id, claim_id: p.id, action: "system_alert", category: "low_stock",
        details: { type: "low_stock", name: p.name, quantity: p.quantity, min_quantity: p.min_quantity },
      });
    }

    if (alerts.length > 0) {
      await supabase.from("claim_audit_logs").insert(alerts);
    }

    return new Response(
      JSON.stringify({ ok: true, generated: alerts.length, breakdown: {
        overdue_sales: overdueSales?.length || 0,
        overdue_insurance: overdueIns?.length || 0,
        stale_claims: staleClaims?.length || 0,
        low_stock: alerts.filter(a => a.category === "low_stock").length,
      }}),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
