import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkflowRequirementPolicy } from "@/lib/workflowRequirements";

/** Presentation only; the database checks the current policy for every exception. */
export default function WorkflowRequirementsBanner({ requirementsEnabled = true, policy }: { requirementsEnabled?: boolean; policy?: WorkflowRequirementPolicy | null }) {
  const { i18n } = useTranslation();
  if (requirementsEnabled || !policy) return null;
  const ar = i18n.language.startsWith("ar");
  return <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
    <div className="min-w-0 space-y-1">
      <strong>{ar ? "الشروط التشغيلية متوقفة — الاستثناءات تُسجّل في سجل التدقيق" : "Operational requirements paused — exceptions are audited"}</strong>
      <p className="break-words">{policy.reason}</p>
      <p className="text-xs text-muted-foreground">{ar ? "تظل الهوية والصلاحيات والروابط والتواقيع السابقة محفوظة. لا يُسجّل اعتماد أو توقيع لم يحدث." : "Identity, permissions, links and previous signatures remain protected. Approval or signature evidence is never fabricated."}</p>
    </div>
  </div>;
}
