// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const api=vi.hoisted(()=>({read:vi.fn(),ensure:vi.fn(),tenant:"a"}));
vi.mock("@/lib/customerPortalTokens",()=>({readCustomerPortalToken:api.read,ensureCustomerPortalToken:api.ensure}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({profile:{tenant_id:api.tenant}})}));
import { useWorkOrderPortalToken } from "@/hooks/useWorkOrderPortalToken";
import { DeferredWorkOrderSection } from "@/components/workorders/DeferredWorkOrderSection";
const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
let client:QueryClient;
beforeEach(()=>{vi.clearAllMocks();api.tenant="a";api.read.mockResolvedValue(null);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("customer capabilities are never created by browsing",()=>{
  it("two panels share one read and zero writes, including a new order with no token",async()=>{
    const {result}=renderHook(()=>[useWorkOrderPortalToken("order"),useWorkOrderPortalToken("order")],{wrapper});
    await waitFor(()=>expect(result.current[0].isSuccess).toBe(true));
    expect(api.read).toHaveBeenCalledExactlyOnceWith("order","a");expect(api.ensure).not.toHaveBeenCalled();
    api.ensure.mockResolvedValue({token:"confirmed",signed_at:null});
    await act(async()=>{await result.current[0].ensure();});
    await waitFor(()=>expect(result.current[1].data?.token).toBe("confirmed"));expect(api.ensure).toHaveBeenCalledTimes(1);
  });
  it("shows a failed read and failed explicit creation without a false token",async()=>{
    api.read.mockRejectedValue(new Error("read denied"));api.ensure.mockRejectedValue(new Error("write denied"));
    const {result}=renderHook(()=>useWorkOrderPortalToken("order"),{wrapper});
    await waitFor(()=>expect(result.current.isError).toBe(true));expect(api.ensure).not.toHaveBeenCalled();
    await act(async()=>{await expect(result.current.ensure()).rejects.toThrow("write denied");});
    expect(result.current.data).toBeUndefined();
  });
  it("does not reuse another tenant's token",async()=>{
    api.read.mockResolvedValueOnce({token:"a-token"}).mockResolvedValueOnce(null);
    const {result,rerender}=renderHook(()=>useWorkOrderPortalToken("order"),{wrapper});
    await waitFor(()=>expect(result.current.data?.token).toBe("a-token"));api.tenant="b";rerender();
    expect(result.current.data).toBeUndefined();await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();expect(api.read).toHaveBeenLastCalledWith("order","b");
  });
  it("keeps off-screen sections unmounted until visible or explicitly requested",async()=>{
    let notify:IntersectionObserverCallback=()=>{};const disconnect=vi.fn();
    vi.stubGlobal("IntersectionObserver",class {constructor(cb:IntersectionObserverCallback){notify=cb;}observe(){}disconnect=disconnect;});
    const child=vi.fn();function Child(){child();return <span>Preserved action</span>;}
    render(<DeferredWorkOrderSection title="Links"><Child/></DeferredWorkOrderSection>);
    expect(child).not.toHaveBeenCalled();expect(screen.queryByText("Preserved action")).toBeNull();
    act(()=>notify([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver));
    expect(screen.getByText("Preserved action")).toBeVisible();expect(disconnect).toHaveBeenCalled();
  });
});
