# VERIFY-PRESWITCH-H2H - old UI (sms/web) against new UI (sms/web-next), before the switch

Read-only run, 15 Oct 2026, HEAD `e5f853a`. Both UIs were built to scratch and served by one in-process API on an ephemeral port over `sms_audit` (READ_ONLY), render token at rank 3, `CACHE_TTL_SECONDS=300`, Edge via Playwright at 1366 x 900 unless stated. No write control was clicked; :4000, the simulator and the sync worker were not touched. A second read-only worker ran a parity check at the same time on its own port, so timings carry some noise (IQR shown). Scripts and raw JSON are in `scratchpad/preswitch-h2h/` (not committed).

## Verdict

The new app is the same or better in nearly everything a user would notice: error states, keyboard focus, phone layout, route switching, Products, and every interaction the old app offered except one. It is **slower to settle on three screens** (Rejects, Reports at 34 days, Today cold) and sends **more requests and about 35 % more JS and CSS**. It lacks **click-to-zoom on the Rejects trend chart**, which the old app had in code. Nothing found is a blocker for owner review. Nothing was verified on the plant.

## Worse items (severity and fix)

| # | Item | Severity | Recommended fix |
|---|---|---|---|
| W1 | Rejects trend chart has no click-to-zoom and no "Zoomed in - Back". Old: `RejectTrendChart` takes `onSelect` and builds a zoom prop (`web/src/screens/report/shared.tsx` ~1300, wired at `Rejects.tsx:566`). New: no `periodFor` or `onZoom` anywhere under `web-next/src/screens/Quality/Rejects/`. Known limit M-23, now confirmed as a regression against the old app. Not exercised in a browser: on this snapshot both apps' 14-day trend is empty (it anchors on today, 15 Oct, past the data), so the evidence is code only. | Medium | Pass `periodFor` and `onZoom` (as Weight and Today do) to the trend `LineChart`. |
| W2 | Rejects settles slower: 1,054 against 292 ms at 1 day cold (+761), 1,059 against 181 ms warm (+878); at 34 days 1,216 against 1,106 ms cold (+110, IQR 575) and 1,321 against 1,060 ms warm (+261, IQR 1,230). 15 requests against 12. | Medium | Defer the extra reads (trend, heat matrix) so the first view does not wait for them. |
| W3 | Reports (daily) at 34 days: 864 against 292 ms cold (+572), 876 against 246 ms warm (+630). 11 requests against 6; JS+CSS 828 against 604 KB. | Medium | Find which of the five extra calls blocks first paint and defer the ones not on screen. |
| W4 | Today at 1 day cold: 1,725 against 1,042 ms (+682, IQR 975); at 34 days +156 cold, +84 warm. 16 requests against 11. | Low-Medium | Same as W3. |
| W5 | Polling on Today at the default period: 40 requests a minute against 24 (+67 %): 6 each of station-status, rejects, sacks/summary, attention and machines/running, 12 of production, against 3 and 9 in the old app. Weight is about equal (16.7 against 14). | Low-Medium | Poll `/api/live` (every 10 s in both) and refresh the heavy reads only when it reports a change. |
| W6 | JS+CSS on first load 651-679 KB against 494 KB on most screens (+32-37 %), Reports 828 against 604 KB. Warm loads are near zero in both. | Low | Not needed on a plant LAN; split Reports if wanted. |
| W7 | Register stops at 5,000 rows ("Load more", `MAX_PAGES` 50 x 100); the old app paged without a limit. Export CSV is the way past it. A code comment states the limit; whether the screen says so to the reader was not verified. | Low | Say it on screen when the cap is hit, beside the export link. |
| W8 | Wall below 1024 px shows one line and a link (owner decision 13 Oct); the old Wall rendered at 800 px. Intended. | Info | None. |

## Where the new app is better

- Failed endpoint (500 injected, 7 screens, one route family and all data routes): the new app shows `role="alert"` states and Retry buttons (Today 7 alerts and 7 Retry with one route down; Reports 1 and 1). The old app had no `role="alert"` anywhere and fewer Retry buttons (Today 2, Reports 1, Health 0 with one route down). Neither blanked or threw a page error. Weight did not react to my single-route pattern in either app (both use other routes), so the all-routes case is the comparison there: old 3 Retry and no alerts; new 7 Retry and 8 alerts.
- Route switch Today to Weight (n=5, fresh page each time): 111 ms (IQR 38) against 373 ms (IQR 5), 6 requests against 8.
- Products settles 250-300 ms faster (764-801 against 1,028-1,049 ms at 1 day; 970 and 764 against 1,049 and 1,040 at 34 days).
- Keyboard focus at 1366: 25 of 25 tabbed controls show an outline or ring in the new app; in the old, 23 of 25 on every screen (the two date inputs show none).
- Overflow: 0 px page overflow at 375, 1366 and 1920 on all 7 screens in the new app. The old app overflows 57 px on Readings at 375. The new tab strip on Register and Products at 375 has one element wider than the screen inside its own scroll strip; no page overflow.
- Clean loads: 0 console errors and 0 failed requests on all 7 screens in both apps, and in all 240 benchmark loads.
- Period control: the new panel keeps This shift, Today, Yesterday, shift-snapped custom range and Pick dates, and adds Last week and Last month.
- Sorting: new tables sort; the old app had no user sorting.

