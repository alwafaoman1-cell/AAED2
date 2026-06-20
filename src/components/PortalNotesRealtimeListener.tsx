// مستمع Realtime عام للملاحظات الجديدة من العملاء — صوت + توست
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificationSound } from "@/lib/notificationSound";
import { MessageSquare } from "lucide-react";
import React from "react";

export default function PortalNotesRealtimeListener() {
  useEffect(() => {
    let tenantId: string | null = null;
    let channel: any;

    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", u.user.id).maybeSingle();
      tenantId = (prof as any)?.tenant_id || null;
      if (!tenantId) return;

      channel = supabase
        .channel("portal-notes-global")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "customer_portal_notes", filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            const row: any = payload.new;
            if (!row || row.status !== "pending") return;
            notificationSound.play();
            toast(
              React.createElement(
                "div",
                { className: "flex items-start gap-2" },
                React.createElement(MessageSquare, { size: 16, className: "text-primary mt-0.5" }),
                React.createElement(
                  "div",
                  null,
                  React.createElement("div", { className: "font-bold text-sm" }, "ملاحظة عميل جديدة"),
                  React.createElement(
                    "div",
                    { className: "text-xs text-muted-foreground line-clamp-2" },
                    `${row.customer_name || "عميل"}: ${row.note}`
                  )
                )
              ),
              { duration: 8000 }
            );
          }
        )
        .subscribe();
    })();

    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  return null;
}
