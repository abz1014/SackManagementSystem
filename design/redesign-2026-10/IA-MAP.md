# SMS redesign - Information architecture and navigation map

Phase A (design only), worker A2. Date: 13 Oct 2026. Nothing here changes code. Sources read: `sms/web/src/App.tsx` (parseRoute/routeSearch, lines 270-385; render, 500-850), `ui/Bar.tsx` (SCREENS, UserMenu), `api.ts` (REPORT_TYPES, line 2539), every file under `screens/`, server `requireRole` gates in `api/src/app.ts` and `api/src/routes/*.ts`, and the survey files (T1 screen-purpose / ifl-asks, T6, T7 Part 5).

Conventions: "rank" = `ROLE_RANK` (1 viewer, 2 engineer, 3 manager, 4 admin). **Reads are open to every signed-in account** (ONE AUDIENCE rule, CLAUDE.md); only writes are rank-gated, and a control the viewer cannot use is **absent, not greyed** (T-17). "RFQ n" = line n of IFL's 10-line requirement list (ifl-asks.md section A).

---

## 1. The new navigation tree

```
Top bar:  SMS | Today | Quality | Products & PDAS | Reports | System     [period control] [Back-from-zoom] [Wall display] [user menu]
                                                                        (the Setup gear is removed: Setup is now System > Setup)

Today                     s=today   (landing page; default)
  Wall display            s=today&wall=1   (full-screen mode of Today, no chrome)
Quality                   s=quality
  Weight                  t=weight      (default tab)
  Rejects                 t=rejects
  Stations                t=stations
  Register                t=register    (was Readings)
Products & PDAS           s=products
  Board                   t=board       (default tab; was Product > Running)
  Changeover              t=changeover
  Catalogue               t=catalogue
  Limits                  t=limits      (new tab, assembled from Catalogue + Setup > Rules)
  History                 t=history
Reports                   s=reports
  5 cards (the card is derived from rt, never stored in the URL):
  1 Management summary    (default, preselected)
  2 Production by day / shift
  3 Rejects & quality
  4 Sacks
  5 Machine & product
System                    s=system
  Diagnostics             t=diagnostics (default tab; was Health)
  Setup                   t=setup       (rank 4 only; tab absent below rank 4)
  Account                 t=account     (own password; also reached from the user menu)
Overlays (any page):      sheet=station:N | cone:ID | sack:ID | reject:ID | reason:ID | stock:DAY
Sign-in:                  Login screen (no s=)
```

User menu (kept in the bar, right): username and role; **Account** (goes to System > Account); **Sign out**. Same contents as today, new link target.

### Question each place answers, and RFQ justification (T-01/T-02/T-03)

| New place | Question it answers (sentence shown under the headline) | RFQ line |
|---|---|---|
| Today | Is the line running, what has it made this period (cones and sacks), and does anything need attention? | 2, 3, 6, 8, 9 |
| Today > Wall display | What is the line doing, readable from across the room? | 6, 8 + owner's wall-mount request |
| Quality > Weight | Are the cones at the right weight, and is the weight drifting? (cone and sack weight charts) | 2, 5, 6 |
| Quality > Rejects | How many cones failed a check, why, is it getting worse, and where? | 4 |
| Quality > Stations | Which station's scale needs attention? (the one station table) | 2, 5 |
| Quality > Register | Every cone and every sack that was weighed, one row each, with the failures flagged | 2, 4, 6 |
| Products & PDAS > Board | What is each station running now, and what did it last run? | 3 (and IFL 15 Sep key requirement: product per machine per shift) |
| Products & PDAS > Changeover | How do I change what a station runs, step by step, in PDAS? | 3 |
| Products & PDAS > Catalogue | Which products and pallets exist in PDAS, and how do I add or retire one? | 3 |
| Products & PDAS > Limits | What weight limits apply to each product, since when, and how do I change them? | 2, 3 |
| Products & PDAS > History | Who changed which product or limit, and when? | 3, 9 |
| Reports (5 cards) | What did the line make over this period, on paper (PDF, Excel, CSV)? | 8 (and 6, 7 as reframed by IFL Q28) |
| System > Diagnostics | Is SMS itself healthy: the plant connection, database, service, backups? **No RFQ line. Flagged: trust/operability (nearest: 9). Not a contracted feature.** | none |
| System > Setup | Who can sign in; how are stations, rules and reject-code names set? (rank 4) | 9, 10 |
| System > Account | How do I change my own password? | 9 |

