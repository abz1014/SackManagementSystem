# Independent data audit of the new app (13 Oct 2026)

Scope: do the figures the redesigned app (`/next`) prints equal what the database says, and do they equal what the old app (`/`) prints?
Method: expected values were derived first, with my own SELECTs on `sms_audit` (READ_ONLY copy), from the canonical tables and the definitions in CLAUDE.md, KPI-DEFINITIONS.md and GLOSSARY.md. No `sms/web-next`, `sms/web` or `sms/api/src/services` source was read to get an expected value. Code was only used afterwards to find routes (URL keys) and the report type ids.
Both apps were then read, as rendered text (Edge via Playwright, `innerText`), from one login-free read-only harness at rank 3 on an ephemeral port. Both were built at HEAD `43434b8` into a scratch directory (`SCR/t7b/{old,next}`); `api/dist` was current (rebuilt 13 Oct 16:44, same as the newest api commit). The server was stopped afterwards. Only GET requests, only `sms_audit`. Port 4000 and 5173 were never touched. No account was created, no write control was clicked.

## Oracle rules used

- Real IFL generations only: cones 9 (Sept) and 1 (July); sacks 10 and 2; inspection rejects 11 and 3; weight rejects 12 and 4. Epochs 13-16 (`DATA_TP1U2_SIM`, "gen 4", 21-Aug-to-29-Sep data) are simulator output and are excluded; epochs 5-8 likewise. Sentinel rows (`production_ts_utc_ms <= 0`, 1969/70 and 21 Jun) excluded.
- Production day = plant clock 06:00 to 06:00; shifts morning 06-14, evening 14-22, night 22-06, taken from `production_ts_utc` by hour.
- Failed weight check (scale) = cones with `in_range = 0`.
- Failed inspection % = inspection (quality-stream) rejects / (cones + inspection rejects with no cone on `(production_ts_utc_ms, hanger_num)`).
- Weight-reject records = rows of the weight-reject stream (`reject_type = 'weight'`).
- Station state = Act above 2x line rate, Watch above 1.5x, OK otherwise, No data at 0 cones, never Watch/Act under 50 cones.

## Periods

| Key | Period | Notes |
|---|---|---|
| PD1 | 2026-09-01 | |
| PL | 2026-08-05 to 2026-09-07 | |
| PR | 1 Sep evening shift to 2 Sep morning shift | |
| PE | 2026-07-20 | **The July generation has no data on 20 Jul** (it ends 10 Jul; 10 Jul to 5 Aug was never sent). PE is therefore an empty period inside the gap. To get a populated July figure I added **PE2 = 2026-07-03** (the day the earlier audit used). |
| EMPTY | 2026-10-13 | |

## Verdict

**PASS WITH ONE DEFECT CLASS (and three small ones).** Every plain count, sum, mean, per-shift figure, per-station count and state, reason count, sack figure and ledger day total printed by the new app equals the SQL value on all periods I could populate (PD1, PL, PR, PE2), and the empty periods print "no data" honestly. The one real mismatch is a **definition leak**: wherever the new app says "Failed inspection" on Today, the Stations tab, the Register's "Inspection fails" list and the Reports, it counts inspection rejects **plus the weight-reject records**. On PD1 and PR there are no weight-reject records, so nothing differs; on PL (41 records) and PE2 (1 record) the count is higher than the inspection-only SQL value, while the Quality > Rejects tab, in the same app, prints the correct inspection-only value. That is an internal inconsistency in the new app, caused by a shared API definition the old app also has (and labels "rejected" or "rejected at inspection").

Nothing here was verified on the plant. See "Not checked" below.

## 3-way table: SQL vs NEW (/next) vs OLD (/)

"=" means identical to the SQL value after the app's own rounding. NEW and OLD were each read from the screens named.

### Counts, kg, sacks (Today / Line, Reports daily, Register, Sacks)

