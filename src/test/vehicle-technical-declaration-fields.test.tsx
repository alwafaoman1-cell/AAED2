// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleTechnicalDeclarationFields from "@/components/vehicle-entry/VehicleTechnicalDeclarationFields";
import { emptyVehicleTechnicalDeclaration, type VehicleTechnicalDeclarationForm } from "@/lib/vehicleTechnicalDeclaration";

const locale = vi.hoisted(() => ({ language: "ar" }));
const signature = vi.hoisted(() => ({ value: "data:image/png;base64,aGVsbG8=" }));
const errorToast = vi.hoisted(() => vi.fn());
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: locale }) }));
vi.mock("sonner", () => ({ toast: { error: errorToast } }));
vi.mock("@/components/ElectronicSignaturePad", () => ({ default: ({ onChange, disabled, value }: {
  onChange: (next: string) => void; disabled: boolean; value: string;
}) => <button type="button" disabled={disabled} data-signature={value} onClick={() => onChange(signature.value)}>Test signature</button> }));

function form(patch: Partial<VehicleTechnicalDeclarationForm> = {}) {
  return { ...emptyVehicleTechnicalDeclaration, ...patch };
}

describe("controlled vehicle technical declaration fields", () => {
  beforeEach(() => { locale.language = "ar"; signature.value = "data:image/png;base64,aGVsbG8="; errorToast.mockReset(); });

  it("emits a complete new value without mutating or owning the parent's state", () => {
    const value = Object.freeze(form({ claim_number: "C/7", signature_data_url: signature.value }));
    const onChange = vi.fn();
    const view = render(<VehicleTechnicalDeclarationFields value={value} onChange={onChange} />);
    const group = screen.getByRole("group", { name: "يدور المحرك" });
    fireEvent.click(within(group).getByRole("button", { name: "نعم" }));
    expect(onChange).toHaveBeenCalledWith({ ...value, cranking: "yes" });
    expect(value.cranking).toBe("");
    expect(within(group).getByRole("button", { name: "نعم" }).getAttribute("aria-pressed")).toBe("false");
    view.rerender(<VehicleTechnicalDeclarationFields value={onChange.mock.calls[0][0]} onChange={onChange} />);
    expect(within(group).getByRole("button", { name: "نعم" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button").every((button) => button.getAttribute("type") === "button")).toBe(true);
    expect(view.container.querySelector("form")).toBeNull();
  });

  it("locks only identity text when requested, preserving condition and Gear Box questions", () => {
    const value = form({ claim_number: "C/7", registration_number: "AB 1234", make_model: "Toyota Corolla" });
    const onChange = vi.fn();
    render(<VehicleTechnicalDeclarationFields value={value} onChange={onChange} identityReadOnly />);
    for (const text of ["C/7", "AB 1234", "Toyota Corolla"]) {
      const input = screen.getByDisplayValue(text) as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      fireEvent.change(input, { target: { value: "Rejected edit" } });
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("group", { name: "شقوق ظاهرة في الهيكل" })).getByRole("button", { name: "لا" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, gear_body_crack: "no" });
    fireEvent.click(within(screen.getByRole("group", { name: "أُحضرت برافعة" })).getByRole("button", { name: "نعم" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, towing: "yes" });
  });

  it("disables every editable input, choice, signer role, and signature", () => {
    const onChange = vi.fn();
    const { container } = render(<VehicleTechnicalDeclarationFields value={form()} onChange={onChange} disabled />);
    expect(Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input,textarea,button"))
      .every((control) => control.disabled)).toBe(true);
    fireEvent.change(screen.getByLabelText("اسم الموقّع"), { target: { value: "Ignored" } });
    fireEvent.click(screen.getByRole("button", { name: "Test signature" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears an old signature when signer name or role changes, using parent-provided names", () => {
    const value = form({ authorized_person: "Report Creator", signer_role: "report_author", signature_data_url: signature.value });
    const onChange = vi.fn();
    const view = render(<VehicleTechnicalDeclarationFields value={value} onChange={onChange}
      technicianName="Workshop Technician" reportAuthorName="Report Creator" />);
    fireEvent.change(screen.getByLabelText("اسم الموقّع"), { target: { value: "Other Signer" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, authorized_person: "Other Signer", signature_data_url: "" });
    const group = screen.getByRole("group", { name: "صفة الموقّع" });
    fireEvent.click(within(group).getByRole("button", { name: "الفني" }));
    const technician = { ...value, signer_role: "technician", authorized_person: "Workshop Technician", signature_data_url: "" };
    expect(onChange).toHaveBeenLastCalledWith(technician);
    view.rerender(<VehicleTechnicalDeclarationFields value={technician as VehicleTechnicalDeclarationForm} onChange={onChange}
      technicianName="Workshop Technician" reportAuthorName="Report Creator" />);
    fireEvent.click(within(group).getByRole("button", { name: "منشئ التقرير" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, signature_data_url: "" });
  });

  it("preserves checked values, existing notes and field length limits", () => {
    const value = form({ chassis_damage_lh: true, previous_improper_details: "Saved details", other_observations: "Saved observations" });
    const onChange = vi.fn();
    render(<VehicleTechnicalDeclarationFields value={value} onChange={onChange} />);
    const checkbox = screen.getByLabelText("ضرر شاصي يسار LH") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith({ ...value, chassis_damage_lh: false });
    expect((screen.getByDisplayValue("Saved details") as HTMLTextAreaElement).maxLength).toBe(110);
    expect((screen.getByDisplayValue("Saved observations") as HTMLTextAreaElement).maxLength).toBe(240);
    expect((screen.getByLabelText("تاريخ التوقيع") as HTMLInputElement).type).toBe("date");
  });

  it("rejects oversized signatures without inventing a replacement", () => {
    signature.value = "data:image/png;base64," + "a".repeat(9000);
    const value = form({ authorized_person: "Signer", signer_role: "technician" });
    const onChange = vi.fn();
    render(<VehicleTechnicalDeclarationFields value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Test signature" }));
    expect(onChange).toHaveBeenCalledWith(value);
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("switches all authored labels to English while preserving stored values", () => {
    const props = { value: form({ other_observations: "Original notes" }), onChange: vi.fn() };
    const view = render(<VehicleTechnicalDeclarationFields {...props} />);
    expect(screen.getByRole("group", { name: "يدور المحرك" })).toBeTruthy();
    locale.language = "en-GB";
    view.rerender(<VehicleTechnicalDeclarationFields {...props} />);
    expect(screen.queryByRole("group", { name: "يدور المحرك" })).toBeNull();
    expect(screen.getByRole("group", { name: "Cranking" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Gear Box Status" })).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/[\u0600-\u06ff]/);
    expect(view.container.firstElementChild?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByDisplayValue("Original notes")).toBeTruthy();
  });

  it("uses unique labels and input ids when embedded beside another instance", () => {
    const { container } = render(<><VehicleTechnicalDeclarationFields value={form()} onChange={vi.fn()} />
      <VehicleTechnicalDeclarationFields value={form()} onChange={vi.fn()} /></>);
    const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByLabelText("اسم الموقّع")).toHaveLength(2);
  });
});
