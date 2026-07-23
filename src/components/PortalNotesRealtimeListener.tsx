// Global realtime listener for new customer portal notes.
import { useEffect } from "react";
import React from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { notificationSound } from "@/lib/notificationSound";

export default function PortalNotesRealtimeListener() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || null;

  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`portal-notes-global-${tenantId}`)
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
                  `${row.customer_name || "عميل"}: ${row.note}`,
                ),
              ),
            ),
            { duration: 8000 },
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return null;
}
