# PARITY-TEMPLATE - old UI vs web-next, to be filled in phase F

Worker output, 13 Oct 2026. A checklist, not a result: every "new" cell is blank. Old values are the reference figures in `mockup-data.json` (`derived`, read-only copy `sms_audit`, fetched 13 Oct 2026); they are what the OLD API returned and are the numbers web-next must reproduce. Source of rows: `TRACE.md`.

Periods: **PD1** one production day 2026-09-01 (`p=pick&from=2026-09-01&to=2026-09-01`); **PL** the whole September generation 2026-08-05..2026-09-07 (`p=pick&from=2026-08-05&to=2026-09-07`); **PR** shift range 1 Sep evening .. 2 Sep morning (`p=range&from=2026-09-01.evening&to=2026-09-02.morning`).

How to fill: open the old UI URL and the new URL for the same period, compare each figure to the digit (no rounding differences allowed unless noted), mark `new` and `ok` (Y / N / n.a.), record any difference in `note`. A figure that cannot be reproduced is a defect, not a rounding issue. Run read-only; no accounts created by agents.

Caveat inherited from the data package: `lastReadingUtc` and `lastStamped*` come from the whole snapshot (to 7 Sep), not as of 1 Sep; `machinesRunning` for PD1 is replayed at 2026-09-01T21:59:59Z (`&at=2026-09-01T21:59:59Z` needs LIVE_ALLOW_AS_OF, dev only).

## 1. Screen parity - URL mapping and headline figures

