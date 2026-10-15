# TEMO Intelligent Document Extraction Engine — Development baseline

Status: **Development only; not Production-ready.** The new path is enabled only when
`VITE_DOCUMENT_ENGINE_ENABLED=true` **and** `VITE_SUPABASE_URL` resolves to
`rrhyglrnlveygyiandhs.supabase.co`. The existing `ai-extract-data` route remains
unchanged for Production and other unsupported form schemas.
The separate server OCR queue additionally requires `VITE_DOCUMENT_WORKER_ENABLED=true`;
it is **off** by default. No Production database, Edge Function, or release was changed.

## Pipeline and ownership

```text
PDF/image → magic-byte and size check → SHA-256 private intake
          → PDF text layer per page → OCR only for image/text-poor pages
          → deterministic type/field parsing → normalization/validation
          → tenant-scoped entity matching and duplicate warnings
          → confidence → mandatory side-by-side human review
          → atomic review audit → allowlisted form fields (not a business save)
          → final form save → link one private file to the saved entity
```

`src/lib/documentExtraction/` owns file safety, native PDF, OCR provider, parsing,
matching, confidence, persistence, and per-form field allowlists. No claim,
vehicle, customer, supplier, invoice, expense, or work order is created by the
extraction engine. Finance category is never assigned by extraction.
The new path shows page/stage progress and maps failures to safe Arabic/English
messages instead of displaying raw database or worker exceptions.
Its processing wait is bounded to 180 seconds by default; timeout aborts the
browser OCR worker where possible and marks the lease failed for a safe retry.

The baseline browser path performs OCR in a Tesseract.js WASM worker (`ara+eng`); document
bytes are not sent to the model host. The worker downloads model/runtime files
on first use, which is a **deployment dependency** to remove or pin before
Production. Browser OCR was chosen for the initial Development pipeline because
Supabase Edge Functions have restrictive CPU and memory limits, and no
authenticated container worker existed at the time of the baseline. It is **not** evidence
that Tesseract's Arabic accuracy is sufficient for Production. A containerized
Arabic OCR provider should be benchmarked against sanitized, representative
documents before activation. A separate queue/worker design now exists
locally. Its process path has passed Development Storage/browser E2E as
described below, but its container has **not been built or deployed**.

AI is an optional provider fallback, **off by default**. It can run only below
the configured confidence threshold and only after native/OCR/rules. Any use is
recorded as external AI in the extraction result. The existing AI integration
is preserved for backward compatibility while the new flag is off.

## Coverage and confidence

Detection clues exist for vehicle registration, insurance claim/approval,
damage report, LPO, customer ID, supplier/purchase invoice, receipt, quotation,
workshop document and invoice. Field parsing is currently meaningful for
vehicle registration, claims/approvals/LPO and supplier/expense invoices.
Detection alone does **not** imply that all fields of a type are supported.

Supported first-pass fields: plate digits/code/country, VIN, make/model/year,
owner name/phone, registration dates, claim number/insurer/accident and approval
dates/LPO/approved amount/excess, supplier name/VATIN, invoice number/date,
currency, subtotal/VAT/discount/total, CR and payment method when clearly
labeled. Simple four-column purchase lines now have a guarded Development
extractor; complex tables and handwriting are not reliably extracted.

Confidence combines OCR/native page quality, labeled-pattern evidence, field
validation and document-type agreement. Exact database matches strengthen
individual fields. Overall confidence is recomputed after matching and AI;
identity conflicts or failed matching lower it. The default thresholds are
high 0.85, medium 0.65, AI fallback below 0.55. **No business record is saved
without human form submission.** OCR-derived IDs, dates and amounts (and all
AI-derived fields) require an explicit selection in review even when their
numeric confidence is high. A detected/expected type mismatch clears default
selection.

OMR amounts are parsed in integer milli-units; a VAT arithmetic mismatch is a
warning, never an automatic adjustment. Dates are validated as real calendar
days. VIN format rejects I/O/Q and requires 17 characters; global VIN checksum
is not enforced because its applicability varies by market.

## Matching and duplicates

