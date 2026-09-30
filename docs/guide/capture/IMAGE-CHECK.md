# IMAGE-CHECK (T9, 30 Sep 2026)

Every PNG in `docs/guide/images/` opened and read. Verdict: OK, or needs re-shoot with the reason. Nothing re-shot by this pass.

| ID | What it actually shows | Verdict |
|---|---|---|
| S01 | Signed-out sign-in form: SMS, "Sack Management System", Username (focused), Password, Sign in. | OK |
| S02 | Line screen, This shift, full page: simulator banner, "Line 3 is running", 2,376 cones / 131 sacks / 80 rejected / 5 outside limits, an "only one shift" note in place of a shift chart, Attention, 14-station bar row, "What is being made" (6 products), Last readings. | OK |
| S03 | Top bar and data-age strip only: nav, Health, period buttons, Wall, gear, DA menu, plant clock, lag sentence with "details". | OK |
| S04 | Attention block only (This week): one finding, cones outside the product's limits, "See them". Station 7 is not named. | OK (do not claim station 7 is visible) |
| S05 | Readings, Cones list, This shift: 100 rows, tabs Cones/Sacks/Rejected cones/Rejected by inspection, Station filter, State chips (Any/Within/Low/High/Rejected/Not judged), Export CSV, Print, paging "1 of 24". Very tall full-page image. | OK (very tall; small at 16 cm) |
| S06 | Readings, Rejected cones list: 12 rows "Rejected by the scale", Station filter, Export CSV, Print. | OK |
| S07 | Readings, Sacks list: 131 sacks, paging "1 of 2". Very tall full-page image. | OK (very tall) |
| S08 | Weight, This shift, Distribution: headline "No product target is recorded", bell-shaped histogram, stations table. No target or limit lines. | OK (no lines because no product target is recorded in the demo) |
| S09 | Weight, This week, Over time chart (group means, 3 red points), stations table. | OK |
| S10 | Weight Stations table only (This week): station 4 -2 g vs target, station 7 rejects 23.4%, station 14 "(retired in PDAS)". All "Steady". | OK |
| S11 | Rejects, This week, full page: headline 668 rejected, 75% top reason, trend, Pareto with "Name it", By day and reason table. | OK |
| S12 | Sacks, This week, full page: KPIs, per-day bars, average-weight chart, By product, By shift, Stock ledger, Sack history. | OK |
| S13 | Product > Running: "Product recorded in this system" with Change, six product groups, DEMO-1024 "(retired in PDAS)" warning on station 14. | OK |
| S14 | Product > Changeover form, empty (pickers "-", Target 1960, 30/30, Retire checklist, reason, disabled Check the plan). | OK |
| S15 | Product > Catalogue: products with limits, Pallets in PDAS, Product limits with Change limits; "Writing to PDAS was switched off" notice. | OK |
| S16 | Product > History: both blocks say no product change recorded. | OK (empty state) |
| S17 | Report, Daily, This week: Print / Export CSV / Export Excel / Export PDF, verdict panel, KPIs, cones-per-day chart, By shift and By day tables. | OK |
| S18 | Report, Management summary, This shift (1 day): comparison table with "awaiting IFL's approval", Products run. | OK (one day, not a week) |
| S19 | Report, Calibration, This shift: "Drift rule cannot fire" (1 day), station bias chart and table, no adjustments. | OK |
| S20 | Report, Product by machine, Morning shift: wide table clipped at the right edge (Winder 8 cut), Changeovers none, By product. | OK (clipping is real; caption says it scrolls) |
| S21 | Health, full page: "Something needs attention.", Sync health healthy, PDAS writes off, Reconciliation, Data batches, Database, Service, Backups "No backup file was found", Disk space, Last manual verification run. In Data batches, the "Last seen" date overprints the word "open" in Status. | OK, but chapter 5 caption implied a clean install (fixed); cosmetic overprint noted |
| S22 | Sync health block only ("The plant connection is healthy", Per table collapsed). It does NOT show a per-table outcome or batch label. | OK image; chapter 5 caption was wrong (fixed) |
| S23 | PDAS write checking block only: "PDAS writes: off". | OK |
| S24 | Top of Setup page, viewport-only: heading, Sync health block, start of Line form. Readable. | OK (re-shot T10) |
| S25 | Setup > Sync health block (same content as S22, "12 s ago"). | OK |
| S26 | Setup > Line form: Plant code, Unit code, Line code, Display name, Save. | OK |
| S27 | Setup > Machines: 14 winders, Sack packer, Add a machine. | OK |
| S28 | Setup > Stations: 14 stations "not named", Rename, Add a station. | OK |
| S29 | Setup > Sources: three sources (sack packing disabled) and the tables this line reads; Source and Notes inputs truncate their text. | OK |
| S30 | Setup > Rules (Weight, Shifts, Plausible readings) plus Product limits list. | OK |
| S31 | Setup > Reject codes: 9 codes, all "not yet named". | OK |
| S32a | Setup > People: one account "Demo Admin", New account. | OK |
| S32b | Setup > Audit log: 6 rows (five sign-ins, one CLI user create). | OK |
| S33 | Wall display 1920x1080: "Line 3 is running", 2,376 / 131 / 80, 14 station bars, footer with lag and simulator notice. | OK |
| S34 | Line, Pick dates, viewport-only: date inputs still overlap the top bar (real app behaviour); chapter 7 Note kept. | OK (re-shot T10) |
| D01 | Account menu: Demo Admin, admin, Text size Desk/Wall, Change password, Sign out. | OK |
| D02 | Change password sheet, empty: Current, New, New again, Save, Cancel, Close Esc. | OK |
| D03 | Station 4 sheet: 1,948 g Steady, median, SD, vs line -3 g, vs target -2 g, rejects 0.7%, cones 6,937, 14-day line, pattern-test text, adjustment log, links. | OK |
| D04 | Lower part of the station sheet: adjustment form (date, Amount, Why, Note, reference weights, Product in force, Save, Cancel). | OK |
| D05 | Cone sheet: 1,932 g Within limits, station 2, morning, source record, product DEMO-21, links. | OK |
| D06 | Sack sheet: 47.19 kg Passed, sack 10885, "About 0 cones" note. | OK |
| D07 | Cone sheet: 1,987 g "Rejected by the scale", 12 g over the upper limit. | OK |
| D08 | Rejects with reason "Code 10/1" chosen as a filter chip (headline changes). No sheet opens. Crop cuts the chart mid-way. | OK (caption says filter) |
| D09 | Rejects, This shift: first Pareto row's inline editor open (empty outlined box beside the bar). | OK, weak |
| D10 | Stock day sheet, Fri 25 Sep: 336 sacks (15,874 kg) count as receipts, no movements. | OK |
| D11 | Sacks Stock ledger with movement form open (Issued out, Sacks, kg, Product, When, Why, Record, Cancel). | OK |
| D12 | Product > Running with the Change form open (product picker, Why, Record this product, Cancel). | OK |
| D13 | Changeover dry run: DEMO BLEND A / 1.2D / Demo tube 70g, plan table, a Blocker (the product already exists as product 20), notices that executing is off, greyed Execute the changeover. | OK |
| D14 | Catalogue "Change weight limits" form open including Save and Cancel; not saved. | OK (re-shot T10) |
| D15 | Setup > Machines Add form open, with Add (greyed) and Cancel visible; not saved. | OK (re-shot T10) |
| D16 | Setup > Stations with the Add a station form open (Station number, Name, Machine, Add greyed, Cancel). | OK |
| D17 | Setup > People with the New account form open (Username, Display name, Password, Role manager, Save, Cancel), empty. | OK |
| F-architecture | Architecture diagram, widened; all boxes clear of edges. | OK (re-shot T10) |

## Re-shoots needed
None outstanding after T10 re-shoots.
