# SMS performance report, Phase 3 (12 Oct 2026)

## 1. What this is and what it is not
- Every number was measured on one laptop (this development PC), against `sms_audit`, a frozen read-only copy with real data to 7 Sep 2026.
- The identity was the harness render token (rank 3; rank 4 for Setup and admin routes). Everything ran on loopback, so there was no real network. Browser runs used Edge through Playwright at 1366x768. Where CPU or network was slowed, it is called "emulated" and is a stand-in, not a claim about the plant PC.
- The plant PC may differ. Timings here are relative evidence only.
- Nothing touched the plant, IFL's databases or the owner's API on port 4000. No database was written. No index was created. No credentials were used.

## 2. Method
- Periods: D1 (one production day, 19 Aug), S1 (one night shift, 2 Sep), W7 (31 Aug to 6 Sep), M34 (the whole September generation, 5 Aug to 7 Sep). Proof-only periods: July 19 days, cross-generation, an empty day, a shift range.
- What was timed: the exact requests each screen sends on first load (captured from a real browser: 144 loads, 0 page errors), all 18 report types plus the header, and the period-free routes.
- Cold = response cache off, one discarded warm-up call, then the median of 5 (IQR kept). Warm = cache on, same request repeated, "HIT" confirmed. Process-first = the first request after a new process opens its connection (recorded apart, never mixed into cold).
- Timed steps held a lock so nothing else ran on the machine; the machine was quiet at the start of each.
- A fix is only made if it clears the Phase 3 rule: a measured gain a person would notice, a small low-risk change, and a test that fails first on a count or byte budget. Responses before and after must be identical (deep-equal) over the proof periods.
- Phase 3 re-measures every change back to back (ABAB, N=7).

## 3. Server
### 3.1 Time to all data per screen (a proxy: the slowest request of the screen; browsers run requests in parallel)
| Screen | D1 | W7 | M34 |
|---|---|---|---|
| Weight | 744 ms | 1,573 ms | 4,341 ms (/api/spc) |
| Report: shift | 643 | 1,444 | 2,923 |
| Report: management-summary | 656 | 1,387 | 2,810 |
| Report: daily | 548 | 1,319 | 2,806 |
| Sacks | 390 | 660 | 1,257 |
| Readings | 220 | 447 | 1,243 |
| Rejects | 220 | 389 | 1,139 (/api/rejects/by-day-code) |
| Line | 634 | 609 | 963 (/api/attention) |
| Product > Running | 318 | 318 | 318 |
| Health | 220 | 220 | 387 |

Source: m/srv/screen-proxy.json, summary.md. This is the slowest request, not a measured time to a visible figure (see section 6 for that).

### 3.2 Slowest requests, cold, M34 (median of 5; IQR)
/api/spc cone productId=12 4,341 ms (236), 795 KB; /api/spc cone 3,877 (202), 795 KB; report shift 2,923 (193); report product 2,902 (57); management-summary 2,810 (321); report daily 2,806 (56); cone-weight 2,321 (185); station 1,770 (95); calibration 1,678 (56); shift-production 1,673 (49); machine-product 1,286 (59); sack 1,257 (48); events 1,243 (101); rejects by-day-code 1,139 (32, uncached, 6 round trips); weight-stations 1,240.
At W7 spc is 1,286 to 1,573 ms. At D1 the slowest are the composite reports at 0.55 to 0.66 s and /api/attention at 0.63 s.

### 3.3 What a cache HIT still costs
Of 165 cached requests, 65 cost no SQL on a HIT (1 to 16 ms): production, spc, events, weight-stations, reject-spc, live, operations, system-history. 5 cost one query (attention, about 95 ms). 95 cost five queries (every report type, a flat 170 to 185 ms): the extra is the response envelope looking up the newest production day and the data version. 74 requests are not cached at all.

### 3.4 SQL round trips per request
Time grows with the period, chattiness does not. Management-summary 157 round trips, shift 114, sack 56, daily 53, cone-weight 51, station 38, attention 25, weight-stations 25, at every period. The 24 Sep weight-stations fix (one scope lookup instead of three) holds. Statements run in parallel (management-summary: 29 s of statement time inside 2.8 s of wall time), so fewer round trips does not mean proportionally faster.