| id | old URL (root-relative) | new URL | compare | PD1 old | PL old | PR old | PD1 new | PL new | PR new | ok | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | `?s=line` | `?s=today` | Today: Cones weighed (line) | 3,089 | 132,550 | 3,098 | | | | | |
| S02 | `?s=line` | `?s=today` | Today: Sacks | 133 | 5,435 | 128 | | | | | |
| S03 | `?s=line` | `?s=today` | Today: Sack kg | 6,296.7 | 256,871.2 | 6,028.7 | | | | | |
| S04 | `?s=line` | `?s=today` | Today: Failed inspection n | 451 | 6,089 | 390 | | | | | |
| S05 | `?s=line` | `?s=today` | Today: Failed inspection % | 14.57 | 4.59 | 12.56 | | | | | |
| S06 | `?s=line` | `?s=today` | Today: Failed weight check n | 0 | 53 | 1 | | | | | |
| S07 | `?s=line` | `?s=today` | Today: Average cone g | 1,954.27 | 1,951.77 | 1,953.63 | | | | | |
| S08 | `?s=line` | `?s=today` | Today: Target g | 1,960 | 1,960 | 1,960 | | | | | |
| S09 | `?s=line` | `?s=today` | Today: Cone SD g | 7.04 | 8.72 | 6.99 | | | | | |
| S10 | `?s=line` | `?s=today` | Today per shift (morning): cones / failed / sacks / kg | 1067 / 169 / 52 / 2462.2 | 43867 / 2032 / 1698 / 80206.6 | 1076 / 108 / 47 / 2194.2 | | | | | |
| S11 | `?s=line` | `?s=today` | Today per shift (evening): cones / failed / sacks / kg | 1001 / 165 / 50 / 2367.8 | 42552 / 1986 / 1800 / 85136.9 | 1001 / 165 / 50 / 2367.8 | | | | | |
| S12 | `?s=line` | `?s=today` | Today per shift (night): cones / failed / sacks / kg | 1021 / 117 / 31 / 1466.6 | 46131 / 2071 / 1937 / 91527.8 | 1021 / 117 / 31 / 1466.6 | | | | | |
| S13 | `?s=line` | `?s=today` | Today: Attention list rows (names, order); stations grid 14 rows (cones, failed %) | pd1.derived.perStation[] | pl.derived.perStation[] | pr.derived.perStation[] | | | | | |
| S14 | `?s=line` | `?s=today` | Today sacks section: avg sack kg / passed scale % / cones per sack | 47.34 / 82.7 % / 23.2 | 47.29 / 89.1 % / 24.4 | 47.34 / 85.9 % / 24.2 | | | | | |
| S15 | `?s=wall` | `?s=today&wall=1` | Wall: state sentence, per-station bars/counts, footer freshness (live; use replay at for PD1) |  |  |  | | | | | |
| S16 | `?s=readings` | `?s=quality&t=register` | Register Cones: count line "N weighed, M failed weight check (x %)" and first page rows | 3,089 | 132,550 | 3,098 | | | | | |
| S17 | `?s=readings&rl=sacks` | `?s=quality&t=register&rl=sacks` | Register Sacks: total sacks and first page | 133 | 5,435 | 128 | | | | | |
| S18 | `?s=readings&rl=inspectionRejects` | `?s=quality&t=register&rl=inspectionRejects` | Register Inspection fails: total | 451 | 6,089 | 390 | | | | | |
| S19 | `?s=readings&rl=rejected` | `?s=quality&t=register&rl=rejected` | Register Weight-check fails: total | 0 | 53 | 1 | | | | | |
| S20 | `?s=readings&rf=outsideLimits` | `?s=quality&t=register&rf=outsideLimits` | Outside-limits cone listing count |  |  |  | | | | | |
| S21 | `?s=sacks&sheet=stock:2026-09-01` | `?s=quality&t=register&rl=stock&sheet=stock:2026-09-01` | Sack stock rows (opening/receipts/issues/consumption/adjustments/closing) and the day sheet | pd1.raw.sacksStock | pl.raw.sacksStock | pr.raw.sacksStock | | | | | |
| S22 | `?s=weight` | `?s=quality&t=weight` | Weight headline: mean g / target g / SD (two facts, basis-unconfirmed wording kept) | 1,954.27 / 1,960 / 7.04 | 1,951.77 / 1,960 / 8.72 | 1,953.63 / 1,960 / 6.99 | | | | | |
| S23 | `?s=weight&wm=dist` | `?s=quality&t=weight&wm=dist` | Distribution histogram bucket counts and limit lines |  |  |  | | | | | |
| S24 | `?s=weight&wm=time` | `?s=quality&t=weight&wm=time` | Over-time series points (daily/shift means) |  |  |  | | | | | |
| S25 | `?s=weight&wt=sack` | `?s=quality&t=weight&wt=sack` | Sack control chart + avg sack weight per day (gap G-8) |  |  |  | | | | | |
| S26 | `?s=weight` | `?s=quality&t=stations` | Station table: 14 rows cones / failed % / mean g / vs target / targetBasis marker (X-1) | pd1.derived.perStation[] | pl.derived.perStation[] | pr.derived.perStation[] | | | | | |
| S27 | `?s=weight&sheet=station:8` | `?s=quality&t=stations&sheet=station:8` | Station sheet: daily means, ledger, days-to-limit (or "not established"), 4 hops (gap G-4) |  |  |  | | | | | |
| S28 | `?s=rejects` | `?s=quality&t=rejects` | Failed inspection total, top reasons (PD1 Tube 2 Mat 1 = 440, 97.6 %), by-day table | Tube 2 Mat 1 = 440 (97.6 %) | pl.derived.topRejectReasons[] | pr.derived.topRejectReasons[] | | | | | |
| S29 | `?s=rejects&jc=2/1` | `?s=quality&t=rejects&jc=2/1` | Reason filter; reason sheet day table; Name it present at rank>=2 only |  |  |  | | | | | |
| S30 | `?s=product` | `?s=products&t=board` | Board: per-winder current product + since; F-1 last product + last cone time for non-running winders | pd1.derived.machinesRunning[] | pl.derived.machinesRunning[] | pr.derived.machinesRunning[] | | | | | |
| S31 | `?s=product&pt=changeover` | `?s=products&t=changeover` | Plan, Review, Execute; blocked-plan copy; Execute disabled with disabledReason verbatim while PDAS_WRITE_ENABLED=false | refs.changeoverRefs | n.a. | n.a. | | | | | |
| S32 | `?s=product&pt=catalogue` | `?s=products&t=catalogue` | Active catalogue rows, pallets; write controls absent when canWrite false, with the reason sentence | refs.productCatalogueActive[] | n.a. | n.a. | | | | | |
| S33 | `?s=product&pt=catalogue (limits form) and Setup > Rules limits block` | `?s=products&t=limits` | Limit versions per product; PDAS limits form; local limits form | refs.limitsHistory.products[] | n.a. | n.a. | | | | | |
| S34 | `?s=product&pt=history` | `?s=products&t=limits (Limits & History) or t=history` | Product timeline + PDAS change trail (3 entries, all outcome disabled) | refs.recentProductChanges / refs.productTimeline | n.a. | n.a. | | | | | |
| S35 | `?s=health` | `?s=system&t=diagnostics` | Sync verdict, per-table list, DQ findings (+ack, destination link), Database, Service, Backups, Disk, Last verify run, records census | refs.health, pd1.raw.reconciliation | pl.raw.reconciliation | pr.raw.reconciliation | | | | | |
| S36 | `?s=setup (rank 4)` | `?s=system&t=setup` | All sections present: Line, Machines, Stations, Sources, Rules, Reject codes, People, Audit log (no duplicate sync/limits blocks) | n.a. | n.a. | n.a. | | | | | |
| S37 | `(user menu) Change password` | `?s=system&t=account` | Change own password form; other-sessions message | n.a. | n.a. | n.a. | | | | | |
| S38 | `(login)` | `login screen` | Sign in / error message / expired session bounce | n.a. | n.a. | n.a. | | | | | |