Read-only, bounded queries scope every lookup to the current tenant and rely on
RLS as a second boundary. VIN and complete plate digits+letters+country can
suggest an existing vehicle; a VIN/plate conflict blocks review application.
Customer phone (last 8 digits) and name, supplier VATIN/name/fuzzy suggestion,
insurer name, existing claim number and supplier invoice number in purchases or
expenses are checked. Fuzzy suggestions never create or merge records.
Expense totals are only suggested when the extracted VAT agrees with the
existing VAT-inclusive calculation and supplier identity is trustworthy;
otherwise amount entry remains manual.

## Database, storage and privacy

Development migrations:

1. `20261013120000_document_extraction_engine.sql`: private `temo-documents`
   bucket; `document_files`, `document_extractions`,
   `document_extraction_fields`, `document_links`,
   `document_extraction_events`; RLS, audit and entity-link triggers.
2. `20261013121000_document_extraction_processing_safety.sql`:
   `document_extraction_pages`, lease/idempotency RPC and insert guards.
3. `20261013122000_document_review_atomic.sql`: atomic review RPC.
4. `20261013123000_document_review_rpc_only.sql`: direct field review blocked.
5. `20261013124000_document_review_guard_record_scope.sql`: safe trigger
   record handling for both review tables.
6. `20261013125000_document_private_bucket_only.sql`: refuse unverified
   references into legacy storage buckets; existing media remain unchanged.
7. `20261014100000_document_worker_queue.sql`: server OCR queue, retry metadata,
   enqueue RPC and browser write guards for worker results.

These seven migrations were applied **only** to Development and their versions
were registered with the official CLI. No `db push` was run. Existing migration
history has unrelated drift; a global push is unsafe. Runtime tests use a
transaction ending with `ROLLBACK`, leaving no synthetic tenant or user data.

Private storage paths include tenant and access scope. The new file abstraction
deduplicates by `(tenant, SHA-256, access scope)` and can link one file to
multiple entities without copying bytes. In the new expense form, the existing
attachment metadata can reference the same private file. Operational,
finance, and restricted scopes have separate role checks. No service-role key
is used in the frontend. Signed preview URLs are short-lived. Referencing
legacy media in this abstraction is intentionally blocked until server-side
ownership verification is implemented.

Original extracted values remain immutable after review; corrections are
recorded separately with actor and time. The baseline initial extraction is
computed in the **browser**, so its original value is user-supplied from the
server's perspective. The optional worker path writes OCR pages using a
server-held database connection; browser inserts/updates of worker evidence
are rejected. The browser still parses proposed fields from those pages before
human review, so field proposals are not an authoritative business decision.
Browser MIME/signature checks
also cannot substitute for server-side malware/content inspection.

## Development validation and reproducible commands

- `src/test/document-extraction-*.test.ts`: parser, intake, native PDF,
  expense/VAT, fuzzy scoring, confidence and review-selection tests.
- `supabase/tests/document_extraction_runtime_validation.sql`: admin,
  manager, insurance, accountant, technician, wrong tenant, anonymous grant,
  idempotency, atomic rollback, direct-review denial, audit and immutability.
- `supabase/tests/document_extraction_readonly_audit.sql`: six RLS tables,
  private bucket, migration history and zero test rows.
- `supabase/tests/document_worker_runtime_validation.sql`: rollback-only
  synthetic queue, idempotency, wrong-tenant, browser forgery, server OCR
  evidence and review-state test. Development run passed with zero fixture
  tenants remaining.
- `scripts/document-extraction-browser-smoke.mjs`: Chrome actual text PDF,
  image OCR, scanned PDF OCR and mixed-page PDF. Serve the repository using a
local Vite server with **synthetic** Supabase URL/key (no operational session).
- `RUN_REAL_OCR=1` enables the opt-in Node real-model benchmark. It currently
  **fails its Arabic insurance accuracy gate**; this is intentionally not
  presented as a passing OCR result.

Latest synthetic Chrome baseline (single run, **not** a production SLA):

| Input | Exact fields | Total processing |
|---|---:|---:|
| Native text PDF | 4/4 | 1,328 ms |
| PNG image | 3/4 (VIN misread) | 8,479 ms |
| Scanned PDF | 4/4 | 1,076 ms |
| Mixed PDF, 2 pages | 4/4 | 1,379 ms |

Additional Node OCR golden images in the latest run: English registration 4/4
(~1.96 s), mixed Arabic/English supplier invoice 7/7 (~1.48 s), Arabic-heavy
insurance claim **1/4 (~1.44 s)**. These are synthetic fixtures, not a representative fleet
sample; no Production customer documents are used. The Arabic failure is a
material blocker. Cold model download, tenant DB latency, storage upload,
real-form E2E and multi-user concurrency are not included in these timings.
The PNG run included a slower browser OCR worker/model start; this variance is
another reason not to treat these single-sample timings as a service target.