---

## 2. Old screen / URL key -> new home

### 2.1 `s=` values (10 of 10)

| # | Old `s=` | Old purpose | New home | New URL | Notes |
|---|---|---|---|---|---|
| 1 | `line` | Line (home) | Today | `?s=today` | the parse fallback becomes `today` |
| 2 | `readings` | Readings register | Quality > Register | `?s=quality&t=register` | listing/filter keys unchanged (2.3) |
| 3 | `weight` | Weight | Quality > Weight; station table moves to Quality > Stations | `?s=quality&t=weight` / `&t=stations` | `wm`, `wt` unchanged |
| 4 | `rejects` | Rejects | Quality > Rejects | `?s=quality&t=rejects` | `jc`, `st`, `pr` unchanged |
| 5 | `sacks` | Sacks | Split: counts, per-day, by shift, by product -> Today; sack weight charts -> Quality > Weight (`wt=sack`); sack list -> Quality > Register (`rl=sacks`); stock ledger, movement form, movement history -> Quality > Register listing "Sack stock" (`rl=stock`; see section 7, NO OBVIOUS HOME) | `?s=today`, `?s=quality&t=weight&wt=sack`, `?s=quality&t=register&rl=sacks`, `?s=quality&t=register&rl=stock` | `su` goes to Today; `sp` becomes `rp` |
| 6 | `product` | Product (4 tabs) | Products & PDAS | `?s=products&t=<tab>` | tab renames in 2.2 |
| 7 | `report` | Report (18 types) | Reports (5 cards) | `?s=reports&rt=<type>` | `rt` kept (2.5) |
| 8 | `health` | Health | System > Diagnostics | `?s=system&t=diagnostics` | PDAS write block leaves (2.7) |
| 9 | `wall` | Wall | Today, full-screen mode | `?s=today&wall=1` | `wall=1` is a flag, not a view |
| 10 | `setup` | Setup (admin) | System > Setup | `?s=system&t=setup` | tab hidden below rank 4; a typed URL still shows the "not allowed" sentence |

### 2.2 `pt=` (Product tabs, 4 of 4) -> `t=`

| Old `pt` | New tab | New URL |
|---|---|---|
| `running` (default) | Board | `?s=products&t=board` |
| `changeover` | Changeover | `?s=products&t=changeover` |
| `catalogue` | Catalogue (products and pallets) | `?s=products&t=catalogue` |
| `history` | History | `?s=products&t=history` |
| (no old key) | Limits (gets `ProductLimitsBlock` and PDAS "Change weight limits") | `?s=products&t=limits` |

### 2.3 All URL keys (20 existing + 2 new)