| Figure | Period | SQL | NEW | OLD |
|---|---|---|---|---|
| Cones | PD1 | 3,089 | 3,089 = | 3,089 = |
| | PL | 132,550 | 132,550 = | 132,550 = |
| | PR | 3,098 | 3,098 = | 3,098 = |
| | PE2 | 7,923 | 7,923 = | 7,923 = |
| | PE, EMPTY | 0 | "No data" (dash) | 0 |
| Sacks | PD1 / PL / PR / PE2 | 133 / 5,435 / 128 / 326 | = / = / = / = | = / = / = / = |
| Packed kg | PD1 / PL / PR / PE2 | 6,296.66 / 256,871.24 / 6,028.66 / 15,374.02 | 6,296.7 / 256,871.2 / 6,028.7 / 15,374.0 = | 6,297 / 256,871 / 6,029 / 15,374 = |
| Failed weight check (scale), cones | PD1 / PL / PR / PE2 | 0 / 53 / 1 / 3 | 0 / 53 / 1 / 3 = (Today, Register "Weight-check fails", Stations) | 0 / 53 / 1 / 3 = (Readings headline) |
| Failed weight check (scale), sacks | PD1 / PL / PR / PE2 | 23 / 594 / 18 / 2 | 82.7% / 89.1% / 85.9% / 99.4% pass = (110 of 133 etc.) | same = |
| Cones per shift | PD1 | 1,067 / 1,001 / 1,021 (m/e/n) | = (Reports daily and shift-production) | = |
| | PL | 43,867 / 42,552 / 46,131 | = | = |
| | PR | 1,076 / 1,001 / 1,021 | = | = |
| | PE2 | 2,704 / 2,437 / 2,782 | = | = |
| Sacks per shift | PD1 | 52 / 50 / 31 (2,462.2 / 2,367.8 / 1,466.6 kg; passed 73.1 / 82.0 / 100.0 %) | = | = |
| | PL | 1,698 / 1,800 / 1,937 | = | = |
| Mean cone weight, g | PD1 / PL | 1,954.27 / 1,951.77 | 1,954.3 / 1,951.8 = | 1,954 (rounded) = |
| Spread (SD), g | PD1 | 7.04 | 7.0 = | not decoded |
| | PL | 8.79 (4 implausible excluded: 8.7x) | 8.7 (class 3, see M6) | not decoded |

### Failed inspection and weight-reject records

| Figure | Period | SQL (inspection only) | SQL (inspection + weight records) | NEW Today / Stations / Register list / Reports | NEW Quality > Rejects | OLD |
|---|---|---|---|---|---|---|
| Failed inspection n | PD1 | 451 | 451 | 451 | 451 = | 451 "rejected" |
| | PL | **6,048** | 6,089 | **6,089** | 6,048 = | 6,089 "rejected" (6,048 quality + 41 weight, said in the sentence) |
| | PR | 390 | 390 | 390 | 390 = | 390 |
| | PE2 | **81** | 82 | **82** | 81 = | 82 (81 + 1 said in the sentence) |
| Failed inspection % | PD1 | 14.57 (451/3,095) | same | 14.6 | 14.6 = | 14.6 |
| | PL | **4.559** (6,048/132,665) | 4.590 | **4.6 (line 4.59 on Stations)** | 4.6 (6,048 of 132,665) | 4.6 |
| | PR | 12.56 (390/3,104) | same | 12.6 | 12.6 = | 12.6 |
| | PE2 | 1.02 (81/7,923) | 1.03 | 1.0 | 1.0 | 1.0 |
| Weight-reject records | PD1 / PL / PR / PE2 | 0 / 41 / 0 / 1 | | shown separately on Rejects only | 0 / 41 / 0 / 1 = | folded into "rejected" |
| Unmatched inspection rejects (denominator add-on) | PD1 / PL / PR / PE2 | 6 / 115 / 6 / 0 | | | 3,095 / 132,665 / 3,104 / 7,923 cones checked = | |

Per-station inspection rate on Today and Stations, PL (SQL inspection-only vs what is printed): station 13 5.73 vs **5.8** (425 = 420 + 5 weight), station 6 3.70 vs **3.8**, station 4 3.65 vs **3.7**, station 12 3.04 vs **3.1**, station 11 2.43 vs **2.5**, station 8 14.48 vs 14.5 (874 = 871 + 3), the rest equal. Station states are unchanged (3 Act: 8, 14, 10; no Watch) so no state is wrong in these periods. PD1 station rates all equal SQL (8: 53.86, 9: 23.12, 14: 17.93, 10: 20.60, 13: 3.66, 2: 1.01, 1: 0.87).

### Station state (PD1, line rate 14.57 %, Act above 29.14 %, Watch above 21.86 %)