## Current integration and known gaps

- Vehicle Entry: review/autofill and link private document after saving entry.
- Insurance Claim creation: review/autofill, existing insurer suggestion, link
  private document after claim save.
- New Expense form: review, conservative VAT/supplier suggestion, reuse the
  private attachment on save.
- Development-only purchase form: review a complete four-column, arithmetic-
  checked table and fill draft lines with VAT left at zero for manual review.
  This legacy form still saves locally and does not link the document to a
  cloud purchase invoice. It is not an accounting-cloud integration.
- If no field is legible, review can attach the private document with zero
  autofilled fields; the operator completes the form manually.
- Other forms using `AiExtractButton` retain their legacy route while the flag
  is off; under the Development flag only supported schemas use the new engine.

## OCR worker and scanner upgrade (2026-10-14)

The Development-only worker is `services/document-ocr/`: a non-root container
design, PostgreSQL `FOR UPDATE SKIP LOCKED` lease queue, bounded attempts,
expired-lease recovery, 150-second subprocess deadline, server-held Storage
credentials, SHA-256/MIME/PDF/image validation, native-PDF text extraction and
PaddleOCR/Tesseract adapters. It only accepts the Development project ref;
there is no direct browser-to-worker endpoint. The browser can enqueue but
cannot publish worker OCR pages. Local browser OCR remains a compatibility path
until a fully tested server flow can replace it. Docker build and authenticated
worker-to-Storage E2E have **not** been run on this Windows host.

Same seven-case **synthetic** golden corpus: Tesseract.js matched 21/30 raw
normalized expected strings (70%), PaddleOCR 3.5.0 with the Arabic PP-OCRv5
mobile recognition model matched 23/30 (76.7%). Arabic-claim variants were
3/12 versus 5/12. These are raw-token matches, not verified structured-field
accuracy, and runtimes/timings are not directly comparable. Neither engine
meets the requested Arabic Production quality. No sanitized operational claim
dataset was available, so no Production OCR provider was selected.

`src/components/documents/DocumentScanner.tsx` is a feature-flagged scanner
that preserves camera/gallery upload, permits four-corner manual correction,
perspective transform, enhancement modes, page rotate/reorder/delete, PDF
download and OCR handoff. Its pure geometry/image pipeline runs in a browser
worker; no video frames are uploaded. Existing upload remains available.
The pure TypeScript canvas worker was selected for an offline, inspectable
Development prototype with no external image service; it is not a claim that
its contour detection outperforms a dedicated computer-vision library.
Synthetic Chrome headless smoke passed on desktop and Pixel 7 **emulation**:
fake-camera capture, gallery import, manual corner move, two-page PDF (~55 KB),
OCR handoff (two OCR pages), RTL switching and zero page exceptions. Warm
processing was ~2-3 seconds after OCR/model initialization; one cold run took
~8 seconds. A tiny synthetic two-token marker remained 2/2 before and after
enhancement. This says nothing reliable about real Arabic claims. Auto-capture,
page dewarping and robust shadow correction are **not** implemented; edge
detection is conservative and needs a real-device/document benchmark. iPhone
Safari and Android hardware were not tested. The scanner is therefore below
Production standard despite the green synthetic browser smoke.

| Scanner case | Detection | Crop/perspective | OCR marker before/after | PDF | Device evidence |
|---|---|---|---|---|---|
| Contrasted synthetic rectangle | 4 corners, confidence >0.3 | Pure unit test passed | Not measured | Not applicable | Synthetic unit test |
| Two synthetic gallery photos | Four editable corners | Manual drag and enhance passed | 2/2 → 2/2 English tokens | 2 pages, ~55 KB | Desktop Chrome headless |
| Same photos in mobile viewport | Four editable corners | Manual drag and enhance passed | 2/2 → 2/2 English tokens | 2 pages, ~55 KB | Pixel 7 Chrome emulation, not hardware |
| Real Arabic insurance claim photo | Not tested | Not tested | Not tested | Not tested | Blocker |

## Structured-field accuracy update (2026-10-15, Development only)

