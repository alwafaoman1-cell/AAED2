# On-demand document OCR

`vercel.json` describes the intended on-demand deployment: the existing Vite SPA is the `frontend` service, `services/document-ocr-dispatch` is a native Node/Hono dispatcher, and this directory is the private `ocr` container service. The legacy `Dockerfile` remains available for the existing daemon and rollback. The live daemon must stay running until the cutover gates below pass; changing these files does not prove or perform that cutover.

## Runtime and routing

- The HTTP image is built from `Dockerfile.http`. The container must listen on the effective platform port and use one server worker.
- Requests under `/api/internal/document-ocr/` reach the Node dispatcher before the frontend catch-all. Vercel preserves the original path. The OCR container has no public rewrite; only the dispatcher declares its generated `OCR_INTERNAL_URL` service binding. Bindings grant reachability, not application authentication, so the private hop retains Bearer authorization.
- `POST /api/internal/document-ocr/run` accepts only `{ "extraction_id": "<UUID>" }`, at most 512 UTF-8 bytes, with the server-only `TEMO_OCR_DISPATCH_SECRET` (at least 48 characters and distinct from `TEMO_DOCUMENT_DOWNLOAD_SECRET`). The Edge trigger verifies the caller and tenant before sending this job identifier. The dispatcher returns `202 { "accepted": true }` immediately after registering the private HTTP call with `@vercel/functions` `waitUntil`; acceptance does not mean a lease was acquired, OCR succeeded or a result was saved.
- The recovery schedule sends `GET /api/internal/document-ocr/sweep` every minute. The dispatcher and private OCR handler require `Authorization: Bearer <CRON_SECRET>` and reject missing or incorrect credentials before accessing the queue. Cron and dispatch secrets stay server-side; the download bridge secret is separate. The dispatcher forwards neither caller metadata nor request query parameters and does not follow redirects with credentials.
- The Edge trigger waits only for the dispatcher's quick acceptance, so it does not hold an OCR request open through an Edge wall-time limit. The Node dispatcher tracks the private call for at most 350 seconds within its 360-second function limit, independently of a closed browser or Edge request. Platform timeout can still cancel `waitUntil`: it is a lifecycle extension, not durable delivery. The persisted database queue, serialized claims, retries and every-minute sweep provide recovery after interrupted or failed wake-ups. Background diagnostics contain only action, failure category and HTTP status.
- A request carries only an authorized job/extraction identifier. Source documents remain in the existing private cloud storage; do not send raw documents through the trigger or expose worker/database credentials to the browser.
- Both dispatcher and OCR function configurations request `maxDuration: 360`, `maxConcurrency: 1`, and region `syd1`. Concurrency is per instance, so the database claim/lease guard must also prevent unsafe simultaneous OCR work across instances. Recovery must survive a closed browser, duplicate wake-ups, failures and expired leases.
- Fluid memory is intentionally absent from JSON. The existing project setting was verified as Standard (2 GB / 1 vCPU); preserve it and inspect the built function's actual memory, region, timeout and concurrency before cutover. The old daemon uses 2 GiB. Do not infer the new runtime's measured memory headroom from these labels alone.
- The Node dispatcher also receives the project's Standard memory allocation. Its tracked call keeps its invocation active while OCR runs, so the dispatcher adds allocated-memory billing alongside the OCR service; CPU billing follows actual activity. Earlier scenarios that modeled only one 2 GB OCR allocation are not an exact estimate of this implementation. Measure both services, cron/busy calls, cold starts and any container idle tail after staged cutover before claiming a saving. The source change has implemented no measured production saving.
- An every-minute sweep can repeatedly reach the container within its documented five-minute Production physical retention window, even when the queue is empty. Physical retention alone does not prove billable idle time or a scale-to-zero saving; measure the actual empty-queue behavior and billed quantities before Production cutover.

The dispatcher pins `hono` 4.13.23 and `@vercel/functions` 3.12.0 in its own `package-lock.json`; no frontend dependency is required. Run its real native-entrypoint test with `node --test services/document-ocr-dispatch/test.mjs` after installing that service's locked dependencies. The root Vitest transport tests use dependency injection and do not need those SDKs installed at the root.

