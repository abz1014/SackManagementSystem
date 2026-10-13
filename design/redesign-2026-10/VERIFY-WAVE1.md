# VERIFY-WAVE1 - browser and parity check of wave 1 (13 Oct 2026, HEAD 2961432)

Read-only. Edge via Playwright against the real api/dist, DB `sms_audit` (READ_ONLY), render-token identity (rank 3, not a signed-in user), ephemeral port. Old UI at `/`, new UI at `/next/`, both built to scratch. 123 new-app cells captured (viewport + fullPage PNG + text each) at 1366x768, 1920x1080, 375x812 for PD1, PL, PR and default; Wall at 1366/1920; plus the old UI text for PD1/PL/PR. Evidence: scratchpad `v1/shots/` (PNG, `txt/`, `old/`, `log-*.json`).

## Verdict

PARITY: PASS with explained differences. Every cone, sack, kg, failed-inspection n/%, per-station cone count and failed %, weight-reject figure and top reason matches the old UI for PD1, PL and PR, apart from the definition differences listed below. No figure defect found.
VISUAL: NOT READY for the phone. Two S1 layout defects (horizontal overflow at 375 on Today and every Quality tab; Today KPI row overflows 1366 and clips the fifth tile) and several S2 problems. Console: 0 errors/warnings and 0 failed requests in all 123 cells.

## Parity (old UI vs new UI DOM text)

| Figure | PD1 old | PD1 new | PL old | PL new | PR old | PR new |
|---|---|---|---|---|---|---|
| Cones | 3,089 | 3,089 | 132,550 | 132,550 | 3,098 | 3,098 |
| Sacks | 133 | 133 | 5,435 | 5,435 | 128 | 128 |
| Packed kg | 6,297 | 6,296.7 | 256,871 | 256,871.2 | 6,029 | 6,028.7 |
| Failed inspection n / % | 451 / 14.6 | 451 / 14.6 | 6,089 / 4.6 | 6,089 / 4.6 | 390 / 12.6 | 390 / 12.6 |
| Weight-reject records | 0 | 0 (0.0 %) | 41 | 41 (0.03 %) | 0 | 0 |
| Failed weight check (scale bit) | 0.0 % | 0 of 3,089 | 0.0 % | 49 of 132,550 | 0.0 % | 1 of 3,098 |
| Mean weight / target | 1,954 / 1,960 | 1,954.3 / 1,960 | 1,952 / 1,960 | 1,951.8 / 1,960 | 1,954 / 1,960 | 1,953.6 / 1,960 |
| Top reason | Code 2/1, 98 % | 2/1, 97.6 %, 440 | 2/1, 70 % | 70.1 %, 4,240 | 2/1, 95 % | 94.6 %, 369 |
| Per-station cones | all 14 match | match | all 14 match | match | all 14 match | match |
| Per-station failed % | st 8 53.9, 9 23.1, 10 20.6, 14 17.9, 13 3.7, 2 1.0, 1 0.9 | identical | st 8 14.5, 14 11.7, 10 11.2, 9 6.0, 1 1.8, 2 2.1 | identical | not on old Line | st 8 40.8, 14 20.3, 9 17.4, 10 16.6, 7 11.7 |
| Reason sheet 1 Sep, code 2/1 | 440 | 440 (14.2 % of 3,089) | | | | |
| Station 8 sheet | 53.9 % | 53.9 %, 223 of 412 | | | | |

Mismatches, all explained (not defects):
1. Failed weight check (scale bit) 49 vs records 41 (PL) and 1 vs 0 (PR): the new Today/Weight tile counts the scale's in-range bit; the Rejects tab and old UI count weight-reject records. Both are labelled; they are two different facts.
2. Rejects denominator "451 of 3,095 cones checked" vs Today "3,089 cones": checked = cones + rejects with no matching cone row (the shared unmatched-reject rule); the rate 14.6 % is identical. PL 132,665 vs 132,550, PR 3,104 vs 3,098, same reason.
3. Station "mean weight vs target": new Today/Stations use the chosen period (st 8: PD1 -3.6 g, PL -9.9 g); the old Weight station table is always the last 14 production days (-5 g). Windows differ by design.
4. Packed kg is shown to 0.1 kg in the new UI, whole kg in the old; Wall shows "6,296.70".

compare works with key `cmp=prev` (not `compare`): PD1 vs 31 Aug: cones 3,089 vs 3,191 (-3.2 %), sacks 133 vs 131, failed 14.6 vs 13.5 %.

## Defects (ranked)

