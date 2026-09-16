# SMS Backend Inventory — Phase 1 of the UX implementation programme

**Audit only. No application code was written, edited or deleted. `sms/` was read-only throughout.**

Repo: `C:/Users/ABDULLAH SAJID/Desktop/sag database`, monorepo under `sms/`.
Branch: `floor-first-rework`. HEAD: `16bc219` "Make the changeover workflow reachable over HTTP".
59 commits ahead of `origin/main`; nothing pushed (per coordinator brief; git state not independently re-run in this pass).
Test suite: ~1099 passing / 4 skipped (the 4 skipped are the opt-in real-SQL migration block) — per coordinator brief.

This document inventories what the backend can do: every HTTP route, every service, the CLI, the sync worker, and the database schema — and, for each, whether it is reachable at all and by whom. It does not propose UI. A companion frontend audit is expected to join against the **capability table** and the **CLI-only** / **no-route** / **never-served** sections below.

Rank model (migration 035, 15 Sep 2026): **1 viewer · 2 engineer · 3 manager · 4 admin**. `app.use('/api', requireRole(1))` in `sms/api/src/app.ts:293` is the floor for everything registered after it; four routes registered before that line are public (health, login, logout, `/api/auth/me`).

---

## 1. Route table — every HTTP route (75 total)

Legend: rank is the minimum `requireRole(N)`; "1\*" = public (registered before the `requireRole(1)` floor at `app.ts:293`).

### 1.1 Public (4)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | 1\* | `services/health.ts` `getHealth` — `app.ts:203` | Liveness/readiness probe: service, DB, acquisition health. Never 500; down → 503. Detail fields nulled for unauthenticated callers. |
| POST | `/api/auth/login` | 1\* | `auth.ts` `authenticate` — `app.ts:217` | Session login, IP+username rate-limited, audited. |
| POST | `/api/auth/logout` | 1\* | `auth.ts` `destroySession` — `app.ts:272` | Destroys the session cookie, audited. |
| GET | `/api/auth/me` | 1\* | `app.ts:287` | Current session's user (or null). |

