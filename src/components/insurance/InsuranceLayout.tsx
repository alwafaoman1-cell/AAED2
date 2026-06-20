import { Outlet, useLocation } from "react-router-dom";
import InsuranceSubNav from "./InsuranceSubNav";

// Hide the sub-nav on full-screen flows (wizard / claim detail / archive)
const HIDDEN_PREFIXES = ["/insurance/new", "/insurance/companies/", "/insurance/"];

function shouldHide(pathname: string) {
  // Hide on claim detail (/insurance/:id) and its archive subroute, and on the new-claim wizard
  if (pathname === "/insurance/new") return true;
  // /insurance/:id  or  /insurance/:id/archive   (but NOT known list pages)
  const known = new Set([
    "/insurance",
    "/insurance/list",
    "/insurance/pipeline",
    "/insurance/alerts",
    "/insurance/payments",
    "/insurance/companies",
    "/insurance/work-orders",
    "/insurance/accounting",
    "/insurance/estimates",
    "/insurance/independent-estimates",
    "/insurance/documents",
    "/insurance/import",
  ]);
  if (known.has(pathname)) return false;
  // anything else under /insurance/* is a detail page → hide
  return pathname.startsWith("/insurance/");
}

export default function InsuranceLayout() {
  const { pathname } = useLocation();
  const hide = shouldHide(pathname);
  return (
    <div className="space-y-4">
      {!hide && <InsuranceSubNav />}
      <Outlet />
    </div>
  );
}
