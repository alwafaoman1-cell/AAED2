# Supervisor tablet development verification

Date: 2026-11-05. Scope: Supervisor web workspace and its shared intake, expense, custody and messaging integrations.

Decision: Development Preview ready for review, not approved for Production rollout. Browser verification is complete within the scope below. Production remains NOT APPLIED. No commit, push, main change, historical repair or external message was authorized or performed in this task.

This decision records the Development-only phase. Subsequent explicit authorization to publish was handled separately; see [the Production rollout and observed limits](supervisor-tablet-production-rollout-2026-11-05.md). The historical Development evidence and its unresolved Auth discrepancy below are retained, not rewritten as an all-clear.

## Verified source and preview

- Base HEAD: `b592fbbcc13f77a9e12d3a838e3be3d0b07e8755`.
- Working branch: `codex/finance-security-development`.
- Development project: `rrhyglrnlveygyiandhs`.
- Protected Preview: https://temo-work-order-preview-1kp1ndec4-alwafaoman1-cells-projects.vercel.app/supervisor
- Deployment: `dpl_J14gpqTLpdFpgTGV2bHSs6wdUV7F`, independently confirmed READY, Preview target, separate preview project.
- All 62 changed source, test and migration files match the uploaded QA snapshot byte-for-byte. This report is an additional documentation file, not part of that source digest.
- Manifest content digest: `758271bd9440a6804387c685f33885c2b69435c37edbda7d4e9207939b9d6f02`.
- Full project typecheck PASS; lint PASS with zero errors/warnings; full suite 1,400 total, 1,394 passed, zero failed, six existing optional skips; Production-mode Vite build PASS. Full verification ran on the remote 8 GB builder, not a memory-constrained local process.
- Existing dependency deprecations and the main bundle size warning remain; this is not a warning-free platform certification.

## Architecture and behavior

The tablet workspace uses the canonical bounded vehicle-center query, actual entry custody and confirmed work-order UUIDs. Delivered, cancelled, review and legacy lists are not fully loaded on startup. Cash and insurance filtering happens before server counts and pagination. No browser-local operational database or second media store was introduced.

Vehicle Entry replaces Create Work Order. Its existing four-step editor, current visitor identity, existing-vehicle confirmation, damage/technical declaration, photos and atomic save are reused. Claim/order prefill uses exact same-tenant cloud identifiers, refuses conflicts and reopens an existing confirmed visit. It never auto-links historical candidates or transfers vehicle ownership.

Per-vehicle expenses reuse the accounting form, database categories, VAT-inclusive calculation, attachments and real order derivation. Missing order links block saving rather than silently creating an operating expense or invoice. A stable create UUID and exact readback recover interrupted saves; changed retries cannot overwrite the already-created voucher.

Stage actions, history, custody/release/return, work-order completion and handover open inside the Supervisor workspace. Existing permissions and backend prerequisites remain. Reversal cannot conceal recorded approval, work or delivery evidence: the UI now explains the existing source-first server rule instead of inviting a predictable HTTP 400. A legitimate manager reversal without contradictory evidence was exercised separately in a rolled-back Development transaction.

Temporary release reuses the saved visitor, confirmed technical findings, contents and key count. It does not infer ownership or turn unknown findings into negative findings. Actual exit condition and pending action still require review. A completed signed report has a same-tenant staff-issued, expiring, read-only customer capability using the existing receipt renderer; it cannot authorize a new signature.

Customer messages are reviewed drafts, not automatic sends. Approval wording depends on actual custody and includes vehicle, plate, claim and order. Entry/signature and completed temporary-release links use existing canonical documents. Fresh active-profile, tenant, recipient and event checks precede sending. Existing legacy approval notifications block duplicate sends rather than being silently treated as delivered. The approval write uses optional pending-state compare-and-set; original callers retain their API.

Runtime testing found two additional integration defects: the message textarea did not have an independently accessible label, and the current browser's center cache could remain Arrived after a confirmed approval. The textarea now has an explicit localized label; successful approval explicitly invalidates center and order readers instead of relying on WebSocket delivery for its own write. Supervisor subscriptions remain bounded and tenant-filtered. Media changes invalidate the canonical center thumbnails as well as media readers; no second photo source was introduced.

MagicPath was used to compare cards and compact arrangements in a private tablet prototype, then existing project components/tokens were used for the actual app. Synthetic prototype data is not an ERP data source.

## Development migrations only

