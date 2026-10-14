# VERIFY-V3: final recheck of web-next after the fix wave (14 Oct 2026)

Task T7c. Read-only against data: Edge via Playwright, the real compiled API on `sms_audit` (READ_ONLY), render-token identity at ranks 1, 2, 3 and 4, own ephemeral ports. `:4000` and `:5173` never contacted, no database write, no account, no Execute, Save, Retire, Record or Acknowledge clicked (the Changeover plan was checked, never executed). Build: web-next at `2ecb594` (scratch build, `SCR/final/next`); the old app was rebuilt from the same HEAD (`SCR/final/old`). Evidence: `SCR/final/recheck.json`, `SCR/final/v2a/shots`, `SCR/final/v2b/shots`, owner screenshots `SCR/final/for-owner/` (SCR is the session scratchpad directory).

## Verdict

**Ready for owner review. 0 open defects, 10 known limits.** Of the 32 defects (D1 to D32) and 30 M-checks of VERIFY-V2-VISUAL: **52 fixed, 10 known-limit (reason given), 0 open.** Figure parity with the old app: no mismatch. The data audit's M3, M7 and M9 are fixed here; M1 is relabelled (numbers unchanged) by the owner decision of 14 Oct.

Gate (HEAD `2ecb594`): `npm run typecheck` clean; `npx vitest run` twice, identical: 471 files passed / 1 skipped, 5,047 tests passed / 4 skipped, 0 failed, no unhandled errors; Playwright `playwright.next.config.ts` against the build: **81 of 81 passed, twice in a row** (7.2 min each).

## What changed in this task (commits `a468c91`, `b32d9cf`, `2ecb594`)

- Line chart end label: width measured with a canvas in the page font, cap 60 % of the chart, the `.ck-direct` letter-spacing stopgap removed (css-003 and css-050 pass at 320 to 1366@1.3).
- Playwright: `settle()` now waits for the report document (`.rp-doc`) on a report route. The earlier transient "no document" failures were the legacy report renderer arriving after the network went idle on a busy host; with the wait, two full runs are clean. `expected-failures.json` carries no expected failures.
- Audit M3: Rejects named "the 5 Aug 2026 database rebuild" on PD1 and PR because 7,470 simulator readings counted as a second generation. `rejectSpc.ts` now says a generation boundary only when a real (non-simulator) generation is present or was dropped; measured: no sentence on PD1, PR or PL.
- Audit M7: the Weight tab draws no tolerance band when stations ran their own materials (judged per product); the KPI reads "Own product limits · N cones judged" and a plain sentence states per-product limits apply. A band is drawn only when readings carry no material (one line-wide product).
- Audit M9: "1 cone failed the weight check (scale)" (count lines, sheet counts, filtered and outside-limit lines).
- Audit M1 (owner decision 14 Oct, `GLOSSARY.md` 1.8): the combined figure (6,089 for 5 Aug to 7 Sep) keeps its numbers and is labelled **"Failed inspection or weight check"** on the Today KPI tile and station tiles, the Wall, Quality > Stations (column, caption, station sheet) and the Register tab ("Inspection or weight-check fails", count line "failed inspection or the weight check"). The Rejects tab's inspection-only 6,048 keeps "Failed inspection". Pinned by `web-next/src/auditFixes.test.ts` and the Today and Stations tests. **Not changed, pre-existing (audit M2):** the old app's wording, IFL-reserved report titles and CSV headers (for example `rejected_at_inspection`), and the Reports daily and management-summary on-screen rows ("Rejected at inspection 451 cones"), which come from the old report renderers.

## Defects D1 to D32

| Id | Result | Evidence |
|---|---|---|
| D1 Changeover fields spill | fixed | overflow 0 in 858 loads; css-025 |
| D2 Limits textarea | fixed | overflow 0 at 320, 375, 500, 621, 768, 1366 |
| D3 Board cards touch | fixed | css-047 rows <= 50 px; screenshots 15, 16, 32 (visual, no gap spec) |
| D4 Top bar 768 | fixed | overflow 0 on 129 loads at 768 |
| D5 Login inputs | fixed | overflow 0 at 375, login spec passes |
| D6 Reports preview clips | fixed | overflow 0 at every width; screenshots 21 to 24 |
| D7 Today KPI unit | fixed | overflow 0; css-048 |
| D8 Axis titles | fixed | css-003, 050, 070, 077; x-tick collisions 0 |
| D9 Wall phone | fixed | large-screen message below 1024 px; overflow 0 at 375 and 375@1.3; chips at 1366 |
| D10 Reports/Setup look old | known-limit | restyled by scoped CSS over old markup, tokens only; not row for row the DataTable (screenshots 22, 27) |
| D11 IFL tables 768 | fixed (dates) / known-limit (scroll) | date splits 0; fade cue; 11 of 14 types still scroll sideways at 768, with the cue |
| D12 Skeleton height | known-limit | first row delta 0 to 3 px at 1366, 375, 1366@1.3 (was 34 to 80 px). Whole page still moves on load: Today +773, Weight +530, Rejects -286 px at 1366 (was about +1,400) because tables and charts have variable length; the Weight skeleton is fitted to the test data and the per-product KPI note was shortened to stay inside it |
| D13 KPI uneven | fixed | tops 362 x5, 519.9 x5 at 1.3 |
| D14 Station tiles | fixed | screenshot 01 |
| D15 Mixed dates | fixed | dates guard, date-format spec; IFL reports keep DD-MM-YYYY (reserved) |
| D16 Headings | fixed | one PageHead on the Quality tabs |
| D17 Pattern caption | fixed | css-004; the two flagged nodes are the screen-reader-only "Open" label |
| D18 Diagnostics 8,600 px | fixed | 2,926 px at 1366; css-067, 007, 017 |
| D19 Review raw text | fixed | screenshot 18 |
| D20 Register print | fixed | css-031 Page N of M |
| D21 Checkbox | fixed | 0.5 px at 320 to 1366 |
| D22 Wall 1.3 | fixed | wall spec |
| D23, 23b Catalogue, Outcome | fixed | css-047, css-078; Outcome 301 px at 768 |
| D24 Escape focus | fixed | focus returns to the station row |
| D25 Station rows 75 px | fixed | 53 px (1366), 69 px (1920@1.3) |
| D26 Weight headline | fixed | screenshot 08 |
| D27 Quiet tile edge | fixed | dashed |
| D28 16 px links | known-limit | owner decision A on CSS-061 |
| D29 Today hero | known-limit | S4, no spec |
| D30 Rejects KPI heights | fixed | 214 x3 |
| D31 Reports landing space | known-limit | S4, not measured |
| D32 Duplicate captions | known-limit | S4, not re-measured |

