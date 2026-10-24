import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));
vi.mock("@/lib/notificationSound", () => ({ notificationSound: { play: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-dev" } }, error: null });
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  mocks.channel.mockReturnValue(channel);
  mocks.from.mockImplementation((table: string) => {
    if (table === "admin_notifications") {
      return { select: () => ({ order: () => ({ limit: async () => ({
        data: [{ id: "notice-1", title: "Test", read: false }], error: null,
      }) }) }) };
    }
    return {
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
  });
});

describe("admin notifications confirmed state", () => {
  it("does not mark init successful when the first read fails; a retry can recover", async () => {
    const original = mocks.from.getMockImplementation()!;
    let failFirstRead = true;
    mocks.from.mockImplementation((table: string) => {
      if (table === "admin_notifications" && failFirstRead) {
        failFirstRead = false;
        return { select: () => ({ order: () => ({ limit: async () => ({ data: null, error: new Error("read rejected") }) }) }) };
      }
      return original(table);
    });
    const { adminNotificationsStore } = await import("@/lib/adminNotificationsStore");
    await expect(adminNotificationsStore.init()).rejects.toThrow("read rejected");
    expect(adminNotificationsStore.list()).toEqual([]);
    await adminNotificationsStore.init();
    expect(adminNotificationsStore.list()).toHaveLength(1);
    expect(mocks.channel).toHaveBeenCalledTimes(1);
  });

  it("leaves the unread state intact if the read receipt write is rejected", async () => {
    const original = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((table: string) => {
      if (table === "admin_notification_reads") {
        const base = original(table);
        return { ...base, upsert: vi.fn().mockResolvedValue({ error: new Error("write rejected") }) };
      }
      return original(table);
    });
    const { adminNotificationsStore } = await import("@/lib/adminNotificationsStore");
    await adminNotificationsStore.init();
    await expect(adminNotificationsStore.markRead("notice-1")).rejects.toThrow("write rejected");
    expect(adminNotificationsStore.unreadCount()).toBe(1);
  });
});