1. `20261105115513_supervisor_center_channel_filter.sql`: guarded additive channel filtering of the existing invoker center query, with item/count/tab/stage parity verification.
2. `20261105120421_vehicle_inspection_release_readonly_link.sql`: active same-tenant staff capability for an already completed signed release. Anonymous issuance denied; token is consumed for signing at creation; no signed document is reopened.
3. `20261105145804_supervisor_expense_duplicate_guard_dependency.sql`: restore a genuinely missing Development duplicate-check dependency and add nullable supplier-document date/hash metadata. Read RPC remains SECURITY INVOKER; exact supplier-document duplicates are atomically denied. Existing Supervisor row visibility was not broadened.
4. `20261105155349_supervisor_media_realtime_dependency.sql`: add the existing RLS-protected `vehicle_media` table to the existing Realtime publication. The missing publication dependency was verified read-only, rehearsed idempotently in a rolled-back transaction, then applied. No rows, grants, RLS policies or replica identity were changed. All 12 subscribed tables are now present in the Development publication.

All four filenames match the actual Development ledger versions, checked again after testing. No blanket db push, Production migration, backfill, reclassification, accounting posting or historical amount/VAT/date/number change. The 32 historical linking candidates remain untouched.

## Runtime evidence

- Actual Development browser intake: save/readback and source retry PASS; one claim visit and one existing work order, no duplicate.
- Actual vehicle expense: one OMR 10 voucher on the exact cash work order. An initial runner assertion expected an array instead of the single-object response; separate browser history and database readback confirmed the save. No second expense was inserted just to obtain a green test.
- Actual inspection release: recipient prefill, cloud save, customer signature, with-customer tab and completed read-only link PASS.
- Editor: existing source reopens the same visit; dirty-exit confirmation keeps edits or discards without changing cloud data, PASS.
- Stage workflow: actual forward transitions and timeline confirmed. Source-first reversal guidance prevents a predictable HTTP 400; a legitimate manager reversal with no contradictory evidence passed the separate rolled-back database test.
- Claim approval: actual pending-to-approved write/readback confirmed in the incremental Preview. The customer-held draft includes make/model/plate and arrival-coordination wording, without sending. The successful follow-up explicitly records that approval was previously confirmed, rather than issuing another write.
- Return: actual return updated the same entry and release; no second visit was created. The vehicle returned to the workshop tab and the reviewed message changed to in-workshop repair wording.
- Final Preview repeated responsive smoke, existing-entry editing/dirty-exit protection and expense-history readback: PASS. Desktop 1440 x 1024, tablet landscape 1180 x 820, portrait 820 x 1180 and mobile 390 x 844 had no horizontal overflow. English LTR and Arabic RTL screenshots were visually inspected. The Linux test runner required an Arabic font in its own headless environment; this was not an application CSS/font change.
- Final Preview two-window realtime test: PASS. An actor advanced the synthetic insurance visit from Approved to In progress through the actual UI. An independently subscribed observer displayed the new stage in 3,461 ms without refresh or a polling wait; five actual `postgres_changes` events were observed. Subscription acknowledgement was checked before the write.
- The successful intake, expense insert, signed release, approval and return tests were performed across the incremental Development previews. They were not all repeated as fresh writes on the final Preview; the final targeted repeats and full source/test/build gate above avoid manufacturing duplicate records for testing.
- Successful browser cases recorded zero console errors, page errors, HTTP errors and blocked unexpected requests. Real WhatsApp/email delivery was explicitly blocked by the test harness.
- Database tests: channel parity, wrong tenant, Supervisor role, denied approval escalation/direct timeline writes, active/disabled/anonymous read-link permissions, and reason/stale-revision reversal controls PASS. Security mutation rehearsals were rolled back.

Evidence artifacts are private ignored files under `.vercel/supervisor-*-e2e.json`, `supervisor-db-checks.json`, `supervisor-readlink-security.json` and `supervisor-reversal-security.json`. They are not release inputs.

## Integrity and remaining gates

- Exact old-column fingerprints of all 143 preexisting public tables, global public sequences and unrelated migration-ledger rows are unchanged outside the isolated synthetic tenant.
- Strict Auth fingerprint verification did NOT pass: three preexisting accounts remain, but one account has a different fingerprint. Its latest update is 2026-11-05 11:59:34 UTC; latest preexisting sign-in is 10:02:30 UTC. The actor and changed fields cannot be established from the aggregate baseline; the inspected Auth audit-log interval returned no entries. No assumption of harmlessness, rollback or account repair was made.
- No real WhatsApp/email message was sent. Provider delivery, Meta template eligibility and resolution of legacy queued approvals remain Production acceptance gates.
- Responsive Chromium viewports are not physical iPad/camera validation. Original PDF/print paths are reused; physical printing/PDF download from this new workspace has not been live-validated.
- Broad existing Supabase advisory groups remain: seven RLS/no-policy informational findings on internal tables, 13 anonymous-definer and 95 authenticated-definer warnings. The new authenticated read-link function appears in the latter group by design; its active-role/tenant/capability guards were exercised. These groups were not mass-suppressed.
- Existing refund behavior is not replaced with local cashbox arithmetic: the history UI explicitly requires a confirmed accounting reversal for refunds.
- Synthetic test accounts/records: all test sessions globally signed out and the two isolated synthetic profiles disabled after the final run. A separate read-only query confirmed both profiles disabled and zero remaining Auth sessions. Two synthetic entries, two orders, one claim and one OMR 10 expense remain retained. No customer notification or real message was sent, and fixture counts for insurance/cash invoices, payments and both journal tables are zero. No business records were deleted.