| Station | Cones | % | SQL state | NEW | OLD |
|---|---|---|---|---|---|
| 8 | 412 | 53.86 | Act | Act = | "quiet" (old uses a different cone-volume vocabulary, not a state) |
| 9 | 357 | 23.12 | Watch | Watch = | |
| 10 | 397 | 20.60 | OK | OK = | |
| 14 | 251 | 17.93 | OK | OK = | |
| 13 | 82 | 3.66 | OK (too few) | OK = | |
| 2 / 1 | 789 / 801 | 1.01 / 0.87 | OK | OK = | |
| 3,4,5,6,7,11,12 | 0 | | No data | No data = | 0 cones |

PL: 8, 14, 10 Act (14.48, 11.68, 11.16 against Act above 9.12); 9 at 5.98 is OK; all equal.

### Top reasons (inspection stream, code pair tube/material)

| Period | SQL top reasons | NEW | OLD |
|---|---|---|---|
| PD1 | 2/1: 440, 1/2: 5, 1/1: 4, 2/2: 1, 10/1: 1 | = (97.6 % = 440/451) | 98 % |
| PL | 2/1 4,240; 1/11 1,036; 10/1 314; 1/1 187; 1/2 115; 9/1 73; 2/2 31; 5/1 23 | = (70.1 %) | 70 % (of 6,089) |
| PR | 2/1 369 of 390 | 94.6 % = | 95 % |
| PE2 | 10/1 52 of 81 | 64.2 % = | 63 % (of 82) |

### Register counts

| List | PD1 / PL / PR / PE2 SQL | NEW | OLD |
|---|---|---|---|
| Cones | 3,089 / 132,550 / 3,098 / 7,923 | = ("Showing 1-100 of 3,089") | "N weighed" headline = |
| Sacks | 133 / 5,435 / 128 / 326 | = | not read (tab click failed, see Not checked) |
| Weight-check fails | 0 / 53 / 1 / 3 | = | headline = |
| Inspection fails | 451 / 6,048 / 390 / 81 | 451 / **6,089** / 390 / **82** (the list includes the weight-reject records, which show "Failed weight check (scale)" in the Check column) | not read |

### Sack stock ledger (receipts per production day)

| Day | SQL (sacks of the real generation per 06:00-06:00 day) | NEW | OLD |
|---|---|---|---|
| 31 Aug | 131 (opening 4,462) | 131 / opening 4,462 = | 131 = |
| 1 Sep | 133 | 133 | 133 |
| 2 Sep | 148 | 148 (closing 4,874) | 148 |
| 3 Jul | 326 (opening 3,107) | 326 / 3,107 = | not read |
| PL first day 5 Aug | 146 (evening+night only, data starts 18:59) | 146, opening 0 = | |

### Product per winder, PD1 (last MaterialId stamped in the period)

| Winder | SQL | NEW Products > Board (period 1 Sep) | OLD Line "What is being made" |
|---|---|---|---|
| 1, 2 | 20 | shows the product as at 7 Sep: Star Green (=20) | as at 7 Sep |
| 8, 9, 10 | 21 | shown Idle with "last product it stamped" Blue (last cone 6 Sep for 8, 5 Sep for 9 and 10); PD1 cone counts 412 / 357 / 397 shown | "Not seen since Sun 6 Sept / Sat 5 Sept" |
| 13, 14 | 1022 | station 13 shown as Star Green since 7 Sep 10:37 (SQL: material 20 from 7 Sep 10:37, correct as at that date, but it is 1022 throughout PD1) | station 13 same as NEW; 14 "Not seen since Thu 3 Sept" |

The Board answers "what is each winder running as at the newest reading (7 Sep 12:00)", which it states ("Shown as at 7 Sep, 12:00"). It does not answer "what did each winder run in PD1". Every date and product it does print checked out against SQL (station 13 first cone of material 20 at 10:37 on 7 Sep, station 4 first cone of 21 at 11:33 on 6 Sep, station 3 last cone 31 Aug 08:24, "4 other stations also changed product"). Class 3 (see M4).

### Management summary (API, same for both apps; the UI renders it)

