import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  invoiceNumberCorrectionWindowKey,
  readInvoiceNumberCorrectionWindow,
} from "@/lib/invoiceNumberCorrection";

export function useInvoiceNumberCorrectionWindow(active = true) {
  const { profile, hasRole } = useAuth();
  const tenantId = profile?.tenant_id || "";
  return useQuery({
    queryKey: invoiceNumberCorrectionWindowKey(tenantId),
    queryFn: () => readInvoiceNumberCorrectionWindow(tenantId),
    enabled: active && !!tenantId && hasRole("admin"),
    staleTime: 5_000,
    refetchInterval: active ? 15_000 : false,
  });
}