## 2. Report parity - 18 types x 3 periods

Old URL `?s=report&rt=<type>&<period>`; new URL `?s=reports&rt=<type>&<period>` (card/view in the third column). For each cell compare the report totals, the first table, notes and footnotes, and the header (period label, line, plant). Exports are in section 3.

| id | rt | new card / view | read rank | filters offered | PD1 | PL | PR | note |
|---|---|---|---|---|---|---|---|---|
| R01 | `management-summary` | 1 Management summary (default) | 3 | none | | | | KPI rows + prior/delta; needs rank 3 (G-1) |
| R02 | `daily` | 2 Production by day/shift | 1 | shift | | | | includes product changes (F-2) |
| R03 | `shift` | 2 view By shift | 1 | shift | | | | F-2 changes |
| R04 | `shift-production` | 2 Shift-wise CTS Loop Production Report | 1 | shift | | | | IFL title verbatim; audit reference: 2026-08-15 4,854 / 1 / 4,855 |
| R05 | `reject` | 3 Rejects & quality | 1 | shift, station, product | | | |  |
| R06 | `rejected-cones` | 3 List of Rejected Cones Against Weight | 1 | shift, station | | | | IFL title verbatim |
| R07 | `rejected-hangers` | 3 Rejected Cone Hangers Report | 1 | shift, station, product | | | | Sept flagged set {91, 32, 105, 205, 199} |
| R08 | `rejected-unknown-lifter` | 3 Rejected Unknown (Lifter) Report | 1 | shift, product | | | | 0 unknown rows; zeroed-clock block 1 (Sept) |
| R09 | `rejected-sacks` | 3 Rejected Sack Report - Daily | 1 | shift, product | | | | Sept 594 rejected sacks (audit) |
| R10 | `sack-weight-summary` | 4 Sack Packing Weight Summary | 1 | shift, product | | | | PL: 5,435 sacks, SD 0.19 kg |
| R11 | `sack` | 4 view Stock ledger | 1 | shift | | | | whole production days under a shift range, sentence present |
| R12 | `sack-weight-range` | 4 SPS Sack Weight Range Report | 1 | shift, product | | | |  |
| R13 | `sps-packing` | 4 SPS Production Report - Count-wise Packing at Each SPS | 1 | shift | | | | landscape; "SPS 1" |
| R14 | `machine-product` | 5 Product by machine | 1 | shift, station | | | | F-2 changes; X-3 empty-period (all-zero rows) |
| R15 | `product` | 5 view One product | 1 | shift, station | | | | C-005 sack blanking when filtered to one winder |
| R16 | `cone-weight` | 5 Cone weight | 1 | none | | | | target is the period's own versioned target |
| R17 | `station` | 5 view By station | 1 | none | | | |  |
| R18 | `calibration` | 5 Calibration | 1 | station | | | | adjustments table |

## 3. Exports and print (rank 3)

