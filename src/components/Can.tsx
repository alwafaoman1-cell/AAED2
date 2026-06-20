import { ReactNode } from "react";
import { useCan } from "@/lib/rbac";

interface CanProps {
  module: string;
  action: string;
  strict?: boolean;
  /** يُعرض بدلاً من المحتوى عندما لا توجد صلاحية. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Render-guard للصلاحيات.
 *   <Can module="Work Orders" action="Delete"><DeleteBtn/></Can>
 */
export default function Can({ module, action, strict, fallback = null, children }: CanProps) {
  const allowed = useCan(module, action, { strict });
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
