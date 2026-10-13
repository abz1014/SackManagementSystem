# PARITY - old UI vs web-next, filled by V2b (13 Oct 2026, HEAD f65b4ab)

Filled from `PARITY-TEMPLATE.md`. Method: both UIs built to scratch from HEAD (old at `/`, web-next at `/next/`), served by the login-free read-only harness (api/dist, DB `sms_audit` READ_ONLY, render-token identity at rank 1, 2, 3 and 4, ephemeral ports), real Edge via Playwright at 1366x768 (375x812 for one phone check), non-GET API calls aborted in the browser. Compared DOM text old vs new. No account created, nothing written, :4000 and :5173 untouched.

Periods: **PD1** 1 Sep 2026; **PL** 2026-08-05..2026-09-07; **PR** 1 Sep evening .. 2 Sep morning. Evidence: scratchpad `v2b/shots/` (text per page: `A` register, `B` sheets, `C` products, `D` system, `R` reports, `W` wave 1).

Legend: `=` identical to the old figure to the digit; `ok` Y/N/n.a.

## 1. Screen parity

| id | old URL -> new URL | compare | old (PD1 / PL / PR) | new | ok | note |
|---|---|---|---|---|---|---|
| S01 | `?s=line` -> `?s=today` | Cones | 3,089 / 132,550 / 3,098 | = | Y | |
| S02 | same | Sacks | 133 / 5,435 / 128 | = | Y | |
| S03 | same | Sack kg | 6,297 / 256,871 / 6,029 | 6,296.7 / 256,871.2 / 6,028.7 | Y | new shows 0.1 kg |
| S04 | same | Failed inspection n | 451 / 6,089 / 390 | = | Y | |
| S05 | same | Failed inspection % | 14.6 / 4.6 / 12.6 | = | Y | |
| S06 | same | Failed weight check (scale) n | 0 / 53 / 1 | 0 of 3,089 / 53 of 132,550 / 1 of 3,098 | Y | reads `conesFailedScale`; PL 53 confirmed (wave 1 had 49) |
| S07 | same | Average cone g | 1,954 / 1,952 / 1,954 | = | Y | |
| S08 | same | Target g | 1,960 | = | Y | target shown as product 201-IH0-SD "retired in PDAS" (same as old) |
| S09 | same | Cone SD g | 7.0 / 8.7 / 7.0 | = (Weight tab "Spread 7.0 g", "8.7 g") | Y | |
| S10-S12 | same | Per-shift cones / sacks / kg | PD1 1067,1001,1021 / 52,50,31 / 2462.2,2367.8,1466.6; PL sacks 1698,1800,1937 kg 80206.6,85136.9,91527.8; PR sacks 47,50,31 | = (read through "Show as table") | Y | PL per-shift cone counts are chart-only, not re-read |
| S13 | same | Station grid 14 rows | cones and failed % per station | = (V1 plus Board/Today 412, 357, 397, 251, 82, 789, 801 on PD1) | Y | |
| S14 | same | Sacks section avg kg / passed % / cones per sack | 47.34 / 82.7 % / 23.2 (PD1) | 47.4 / 82.7 % / 23.2 | Y | avg kg shown to 0.1 |
| S15 | `?s=wall` -> `?s=today&wall=1` | Wall | | renders (wave 1 V1); **no button or link leads to it** | N | defect P2 |
| S16 | `?s=readings` -> `?s=quality&t=register` | Cones count and first page | 3,089 / 132,550 / 3,098 | "Showing 1-100 of N", N =; 100 rows each, record id, weight, product equal | Y | 300 rows compared, 0 mismatches |
| S17 | `rl=sacks` | Sacks | 133 / 5,435 / 128 | = ; 300 rows equal | Y | |
| S18 | `rl=inspectionRejects` | Inspection fails | 451 / 6,089 / 390 | = ; 300 rows equal incl. product | Y | |
| S19 | `rl=rejected` | Weight-check fails | 0 / 53 / 1 | = ; 54 rows equal | Y | |
| S20 | `rf=outsideLimits` | outside-limits count | | hop present on Today; not separately counted | n.a. | |
| S21 | `?s=sacks&sheet=stock:DAY` -> `rl=stock` | Stock ledger days and closing | PD1 1 day 4,593 -> 4,726; PL 34 days 0 -> 5,435; PR 2 days 4,593 -> 4,773 | rows identical (opening/receipts/issues/consumption/adjustments/closing) | Y | |
| S21b | sheets cone / sack / reject / stock day | one record each | cone 970510 (1,943 g, limits 1,960 +-50, station 4, source 132550), cone 954380 (1,880 g), sack 38196, reject 27325, stock 2026-09-01 | same values | Y | label case: "Morning" -> "morning" (S4) |
| S22-S27 | `?s=weight` -> `?s=quality&t=weight / t=stations` | headline, stations, station sheet | wave-1 figures | = (re-confirmed: mean 1,954 / 1,952 / 1,954, top reason 97.6 / 70.1 / 94.6 %) | Y | wave 1 only re-checked at headline level |
| S28-S29 | `?s=rejects` | failed inspection, top reason | 14.6 %, Code 2/1 440 | = ; `jc` filter keeps (value format is `2-1`) | Y | template `2/1` was wrong |
| S30 | `?s=product` (Running) + Line matrix -> `?s=products&t=board` | product per station, since, cones | St 1,2,13 Star Green; 4,5,6 Blue; 11 Orange 20 Slub; 12 Yellow 36 Slub; 6 idle with last product and last cone time | same products and times (St 3 Orange 31 Aug 08:24; 7 Blue 7 Sep 03:47; 8 6 Sep 03:22; 9 5 Sep 13:13; 10 5 Sep 03:33; 14 CIR_RED 3 Sep 13:55) | Y | **P1: card label drops blend, count and tube**, so Orange 30 (St 3) and Orange 20 Slub (St 11) read the same. "Cones in period" = the period's cones per station (7 stations on PD1; matches `/api/production?groupBy=station`) |
| S31 | `pt=changeover` -> `t=changeover` | refs, disabled reason | blends 11, counts 15, tubes 27, 14 products | same lists; "Writing to PDAS was switched off in this system's settings." shown verbatim | Y | Execute not clicked |
| S32 | `pt=catalogue` -> `t=catalogue` | rows | 14 products (6 active, 8 retired), 15 pallets | 6 active, 8 retired, 15 pallets, same ids, limits +-50/40/30 | Y | write buttons present from rank 2 |
| S33-S34 | `pt=history`, Catalogue limits -> `t=limits` (Limits & History) | limit versions, product timeline, change trail | timeline 25 rows; 3 trail rows (all not sent) | 25 timeline rows; 3 trail rows; limit versions per product | Y | `t=history` shows the same tab |
| S35 | `?s=health` -> `?s=system&t=diagnostics` | verdict, per-feed, DQ, backup, disk, verify run, census | sync 13 d 19 h, 2 blocking findings, backup 13.8 d, 67 GB, 132,550 cones | same; census Cones 132,550, plausible 132,546; 8 Acknowledge controls at rank 2+ | Y | **P5**: old data-batch table (first seen, registered by, rows held) is reduced to three summary lines |
| S36 | `?s=setup` -> `?s=system&t=setup` | Line, Machines, Stations, Sources, Rules, Reject codes, People, Audit log | all present | all present; all other values equal (only the old Sync-health and Product-limits blocks are gone, by design) | Y | at rank 1 and 3 the typed URL goes to Today (**P4**) |
| S37 | user menu Change password -> `t=account` | form | | name, role, Sign out, Change password (current, new, again), Save | Y | not submitted |
| S38 | login | screen | | renders with no session; typed URL kept | Y | no sign-in attempted |