| Figure | PD1 SQL | printed | prior (31 Aug) SQL | printed prior |
|---|---|---|---|---|
| Cones | 3,089 | 3,089 | 3,191 | 3,191 (delta -102, -3.2 %) = |
| Failed by scale | 0 | 0 | 4 | 4 = |
| Rejected at inspection | 451 | 451 | 430 inspection + 2 weight = 432 | **432** (inspection-only SQL 430) |
| Inspection reject rate | 14.57 | 14.57 | 13.45 (inspection only), 13.51 (combined) | **13.51** |
| Sacks / kg | 133 / 6,296.7 | = | 131 / 6,190.7 | = |

PL correctly refuses a comparison ("Prior period covers 9 of 34 days ... no change is stated"), PR and PE2 compare. Current-period figures all equal SQL.

### Four report types (JSON + CSV via GET, and rendered in both apps)

| Report | PD1 | PL | PR | PE2 |
|---|---|---|---|---|
| Daily production (totals) | 3,089 / 133 / 6,296.7 / insp 451 = | 132,550 / 5,435 / 256,871.2 / insp **6,089** (SQL 6,048) / scale 53 = | 3,098 / 128 / 6,028.7 / 390 / 1 = | 7,923 / 326 / 15,374 / insp **82** (SQL 81) / 3 = |
| Shift-wise CTS Loop Production (shift-production): weighed / pass / weight rejects | 3,089 / 3,089 / 0 = | 132,550 / 132,509 / 41 = (per shift 18/16/7 = SQL) | 3,098 / 3,098 / 0 = | 7,923 / 7,922 / 1 = |
| Rejected sacks: sacks / rejected | 133 / 23 = (shifts 14/9/0 = SQL) | 5,435 / 594 = | 128 / 18 = | 326 / 2 = |
| Sack weight summary: sacks / kg / avg / SD | 133 / 6,296.66 / 47.34 / 0.08 = | 5,435 / ... = | 128 / 6,028.66 = | 326 / 15,374.02 / 47.16 = |

NEW and OLD render the same API payload; their report bodies are character-identical in the parts I diffed (shift-production PD1, daily PL). CSV GET for all four types returned 200 and its totals equal the JSON. Daily "rejected_at_inspection" in the CSV is the combined figure (see M1/M2).

## Mismatch list and classification

**(1) NEW differs from SQL (defect in the new app)**

- **M1. "Failed inspection" counts weight-reject records.** Today tile and station rows, Quality > Stations (line rate 4.59 % and per-station), Register "Inspection fails" (6,089 rows, weight-reject rows labelled "Failed weight check (scale)" inside it), Reports daily (and its CSV column `rejected_at_inspection`), management-summary prior. PL 6,089 vs 6,048 (+41), PE2 82 vs 81 (+1); per-station rates off by up to 0.1 point. The new Quality > Rejects tab prints 6,048, then says "Together 6,089 ... the same rate Today and Reports use", so the app contradicts itself on the same label. The GLOSSARY defines Failed inspection as the inspection check only and weight-reject records as a separate fact. Cause is shared with the old API definition; the new app relabelled "rejected" as "Failed inspection" without separating. Effect on states: none in these periods (states equal); effect on rate: 4.59 vs 4.56 on PL. Needs owner decision, either relabel the combined figure or separate it on Today, Stations, Register, Reports.
- **M3. Wrong sentence on Rejects.** PD1, PR and PL all show "This period includes the 5 Aug 2026 database rebuild; the figures above are for one data set." PD1 (1 Sep) and PR do not include 5 Aug. The cause is 7,470 simulator readings (epoch 13/14/15, from the plant simulator) sitting in the period, which the old and other new screens describe correctly as "a different data batch", and the Register describes as "another data set". Text defect only; figures right.
- **M9. Grammar:** "1 cones failed the weight check (scale)" (PR Register). Cosmetic.

**(2) OLD differs from SQL (pre-existing, reported)**

