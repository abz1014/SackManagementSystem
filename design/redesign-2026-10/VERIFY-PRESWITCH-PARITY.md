# Pre-switch parity and data re-audit (15 Oct 2026)

Scope: the new app (`/next`, sms/web-next) against the old app (`/`) and against independent SQL, at code HEAD `e5f853a` (HEAD is `99795d1` at commit time; the only later commit is a docs file). Read-only. Nothing here was verified on the plant.

## Method

- Expected values came first, from my own SELECTs on `sms_audit` (READ_ONLY copy, `sqlcmd -E`), using the definitions in CLAUDE.md / KPI-DEFINITIONS.md / GLOSSARY.md. Real generations only (cones 9 and 1, sacks 10 and 2, inspection rejects 11 and 3, weight rejects 12 and 4); simulator epochs (13 to 16) and sentinel rows excluded. Production day 06:00 to 06:00, shifts 06/14/22 from `production_ts_utc`. Station rule: Act above 2x the line rate, Watch above 1.5x, No data at 0 cones, never Watch/Act under 50 cones. Per-station target = latest `product_limit_version` of the station's single material at period end.
- Both apps were then read as rendered text (Edge via Playwright) from the login-free harness (rank 3 and 4 render tokens, ephemeral loopback ports, `sms_audit` only). Both UIs were built to scratch (`S/preswitch-parity/next` and `/old`); `api/dist` was current (built 15 Oct 12:35, newer than the last `api/src` commit at 12:07). Only GETs (every non-GET aborted in the page, none fired). Port 4000, the simulator and the sync worker were not touched; no account was created; no write control clicked. Both harness servers were stopped afterwards.
- Periods: PD1 1 Sep; PL 5 Aug to 7 Sep; PR 1 Sep evening shift to 2 Sep morning shift; PE2 3 Jul (July generation); SH single shift (1 Sep evening); EMPTY 13 Oct.
- Reused scripts from the earlier audits (`fullcheck`, `fw-t6`, `t7b`); results and scripts live in the session scratchpad `preswitch-parity/` (not in the repo).

## Verdict

**The new app matches or is more correct than the old app on every figure compared, and equals SQL on every count, sum, mean, rate, state and per-station figure checked.** No wrong number was found in the new app. Four wording/label defects and no figure defects are listed below (none changes a number; all are S3/S4). Earlier mismatches M1 to M9 are all closed or explained (table at the end).

Counts of what was compared:

| What | Count | Result |
|---|---|---|
| Pages captured in the new app | 214 (6 periods x [Today, 4 Quality tabs, 5 Register lists, 5 Products tabs, report landing, 18 report types] + Diagnostics, Setup, Account, 7 record sheets) | 0 console errors, 0 failed requests, 0 non-GET |
| Pages captured in the old app | 168 text captures + 9 screens | 0 console errors, 0 failed requests |
| Station figures vs SQL (state, cones, failed %, failed n, scale %, vs target, on Stations tab and Today cards, 5 periods x up to 14 stations) | 382 | 382 equal |
| Headline figures 3-way (SQL / new / old): cones, sacks, kg, combined failed n and %, scale n and %, inspection-only n, %, denominator, weight-reject records, top reason, mean, SD, outside-limits, Register list sizes, 6 periods | about 190 | all equal after the app's own rounding (differences listed below) |
| Register rows old vs new by record id (cones, sacks, weight-check fails, inspection fails; 6 periods) | 1,489 | 1 difference (explained, section D) |
| Stock ledger old vs new, 6 periods | 6 | identical |
| 18 report types x 6 periods, numeric tokens | 108 pairs, 62,758 old tokens | 100 not found in new, all explained (58 comma formatting of one note count, 21 empty-period zeros/dashes, 21 chart axis ticks) |
| Export links old vs new (18 types x PD1, PL, PR, SH) | 72 link sets | 72 identical |
| CSV byte compare old vs new (18 types x PL and PR, minus generated-at lines) | 36 | 36 identical |
| CSV and XLSX GET at rank 3 (PD1) | 37 | 37 returned 200 (19 CSV, 18 XLSX); 18 PDF links not fetched (server PDF route cannot launch Edge on this host) |
| Report CSV totals vs SQL (daily, shift-production, sack-weight-summary, rejected-sacks at PD1, PL, PR, SH, PE2, EMPTY) | about 45 figures | all equal |
| Record and reason sheets vs SQL (station sheets x12, reason sheets x6, cone, sack, reject, stock) | 22 | figures equal (date label issue in section C) |
| Products Board (14 stations: product, since, last cone, cones in period) vs SQL | 14 | equal |