## Feature parity (check 1)

Browser-checked at a one-week period (hover tooltip at 5 points, keyboard Home, Arrow and Enter, click scan at 21 points, resize handle count), plus code reading and URL probes.

| Area | Old | New | Result |
|---|---|---|---|
| Chart tooltips (hover) | all charts | all charts (Pareto 3 of 5 points) | same |
| Chart keyboard (focus, arrows, Enter) | all | all (the new kit reuses the old `ChartFrame`) | same |
| Drag-resize handle | every chart | every chart (3 on Today, 2 on Weight) | same |
| Click-zoom and Back: Today shift chart, Weight cone and sack charts, daily report chart | yes | yes, "Zoomed in - Back" shown | same |
| Click-zoom: station-sheet daily means | yes (code) | yes (code) | same |
| Click-zoom: sacks per day | on old Sacks | on Today ("Sacks per day") | same |
| Click-zoom: Rejects trend | yes (code) | no | worse (W1) |
| Station bars open the station sheet | yes | yes (Weight offset chart click opens sheet=station:4) | same |
| Old Sacks by-product, pass-share and by-shift charts | on Sacks | strings exist in `copy.ts`; not located on screen | not verified |
| Period presets, pick dates, custom shift range | yes | yes, plus 2 presets | same or better |
| Replay `at=` | works | works (reads "1 Sep, morning shift", "Data current") | same |
| Wall | any width | 1024 px and up; one line below | by decision |
| Text size | yes | yes (same `sms.uiScale` key) | same |
| Station and reason sheets by URL | yes | yes | same |
| Register: station filter, state chips, batch switch, Export CSV, Print | yes | yes (2 selects, identical export link, Print) | same |
| Register paging | Previous/Next, unlimited | Load more, 5,000 rows | weaker (W7) |
| Reports: Print, CSV, Excel, PDF links | yes | yes, same export routes | same |
| All 18 report types by `rt=` | yes | yes; each rendered rows, same row counts as the old where the old had loaded (station, cone-weight and management-summary were still empty in the old at 3.5 s) | same |
| Products tabs | Running, Changeover, Catalogue, History | Board, Changeover, Catalogue, Limits and History | same |
| Setup (rank 4), PDAS write forms, Account | present | present (Setup hidden at rank 3 in both). Forms were not exercised. | not verified |
| Hops between screens, print layout, PDF output | yes | covered by existing specs; not re-run here | not verified |

## Speed (check 2)

Cold = fresh browser context per load; warm = a second load in the same context. N=5 per cell, order alternated old/new, one discarded warm-up per cell. "Stable" = the last DOM change, after which nothing changed for 600 ms and no request was in flight, in ms from navigation start (median, IQR in brackets); it is a proxy for "content settled". Time to first paint was 40-52 ms in both (the empty shell), so it says nothing. The API's figure cache was on (300 s), so request times mostly show cache hits; cold compute at TTL 0 was NOT measured.

