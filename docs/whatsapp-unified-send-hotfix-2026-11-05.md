# Unified WhatsApp sender hotfix — 2026-11-05

## Outcome

The unified sender is repaired and deployed on Production. Real WhatsApp
delivery is **not verified**: the configured Meta sender asset is inaccessible,
and the company numbers visible in WhatsApp Manager are not verified. No test
message was attempted, accepted, or delivered. No historical queue was replayed.

The user authorized repairing/publishing the sender and one test message to
`+968 92059707`. That destination remains the only permitted test recipient.

## Root cause and deployed scope

Production `unified-message-send` version 19 contained only `// test`, with no
request handler. Its OPTIONS request timed out. This was deployment/source
drift, not a recipient-phone or frontend rendering problem.

Only `unified-message-send` was published, as version 20, ACTIVE, with JWT
verification retained. Source downloaded after deployment matches the tested
`index.ts` and `handler.ts` (normalizing whitespace).

- Function ID: `8c659b3b-b015-4b56-a447-7784fe875224`
- Bundle SHA256: `521d14718826d1ce0ef96fa333e835f864fd4b018d2446671eff19a11fb133c4`
- No migration, frontend Production deployment, or worker change was required.
- Existing internal provider authentication and webhook signature checks remain.

## Source files

- `supabase/functions/unified-message-send/index.ts`: pinned Supabase SDK and
  thin verified entrypoint.
- `supabase/functions/unified-message-send/handler.ts`: preserved channel API;
  fresh user/profile authorization, tenant/reference checks, fail-closed rate
  checks, unique-key ownership for sending, bounded provider requests, explicit
  dry-run behavior, provider-ID validation, and webhook-safe status persistence.
- `supabase/functions/unified-message-send/handler_test.ts`: twelve functional
  regression tests, including concurrent duplicate prevention and ambiguous
  network failures.
- `src/test/whatsapp-cloud-api-contract.test.ts`: contract coverage for the real
  handler and entrypoint.

The existing reservation RPC can return ownership for an older empty reservation.
The repaired sender uses the existing unique constraint directly instead; no
schema/RPC or historical record was changed.

## Verification

- Deno typecheck: PASS.
- Functional handler tests: **12 passed, 0 failed**; rerun after live inspection.
- Full-project typecheck: PASS.
- Lint: PASS, zero warnings/errors.
- Full project suite: **1394 passed, 0 failed, 6 existing optional skips** out of
  1400 tests.
- Production build: PASS; Vite build took 35.08 seconds.
- QA Preview: `https://temo-work-order-preview-2frfufy4a-alwafaoman1-cells-projects.vercel.app`
- QA deployment: `dpl_BD9qWDnD5J3getEk2syEB9v5RtNc`.

Development function version 1 was exercised over actual HTTP. Disabled staff,
foreign tenant/references, and invalid attachments were denied. Eight concurrent
dry-run calls with one key produced one log/reservation and seven duplicate
blocks, with zero provider sends. The isolated fixture profile was restored and
only the temporary test session was revoked.

Production runtime checks: OPTIONS 200, anonymous POST 401, active-admin
authentication confirmed, and wrong-tenant access denied. The internal provider
endpoint still returns its expected 403 without its internal secret.

## Remaining external gate — Meta

The existing integration health check returns:

> Unsupported get request. Object with ID '723430520849023' does not exist,
> cannot be loaded due to missing permissions, or does not support this operation.

This response does not distinguish an obsolete ID from missing asset access; it
is not sufficient evidence to claim that the token has expired.

Read-only inspection in the already-authorized Chrome WhatsApp Manager showed:

- Saved ERP Phone Number ID: `723430520849023`.
- Saved ERP Business Account ID: `732693169326956`.
- Visible company account: `976420708634673`.
- Company number `+968 7712 3306`: **not verified**, display name pending review;
  its displayed Phone Number ID is `1165413263332559`, not the saved sender ID.
- Another visible company number, `+968 9908 0203`, is also not verified.
- The separate Arabic company account has no phone numbers.
- The test account has a test number only; it was not substituted for the company.

No sender/configuration/credentials, Meta permissions, or phone registration was
changed by guesswork. Do not silently replace a sender, move a number, weaken
security, or mark this as a successful delivery test. Complete the intended
company-number verification and its existing application's asset access first.
Then rerun the real provider health check, establish template/conversation
eligibility, and perform the single authorized send with the prepared key.

## Data preservation and session cleanup

At `2026-11-05T18:39:52.254683Z`, exact-key readback showed no test message/provider
log. Historical message fingerprints and finance fingerprints were unchanged;
invoice balance mismatch count remained zero. The normal integration health
probe updated only its usual last-test metadata. No invoice, payment, number,
claim history, backfill, reclassification, or accounting posting was changed.

The single-send guard remains unused (`send_attempted: false`). The temporary
Production verification session was revoked with local scope only; existing user
sessions were not globally signed out. Private evidence/backups are encrypted or
ignored under `.vercel/`, never committed with credentials.

No new Git commit/push or main change was made for this hotfix. The deployed Edge
function is ahead of the local Git history; these exact source files must be
included in a later explicitly authorized selective commit to prevent drift.

**Decision: sender service repaired/published; real delivery blocked on Meta
sender verification/asset access, not yet fully activated.**
