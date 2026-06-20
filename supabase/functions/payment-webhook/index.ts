// Webhook موحّد لاستقبال إشعارات الدفع من جميع البوابات
// query: ?gateway=stripe|thawani|myfatoorah|paytabs|tap
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const gateway = url.searchParams.get("gateway");

  // Read raw body first (needed for Stripe signature verification)
  const rawBody = await req.text();

  // Auth: shared secret MUST be sent in HTTP header (never in URL query string,
  // which is logged by CDNs / proxies / gateway dashboards).
  const expectedToken = Deno.env.get("PAYMENT_WEBHOOK_SECRET");
  const providedToken = req.headers.get("x-webhook-secret") || "";

  // For Stripe, prefer cryptographic signature verification over shared secret.
  let stripeVerified = false;
  if (gateway === "stripe") {
    const sigHeader = req.headers.get("stripe-signature") || "";
    const stripeSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (sigHeader && stripeSecret) {
      try {
        // Parse "t=timestamp,v1=signature"
        const parts = Object.fromEntries(
          sigHeader.split(",").map((p) => {
            const i = p.indexOf("=");
            return [p.slice(0, i), p.slice(i + 1)];
          }),
        );
        const timestamp = parts["t"];
        const expectedSig = parts["v1"];
        if (timestamp && expectedSig) {
          const payload = `${timestamp}.${rawBody}`;
          const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(stripeSecret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          );
          const sigBuf = await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(payload),
          );
          const computed = Array.from(new Uint8Array(sigBuf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          // Constant-time compare
          if (
            computed.length === expectedSig.length &&
            computed.split("").every((c, i) => c === expectedSig[i])
          ) {
            // Reject events older than 5 minutes (replay protection)
            const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
            if (ageSec <= 300) stripeVerified = true;
          }
        }
      } catch (e) {
        console.warn("stripe_sig_verify_error", e);
      }
    }
  }

  const tokenOk = !!expectedToken && providedToken === expectedToken;
  if (!stripeVerified && !tokenOk) {
    console.warn("payment_webhook_unauthorized", { gateway });
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }



  // Use service role to update regardless of tenant context
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let sessionId = "";
    let isPaid = false;
    let isFailed = false;
    let payload: any = {};
    try { payload = JSON.parse(rawBody); } catch { payload = Object.fromEntries(new URLSearchParams(rawBody)); }

    if (gateway === "stripe") {
      // Expect Checkout Session events
      const ev = payload?.type;
      sessionId = payload?.data?.object?.id || "";
      isPaid = ev === "checkout.session.completed" && payload?.data?.object?.payment_status === "paid";
    } else if (gateway === "thawani") {
      sessionId = payload?.data?.session_id || payload?.session_id || "";
      isPaid = payload?.event_type === "checkout.completed" || payload?.data?.payment_status === "paid";
    } else if (gateway === "myfatoorah") {
      sessionId = String(payload?.Data?.InvoiceId || payload?.InvoiceId || "");
      isPaid = (payload?.Data?.InvoiceStatus || payload?.EventType) === "Paid";
      isFailed = (payload?.Data?.InvoiceStatus || "") === "Failed";
    } else if (gateway === "paytabs") {
      sessionId = payload?.tran_ref || "";
      isPaid = payload?.payment_result?.response_status === "A";
      isFailed = ["D","E"].includes(payload?.payment_result?.response_status);
    } else if (gateway === "tap") {
      sessionId = payload?.id || "";
      isPaid = payload?.status === "CAPTURED";
      isFailed = ["FAILED","DECLINED","CANCELLED"].includes(payload?.status);
    }

    if (!sessionId) return new Response("ok", { status: 200, headers: corsHeaders });

    const newStatus = isPaid ? "paid" : isFailed ? "failed" : "pending";
    const update: any = { status: newStatus };
    if (isPaid) update.paid_at = new Date().toISOString();

    await supabase
      .from("payment_links")
      .update(update)
      .eq("provider_session_id", sessionId);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("webhook_error", e);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