The preexisting Development user can use their existing Development credentials; no password is supplied, changed or copied from Production. Test identities are not a supported login method after sealing. A protected Preview may additionally require the user's Vercel authorization. The final decision is readiness for Development review, not an assurance that live providers, physical devices, all existing advisory groups or the unexplained Auth change have been cleared.

## Actual changed file manifest

- `src/App.tsx`
- `src/components/supervisor/SupervisorActionPanel.tsx`
- `src/components/supervisor/SupervisorClaimApproval.tsx`
- `src/components/supervisor/SupervisorExpenseHistory.tsx`
- `src/components/supervisor/SupervisorOrderTools.tsx`
- `src/components/supervisor/SupervisorPartsMessenger.tsx`
- `src/components/supervisor/SupervisorStagesPanel.tsx`
- `src/components/supervisor/SupervisorVehicleCard.tsx`
- `src/components/supervisor/SupervisorVisitMessages.tsx`
- `src/components/suppliers/SupplierPicker.tsx`
- `src/components/vehicle-entry/VehicleEntryConditionStep.tsx`
- `src/components/vehicle-entry/VehicleEntryIdentityStep.tsx`
- `src/components/workorders/StagePhotosDialog.tsx`
- `src/components/workorders/VehicleDeliveryReceiptDialog.tsx`
- `src/hooks/useInsuranceClaims.ts`
- `src/hooks/useRealtimeSync.ts`
- `src/hooks/useVehicleEntryEditor.ts`
- `src/integrations/supabase/types.ts`
- `src/lib/expenses/expenseClassificationService.ts`
- `src/lib/expenses/expenseDuplicateGuard.ts`
- `src/lib/i18n/expenseEntryForm.ts`
- `src/lib/i18n/supervisorEntry.ts`
- `src/lib/i18n/supervisorWorkspace.ts`
- `src/lib/i18n/vehicleIntakeWizard.ts`
- `src/lib/i18n/vehicleVisitMessages.ts`
- `src/lib/messaging/vehicleVisitMessages.ts`
- `src/lib/partsWhatsApp.ts`
- `src/lib/supervisorIntakeSource.ts`
- `src/lib/supervisorWorkspace.ts`
- `src/lib/vehicleInspectionRelease.ts`
- `src/lib/vehicleVisitLifecycle.ts`
- `src/pages/accounting/expenses/ExpenseFormPage.tsx`
- `src/pages/apps/SupervisorApp.tsx`
- `src/pages/apps/SupervisorEntryWorkspace.tsx`
- `src/pages/insurance/InsuranceClaimDetail.tsx`
- `src/pages/vehicle-entry/VehicleEntryForm.tsx`
- `src/pages/vehicle-entry/VehicleInspectionReleasePage.tsx`
- `src/pages/vehicle-entry/VehicleTechnicalDeclarationPage.tsx`
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`
- `src/pages/vehicle-entry/VehicleVisitQuickActionDialog.tsx`
- `src/test/data-sync-performance-contract.test.ts`
- `src/test/expense-create-retry.test.ts`
- `src/test/expense-duplicate-required.test.ts`
- `src/test/expense-form-workspace-contract.test.ts`
- `src/test/expense-management-classification-contract.test.ts`
- `src/test/expense-supplier-picker-contract.test.ts`
- `src/test/supervisor-approval-cas.test.ts`
- `src/test/supervisor-channel-filter-contract.test.ts`
- `src/test/supervisor-intake-scope.test.tsx`
- `src/test/supervisor-intake-source.test.ts`
- `src/test/supervisor-realtime-dependency.test.ts`
- `src/test/supervisor-stage-reversal.test.ts`
- `src/test/supervisor-workspace.test.tsx`
- `src/test/vehicle-entry-order-link-panel.test.tsx`
- `src/test/vehicle-visit-messages.test.ts`
- `src/test/work-order-control-center.test.ts`
- `src/test/work-order-expense-persistence-contract.test.ts`
- `src/test/work-order-presence.test.ts`
- `supabase/migrations/20261105115513_supervisor_center_channel_filter.sql`
- `supabase/migrations/20261105120421_vehicle_inspection_release_readonly_link.sql`
- `supabase/migrations/20261105145804_supervisor_expense_duplicate_guard_dependency.sql`
- `supabase/migrations/20261105155349_supervisor_media_realtime_dependency.sql`

