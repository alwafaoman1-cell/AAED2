import { FileCheck2, FileClock, FilePenLine, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CLAIM_ESTIMATE_STATUS_META,
  readClaimEstimateLifecycle,
  type ClaimEstimateDocumentStatus,
} from "@/lib/claimEstimateLifecycle";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<ClaimEstimateDocumentStatus, typeof FileText> = {
  not_created: FileText,
  draft: FilePenLine,
  ready: FileClock,
  sent: FileCheck2,
  modified_after_send: FilePenLine,
};

interface ClaimEstimateStatusBadgeProps {
  claim: unknown;
  compact?: boolean;
  className?: string;
}

export default function ClaimEstimateStatusBadge({
  claim,
  compact = false,
  className,
}: ClaimEstimateStatusBadgeProps) {
  const lifecycle = readClaimEstimateLifecycle(claim);
  const meta = CLAIM_ESTIMATE_STATUS_META[lifecycle.status];
  const Icon = STATUS_ICON[lifecycle.status];
  const revision = lifecycle.revision > 0 ? ` · م${lifecycle.revision}` : "";
  const title = [
    `تقدير الإصلاح: ${meta.ar}`,
    lifecycle.estimateNumber ? `رقم التقدير: ${lifecycle.estimateNumber}` : null,
    lifecycle.revision > 0 ? `المراجعة الحالية: ${lifecycle.revision}` : null,
    lifecycle.sentRevision ? `آخر مراجعة مرسلة: ${lifecycle.sentRevision}` : null,
  ].filter(Boolean).join("\n");

  return (
    <Badge
      variant="outline"
      title={title}
      className={cn("gap-1 border", meta.className, className)}
      data-testid="claim-estimate-status"
      data-status={lifecycle.status}
    >
      <Icon size={11} />
      {compact ? meta.ar : `تقدير الإصلاح: ${meta.ar}`}
      {revision}
    </Badge>
  );
}
