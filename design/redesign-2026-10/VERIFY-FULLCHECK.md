# Full presence check of the redesigned app (sms/web-next served at /next)

Worker A, 14 Oct 2026. Read-only. Repo HEAD when the check ran: `7bdecae` (sms/ tree clean). Evidence files live in the session scratchpad (not in the repo): `fullcheck/trace-verdicts.json` and `.md` (one line of evidence per TRACE row), the probe scripts and the raw page texts.

## Verdict

**All 500 TRACE rows have a verdict: 488 present/working, 2 known-limit, 9 decision, 1 MISSING.** The single MISSING row is a wording gap (B7-8), not a missing feature; every other built row passed. No console error, no failed request, no page overflow, no non-GET request in any load.

| PASS criterion | Result |
|---|---|
| All 500 rows have a verdict | yes (500 of 500) |
| Every built row PASS except the V3 known limits and the 9 decision rows | 488 built rows pass; 1 built row (B7-8) does not; 9 decision rows listed below; the 2 TRACE "gap" rows (A2-082, A7-17) are reported as known-limit |
| Playwright 81/81 twice | run 1: 81 passed, 0 failed, 0 flaky, 0 skipped (7.3 min); run 2: 81 passed, 0 failed, 0 flaky, 0 skipped (7.4 min) - no retry was needed |
| 0 console errors / failed requests per page | 123 walk loads + 6 Wall loads + 16 hop clicks + the 36-load overflow sweep and shell probes: 0 console errors, 0 failed or 4xx/5xx requests (the deliberate fault-injection aborts on one extra page excluded; redirect loads were checked for landing address only) |
| 26/26 legacy redirects | 26/26 land on the right route with every other key kept (+1 extra case, unknown s). My first L05 input (jc=12) was not a valid reason code and the screen correctly dropped it; with a valid code (jc=2-1) it lands. |
| Write-control matrix equals TRACE A4 | yes - see matrix below |
| 37/37 exports 200 with the right content type | 37/37 (19 CSV text/csv with BOM, 18 XLSX zip packages); links per rank 1/2/3/4 = 0/0/55/55; the 18 PDF links were not fetched |
| 0 unexplained old/new mismatches | Register 954 rows by record id: 0 mismatches; stock ledger identical at 3 periods; 18 report types x 3 periods: 54,178 numeric tokens in the old text, 12 not found in the new (all chart axis tick labels: cone-weight PL 8, sack PR 4) |
| Hashes identical | :4000 /next/ and / index.html and all 52 files under both dist/assets and dist/fonts are byte-identical to the repo builds (SHA-256); PID 30892 never touched |

## Counts

| section | present/working | known-limit | decision | MISSING | rows |
|---|---|---|---|---|---|
| A1 | 97 | 0 | 0 | 0 | 97 |
| A2 | 82 | 1 | 1 | 0 | 84 |
| A3 | 79 | 0 | 1 | 0 | 80 |
| A4 | 32 | 0 | 0 | 0 | 32 |
| A5 | 30 | 0 | 1 | 0 | 31 |
| A6 | 60 | 0 | 0 | 0 | 60 |
| A7 | 18 | 1 | 0 | 0 | 19 |
| B1 | 12 | 0 | 0 | 0 | 12 |
| B2 | 10 | 0 | 0 | 0 | 10 |
| B3 | 16 | 0 | 0 | 0 | 16 |
| B4 | 7 | 0 | 2 | 0 | 9 |
| B5 | 25 | 0 | 0 | 0 | 25 |
| B6 | 16 | 0 | 1 | 0 | 17 |
| B7 | 4 | 0 | 3 | 1 | 8 |
| total | 488 | 2 | 9 | 1 | 500 |

## Rows that are not plain "present/working"

