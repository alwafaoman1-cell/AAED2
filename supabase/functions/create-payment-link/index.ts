// إنشاء رابط دفع عبر بوابة الورشة المختارة
// يدعم: stripe / thawani / myfatoorah / paytabs / tap
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Gateway = "stripe" | "thawani" | "myfatoorah" | "paytabs" | "tap";

interface Body {
  gateway: Gateway;
  amount: number;
  currency?: string; // default OMR
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  source_type: "invoice" | "insurance_invoice" | "quote";
  source_id: string;
  source_reference?: string; // human-readable invoice number
  description?: string;
  success_url?: string;
  cancel_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("missing_auth");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error("unauthenticated");

    const b = (await req.json()) as Body;
    if (!b.gateway || !b.amount || !b.source_type || !b.source_id) throw new Error("missing_required_fields");
    if (typeof b.amount !== "number" || !isFinite(b.amount) || b.amount <= 0) throw new Error("invalid_amount");

    // Validate the requested amount against the actual invoice balance.
    // Prevents insider abuse where a smaller-than-owed amount could be billed.
    if (b.source_type === "invoice" || b.source_type === "insurance_invoice") {
      const table = b.source_type === "invoice" ? "invoices" : "insurance_invoices";
      const cols = b.source_type === "invoice"
        ? "id, total, paid_at"
        : "id, total, paid_amount, status";
      const { data: src, error: srcErr } = await supabase
        .from(table)
        .select(cols)
        .eq("id", b.source_id)
        .maybeSingle();
      if (srcErr) throw srcErr;
      if (!src) throw new Error("source_not_found");

      const total = Number((src as any).total || 0);
      const paid = b.source_type === "insurance_invoice"
        ? Number((src as any).paid_amount || 0)
        : ((src as any).paid_at ? total : 0);
      const balance = Math.max(0, total - paid);
      // Allow a small rounding tolerance (0.01 of currency unit)
      if (Math.abs(b.amount - balance) > 0.01 && b.amount > balance + 0.01) {
        console.warn("payment_link_amount_mismatch", {
          source_type: b.source_type, source_id: b.source_id,
          requested: b.amount, balance, total, paid,
        });
        throw new Error("amount_exceeds_balance_due");
      }
    }