## 2. Report parity - 18 types x 3 periods (54 pairs)

Every old and new report page was captured at PD1, PL and PR. Method: every number token on the old page (title, tiles, tables, notes) was matched against the new page's tokens, and old lines containing digits were matched against new lines. Result for all 54 pairs: **no number missing from the new page** except one "12" that is part of the old top-bar plant clock; old lines missing from the new page are only the old top-bar/clock lines, the old period sub-title format ("1 Sept - 1 Sept . TP1 . Line 3 . Unit 2") and, for machine-product, the old "Scroll sideways" line. "Assumed until IFL confirms" and "awaiting IFL's approval" counts equal the old pages (sack-weight-summary, rejected-sacks, shift-production: 1 each; management-summary: 18 "awaiting").

| id | rt | new card / view | PD1 | PL | PR | note |
|---|---|---|---|---|---|---|
| R01 | management-summary | 1 (landing at rank 3; "Needs a manager account" at rank 1 and 2) | = | = | = | |
| R02 | daily | 2 | = | = | = | |
| R03 | shift | 2 view | = | = | = | |
| R04 | shift-production | 2 | = | = | = | |
| R05 | reject | 3 | = | = | = | |
| R06 | rejected-cones | 3 | = | = | = | |
| R07 | rejected-hangers | 3 | = | = | = | |
| R08 | rejected-unknown-lifter | 3 | = | = | = | |
| R09 | rejected-sacks | 3 | = | = | = | |
| R10 | sack-weight-summary | 4 | = | = | = | |
| R11 | sack | 4 view | = | = | = | |
| R12 | sack-weight-range | 4 | = | = | = | |
| R13 | sps-packing | 4 | = | = | = | |
| R14 | machine-product | 5 | = | = | = | empty default period names the newest reading (E-7 met) |
| R15 | product | 5 view | = | = | = | |
| R16 | cone-weight | 5 | = | = | = | |
| R17 | station | 5 view | = | = | = | |
| R18 | calibration | 5 | = | = | = | |