- **M2.** Old Daily report and CSV "Rejected at inspection" = inspection + weight records (PL 6,089, shifts 2,032/1,986/2,071 vs SQL inspection-only 2,014/1,970/2,064 + weight 18/16/7); old Rejects headline "rejected" combined, with the split stated in the sentence. Old Line "rejected 6,089" (PL), "82" (PE2). The old labels are honest only for the Rejects headline; the report column name is wrong.
- **M5a. Ledger note contradicts its rows (both apps).** On PR (shift range) the note says the ledger "covers every shift of each day the period touches, so its figures are larger", but the 2 Sep row shows 47 receipts (only the morning shift), closing 4,773. The full day would be 148 (closing 4,874). Same in OLD.
- **M5b. Ledger opening ignores the real-only rule in empty or simulator periods (both apps).** Opening for 13 Oct is **23,031 sacks** = 5,462 (July) + 5,435 (Sept) + 12,134 simulator sacks (epoch 14); for 8 Sep it is 6,199 (simulator only). For all four real periods the opening equals the real generation alone (4,462, 3,107, 0 on PL). Identical in OLD ("23,031 sacks in stock before this period").

**(3) Definitional / explained differences (not defects)**

- **M4.** Products > Board and Old Line "What is being made" are "as at the newest reading (7 Sep 12:00)", not the selected period, and say so. The task's "product per winder in PD1" is not displayed anywhere as such; the SQL answer is: winders 1, 2 = 20; 8, 9, 10 = 21; 13, 14 = 1022. The Today line "Station 13 changed product to ... first cone at 10:37 on 7 Sep" is correct but outside PD1, shown on a PD1 view.
- **M6.** Plausibility exclusion (4 readings: 939 g, 1,419 g, 2,360 g, 2,953 g in PL): shift-production "Weighed (kg)" 258,698.9 vs raw sum 258,706.6 (-7.67 kg = those 4); Weight SD 8.7 vs raw 9.2; station 2 mean-vs-target -9.0 (raw -9.1). The report states "4 implausible excluded". Counts still include them (132,550).
- **M7.** Weight tab "Within product tolerance 100.0 %, 1,920 g to 2,000 g, 132,497 cones judged" prints the default product's plus-or-minus 40 g band. Judged against that band 37 of the 132,497 scale-passed cones are outside (99.97 %, printed 100.0 %). Judged against each cone's own product limits (plus or minus 50) 0 are outside, which is what Today's "Outside product limits (scale passed): 0" and the Board use. Label and basis differ; the rounded percent hides it.
- **M8.** Empty periods: NEW prints "No data" (dash) where OLD prints 0. PE (inside the July gap) says "Nothing has been recorded in this period"; EMPTY says "no readings, the newest reading is 7 Sep 2026, 12:00". Both correct.
- Old Rejects top-reason percentage uses the combined denominator (63 % on PE2, 70 % PL = same), new uses inspection only (64.2 %). Follows from M1/M2.

## Not checked

- Nothing on the plant; only the dev copy `sms_audit` (data to 7 Sep).
- OLD Readings tabs "Sacks", "Rejected cones", "Rejected by inspection": my tab clicks did not take (the page stayed on Cones), so the old lists' counts were not read beyond the Cones headline. NEW Register lists were read in full for all periods.
- OLD Weight per-station table columns (average / median / SD / vs target / trend): printed but not decoded against SQL beyond the mean for a few stations; NEW per-station mean-vs-target was checked against SQL for PD1 (all 7 stations) and a sample for PL.
- Charts (cones-per-shift/day, p-chart, histogram, control limits, Pareto cumulative line): shape and series not recomputed, only the sentences and table values. TV wall, Setup, Diagnostics, Catalogue, Limits, Changeover, hanger / lifter / SPS packing / sack weight range / rejected-cone reports, "Needs attention", drift and Nelson-rule findings: not verified.
- Management summary was read from the API payload, not from the rendered one-page layout. Prior-period figures other than PD1's were not recomputed (only that they are consistent with the same method).
- Exports: one CSV per report type, GET only, totals compared. XLSX and PDF were not generated or opened; no person opened a file or a printed page.
- PR station-level and per-reason figures beyond the totals and top reason; PE2 station rows.
- Only rank 3 (a render token); ranks 1, 2, 4 not exercised.
- Timing: the "current period" views are anchored to the plant clock the app reports; I always passed explicit dates, so the default (This shift / Today) landing numbers were not audited.
- The 10 Jul to 5 Aug data was never delivered by IFL, so no July/August figure across that gap could be audited.

Scratch files: `SCR/t7b/txt`, `txt2` (page text), `rep` (report JSON and CSV), `SCR/da` (nothing kept besides `C:/tmp/da.sh` query helper, not part of the repo).
