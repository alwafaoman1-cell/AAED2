// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkOrder } from "@/lib/workOrdersStore";
const api=vi.hoisted(()=>({read:vi.fn(),ensure:vi.fn(),print:vi.fn(),language:"ar"}));
vi.mock("@/lib/safePdfWindow", () => ({ openAndPrintWindow: api.print }));
vi.mock("@/lib/customerPortalTokens", () => ({readCustomerPortalToken:api.read,ensureCustomerPortalToken:api.ensure,buildCustomerPortalUrl:(token:string)=>token?`https://example.test/customer/vehicle/${token}`:""}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({profile:{tenant_id:"tenant"}})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:api.language}})}));
import QrLabel from "@/components/workorders/QrLabel";
const order = { id: "WO-C-26-0001", cloudId: "11111111-1111-4111-8111-111111111111", workOrderType: "general_customer", plate: "QA 123", vehicleType: "Synthetic", model: "Audit", year: "2026", phone: "99990000", trackingToken: "legacy-token" } as WorkOrder;
function show(onClose=vi.fn()) { const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}}); return render(<QueryClientProvider client={client}><QrLabel order={order} open onClose={onClose}/></QueryClientProvider>); }
beforeEach(()=>{vi.clearAllMocks();api.language="ar";api.read.mockResolvedValue({token:"canonical-token",enabled:true,expires_at:null});api.ensure.mockResolvedValue({token:"canonical-token",enabled:true,expires_at:null});});
afterEach(cleanup);
it("opens a read-only canonical QR with retained print controls and working close", async () => {
  const errors=vi.spyOn(console,"error");const onClose=vi.fn();show(onClose);
  const dialog=screen.getByRole("dialog",{name:"ملصق QR"});
  await waitFor(()=>expect(dialog.querySelector("svg#qr-svg-WO-C-26-0001")).not.toBeNull());
  expect(screen.getByText(order.plate)).toBeDefined();expect(screen.getByRole("button",{name:"طباعة الملصق"})).toBeEnabled();
  expect(api.ensure).not.toHaveBeenCalled();expect(screen.queryByText(/99990000/)).toBeNull();expect(errors).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"إغلاق"}));expect(onClose).toHaveBeenCalledOnce();errors.mockRestore();
});
it("does not fall back to a legacy token or create a portal before explicit preparation",async()=>{
  api.read.mockResolvedValue(null);show();
  await waitFor(()=>expect(api.read).toHaveBeenCalled());
  expect(screen.queryByText(/legacy-token/)).toBeNull();expect(api.ensure).not.toHaveBeenCalled();expect(document.querySelector("svg#qr-svg-WO-C-26-0001")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"تجهيز رمز بوابة العميل"}));
  await waitFor(()=>expect(document.querySelector("svg#qr-svg-WO-C-26-0001")).not.toBeNull());
  expect(api.ensure).toHaveBeenCalledExactlyOnceWith(order.cloudId);expect(screen.getByText("https://example.test/customer/vehicle/canonical-token")).toBeDefined();
});
it("prints English-only portal instructions without exposing the phone password",async()=>{
  api.language="en";show();await waitFor(()=>expect(screen.getByRole("button",{name:"Print Label"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Print Label"}));
  const html=api.print.mock.calls[0][0];expect(html).not.toMatch(/[\u0600-\u06ff]/);expect(html).not.toContain(order.phone);expect(html).toContain("plate number and letters");expect(html).toContain("/customer/vehicle/canonical-token");
});