## A. Three-way table (SQL vs new vs old)

"=" means identical to SQL after the app's own rounding.

| Figure | Period | SQL | New | Old |
|---|---|---|---|---|
| Cones | PD1 / PL / PR / SH / PE2 / EMPTY | 3,089 / 132,550 / 3,098 / 1,001 / 7,923 / 0 | = (EMPTY prints a dash and "No data") | = (EMPTY prints 0) |
| Sacks | same | 133 / 5,435 / 128 / 50 / 326 / 0 | = | = |
| Packed kg | PD1 / PL / PR / SH / PE2 | 6,296.66 / 256,871.24 / 6,028.66 / 2,367.84 / 15,374.02 | 6,296.7 / 256,871.2 / 6,028.7 / 2,367.8 / 15,374.0 | 6,297 / 256,871 / 6,029 / 2,368 / 15,374 |
| Failed inspection or weight check (inspection + weight-reject records), n | PD1 / PL / PR / SH / PE2 | 451 / 6,089 / 390 / 165 / 82 | = (Today, Stations, Register tab "Inspection or weight-check fails") | = (old "rejected") |
| ... %, over cones + unmatched rejects | PD1 / PL / PR / SH / PE2 | 14.57 / 4.59 / 12.56 / 16.47 / 1.03 | 14.6 / 4.6 / 12.6 / 16.5 / 1.0 (Stations line rate 14.57 / 4.59 / 12.56 / 16.47 / 1.03) | same |
| Failed inspection only (Quality > Rejects), n of denominator | PD1 / PL / PR / SH / PE2 | 451 of 3,095 / 6,048 of 132,665 / 390 of 3,104 / 165 of 1,002 / 81 of 7,923 | = | not split (old headline is the combined figure and says "6048 for quality, 41 for weight") |
| Weight-reject records | PD1 / PL / PR / SH / PE2 | 0 / 41 / 0 / 0 / 1 | = (0 / 41 / 0 / 0 / 1) | folded into old "rejected" |
| Failed weight check (scale), cones | PD1 / PL / PR / SH / PE2 | 0 / 53 / 1 / 0 / 3 | = (Today, Register list, Weight tab) | = (Readings headline "53 rejected by the scale") |
| Failed weight check (scale), sacks | PD1 / PL / PR / SH / PE2 | 23 / 594 / 18 / 9 / 2 | = (reports) | = |
| Top reason (Code 2/1; PE2 10/1) | PD1 / PL / PR / SH / PE2 | 440 of 451 (97.6 %) / 4,240 of 6,048 (70.1 %) / 369 of 390 (94.6 %) / 161 of 165 (97.6 %) / 52 of 81 (64.2 %) | = | 98 % / 70 % / 95 % / n.a. / 63 % (old divides by the combined count) |
| Mean cone weight, g | PD1 / PL / PR / SH / PE2 | 1,954.27 / 1,951.77 / 1,953.63 / 1,954.43 / 1,948.07 raw (1,948.21 after the plausibility rule, one 824 g reading) | 1,954.3 / 1,951.8 / 1,953.6 / 1,954.4 / 1,948.2 | 1,954 / 1,952 / 1,954 / n.a. / 1,948 |
| Cones judged within own product limits | PD1 / PL / PR | 3,089 / 132,497 / 3,097 (cones less scale fails) | = ("Own product limits · N cones judged") | not equivalent (old judges by the line default product) |
| Cones per shift m / e / n | PD1 / PL / PR / PE2 | 1,067/1,001/1,021; 43,867/42,552/46,131; 1,076/1,001/1,021; 2,704/2,437/2,782 | = (Reports daily and shift-production) | = |
| Sacks per shift m / e / n, kg | PD1 / PL | 52/50/31 (2,462.2/2,367.8/1,466.6); 1,698/1,800/1,937 (80,206.6/85,136.9/91,527.8) | = | = |
| Weight-reject records per shift (shift-production) | PL | 18 / 16 / 7 | = | = |
| Sack ledger (receipts per production day) | 31 Aug, 1 Sep, 2 Sep, 3 Jul | 131, 133, 148 (opening 4,462 on 31 Aug, 4,593 on 1 Sep), 326 (opening 3,107) | = | = |
| Register list sizes (cones / sacks / weight-check fails / inspection-or-weight fails) | PD1 | 3,089 / 133 / 0 / 451 | = | headline = |
| | PL | 132,550 / 5,435 / 53 / 6,089 | = | = |
| | PR | 3,098 / 128 / 1 / 390 | = | = |
| | SH | 1,001 / 50 / 0 / 165 | = | = |
| | PE2 | 7,923 / 326 / 3 / 82 | = | = |