| Key | Meaning | Old home | New home / change |
|---|---|---|---|
| `s` | screen | global | new values `today/quality/products/reports/system` (2.1) |
| `p`, `from`, `to` | period (shift/today/yesterday/week/month/pick/range) | global | unchanged, global period chip; `range` still written by chart click-to-zoom |
| `at` | replay instant (`LIVE_ALLOW_AS_OF`, dev only) | global | unchanged |
| `sheet` | overlay `kind:id` | global | unchanged (2.4) |
| `rf` | Readings filter `outsideLimits` / `inspectionRejects` | Readings | Quality > Register, unchanged |
| `rl` | Readings listing `cones/sacks/rejected/inspectionRejects` | Readings | Register, unchanged; gains value `stock` |
| `rcs` | Readings cone-state filter | Readings | Register, unchanged |
| `rp` | Readings page | Readings | Register, unchanged; also receives old `sp` |
| `st` | shared station filter | Report, Weight, Readings, Rejects | unchanged, shared by the Quality tabs and Reports |
| `pr` | shared product id | Report, Rejects, Product (Catalogue deep link) | unchanged; also deep-links Products > Catalogue / Limits |
| `wm` | Weight chart mode `dist/time` | Weight | Quality > Weight, unchanged (period-conditional default stays) |
| `wt` | Weight chart type `cone/sack` | Weight | Quality > Weight, unchanged (absorbs sack weight charts) |
| `jc` | Rejects reason code | Rejects | Quality > Rejects, unchanged |
| `su` | Sacks unit `sacks/kg` | Sacks | Today (sack section), unchanged |
| `sp` | Sacks history page | Sacks | **retired**: redirects to `rp` on Register `rl=sacks` |
| `rt` | Report type (18 values) | Report | Reports, same values; card derived from type (2.5) |
| `rsh` | Report shift filter | Report | Reports, unchanged |
| `pt` | Product tab | Product | **retired**: redirects to `t` (2.2) |
| `t` | sub-tab within a screen | (new) | new |
| `wall` | Wall flag | (new) | new: `wall=1` |

### 2.4 Sheets (6 of 6) - overlays, URL form unchanged

| Kind | Component | Opens from | Contains / write control | New home |
|---|---|---|---|---|
| `station:N` | StationSheet | Today station tile, Quality > Stations / Weight, Products > Board, Rejects | station drift, adjustments ledger, **record a calibration adjustment (rank 2)** | overlay over any page; links onward to Register, Rejects, Reports > Calibration |
| `cone:ID` | ReadingSheet (cone) | Register row, Today "last cone", Rejects | one cone: weight, both verdicts, product in force; provenance block goes behind "How this is calculated" | overlay |
| `sack:ID` | ReadingSheet (sack) | Register row, Today "last sack" | one sack | overlay |
| `reject:ID` | ReadingSheet (reject) | Register (failed listings) | one rejected cone | overlay |
| `reason:ID` | ReasonSheet | Rejects reason rows | per-day-per-code table; **name a reject code (rank 2)** | overlay |
| `stock:DAY` | StockSheet | Register `rl=stock`, one day row | one production day of sack stock | overlay |
| `product:*` | (deleted component) | old bookmarks only | legacy redirect (section 3) | `?s=products&t=board` |

Overlay behaviour is preserved: Escape closes; filters and page stay.

### 2.5 Report types (18 of 18) - each appears exactly once

URL stays `?s=reports&rt=<type>` for all 18, so every legacy link works. "MERGED" = no separate picker entry; it is a **view switch inside its host report** (UI-only; API routes unchanged). Merge directions follow T7 Part 5.