### 3.5 Comparison with PERFORMANCE-APP-2026-09-24.md
Method differs: then, through port 4000, signed-in admin, 1 cold + 1 warm, not a median; now, harness, `sms_audit`, median of 5, render token. The "then" column was taken from the plan's summary, not re-read.

| Cold, 34 days | 24 Sep | 12 Oct |
|---|---|---|
| weight-stations | 1.5 to 3.0 s | 1.24 s |
| spc | 1.5 to 2.2 s | 3.9 to 4.3 s (slowest request now; the 24 Sep variant was not checked) |
| management-summary | 2.3 to 2.6 s | 2.8 s |
| attention | 0.7 to 3.1 s | 0.96 s |
| production | 0.9 s | 0.69 s |

Warm: then 4 to 200 ms; now 1 to 16 ms (no-SQL routes) and about 175 ms (reports). reject-spc and events are cached now; rejects, calibration adjustments, the sacks routes and reconciliation are still not.

### 3.6 D-55 (rejected-hangers)
Re-measured: 34 days 417 ms (IQR 6, 897 KB, 12 round trips); July 19 days 391 ms (IQR 7). D-55 recorded 1.27 s and 0.86 s. Under this method the under-1-second target is met. The method differs, so D-55 gets a dated note, not a close.

## 4. Many viewers
Viewers replayed Line and Weight loads and polls for 62 s (Node fetch loops, no browser, plant cache setting 5 s, all starting within 2 s: the worst case).

| Viewers | p50 / p95 ms | SQL batches per s | Duplicate cold builds |
|---|---|---|---|
| 1 | 313 / 942 | 4.3 | 0 |
| 2 | 229 / 890 | 5.5 | 2 |
| 4 | 234 / 1,218 | 10.0 | 17 |
| 8 | 645 / 2,903 | 22.8 | 63 |

A duplicate cold build = a request computing an answer another identical request was already computing. At 4 viewers: spc 6, production 4, live 4, attention 2, weight-stations 1.
Four identical requests at the same instant (M34), median ms alone vs four at once: production 359 vs 484, weight-stations 774 vs 1,148, spc 1,326 vs 1,998, management-summary 1,963 vs 5,828. SQL work was exactly 4.0 times in every case: there is no sharing of in-flight work.
Exports at M34, alone, cold, median of 3: management-summary PDF 6,145 ms (CSV 2,781; XLSX 2,744); rejected-hangers PDF 2,280 (CSV 482; XLSX 530); sps-packing PDF 1,700 (CSV 164; XLSX 169). The PDF worked on this host (Edge launched every time).
Concurrent PDFs: the management-summary PDF failed with HTTP 502 ("Waiting for selector .print-head failed") after about 36 s in 3 of 5 concurrent runs in one test and 1 of 2 in another; never alone (6 alone runs OK). The cause was not investigated. Other PDFs in the same runs succeeded in 4 to 7 s.
Sources: m/load/viewers.json, thundering.json, exports.json, exports2.json. Stated deviation: viewers all used identical URLs (best case for the cache); in a browser the time anchor drifts per viewer.

## 5. SQL
Top statements (DMV, whole M-SRV session; the plan cache held 632 plans):
1. Newest production day per epoch, `SELECT MAX(shift_date) ... WHERE line_id AND source_epoch`: 400 executions, 47.6 s total, 119 ms average, one 10.0 s outlier (cause not established: cold buffers or contention), about 434k logical reads each. The index it uses does not contain source_epoch, so it walks newer rows. On this database the newer rows are plant-simulator epochs 13 to 16 (dev only), which inflates the cost; at IFL it stays costly for any older generation in scope.
2. The epoch census (row counts per epoch): about 72 s of statement time across the family; the windowed form does a clustered lookup per row; 5 to 25 times per composite report.
3. Envelope `MAX(transform_version)`: 491 executions, 38 ms, 13,191 reads each, also on cache HITs.

181 missing-index suggestions boil down to two needs. Plans: an index scan with a key lookup per row; spill and conversion warnings could not be read (the tool truncates plan XML). Phase B (logical reads at D1 and M34, warning flags) was prepared but NOT run when this was drafted (S/phase3/m/sql/sql/b1-b3).

