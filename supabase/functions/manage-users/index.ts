import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  action: "create" | "update" | "delete" | "list";
  id?: string;
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string;
  role?: "admin" | "manager" | "supervisor" | "technician" | "insurance" | "accountant";
  avatar_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) Authenticate caller (signing-keys compatible via getClaims)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const callerClient = createClient(SUPABASE_URL, ANON_KEY);
    let callerUserId: string | null = null;
    try {
      const { data: claimsData } = await callerClient.auth.getClaims(token);
      callerUserId = claimsData?.claims?.sub ?? null;
    } catch (_) {
      callerUserId = null;
    }
    if (!callerUserId) {
      // Fallback to getUser (older sessions)
      const { data: userData } = await createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      }).auth.getUser();
      callerUserId = userData?.user?.id ?? null;
    }
    if (!callerUserId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Verify caller is admin/manager and get tenant_id
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (!callerProfile || !["admin", "manager"].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden — admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tenant_id = callerProfile.tenant_id;
    const body: Body = await req.json();

    // 3) Dispatch
    if (body.action === "list") {
      const { data, error } = await admin
        .from("profiles")
        .select("id, user_id, full_name, phone, role, avatar_url, created_at")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // attach emails
      const out = [];
      for (const p of data || []) {
        const { data: u } = await admin.auth.admin.getUserById(p.user_id);
        out.push({ ...p, email: u?.user?.email || null });
      }
      return new Response(JSON.stringify({ users: out }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerRole = callerProfile.role;
    // Only admins may assign or modify the 'admin' role
    if (body.role === "admin" && callerRole !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden — only admin can assign admin role" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "create") {
      if (!body.email || !body.password || !body.full_name || !body.role) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: {
          full_name: body.full_name,
          tenant_id,
          role: body.role,
        },
      });
      if (createErr) throw createErr;
      // Ensure profile exists with correct fields (in case trigger ran with defaults)
      await admin.from("profiles").upsert(
        {
          user_id: created.user!.id,
          tenant_id,
          full_name: body.full_name,
          phone: body.phone || null,
          role: body.role,
          avatar_url: body.avatar_url || null,
        },
        { onConflict: "user_id" }
      );
      return new Response(JSON.stringify({ ok: true, user_id: created.user!.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "update") {
      if (!body.id) throw new Error("id required");
      // Verify target belongs to same tenant
      const { data: target } = await admin
        .from("profiles")
        .select("tenant_id, user_id, role")
        .eq("id", body.id)
        .maybeSingle();
      if (!target || target.tenant_id !== tenant_id) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Non-admins cannot modify admin users or change anyone's role to/from admin
      if (callerRole !== "admin" && (target.role === "admin" || body.role === "admin")) {
        return new Response(JSON.stringify({ error: "Forbidden — only admin can manage admin accounts" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const updates: Record<string, unknown> = {};
      if (body.full_name !== undefined) updates.full_name = body.full_name;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.role !== undefined) updates.role = body.role;
      if (body.avatar_url !== undefined) updates.avatar_url = body.avatar_url;
      if (Object.keys(updates).length) {
        await admin.from("profiles").update(updates).eq("id", body.id);
      }
      if (body.password) {
        await admin.auth.admin.updateUserById(target.user_id, { password: body.password });
      }
      if (body.email) {
        await admin.auth.admin.updateUserById(target.user_id, { email: body.email });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "delete") {
      if (!body.id) throw new Error("id required");
      const { data: target } = await admin
        .from("profiles")
        .select("tenant_id, user_id")
        .eq("id", body.id)
        .maybeSingle();
      if (!target || target.tenant_id !== tenant_id) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Don't let admin delete themselves
      if (target.user_id === callerUserId) {
        return new Response(JSON.stringify({ error: "لا يمكنك حذف حسابك" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin.auth.admin.deleteUser(target.user_id);
      // profile will be removed by FK cascade if set; otherwise:
      await admin.from("profiles").delete().eq("id", body.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("manage-users unhandled error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