### S1
- D1 Phone: horizontal page overflow on Today (442-547 px content in a 375 viewport) and all four Quality tabs. The Weight tab is 1116 px wide at 375: headline, the Cones/Sacks + Over time/Distribution toolbar and the KPI cards are cut off at the right edge. `shots/wt_cone_time__PD1__v375.png`, `rejects__PD1__v375.png` (385 wide), `today__PR__v375.png` (547).
- D2 1366x768 (plant PC size): Today overflows horizontally (1402 > 1366) because the five KPI tiles do not wrap or shrink; "Failed weight check (scale)" is cut off at the right edge. `today__PD1__v1366.png` / `__full.png`. Same in PL, PR, default, cmp.

### S2
- D3 Phone Today KPI tiles are staggered (second column about 45 px lower, overlapping), tiles clipped; top bar title truncated to "To..." / "Qua..." and the account control collapsed to a chevron. `today__PD1__v375.png`, `stations__PD1__v375.png`.
- D4 Charts draw negative value axes for counts: Cones per shift from -500, Sacks per shift from -20, Failed by reason from -200 (-2,000 for PL), so bars float above an empty band. `today__PD1__v1366__full.png`, `rejects__PD1__v1366.png`.
- D5 Wall: shift rows ordered Evening/Morning/Night (not shift order); "Station 5 . East Conve" truncated. At `sms.uiScale` 1.3 the Wall render is byte-identical to 1.0 (setting not honoured by the new app, or the key differs), so the TV-size check was NOT done. `wall__PD1__v1920.png`. Otherwise Wall is dark, well composed, and the stale-data state is clear.
- D6 Weight tab at 1366: content is indented 20 px relative to the tab strip, the fourth KPI tile touches the right edge (1360 px) and the fifth wraps to a lone tile on a second row. `wt_cone_dist__PD1__v1366.png`.
- D7 Stations table at 1366: the "Pattern check" half (Days with a note, Result) is cut inside a horizontally scrolling box ("Nothing flag" visible). `stations__PD1__v1366.png`. On phone the table becomes cards; "Show all" is ambiguous.

### S3
- D8 Rejects: "Daily failed-inspection rate, last 14 production days" shows "Nothing in this period" for every period including PL (the old UI says the same; carried over, but the empty card is large). The reason-by-day heat map shows only the chosen day.
- D9 Vocabulary: station sheet "Top reasons" prints "Tube 2 . Mat 1" while every other place says "Code 2/1". Reason sheet cone rows show weight "Not weighed" for failed-inspection cones, which reads like a fault.
- D10 Station sheet shows "Judged against 201-IH0-SD" beside "Last product it stamped: 205-IL0-SD" without saying which applies; Station 6 on PR prints "No data" in Days/Result while the other empty stations print "0 / Nothing flagged".
- D11 Today PL product-change banner says "first cone ... at 10:37" with no date (PD1 says "on 7 Sep").
- D12 Rejects 1366: the chart's "Cumulative share (%)" title collides with the first row of the adjacent reasons table; Today reason chart x labels truncated ("Code 2/1 (not...").

### S4
- D13 PR heading "1 Sep evening shift - 2 Sep morning shift 2026, plant time." (year appended after a shift range).
- D14 Compare tile "down 0.1 points vs 0.1 %" for a 0.0 % figure (rounding artefact).
- D15 Default period (13 Oct evening shift) is empty with a clear "Nothing in this period ... Show 7 Sep 2026" state; five full-height "No data" tiles, noted only.

## Mockup comparison (Style C)
Matches: soft blue-grey background, white floating sidebar, frosted top bar, 16 px cards, blue active pill, gradient hero card, Act/Watch/OK/No-data states with icon plus word, dark Wall. Deviations: D1-D3 (layout breaks at 1366 and 375), D4 (negative axes), D6 (indent). The HTML boards were not rendered side by side; comparison is against the Style C description and DESIGN-SYSTEM.

## Console and network
0 console errors, 0 warnings, 0 failed or >=400 requests in all 123 cells (listeners on console, pageerror, response, requestfailed).

## Not checked
Printed pages; the plant PC's real Edge and Windows scaling; Wall at uiScale 1.3 (no visible effect); signed-in viewer/engineer/admin; Products, Reports, System screens and the Register tab; sack-weight and distribution visuals beyond text (PNGs captured, only the cone distribution reviewed); writes (read-only); touch input; keyboard focus; PL/PR/default PNGs only sampled by eye (the overflow and error scan covers all cells).

Owner PNGs: scratchpad `v1/for-owner/` (7 files).


