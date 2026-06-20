// ملاحظات العملاء المرسَلة من بوابة QR — قبول / رفض
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, MessageSquare, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Note {
  id: string;
  note: string;
  customer_name: string | null;
  status: string;
  submitted_at: string;
}

interface Props { jobOrderId: string; }

export default function PortalNotesPending({ jobOrderId }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("customer_portal_notes")
      .select("id, note, customer_name, status, submitted_at")
      .eq("job_order_id", jobOrderId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    setNotes((data as any) || []);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`portal-notes-${jobOrderId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "customer_portal_notes", filter: `job_order_id=eq.${jobOrderId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [jobOrderId]);

  async function review(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    const { error } = await supabase.rpc("review_portal_note" as any, { p_id: id, p_decision: decision });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(decision === "approved" ? "تم قبول الملاحظة" : "تم رفض الملاحظة");
    load();
  }

  const pending = notes.filter((n) => n.status === "pending");
  const others = notes.filter((n) => n.status !== "pending");

  if (notes.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground">ملاحظات العملاء من بوابة QR</h3>
        {pending.length > 0 && (
          <span className="text-[10px] bg-warning/20 text-warning px-2 py-0.5 rounded-full">{pending.length} بانتظار الاعتماد</span>
        )}
      </div>

      {pending.map((n) => (
        <div key={n.id} className="bg-warning/5 border border-warning/30 rounded-lg p-3">
          <div className="flex justify-between items-start gap-2 mb-1">
            <div className="text-[10px] text-muted-foreground">
              {n.customer_name || "عميل"} · {new Date(n.submitted_at).toLocaleString("en-GB")}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="default" disabled={busy === n.id} onClick={() => review(n.id, "approved")} className="h-7 gap-1">
                {busy === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check size={12} />} قبول
              </Button>
              <Button size="sm" variant="destructive" disabled={busy === n.id} onClick={() => review(n.id, "rejected")} className="h-7 gap-1">
                <X size={12} /> رفض
              </Button>
            </div>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
        </div>
      ))}

      {others.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">سجل ({others.length})</summary>
          <div className="mt-2 space-y-1">
            {others.map((n) => (
              <div key={n.id} className={`text-[11px] p-2 rounded border ${n.status === "approved" ? "bg-success/5 border-success/20" : "bg-secondary/30 border-border opacity-70"}`}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${n.status === "approved" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                  {n.status === "approved" ? "مقبولة" : "مرفوضة"}
                </span>{" "}
                <span className="text-muted-foreground">{n.customer_name || "عميل"}:</span> {n.note}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
