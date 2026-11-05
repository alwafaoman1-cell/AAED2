import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { buildPartsRequestMessage, buildSupplierPartsRequest, sendWhatsAppAndLog } from "@/lib/partsWhatsApp";
import { readSupervisorOrder, type SupervisorVehicle } from "@/lib/supervisorWorkspace";
import type { WorkOrder } from "@/lib/workOrdersStore";

interface SupplierRecipient { id: string; name: string; phone: string }
export function SupervisorPartsMessenger({ row, order, target, onClose }: {
  row: SupervisorVehicle; order: WorkOrder; target: "customer" | "supplier"; onClose: () => void;
}) {
  const { t, i18n } = useTranslation("supervisorWorkspace");
  const { profile } = useAuth();
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const [search, setSearch] = useState("");
  const [settled, setSettled] = useState("");
  const [supplier, setSupplier] = useState<SupplierRecipient | null>(null);
  const busy = useRef(false);
  useEffect(() => { const timer = window.setTimeout(() => setSettled(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);
  const suppliers = useQuery({
    queryKey: ["suppliers", "supervisor_parts", profile?.tenant_id, settled],
    enabled: target === "supplier" && Boolean(profile?.tenant_id),
    queryFn: async () => {
      let query = supabase.from("suppliers").select("id,name,phone").eq("tenant_id", profile!.tenant_id).order("name").limit(20);
      if (settled) query = query.ilike("name", `%${settled.replace(/[%_,]/g, "")}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SupplierRecipient[];
    },
  });
  const recipient = target === "customer" ? { name: order.customer, phone: order.phone } : supplier;
  const draft = (current: WorkOrder, selected = supplier) => target === "customer"
    ? buildPartsRequestMessage(current, { language })
    : selected ? buildSupplierPartsRequest({ supplierName: selected.name, parts: current.partsNeeded || [], workOrder: current, language }) : "";
  const message = draft(order);
  const send = useMutation({
    mutationKey: ["supervisor", "parts_message", profile?.tenant_id, row.workOrderId],
    mutationFn: async () => {
      if (!recipient?.phone || !message || busy.current) throw new Error(t("chooseSupplier"));
      busy.current = true;
      try {
        const freshOrder = await readSupervisorOrder(row);
        let selected = supplier;
        if (target === "supplier") {
          if (!supplier || !profile?.tenant_id) throw new Error(t("chooseSupplier"));
          const { data, error } = await supabase.from("suppliers").select("id,name,phone").eq("tenant_id", profile.tenant_id).eq("id", supplier.id).maybeSingle();
          if (error) throw error;
          if (!data || data.phone !== supplier.phone || data.name !== supplier.name) throw new Error(t("recipientChanged"));
          selected = data as SupplierRecipient;
        } else if (freshOrder.phone !== recipient.phone || freshOrder.customer !== recipient.name) throw new Error(t("recipientChanged"));
        if (draft(freshOrder, selected) !== message) throw new Error(t("recipientChanged"));
        await sendWhatsAppAndLog({ message, phone: recipient.phone, workOrderId: freshOrder.cloudId!, kind: "parts_request", recipientName: recipient.name, recipientType: target });
      } finally { busy.current = false; }
    },
    onSuccess: () => { toast.success(t("partsSent")); onClose(); },
    onError: (error: Error) => toast.error(error.message || t("partsFailed")),
  });
  return <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4" aria-label={t("reviewMessage")}>
    <h3 className="font-semibold">{t("reviewMessage")}</h3>
    {target === "supplier" && <>
      <label className="block text-sm">{t("supplierSearch")}<Input className="mt-1 min-h-11" value={search} disabled={send.isPending} onChange={(event) => setSearch(event.target.value)} /></label>
      {suppliers.isPending ? <p role="status">{t("loading")}</p> : suppliers.isError ? <p role="alert">{t("loadError")}</p>
        : <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{suppliers.data?.map((item) => <Button key={item.id} variant={supplier?.id === item.id ? "default" : "outline"}
          className="min-h-11" aria-pressed={supplier?.id === item.id} disabled={!item.phone || send.isPending} onClick={() => setSupplier(item)}>{item.name} · <bdi>{item.phone || t("unknown")}</bdi></Button>)}
          {!suppliers.data?.length && <p>{t("noSuppliers")}</p>}</div>}
    </>}
    <p className="text-sm">{t("recipient")}: {recipient?.name || t("chooseSupplier")} · <bdi>{recipient?.phone || "—"}</bdi></p>
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-sans text-sm" dir={language === "en" ? "ltr" : "rtl"}>{message}</pre>
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={send.isPending || !recipient?.phone || !message} onClick={() => { if (!busy.current) send.mutate(); }}>{t(send.isPending ? "sending" : "send")}</Button>
      <Button className="min-h-11" variant="outline" disabled={send.isPending} onClick={onClose}>{t("close")}</Button></div>
  </section>;
}
