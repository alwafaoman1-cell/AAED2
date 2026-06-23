import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  action: "create" | "update" | "delete" | "list" | "invite" | "login_link" | "reset_access" | "disable" | "enable" | "assign_tenant";
  id?: string;
  tenant_id?: string;
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
      .select("tenant_id, role, is_platform_admin, account_status")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (!callerProfile || callerProfile.account_status === "disabled" || !["admin", "manager"].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden — admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body: Body = await req.json();
    const tenant_id = callerProfile.is_platform_admin && body.tenant_id
      ? body.tenant_id
      : callerProfile.tenant_id;

    const audit = async (action: string, targetUserId?: string | null, details: Record<string, unknown> = {}) => {
      await admin.from("admin_user_events").insert({
        tenant_id,
        actor_user_id: callerUserId,
        target_user_id: targetUserId || null,
        action,
        details,
      });
    };

    // 3) Dispatch
    if (body.action === "list") {
      const { data, error } = await admin
        .from("profiles")
        .select("id, user_id, tenant_id, full_name, phone, role, avatar_url, account_status, last_sign_in_at, last_seen_at, invited_at, disabled_at, created_at, tenant:tenants(name,slug)")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // attach emails
      const out = [];
      for (const p of data || []) {
        const { data: u } = await admin.auth.admin.getUserById(p.user_id);
        out.push({
          ...p,
          email: u?.user?.email || null,
          last_sign_in_at: u?.user?.last_sign_in_at || p.last_sign_in_at,
          email_confirmed_at: u?.user?.email_confirmed_at || null,
          banned_until: u?.user?.banned_until || null,
        });
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
          account_status: "active",
        },
        { onConflict: "user_id" }
      );
      await audit("user_created", created.user!.id, { email: body.email, role: body.role });
      return new Response(JSON.stringify({ ok: true, user_id: created.user!.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "invite" && !body.id) {
      if (!body.email || !body.full_name || !body.role) {
        return new Response(JSON.stringify({ error: "email, full_name and role are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const siteUrl = Deno.env.get("SITE_URL") || "https://aaed-2.vercel.app";
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(body.email, {
        redirectTo: `${siteUrl}/reset-password`,
        data: { full_name: body.full_name, tenant_id, role: body.role },
      });
      if (inviteError) throw inviteError;
      if (invited.user) {
        await admin.from("profiles").upsert({
          user_id: invited.user.id,
          tenant_id,
          full_name: body.full_name,
          phone: body.phone || null,
          role: body.role,
          account_status: "invited",
          invited_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        await audit("user_invited", invited.user.id, { email: body.email, role: body.role });
      }
      return new Response(JSON.stringify({ ok: true, user_id: invited.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "assign_tenant") {
      if (!callerProfile.is_platform_admin || !body.id || !body.tenant_id) {
        return new Response(JSON.stringify({ error: "Platform admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: target } = await admin.from("profiles").select("user_id,tenant_id").eq("id", body.id).maybeSingle();
      if (!target) throw new Error("user_not_found");
      const { error } = await admin.from("profiles").update({ tenant_id: body.tenant_id }).eq("id", body.id);
      if (error) throw error;
      await audit("tenant_assigned", target.user_id, { from_tenant_id: target.tenant_id, to_tenant_id: body.tenant_id });
      return new Response(JSON.stringify({ ok: true }), {
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

    if (["invite", "login_link", "reset_access", "disable", "enable"].includes(body.action)) {
      if (!body.id) throw new Error("id required");
      const { data: target } = await admin
        .from("profiles")
        .select("id, tenant_id, user_id, role, full_name")
        .eq("id", body.id)
        .maybeSingle();
      if (!target || target.tenant_id !== tenant_id) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (target.user_id === callerUserId && body.action === "disable") {
        return new Response(JSON.stringify({ error: "You cannot disable your own account" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: targetAuth } = await admin.auth.admin.getUserById(target.user_id);
      const email = targetAuth.user?.email;
      if (!email) throw new Error("Target email not found");
      const siteUrl = Deno.env.get("SITE_URL") || "https://aaed-2.vercel.app";

      if (body.action === "disable" || body.action === "enable") {
        const disabled = body.action === "disable";
        const { error } = await admin.auth.admin.updateUserById(target.user_id, {
          ban_duration: disabled ? "876000h" : "none",
        });
        if (error) throw error;
        await admin.from("profiles").update({
          account_status: disabled ? "disabled" : "active",
          disabled_at: disabled ? new Date().toISOString() : null,
          disabled_by: disabled ? callerUserId : null,
        }).eq("id", target.id);
        await audit(disabled ? "user_disabled" : "user_enabled", target.user_id);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const linkType = body.action === "reset_access" ? "recovery" : "magiclink";
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: linkType,
        email,
        options: { redirectTo: body.action === "reset_access" ? `${siteUrl}/reset-password` : siteUrl },
      });
      if (linkError) throw linkError;
      const profileUpdates: Record<string, unknown> = {
        account_status: body.action === "invite" ? "invited" : targetAuth.user?.banned_until ? "disabled" : "active",
      };
      if (body.action === "invite") {
        profileUpdates.invited_at = new Date().toISOString();
      }
      await admin.from("profiles").update(profileUpdates).eq("id", target.id);
      await audit(body.action, target.user_id, { email });
      return new Response(JSON.stringify({
        ok: true,
        action_link: linkData.properties?.action_link || null,
      }), {
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
      await audit("user_deleted", target.user_id);
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