- **A2-082** known-limit: the compiled API serves the SPA catch-all, /next/ and / (hashes of index.html and all 52 asset files on :4000 equal the repo build); unknown /api/* answers 404 JSON
- **A2-084** decision: TRACE row: further API additions need an owner list before building (decision-needed). The only addition found in the compiled API beyond the 81 documented routes is /api/station-status (A2-083); no migration was added by this redesign.
- **A3-021** decision: TRACE row: GLOSSARY rewrites 138 rows, 32 RESERVED rows stay verbatim; keep one central table (decision-needed). The central copy table exists (web-next/src/copy.ts, copy.test.ts passes) and all strings are drawn from it; the owner decision on which RESERVED wording to keep is still open.
- **A5-24** decision: TRACE row: "Assumed until IFL confirms" block and "Figure definitions are awaiting IFL's approval." - owner picks keep vs "Working assumptions" (decision-needed). The old wording is live and appears on the shift-production report: Assumed until IFL confirms
- **A7-17** known-limit: Manrope woff2 is not supplied: body font-family is "Manrope, Instrument Sans, system-ui"; the browser loads the self-hosted InstrumentSans-Variable.woff2 (6 requests, all 200 from /next/fonts/); 0 external requests across all walks. (TRACE row "gap"; the owner supplies the file.)
- **B4-07** decision: TRACE row: CSS follow-up outcomes (CSS-015 quiet tile grey, CSS-019 "scroll for more machines", CSS-036 header colour, CSS-053 Zoomed in - Back, CSS-073 fade) - decision-needed (confirm each under Style C). Observed: Zoomed in - Back present and restoring (A3-006); scroll cue "scroll for more" present on tables; the rest are own
- **B4-08** decision: TRACE row: owner "no change" decisions (CSS-020 resize handle 10 px, CSS-030 printed blocks whole, CSS-037 860 px, CSS-061 21-22.5 px controls) - decision-needed (confirm under Style C). Observed: the Today links are 18 px high (CSS-061 / D28 / M-26 unchanged).
- **B6-07** decision: TRACE row (rank.matrix.test.tsx, rewrite for the 5 areas): decision-needed. Observed here: web-next/src/rank.matrix.test.tsx exists and passes (59 files / 798 tests); the live rank 1-4 control matrix (A4) matches the TRACE.
- **B7-2** decision: TRACE row: weight basis DP-1 / Q4-5 wording - old text stays live until the owner picks (decision-needed). Observed live: Average recorded weight is 1,952 g; the product target is 1,960 g (weight basis not yet co
- **B7-3** decision: TRACE row: "Assumed until IFL confirms" / "Figure definitions are awaiting IFL's approval." - old text stays live until the owner picks (decision-needed). Observed live: Assumed until IFL confirms
- **B7-4** decision: TRACE row: sack-stock words (Stock ledger, line stock not per machine, Opening/Receipts/Issues/...) - old text stays live until the owner picks (decision-needed). Observed live: Stock ledger line stock, not per machine
- **B7-8** MISSING: FAILED: Quality: the string "data batch" still appears on 4 of 34 Quality pages: Weight at all three periods (3 times each, the generation sentences "...belong to a different data batch (IFL rebuilt its tables)") and the Reason sheet (200 record rows labelled "IFL data batch 3"); GLOSSARY row 115 asks for "from before the 5 Aug 

### MISSING

- **B7-8** (banned nouns must not reappear, GLOSSARY 1.7 / row 115): "data batch" is still printed on Quality > Weight (3 times per page at all three periods: "...belong to a different data batch (IFL rebuilt its tables)...") and on the Reason sheet (200 rows labelled "IFL data batch 3"). The old wording is reused from `web/src/lib/words.ts`. Reports (old renderers) also still print "Rejected by the scale" (18), "Winder", "Lifter", "Machine", "data batch" (known: V3 D10 / audit M2, owner-reserved). Today, Products and Diagnostics/Account are clean.

## Observations that are not TRACE rows (nothing blocks; worth a look)

1. **Polling.** On a fixed historical period the new app requests `/api/live` 9 times in 31 s (offsets 0, 5, 5, 5, 10, 20, 20, 20, 20 s) against 3 times (10 s apart) in the old app on the same data. No data endpoint re-polls on a fixed period (correct), so it is the clock call only, roughly three pollers where there was one. The live period also polls data at 15 s multiples (production x4, others x2 per 32 s).
2. **Catalogue create form (A1-032 getProductOptions, A1-033 createProduct).** Not rebuilt: Catalogue "New product" opens the Changeover plan, which offers existing-or-new blend, count, tube, product name, limits and a reason and runs CreateMaterial server-side. The capability is reachable; the direct form and its two api.ts wrappers are unused by the new UI. Marked present/working with a note.
3. **Weight "See them" hop (A3-036, A6-H06).** Appears only when passedButOutside is above 0; it is 0 in every sms_audit period (checked 8 days across both generations), so it cannot be clicked on this data. Verified instead by the live Today link "Outside product limits" (lands on Register rf=outsideLimits) and by WeightScreen.test (12 outside, click). Not exercised live on the Weight screen.
4. **Phone More sheet** holds Register, Diagnostics, (Setup), Account, Sign out; Text size is in the phone's Account menu button, Wall is large-screen only (a 375 px visit says "The TV wall is designed for a large screen"). Matches V3.
5. **Station label** reads "Station 5 · East Conveyor" on Today/Stations and "East Conveyor" in the Weight/Rejects pickers (DP-4 is still an open owner choice).
6. **Fonts.** Body font-family is "Manrope, Instrument Sans, system-ui"; only the self-hosted Instrument Sans loads (6 requests, all 200, from /next/fonts/). 0 external requests anywhere.
7. **Register pager** is cumulative "Load more" (rp=2 -> 200 rows, rp=3 -> 300); consistent with "rp replaces, not pushes".

## What was run

Harness: four ephemeral servers (ranks 1-4, real compiled `api/dist` in-process behind ro-guard, `sms_audit` READ_ONLY, `LIVE_ALLOW_SIMULATOR` false) serving `sms/web-next/dist` at /next and `sms/web/dist` at /. Edge via Playwright. GET only: every non-GET request was aborted in the page and none fired. Below-rank writes were tested only by sending an empty-body POST/PUT/PATCH to a route whose role middleware answers 403 before any handler (22 routes). No write control was clicked, no export was fetched on :4000, no account was created, the simulator and sync-worker were not touched, no build or typecheck was run, PID 30892 was not touched.

| Step | What | Result |
|---|---|---|
| T1-A.2 hashes | SHA-256 of :4000 /next/ and / and every file under dist/assets and dist/fonts of both builds vs the repo | 52 of 52 files and both index.html identical |
| T1-A.3 Playwright | `playwright.next.config.ts`, SMS_NEXT_URL = harness rank-3 URL, twice | 81/81 and 81/81 |
| vitest (extra) | web-next/src and web/src | web-next 59 files / 798 tests passed; web 147 files / 1,182 tests passed |
| T1-A.5 pages | every screen, tab and the 7 sheet kinds at 3 periods (1 Sep, 5 Aug-7 Sep, 1 Sep evening - 2 Sep morning), 18 report types x 3 periods, Register listings x5, Products tabs x5, Setup/Account/Diagnostics at rank 4, Wall | 112 + 11 loads, 0 errors |
| redirects | 26 legacy URLs, cold load, final address compared with the IA-MAP table | 26/26 |
| cross-screen links | 15 hops (H14 split in two) by real clicks | 16/16 landed; H06 via Today link (see observation 3) |
| exports | links counted at ranks 1-4 on all 18 report types and the Register; 37 CSV/XLSX GET at rank 3 | 0/0/55/55; 37/37 200 |
| Wall | 1920x1080, text size 1 and 1.3, live clock + 2 periods | no scroll, nothing outside the viewport, state sentence 59.8 px -> 74.8 px, 0 errors |
| old UI | 9 screens at rank 4 + 69 text captures at rank 3 | 0 errors, 0 failed requests |
| T1-B (:4000, curl only) | /api/health 200 JSON "degraded", /api/live 401, /api/auth/me {"user":null}, data and export routes 401, /next/?s=line and ?s=report return the same SPA shell as /next/ (hash equal); the same shell on the harness shows only the Login card (username, password, Sign in) and requests only /api/auth/me | as expected |

## Hashes

```
health: 200 {"status":"degraded","service":{"version":"0.2.0","uptimeSeconds":579,"startedAtUtc":"2026-10-14T09:11:52.711Z","pid":30892},"database":{"ok":true,"latencyMs":2,"sizeMb":null,"capMb":10240,"pctOfCap":
live: 401
index /next/ served=7bc47b0b712fdd9c9a2674154c4c87528c26350609f2208e566e84b67986f738 file=7bc47b0b712fdd9c9a2674154c4c87528c26350609f2208e566e84b67986f738 MATCH
index / served=ae44a406ac8ca4afe392384f419686632942b57677b6d657c9aba76144efeb2e file=ae44a406ac8ca4afe392384f419686632942b57677b6d657c9aba76144efeb2e MATCH
all dist files checked 52 diff 0
```

## Write-control matrix (ranks 1-4, never submitted)

Expected minimum rank is TRACE A4. "present (disabled)" means the control is drawn but disabled (PDAS writes are switched off on this server; plan steps wait for input).

| TRACE | control | min rank | rank 1 | rank 2 | rank 3 | rank 4 |
|---|---|---|---|---|---|---|
| A4-04 | Board: Change the default | 2 | absent | present | present | present |
| A4-05 | Changeover: Check the plan | 1 | present (disabled) | present (disabled) | present (disabled) | present (disabled) |
| A4-06 | Changeover: 3 Execute (step) | 1 | present (disabled) | present (disabled) | present (disabled) | present (disabled) |
| A4-07 | Catalogue: New product (opens Changeover) | 1 | present | present | present | present |
| A4-08 | Catalogue: Retire / Reactivate | 2 | absent | present (disabled) | present (disabled) | present (disabled) |
| A4-09/11 | Limits & History: Review change | 2 | absent | present (disabled) | present (disabled) | present (disabled) |
| A4-12 | Station sheet: Log an adjustment | 2 | absent | present | present | present |
| A4-13 | Rejects: Name it | 2 | absent | present | present | present |
| A4-13 | Reason sheet: Name it | 2 | absent | present | present | present |
| A4-14 | Register stock: Record a movement | 2 | absent | present | present | present |
| A4-14 | Stock sheet: Record a movement | 2 | absent | present | present | present |
| A4-15 | Diagnostics: Acknowledge | 2 | absent | present | present | present |
| A4-17 | Register: Export CSV | 3 | absent | absent | present | present |
| A4-16 | Reports: PDF / Excel / CSV | 3 | absent | absent | present | present |
| A4-18 | Setup: New account | 4 | absent | absent | absent | present |
| A4-19/20 | Setup: role select / Reset | 4 | absent | absent | absent | present |
| A4-21 | Setup: Line Save | 4 | absent | absent | absent | present |
| A4-22/23 | Setup: Add a machine / Edit | 4 | absent | absent | absent | present |
| A4-24/25 | Setup: Add a station / Rename | 4 | absent | absent | absent | present |
| A4-26/27 | Setup: source toggles | 4 | absent | absent | absent | present |
| A4-28..30 | Setup: rules selects/inputs | 4 | absent | absent | absent | present |
| A4-03 | Account: Save new password (page, all ranks) | 1 | present (disabled) | present (disabled) | present (disabled) | present (disabled) |

Setup: the tab and every Setup control exist only at rank 4; at rank 3 the page says "This is only available to an administrator." Sign out is in the account menu at all ranks. Below-rank writes answer 403: 24 routes probed, all 403.

## Exports

Links per rank (18 types x PDF/Excel/CSV + Register CSV): rank 1 = 0, rank 2 = 0, rank 3 = 55, rank 4 = 55. GET at rank 3: 19 CSV (text/csv; charset=utf-8, 19 with BOM) and 18 XLSX (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, 18 zip packages); file names carry the period and "partial-generation".

## Old vs new

Register by record id: regC/regS/regI/regW at 3 periods = 954 rows, 0 mismatches. Stock ledger PD1/PL/PR identical (1, 34, 2 rows). Reports: 54178 numeric tokens in the old text, 12 not found in the new (axis tick labels only; times compared after converting 12 h to 24 h). The "Verdict" mark appears on the same two report types in both apps.

## V3 known limits, re-measured where cheap

- M-23: the Rejects trend still does not zoom on click (1 chart frame, URL unchanged). Reproduced.
- D28 / M-26: Today links are 18 px high (39-242 wide). Reproduced (owner decision A on CSS-061).
- M-12 / D11: at 768 px 16 of 17 report types with tables have a table that scrolls sideways (cue present); page overflow 0 on all. Reproduced (broader count than V3's 11 of 14, which counted differently).
- D12 / M-15 (whole-page skeleton height), D10 (Reports and Setup are restyled old markup), D29, D31, D32 (S4): not re-measured; D10 confirmed by reading (legacy-report.css, old components in the import closure).

## NOT tested

The plant or IFL server; live running data (the audit copy ends 7 Sep, Wall "running" state unseen); a real printer or the server PDF route (18 PDF links present but unfetched; shift-bounded PDF unit-tested only); a person looking at any screen; signed-in viewer/engineer/manager sessions (render token only); writes of any kind (Execute, Retire, limit saves, password change, Setup saves were not submitted); large-change limit dialog (needs a write-enabled server); touch input; Urdu; a physical TV; the API test suite (not run); parameterised-query review of API files changed since 12 Oct.

Report produced by the full presence check; per-row evidence: `fullcheck/trace-verdicts.md` in the session scratchpad.
