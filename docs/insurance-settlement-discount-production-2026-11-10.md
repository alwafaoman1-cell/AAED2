# Settlement discount report — Production release

Status: **published and verified**.

- Live report: https://aaed-2.vercel.app/insurance/settlement-discounts
- Navigation: Insurance / Claims Accounting → Settlement discounts.
- Deployment: `dpl_6vdiasVPg7NRoyhcLckcNWxjFoKF`.
- Source SHA256: `7a962d09fe32e3bb8dbdf1d24d367af83d6ea89339baa6a851e83fe74afd4933`.
- Previous live deployment: `dpl_AtH5p5DM5c56rfKeUr5TmFgGj8bd`.
- Source base / unchanged Git HEAD: `bcc4b64469651614bef484df76c0a74845ac64b9`.
- No new commit or push; no branch, main or remote repository change. The approved selective source snapshot was deployed directly and staged before promotion.

## Selective source and safety

The exact then-live source manifest was revalidated against Vercel's current alias and every frozen file hash. Only these **12 files** differ from that live source:

1. `src/App.tsx` — lazy import and protected report route only.
2. `src/components/insurance/InsuranceLayout.tsx` — recognize the report as a list/report route.
3. `src/pages/insurance/InsuranceAccounting.tsx` — report link and its role/i18n bindings.
4. `src/pages/insurance/InsuranceSettlementReport.tsx`.
5. `src/lib/insuranceSettlementReport.ts`.
6. `src/lib/insuranceSettlementService.ts`.
7. `src/lib/insuranceSettlementExport.ts`.
8. `src/lib/i18n/insuranceSettlements.ts`.
9. `src/test/insurance-settlement-report.test.ts`.
10. `src/test/insurance-settlement-service.test.ts`.
11. `src/test/insurance-settlement-export.test.ts`.
12. `src/test/insurance-settlement-page.test.tsx`.

All other source/configuration/dependency files remain byte-identical to the frozen previous live snapshot. The three integration files match their approved local content after CRLF/LF normalization; no unrelated App changes were incorporated. Older dirty-worktree edits, output, private verification files, backup data and environment files were excluded.

Production schema columns were read-only verified. **No migration or database mutation was needed or executed**. No broad `db push`, posting, invoice edit, numbering change, reclassification, backfill, historical repair, Storage upload/copy/delete or synthetic Production record was performed.

Existing completed physical backup `2216914850`, `2026-11-09T21:57:02.400Z`, was 16.31 hours old at the release checkpoint. No restore was performed or claimed. An additional DPAPI-encrypted, decryption-verified read-only checkpoint retained financial/operational table hashes, sequences, migration ledger/security metadata and the independent report oracle, not a new full database backup. Plaintext checkpoint digest: `c8f4cd9b131249d63ec9161d4f15edef4fe22b6cfe6a6f1fe217201bba36d18c`.

The final post-live read-only comparison found **40 business tables unchanged**, with unchanged sequences, migration ledger and source-table RLS/ACL metadata. Browser business-write attempts were zero; no writes were allowed to pass the test harness. Test authentication used an existing active admin as an ordinary authenticated client; temporary test sessions were revoked. No user was created or permission changed.

## Issues caught before promotion

- A local React Router v6-only `MemoryRouter future` test option did not compile against the pinned Production v7 dependency. Removed that test-only compatibility flag, without deleting an assertion or changing application routing behavior. Re-ran the 33 focused report tests and the remote full suite.
- Real long insurer names and settlement reasons exposed a preview/download page-count difference. Fixed the report's PDF preparation, not the global invoice/PDF code: measure rows while attached to an isolated scriptless document, at the actual configured page width/margins; repeat complete report/table headers; preserve every invoice row and a single totals row; calculate final page counters; serialize the same prepared HTML for preview and download. Use an available system font in this report to avoid asynchronous external-font reflow. Existing unrelated templates/renderers remain unchanged.
- A regression test asserts measurement only occurs while rows are attached, preserves all rows/totals, and verifies the prepared-document flag/counters. Development browser testing used 40 **synthetic intercepted** long-name/reason records and actual PDF downloads in both languages; six measured pages matched six downloaded pages. No fixture rows were inserted into either database.
- Initial staged/browser attempts were retained privately. The first release candidate failed compilation; the next was not promoted after the real-PDF mismatch. The original primary deployment remained live until the fully verified final candidate was promoted. A premature pagination assertion and language-specific download-button selector in the test harness were corrected without raising an application timeout or weakening count/data/security assertions.

## Final verification

- Production-only environment guard: PASS.
- Full project typecheck: PASS.
- Full lint: PASS.
- Production build: PASS.
- Full remote regression: **1,830 total; 1,824 passed; 0 failed; 6 existing skips; 631 suites**. All 33 new report tests are included.
- Staged Production URL and then primary live URL: PASS, **Arabic/RTL and English/LTR**, real authenticated Production data, no intercepted business responses or synthetic live rows.
- An independent read-only SQL oracle matched **40 actual invoices**, every exported invoice number, invoice count, stored collected amount, registered/verified settlement discounts and current remaining totals.
- Screen pagination: 25 visible rows; exporting from page 2 still exported all 40 matching invoices, with numeric OMR values and correct three-decimal totals. Company/date/review/search/reset filters, selected export columns and navigation back through Claims Accounting passed.
- Actual PDF downloads: preview and downloaded files both had **4 A4 landscape pages**, 40 invoice rows plus one totals row, measured at 794 px per page with no overflow/sliver page. Arabic and English files were 2,259,356 and 2,558,990 bytes respectively on both staged/live runs. PDFs were rendered and visually inspected; no physical printer job was submitted.
- Desktop/tablet/mobile widths 1366/834/390: no root horizontal overflow or blank page. These are browser viewport checks, not physical-device certification.
- Browser HTTP errors **0**, console errors **0**, page errors **0**, blocked application reads **0**, business write attempts **0**.
- Ordinary authenticated wrong-tenant read denied; anonymous could not read invoices from the actual populated tenant. No new RLS policy or public endpoint was introduced.
- Final primary alias, READY status, source digest and unchanged OCR Worker image verified; Worker ready replica count remained 1. No Worker configuration or image change was part of the release.

Private evidence remains under ignored `.vercel/settlement-production-*`, including source manifest, staged build/remote test proof, independent SQL checkpoint/comparison, staged/live browser checks, promotion receipt, PDFs/screenshots and final completion proof. These are not published as public artifacts.

This verifies the scoped report release, not every unrelated ERP function, old security warning, physical printer or real-device workflow. It does not repair historical financial discrepancies; any report reconciliation issue remains visible rather than automatically modified.