### Index proposals - owner decides; app-owned `sms` database only; never IFL's (Q21); not applied, not tried
| Id | Table | Key columns | Include | Should help | Write cost |
|---|---|---|---|---|---|
| IDX-1 | sms.cone_event | line_id, source_epoch, shift_date | source_station, weight_g, in_range, material_id, production_ts_utc_ms, shift_code | newest-day lookup and the windowed census (estimate: from hundreds of thousands of reads to the order of 1 to 2 thousand; NOT measured) | about one row per second inserted by the worker; negligible; size not measured |
| IDX-2 | sms.cone_event | line_id, source_epoch | transform_version | envelope lookup (estimate: 13,191 reads to a few hundred; NOT measured). The same effect is available with no schema change by remembering the answer inside the cache time. | negligible |

IDX-3 (reject_event, sack_event): not proposed; the cost is tiny. Test any index on a scratch restore of `sms` first.

## 6. Browser
Bundle: one script 642,671 bytes (171,648 gzip; 141,110 brotli), CSS 35,495 (8,109 gzip). Composition: our screens 140.8 kB (21.9%), react-dom 129.1 kB (20.1%), report screens 126.1 kB (19.6%), words.ts 70.1 kB (10.9%), product 45.7 kB, ui 32.1 kB, setup 31.8 kB, health 15.0 kB. Only react and react-dom are dependencies. Code not needed to show Line: Report 111.5 kB, Product 42.1, Setup 37.2, Health 13.1, Wall 5.1, Account 1.8, shared 18.2 (total 228.9 kB). The split that was built (section 7) took 174,101 B off Line's first load (642,671 to 468,570 B).
First meaningful figure (no skeleton, nav and heading present), N=5, 1x: Line D1 1.07 s (IQR 0.07), M34 2.24 s (0.14). Emulated 4x CPU: Line D1 1.28 s, M34 2.15 s (with emulated LAN 2.27 s). Script time for the bundle: 55 to 71 ms at 1x, 278 to 354 ms at 4x; the wait is the server. Weight D1 1.64 s, M34 7.05 s (IQR 0.94; 3.5 to 4.5 s in three profiled runs: unexplained). Report (management-summary) D1 1.41 s, M34 3.03 s. Readings D1 0.45 s, M34 1.52 s. No long task over 50 ms anywhere.
Route switches (D1, 1x, N=5): Line to Weight 1.18 s, Weight to Report 0.68 s, Report to Product 0.35 s, Line to Health 0.24 s, Line to Readings 0.16 s, Line to Setup 0.24 s. It is all server wait.
Polling (120 s page clock): closed period M34: every screen polls only /api/live, 5.5 to 6 per minute; Health 7.5; Product Running 11 (it shows "now" data); Wall 5.5. Live period: Line 22 per minute, Readings 19, Sacks 17.5, Rejects 15, Weight 14, Report 11.5, Health 8; between ticks only the time anchors move, by design. So the 2 Oct fixes (C-137, C-143) hold.
Duplicates: Weight sends the identical /api/spc?type=cone request twice at the same time (all-products and productId=12), 20 of 20 loads. Product Catalogue loads /api/product-write/status 3 times and /api/products twice.
Static files: Cache-Control public, max-age=0 with a weak ETag; a repeat check returns 304 in 0.5 to 2.4 ms, 5 requests per load. A warm-cache reload could not be observed (the read-only route guard turns off Edge's HTTP cache).
Render cost: no long task. Script to first figure 62 to 72 ms (Weight, M34), 64 to 69 ms (Line, M34); the heaviest functions are number and date formatters at 8 to 13 ms over a whole load; about 20 ms per poll tick.
Payload sizes: rejected-hangers M34 896,696 bytes (63,142 gzip; 45,775 brotli), spc 794,882 (51,876; 34,119), machine-product 304,861 (28,539; 17,937), shift-production 166,988 (19,138; 11,985), rejected-sacks 149,046 (12,891; 8,231). Gzip saves 88.5 to 93.5 percent.

## 7. What was changed today
Three commits. Each was re-measured back to back (before and after in separate processes, interleaved ABAB, N=7; the server sweep N=5), on the same laptop, `sms_audit`, render token, loopback. Edge with 4x CPU is emulated. The plant PC may differ; these are relative figures.

### P3-01 - identical simultaneous requests share one computation (D-311, `581f6fc`)
Plain words: when several people open the same heavy screen at the same moment, the server now does the work once and hands everyone the same answer, instead of doing it once per person.
Four identical cold requests at once, 34 days, wall time (median, IQR) and SQL round trips:
| Route | Before | After | SQL round trips |
|---|---|---|---|
| production | 1,970 ms (207) | 1,868 ms (526) | 52 to 13 |
| weight-stations | 4,264 ms (99) | 3,172 ms (600) | 100 to 25 |
| spc | 2,868 ms (243) | 1,785 ms (186) | 36 to 9 |
| management-summary | 12,596 ms (346) | 4,284 ms (340) | 628 to 172 |
- SQL work fell 73 to 75 percent on every route. That count is exact, not a timing.
- Time: spc (-38 percent) and management-summary (-66 percent) clear the rule. weight-stations is -26 percent, but the 1,092 ms gain is just under twice its IQR (1,200), so it is marginal. production shows no gain (-5 percent, inside noise). The commit message says so.
- Correctness: over 342 request paths at rank 3, the only differences between before and after were the process fields of `/api/health` (uptime, process id, start time, disk free). Four concurrent bodies were hash-equal to each other and to the before side on 5 routes.
- Sequential sweep: 42 cold request paths at D1 and M34, 0 regressions, 0 improvements.
- Red first: the new tests failed before the change on counts (24 vs 12 and 86 vs 47) and passed after.
(Source: rv/p301*.jsonl, items/P3-01/after.json, rv/cmp/compare.json, rv/sweep.json.)

### P3-04 - Report, Setup, Health and Wall load as separate chunks (D-312, `45a31f8`)
Plain words: the program no longer sends the code for Report, Setup, Health and Wall until someone opens them. The gain is in bytes, not in time.
- Line's first load: JavaScript 642,671 B to 468,570 B (-174,101 B, -27.1 percent). Report's first load fetches 580,408 B over 3 files.
- Time to first figure on Line: 1x 2,226 ms (IQR 315) to 2,141 ms (261); 4x CPU 1,652 ms (132) to 1,585 ms (109). Both differences are inside noise. There is no measured time gain, because the wait is the server, not the script (script time 72 ms at 1x, about 335 ms at 4x, unchanged).
- Route switches (N=7): none is slower beyond noise. The largest change is Line to Weight, 986 ms (IQR 233) to 1,114 ms (172), +128 ms. That is over 100 ms but inside noise, and the timings on both sides are bimodal (about 800 and 1,100 ms); Weight itself is not split. The RV called it noise and the committer recorded it in the commit body; it was not independently re-confirmed. Others: Weight to Report -53, Report to Product -6, Line to Health -4, Line to Readings +3, Line to Setup +18 ms.
- Polling per minute is equal on Line and Weight, live and closed period. Visible text matches on 8 screens at D1 and M34 apart from clocks.
- Red first: the byte-budget spec failed on the old build (642,671 > 480,000; no second script) 3 of 3 and passes on the new build 3 of 3.
(Source: rv/client-summary.json, items/P3-04/.)

### X-3c - machine-product report says when a period is empty (D-313, `6bb6286`)
This closes the open gap of the Stage 3 entry. Before: the report printed "0 machines, 0 products this period." for an empty period, because the server returns one all-zero row per station. After: a period after the newest reading prints "No readings in this period - the newest reading is 12:00 PM, 7 Sep." (checked on 2026-10-05..06 in a built page: before it printed the zero-machines line, after the empty sentence; the period 2026-09-01..07 inside the data is unchanged at 13 machines, 5 products). The July gap period 2026-07-20..25, which the real API also answers with 14 zero-cone rows, no longer prints the zero line either (fixer's check on `sms_audit`). With this, all 18 report types name the newest reading or state an empty period. One session-gated spec (`machine-product-report.spec.ts`) was changed on the orchestrator's authority, because it encoded the old zero-matrix behaviour on the default (future) period; the change is documented in items/X-3c/spec-change.md and the spec passes 3 of 3.
(Source: rv/x3c.json, items/X-3c/fix.json.)

### Gate and no-regression
Gate G1r on HEAD `7bcc386` with the three items in the tree: typecheck clean; `npx vitest run` twice, identical, **404 files passed / 1 skipped, 4,183 tests passed / 4 skipped, 0 failed**; scratch web build clean (CSS 35,495 B, as before; JS index 373.08 kB, words 95.48, Report 111.83, Setup 37.62, Health 13.31, SyncHealthBlock 11.38, Wall 5.34 kB); `npm run test:layout` 422 listed, **384 passed, 38 skipped, 0 failed** (skips need credentials, deliberately not supplied); session-free mirror **417 passed, 5 failed**, the same 5 known (Name it editor; Calibration x2; Daily by-shift x2); the P3-04 spec 9 of 9 over 3 repeats. The three commits are `581f6fc`, `45a31f8`, `6bb6286`; the reduced re-gate on the committed HEAD is the orchestrator's and is not recorded here.
RV no-regression sweep: PASS (42 server paths, first load of Line, Weight, Report and Readings and 6 route switches, polling on Line and Weight).

### Tried and not committed
Nothing was tried and then dropped. Candidates not taken are in section 8.

## 8. What was measured and not changed
| Pid | Verdict | Numbers | Proposal / owner question |
|---|---|---|---|
| P3-02 report cache HITs still run 5 queries | RECORD | 170 to 185 ms flat; background poll, nobody waits; at the plant's 5 s cache a HIT needs another viewer within 5 s | Remember envelope data inside the cache time, or IDX-2. Question: may a cached report's freshness line describe the moment the answer was computed (up to the cache time earlier)? |
| P3-03 slow composite reports and spc | RECORD | spc 3.9 to 4.3 s at M34; management-summary 157 round trips, 25 scope lookups | Share one scope lookup per request across the report services (more than 3 files); run independent awaits together; profile /api/spc by statement; IDX-1. Question: approve a later item for this? |
| P3-05 polling churn | REFUTED | closed period polls only /api/live (5.5 to 6 per min) | none. Product > Running polls "now" data every 30 s by design |
| P3-06 static file revalidation | REFUTED on loopback | 304 in 0.5 to 2.4 ms; under 15 ms per load | immutable headers for hashed files, if viewers are on a slow network. Question: what network sits between viewers and the server? |
| P3-07 React render cost | REFUTED | no long task; formatters 8 to 13 ms | none |
| P3-08 PDF under concurrency | RECORD | 502 in 3 of 5 concurrent runs (management-summary), never alone | defect; investigate the 30 s wait; maybe one PDF at a time. Question: queue PDFs (each slower) rather than run together and sometimes fail? |
| P3-09 payload size | RECORD | 897 KB, 795 KB; gzip saves 88 to 94 percent | response compression is a new package. Question: approve it if viewers use a LAN or Wi-Fi? |
| P3-10 indexes | RECORD | see section 5 | IDX-1, IDX-2 on a scratch restore of `sms` first |
| P3-11 Weight sends spc twice | RECORD | est. 1,998 to 1,381 ms at 4 at once (-31%) at M34 only; P3-01 (now committed) already shares the duplicate work on the server | reuse the first result for the chart (one-file change) after P3-01 |
| P3-12 newest-day lookup | RECORD | 400 runs, 119 ms average, 98.5 ms of a report HIT; inflated on this dev database | remember per epoch inside the cache time, or IDX-1 |
| P3-13 Catalogue repeats requests | RECORD | 3x status, 2x products, under 0.3 s | share one fetch in a later pass |
| P3-14 rejects by-day-code uncached | RECORD | M34 1,139 ms (IQR 32), 6 round trips | profile; consider the same response cache |
| P3-15 D-55 | REFUTED as slow | 417 ms vs 1.27 s | dated note under D-55 |

Cache time and polling intervals are owner and IFL settings; no change is proposed.

## 9. Not verified
- The plant PC (CPU, Edge version, Windows scaling) and IFL's server and its load.
- The real LAN or Wi-Fi, many real users, a signed-in session (render token only).
- Data volumes beyond 53 days. Growth with months of history is inference from query shape, not measured.
- The 10 Jul to 5 Aug month (never sent by IFL).
- Live "running" data (the snapshot ends 7 Sep; the live period was empty).
- SQL plan warnings and logical reads at D1/M34 (the Phase B scripts were prepared but never run); the cause of the 10.0 s outlier; why Weight M34 took 7.05 s in clean runs vs 3.5 to 4.5 s in profiled runs.
- A warm browser-cache reload; the cause of the PDF 502.
- P3-04 gave no measured time gain and one route switch (Line to Weight, +128 ms) was called noise by the RV and not re-confirmed.
- The re-gate on the committed HEAD (after the three commits) is not part of this report.