| id | what | check | PD1 | PL | PR | note |
|---|---|---|---|---|---|---|
| E01 | `management-summary` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E02 | `daily` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E03 | `shift` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E04 | `shift-production` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E05 | `reject` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E06 | `rejected-cones` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E07 | `rejected-hangers` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E08 | `rejected-unknown-lifter` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E09 | `rejected-sacks` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E10 | `sack-weight-summary` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E11 | `sack` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E12 | `sack-weight-range` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E13 | `sps-packing` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E14 | `machine-product` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E15 | `product` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E16 | `cone-weight` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E17 | `station` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E18 | `calibration` CSV / XLSX / PDF | same rows and totals as on screen; header, notes and assumption footers present; CSV BOM; filename carries attribution | | | | absent below rank 3; disabled until data |
| E19 | Register export CSV (`/api/events/export`), rank 3 | | | | | |
| E20 | Print Register (portrait) with PrintHead; header-fetch-failure degraded block | | | | | |
| E21 | Print report (landscape; machine-product prints one line pointing to CSV); page X of Y | | | | | |
| E22 | Export buttons absent at rank 1 and 2 (viewer, engineer) | | | | | |

## 4. Write controls (present/absent per rank, and effect)

Test each at rank 1 (absent), at its gate rank (present; works or shows the server reason) and confirm the server answer. Use only existing accounts; create none. PDAS writes stay disabled (`PDAS_WRITE_ENABLED`), so Execute / Create / Retire / Limits must show the verbatim `disabledReason`.

| id | control | gate | old location | new location | r1 | r2 | r3 | r4 | effect ok |
|---|---|---|---|---|---|---|---|---|---|
| W01 | Record running product | rank 2 | Product > Running / Line Change | Products > Board | | | | | |
| W02 | Plan changeover | rank 1 | Product > Changeover | Products > Changeover | | | | | |
| W03 | Execute changeover | rank 2 + PDAS enabled | Product > Changeover | Products > Changeover | | | | | |
| W04 | Create product | rank 2 + enabled | Catalogue | Products > Catalogue | | | | | |
| W05 | Retire/reactivate product | rank 2 + enabled | Catalogue | Products > Catalogue | | | | | |
| W06 | Change weight limits (PDAS) | rank 2 + enabled | Catalogue | Products > Limits | | | | | |
| W07 | Retire/reactivate pallet | rank 2 + enabled | Catalogue | Products > Catalogue | | | | | |
| W08 | Set local limits | rank 2 | Catalogue / Setup > Rules | Products > Limits | | | | | |
| W09 | Record calibration adjustment | rank 2 | Station sheet | Station sheet | | | | | |
| W10 | Name a reject code | rank 2 | Rejects / Reason sheet / Setup | Quality > Rejects, Reason sheet, Setup | | | | | |
| W11 | Record sack movement | rank 2 | Sacks | Quality > Register stock | | | | | |
| W12 | Acknowledge DQ finding | rank 2 | Health / Setup | System > Diagnostics | | | | | |
| W13 | Export report | rank 3 | Report | Reports | | | | | |
| W14 | Export register | rank 3 | Readings | Quality > Register | | | | | |
| W15 | Create user | rank 4 | Setup | Setup > People | | | | | |
| W16 | Edit user role/active | rank 4 | Setup | Setup > People | | | | | |
| W17 | Reset user password | rank 4 | Setup | Setup > People | | | | | |
| W18 | Edit line | rank 4 | Setup | Setup > Line | | | | | |
| W19 | Add / edit machine | rank 4 | Setup | Setup > Machines | | | | | |
| W20 | Add / edit station | rank 4 | Setup | Setup > Stations | | | | | |
| W21 | Edit data source / table | rank 4 | Setup | Setup > Sources | | | | | |
| W22 | Set weight / shift / plausibility rule | rank 4 | Setup | Setup > Rules | | | | | |
| W23 | Change own password | rank 1 | user menu | System > Account | | | | | |
| W24 | Sign in / sign out | public / signed in | Login / user menu | Login / user menu | | | | | |
| W25 | Setup tab / route | rank 4 (absent below; typed URL shows not-allowed) | gear | System > Setup | | | | | |