At this change's validation, isolated Supabase Development resume was blocked by the two-active-free-project quota. Local transport, worker and SQL contract checks are not live cloud end-to-end evidence. Leave Production on the existing daemon until the staged gates below can be completed; do not alter another project to bypass that quota.

### Port verification

The HTTP Docker image declares `ENV PORT=8080` and `EXPOSE 8080`. Vercel's published container contract defaults to port 80 and documents a `PORT` environment variable override in project settings. Do not assume Docker metadata alone changes the platform's target port: verify that the effective deployment/project `PORT` is 8080, or prove equivalent behavior with the actual staged route. Never approve cutover from a successful image build alone.

## Cutover gates

1. Obtain a fresh verified backup with a PASS result and retain the current production deployment/image digest and configuration for rollback.
2. Apply and verify the coordinated queue, lease, tenant/RLS and engine-version changes. Preserve legacy `1.0.7-en-worker` compatibility while old jobs drain. A new engine/cache identity must not reuse old results as though they were produced by the new policy.
3. Build and deploy to an isolated staging environment. Container Runtime and Services are Beta. Verify actual availability, port routing, effective runtime resources and the frontend's real assets and deep links. This branch remains excluded from automatic Git deployments by `git.deploymentEnabled`; a push is not a production rollout.
4. Run real staged OCR through authenticated enqueue, tenant authorization, cloud file download, claim/lease, OCR, persistence and UI read-back. Test cross-tenant and invalid-auth rejection, duplicate dispatch, recovery after an expired lease or interrupted request, retry behavior, and cold starts at the preserved memory size. Test English-only accuracy, critical fields and original-page coordinates. `READY`, schema validation and HTTP health 200 do not establish this end-to-end result.
5. Stop new work from reaching the old consumer only after the staged flow passes. Drain active old leases and verify there are no in-flight old jobs before scaling down the old 2 GiB daemon. Coordinate cron activation, the new dispatcher and retry/sweep behavior so queued work cannot be stranded. Do not let a production deployment remove the daemon before these gates pass.
6. Verify the same complete flow after production cutover and watch queue age, failures, leases, runtime resource use and actual usage billing. Lower idle billing is a proposed outcome until measured; no production memory reduction or saving follows from the source change alone.

The reduced recognition-batch experiment was a small Development pilot and is not a rollout approval. Tesseract at 512 MiB failed a critical claim-number check and is not an approved replacement. Keep the accurate Paddle path and the supported memory headroom.

## Rollback

Prepare and test a 2 GiB compatibility daemon from the new worker code using the retained legacy `Dockerfile` before cutover. That fallback must accept `1.0.8-en-worker` as well as older supported versions, retain the existing queue/lease/RLS restrictions, and pass authenticated OCR and result read-back. A rollback can restore the old frontend/deployment settings while that tested compatible consumer preserves processing of new-version jobs.

The exact old `1.0.7` image does not consume `1.0.8-en-worker` jobs. It must not become the only consumer while any new-version work can remain or arrive: drain all queued, retryable and processing `1.0.8` jobs, not just active leases, and account for cached clients that can continue enqueueing the new version after a frontend rollback. Keep a tested compatible consumer for remaining or late new-version jobs; an empty queue at one instant is insufficient. Coordinate dispatch/cron changes and let leases finish or recover safely. Preserve requested engine identities, queued jobs and completed evidence; never relabel/delete jobs or restore the database for an application-runtime rollback.

## Official references

- [Container Runtime: port, Dockerfile entrypoint, scaling and limits](https://vercel.com/docs/functions/runtimes/container)
- [Services and configuration ownership](https://vercel.com/docs/services)
- [Service routing and preserved paths](https://vercel.com/docs/services/routing)
- [Private service bindings and authentication](https://vercel.com/docs/services/bindings)
- [Native Hono entrypoint](https://vercel.com/docs/frameworks/backend/hono)
- [waitUntil lifecycle and shared function timeout](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil)
- [Current configuration schema](https://openapi.vercel.sh/vercel.json)
- [Fluid memory and CPU configuration](https://vercel.com/docs/functions/configuring-functions/memory)
- [Function usage and billing](https://vercel.com/docs/functions/usage-and-pricing)
- [Cron Jobs and CRON_SECRET authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