## 3. Exports

Both UIs build every export link with the same `reportExportUrl` (web-next imports it from the old `api.ts`). At rank 3 the PDF, Excel and CSV links of daily, reject, sack-weight-summary and management-summary are the same URL set in both UIs (new lists PDF first); the register export link is character-identical. CSVs fetched by GET for daily, reject and sack-weight-summary (same URL old and new): byte-equal apart from the `generated_at_plant_time` line (reject differed by one second of clock). Filenames carry attribution (`...-partial-generation.csv`). Export links are absent at rank 1 and 2 (0 links on report and register pages).

| id | what | result |
|---|---|---|
| E01-E18 | per-type export | links present at rank 3 for the four types opened; the other 14 types use the same component (not opened) |
| E19 | Register export CSV | link identical old vs new; rank 3 only |
| E20 | Print Register | not checked (no printer, no print emulation in this pass) |
| E21 | Print report | not checked; `print.css` with `@page report-landscape` exists |
| E22 | absent at rank 1 and 2 | Y |

## 4. Write controls (new app; present = a control the user can click; none were clicked)

| id | control | gate | new location | r1 | r2 | r3 | r4 | note |
|---|---|---|---|---|---|---|---|---|
| W01 | Record running product ("Change the default") | rank 2 | Board | absent | present | present | present | |
| W02 | Plan changeover ("Start a changeover") | rank 1 | Board, Changeover | present | present | present | present | |
| W03 | Execute changeover | rank 2 + PDAS enabled | Changeover | not reached | | | | disabled reason shown verbatim; wizard not driven |
| W04 | Create product | rank 2 + enabled | Catalogue ("New product" opens the changeover plan) | | | | | not driven |
| W05 | Retire / reactivate product | rank 2 + enabled | Catalogue | absent | present | present | present | present although PDAS writes are off; server would answer 503, not clicked |
| W06 | Change weight limits (PDAS) | rank 2 + enabled | Limits | absent | present | present | present | Edit / Review / Saved steps, Review change |
| W07 | Retire / reactivate pallet | rank 2 + enabled | Catalogue | absent | present | present | present | |
| W08 | Set local limits | rank 2 | Limits | absent | present | present | present | same form |
| W09 | Record calibration adjustment ("Log an adjustment") | rank 2 | Station sheet | absent | present | present | present | |
| W10 | Name a reject code ("Name it") | rank 2 | Rejects, Reason sheet | absent | present | present | present | |
| W11 | Record sack movement | rank 2 | Register > Sack stock, stock sheet | absent | present | present | present | |
| W12 | Acknowledge DQ finding | rank 2 | Diagnostics | absent | present | present | present | 8 on this data |
| W13 | Export report | rank 3 | Reports | absent | absent | present | present | |
| W14 | Export register | rank 3 | Register | absent | absent | present | present | |
| W15-W22 | Setup writes (New account, Reset, Edit, Save, Add machine, Add station, Enabled toggles, Rename) | rank 4 | Setup | tab absent | tab absent | tab absent | present | |
| W23 | Change own password | rank 1 | Account | form present (rank 4 checked) | | | | not submitted |
| W24 | Sign in / out | | Login, account menu | Y | | | | |
| W25 | Setup tab / route | rank 4 | System | absent | absent | absent | present | typed URL redirects to Today (P4) |