## 5. Legacy URL redirects (old URL must land on)

| id | old URL | lands on | other keys kept | ok |
|---|---|---|---|---|
| L01 | `?s=line` | `?s=today` | all | |
| L02 | `(no s)` | `?s=today` | all | |
| L03 | `?s=readings&rl=sacks&rp=3&st=5` | `?s=quality&t=register&rl=sacks&rp=3&st=5` | all | |
| L04 | `?s=readings&rf=inspectionRejects` | `?s=quality&t=register&rf=inspectionRejects (listing inspectionRejects)` | all | |
| L05 | `?s=weight&wm=time&st=4` | `?s=quality&t=weight&wm=time&st=4` | all | |
| L06 | `?s=weight&sheet=station:8` | `?s=quality&t=weight&sheet=station:8` | all | |
| L07 | `?s=rejects&jc=2/1&st=4&pr=21` | `?s=quality&t=rejects&jc=2/1&st=4&pr=21` | all | |
| L08 | `?s=sacks&su=kg` | `?s=today&su=kg` | all | |
| L09 | `?s=sacks&sp=2` | `?s=quality&t=register&rl=sacks&rp=2` | all | |
| L10 | `?s=sacks&sheet=stock:2026-09-01` | `?s=quality&t=register&rl=stock&sheet=stock:2026-09-01` | all | |
| L11 | `?s=product` | `?s=products&t=board` | all | |
| L12 | `?s=product&pt=catalogue&pr=21` | `?s=products&t=catalogue&pr=21` | all | |
| L13 | `?s=line&sheet=product:current` | `?s=products&t=board` | all | |
| L14 | `?s=report (no rt)` | `?s=reports&rt=daily  (decision G-1)` | all | |
| L15 | `?s=report&rt=shift&rsh=night` | `?s=reports&rt=shift&rsh=night` | all | |
| L16 | `?s=report&rt=product&pr=21` | `?s=reports&rt=product&pr=21` | all | |
| L17 | `?s=report&rt=station` | `?s=reports&rt=station` | all | |
| L18 | `?s=report&rt=sack` | `?s=reports&rt=sack` | all | |
| L19 | `?s=health` | `?s=system&t=diagnostics` | all | |
| L20 | `?s=setup` | `?s=system&t=setup` | all | |
| L21 | `?s=wall` | `?s=today&wall=1` | all | |
| L22 | `?s=line&p=range&from=2026-09-01.evening&to=2026-09-02.morning` | `same p/from/to on ?s=today` | all | |
| L23 | `?s=line&p=pick&from=2026-09-01&to=2026-09-01&at=2026-09-01T21:59:59Z` | `p/from/to/at pass through` | all | |

## 6. Behaviour parity (spot checks)

| id | check | old | new | ok |
|---|---|---|---|---|
| B01 | Click a chart day/shift mark: whole-page period becomes p=range, Back control restores the previous period; re-click of the same period is a no-op | | | |
| B02 | Pick dates / Custom range open on the period already on screen (X-2) | | | |
| B03 | Empty period after the newest reading names the newest reading (X-3), including the machine-product report | | | |
| B04 | Failed fetch (block one endpoint): each screen names which part failed; no zeros, no "none" | | | |
| B05 | Stale / lag_unknown / out-of-contact: no "Line N is running"; Wall stops the verdict after 3 missed polls but keeps counts | | | |
| B06 | Sheets open as overlays without re-fetching the screen behind; Escape closes | | | |
| B07 | Keyboard: rows open on Enter/Space; charts navigable; skip link; focus not hidden under a sticky head | | | |
| B08 | Text size Desk/Wall toggle persists across reload | | | |
| B09 | Print preview of a report: landscape, no controls, page numbers; Register portrait | | | |
| B10 | Replay at= shows the banner; simulator banner behaviour unchanged | | | |
| B11 | Rank 1 account: every screen readable; no write control visible; Setup tab absent | | | |
| B12 | Station label form (DP-4 once decided) consistent on every screen and export | | | |
| B13 | No external network request on load (fonts and assets self-hosted) | | | |

Sign-off: phase F reviewer ______  date ______  result: parity PASS / FAIL (list failing ids).