| # | Card | Picker entry / view | `rt` value | Status | IFL title (RESERVED) |
|---|---|---|---|---|---|
| 1 | 1 Management summary [default, preselected] | Management summary | `management-summary` | KEEP | no |
| 2 | 2 Production by day / shift | Daily | `daily` | KEEP (host) | no |
| 3 | 2 | view "By shift" inside Daily | `shift` | MERGED into daily | no |
| 4 | 2 | Shift-wise CTS Loop Production Report | `shift-production` | KEEP | yes |
| 5 | 3 Rejects & quality | Rejects (reasons over days) | `reject` | KEEP | no |
| 6 | 3 | List of Rejected Cones Against Weight | `rejected-cones` | KEEP | yes |
| 7 | 3 | Rejected Cone Hangers Report | `rejected-hangers` | KEEP | yes |
| 8 | 3 | Rejected Unknown (Lifter) Report | `rejected-unknown-lifter` | KEEP | yes |
| 9 | 3 | Rejected Sack Report - Daily | `rejected-sacks` | KEEP | yes |
| 10 | 4 Sacks | Sack Packing Weight Summary | `sack-weight-summary` | KEEP (host) | yes |
| 11 | 4 | view "Stock ledger" inside the summary | `sack` | MERGED into sack-weight-summary | no |
| 12 | 4 | SPS Sack Weight Range Report | `sack-weight-range` | KEEP | yes |
| 13 | 4 | SPS Production Report - Count-wise Packing at Each SPS | `sps-packing` | KEEP (landscape) | yes |
| 14 | 5 Machine & product | Product by machine | `machine-product` | KEEP (host) | no |
| 15 | 5 | view "One product" inside machine-product | `product` | MERGED into machine-product | no |
| 16 | 5 | Cone weight | `cone-weight` | KEEP (host) | no |
| 17 | 5 | view "By station" inside Cone weight | `station` | MERGED into cone-weight | no |
| 18 | 5 | Calibration | `calibration` | KEEP | no |

14 picker entries + 4 view switches = 18. Report components under `screens/report/*` (Summary, Daily, Shift, ShiftProduction, Reject, RejectedCones, RejectedHangers, RejectedSacks, RejectedUnknownLifter, Sack, SackWeightRange, SackWeightSummary, SpsPacking, MachineProduct, Product, ConeWeight, Station, Calibration, ProductChanges, PendingIfl, PrintDoc, PrintHead, shared, model) all stay inside Reports. `ProductChanges` renders inside Daily, Shift-production and Machine-product (F-2). Export (PDF, Excel, CSV): **rank 3**.

### 2.6 `screens/` files - one home each

