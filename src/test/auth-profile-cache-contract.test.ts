import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("auth profile cache contract", () => {
  it("centralizes profile caching and in-flight de-duplication outside AuthContext", () => {
    const helper = read("src/lib/authProfileCache.ts");
    const auth = read("src/contexts/AuthContext.tsx");

    expect(helper).toContain("const profileCache = new Map");
    expect(helper).toContain("const inFlightProfileRequests = new Map");
    expect(helper).toContain("export async function getCachedAuthProfile");
    expect(helper).toContain("const inFlight = inFlightProfileRequests.get(uid)");
    expect(helper).toContain("inFlightProfileRequests.set(uid, request)");
    expect(helper).toContain("export function clearAllAuthProfileCache");
    expect(helper).toContain("export function clearCachedAuthProfile");

    expect(auth).toContain("getCachedAuthProfile");
    expect(auth).toContain("clearAllAuthProfileCache");
    expect(auth).toContain("clearCachedAuthProfile(previousUserId)");
    expect(auth).toContain("sessionGenerationRef");
    expect(auth).toContain("isCurrentAuthRequest");
    expect(auth).toContain("currentUserIdRef.current === uid");
    expect(auth).not.toContain("const profileCache = new Map");
    expect(auth).not.toContain("const inFlightProfileRequests = new Map");
    expect(auth).not.toContain('.from("profiles")');
  });

  it("uses one SDK profiles read plus one explicit REST fallback, not parallel profile fan-out", () => {
    const helper = read("src/lib/authProfileCache.ts");

    expect(helper).toContain('.from("profiles")');
    expect(helper).toContain("fetchProfileViaRest");
    expect(helper).toContain("Single explicit fallback");
    expect(helper).toContain("profileRequestGenerations");
    expect(helper).toContain("globalProfileCacheGeneration");
    expect(helper).toContain("forceRefresh");
    expect(helper).not.toContain("firstValidProfile");
    expect(helper).not.toContain('.from("user_roles"');
    expect(helper).not.toContain("get_user_tenant_id");
  });

  it("guards stale profile results after logout or user switch", () => {
    const helper = read("src/lib/authProfileCache.ts");
    const auth = read("src/contexts/AuthContext.tsx");

    expect(helper).toContain("const isStillCurrent");
    expect(helper).toContain("globalProfileCacheGeneration === requestGlobalGeneration");
    expect(helper).toContain("profileRequestGenerations.get(uid) === requestGeneration");
    expect(helper).toContain("globalProfileCacheGeneration += 1");

    expect(auth).toContain("sessionGenerationRef.current += 1");
    expect(auth).toContain("clearAllAuthProfileCache()");
    expect(auth).toContain("forceRefresh: shouldRefreshProfile");
    expect(auth).toContain('_event === "USER_UPDATED"');
    expect(auth).toContain('_event === "SIGNED_IN"');
  });

  it("converts low-risk profile readers to AuthContext instead of direct profiles queries", () => {
    const portal = read("src/components/PortalNotesRealtimeListener.tsx");
    const media = read("src/pages/MediaStudio.tsx");

    expect(portal).toContain("useAuth");
    expect(portal).toContain("profile?.tenant_id");
    expect(portal).not.toContain('.from("profiles")');
    expect(portal).not.toContain("supabase.auth.getUser()");

    expect(media).toContain("const { profile, user } = useAuth()");
    expect(media).toContain('setTenantId(profile?.tenant_id || "")');
    expect(media).not.toContain('.from("profiles")');
    expect(media).not.toContain("supabase.auth.getUser()");
  });
});
