// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
const mocks = vi.hoisted(() => ({ context: vi.fn(), signature: vi.fn(), advance: vi.fn(), deliver: vi.fn(), detail: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff" }, hasRole: () => true }) }));
vi.mock("react-i18next", async original => ({...await original<object>(), useTranslation: () => ({ i18n: { language: "en", dir: () => "ltr" } }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/vehicleReviewVisit", () => ({ getReviewVisitContext: mocks.context, getReviewVisitIntakeSignatureState: mocks.signature, deliverReviewVisit: mocks.deliver }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ advanceVehicleVisit: mocks.advance, getVehicleVisitDetail: mocks.detail }));
vi.mock("@/components/ElectronicSignaturePad", () => ({ default: ({ onChange }: any) => <button onClick={() => onChange("NEW-SIGNATURE")}>Draw new signature</button> }));
vi.mock("@/components/vehicle-entry/VehicleIntakeReceiptCheck", () => ({ default: ({ onChange }: any) => <button onClick={() => onChange("NEW-RECEIPT")}>Verify new receipt</button> }));
import { VehicleReviewWorkflowPanel } from "@/components/vehicle-entry/VehicleReviewWorkflowPanel";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signature.mockResolvedValue({ revision: 1, signed: true });
  mocks.context.mockResolvedValue({ source_entry_id: "old", source_entry_number: "ENT-OLD", source_claim_id: "claim", source_claim_number: "CLAIM-OLD", source_work_order_id: "order", source_work_order_number: "WO-OLD", source_handover_id: "handover", source_handover_number: "VH-OLD", review_findings: "Brakes inspected and checked" });
});
afterEach(()=>vi.useRealTimers());
function show(stage: string, changedAt?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["vehicle-intake-receipts", "review", 1], { status: "issued" });
  render(<QueryClientProvider client={client}><MemoryRouter><VehicleReviewWorkflowPanel visit={{ entry: { id: "review", intake_revision: 1, vehicle_condition: { review_return: { reason: "Brake noise", arrival_condition: "Running", notes: "Check brakes", mileage: 123000, running_status: "not_running", new_damage: true, new_damage_notes: "New door scratch" } } }, workflow: { stage, revision: 0,changed_at:changedAt } }} onChanged={vi.fn(async () => {})}/></MemoryRouter></QueryClientProvider>);
  return client;
}
it("references the previous claim/order and starts work without an approval or new financial record", async () => {
  mocks.advance.mockResolvedValue({ stage: "in_progress" }); mocks.detail.mockResolvedValue({ workflow: { stage: "in_progress" } });
  show("arrived");
  await screen.findByRole("link", { name: "Previous claim: CLAIM-OLD" });
  expect(screen.getByRole("link", { name: "Previous work order: WO-OLD" })).toHaveAttribute("href", "/work-orders/WO-OLD");
  expect(screen.queryByRole("button", { name: /approval|create claim|create work order/i })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start vehicle review" })).toBeEnabled());
  expect(screen.getByText("123000")).toBeInTheDocument();
  expect(screen.getByText("Vehicle does not run")).toBeInTheDocument();
  expect(screen.getByText("New door scratch")).toBeInTheDocument();
  expect(screen.getByText("Check brakes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start vehicle review" }));
  await waitFor(() => expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({ entryId: "review", stage: "in_progress", requirements: {} })));
  expect(mocks.deliver).not.toHaveBeenCalled();
});
it.each([null, { revision: 1, signed: false }, { revision: 0, signed: true }])("blocks an unsigned, unavailable or older signature before starting review (%j)", async signature => {
  mocks.signature.mockResolvedValue(signature);
  show("arrived");
  await screen.findByRole("link", { name: "Previous claim: CLAIM-OLD" });
  const start = screen.getByRole("button", { name: "Start vehicle review" });
  expect(start).toBeDisabled();
  fireEvent.click(start);
  expect(mocks.advance).not.toHaveBeenCalled();
  expect(screen.getByText("The customer must sign the current review intake revision before work starts or findings are approved.")).toBeInTheDocument();
});
it("requires a fresh signature after the intake revision changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (revision: number) => <QueryClientProvider client={client}><MemoryRouter><VehicleReviewWorkflowPanel visit={{ entry: { id: "review", intake_revision: revision, vehicle_condition: { review_return: { reason: "Brake noise", arrival_condition: "Running" } } }, workflow: { stage: "arrived", revision: 0 } }} onChanged={vi.fn(async () => {})}/></MemoryRouter></QueryClientProvider>;
  const rendered = render(view(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start vehicle review" })).toBeEnabled());
  mocks.signature.mockResolvedValue({ revision: 2, signed: false });
  rendered.rerender(view(2));
  expect(screen.getByRole("button", { name: "Start vehicle review" })).toBeDisabled();
  await waitFor(() => expect(client.getQueryData(["vehicle_entries", "review-intake-signature", "review", 2])).toEqual({ revision: 2, signed: false }));
  mocks.signature.mockResolvedValue({ revision: 2, signed: true });
  await client.invalidateQueries({ queryKey: ["vehicle_entries"] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start vehicle review" })).toBeEnabled());
  expect(mocks.advance).not.toHaveBeenCalled();
});
it("rechecks the signature immediately before advancing even when the displayed revision was signed", async () => {
  show("arrived");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start vehicle review" })).toBeEnabled());
  mocks.signature.mockResolvedValue({ revision: 2, signed: false });
  fireEvent.click(screen.getByRole("button", { name: "Start vehicle review" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.advance).not.toHaveBeenCalled();
});
it("restores saved findings and requires a new receipt, recipient, confirmation and signature before delivery", async () => {
  mocks.deliver.mockResolvedValue({ id: "new-handover", status: "finalized" }); mocks.detail.mockResolvedValue({ workflow: { stage: "delivered" }, hasFinalHandover: true });
  const client = show("ready");
  await waitFor(() => expect(screen.getByLabelText("Review findings and work performed")).toHaveValue("Brakes inspected and checked"));
  fireEvent.click(screen.getByRole("button", { name: "Deliver vehicle after review" }));
  const submit = screen.getAllByRole("button", { name: "Deliver vehicle after review" }).at(-1)!;
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Verify new receipt" }));
  fireEvent.change(screen.getByLabelText("Actual recipient name"), { target: { value: "Actual recipient" } });
  fireEvent.click(screen.getByLabelText("I confirm receipt of the vehicle after review with the findings shown above"));
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Draw new signature" })); fireEvent.click(submit);
  await waitFor(() => expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ entryId: "review", receiptId: "NEW-RECEIPT", signature: "NEW-SIGNATURE", recipient: "Actual recipient" })));
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  expect(client.getQueryState(["vehicle-intake-receipts", "review", 1])?.isInvalidated).toBe(true);
});
it("uses the chosen Muscat stage time while preserving the current-review signature requirement", async () => {
  mocks.advance.mockResolvedValue({stage:"in_progress"});mocks.detail.mockResolvedValue({workflow:{stage:"in_progress"}});show("arrived");
  await waitFor(()=>expect(screen.getByRole("button",{name:"Start vehicle review"})).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Review stage date and time"),{target:{value:"2026-11-15T11:25:30"}});
  fireEvent.click(screen.getByRole("button",{name:"Start vehicle review"}));
  await waitFor(()=>expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({occurredAt:"2026-11-15T07:25:30.000Z"})));
});
it.each([['arrived','in_progress','Start vehicle review'],['in_progress','ready','Complete review and prepare delivery']])("uses the actual save instant for an untouched %s action after a phase recorded within the same second",async(stage,next,label)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-17T08:00:00.950Z'));
  const previousInstant='2026-11-17T08:00:00.900Z';mocks.advance.mockResolvedValue({stage:next});mocks.detail.mockResolvedValue({workflow:{stage:next}});show(stage,previousInstant);
  await waitFor(()=>expect(screen.getByRole('button',{name:label})).toBeEnabled());
  expect((screen.getByLabelText('Review stage date and time') as HTMLInputElement).value).toMatch(/^2026-11-17T12:00(?::00(?:\.000)?)?$/);
  vi.setSystemTime(new Date('2026-11-17T08:00:01.500Z'));fireEvent.click(screen.getByRole('button',{name:label}));
  await waitFor(()=>expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({occurredAt:'2026-11-17T08:00:01.500Z'})));
  expect(Date.parse(mocks.advance.mock.calls[0][0].occurredAt)).toBeGreaterThan(Date.parse(previousInstant));
});
it("uses the actual final-save instant for untouched delivery time after ready was confirmed within the same second",async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-17T08:00:00.950Z'));
  const readyInstant='2026-11-17T08:00:00.900Z';mocks.deliver.mockResolvedValue({id:'new-handover',status:'finalized'});mocks.detail.mockResolvedValue({workflow:{stage:'delivered'},hasFinalHandover:true});show('ready',readyInstant);
  await waitFor(()=>expect(screen.getByLabelText('Review findings and work performed')).toHaveValue('Brakes inspected and checked'));
  fireEvent.click(screen.getByRole('button',{name:'Deliver vehicle after review'}));
  fireEvent.click(screen.getByRole('button',{name:'Verify new receipt'}));fireEvent.change(screen.getByLabelText('Actual recipient name'),{target:{value:'Actual recipient'}});
  fireEvent.click(screen.getByRole('button',{name:'Draw new signature'}));fireEvent.click(screen.getByLabelText('I confirm receipt of the vehicle after review with the findings shown above'));
  vi.setSystemTime(new Date('2026-11-17T08:00:01.500Z'));fireEvent.click(screen.getAllByRole('button',{name:'Deliver vehicle after review'}).at(-1)!);
  await waitFor(()=>expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({occurredAt:'2026-11-17T08:00:01.500Z'})));
  expect(Date.parse(mocks.deliver.mock.calls[0][0].occurredAt)).toBeGreaterThan(Date.parse(readyInstant));
});
it("uses a selected review delivery time and clears fresh ink when that time changes before final save", async () => {
  mocks.deliver.mockResolvedValue({id:"new-handover",status:"finalized"});mocks.detail.mockResolvedValue({workflow:{stage:"delivered"},hasFinalHandover:true});show("ready");
  await waitFor(()=>expect(screen.getByLabelText("Review findings and work performed")).toHaveValue("Brakes inspected and checked"));
  fireEvent.click(screen.getByRole("button",{name:"Deliver vehicle after review"}));
  fireEvent.click(screen.getByRole("button",{name:"Verify new receipt"}));
  fireEvent.change(screen.getByLabelText("Actual recipient name"),{target:{value:"Actual recipient"}});
  fireEvent.click(screen.getByRole("button",{name:"Draw new signature"}));
  fireEvent.click(screen.getByLabelText("I confirm receipt of the vehicle after review with the findings shown above"));
  const submit=screen.getAllByRole("button",{name:"Deliver vehicle after review"}).at(-1)!;expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Review delivery date and time"),{target:{value:"2026-11-15T12:45:30"}});
  expect(submit).toBeDisabled();fireEvent.click(submit);expect(mocks.deliver).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Draw new signature"}));
  fireEvent.click(screen.getByLabelText("I confirm receipt of the vehicle after review with the findings shown above"));
  fireEvent.click(submit);await waitFor(()=>expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({occurredAt:"2026-11-15T08:45:30.000Z",signature:"NEW-SIGNATURE",receiptId:"NEW-RECEIPT"})));
});
