# Customer WhatsApp center — Development implementation, 17 November 2026

Implemented locally on `codex/finance-security-development`, based on
`c0c9e857256e1c8c68cf324aa21441d1496af9c4`. No commit, push or deployment was
performed for this feature. No Production records were read or changed, and no
real WhatsApp message was sent during implementation or testing.

## What changed

The existing vehicle-entry detail page now opens a dedicated customer WhatsApp
center. It replaces the portal card's duplicated copy-message/direct-send
controls with one composer and one sending history. Existing link preparation,
copy-link, manager pause/reactivation and final-delivery visibility approval
remain available in the portal card.

The center groups 14 cases into intake/reviews, approval/repair, release/delivery
and follow-up/custom messages:

| Cases | Saved evidence required |
| --- | --- |
| Portal invitation | An active, unexpired protected portal and the visit's current customer |
| Initial or review intake signature | Correct visit type, issued unsigned current revision, vehicle inside workshop |
| Initial or review intake documents | Current signature, matching frozen revision and issued/used receipt |
| Approval / arrange arrival | Saved approval, correct presence, no known earlier/queued notification; unavailable for review visits |
| Work-order review/signature | Confirmed approved order available in the portal and not already signed/delivered |
| Repair progress | Current in-progress stage and vehicle inside workshop |
| Ready for pickup | Saved ready stage and vehicle inside workshop |
| Temporary-release signature | Complete saved report already awaiting signature; its saved named recipient |
| Temporary-release document | Signed release, recorded exit, not returned and not finally delivered |
| Final-delivery documents / follow-up | Finalized matching handover, delivered stage, customer-held location, explicit manager-visibility confirmation |
| Custom message | Current verified customer and active portal; a separate draft is prepared explicitly |

Case selection and opening the center perform reads only. Preparing a preview
can create a missing unified portal only after an explicit click. It never
reactivates a paused/expired portal, prepares/signs a report, changes a visit
stage, creates an approval, relinks records or copies old ink.

## Identity, privacy and sending

- Recipient identity comes from the canonical current visit customer. The
  temporary-release signature case instead uses that report's saved named
  recipient. Neither path falls back to a historical owner or caller-supplied
  phone number.
- Every template uses the existing allowlisted invitation builder: customer
  name, vehicle make/model/year and one protected customer-portal URL. It does
  not populate plate/VIN/ID, claim/order numbers, invoices, expenses or amounts.
  Staff can edit the reviewed message text; edits clear the review confirmation.
- Copy and Send re-read active staff authority, tenant, visit, recipient and
  portal. Changes invalidate the prepared draft. Send also requires review and
  a successfully loaded message history. A busy guard and explicit stable event
  keys protect repeated clicks and retries.
- Approval reuses the existing supervisor approval idempotency key and blocks
  known legacy queued/unconfirmed attempts. Review visits project their
  attested original claim/order through the read-only review-context RPC; no
  financial FK or new claim/approval is created.
- Provider sending remains through the existing `sendUnifiedMessage` service.
  Queued, sent, delivered, read, failed, dry-run and unknown states are distinct.
  Queued/unconfirmed feedback uses an amber waiting indicator. A provider
  acceptance is not reported as delivery or reading.
- History reads the latest 50 cloud `message_logs` rows scoped to tenant,
  customer, vehicle and visit key. Initial visits can also include their exact
  shared approval event. Review history excludes the original visit's approval.
  There is no deletion action or LocalStorage message store.
- Final-delivery messages require an explicitly returned null pending-handover
  field; a missing field is not treated as manager approval.

## Files

- `src/components/vehicle-entry/VehicleCustomerMessageCenter.tsx`: responsive
  composer, cases, recipient preview, review confirmation and read-only history.
- `src/components/vehicle-entry/VehicleCustomerPortalPanel.tsx`: one center
  entry point, consolidated portal controls, removal of the duplicate direct send.
- `src/lib/messaging/vehicleCustomerMessages.ts`: fresh context, eligibility,
  privacy-safe templates, draft verification, event keys and cloud history.
- `src/lib/i18n/vehicleCustomerMessages.ts`: Arabic/English center labels,
  descriptions and blocked-case reasons.
- `src/i18n/autoDictionary.ts`: the center button's global English mapping.
- `src/test/vehicle-customer-message-center.test.tsx`: 21 UI regression cases.
- `src/test/vehicle-customer-messages.test.ts`: 29 service/model regression cases.
- `src/test/unified-vehicle-portal-access.test.tsx`: retained 69 portal tests;
  updated center entry-point expectation and isolated its component boundary.

## Validation

Fresh exact-lock full validation: **2,195 tests passed, zero failed, six optional skipped**.
Typecheck, full ESLint and Vite/PWA build passed. All 1,714 validated files remained
unchanged during the run. Source digest: `a37ecffb2e9fca81ccef85376f9cc939b1367cd33d20b4e3b76a749ecf83a0ac`.
Validation completed at 2026-11-17T08:02:51.130Z; dependencies were unchanged (Vitest
4.1.12, React Router 7.18.2, Vite 7.3.7). External networking was blocked.

- Targeted checks: 29 service/model tests; 21 new center UI tests and 69 existing
  portal tests. These cover stale identity/scope changes, explicit review,
  repeated clicks, actual reviewed text, unknown/queued/dry-run states, missing
  manager approval and independent review-visit behavior.
- Independent source review passed with no findings. Arabic/English resources
  have matching keys and cover all 14 cases and every service blocker.
- Visual verification: 222 checks across Chromium/WebKit, Arabic/English and
  390/834/1280px. Verified nested RTL and keyboard direction, no horizontal
  overflow, 44px controls, explicit preparation/review and synthetic queued
  history. 24 screenshots were captured; representative views were reviewed.
- A real Development metadata SELECT confirmed the existing message-log and
  related table columns. A discovered receipt ordering mismatch was corrected
  to `issued_at`. No table, migration, RLS policy, Edge Function, package or
  lockfile changed.

Private validation evidence is under
`.vercel/vehicle-customer-messages-development-20261117/`. Earlier validation
snapshots were superseded by the strict manager-approval regression and global
translation registration; `current/locked-validation-proof.json` is the final
authoritative source-bound result.

## Verification boundaries

Browser screenshots use the actual new components and application CSS in an
isolated local harness with synthetic authentication/service responses. Unit
tests use fake configuration and block external networking. This is not a real
Production send, provider-delivery receipt, authenticated cloud Save or physical
phone test. Existing cloud sender/provider configuration, approved-template and
conversation-window requirements still apply. Data persistence was not exercised
by sending a real message, because no external send was authorized for testing.
No saved forms, signatures, receipts or production business records were edited.

The documentation report is added after code validation and does not change the
validated runtime source.