| Screen, period, mode | Stable old | Stable new | New minus old | Requests old/new | JS+CSS KB old/new |
|---|---|---|---|---|---|
| Today, 1 day, cold | 1,042 (7) | 1,725 (975) | +682 | 11/16 | 494/651 |
| Today, 1 day, warm | 1,146 (156) | 1,079 (391) | -67 | 11/16 | 1/4 |
| Today, 34 days, cold | 1,046 (4) | 1,202 (14) | +156 | 11/16 | 494/651 |
| Today, 34 days, warm | 1,039 (7) | 1,123 (133) | +84 | 11/16 | 1/4 |
| Weight, 1 day, cold | 127 (24) | 116 (1) | -11 | 10/12 | 494/679 |
| Weight, 1 day, warm | 61 (5) | 64 (11) | +3 | 10/12 | 1/4 |
| Weight, 34 days, cold | 191 (29) | 175 (9) | -17 | 10/12 | 494/679 |
| Weight, 34 days, warm | 104 (4) | 123 (315) | +19 | 10/12 | 1/4 |
| Rejects, 1 day, cold | 292 (123) | 1,054 (191) | +761 | 12/15 | 494/679 |
| Rejects, 1 day, warm | 181 (175) | 1,059 (320) | +878 | 12/15 | 1/6 |
| Rejects, 34 days, cold | 1,106 (113) | 1,216 (575) | +110 | 12/15 | 494/679 |
| Rejects, 34 days, warm | 1,060 (15) | 1,321 (1,230) | +261 | 12/15 | 1/6 |
| Register, 1 day, cold | 132 (23) | 148 (10) | +16 | 7/12 | 494/678 |
| Register, 1 day, warm | 117 (38) | 94 (33) | -22 | 7/12 | 1/6 |
| Register, 34 days, cold | 318 (54) | 279 (74) | -38 | 7/12 | 494/678 |
| Register, 34 days, warm | 101 (60) | 121 (21) | +20 | 7/12 | 1/6 |
| Reports daily, 1 day, cold | 290 (20) | 318 (159) | +28 | 6/11 | 604/828 |
| Reports daily, 1 day, warm | 236 (2) | 273 (24) | +37 | 6/11 | 1/4 |
| Reports daily, 34 days, cold | 292 (29) | 864 (67) | +572 | 6/11 | 604/828 |
| Reports daily, 34 days, warm | 246 (18) | 876 (345) | +630 | 6/11 | 1/4 |
| Products, 1 day, cold | 1,037 (7) | 801 (167) | -236 | 7/11 | 494/651 |
| Products, 1 day, warm | 1,028 (9) | 728 (71) | -300 | 7/11 | 1/4 |
| Products, 34 days, cold | 1,049 (128) | 970 (265) | -78 | 7/11 | 494/651 |
| Products, 34 days, warm | 1,040 (2,021) | 764 (38) | -276 | 7/11 | 1/4 |

All 240 loads settled (no timeouts). Differences inside the IQR (Weight, Register, most Today rows) are noise. The last API response arrives later in the new app on every screen (for example Weight 34 days cold 234 against 624 ms, Register 347 against 1,628 ms) because it asks for more; on Weight and Register the visible content settled earlier than that, so I do not count those as user-visible. Summed request time was 2 to 10 times higher in the new app (Today 1 day cold 1,152 against 7,076 ms), which is the server-side cost of the extra requests.

Polling was measured for 90 s after an 8 s load, all four pages at once, at the default (live-capable) period: Today old 24 a minute (live 9, data-batch 9, production 9, others 3 each), new 40; Weight old 14, new 16.7.

## Verdict table

| Area | Old | New | Better, same or worse | Evidence |
|---|---|---|---|---|
| Chart interactions (tooltip, keys, resize, zoom) | full | full except Rejects trend zoom | same | feature probe, code |
| Rejects trend zoom | yes | no | worse (W1) | `shared.tsx`, `Rejects.tsx` against `QualityRejects.tsx` |
| Period controls | 7 choices | 7 plus 2 presets, shift-snapped | better | PeriodPanel, probe |
| Register paging | unlimited | 5,000 row cap, filters equal | slightly worse (W7) | `MAX_PAGES` |
| Reports (18 types, 4 exports) | present | present | same | all 18 loaded, export links |
| Wall | any width | 1024 px and up | by decision | probe |
| Load speed Weight, Register | fast | fast | same | table |
| Load speed Products | about 1.03 s | about 0.75 s | better | table |
| Load speed Rejects | 0.2-1.1 s | 1.05-1.3 s | worse (W2) | table |
| Load speed Reports, 34 days | 0.25-0.3 s | 0.86-0.88 s | worse (W3) | table |
| Load speed Today | 1.04 s | 1.1-1.7 s | slightly worse (W4) | table |
| Route switch | 373 ms | 111 ms | better | switch run, n=5 |
| Requests per screen load | 6-12 | 11-16 | worse | table |
| Polling, Today | 24 a minute | 40 a minute | worse (W5) | 90 s count |
| JS+CSS on first load | 494-604 KB | 651-828 KB | worse (W6) | table |
| Console errors and failed requests, clean | 0 and 0 | 0 and 0 | same | 240 loads, 7 screens |
| Failed-endpoint state | text, some Retry | alerts and Retry everywhere | better | 500 injection |
| Page overflow 375, 1366, 1920 | 57 px on Readings at 375 | 0 | better | layout run |
| Keyboard focus visible | 23 of 25 | 25 of 25 | better | 25 Tab presses per screen; outline or ring only, contrast not measured |

## Not verified

Rejects trend zoom in a browser (the trend window is empty on this snapshot); the old Sacks charts' homes in the new app; write controls and forms (Setup, PDAS, adjustments, stock movement); hops, print and PDF output; signed-in sessions below rank 3; touch; cold API compute at cache TTL 0; any plant hardware. The parity worker ran alongside, so the timings include its load.