    const provider = `pg_${b.gateway}`;
    const { data: integ, error } = await supabase
      .from("tenant_integrations")
      .select("config, secrets, enabled")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!integ || !integ.enabled) throw new Error(`gateway_${b.gateway}_not_enabled`);

    const cfg = (integ.config || {}) as Record<string, string>;
    const sec = (integ.secrets || {}) as Record<string, string>;

    const currency = (b.currency || "OMR").toUpperCase();
    const reference = b.source_reference || b.source_id;
    const description = b.description || `Invoice ${reference}`;
    const successUrl = b.success_url || cfg.success_url || `${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co","")}.lovable.app/payment/success`;
    const cancelUrl = b.cancel_url || cfg.cancel_url || successUrl;

    let hostedUrl = "";
    let sessionId = "";
    let raw: unknown = null;

    // ============ STRIPE ============
    if (b.gateway === "stripe") {
      const sk = sec.secret_key;
      if (!sk) throw new Error("missing_stripe_secret_key");
      // Stripe uses smallest currency unit. OMR has 3 decimals (baisa).
      const minor = currency === "OMR" || currency === "BHD" || currency === "KWD" ? 1000 : 100;
      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("payment_method_types[]", "card");
      params.append("line_items[0][price_data][currency]", currency.toLowerCase());
      params.append("line_items[0][price_data][product_data][name]", description);
      params.append("line_items[0][price_data][unit_amount]", String(Math.round(b.amount * minor)));
      params.append("line_items[0][quantity]", "1");
      params.append("success_url", successUrl);
      params.append("cancel_url", cancelUrl);
      if (b.customer_email) params.append("customer_email", b.customer_email);
      params.append("client_reference_id", b.source_id);
      params.append("metadata[source_type]", b.source_type);
      params.append("metadata[source_id]", b.source_id);

      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      raw = await r.json();
      if (!r.ok) throw new Error((raw as any).error?.message || "stripe_failed");
      hostedUrl = (raw as any).url;
      sessionId = (raw as any).id;
    }
    // ============ THAWANI (Oman) ============
    else if (b.gateway === "thawani") {
      const apiKey = sec.secret_key;
      const pubKey = cfg.publishable_key;
      if (!apiKey || !pubKey) throw new Error("missing_thawani_keys");
      const isLive = cfg.environment === "live";
      const base = isLive ? "https://checkout.thawani.om" : "https://uatcheckout.thawani.om";
      // Thawani amount is in baisa (OMR * 1000)
      const r = await fetch(`${base}/api/v1/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "thawani-api-key": apiKey },
        body: JSON.stringify({
          client_reference_id: b.source_id,
          mode: "payment",
          products: [{ name: description, quantity: 1, unit_amount: Math.round(b.amount * 1000) }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer: b.customer_email,
          metadata: { source_type: b.source_type, source_id: b.source_id, reference },
        }),
      });
      raw = await r.json();
      if (!r.ok || !(raw as any).success) throw new Error((raw as any).description || "thawani_failed");
      sessionId = (raw as any).data.session_id;
      hostedUrl = `${base}/pay/${sessionId}?key=${pubKey}`;
    }
    // ============ MYFATOORAH ============
    else if (b.gateway === "myfatoorah") {
      const token = sec.api_token;
      if (!token) throw new Error("missing_myfatoorah_token");
      const isLive = cfg.environment === "live";
      const region = (cfg.region || "sa").toLowerCase(); // sa, kw, ae, eg
      const base = isLive
        ? `https://api.myfatoorah.com`
        : `https://apitest.myfatoorah.com`;
      const r = await fetch(`${base}/v2/SendPayment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          NotificationOption: "LNK",
          CustomerName: b.customer_name,
          MobileCountryCode: "+968",
          CustomerMobile: (b.customer_phone || "").replace(/\D/g,"").slice(-8),
          CustomerEmail: b.customer_email,
          InvoiceValue: b.amount,
          DisplayCurrencyIso: currency,
          CallBackUrl: successUrl,
          ErrorUrl: cancelUrl,
          Language: "AR",
          CustomerReference: reference,
          UserDefinedField: b.source_id,
        }),
      });
      raw = await r.json();
      if (!r.ok || !(raw as any).IsSuccess) throw new Error((raw as any).Message || "myfatoorah_failed");
      hostedUrl = (raw as any).Data.InvoiceURL;
      sessionId = String((raw as any).Data.InvoiceId);
    }
    // ============ PAYTABS ============
    else if (b.gateway === "paytabs") {
      const profileId = cfg.profile_id;
      const serverKey = sec.server_key;
      const region = (cfg.region || "ARE").toUpperCase(); // ARE/SAU/OMN/EGY/JOR/IRQ
      if (!profileId || !serverKey) throw new Error("missing_paytabs_keys");
      const baseMap: Record<string, string> = {
        ARE: "https://secure.paytabs.com",
        SAU: "https://secure.paytabs.sa",
        OMN: "https://secure-oman.paytabs.com",
        EGY: "https://secure-egypt.paytabs.com",
        JOR: "https://secure-jordan.paytabs.com",
        IRQ: "https://secure-iraq.paytabs.com",
        GLOBAL: "https://secure-global.paytabs.com",
      };
      const base = baseMap[region] || baseMap.ARE;
      const r = await fetch(`${base}/payment/request`, {
        method: "POST",
        headers: { Authorization: serverKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: Number(profileId),
          tran_type: "sale",
          tran_class: "ecom",
          cart_id: reference,
          cart_currency: currency,
          cart_amount: b.amount,
          cart_description: description,
          customer_details: {
            name: b.customer_name,
            email: b.customer_email || "noemail@example.com",
            phone: b.customer_phone || "",
            country: region.slice(0,2),
            ip: "0.0.0.0",
          },
          return: successUrl,
          callback: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=paytabs`,
        }),
      });
      raw = await r.json();
      if (!r.ok || !(raw as any).redirect_url) throw new Error((raw as any).message || "paytabs_failed");
      hostedUrl = (raw as any).redirect_url;
      sessionId = (raw as any).tran_ref;
    }
    // ============ TAP PAYMENTS ============
    else if (b.gateway === "tap") {
      const sk = sec.secret_key;
      if (!sk) throw new Error("missing_tap_secret_key");
      const r = await fetch("https://api.tap.company/v2/charges", {
        method: "POST",
        headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: b.amount,
          currency,
          description,
          reference: { transaction: reference, order: b.source_id },
          customer: {
            first_name: b.customer_name,
            email: b.customer_email,
            phone: b.customer_phone ? { country_code: "968", number: b.customer_phone.replace(/\D/g,"").slice(-8) } : undefined,
          },
          source: { id: "src_all" },
          redirect: { url: successUrl },
          post: { url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-webhook?gateway=tap` },
        }),
      });
      raw = await r.json();
      if (!r.ok || !(raw as any).transaction?.url) throw new Error((raw as any).errors?.[0]?.description || "tap_failed");
      hostedUrl = (raw as any).transaction.url;
      sessionId = (raw as any).id;
    } else {
      throw new Error("unknown_gateway");
    }

    // Persist link
    const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", userData.user.id).single();
    const { data: inserted, error: insErr } = await supabase
      .from("payment_links")
      .insert({
        tenant_id: prof!.tenant_id,
        gateway: b.gateway,
        amount: b.amount,
        currency,
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        customer_email: b.customer_email,
        source_type: b.source_type,
        source_id: b.source_id,
        source_reference: reference,
        hosted_url: hostedUrl,
        provider_session_id: sessionId,
        status: "pending",
        created_by: userData.user.id,
        metadata: { raw },
      })
      .select("id, hosted_url")
      .single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, id: inserted.id, url: hostedUrl, session_id: sessionId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