## M-checks

M-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13, 14, 16, 17, 18, 19, 20, 21, 22, 24, 25, 27, 28, 29, 30 pass with the numbers in `recheck.json` (M-04 0 overprint; M-08 0.5 px; M-18 specs green; M-19 Page N of M; M-20 equal tops; M-22 max row 69 px at 1920@1.3; M-30 Outcome 301 px at 768). Known limits: **M-12** (11 of 14 IFL tables still scroll at 768, cue present, dates whole), **M-15** (first row stable, whole page moves), **M-23** (the Rejects trend still does not zoom on click, unchanged), **M-26** (16 px links, owner A).

Matrix: 858 loads (320, 375, 768, 1100, 1366, 1920 at rank 3; 1366 at ranks 1 and 4; text size 1.3 on Today and Wall): **0 page overflow, 0 console errors, 0 failed requests.** Old app at `/`: 9 screens at rank 4, 0 console errors, 0 failed requests.

## Data parity (old app against web-next, same API)

- Register: 954 rows compared by record id, weight and product, 0 mismatches; stock ledger PD1, PL, PR identical.
- 18 report types at PD1, PL and PR (54 pairs): 54,178 numeric tokens in the old text, 12 not found in the new, all chart axis tick labels (cone-weight PL 8, sack PR 4). Times compared after converting the old 12-hour clock to the new 24-hour one.
- Diagnostics: every batch row count present in Technical detail (142,511, 132,552, 266,186, 5,518, 513, 12,134). Setup: every old value present except the product-limit version timeline (13 rows), which moved to Products > Limits & History and shows per selected product; the first product (1,950 ± 40 g, 6 May 2026 15:23) matches. Not compared product by product.
- Today failed-weight-check figures, Rejects 6,048 and the combined 6,089 are unchanged; only the combined label changed.
- Gaps found by V2b now closed: P1 board shows blend, count and tube; P2 TV wall entry (menu and Today, from 1024 px); P3 `?s=report` writes `rt=daily`; P4 Setup below rank 4 says "This is only available to an administrator"; P5 batch table back; P7 "East Conveyor" consistent. P6 (Manrope woff2) stays open and is the owner's file; the page falls back to the self-hosted Instrument Sans, 0 external requests.
- All 26 legacy redirects land. Cross-screen links land (reason sheet, cone and sack sheets, station sheet, Diagnostics findings). Exports: rank 3 shows 55 links, the 37 CSV and Excel ones return 200 (GET), the 18 PDF ones were not fetched (the server PDF route cannot launch Edge on this host); rank 2 and rank 1 show none. Write controls: rank 1 shows none; Name it, Record a movement, Retire, Reactivate, limit Edit and the default-product change appear from rank 2; Setup only at rank 4.

## Known limits and notes

- The D12 whole-page skeleton difference; the 11 of 14 IFL tables that scroll at 768; Reports and Setup restyled over old markup; S4 items D29, D31, D32; owner decisions CSS-061 (D28, M-26).
- Pre-existing and owner-reserved (audit M2): the old app's "rejected" wording, IFL report titles and CSV headers, and the on-screen Reports rows that come from old renderers.
- The m4 probe's checkbox reading (-11 px) and the m12 header reading (2 nodes) are probe artefacts, resolved with the spec's own method and by noting the screen-reader-only label.

## NOT tested

Real users; the plant or IFL's server; live data after 7 Sep (the snapshot ends there; July to August month never sent); a real printer (browser PDFs only); the server's PDF route; signed-in viewer, engineer or manager sessions (render token only); writes against a real database (none attempted); touch input; Urdu text; a physical TV at viewing distance; Windows high-contrast themes beyond Edge forced colours; the owner's API on `:4000` (still old code until restarted after `npm run build`).
