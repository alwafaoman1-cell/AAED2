# Mobile header and PDF download hotfix — 2026-11-08

Status: **Deployed and live-verified**, 2026-11-08 08:58 UTC / 12:58 Muscat.

## Release identity and boundaries

- Live: https://aaed-2.vercel.app
- Deployment: `dpl_FFWSJspYbk5a2NFAcHp88rZtms6M`
- Staged Production URL: https://aaed-2-h8r6ry17w-alwafaoman1-cells-projects.vercel.app
- Development QA: https://temo-work-order-preview-fwa5fc5e7-alwafaoman1-cells-projects.vercel.app
- Source digest: `373c1e8c13b9b1b84527c9d0f2cec7e5c46407ed9f2140eeb397ae14f6d5d621`
- Base commit remains `bcc4b64469651614bef484df76c0a74845ac64b9`. No new commit or Git push.
- Frozen source was built from the previous verified live release, not from the dirty worktree. Exactly 13 source/test files differ, with no removed baseline files.
- No migrations, financial changes, historical repair, data deletion, account-role changes or Storage changes. Older unrelated local changes were excluded.
- Worker remains ready (1 replica), with its prior pinned image digest `82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`. Worker/configuration files are byte-identical to the previous release.
- Fresh completed physical backup metadata was verified: backup `2202376988`, created 2026-11-08 06:50:38 UTC. No restore was performed or needed for this frontend-only change.
- Rollback deployment retained: `dpl_GCHCwSD7S7cb5twyJCdf8W1qmkQi`.

## Root causes and fixes

1. The fixed mobile menu used an absolute `top-2` while the toolbar used the device safe area. The menu could sit underneath the iPhone status bar. Toolbar/menu/drawer now share the same safe-area variables, with normal content spacing and dynamic viewport height. A tablet padding override that let the menu overlap history buttons was also corrected.
2. PDF generation awaited an animation callback in an off-screen iframe. WebKit can suspend that callback indefinitely. Pagination now yields through the parent event loop, without relying on hidden-frame animation callbacks.
3. Actual WebKit testing exposed another stall: html2canvas creates its clone frame inside the source document, where the required scriptless sandbox/CSP prevents reliable clone loading. Rendering now uses an inert, style-isolated Shadow DOM capture of the already-sanitized document, preserving computed styles and loaded fonts. The source/preview retains its existing scriptless sandbox and CSP; scripts were not enabled to make rendering work.
4. Generated PDF links could be revoked after 1.5 seconds, before a mobile viewer completed its handoff. The shared download helper now retains the link for 60 seconds and cleans up after errors. A failed handoff reports an error and does not trigger successful archiving.

## Selective deployed files

- `src/components/AppLayout.tsx`
- `src/components/AppSidebar.tsx`
- `src/components/PdfPreviewDialog.tsx`
- `src/index.css`
- `src/lib/htmlToPdf.ts`
- `src/lib/pdfCaptureSurface.ts` (new)
- `src/lib/pdfFileDownload.ts` (new)
- `src/i18n/locales/ar.json` (`pdfDownload` key only)
- `src/i18n/locales/en.json` (`pdfDownload` key only)
- `src/test/mobile-safe-area.test.ts` (new)
- `src/test/pdf-file-download.test.ts` (new)
- `src/test/pdf-offscreen-frame.test.ts` (new)
- `src/test/pdf-preview-explicit-archive.test.tsx`

This report is a local handoff artifact, not an additional deployed code change.

## Verification

- Final Development and staged Production: full typecheck, lint and production build passed.
- Full suite on each final frozen source: **1,747 passed, 0 failed, 6 pre-existing skipped**, 1,753 total tests / 610 reported suites. No new skips were introduced.
- Local focused regression/security checks: **40 passed**, covering script/active-attribute sanitization, untrusted HTML sinks, paused iframe animation callbacks, capture isolation/cleanup, download lifetime/failure, explicit archiving and safe-area layout.
- Actual headless WebKit browser checks ran against Development, staged Production and the promoted live domain. Four layout cases covered Arabic/RTL and English/LTR at phone (390px), tablet (834px) and desktop (1366px) widths. Simulated 47px/24px safe insets stayed clear, with zero menu/navigation intersections or horizontal overflow.
- Native browser PDF download events completed three times from an existing Production entry on the live domain, in **3.080s / 2.618s / 3.789s**, producing valid PDF files of approximately 679–686KB. Buttons returned to their enabled state.
- Each run deliberately suspended the off-screen source iframe's animation callback. All three downloads still completed, with the original `allow-same-origin allow-modals` scriptless sandbox retained.
- Live browser: **0 business writes, 0 failed requests, 0 HTTP errors, 0 console/page errors**. Normal-RLS reads of the existing entry matched exactly before/after; the temporary test session was revoked. Production PDFs were not retained as Development samples.
- Development PDFs were parsed/rendered and visually inspected: single-page A4 entry files at all three viewport widths, plus a synthetic three-page Arabic/English table/signature document. No blank pages; signatures and Arabic text rendered. An injected script/active attribute did not execute, and capture surfaces were removed after rendering.
- Live alias and source digest were rechecked after promotion. The Worker remained ready on its unchanged pinned image.

## Evidence (ignored local diagnostics)

- `.vercel/mobile-pdf-qa-build-proof.json`
- `.vercel/mobile-pdf-production-build-proof.json`
- `.vercel/mobile-pdf-browser-development.json`
- `.vercel/mobile-pdf-browser-staged.json`
- `.vercel/mobile-pdf-browser-live.json`
- `.vercel/mobile-pdf-browser-templates.json`
- `.vercel/mobile-pdf-file-inspection.json`
- `.vercel/mobile-pdf-release-integrity.json`
- `.vercel/mobile-pdf-promotion-proof.json`
- `.vercel/mobile-pdf-final-proof.json`

## Limits

Browser engine was **WebKit 26.5 on Windows**, with mobile/touch emulation and simulated safe-area insets, not a physical iPhone/iPad. No physical printer was exercised. These results verify this scoped hotfix, not every feature or third-party integration in the ERP. Existing PWA windows may need reopening to receive the new assets; clearing operational storage is neither required nor recommended.