## Fixes (L1) - 13 Oct 2026

Method as V1: real Edge via Playwright, api/dist on an ephemeral port, DB sms_audit READ_ONLY, render-token identity, web-next built to scratchpad l1/next. 123 cells before and after (PD1, PL, PR, default at 1366, 1920, 375; Wall at 1366, 1920 and 1920 with sms.uiScale 1.3). Before PNGs: scratchpad/l1/shots-before/; after PNGs: scratchpad/l1/shots-after/ (same file names); owner set: scratchpad/l1/for-owner/.
Result: horizontal overflow 42 of 123 cells before, 0 after; console errors/warnings 0, failed requests 0 in both. Wall page height 1080 at 1920 in all 8 cells, including uiScale 1.3.

Commits: d4cc79c (layout), 90aa9f0 (charts), 51e510b (Wall, uiScale), b710379 (vocabulary, banner, delta, empty trend).

| Defect | Status | What changed |
|---|---|---|
| D1 phone overflow | fixed | .qw grid column was content-sized (1116 px); now minmax(0,1fr). .kpi min-width 200 px removed. Stations table scrolls inside its box with a fade and "Scroll for more". |
| D2 1366 KPI row | fixed | auto-fit minmax(176px) grid, five across at 1366 and 1920; tiles shrink with min-width:0. |
| D3 phone tiles and top bar | fixed | tiles no longer overflow, so no stagger; top bar wraps (title on its own row, then period, health, account). |
| D4 negative count axes | fixed | charts/domain.ts zeroBasedDomain (the shared niceDomain padded below 0); used by Bar, Histogram, Pareto, zero-base Line. Unit-tested. |
| D5 Wall | fixed | shifts Morning, Evening, Night (inShiftOrder); station name on its own wrapping line, never cut. sms.uiScale now read: 1 keeps the 1.6 TV scale, 1.3 gives 1.7 (2.08 = 1.6 x 1.3 did not fit one 1080p screen). Old Desk/Wall labels map: key honoured, not the same multiplier. |
| D6 Weight indent and tile | fixed | removed extra horizontal padding on .qw; 5 tiles fit. |
| D7 Stations pattern columns | fixed | tighter cell padding, wrapping headers, result column narrower: whole table fits 1366; contained scroll with cue below that. |
| D8 empty daily card | fixed | when the 14-day window has no readings, a one-line note names the newest reading instead of an empty chart card. |
| D9 vocabulary and "Not weighed" | fixed | station sheet reasons use "Code 2/1" (and weight rejects keep their own name). Quality-reject rows carry no weight in all 200 checked (reject_event.weight_g null), so the cell reads "No weight on this record" with a one-line explanation. |
| D11 banner date | fixed | a multi-day period always names the date ("10:37 on 7 Sep"). |
| D12 chart labels | fixed | right-axis unit anchored inside the chart; Today reason chart uses the short "Code 2/1". Also fixed (found while checking): the Weight histogram's "In limits" band was drawn across the whole card; now clipped to the plot. |
| D13 heading year | fixed | "1 Sep evening shift - 2 Sep morning shift, 2026". |
| D14 compare delta | fixed | "0.1 points lower (was 0.1 %)" when the current figure rounds to 0.0. |
| D10, D15 | not changed | D10 (station sheet product wording) and D15 (default-period empty tiles) were S3/S4 notes outside this list. |

scrollWidth (worst page of each screen, before to after; viewport width 375 / 1366 / 1920):

| Screen | 375 | 1366 | 1920 |
|---|---|---|---|
| today | 547 to 375 | 1402 to 1366 | 1920 to 1920 |
| compare | 442 to 375 | 1402 to 1366 | 1920 to 1920 |
| wt_cone_time | 1116 to 375 | 1366 to 1366 | 1920 to 1920 |
| wt_cone_dist | 1116 to 375 | 1366 to 1366 | 1920 to 1920 |
| wt_sack_time | 1116 to 375 | 1366 to 1366 | 1920 to 1920 |
| wt_sack_dist | 1116 to 375 | 1366 to 1366 | 1920 to 1920 |
| rejects | 547 to 375 | 1366 to 1366 | 1920 to 1920 |
| stations | 547 to 375 | 1366 to 1366 | 1920 to 1920 |
| sheet_station8 | 547 to 375 | 1366 to 1366 | 1920 to 1920 |
| sheet_reason | 547 to 375 | 1366 to 1366 | 1920 to 1920 |

Not checked: printing, touch, signed-in sessions, Wall on a physical TV.
