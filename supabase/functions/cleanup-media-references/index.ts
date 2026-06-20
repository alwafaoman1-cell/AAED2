// تنظيف مراجع الوسائط من قاعدة البيانات بعد الحذف النهائي من السيرفر
// يتلقى قائمة {bucket, path} ويزيلها من الجداول التي قد تشير إليها
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Item {
  bucket: string;
  path: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller and tenant
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", userResp.user.id)
      .maybeSingle();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "no_tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (profile.role !== "admin" && profile.role !== "manager") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const items: Item[] = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return new Response(JSON.stringify({ ok: true, cleaned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = profile.tenant_id;
    // مفاتيح المطابقة: المسار الكامل بعد إزالة بادئة __trash/<uuid>/
    // ملاحظة أمان: لا نستخدم اسم الملف وحده لتجنّب حذف مراجع من سطور أخرى تتشارك نفس الاسم.
    const matchTokens = new Set<string>();
    for (const it of items) {
      const p = (it.path || "").replace(/^__trash\/[^/]+\//, "");
      if (p) matchTokens.add(p);
    }
    const tokens = [...matchTokens].filter(Boolean);

    let cleaned = 0;

    const containsToken = (s: any) => {
      if (typeof s !== "string") return false;
      return tokens.some((t) => s.includes(t));
    };

    // 1) insurance_claims: damage_photos, delivery_photos, satisfaction_photos (text[]), documents (jsonb[]), receiver_id_photo (text)
    {
      const { data: rows } = await admin
        .from("insurance_claims")
        .select("id, damage_photos, delivery_photos, satisfaction_photos, documents, receiver_id_photo")
        .eq("tenant_id", tenantId);
      for (const r of rows || []) {
        const patch: any = {};
        for (const col of ["damage_photos", "delivery_photos", "satisfaction_photos"] as const) {
          const arr = (r as any)[col] as string[] | null;
          if (Array.isArray(arr)) {
            const next = arr.filter((u) => !containsToken(u));
            if (next.length !== arr.length) patch[col] = next;
          }
        }
        const docs = (r as any).documents;
        if (Array.isArray(docs)) {
          const next = docs.filter((d: any) => !containsToken(d?.url));
          if (next.length !== docs.length) patch.documents = next;
        }
        if (containsToken((r as any).receiver_id_photo)) patch.receiver_id_photo = null;
        if (Object.keys(patch).length) {
          await admin.from("insurance_claims").update(patch).eq("id", (r as any).id);
          cleaned++;
        }
      }
    }

    // 2) inspections: photos (text[])
    {
      const { data: rows } = await admin
        .from("inspections")
        .select("id, photos, tenant_id")
        .eq("tenant_id", tenantId);
      for (const r of rows || []) {
        const arr = (r as any).photos as string[] | null;
        if (!Array.isArray(arr)) continue;
        const next = arr.filter((u) => !containsToken(u));
        if (next.length !== arr.length) {
          await admin.from("inspections").update({ photos: next }).eq("id", (r as any).id);
          cleaned++;
        }
      }
    }

    // 3) insurance_invoices: pdf_url
    {
      const { data: rows } = await admin
        .from("insurance_invoices")
        .select("id, pdf_url")
        .eq("tenant_id", tenantId);
      for (const r of rows || []) {
        if (containsToken((r as any).pdf_url)) {
          await admin.from("insurance_invoices").update({ pdf_url: null }).eq("id", (r as any).id);
          cleaned++;
        }
      }
    }

    // 4) claim_audit_logs: file_path (نحذف السطر إن كان يشير إلى الملف)
    {
      const { data: rows } = await admin
        .from("claim_audit_logs")
        .select("id, file_path")
        .eq("tenant_id", tenantId)
        .not("file_path", "is", null);
      const ids: string[] = [];
      for (const r of rows || []) {
        if (containsToken((r as any).file_path)) ids.push((r as any).id);
      }
      if (ids.length) {
        await admin.from("claim_audit_logs").delete().in("id", ids);
        cleaned += ids.length;
      }
    }

    return new Response(JSON.stringify({ ok: true, cleaned, tokens: tokens.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