### 1.2 `app.ts` — mounted directly (51)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/range` | 1 | inline SQL — `app.ts:317` | Production-day window the date pickers offer (excludes clock-fault days). |
| GET | `/api/live` | 1 | `services/live.ts` `getLive` — `app.ts:354` | Current line state: running/stopped/idle, this-shift counts, per-station activity, acquisition lag. Cached, polled ~10s by floor/wall screens. |
| GET | `/api/stations` | 1 | `services/admin.ts` `listStations` — `app.ts:391` | Active station names/labels (read side of admin station config). |
| GET | `/api/config` | 1 | `services/lineConfig.ts` `getLineConfig` — `app.ts:411` | Plant › unit › line, machines, stations with machine links. |
| GET | `/api/attention` | 1 | `services/attention.ts` `getAttention` — `app.ts:434` | "Does anything need attention?" — outside-limits count (selected period) + station drift + reject-rise findings (fixed 14-day trailing window). |
| GET | `/api/product-at` | 1 | `services/productAt.ts` `ProductTimeline.verdict` — `app.ts:513` | The product/limits in force at an instant; optional weight → verdict (5-state classification). |
| GET | `/api/weight-stations` | 1 | `services/weightStations.ts` `getWeightStations` — `app.ts:594` | The one station table (CLAUDE.md rule 6): bias vs line and vs target, per station, trailing window. |
| GET | `/api/report` | 1 | `services/report.ts` `getReport` — `app.ts:658` | Legacy period summary report (superseded by `/api/reports/daily`; still live). |
| GET | `/api/operations` | 1 | `services/operations.ts` `getOperations` — `app.ts:703` | Sync health, schema-fingerprint status, DQ finding roll-up. |
| GET | `/api/production` | 1 | `services/production.ts` `getProduction` — `app.ts:713` | Generalized, filtered, grouped production query; cached. |
| GET | `/api/downtime` | 1 | `services/downtime.ts` `getDowntime` — `app.ts:745` | Inferred stoppages from inter-cone gaps for one day (no PLC feed). |
| GET | `/api/spc` | 1 | `services/spc.ts` `getWeightSpc`/`getSpec` — `app.ts:765` | I-MR control chart + Cp/Cpk/Pp/Ppk for cone or sack weight. |
| GET | `/api/reject-spc` | 1 | `services/rejectSpc.ts` `getRejectSpc` — `app.ts:799` | Reject p-chart with burst detection; filters: shift/station/product/code. |
| GET | `/api/events` | 1 | `services/register.ts` `listEvents` — `app.ts:895` | Paged cone/sack/reject register with filters. |
| GET | `/api/events/export` | 3 | `services/register.ts` `exportEventsCsv` — `app.ts:918` | Bulk CSV export of the register; audited `export.csv`. |
| GET | `/api/events/:type/:id` | 1 | `services/register.ts` `getEventDetail` — `app.ts:939` | One record's detail sheet. |
| GET | `/api/rejects` | 1 | `services/rejects.ts` `getRejectPareto` — `app.ts:961` | Reject Pareto by code. |
| GET | `/api/reject-codes` | 1 | `services/rejects.ts` `listRejectCodes` — `app.ts:998` | Reject code dictionary (labels/pass-flag/severity). |
| PUT | `/api/reject-codes/:id` | 2 | `services/rejects.ts` `updateRejectCode` — `app.ts:1010` | Edit one reject code's label/pass/severity; audited. |
| GET | `/api/weights` | 1 | `services/weights.ts` `getWeights` — `app.ts:1051` | Weight distribution/outliers/giveaway (superseded by `/api/spc`+`/api/weight-stations` per `web/src/api.callers.test.ts`). |
| GET | `/api/calibration` | 1 | `services/calibration.ts` `getStationDrift` — `app.ts:1072` | Station drift view (superseded by `/api/weight-stations` per the same guard test). |
| GET | `/api/calibration/adjustments` | 1 | `services/calibration.ts` `listCalibrationAdjustments` — `app.ts:1113` | Calibration ledger, filterable by from/to/station. |
| POST | `/api/calibration/adjustments` | 2 | `services/calibration.ts` `recordCalibrationAdjustment` — `app.ts:1147` | Log a calibration adjustment (restarts the station's drift baseline); audited. |
| GET | `/api/products` | 1 | `services/currentProduct.ts` `listProducts` — `app.ts:1221` | Product master list (mirror). |
| GET | `/api/current-product` | 1 | `services/currentProduct.ts` `getCurrent` — `app.ts:1229` | The line's current product. |
| GET | `/api/product-timeline` | 1 | `services/currentProduct.ts` `listTimeline` — `app.ts:1239` | Full changeover history (line-wide timeline). |
| POST | `/api/current-product` | 2 | `services/currentProduct.ts` `setCurrent` — `app.ts:1248` | Set the running product (append-only timeline); audited `product.changeover`. |
| GET | `/api/product-write/status` | 1 | inline — `app.ts:1299` | Whether PDAS writes / local-limit writes are enabled for this caller. |
| GET | `/api/product-options` | 1 | inline SQL — `app.ts:1310` | Blend/count/tube-type pickers for "create a product". |
| POST | `/api/products` | 2 (`PDAS_WRITE_RANK`) | `services/pdasWrite.ts` `createProduct` — `app.ts:1348` | Create a product via PDAS's `CreateMaterial` proc. 503 while `PDAS_WRITE_ENABLED` is off. |
| POST | `/api/products/:id/active` | 2 | `services/pdasWrite.ts` `setProductActive` — `app.ts:1374` | Retire/reactivate a product via `SetMaterialStatusActive`. |
| POST | `/api/products/:id/limits` | 2 | `services/pdasWrite.ts` `updateProductLimits` — `app.ts:1393` | Change a product's setpoint/offsets via the guarded single-row `UPDATE dbo.Materials` + `nhs_events` row. |
| GET | `/api/admin/users` | 4 | `services/admin.ts` `listUsers` — `app.ts:1426` | User list. |
| POST | `/api/admin/users` | 4 | `services/admin.ts` `createUser` — `app.ts:1429` | Create a user; audited. |
| PATCH | `/api/admin/users/:id` | 4 | `services/admin.ts` `updateUser` — `app.ts:1457` | Activate/deactivate, change role; last-admin guarded; audited. |
| GET | `/api/admin/line` | 4 | `services/lineConfig.ts` `getLineIdentity` — `app.ts:1482` | Plant/unit/line identity row. |
| PUT | `/api/admin/line` | 4 | `services/lineConfig.ts` `updateLine` — `app.ts:1489` | Rename plant/unit/line/display name; audited. |
| GET | `/api/admin/machines` | 4 | `services/lineConfig.ts` `listMachines` — `app.ts:1507` | Machine list. |
| POST | `/api/admin/machines` | 4 | `services/lineConfig.ts` `createMachine` — `app.ts:1510` | Add a machine (optionally creates its station); audited. |
| PUT | `/api/admin/machines/:id` | 4 | `services/lineConfig.ts` `updateMachine` — `app.ts:1537` | Edit/retire a machine; audited. |
| GET | `/api/admin/stations` | 4 | `services/admin.ts` `listStations` — `app.ts:1559` | Station list including inactive. |
| POST | `/api/admin/stations` | 4 | `services/lineConfig.ts` `createStation` — `app.ts:1562` | Add a station; audited. |
| PUT | `/api/admin/stations/:id` | 4 | `services/admin.ts` `setStation` — `app.ts:1586` | Rename/relink/retire a station; two audit rows when the machine link moves. |
| GET | `/api/admin/sources` | 4 | `services/lineConfig.ts` `listSources` — `app.ts:1643` | Data-source + source-table config. |
| PUT | `/api/admin/sources/:id` | 4 | `services/lineConfig.ts` `updateDataSource` — `app.ts:1646` | Label/enable a data source; audited. |
| PUT | `/api/admin/sources/tables/:id` | 4 | `services/lineConfig.ts` `updateSourceTable` — `app.ts:1657` | Change which source table/enable a table; audited; note that a table change is a new epoch. |
| GET | `/api/admin/rules` | 4 | `services/admin.ts` `getRules` — `app.ts:1682` | Weight/shift/plausibility rule current values. |
| POST | `/api/admin/rules/weight` | 4 | `services/admin.ts` `setWeightRule` — `app.ts:1685` | Set weight basis (as-recorded/gross/net) + tube/tare; audited. |
| POST | `/api/admin/rules/shift` | 4 | `services/admin.ts` `setShiftRule` — `app.ts:1701` | Set shift boundaries/mode; audited; invalidates live-config cache. |
| POST | `/api/admin/rules/plausibility` | 4 | `services/admin.ts` `setPlausibilityRule` — `app.ts:1759` | Set cone/sack plausibility bounds; audited; applies read-time immediately. |
| GET | `/api/admin/audit` | 4 | `services/audit.ts` `listAuditPage` — `app.ts:1792` | Keyset-paged audit log of every write above. |

### 1.3 `routes/cone.ts` — Phase 4, cone weight module (5)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/products/limits/history` | 1 | `services/productLimits.ts` `listLimitHistory` — `routes/cone.ts:46` | Every versioned limit for every product, both PDAS and SMS-local sources. |
| POST | `/api/products/limits/local` | 2 | `services/productLimits.ts` `setLocalLimitVersion` — `routes/cone.ts:70` | Append an SMS-local limit version; never touches PDAS. |
| GET | `/api/reconciliation` | 3 | `services/reconcile.ts` `getReconciliation` — `routes/cone.ts:110` | Cone weight totals by classification state + plausibility, for a period (within-canonical, NOT the CLI's source⇄raw⇄canonical checksum — see §5). |
| GET | `/api/machines/running` | 1 | `services/machinesRunning.ts` `getMachinesRunning` — `routes/cone.ts:131` | The product currently on each machine, from its newest cones. |
| GET | `/api/shift-check` | 1 | `services/shiftCheck.ts` `getShiftCheck` — `routes/cone.ts:146` | Plant-stored `Shift` column vs SMS-derived shift, per day (Q7 evidence). |

### 1.4 `routes/rejects.ts` — Phase 5 (2)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/rejects/by-day-code` | 1 | `services/rejects.ts` `getRejectsByDayCode` — `routes/rejects.ts:72` | Reject breakdown per production day per code, with that day's cone count/rate. |
| GET | `/api/rejects/reason` | 1 | `services/rejects.ts` `listRejectsOfDayCode` — `routes/rejects.ts:100` | One day's rejects of one code, paged — the reason-sheet list. |

### 1.5 `routes/ops.ts` — Phase 11 (2)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| POST | `/api/auth/password` | 1 | `services/admin.ts` — `routes/ops.ts:49` | Self-service password change; verifies current password; revokes other sessions; audited. |
| POST | `/api/admin/users/:id/password` | 4 | `services/admin.ts` — `routes/ops.ts:94` | Admin reset of another account's password; revokes every session of the target; audited. |

### 1.6 `routes/reports.ts` — Phase 8 (3)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/reports/header` | 1 | `services/reports/header.ts` `buildHeader` — `routes/reports.ts:167` | Print header alone (line, plant time, who, SMS version) for the register's Print button. |
| GET | `/api/reports/:type` | 1 or 3 per `REPORT_RANK[type]` | `services/reports/index.ts` `buildReport` — `routes/reports.ts:210` | One of 10 composed report types (see §1.7). |
| GET | `/api/reports/:type/export` | 3 (`EXPORT_RANK`) | `services/reports/*` `reportCsv`/`buildXlsx` — `routes/reports.ts:217` | Same report as CSV or XLSX (`?format=`); audited `export.csv`/`export.xlsx`. |

### 1.7 The 10 report types served by `GET /api/reports/:type` (`services/reports/common.ts:28-41,70-81,101-115`)

| Type | Rank | Filters accepted | Composed from |
|---|---|---|---|
| `daily` | 1 | shift | `daily.ts` |
| `shift` | 1 | shift | `shift.ts` |
| `product` | 1 | shift, station | `product.ts` |
| `station` | 1 | (none) | `station.ts` |
| `reject` | 1 | shift, station, product | `reject.ts` |
| `cone-weight` | 1 | (none) | `coneWeight.ts` |
| `sack` | 1 | shift | `sack.ts` |
| `calibration` | 1 | station | `calibration.ts` |
| `management-summary` | **3** | (none) | `summary.ts` — the one report gated above viewer/engineer, "the one page meant for the GM" |
| `machine-product` | 1 | shift, station | `machineProduct.ts` (via `services/machineProducts.ts` `getMachineProductShifts`) — added 15 Sep 2026 as IFL's answer to "sack stock per machine" (= production per machine by shift/day) |

### 1.8 `routes/calibration.ts` — Phase 9 (1)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/calibration/rules` | 1 | `services/nelson.ts` `nelsonRuleTable`/`rulesThatCannotFire` — `routes/calibration.ts:29` | The 8 Nelson pattern-detection rules, with which cannot fire on a series of N points. **Per `web/src/api.callers.test.ts:41-42`: never wired to a screen** — built for the Weight/StationSheet Details block, unreached. |

### 1.9 `routes/sacks.ts` — Phase 7 (4)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/sacks/summary` | 1 | `services/sacks.ts` `getSackSummary` — `routes/sacks.ts:79` | Sack count/kg/average/in-range share/cones-per-sack, by shift and product. |
| GET | `/api/sacks/stock` | 1 | `services/sackStock.ts` `getStockLedger` — `routes/sacks.ts:93` | Line-level stock ledger: opening/receipts/issues/consumption/adjustments/closing, per day/material. `basis:'line'`, `machineLevel.enabled:false` on every response (no machine column exists — see §4). |
| GET | `/api/sacks/movements` | 1 | `services/sackStock.ts` `listMovements` — `routes/sacks.ts:104` | Manual stock movements in a period. |
| POST | `/api/sacks/movements` | 2 | `services/sackStock.ts` `insertMovement` — `routes/sacks.ts:115` | Record one manual movement; audited via the movement row itself. |

### 1.10 `routes/changeover.ts` — new this session, HEAD `16bc219` (3)

| Method | Path | Rank | Service (file:line) | Purpose |
|---|---|---|---|---|
| GET | `/api/changeover/refs` | 1 | `services/pallets.ts` `listPackSchemas`/`listPallets` + inline SQL — `routes/changeover.ts:121` | Pickers for the changeover form: blends, counts, tube types, pack schemas, active pallets. |
| POST | `/api/changeover/plan` | 1 | `services/changeover.ts` `planChangeover` — `routes/changeover.ts:150` | Dry run: blockers/warnings, never opens the PDAS writer pool, `reachesMachine:false` always stated. |
| POST | `/api/changeover/execute` | 2 (`PDAS_WRITE_RANK`) | `services/changeover.ts` `executeChangeover` — `routes/changeover.ts:161` | Executes the changeover through the PDAS write path. 503 while `PDAS_WRITE_ENABLED` is off (current state — confirmed unset); 409 on blockers; 207 on partial (`NO_ROLLBACK`) failure. **This is IFL's stated single most important requirement (per-machine product changeover per shift, Hassan sb 15 Sep 2026) — the service existed since roadmap Wave F with zero non-test callers until this HTTP wiring landed at HEAD.** |

**404 catch-all** for unmatched `/api/*` — `app.ts:1816`.

---

## 2. Capability table

One row per distinct user-facing capability, joined to its route(s), rank, implementing service, CLI equivalent, and HTTP reachability. Capabilities with **no route** are broken out fully in §3 rather than listed here as rows with "none" — this table covers only what a route already reaches.

| Capability | What it does | Route(s) | Rank | Service (file) | CLI-only equivalent? | Unreachable data produced? |
|---|---|---|---|---|---|---|
| Session auth | Login/logout/whoami, argon2, rate-limited | `/api/auth/{login,logout,me}` | 1\* | `auth.ts` | `sms user:create`, `sms user:password` (account provisioning, not login) | No |
| Own password change | Self-service change, revokes other sessions | `/api/auth/password` | 1 | `services/admin.ts` via `routes/ops.ts` | `sms user:password` (admin-side reset, different path) | No |
| Admin password reset | Reset another user's password, revokes all their sessions | `/api/admin/users/:id/password` | 4 | `services/admin.ts` via `routes/ops.ts` | `sms user:password` | No |
| Live line state | Running/stopped/idle, shift counts, per-station activity, acquisition lag | `/api/live` | 1 | `services/live.ts` | none | No |
| Production query | Generalized filter/group over cone/sack/reject | `/api/production` | 1 | `services/production.ts` | none | No |
| Register (drill-down list + detail + export) | Cone/sack/reject record browser | `/api/events`, `/api/events/:type/:id`, `/api/events/export` | 1 / 1 / 3 | `services/register.ts` | none | No |
| Reject Pareto | Rejects by code | `/api/rejects` | 1 | `services/rejects.ts` | none | No |
| Reject by-day-code / reason sheet | The 6th drilldown dimension the gap analysis found missing | `/api/rejects/by-day-code`, `/api/rejects/reason` | 1 | `services/rejects.ts` via `routes/rejects.ts` | none | No |
| Reject code dictionary edit | Label/pass-flag/severity per code | `/api/reject-codes`, `PUT /api/reject-codes/:id` | 1 / 2 | `services/rejects.ts` | none | No |
| Weight SPC | I-MR chart, Cp/Cpk/Pp/Ppk | `/api/spc` | 1 | `services/spc.ts` | none | No |
| Reject SPC (p-chart) | Rate + burst detection | `/api/reject-spc` | 1 | `services/rejectSpc.ts` | none | No |
| Station drift / calibration advisory | Nelson-rule pattern detection, projected days-to-limit | `/api/calibration`, `/api/weight-stations` | 1 | `services/calibration.ts`, `services/weightStations.ts`, `services/nelson.ts` | none | Partially — see `services/calibration.ts` orphaned helpers in §3 |
| Calibration ledger | Log/list adjustments, restarts drift baseline | `/api/calibration/adjustments` (GET/POST) | 1 / 2 | `services/calibration.ts` | none | No |
| Nelson rule reference table | The 8 rules + which cannot fire on N points | `/api/calibration/rules` | 1 | `services/nelson.ts` via `routes/calibration.ts` | none | **Built, has a route, has NO screen caller** (`api.callers.test.ts:41-42`) |
| Product master / current product / timeline | Read product list, current product, changeover history | `/api/products`, `/api/current-product`, `/api/product-timeline` | 1 | `services/currentProduct.ts` | none | No |
| Set current product | Append-only changeover of the line-wide "current product" | `POST /api/current-product` | 2 | `services/currentProduct.ts` | none | No |
| Product-at-instant + verdict | Time-versioned limits lookup + 5-state classification | `/api/product-at` | 1 | `services/productAt.ts` | none | No |
| Product limits history / SMS-local limit write | Versioned limits, PDAS or SMS-local source | `/api/products/limits/history`, `POST /api/products/limits/local` | 1 / 2 | `services/productLimits.ts` | none | No |
| PDAS product write (create/retire/limits) | The "authorised today" pair — `CreateMaterial`, `SetMaterialStatusActive` — plus the guarded limits `UPDATE` | `POST /api/products`, `/api/products/:id/active`, `/api/products/:id/limits` | 2 | `services/pdasWrite.ts` | none | **Partially — every attempt writes `sms.product_change`, which no route reads back (§4)** |
| PDAS write status | Whether writes are enabled, for whom | `/api/product-write/status` | 1 | inline, `app.ts:1299` | none | No |
| Changeover dry-run/execute | IFL's top requirement: per-machine product changeover per shift | `/api/changeover/{refs,plan,execute}` | 1/1/2 | `services/changeover.ts` | none (service pre-existed with zero callers until HEAD) | No, now that HTTP wiring landed |
| Pallet / pack-schema reference | Active pallets, pack schemas for changeover form | `/api/changeover/refs` | 1 | `services/pallets.ts` | none | `pallets.ts:findPalletByKey` exported, only used internally — not a gap |
| Sack summary | Count/kg/avg/in-range/cones-per-sack | `/api/sacks/summary` | 1 | `services/sacks.ts` | none | No |
| Sack stock ledger | Opening/receipts/issues/consumption/closing, line-level only | `/api/sacks/stock` | 1 | `services/sackStock.ts` | none | No — but see §4 for the machine column that structurally cannot exist |
| Sack manual movements | Record/list manual stock adjustments | `/api/sacks/movements` (GET/POST) | 1 / 2 | `services/sackStock.ts` | none | No |
| Weight consistency (Q4/Q5) | Distribution, outliers, giveaway, basis toggle | `/api/weights` | 1 | `services/weights.ts` | none | **Superseded** — `getWeights` wrapper has no screen caller (`api.callers.test.ts:49-50`); `/api/spc` + `/api/weight-stations` replaced it |
| Station table (legacy) | `/api/calibration`'s `getStationDrift` | `/api/calibration` | 1 | `services/calibration.ts` | none | **Superseded** — `getCalibration` wrapper has no screen caller (`api.callers.test.ts:51-52`); `/api/weight-stations` is the one station table per CLAUDE.md rule 6 |
| Legacy period report | `/api/report` | `/api/report` | 1 | `services/report.ts` | none | **Superseded** — `getReport` wrapper has no screen caller (`api.callers.test.ts:59-60`); `/api/reports/daily` replaced it. Route still live and functional. |
| 10 composed reports + CSV/XLSX export | See §1.7 | `/api/reports/*` | 1/3/3 | `services/reports/*` | none | No |
| Downtime / stoppage patterns | Inferred stoppages, MTBF/MTTR | `/api/downtime` | 1 | `services/downtime.ts` | none | `getDowntime` wrapper: only its `stoppageCount`/`stoppedSeconds` subset reaches a screen via the daily report; the full stoppage list, hourly buckets, MTBF/MTTR, availabilityPct are computed and returned but **not otherwise displayed** (`api.callers.test.ts:39-40`) |
| Reconciliation (period, within-canonical) | Weight totals by state+plausibility | `/api/reconciliation` | 3 | `services/reconcile.ts` | none (distinct from `sms verify`, §5) | `getReconciliation` wrapper has **no screen caller at all** — "designed, not yet wired to Report" (`api.callers.test.ts:37-38`) |
| Shift-check (Q7 evidence) | Plant-stored vs SMS-derived shift, per day | `/api/shift-check` | 1 | `services/shiftCheck.ts` | none | Not verified whether any screen calls `getShiftCheck` — not in `ALLOW_LIST`, implying it does have a caller; not independently confirmed in this pass |
| Machines-running | Product currently on each machine | `/api/machines/running` | 1 | `services/machinesRunning.ts` | none | No |
| Sync/DQ operations roll-up | Sync health, schema-fingerprint status, DQ findings | `/api/operations` | 1 | `services/operations.ts` | `sms summary`, `sms epoch:list` overlap partially | Partial — `archived_below_id`/`archived_observed_utc` not surfaced (§4) |
| Admin: users/line/machines/stations/sources/rules/audit | Full Setup CRUD | `/api/admin/*` | 4 | `services/admin.ts`, `services/lineConfig.ts`, `services/audit.ts` | `sms user:create` overlaps user creation only | No |

\* rank "1\*" = public, before the auth floor.

---

## 3. Backend capabilities with NO route at all

Searched every exported function in `sms/api/src/services/*.ts` (32 files) and `services/reports/*.ts` (12 files) for a caller in `app.ts` or any `routes/*.ts`. Method: `grep -rl` for each exported name across `app.ts`, `routes/*.ts`, `services/reports/*.ts`, `services/*.ts`, excluding test files and the exporting file itself, then manually verified each hit that looked substantive (constants and internal helpers filtered out).

| Capability | What it would surface | File:line | What exposing it would take |
|---|---|---|---|
| **`listAudit`** | A flat, non-paged read of the audit log (`SELECT TOP N * FROM sms.audit_log ORDER BY audit_id DESC`) | `services/audit.ts:226` | Nothing calls this anywhere in the codebase (not `app.ts`, not any route, not the CLI, not a test beyond its own). It appears to be **dead code superseded by `listAuditPage`** (the keyset-paged version `/api/admin/audit` actually uses, added roadmap Phase 11). Confirm it is unused, then either delete it or document why it is kept. Not a "missing feature" — a cleanup candidate. |
| **Reject/cone filter-binding helpers** (`bindRejectFilters`, `bindConeFilters`, `codeParamOf` in `services/rejects.ts`) | Internal SQL-parameter binding | `services/rejects.ts` | Not a capability — these are implementation helpers used by the exported query functions that ARE routed (`getRejectPareto`, `getRejectsByDayCode`, etc.). Listed here only to record they were checked and are not orphaned features. |
| **`checkLimitWindowSane` / `checkNotFuture`** (`services/productLimits.ts`) | Validation helpers used internally by `setLocalLimitVersion` (which IS routed at `POST /api/products/limits/local`) | `services/productLimits.ts` | Not orphaned — internal to a routed function. |

**Overall finding for this section: very few true orphans at the exported-function level.** The codebase's own `web/src/api.callers.test.ts` guard test (added in the 16 Sep 2026 API-wrapper audit, `web/src/api.callers.test.ts:1-130`) already performs a stricter version of this check one layer up — at the client-wrapper-to-screen level — and is the more informative source for "built but unreachable," because a route can exist and still have zero UI path to it. Its `ALLOW_LIST` (`web/src/api.callers.test.ts:35-61`) names 11 such wrappers, split into two kinds:

**(a) Route exists, works, but is not wired to any screen** (3): `getReconciliation` (`/api/reconciliation`, rank 3 — "designed, not yet wired to Report", `DEV-PLAN-2026-09-15.md` task N11), `getDowntime` (`/api/downtime` — only a subset reaches the daily report; the full stoppage list/MTBF/MTTR/availabilityPct do not reach any screen), `getCalibrationRules` (`/api/calibration/rules` — built for a Details block that was never wired).

**(b) Route exists, but a newer wrapper on the SAME endpoint is what screens actually call** — the old wrapper is effectively dead weight, not a gap (8): `adminGetAudit`→`adminGetAuditPage`, `getRejects`→`getRejectsFiltered`, `getWeights`→`getSpc`+`getWeightStations`, `getCalibration`→`getWeightStations`, `getCalibrationAdjustments`→`listAdjustments`, `recordCalibrationAdjustment`→`recordAdjustment`, `getRejectSpc`→`getRejectSpcFiltered`, `getReport`→`getReportOf('daily', …)`.

These 11 are cited in full in the capability table (§2) against their routes. **Category (a) is the actionable list for a frontend audit: three working, ranked, tested API routes with real data behind them and no screen that calls them.**

---

## 4. Data captured but never served

Checked every `CREATE TABLE sms.*` / `sms_raw.*` in `sms/db/migrations/*.sql` (39 tables) against every `SELECT`/`FROM` in `sms/api/src/**/*.ts` (excluding tests). Three genuine gaps found; the rest of the schema is read somewhere in the API.

| Table / column | Grain | Written by | Read by any route? | Finding |
|---|---|---|---|---|
| **`sms.product_change`** (migration `027_product_limit_history.sql:75`, widened by `036`) | One row per PDAS write **attempt** — create/retire/limits/blend/count/tube/pallet, success or refused, including `outcome='disabled'` rows recorded while `PDAS_WRITE_ENABLED` is off | `services/pdasWrite.ts:379` (every real attempt) and `services/changeover.ts:390` (`recordDisabledAttempt`, every disabled changeover attempt) | **No.** `grep -rn "FROM sms.product_change" api/src` returns zero hits anywhere in the API. | This is the single most complete write-audit trail in the schema — every product/pallet/limit change or refusal, who tried it, when, with what result — and it has **no read path at all**, not even through the generic `sms.audit_log`/`/api/admin/audit` (that table logs configuration writes; `product_change` is a separate, PDAS-specific domain log). A screen showing "what has anyone tried to change on PDAS, and did it work" does not exist and cannot be built without a new route. |
| **`sms.source_epoch.archived_below_id` / `.archived_observed_utc`** (migration `037_archived_floor.sql`, columns added 15/16 Sep 2026) | The lowest source `id` SMS has actually observed the live source still holding, and when that floor last rose — i.e., proof that a gap in SMS's own records is IFL's own archiving, not data loss | `sync-worker/src/epoch.ts` `observeArchivedFloor()`, once per table per sync pass | **No.** `grep -rn "archived_below_id\|archived_observed_utc" api/src` returns zero hits. `/api/operations` reads `sms.source_epoch` extensively (`services/operations.ts:174-198,324`) for fingerprint/label/status but not these two columns. | Brand-new columns (this week) whose entire purpose is to make `sms verify`'s per-generation reconciliation survive IFL pruning its own old rows without a false "data loss" alarm — see §5. They inform an operator narrative ("the gap below id X is IFL's own retention, confirmed as of date Y") that currently exists only in `sms verify`'s console output, never in the Setup/Operations screen a manager would actually look at. |
| **`sms.rebuild_audit`** (migration `010_app_config_and_rebuild.sql:19`) | One row per `sms rebuild` CLI invocation: table, snapshot id, timing | `sms rebuild` CLI (`cli/src/commands/rebuild.ts`) | **No.** No `SELECT ... FROM sms.rebuild_audit` anywhere in `api/src`. | Lower-value than the two above — an operational/maintenance log for a CLI-only action (§5). Worth noting for completeness rather than as a UI gap: exposing it only matters if the roadmap ever puts rebuilds in front of a non-technical user, which nothing today asks for. |
| **`sms.app_config`** (migration `010_app_config_and_rebuild.sql:8`) | Key/value app settings | Not verified which process writes it; no `SELECT` from it found in `api/src` | **No route reads it directly** (not verified whether the sync-worker or CLI reads it — out of scope for this pass to trace exhaustively) | Likely internal plumbing, not a user-facing capability. Flagged for completeness; not recommended as a UI-exposure candidate without further investigation of what it actually stores. |
| **`sms.schema_migration`** (migration `022_schema_migration_history.sql:14`) | Migration-apply history | The migration runner itself | No | Infrastructure bookkeeping, not a product capability — expected to be unserved. |

**Everything else in the 39-table schema** (`sack1_TP1U2`-derived `sms.cone_event`/`sms.sack_event`/`sms.reject_event`, the four `sms_raw.*` tables, `sms.product`/`blend`/`yarn_count`/`tube_type`, `sms.product_timeline`/`product_limit_version`, `sms.calibration_adjustment`, `sms.audit_log`, `sms.dq_finding`, `sms.plant`/`plant_unit`/`line`/`machine`/`data_source`/`source_table`, `sms.role`/`app_user`/`session`, `sms.sack_stock_movement`, `sms.pack_schema`/`pallet`) is read by at least one route documented in §1 — confirmed by grep for `FROM sms.<table>` / `FROM sms_raw.<table>` against each table name across `api/src`.

---

## 5. CLI-only capabilities

`sms/cli/src/commands/` — 8 command files (`cutover`, `epoch`, `rebuild`, `retention`, `summary`, `sync`, `user`, `verify`), each a terminal command run on the plant PC. None of these has any corresponding route — the CLI and the API are entirely separate entry points into the same database, and nothing in `app.ts` or `routes/*.ts` shells out to or wraps the CLI.

| Command | What it does | File | HTTP equivalent? |
|---|---|---|---|
| **`sms verify [--weights] [--from=Y] [--to=Y]`** | **The flagship CLI-only capability.** Reconciles source ⇄ raw ⇄ canonical **per source generation** (`sms.source_epoch`), using COUNT/MIN(id)/MAX(id)/SUM(id) as a checksum, diagnosing the *direction* of any mismatch (source-ahead vs we-ahead vs same-range-different-rows) — see the `diagnose()` function's reasoning, `cli/src/commands/verify.ts:399-431`. As of 16 Sep 2026 it also scopes the raw-side comparison to IFL's own archived floor (migration 037, §4) so a normal monthly prune by IFL does not read as permanent data loss. `--weights` additionally reconciles weight sums. Output is `console.log` only. | `cli/src/commands/verify.ts` | **None.** `/api/reconciliation` (§1.3, rank 3) is a *different* thing — it aggregates **within** canonical for a display period (state × plausibility), not source⇄raw⇄canonical id/checksum reconciliation across generations. `/api/operations` shows sync pass outcomes and DQ findings, not a reconciliation checksum. This is exactly the capability the coordinator flagged: **a complete, non-trivial reconciliation feature that exists solely as a terminal command on the plant PC, which no IFL user will ever open.** Prime candidate for exposure — even a read-only admin screen showing the last `sms verify` result (or triggering it on demand) would surface it. |
| **`sms epoch:list`** | Lists every source generation known per table: id, label, open/closed, row-count bounds, fingerprint | `cli/src/commands/epoch.ts:22` | Partial — `/api/operations` shows the **open** epoch's fingerprint/label per table (`services/operations.ts:26-45`), not the full generation history `epoch:list` prints. |
| **`sms epoch:accept --all\|--table=<t> --confirm [--label] [--provenance]`** | Registers a new source generation as open; required after IFL recreates a source table (as happened 5 Aug 2026) or the worker halts indefinitely | `cli/src/commands/epoch.ts:105` | **None.** This is an operator decision by design (the file's own header: "deliberately an operator act, not something the worker does for itself") — a write action, not obviously a candidate for a non-technical screen, but currently has zero visibility outside the terminal even as a read/notification. |
| **`sms epoch:purge --epoch=N,M --confirm`** | Deletes closed epoch rows (and their now-orphaned raw/canonical data) | `cli/src/commands/epoch.ts:333` | None. |
| **`sms epoch:drop --epoch=N --confirm`** | Drops a single epoch registration | `cli/src/commands/epoch.ts:446` | None. |
| **`sms rebuild --table=<t> --snapshot-id=<id>`** | Rebuilds one canonical table from raw at the current transform version; hard-gated on a snapshot-id and no in-flight worker pass; writes `sms.rebuild_audit` (§4) | `cli/src/commands/rebuild.ts:47` | None. Necessary after a shift-rule change (per `app.ts:1747-1755`'s own response text, which tells the admin to run this command by hand). |
| **`sms retention [--dry-run]`** | Prunes `sms.sync_run` (>90d, keeps newest per table), `sms.dq_finding` (>365d, except critical), expired `sms.session` rows; never touches `audit_log`/`product_change`; states its policy on raw/canonical retention is IFL's decision, not made | `cli/src/commands/retention.ts:104` | None — an operational housekeeping job, reasonably CLI/scheduled-task-only. |
| **`sms cutover --confirm --backup=<path>`** | Destructive reset: deletes ALL raw+canonical data and epoch rows (three gates: backup file must exist, no worker pass in flight, transform lock held); preserves users/product timeline/reject labels/rules/adjustments/audit | `cli/src/commands/cutover.ts:66` | None — deliberately not a web action; a destroy-everything-reproducible operation. |
| **`sms summary [--date] [--shift]`** | Prints IFL's four priority metrics from canonical for one shift/day, honouring the configured weight basis | `cli/src/commands/summary.ts:9` | Largely superseded by `/api/report` and `/api/reports/daily`, which compute overlapping figures for a screen; not a gap so much as a terminal convenience that predates the report routes. |
| **`sms sync`** | Runs one supervised sync pass on demand (outside the continuous worker loop) | `cli/src/commands/sync.ts:19` | None — the continuous worker (`sync-worker/src/pass.ts`, `runner.ts`) is what normally does this; this is an operator's manual trigger. |
| **`sms user:create --username= --password= --role=`** | Create a user (rank-checked password policy) | `cli/src/commands/user.ts:41` | Overlaps `POST /api/admin/users` (rank 4) — this is the bootstrap path before any admin account exists. |
| **`sms user:password --username= --password=`** | Admin-recovery password reset, revokes all sessions of the account, no actor recorded (CLI has none) | `cli/src/commands/user.ts:96` | Overlaps `POST /api/admin/users/:id/password` — this is the recovery path when there is no admin session left to use that route. |

**Summary: 9 of 11 CLI commands (all but `user:create`/`user:password`, which have direct HTTP analogues for the non-bootstrap case) have no HTTP equivalent whatsoever.** `sms verify` is the highest-value one to expose: it is read-only, computationally cheap, already fully built, and answers the question ("did the sync actually get everything") that `/api/operations`'s sync-pass-outcome view cannot answer on its own.

---

## 6. The sync worker

`sms/sync-worker/src/` — continuous loop (`runner.ts` supervises `pass.ts`, which opens both DB pools, resolves the source epoch (`epoch.ts`), reads new source rows (`reader/`), transforms them to canonical (`transform/`), and persists to `sms_raw.*`/`sms.*`), plus `housekeeping.ts` and `pipeline.ts` (`runFullSync`) tying reader→transform→persist together per table per pass, recording one `sms.sync_run` row per table per pass and halting (not erroring past) on: unknown epoch/schema drift, backwards watermark, or an in-flight lock conflict with `rebuild`/`cutover`.

What it records that IS queryable via the API: `sms.sync_run` (outcome, watermark, epoch, timing) → `/api/operations`, `/api/health`. `sms.dq_finding` (transform-time data-quality findings, e.g. `stale_timestamp`) → `/api/operations`. `sms.source_epoch` (generation identity, fingerprint, open/closed) → `/api/operations` (partially — see §4 for the two unserved columns).

What it records that is **not** queryable via the API: `sms.rebuild_audit` is written by the CLI, not the worker itself, and is covered in §4/§5. Not independently verified in this pass: whether every `sms.dq_finding` field the worker can write is surfaced by `/api/operations`, or only a subset — the route file was read (`operations.ts:353`) but a field-by-field diff against the `dq_finding` migration (`009_dq_finding.sql`, `016_dq_finding_dedupe.sql`) was not performed.

---

## 7. Auth, RBAC and audit

- **Rank model** (migration `035_roles_and_answers.sql`): 1 viewer, 2 engineer, 3 manager, 4 admin, named in `sms.role`. Enforced by `requireRole(N)` (`api/src/auth.ts`) at the route level, plus the report-type-specific check inside `routes/reports.ts`'s `parse()` (`routes/reports.ts:98-112`) because a per-type rank gate cannot live in Express's route-registration order (the file's own comment explains why — a path-encoding trick could otherwise reach a route registered "later" ahead of a literal-path gate).
- **Every write path audited**: two mechanisms. `auditedWrite()` (`services/audit.ts`) commits the change and its audit row in one transaction — used for all Setup/configuration writes (rules, users, machines, stations, sources, reject codes) and password changes. Fire-and-forget `audit()` (`app.ts:163-169`) — used for events that are not configuration (login/logout, product changeover, calibration adjustments, CSV/XLSX exports) where there is no single transaction spanning the primary action.
- **Rank gates present in the code**, by rank:
  - Rank 2 (engineer): `PUT /api/reject-codes/:id`, `POST /api/calibration/adjustments`, `POST /api/current-product`, `POST /api/products*` (PDAS writes), `POST /api/products/limits/local`, `POST /api/sacks/movements`, `POST /api/changeover/execute`.
  - Rank 3 (manager): `GET /api/events/export`, `GET /api/reconciliation`, `GET /api/reports/:type/export`, `GET /api/reports/management-summary` (via `REPORT_RANK`).
  - Rank 4 (admin): every `/api/admin/*` route (14 routes).
- **Last-admin guard**: `services/admin.ts` `countActiveAdmins`/`isActiveAdmin`, enforced inside the `PATCH /api/admin/users/:id` transaction (`admin.ts:86` area) — refuses to demote/deactivate the last active admin, surfaced as a 409 (`app.ts:1474`).
- **Password policy**: shared `passwordPolicyProblem()` (`services/admin.ts`), minimum length from `PASSWORD_MIN_LENGTH` (default 10), applied identically by `POST /api/admin/users`, `POST /api/auth/password`, `POST /api/admin/users/:id/password`, and the CLI's `user:create`/`user:password`.
- **Session security**: argon2 hashing; session cookie renewal while in use (`api/src/auth.ts`); IP+username-keyed login rate limiting (`LoginRateLimiter`, `app.ts:233-240`, with the documented X-Forwarded-For bypass this closes by defaulting `trust proxy` off); every non-2xx (except 304) request logged as one JSON line with a correlation id (`app.ts:108,117-144`).

---

## 8. Reports and exports

All 10 report types are listed in §1.7 with rank and accepted filters. Export mechanics:

- `GET /api/reports/:type/export?format=csv|xlsx` — rank 3 (`EXPORT_RANK`, `services/reports/common.ts:82`), audited `export.csv`/`export.xlsx` with the period+filters as detail (`routes/reports.ts:234,240`).
- `GET /api/events/export` — the register's bulk CSV export, also rank 3, audited `export.csv` (`app.ts:933`).
- CSV attribution is in the filename and trailing rows after a blank line, never a comment header (resolved per CLAUDE.md's "Open question 4", so Excel does not mangle the first row).
- XLSX building: `services/reports/xlsx.ts` `buildXlsx`/`reportSheets`, content-type `XLSX_CONTENT_TYPE` (`services/reports/common.ts`).
- Every report and CSV/XLSX carries a `ReportHeader` (`services/reports/common.ts:131-146`): line/plant/unit name, resolved period, filters, plant-clock generation time, `generatedBy`, SMS version, and a pointer to `KPI-DEFINITIONS.md` with `approval:'awaiting'` — i.e. **every KPI on every report is explicitly marked as not yet IFL-approved**, which is a fact worth carrying into any UI that presents these as authoritative.

---

## 9. Test coverage by capability area

Per the coordinator's brief: ~1099 passing / 4 skipped (the 4 skipped are the opt-in real-SQL migration block) — figure not independently re-run in this pass; a raw `it(`/`test(` grep in this session counted 2437 occurrences across 102 `*.test.ts` files, which over-counts (includes `it.each` bodies, nested blocks, and string literals) and should not be treated as authoritative — use the coordinator's 1099 figure.

Test file distribution by area (`find ... -name "*.test.ts"`, 102 files total):

| Area | Test files |
|---|---|
| `api/src/services/` | 36 |
| `api/src/services/reports/` | 3 |
| `api/src/routes/` | 7 (one per route module: cone, rejects, ops, reports, calibration, sacks, changeover) |
| `api/src/` (app-level) | 9 |
| `sync-worker/src/` | 11 |
| `sync-worker/src/transform/` | 8 |
| `sync-worker/src/reader/` | 3 |
| `sync-worker/src/seed/` | 1 |
| `sync-worker/src/util/` | 1 |
| `cli/src/commands/` | 6 (of 8 commands — `sync.ts` and `summary.ts` have no dedicated test file at this glob depth, not independently confirmed beyond the file listing) |
| `cli/src/` | 1 |
| `shared/src/` + `domain/` + `config/` | 5 |
| `web/src/` (root + `lib/` + `screens/` + `ui/`) | 10 |
| `./test/` (top-level) | 1 |

**Named gap, confirmed by its own guard test**: `web/src/api.callers.test.ts` is itself a test *for* untested-by-UI reachability — it exists specifically because `getOee`/`getShiftAnalysis`/`getStoppagePatterns` (the three routes deleted 3 Sep 2026) survived as client wrappers pointing at 404s for days undetected. That class of defect (a route/service well-covered by its own unit tests, but with no integration test proving a screen actually reaches it) is exactly what §3's category-(a) findings are: `getReconciliation`, `getDowntime`'s unused fields, and `getCalibrationRules` are each backed by service-level tests (`reconcile.ts` presumably has coverage — not independently re-checked line-by-line in this pass) but have zero screen-level coverage because there is no screen.

**Not independently verified in this pass** (would need a full coverage-report run, out of scope for a static-read audit): whether `services/audit.ts`'s orphaned `listAudit` (§3) has its own test file separate from `listAuditPage`'s; whether every `sms.dq_finding` severity/type the worker can write has a corresponding assertion; per-route request-validation edge cases (zod schema boundary tests) beyond what was visible in the route files read directly.

---

## Summary counts

- **HTTP routes**: 75 total (4 public + 51 in `app.ts` behind the rank-1 floor + 20 across 7 `routes/*.ts` modules).
- **Service files**: 32 in `services/` + 12 in `services/reports/` = 44 (excluding `.test.ts`).
- **Report types**: 10, all served by one parameterised route (`GET /api/reports/:type`).
- **CLI commands**: 8 command files, covering 11 subcommands (`epoch:` has 4).
- **Backend capabilities with genuinely no route**: 1 clear case (`listAudit`, apparently dead code) at the service-export level; the more consequential unreachability is one layer up — **3 routes with zero screen caller** (`getReconciliation`/`/api/reconciliation`, `getCalibrationRules`/`/api/calibration/rules`, and `getDowntime`'s unused majority of fields) plus **8 superseded wrappers** whose routes still work but are no longer the path any screen takes, per `web/src/api.callers.test.ts`'s own `ALLOW_LIST`.
- **CLI-only capabilities**: 9 of 11 subcommands have no HTTP equivalent at all; `sms verify` is the standout — a complete, already-built, read-only source⇄raw⇄canonical reconciliation feature reachable only from a terminal on the plant PC.
- **Data captured but never served**: 3 genuine findings (`sms.product_change`, `sms.source_epoch.archived_below_id`/`archived_observed_utc`, `sms.rebuild_audit`), plus 2 lower-value infrastructure tables (`app_config`, `schema_migration`) noted for completeness.

## Three findings most likely to surprise the owner

1. **The changeover workflow — IFL's single most important stated requirement — was, until the commit at the current HEAD, a fully-built service (`services/changeover.ts`, dry-run + execute + blockers + `NO_ROLLBACK` partial-failure handling) with *zero non-test callers of any kind*: no route, no CLI, nothing. It became reachable over HTTP only this session (`routes/changeover.ts`, HEAD `16bc219`). This is the starkest possible instance of the "backend exists → done" failure mode the owner is auditing for — the most important capability in the whole system sat completely unreachable the longest.**

2. **`sms verify` — the only thing that actually answers "did the sync get everything" — is a terminal command on the plant PC and always will be unless someone routes it.** The API's `/api/operations` and `/api/reconciliation` both look like they might answer this and neither does: one reports pass *outcomes* (did the worker say it succeeded), the other aggregates *within* canonical for a display period. Neither compares source-side counts/checksums against what SMS actually holds, which is the one comparison that would catch silent data loss — and it is fully built, already correct (as of this week's fix for IFL's own data pruning), and completely invisible to every IFL user.

3. **Every PDAS write attempt — successful, refused, or disabled — is logged in full detail to `sms.product_change`, and nothing anywhere reads that table back.** For a write path this sensitive (it is currently OFF by client mandate, pending written authorization, and the entire justification for building it audit-first was "the vendor's own engineer hit refusals four times and it went unrecorded") the audit trail exists in the database and nowhere else — not even the generic Setup audit log, which is a different table entirely. The one screen an admin would most want after PDAS writes go live — "show me every attempt and its outcome" — requires a new route over data that has been faithfully captured all along.