## 5. Legacy URL redirects (tested at `/next/?...`, rank 4)

| id | old query | lands on | ok |
|---|---|---|---|
| L01 | `s=line` | `?s=today` | Y |
| L02 | (none) | stays `/next/` and shows Today | Y |
| L03 | `s=readings&rl=sacks&rp=3&st=5` | `?s=quality&t=register&rl=sacks&rp=3&st=5` | Y |
| L04 | `s=readings&rf=inspectionRejects` | `?s=quality&t=register&rf=inspectionRejects` | Y |
| L05 | `s=weight&wm=time&st=4` | `?s=quality&t=weight&wm=time&st=4` | Y |
| L06 | `s=weight&sheet=station:8` | `?s=quality&t=weight&sheet=station%3A8` | Y |
| L07 | `s=rejects&jc=2/1&st=4&pr=21` | `?s=quality&t=rejects&st=4&pr=21` (`2/1` is not a valid code value, the screen drops it; `jc=2-1` is kept, tested on PD1) | Y |
| L08 | `s=sacks&su=kg` | `?s=today&su=kg` | Y |
| L09 | `s=sacks&sp=2` | `?s=quality&t=register&rl=sacks&rp=2` | Y |
| L10 | `s=sacks&sheet=stock:2026-09-01` | `?s=quality&t=register&rl=stock&sheet=stock%3A2026-09-01` | Y |
| L11 | `s=product` | `?s=products&t=board` | Y |
| L12 | `s=product&pt=catalogue&pr=21` | `?s=products&t=catalogue&pr=21` | Y |
| L13 | `s=line&sheet=product:current` | `?s=products&t=board` | Y |
| L14 | `s=report` (no rt) | `?s=reports` (no `rt=daily`; landing card is Management summary at rank 3) | N (P3) |
| L15 | `s=report&rt=shift&rsh=night` | `?s=reports&rt=shift&rsh=night` | Y |
| L16 | `s=report&rt=product&pr=21` | `?s=reports&rt=product&pr=21` | Y |
| L17 | `s=report&rt=station` | `?s=reports&rt=station` | Y |
| L18 | `s=report&rt=sack` | `?s=reports&rt=sack` | Y |
| L19 | `s=health` | `?s=system&t=diagnostics` | Y |
| L20 | `s=setup` | `?s=system&t=setup` | Y |
| L21 | `s=wall` | `?s=today&wall=1` | Y |
| L22 | range period | same p/from/to on `?s=today` | Y |
| L23 | pick period + `at` | p/from/to/at pass through | Y |
| L24-L26 | `pt=running`, `pt=history`, `wt=sack` | `t=board`, `t=history`, `t=weight&wt=sack` | Y |

## 6. Behaviour spot checks

| id | check | result |
|---|---|---|
| B01 | chart click zoom and Back | not exercised in a real browser (jsdom tests only) |
| B02 | pick dates start from the period on screen | Y (date inputs 2026-09-01 when the period is 1 Sep) |
| B03 | empty default period names the newest reading | Y on Today, Weight, Register, cone-weight and machine-product reports |
| B04 | failed fetch naming | not fault-injected |
| B05 | stale / lag states | Today and Board state the data is 36 d old; no "is running" claim (Board prints "8 stations are running" while the newest reading is 36 days old, as the old Product screen did) |
| B06 | sheets as overlays, Escape closes | Y |
| B07 | Enter on a row opens it | Y (tabindex 0) |
| B08 | text size persists | key `sms.uiScale` kept; not reloaded |
| B09 | print preview | not checked |
| B10 | replay banner | code only |
| B11 | rank 1 reads every screen, no write control, Setup tab absent | Y (Setup typed URL redirects to Today, no message) |
| B12 | station label form | "Station 5 . East Conveyor" in filters, "East Conveyor" on cards, "Station 5" in the Board change list |
| B13 | no external request on load | Y (0 non-local requests) |

Sign-off: not signed; see `VERIFY-V2-PARITY.md`.