Station states (rule above, every period): PD1 8 Act (53.86 %), 9 Watch (23.12 %), others OK or No data; PL 8, 14, 10 Act (14.48 / 11.68 / 11.16 %), none Watch; PR 8 Act (40.76 %), 14 Watch (20.33 %); SH 8 Act (64.34 %), 9 Watch (26.67 %); PE2 (line 1.03 %) 8 and 6 Act (2.69 / 2.61 %), none Watch. All equal the page. A station with fewer than 50 cones never reaches Watch or Act (PR station 7: 60 cones 11.67 % OK; PD1 and SH station 13: 82 and 7 cones OK).

Station "mean vs target" (own product's target, shift or day as selected) equals SQL on every single-product station: PD1 -4.7 / -7.0 / -3.6 / -5.4 / -7.8 / -7.3 / -5.3 (stations 1, 2, 8, 9, 10, 13, 14); SH 8 -2.1, 9 -4.6 (page; SQL -4.63), 10 -7.3, 14 -4.9, 1 -5.6, 2 -6.9, 13 -12.6; PR 8 -5.0, 14 -5.3, 13 -12.6, 2 -8.1, 7 -10.5. PL single-product stations 1, 2, 8, 9, 10 equal; the other nine PL stations ran two or three products and carry no number (correct, see defect D1 for their wording).

## B. Intended changes re-verified against SQL

| Change | Evidence now |
|---|---|
| Scale count 53, not 49 (`c9d6ffc`, `d540035`) | SQL 53 cones with `in_range = 0` over PL (22 evening / 23 morning / 8 night). New Today "53 of 132,550", Register "Weight-check fails" 1-53 of 53, Weight tab; old Readings also 53. "Cones judged" 132,497 = 132,550 - 53. Equal. |
| Station per-product target and label (`bfde0b2`, `20b90f5`) | Board, Today cards and Stations rows name the station's own distinct product (for example "205-IL0-SD · Blue"); material 21 = Blue, 20 = Star Green, 1021 = ORANGE 30, 1022 = PVSD8020 50, 1023 = ORANGE 20 Slub, 1024 = YELLOW 36 Slub, equal to SQL for all 14 stations. |
| Station vs target follows the shift (`e235f3c`) | SH and PR figures above equal SQL means (shift only) minus the product target; they differ from the PD1 values (for example station 8: SH -2.1, PR -5.0, PD1 -3.6). |
| Reason sheet scope follows the shift (`45f23a8`) | Code 2/1 sheet: SH "161 cones ... limited to 1 Sep, evening shift" (SQL 161); PR day 1 Sep 273 of 2,022 cones and 2 Sep 96 of 1,076 (SQL 273 and 96, total 369); PD1 440; day 2 Sep 127; PL day-by-day list starts 5 Aug 72 of 2,914 (SQL 72). Equal. |
| Weight per-product target (`32f1c68`) | Weight tab prints "Each station is judged against its own product's limits" with "Own product limits" and N cones judged; the old screen compares to the line default (retired product 201-IH0-SD, plus or minus 40) and says "All 13 stations read 1-10 g below the 1,960 g target" (8 stations ran in PR). New is the more correct basis. |
| M1 label | Combined figure is "Failed inspection or weight check" (6,089 on PL) on Today, Stations, Register tab and the sheets; Quality > Rejects keeps "Failed inspection" 6,048. SQL: 6,048 + 41 = 6,089. Consistent. |
| M3 | The "this period includes the 5 Aug rebuild" sentence is gone from Rejects on every period (grep over all captures: 0). See D2 for a sibling sentence. |
| M7 | Weight tab says "Own product limits". See D3 for the station sheet. |
| M9 / `e5f853a` | "1 cone failed the weight check (scale)" (PR Register), "1 record", "1 cone" read correctly; no "1 cones" in any new capture. Leftover "1 days / 1 readings / 1 products" remain only inside the restyled legacy report bodies (D4). |

## C. Differences, classified

(1) Intended change from the redesign (all re-verified above): scale count 53 (not 49) on Today; per-product target and label per station; vs-target and reason sheet follow the shift; Weight "own product limits"; combined figure labelled "Failed inspection or weight check"; empty periods print a dash and "No data" where old printed 0 (M8); percentages on Rejects use the inspection-only count and denominator (64.2 % vs old 63 % on PE2); Diagnostics keeps every figure of old Health that is not a collapsed block (15 d 15 h, 2 blocking findings, newest reading) and adds backup and disk figures.

(2) Defects in the new app (none changes a number):

- **D1 (S3, wording, Quality > Stations).** For stations that ran several products in the period, the "Mean weight vs target" cell is decided from the 14-day pattern data (`/api/weight-stations?trailingDays=14`), not the selected period. PL result: stations 3, 6, 7, 14 print "No product target" although each ran 2 products in the period (the footnote under the table says marked stations "ran more than one product"); station 13 prints "2 products" although it ran 3 (20, 21, 1022; API `station-status` says `mixed`, 3). The number is correctly withheld in every case; only the wording is wrong. Cause: `targetOf()` in `web-next/src/screens/Quality/Stations/model.ts` reads `ws.targetBasis` / `materialsInWindow` from the 14-day response while `StationStatusRow` already carries `productBasis: 'mixed'` and `materialsInPeriod` for the period. Fix: use the station-status fields.
- **D2 (S3, wording, dev copy only).** "N readings from before the 5 Aug 2026 IFL database rebuild are not counted." (Weight tab, every report page, Today where present) is false on this copy: the excluded readings are plant-simulator readings (epoch 13), for example 7,470 cones dated 1 Sep (SQL) on PD1, 135,248 on PL, 14,764 on PR. The old app and the CSV note call them "a different data batch" / "all from the plant simulator". Same class as audit M3, fixed on Rejects only. Cannot occur at IFL where there is no simulator, except for periods that really straddle 5 Aug.
- **D3 (S4, basis mix, Station sheet).** The sheet's "Cone weight by day" chart draws the line default band 1,920 to 2,000 g (retired product 201-IH0-SD, plus or minus 40) and says "product tolerance in force for the line", while the figure above it ("-2.1 g vs product target") uses the station's own product (plus or minus 50, 1,910 to 2,010). Residual of M7. Figures are not affected.
- **D4 (S4, grammar, legacy report bodies).** "1 days" (Reject report, Shift report, "1 of 1 days there hold readings" in the management summary), "1 readings" (rejected-cones), "1 products" (machine-product). These bodies are the old renderers (known limit); the old app prints the same strings.
- Minor, not new: Station sheet reads "192 of 468 cones" with 40.8 % (PR station 8): the rate's denominator is 468 cones plus 3 inspection rejects with no cone record (192 / 471 = 40.8 %). The line-level sentence on Rejects states its denominator ("of 3,104 cones checked"); the sheet does not.
- Minor: Weight tab with no readings (EMPTY) prints the line default target "1,960 g, 201-IH0-SD (retired in PDAS)" while the same tab with data says no single target applies. Labelled honestly as retired.
- Minor: the Register "Inspection or weight-check fails" row for a weight-reject record shows no weight (old showed "2,032 g" on PE2); the same cone with its weight is in the "Weight-check fails" list.

(3) Pre-existing in the old app, unchanged by the redesign:

- **Night-shift date label** (S3). Record sheets (cone, sack, reject) print the production day with the clock time: cone 953809 is "Weighed 1 Sep 2026, 05:54:56" but SQL says 2 Sep 05:54:56 (night shift of production day 1 Sep); sack 37487 "1 Sep 2026, 03:01:32" is 2 Sep 03:01:32. Affects readings from 00:00 to 05:59 (about a quarter of all records). Old `ReadingSheet.tsx` uses the same `shift_date` + clock. The Register column is correctly headed "Production day" and the sheet also prints "Production day 2026-09-01". Recommend printing the calendar date.
- **Ledger note on a shift range** (audit M5a): for PR the note says the ledger covers every shift of each day the period touches, but the 2 Sep row shows 47 receipts (morning only, the full day is 148). Identical in old and new.
- **Ledger opening on empty or simulator-only periods** (M5b): EMPTY (13 Oct) opens at 23,031 sacks = 5,462 July + 5,435 September + 12,134 simulator sacks. Identical in old and new. Real periods open correctly (4,462 on 31 Aug, 4,593 on 1 Sep, 3,107 on 3 Jul).
- Old "rejected" and report column name "Rejected at inspection" for the combined figure (M2): still printed by the restyled legacy report bodies and by CSV headers (`rejected_at_inspection`: PL 6,089, shifts 2,032 / 1,986 / 2,071 = inspection + weight records), owner-reserved.
- Plausibility exclusion (M6): 4 implausible readings on PL and one 824 g reading on PE2 stay in counts and are excluded from means and SD (stated on the pages).
- Old Weight compares every station to the retired line default product (see B).
- "N readings in a different data batch": old Line counts cones + sacks + rejects (PL 144,538; PR 15,767), new Weight and reports count cones only (135,248; 14,764). Different definitions, both exclude the simulator.
- New Diagnostics omits the old Health sentence "435,470 readings on record belong to a different batch" (design choice; every other old Health figure is present once the collapsed blocks are opened).

## D. Register and token differences, in full

- Register: 1,489 rows compared by record id across 24 lists; the only difference is the PE2 weight-reject record 27492 (new row has no weight column value; see minor item above).
- Report tokens: 100 old numeric tokens not found in the new text of 62,758: 58 are the one note "Excluded from another data batch: 7470 readings" printed without a thousands separator by old and as "7,470 readings from before the rebuild" by new (D2), 21 are empty-period zeros and "0," cells that new prints as dashes, 21 are chart axis tick labels (cone-weight PL 8 and PE2 6, sack PR 4 and PE2 4, plus one on each of the two cone-weight pairs). No data figure is missing.

## E. Earlier mismatch list M1 to M9

| ID | Then | Now |
|---|---|---|
| M1 | "Failed inspection" counted weight-reject records | Relabelled "Failed inspection or weight check" on Today, Stations, Register tab, sheets; Rejects keeps inspection-only 6,048. Equal to SQL. Closed (owner decision 14 Oct). Legacy report bodies and CSV headers still say "Rejected at inspection" (reserved). |
| M2 | Old report column name | Unchanged, pre-existing, reserved. |
| M3 | Wrong "5 Aug rebuild" sentence on Rejects | Fixed on Rejects. Sibling sentence "from before the 5 Aug rebuild" for simulator readings on Weight and Reports remains (D2). |
| M4 | Board is "as at the newest reading", not the period | Unchanged and stated on screen ("Shown as at 7 Sep, 12:00"); every product, time and count checked equals SQL. Not a defect. |
| M5a / M5b | Ledger note and empty-period opening | Unchanged, identical in old and new (pre-existing). |
| M6 | Plausibility exclusion | Unchanged, stated on the pages. |
| M7 | Per-product tolerance shown as line-wide band | Fixed on the Weight tab; residual on the station sheet chart (D3). |
| M8 | Empty period dash vs 0 | Intended; EMPTY prints "No data" / "Nothing has been recorded in this period" and all 18 report types say so or name the newest reading. |
| M9 | "1 cones" | Fixed ("1 cone", "1 record" in the new screens); legacy report bodies keep "1 days / 1 readings / 1 products" (D4). |

## Not checked

- The plant or IFL's server; data after 7 Sep (the copy ends 7 Sep 12:00; 10 Jul to 5 Aug never sent); live running data (Wall running state, Today "line running" verdict); ranks 1, 2 and 4 for data (Diagnostics and Setup were only read at rank 3 and 4 as text); a real printer; PDF export (links present, not fetched), XLSX content (status 200 only); no person opened a file.
- Charts' series (shapes, control limits, histogram, Pareto line) were not recomputed, only their sentences and table values; the TV wall, Setup, Catalogue, Limits and Changeover figures were outside this check; hangers, lifter and SPS-packing report bodies were compared old against new only, not against SQL.
- Management-summary prior-period figures were compared old against new only (same API), the current-period figures against SQL for PD1.
- Old Weight per-station table columns (median, SD, trend) were not decoded against SQL.
- Shift-bounded PDF export.

## Reproduce

Scripts: `preswitch-parity/` in the session scratchpad (`serve.mjs`, `walk.mjs`, `oldcap.mjs`, `compare.mjs`, `stcmp.mjs`, `expcmp.mjs`, `sheets.mjs`, `sqlst.sh`, `ex.mjs`). The SQL helper is `P` in `C:/tmp/da.sh`.