The Arabic claim failure is not a parser-only issue. Tesseract.js mixed-script
OCR read the synthetic reference as `71`, missed the plate, and read the date
as `17/4/7075`. Paddle Arabic OCR kept the Arabic labels but truncated the
Latin reference and Arabic-Indic plate/date digits. A targeted English model
pass now recovers only a high-confidence, complete `C/...` reference aligned
with a claim label. A coordinate-limited numeric pass recovers a plate that
was truncated inside its Arabic label; the parser ranks its separately
recognized value ahead of the shorter fragment. No missing date digits or
separators are synthesized. The date is left for human review.

`RUN_REAL_OCR=1` with the generated `synthetic-1` corpus and the structured
benchmark test measured **parsed normalized fields**, not OCR token presence:

| Case | Correct fields | Missed / unsupported |
|---|---:|---|
| Arabic claim, clean | 3/4 | Accident date |
| Arabic claim, low light | 3/4 | Accident date |
| Arabic claim, skewed | 3/4 | Accident date |
| Vehicle registration | 4/4 | None in this synthetic case |
| Mixed supplier invoice | 7/7 | None in this synthetic case |
| Parts-table invoice header/total | 2/2 | **Both line items unsupported (0/2)** |
| Two-page native approval PDF | 3/3 | None in this synthetic case |

Arabic claim total is **9/12 (75%)**, below the requested indicative 95%
critical-field target. Seven generated cases are not a statistically useful
or representative operational dataset. The generated invoice does not prove
VAT or line-item extraction on real receipts. The provider is not qualified
for Production. OCR identifiers still require explicit review rather than
automatic application.

This 9/12 result is the **native Paddle worker candidate**, not the browser-local
path. Raw mixed-script Tesseract reads only **1/4** Arabic claim fields on a
separate synthetic image. The guarded browser hybrid path now reads **2/4**.
The worker feature flag improves the user flow only while a healthy worker is
running; an authenticated Development process E2E was subsequently proven
below, but the Docker image remains untested.

The Desktop Chrome scanner smoke was rerun with a synthetic Supabase URL/key:
camera emulation, gallery, four movable corners, manual perspective/enhance,
two-page reorder, PDF output, OCR handoff and RTL passed with no page errors.
The same passed in a Chrome mobile viewport emulating a Pixel 7. Neither is
real-device evidence; Android hardware and iPhone/Safari remain untested.

The Development database read-only audit in the preceding validation found
seven extraction migrations registered, six RLS tables enabled, a private
bucket, a worker write guard, and zero document rows. At that checkpoint it
was not an end-to-end worker test. On this host Docker, Podman and WSL remain
unavailable, so the container image itself has not been built or run. The
existing purchase-invoice
page still uses a legacy LocalStorage-backed store; it must not be presented
as a cloud-synced document flow or be refactored into accounting without its
own migration and preservation plan. No Production migration, secret,
deployment, commit or push was performed for this work.

Open before Production: improve Arabic-heavy OCR and mixed-script numerals;
benchmark sanitized real documents and tables/line items; server-side content
inspection and authoritative processing; real form UI/browser E2E beyond the
isolated workflow harness; cold-load/mobile performance; reviewed-document reuse
across multiple forms; recovery UI for a saved entity whose document link
failed; purchase invoice and work-order document integration; multilingual
legacy AI UI; reliable server-side classification before granting document scope;
and a deliberate Production backup/migration security gate. The initial
browser-selected scope cannot prove that a mislabeled identity document was
uploaded into an operational scope, so the customer-ID path remains disabled.

## Verified Development flow (2026-10-15, Production Not Applied)

The live Development project `rrhyglrnlveygyiandhs` was exercised with a
disposable synthetic tenant/user/document. Chrome signed in, uploaded the
private Arabic claim image, enqueued it through the authenticated RPC, waited
for the Python worker to claim it, read it from private Storage, run PaddleOCR
and publish the OCR page, then parsed and saved fields in the browser. The
review RPC verified selected values; the same `buildAutofillPayload` function
handed approved values to the claim form payload. Critical OCR identifiers
were not preselected; repeat upload reused the verified extraction; a wrong
tenant was denied. No external AI was used and there were zero page errors.

