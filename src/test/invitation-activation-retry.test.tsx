// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), invoke: vi.fn(), signOut: vi.fn(), navigate: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { updateUser: mocks.updateUser, signOut: mocks.signOut,
    getSession: async () => ({ data: { session: {} } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }, functions: { invoke: mocks.invoke },
} }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("react-i18next", async (importOriginal) => ({ ...await importOriginal<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }) }));
import ResetPasswordPage from "@/pages/ResetPassword";

beforeEach(() => { vi.clearAllMocks(); mocks.updateUser.mockResolvedValue({ error: null }); mocks.signOut.mockResolvedValue({ error: null }); });
describe("invitation activation confirmed-save retry", () => {
  it("retries activation without resaving an already-confirmed password", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ data: { ok: true }, error: null });
    render(<ResetPasswordPage />);
    await screen.findByLabelText("كلمة المرور الجديدة");
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), { target: { value: "offline-test-password" } });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), { target: { value: "offline-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ كلمة المرور" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("authSafety.invitationActivationUnconfirmed"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "authSafety.retryActivation" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/auth", { replace: true }));
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});
