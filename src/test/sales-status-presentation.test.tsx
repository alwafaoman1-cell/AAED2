// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const locale=vi.hoisted(()=>({language:"en"}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:locale})}));
import SalesStatusBadge from "@/components/sales/SalesStatusBadge";
import { statusLabel, type SalesDocStatus } from "@/lib/salesStore";
afterEach(()=>{cleanup();locale.language="en";});
describe("sales status display compatibility, never a financial correction",()=>{
  it.each([['issued','Issued'],['credited','Credited'],['paid','Paid'],['partial','Partially paid']])("renders %s without losing the invoice list",(status,label)=>{
    render(<SalesStatusBadge status={status as SalesDocStatus}/>);expect(screen.getByText(label)).toBeVisible();
  });
  it("shows issuance in Arabic without marking an invoice collected",()=>{
    locale.language="ar";render(<SalesStatusBadge status={"issued" as SalesDocStatus}/>);expect(screen.getByText("صادرة")).toBeVisible();expect(screen.queryByText("مدفوعة")).toBeNull();
  });
  it.each(['unrecognized-import-state','__proto__','toString',''])('reports the raw unknown state safely: %s',status=>{
    const label=statusLabel(status);expect(label.en).toMatch(/^Unknown status:/);expect(label.ar).toMatch(/^حالة غير معروفة:/);expect(label.cls).toContain('warning');
    render(<SalesStatusBadge status={status as SalesDocStatus}/>);expect(screen.getByText(label.en)).toBeVisible();
  });
});