The worker was run directly as a process, not inside its Docker image. The
temporary Development DB role was test-only and deliberately privileged; its
grant pattern is **not** a deployment design. The role and test auth user were
removed. A read-only
audit confirmed zero document DB rows, zero document Storage objects, zero
auth users/profiles, the original two tenants, and no leftover worker role.
At the time of this validation, no Production connection, migration, secret,
deployment, commit or push had occurred. A later Development-branch Git push
does not apply these migrations or enable the feature in Production.

The browser-local second pass rereads a Latin C/... word only when an Arabic
claim label is present, and accepts only a complete, high-confidence, same-row
reference. Actual Chrome synthetic Arabic claim accuracy improved from 1/4 to
**2/4**. The Paddle structured benchmark remains **9/12 (75%)** across three
synthetic claim variants, missing accident date in all three. Incorrect date
digits are not guessed. Reusing an already verified document cannot silently
change its audited field values.

The Scanner Chrome smoke checks that two OCR markers survive its two-page PDF
on desktop and Pixel 7 emulation, and that a synthetic Arabic claim scanned
into a one-page PDF retains its exact C/... reference. Both passes had zero
page errors. This is not real-device or real low-light/creased-claim evidence.
Purchase-invoice line items remain unsupported, and no representative customer
corpus was supplied. These remain Production quality gates.

## Development re-validation (2026-10-15, supersedes earlier synthetic metrics)

The guarded Paddle date reread accepts a complete eight-digit date only if
the day is unambiguous (>12), the calendar date is real and two nearby crop
widths agree. It never reconstructs missing digits. On the seven generated
synthetic cases, **structured** Arabic claim fields are now clean **4/4**,
low-light **3/4**, skewed **3/4**: **10/12** combined. The two remaining dates
are left to human review. The purchase-table image yields **2/2** names with
quantity, unit price and row total all arithmetic-checked. A damaged or
partial table yields **zero** suggested lines, never a partial invoice.
These figures are **not** representative-document accuracy. No sanitized real
claims or supplier invoices were provided; actual operational OCR precision,
recall and false-positive rates are unknown.

With `VITE_DOCUMENT_ENGINE_ENABLED=true` and
`VITE_DOCUMENT_WORKER_ENABLED=true` against Development, actual Chrome
exercised: private image upload → queued Paddle worker → stored OCR evidence →
browser parser → review RPC → actual claim form; a scanned gallery image →
one-page PDF → the same worker/review/form flow; and purchase-table image →
reviewed two rows → actual purchase form draft. No claim, purchase invoice,
stock movement or accounting entry was saved. The synthetic fixture tenant,
auth user, document records, Storage objects and temporary worker role were
removed; read-only counts returned to zero. A disabled worker now **fails
closed** for claim and purchase extraction instead of silently falling back
to the known 2/4 browser-local Arabic OCR baseline.

The scanner's separate Desktop Chrome and Pixel 7 **emulation** smoke passed
camera/gallery, corner drag, RTL, two-page PDF and 2/2 synthetic OCR markers.
The actual scanned-PDF-to-worker flow above also passed. Neither test used a
physical Android/iPhone device or a representative workshop scan. The
container image was not built (Docker/Podman unavailable and WSL not
installed), and the temporary test DB role is not a least-privilege
deployment identity. These are independent Production-planning blockers,
along with the legacy LocalStorage purchase-invoice persistence and absence
of representative-document accuracy evidence. Production is **Not Applied**.

## Proposed Production rollout (not executed)

1. Benchmark at least several sanitized representative documents per type,
   including Arabic numerals, poor scans and multi-page invoices; set an
   explicit acceptable field-level accuracy target.
2. Decide and deploy the Arabic OCR runtime and model-hosting strategy; test
   cold starts, privacy, memory and queue behavior. Add server-side file
   validation/inspection and an authenticated full-flow test.
3. Obtain a verified Production backup and reconcile its migration history.
   Audit each additive migration against the actual Production schema/RLS.
4. Apply migrations individually under a change window, verify private bucket
   and tenant policies, then release code with the flag **off**.
5. Enable for one Development/pilot tenant first, monitor errors, corrections,
   latency and duplicate blocks; keep AI fallback off unless explicitly chosen.
6. Roll back immediately by disabling the feature flag. Do **not** drop the
   tables or files during rollback; preserve audit/data pending review.

Sources: [Tesseract.js worker and local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md),
[PaddleOCR multilingual Arabic model](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html),
[Supabase Edge CPU limits](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits),
[Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
