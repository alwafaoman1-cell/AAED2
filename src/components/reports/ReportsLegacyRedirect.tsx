import { Navigate, useLocation } from "react-router-dom";

type ReportsLegacyRedirectProps = {
  to: string;
};

export default function ReportsLegacyRedirect({ to }: ReportsLegacyRedirectProps) {
  const location = useLocation();
  const target = new URL(to, "https://reports.local");
  const incoming = new URLSearchParams(location.search);

  incoming.forEach((value, key) => {
    if (!target.searchParams.has(key)) {
      target.searchParams.append(key, value);
    }
  });

  const search = target.searchParams.toString();
  return <Navigate to={`${target.pathname}${search ? `?${search}` : ""}`} replace />;
}