| File | Home |
|---|---|
| Line.tsx | Today (product footer -> read-only line plus link to Products > Board; machines matrix -> Products > Board, see 2.7) |
| Wall.tsx | Today, `wall=1` |
| Readings.tsx | Quality > Register |
| Weight.tsx | Quality > Weight (charts, advisory) + Quality > Stations (station table, adjustments log) |
| Rejects.tsx | Quality > Rejects |
| Sacks.tsx | Today (front) / Quality > Weight (`wt=sack`) / Quality > Register (list, ledger, movements) |
| Product.tsx (shell) | Products & PDAS shell |
| product/Running.tsx | Products > Board |
| product/Changeover.tsx | Products > Changeover |
| product/Catalogue.tsx | Products > Catalogue (products, pallets) + Products > Limits ("Change weight limits") |
| product/ProductLimitsBlock.tsx | Products > Limits (removed from Setup > Rules and from Catalogue) |
| product/History.tsx | Products > History |
| Report.tsx + report/* | Reports |
| Health.tsx | System > Diagnostics |
| health/SyncHealthBlock.tsx | Diagnostics only (removed from Setup) |
| health/SystemHistoryBlock.tsx | Diagnostics |
| health/PdasWriteBlock.tsx | **Products & PDAS > Board header (PDAS write-path status)**; Diagnostics keeps a one-line link |
| Setup.tsx (People, AuditLog) and setup/* | System > Setup |
| Account.tsx | System > Account (and the user-menu link) |
| Login.tsx | Login screen |
| StationSheet / ReadingSheet / ReasonSheet / StockSheet | overlays (2.4) |

### 2.7 Block-level maps

**Health.tsx (SyncHealthBlock plus 8 own blocks)**

| Old block (file:line) | New home | Note |
|---|---|---|
| SyncHealthBlock (Health.tsx:170): sync verdict, last pass, oldest table, per-table list, blocking DQ findings and acknowledge | Diagnostics > "Plant connection and data checks" | its second mount in Setup.tsx:56 is **removed** |
| PdasWriteBlock (Health.tsx:172) | Products & PDAS > Board header strip | PDAS prominence; Diagnostics links to it |
| ReconciliationBlock (Health.tsx:40, mounted :174) | Diagnostics > "Record counts" | |
| SystemHistoryBlock (:176): data batches (epochs), rebuilds, verify runs | Diagnostics > "How the data is organised" | pipeline vocabulary allowed here |
| Database (:178) | Diagnostics | |
| Service (:203) | Diagnostics | |
| Backups (:220) | Diagnostics | |
| Disk (:253) | Diagnostics | |
| Last verify run (:277) | Diagnostics | |
| Bar strip "details" link and health dot (Bar.tsx) | stays in the bar strip, opens System > Diagnostics | |

**Setup.tsx (10 sections)**

| Old block | New home | Write gate |
|---|---|---|
| SyncHealthBlock (Setup.tsx:56) | Diagnostics (duplicate removed) | acknowledge rank 2 |
| LineBlock | System > Setup > Line | rank 4 |
| MachinesBlock | Setup > Machines | rank 4 |
| StationsBlock | Setup > Stations | rank 4 |
| SourcesBlock | Setup > Sources | rank 4 |
| RulesBlock (weight basis, shift rule, plausibility) | Setup > Rules | rank 4 |
| ProductLimitsBlock (embedded at RulesBlock.tsx:61) | Products > Limits (duplicate removed) | rank 2 |
| RejectCodesBlock | Setup > Reject codes | rank 2 server |
| People | Setup > People | rank 4 |
| AuditLog | Setup > Audit log | rank 4 (read) |

Setup stays one scrolling page of sections, as today, under the System tab bar.

**Line.tsx (6 blocks):** headline and KPI figures (Block first) -> Today; cones per day/shift chart (:253) -> Today; Attention list (:270) -> Today; stations grid (:301) -> Today; "What is being made" machine matrix (:341, `W.cone.machinesTitle`) -> Products > Board; product footer (:~904, Change and History buttons) -> Today shows the product in force read-only and links to Products > Board / History; Last readings (:369) -> Today. (That is 7 items; the header block and its KPI figures are one block in the code.)

**Weight.tsx:** headline, distribution/over-time chart, flagged-days advisory, sack control chart (`wt=sack`) -> Quality > Weight; station table (Weight.tsx:1702) -> Quality > Stations; adjustment log (`W.weight.adjustmentLog`) -> Quality > Stations (it is per station).

**Rejects.tsx:** headline, trend (:559), reasons Pareto, by-day (:608), filters (`st`, `pr`) -> Quality > Rejects; the "By station" hop -> Quality > Stations.

**Sacks.tsx (10):** headline and figures, weighed per day, by product, by shift -> Today (Sacks section); average sack weight per day, in-range by product -> Quality > Weight (`wt=sack`); stock ledger (Sacks.tsx:284), record-a-movement form (:594, :729), movement history (:872) -> Quality > Register `rl=stock`; sack list (history) -> Register `rl=sacks`; unit toggle -> Today.

**Product tabs:** Running: LineWideProduct (set current product, rank 2) and ByProduct table -> Board; Changeover: plan (rank 1) and execute (rank 2) -> Changeover; Catalogue: products in PDAS (create, retire/reactivate), pallets in PDAS (retire/reactivate) -> Catalogue; "Change weight limits" and local limits (`ProductLimitsBlock`) -> Limits; History: product timeline and PDAS change trail -> History.

---

## 3. Legacy-URL redirect table

Redirect is client-side in `parseRoute`: rewrite with `history.replaceState`, preserve every other key. A redirect never drops a filter. An unknown `s` falls back to `today` (as `line` does now).

| Legacy URL | Redirects to |
|---|---|
| `?s=line` (or no `s`) | `?s=today` |
| `?s=readings[&rl&rf&rcs&rp&st]` | `?s=quality&t=register[same keys]` |
| `?s=weight[&wm&wt&st]` | `?s=quality&t=weight[same keys]` |
| `?s=weight&sheet=station:N` | same sheet over `?s=quality&t=weight` |
| `?s=rejects[&jc&st&pr]` | `?s=quality&t=rejects[same keys]` |
| `?s=sacks[&su]` | `?s=today&su=..` |
| `?s=sacks&sp=N` | `?s=quality&t=register&rl=sacks&rp=N` |
| `?s=sacks&sheet=stock:DAY` | `?s=quality&t=register&rl=stock` with the same sheet |
| `?s=product` | `?s=products&t=board` |
| `?s=product&pt=running|changeover|catalogue|history` | `?s=products&t=board|changeover|catalogue|history` |
| `?s=product&pt=catalogue&pr=ID` | `?s=products&t=catalogue&pr=ID` |
| `?sheet=product:*` (deleted sheet) | `?s=products&t=board` |
| `?s=report[&rt&rsh&st&pr]` | `?s=reports[same keys]` |
| `?s=report&rt=shift` | `?s=reports&rt=shift` (host Daily, view "By shift") |
| `?s=report&rt=product` | `?s=reports&rt=product` (host Product by machine, view "One product") |
| `?s=report&rt=station` | `?s=reports&rt=station` (host Cone weight, view "By station") |
| `?s=report&rt=sack` | `?s=reports&rt=sack` (host Sack Packing Weight Summary, view "Stock ledger") |
| `?s=health` | `?s=system&t=diagnostics` |
| `?s=setup` | `?s=system&t=setup` |
| `?s=wall` | `?s=today&wall=1` |
| any URL carrying `p`, `from`, `to`, `at`, `sheet` | those pass through unchanged |

---

## 4. Write-control inventory

Gates read from server code (`requireRole(n)` in `api/src/app.ts`, `routes/*.ts`). The blanket `app.use('/api', requireRole(1))` covers every read.

| # | Write action | Endpoint | Server gate | Old location | New location |
|---|---|---|---|---|---|
| 1 | Sign in | POST /api/auth/login | public | Login | Login |
| 2 | Sign out | POST /api/auth/logout | signed in | user menu | user menu |
| 3 | Change own password | POST /api/auth/password | rank 1 | Account sheet (user menu) | System > Account |
| 4 | Record the running product | POST /api/current-product | rank 2 | Product > Running; Line "Change" | Products > Board |
| 5 | Plan a changeover | POST /api/changeover/plan | rank 1 (no PDAS pool opened) | Product > Changeover | Products > Changeover |
| 6 | Execute a changeover (PDAS) | POST /api/changeover/execute | rank 2 (PDAS_WRITE_RANK); 503 while `PDAS_WRITE_ENABLED=false` | Product > Changeover | Products > Changeover |
| 7 | Create a product (PDAS CreateMaterial) | POST /api/products | rank 2 | Product > Catalogue | Products > Catalogue |
| 8 | Retire / reactivate a product | POST /api/products/:id/active | rank 2 | Catalogue | Products > Catalogue |
| 9 | Change a product's weight limits in PDAS | POST /api/products/:id/limits | rank 2 | Catalogue | Products > Limits |
| 10 | Retire / reactivate a pallet | POST /api/pallets/:id/active | rank 2 | Catalogue | Products > Catalogue |
| 11 | Set SMS-local product limits | POST /api/products/limits/local | rank 2 | Catalogue and Setup > Rules (duplicate) | Products > Limits only |
| 12 | Record a calibration adjustment | POST /api/calibration/adjustments | rank 2 | Station sheet | Station sheet (overlay) |
| 13 | Name a reject code | PUT /api/reject-codes/:id | rank 2 | Rejects, Reason sheet, Setup > Reject codes | Quality > Rejects and Reason sheet ("Name it"); Setup > Reject codes |
| 14 | Record a sack stock movement | POST /api/sacks/movements | rank 2 | Sacks | Quality > Register (`rl=stock`) |
| 15 | Acknowledge a data-quality finding | POST /api/dq-findings/:id/ack | rank 2 | Health and Setup (SyncHealthBlock) | System > Diagnostics |
| 16 | Export a report (PDF, Excel, CSV) | GET /api/reports/:type/export | rank 3 | Report | Reports |
| 17 | Export the raw register (CSV) | GET /api/events/export | rank 3 | Readings | Quality > Register |
| 18 | Create a user | POST /api/admin/users | rank 4 | Setup > People | Setup > People |
| 19 | Edit a user (role, active) | PATCH /api/admin/users/:id | rank 4 | Setup > People | Setup > People |
| 20 | Reset a user's password | POST /api/admin/users/:id/password | rank 4 | Setup > People | Setup > People |
| 21 | Edit the line | PUT /api/admin/line | rank 4 | Setup > Line | Setup > Line |
| 22 | Add a machine | POST /api/admin/machines | rank 4 | Setup > Machines | Setup > Machines |
| 23 | Edit a machine | PUT /api/admin/machines/:id | rank 4 | Setup > Machines | Setup > Machines |
| 24 | Add a station | POST /api/admin/stations | rank 4 | Setup > Stations | Setup > Stations |
| 25 | Edit a station | PUT /api/admin/stations/:id | rank 4 | Setup > Stations | Setup > Stations |
| 26 | Edit a data source | PUT /api/admin/sources/:id | rank 4 | Setup > Sources | Setup > Sources |
| 27 | Edit a source table | PUT /api/admin/sources/tables/:id | rank 4 | Setup > Sources | Setup > Sources |
| 28 | Set the weight rule (weight basis etc.) | POST /api/admin/rules/weight | rank 4 | Setup > Rules | Setup > Rules |
| 29 | Set the shift rule | POST /api/admin/rules/shift | rank 4 | Setup > Rules | Setup > Rules |
| 30 | Set the plausibility rule | POST /api/admin/rules/plausibility | rank 4 | Setup > Rules | Setup > Rules |

30 write actions mapped. Client offering uses `ENGINEER_RANK = 2`, `EXPORT_RANK = 3`, admin = 4 (App.tsx:211, :218, :584), equal to the server gates; keep those constants so `rank.crosscheck.test.ts` stays green. Today and Wall carry **no** write controls.

The Products area must print the server's `disabledReason` verbatim while `PDAS_WRITE_ENABLED=false` (existing behaviour, T-15), and must keep saying that a station's product is known only from its cones ("last product it stamped, as of its last cone"); SMS never claims it switches a winder's product.

---

## 5. Cross-links that keep "nothing lost"

Every existing drill-down remains, retargeted. Today station tile -> station sheet. Today attention row -> Quality > Stations or Register filtered by `rf`. Rejects "See the cones" -> Register `rl=inspectionRejects`. Rejects "By station" -> Quality > Stations. Station sheet -> Register (`st`), Rejects (`st`), Reports > Calibration (`st`), Reports > Product by machine (`st`). Reason sheet -> Register (one day), Reports > Rejects (one day). Reading sheet -> Reports > Product by machine (`pr`, day) and Products > Catalogue (`pr`). Today product line -> Products > Board / History. Diagnostics DQ finding -> cone, sack or reject sheet.

---

## 6. Acceptance checklist - every item appears exactly once

| Inventory | Count | Mapped in | Mapped |
|---|---|---|---|
| `s=` values (line, readings, weight, rejects, sacks, product, report, health, wall, setup) | 10 | 2.1 | 10 |
| `pt=` tabs (running, changeover, catalogue, history) | 4 | 2.2 | 4 |
| Existing URL keys (s, p, from, to, at, sheet, rf, rl, rcs, rp, st, pr, wm, wt, jc, su, sp, rt, rsh, pt) | 20 | 2.3 | 20 |
| of which named in the brief (wm, wt, jc, rf, rt, rsh) | 6 | 2.3 | 6 |
| New keys (t, wall) | 2 | 2.3 | 2 |
| Report types | 18 | 2.5 (14 picker entries + 4 merged views) | 18 |
| Sheet kinds (station, cone, sack, stock, reason, reject) | 6 (+1 legacy `product:`) | 2.4 | 6 (+1) |
| `screens/health/*` blocks (SyncHealthBlock, SystemHistoryBlock, PdasWriteBlock) | 3 | 2.6, 2.7 | 3 |
| `Health.tsx` own blocks (Reconciliation, Database, Service, Backups, Disk, Last verify run) | 6 | 2.7 | 6 |
| `screens/setup/*` blocks (Line, Machines, Stations, Sources, Rules, RejectCodes) | 6 | 2.7 | 6 |
| Setup.tsx own sections (People, AuditLog) + two shared imports (SyncHealthBlock, ProductLimitsBlock), the latter two de-duplicated | 2 + 2 | 2.7 | 4 |
| Line.tsx blocks (headline/KPIs, chart, attention, stations grid, machine matrix, product footer, last readings) | 7 | 2.7 | 7 |
| Sacks.tsx blocks | 10 | 2.7 | 10 |
| Old nav entries (8 SCREENS + Wall button + Setup gear) | 10 | 2.1 | 10 |
| User-menu items (Account, Sign out) + Login | 3 | 1, 4 | 3 |
| Write controls | 30 | section 4 | 30 |
| `screens/*.tsx` top-level files (Account, Health, Line, Login, Product, ReadingSheet, Readings, ReasonSheet, Rejects, Report, Sacks, Setup, StationSheet, StockSheet, Wall, Weight) | 16 | 2.6 | 16 |

Duplicates found and resolved: SyncHealthBlock (Health and Setup); ProductLimitsBlock (Catalogue and Setup > Rules); "name a reject code" (inline on Rejects/Reason sheet and in Setup; two entry points to one write, counted once in section 4); sack list (Readings > Sacks listing and Sacks > history; one place now, Register `rl=sacks`); current machine state (Line machines matrix and Product > Running; one place now, Board).

---

## 7. Items with no obvious home, and flags

1. **Sack stock ledger, "Record a movement" form, movement history** (`Sacks.tsx:284, 594, 729, 872`). Proposed home: Quality > Register, listing "Sack stock". It is a record, but "Quality" is a poor parent, and the ledger's words are owner-reserved (see GLOSSARY). Alternative: a collapsed "Sack stock" section at the foot of Today. **Owner to choose.**
2. **Reconciliation ("Record counts")** is a census of SMS's own tables, not a quality fact; placed in Diagnostics. It has no RFQ line.
3. **Line's machine matrix ("What is being made")** moves to Products > Board. If the owner wants product per station visible at the doorway, add a read-only product tag to the Today station tiles.
4. **PDAS write-path status** (`PdasWriteBlock`) moves out of Health into Products & PDAS > Board header, following the owner's "PDAS is first-class" direction.
5. **Diagnostics has no RFQ line.** Justified only as trust/operability (line 9 and the lag-honesty rule). Flag for the final report.
6. **Wall** as `wall=1` removes its separate nav entry; the "Wall display" button stays in the bar. Wall's exit goes to Today.
7. **Account** changes from a sheet to a page (System > Account). A sheet could be kept (no period, no data); the tab matches the owner's System list.
8. Four report types lose their picker entry (shift, product, station, sack). None is among IFL's eight titles. The merge judgement is the survey's (T7 Part 5), not user-tested.
9. **Quality > Stations** holds only the station table and the adjustments log; thin on a phone. Folding it into Weight is possible but the owner's tab list names it separately.
10. Not covered here: tab-strip behaviour on phones, skip-link order, DOM ids. Those belong to the design-system worker.
