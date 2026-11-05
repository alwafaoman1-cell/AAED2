import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateClaimStatus } from "@/hooks/useInsuranceClaims";
import { loadVehicleVisitMessageContext } from "@/lib/messaging/vehicleVisitMessages";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@/lib/i18n/vehicleVisitMessages";

/** Uses the existing approval mutation and its server guards. No new approval API. */
export function SupervisorClaimApproval({ claimId, onApproved }: { claimId: string; onApproved: () => void }) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const tr = (key: string) => t(`vehicleVisitMessages.${key}`);
  const authorized = profile?.role === "admin" || profile?.role === "manager";
  const query = useQuery({ queryKey: ["vehicle_visit", "messages", "approval", profile?.tenant_id, profile?.user_id, claimId],
    queryFn: () => loadVehicleVisitMessageContext({ claimId }, profile!.tenant_id), enabled: authorized && !!profile?.tenant_id,
    retry: false, staleTime: 0 });
  const update = useUpdateClaimStatus({ notify: false });
  const [amount, setAmount] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const scope = JSON.stringify([profile?.tenant_id, profile?.user_id, profile?.role, claimId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { setConfirmed(false); setAmount(null); setFailed(false); }, [scope]);
  useEffect(() => () => { currentScope.current = ""; }, []);
  const value = amount ?? String(query.data?.approvedAmount || query.data?.estimatedAmount || "");
  async function approve() {
    const approvedAmount = parseMoneyInput(value);
    if (!authorized || !profile?.tenant_id || !confirmed || pending.current || !Number.isFinite(approvedAmount) || approvedAmount <= 0) return;
    pending.current = true; setFailed(false);
    try {
      const current = await loadVehicleVisitMessageContext({ claimId }, profile.tenant_id);
      if (currentScope.current !== scope || current.claimStatus !== "pending") throw new Error("claim_changed");
      const saved: unknown = await update.mutateAsync({ id: claimId, status: "approved", approved_amount: approvedAmount, expected_status: "pending" });
      if (!saved || typeof saved !== "object" || Array.isArray(saved) || !("id" in saved) || saved.id !== claimId
        || !("tenant_id" in saved) || saved.tenant_id !== profile.tenant_id || !("status" in saved) || saved.status !== "approved"
        || !("approved_amount" in saved) || (typeof saved.approved_amount !== "number" && typeof saved.approved_amount !== "string")
        || !Number.isFinite(Number(saved.approved_amount)) || Math.abs(Number(saved.approved_amount) - approvedAmount) > 0.0005) throw new Error("approval_unconfirmed");
      const fresh = await loadVehicleVisitMessageContext({ claimId }, profile.tenant_id);
      if (currentScope.current !== scope || !fresh.approved || !Number.isFinite(fresh.approvedAmount) || Math.abs(fresh.approvedAmount - approvedAmount) > 0.0005) throw new Error("approval_unconfirmed");
      setConfirmed(false); onApproved();
    } catch { setFailed(true); void query.refetch(); }
    finally { pending.current = false; }
  }
  if (!authorized) return <p className="text-sm">{tr("approveRole")}</p>;
  if (query.isError) return <p role="alert">{tr("approveFailed")}</p>;
  if (query.data?.claimStatus !== "pending") return null;
  return <div className="space-y-3 rounded-lg border p-3">
    <label className="block space-y-2"><span>{tr("amount")}</span><Input inputMode="decimal" className="min-h-11" value={value}
      disabled={update.isPending} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} /></label>
    <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={confirmed} disabled={update.isPending}
      onChange={event => setConfirmed(event.target.checked)} /><span>{tr("approveConfirm")}</span></label>
    <Button type="button" className="min-h-11" disabled={!confirmed || update.isPending || query.isFetching || !(parseMoneyInput(value) > 0)} onClick={() => void approve()}>{tr("approve")}</Button>
    {failed && <p role="alert">{tr("approveFailed")}</p>}
  </div>;
}
