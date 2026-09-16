# SMS Backend → Frontend Exposure Matrix

**Phase 1 of the UX programme, step 3: the two independent audits joined.**
Audit only. No file under `sms/` was written, edited or deleted in producing this.

Repo: `C:/Users/ABDULLAH SAJID/Desktop/sag database`.
Branch `floor-first-rework`, HEAD `16bc219` ("Make the changeover workflow reachable over HTTP").

Inputs: [`BACKEND-INVENTORY.md`](BACKEND-INVENTORY.md) (75 routes, 44 services, 10 report
types, 12 CLI subcommands) and [`FRONTEND-INVENTORY.md`](FRONTEND-INVENTORY.md) (9 screens,
6 in the nav bar, 6 drill-downs). Where they disagreed, or where either marked something
unverified, the code was read and the point settled — see [§5](#5-contradictions-between-the-two-inventories).

---

## Contents

- [0. How to read this matrix](#0-how-to-read-this-matrix)
- [1. The matrix](#1-the-matrix)
  - [1.1 Line and live state](#11-line-and-live-state)
  - [1.2 Readings and the register](#12-readings-and-the-register)
  - [1.3 Cone weight, SPC, station drift and calibration](#13-cone-weight-spc-station-drift-and-calibration)
  - [1.4 Rejects](#14-rejects)
  - [1.5 Sacks and the stock ledger](#15-sacks-and-the-stock-ledger)
  - [1.6 Products, limits and the PDAS write path](#16-products-limits-and-the-pdas-write-path)
  - [1.7 Changeover and machine-by-product](#17-changeover-and-machine-by-product)
  - [1.8 Reports and exports](#18-reports-and-exports)
  - [1.9 Operations, sync health and data integrity](#19-operations-sync-health-and-data-integrity)
  - [1.10 Auth, users, roles and audit](#110-auth-users-roles-and-audit)
- [2. The headline count](#2-the-headline-count)
- [3. Action lists](#3-action-lists)
- [4. Capability and action tallies](#4-capability-and-action-tallies)
- [5. Contradictions between the two inventories](#5-contradictions-between-the-two-inventories)
- [6. What this matrix cannot tell you](#6-what-this-matrix-cannot-tell-you)

---

## 0. How to read this matrix

**Four states, not one.** This project keeps collapsing them, and each collapse has cost a
release. They need four different fixes:

| State | Question | Failure looks like |
|---|---|---|
| **Built** | Does the service logic exist and work? | Nothing. The test suite is green and the feature does not exist for anyone. |
| **Routed** | Is it exposed over HTTP with a rank? | `sms verify` — a complete reconciliation engine that only a terminal on the plant PC can reach. |
| **Rendered** | Does a component draw it? | `/api/reconciliation` — rank 3, tested, returns real data, and `web/src/api.ts:1554`'s wrapper has no caller. |
| **Discoverable** | Would a user who was never told find it? | The changeover timeline: real, rendered, correct — behind a Change button, inside a sheet, inside a `<Details>` disclosure. |

### Column definitions

- **Backend** — does the service logic exist? `✓` / `partial` / `✗`, with `path:line`.
- **API** — exposed over HTTP? `✓` / `partial` / `✗`, with the route and the minimum rank.
  Rank model (migration 035): **1 viewer · 2 engineer · 3 manager · 4 admin**.
  `app.use('/api', requireRole(1))` at `sms/api/src/app.ts:293` is the floor for everything
  registered after it.
- **Frontend** — is there a component that renders it? `✓` / `partial` / `✗`, with the file.
- **Reachable?** — can a *signed-in user of the web app* get to it at all, including by typing
  a URL. A route with no client code is **not** reachable by this definition: reaching it needs
  `curl`. A CLI command is not reachable by this definition either. Both are noted as such.
- **Discoverable?** — would a user who has not been told it exists ever find it? This is the
  owner's actual complaint and the column most likely to read `✗` where the rest read `✓`.
- **Action** — one of **Expose** · **Route** · **Surface** · **Decide** · **Build** · **None**.

### Confidence

Every `✓` and `✗` below is backed by a citation that was opened and read in this pass. Two
rows carry `?` and say why. A wrong `✓` here sends the next phase to rebuild something that
already exists, so where a claim in either inventory could not be re-derived from code it was
downgraded rather than repeated.

---

## 1. The matrix

### 1.1 Line and live state

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Live line state** — running/stopped/idle, this-shift counts, per-station activity, measured acquisition lag | ✓ `services/live.ts` | ✓ `GET /api/live` — `app.ts:354` · rank 1 | ✓ `screens/Line.tsx`, `lib/live.tsx` | ✓ landing page | ✓ default screen | **None** |
| **Attention findings** — station drift, reject rise, outside-product-limits, over a fixed 14-day window | ✓ `services/attention.ts:139,208,305` | ✓ `GET /api/attention` — `app.ts:434` · rank 1 | ✓ `Line.tsx:142-157`, `Wall.tsx:35` | ✓ | ✓ second block on Line | **None** |
| **Acquisition lag and the two clocks** — line judged against `now − lag`, never the browser clock | ✓ `services/live.ts`, `services/plantClock.ts` | ✓ within `/api/live` · rank 1 | ✓ `ui/Bar.tsx:226-261` health strip | ✓ | ✓ on every screen | **None** |
| **Replay** (`?at=<ISO>`) — move the plant clock for a demo or a verification | ✓ `config.ts:352` `liveAllowAsOf`; refused with 400 when off — `app.ts:362` | ✓ `at=` on `/api/live` · rank 1 | partial — the *banner* and "Leave replay" exist (`App.tsx:246-251`); **nothing enters replay** | ✓ typed URL only | ✗ no control anywhere creates an `?at=` URL | **Decide** |
| **Wall display** — fullscreen board for a TV, no nav, pinned footer | ✓ served by `/api/live` + `/api/attention` | ✓ rank 1 | ✓ `screens/Wall.tsx` | ✓ | ✓ **Wall** button — `Bar.tsx:317-319` | **None** |
| **Production-day range** — the days the date pickers may offer, clock-fault days excluded | ✓ inline SQL `app.ts:317` | ✓ `GET /api/range` · rank 1 | ✓ period control, `Rejects.tsx` | ✓ | ✓ | **None** |
| **Line / machine / station configuration (read)** | ✓ `services/lineConfig.ts`, `services/admin.ts` `listStations` | ✓ `GET /api/config` `app.ts:411`, `GET /api/stations` `app.ts:391` · rank 1 | ✓ every screen's station labels | ✓ | ✓ | **None** |

### 1.2 Readings and the register

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Cone readings register** — paged, filtered by station/state/period | ✓ `services/register.ts` `listEvents` | ✓ `GET /api/events` — `app.ts:895` · rank 1 | ✓ `screens/Readings.tsx` | ✓ | ✓ nav bar | **None** |
| **Sack register** | ✓ same service, `type=sack` | ✓ same route · rank 1 | ✓ `Readings.tsx:57`, `Sacks.tsx:438` | ✓ | ✓ | **None** |
| **Reject register** | ✓ same service, `type=reject` | ✓ same route · rank 1 | ✓ `Readings.tsx:57` | ✓ | ✓ | **None** |
| **Reading detail sheet + provenance** — source table, generation, insert vs production time, transform version, attribution method | ✓ `services/register.ts` `getEventDetail` | ✓ `GET /api/events/:type/:id` — `app.ts:939` · rank 1 | ✓ `screens/ReadingSheet.tsx` (+ `lib/provenance.ts`) | ✓ | ✓ click any row | **None** |
| **Sack ↔ cone approximate linkage** — "about N cones between the previous sack and this one", caveat printed | ✓ `ReadingSheet.tsx:348` re-queries by timestamp | ✓ via `/api/events` · rank 1 | ✓ `ReadingSheet.tsx:141` + `words.ts:323-324` | ✓ | ✓ on every sack sheet | **None** |
| **Generalized production query** — filter and group over cone/sack/reject | ✓ `services/production.ts` | ✓ `GET /api/production` — `app.ts:713` · rank 1 | ✓ `Line.tsx`, `Weight.tsx` | ✓ | ✓ (as the figures it feeds) | **None** |
| **Register CSV export** | ✓ `services/register.ts` `exportEventsCsv` | ✓ `GET /api/events/export` — `app.ts:918` · **rank 3** | ✓ `Readings.tsx:238-239` | ✓ rank 3+ | ✓ rank 3+ · deliberately absent below rank 3 (`App.tsx:67-71`) | **None** |
| **Register XLSX export** | ✗ — `exportEventsCsv` only; the route hard-sets `text/csv` (`app.ts:926`) | ✗ | ✗ `eventsExportUrl` takes no `format` (`api.ts:631`) | ✗ | ✗ | **Build** |
| **Register print** | n/a (client-side) | n/a | ✓ `Readings.tsx:243` + `@media print` `app.css:799` | ✓ | ✓ button beside Export | **None** |

### 1.3 Cone weight, SPC, station drift and calibration

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Cone weight SPC** — I-MR chart, Cp/Cpk/Pp/Ppk | ✓ `services/spc.ts:184,297` | ✓ `GET /api/spc` — `app.ts:765` · rank 1 | ✓ `screens/Weight.tsx:90` | ✓ | ✓ nav bar | **None** |
| **Sack weight SPC** — the same engine, `type='sack'` | ✓ `services/spc.ts:297` takes `SpcType = 'cone' \| 'sack'` | ✓ same route accepts `type=sack` — `app.ts:789-791` · rank 1 | ✗ **`Weight.tsx:91,108` hardcode `type: 'cone'`; no caller in `web/src` ever sends `sack`** | ✗ curl only | ✗ | **Expose** |
| **Station table** — per-station bias against the line *and* against target (CLAUDE.md rule 6: one such table in the app) | ✓ `services/weightStations.ts` | ✓ `GET /api/weight-stations` — `app.ts:594` · rank 1 | ✓ `Weight.tsx:534` | ✓ | ✓ | **None** |
| **Station drift detection (Nelson violations)** | ✓ `services/nelson.ts:101` via `calibration.ts`, `spc.ts`, `weightStations.ts` | ✓ within `/api/weight-stations`, `/api/spc`, `/api/attention` · rank 1 | ✓ Weight's Pattern column, Line's attention list | ✓ | ✓ | **None** |
| **Drift projection** — "reaches the action limit in about N days, if it continues at that rate" | ✓ `services/calibration.ts` | ✓ within `/api/weight-stations` · rank 1 | ✓ `StationSheet.tsx:294-303`, `Line.tsx:397-398` | ✓ | ✓ | **None** |
| **Nelson rule reference table** — the 8 rules, and which cannot fire on a series of N points | ✓ `services/nelson.ts:69,74` | ✓ `GET /api/calibration/rules` — `routes/calibration.ts:29` · rank 1 | ✗ `getCalibrationRules` (`api.ts:1683`) has no caller — `api.callers.test.ts:41-42` | ✗ curl only | ✗ | **Decide** |
| **Calibration ledger (read)** — adjustments by date/station | ✓ `services/calibration.ts` `listCalibrationAdjustments` | ✓ `GET /api/calibration/adjustments` — `app.ts:1113` · rank 1 | ✓ `StationSheet.tsx`, `report/Calibration.tsx` | ✓ | ✓ inside the station sheet | **None** |
| **Record a calibration adjustment** — restarts that station's drift baseline | ✓ `services/calibration.ts` `recordCalibrationAdjustment` | ✓ `POST /api/calibration/adjustments` — `app.ts:1147` · rank 2 | ✓ `StationSheet.tsx` (`canAdjust`, `App.tsx:334`) | ✓ rank 2+ | ✓ rank 2+ | **None** |
| **Weight basis rule** — as-recorded / gross / net, tube and tare | ✓ `services/admin.ts` `setWeightRule` | ✓ `POST /api/admin/rules/weight` — `app.ts:1685` · rank 4 | ✓ `setup/RulesBlock.tsx` | ✓ admin | ✓ admin (gear → Setup → Rules) | **None** |
| **Weight distribution / outliers / giveaway** *(legacy)* | ✓ `services/weights.ts` | ✓ `GET /api/weights` — `app.ts:1051` · rank 1 | ✗ `getWeights` has no caller — `api.callers.test.ts:49-50` | ✗ curl only | ✗ — **superseded** by `/api/spc` + `/api/weight-stations`, which *are* discoverable | **Decide** |
| **Station drift view** *(legacy route)* | ✓ `services/calibration.ts` `getStationDrift` | ✓ `GET /api/calibration` — `app.ts:1072` · rank 1 | ✗ `getCalibration` has no caller — `api.callers.test.ts:51-52` | ✗ curl only | ✗ — **superseded** by `/api/weight-stations` | **Decide** |

### 1.4 Rejects

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Reject Pareto by code** | ✓ `services/rejects.ts` `getRejectPareto` | ✓ `GET /api/rejects` — `app.ts:961` · rank 1 | ✓ `screens/Rejects.tsx` | ✓ | ✓ nav bar | **None** |
| **Reject p-chart with burst detection** | ✓ `services/rejectSpc.ts` | ✓ `GET /api/reject-spc` — `app.ts:799` · rank 1 | ✓ `Rejects.tsx` trend chart | ✓ | ✓ | **None** |
| **Reject breakdown per day per code** | ✓ `services/rejects.ts` `getRejectsByDayCode` | ✓ `GET /api/rejects/by-day-code` — `routes/rejects.ts:72` · rank 1 | ✓ `Rejects.tsx:731` `ByDayTable` | ✓ | ✓ | **None** |
| **Reason sheet** — one day's rejects of one code, paged | ✓ `services/rejects.ts` `listRejectsOfDayCode` | ✓ `GET /api/rejects/reason` — `routes/rejects.ts:100` · rank 1 | ✓ `screens/ReasonSheet.tsx` | ✓ | ✓ click a by-day row | **None** |
| **Name a reject reason** (label only) | ✓ `services/rejects.ts` `updateRejectCode` | ✓ `PUT /api/reject-codes/:id` — `app.ts:1010` · rank 2 | ✓ inline edit on `Rejects.tsx` (`canName`, `App.tsx:295`) | ✓ rank 2+ | ✓ rank 2+ | **None** |
| **Reject code dictionary** — pass-flag and severity, not just the label | ✓ same service and route | ✓ same route · **server rank 2** | ✓ `setup/RejectCodesBlock.tsx` | ✓ **admin only in practice** | ✗ — the only UI lives in Setup, which the client gates at `rank >= 4` (`App.tsx:315`, `Bar.tsx:320`). The server would accept an engineer; no engineer can find it | **Surface** |

### 1.5 Sacks and the stock ledger

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Sack summary** — count, kg, average, in-range share, cones per sack | ✓ `services/sacks.ts` | ✓ `GET /api/sacks/summary` — `routes/sacks.ts:79` · rank 1 | ✓ `screens/Sacks.tsx` | ✓ | ✓ nav bar | **None** |
| **Sack stock ledger (line level)** — opening / receipts / issues / consumption / adjustments / closing | ✓ `services/sackStock.ts` `getStockLedger` | ✓ `GET /api/sacks/stock` — `routes/sacks.ts:93` · rank 1 | ✓ `Sacks.tsx:66`, `report/Sack.tsx` | ✓ | ✓ | **None** |
| **Stock day drill-down** | ✓ `services/sackStock.ts` `listMovements` | ✓ `GET /api/sacks/movements` — `routes/sacks.ts:104` · rank 1 | ✓ `screens/StockSheet.tsx` | ✓ | ✓ click a ledger day | **None** |
| **Record a manual stock movement** | ✓ `services/sackStock.ts` `insertMovement` | ✓ `POST /api/sacks/movements` — `routes/sacks.ts:115` · rank 2 | ✓ `Sacks.tsx` (`canRecord`, `App.tsx:305`) | ✓ rank 2+ | ✓ rank 2+ | **None** |
| **Sack stock PER MACHINE** | ✗ — structurally impossible from IFL's data: `sack1_TP1U2` has no machine column. Every response states so: `machineLevel: { enabled: false, reason }` — `sackStock.ts:124,334,547` | ✗ | ✓ *the refusal* is rendered with the server's own reason — `Sacks.tsx:318` | n/a | n/a | **None** — IFL's 15 Sep 2026 answer redefines "stock" as production per shift, which the machine-product report delivers |

### 1.6 Products, limits and the PDAS write path

The whole product/PDAS cluster shares one discoverability chain, and it is the longest in
the app: **Line → the "Change" button (rank ≥ 2 only, `Line.tsx:437`) or the "History" link
in a block note (`Line.tsx:165`) → `ProductSheet` → a `<Details>` disclosure
(`ProductSheet.tsx:265`) → the forms.** Nothing in the nav bar names products; no other
screen links here.

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Product master list** | ✓ `services/currentProduct.ts` `listProducts` | ✓ `GET /api/products` — `app.ts:1221` · rank 1 | ✓ `ProductSheet.tsx:52` | ✓ | ✓ *only as the label on Line's product block* | **None** |
| **Current product** | ✓ `services/currentProduct.ts` `getCurrent` | ✓ `GET /api/current-product` — `app.ts:1229` · rank 1 | ✓ `Line.tsx` product block | ✓ | ✓ | **None** |
| **Changeover history / product timeline** | ✓ `services/currentProduct.ts` `listTimeline` | ✓ `GET /api/product-timeline` — `app.ts:1239` · rank 1 | ✓ `ProductSheet.tsx` | ✓ | ✗ behind a `linkish` button rendered as a block *note* (`Line.tsx:165`) | **Surface** |
| **Set the running product** (append-only timeline; audited `product.changeover`) | ✓ `services/currentProduct.ts` `setCurrent` | ✓ `POST /api/current-product` — `app.ts:1248` · rank 2 | ✓ `ProductSheet.tsx:125` `ChangeForm` | ✓ rank 2+ | ✗ two levels below a button labelled only "Change" | **Surface** |
| **Product-at-instant + 5-state verdict** — time-versioned limits, never today's mirror | ✓ `services/productAt.ts` | ✓ `GET /api/product-at` — `app.ts:513` · rank 1 | ✓ `Line.tsx`, `ReadingSheet.tsx` | ✓ | ✓ | **None** |
| **Product limits history** — every versioned limit, PDAS and SMS-local | ✓ `services/productLimits.ts` `listLimitHistory` | ✓ `GET /api/products/limits/history` — `routes/cone.ts:46` · rank 1 | ✓ `product/ProductLimitsBlock.tsx` | ✓ | ✗ rendered in two buried places: `ProductSheet.tsx:141` and `setup/RulesBlock.tsx:61` (admin) | **Surface** |
| **SMS-local limit version write** (never touches PDAS) | ✓ `services/productLimits.ts` `setLocalLimitVersion` | ✓ `POST /api/products/limits/local` — `routes/cone.ts:70` · rank 2 | ✓ `ProductLimitsBlock.tsx` — decides its own visibility from the server, not a client constant | ✓ rank 2+ | ✗ same chain | **Surface** |
| **PDAS product write — create / retire / change limits** (the two rights IFL confirmed 11 Sep 2026, plus the guarded limits `UPDATE`) | ✓ `services/pdasWrite.ts:440,542,634` | ✓ `POST /api/products` `app.ts:1348`, `POST /api/products/:id/active` `app.ts:1374`, `POST /api/products/:id/limits` `app.ts:1393` · rank 2 (`PDAS_WRITE_RANK`); 503 while `PDAS_WRITE_ENABLED` is off | ✓ `ProductSheet.tsx:130` `PdasProducts`, inside a collapsed `<Details>` | ✓ rank 2+ | ✗ four levels deep, behind a disclosure with no outside signpost | **Surface** |
| **PDAS write status** — whether writes are on, and for whom | ✓ inline `app.ts:1299` | ✓ `GET /api/product-write/status` · rank 1 | ✓ `ProductSheet.tsx:258`, `ProductLimitsBlock.tsx` | ✓ | ✓ *within* the block it explains | **None** |
| **Product option pickers** (blend / count / tube type) | ✓ inline SQL `app.ts:1310` | ✓ `GET /api/product-options` · rank 1 | ✓ `ProductSheet.tsx` create form | ✓ rank 2+ | ✗ same chain | **None** |
| **PDAS add blend / add count / add tube type** | ✓ `pdasWrite.ts:847,898,953` | partial — **no standalone route**; reachable only as steps *inside* `POST /api/changeover/execute` (`changeover.ts:430,436,442`) | ✗ | ✗ | ✗ | **Route** |
| **PDAS create pallet / retire pallet** | ✓ `pdasWrite.ts:1105,1178` | partial — same: steps inside `/api/changeover/execute` (`changeover.ts:474,484`) | ✗ | ✗ | ✗ | **Route** |
| **Pallet and pack-schema reference (read)** | ✓ `services/pallets.ts:47,76` | ✓ within `GET /api/changeover/refs` — `routes/changeover.ts:121` · rank 1 | ✗ no client wrapper exists for `/api/changeover/*` | ✗ curl only | ✗ | **Expose** |
| **PDAS `product_change` audit trail** — one row per write *attempt*: create, retire, limits, blend, count, tube, pallet; success, refusal, or `outcome='disabled'` | ✓ written on every attempt — `pdasWrite.ts:379`, `changeover.ts:390` | ✗ **`grep "FROM sms.product_change" api/src` → zero hits.** Not in `sms.audit_log` either; it is a separate table | ✗ | ✗ | ✗ | **Route** |

### 1.7 Changeover and machine-by-product

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Changeover workflow** — pickers, dry-run plan with blockers and warnings, and execute through the PDAS write path (IFL's stated single most important requirement) | ✓ `services/changeover.ts` — plan, blockers, `NO_ROLLBACK` partial-failure handling | ✓ `GET /api/changeover/refs` `routes/changeover.ts:121` · rank 1 · `POST /api/changeover/plan` `:150` · rank 1 · `POST /api/changeover/execute` `:161` · rank 2 | ✗ **no client representation whatsoever** — `grep -r changeover web/src` returns only comments and report labels; `api.ts` has no `planChangeover`, no `executeChangeover`, no `getChangeoverRefs` | ✗ curl only | ✗ | **Expose** |
| **Machines running** — the product each machine is on now, from its newest cones | ✓ `services/machinesRunning.ts` | ✓ `GET /api/machines/running` — `routes/cone.ts:131` · rank 1 | ✓ `Line.tsx`, `StationSheet.tsx` | ✓ | ✓ a block on Line | **None** |

### 1.8 Reports and exports

All ten types are rendered as chips by one loop over `REPORT_TYPES` (`Report.tsx:128-136`),
each with its own component under `web/src/screens/report/`. Each is on screen once a reader
reaches Report, so each is discoverable; what is *not* is any way to link to one.

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Report: `daily`** | ✓ `services/reports/daily.ts` | ✓ `GET /api/reports/daily` · rank 1 (`common.ts:70-81`) | ✓ `report/Daily.tsx` | ✓ | ✓ default chip | **None** |
| **Report: `shift`** | ✓ `reports/shift.ts` | ✓ · rank 1 | ✓ `report/Shift.tsx` | ✓ | ✓ | **None** |
| **Report: `product`** | ✓ `reports/product.ts` | ✓ · rank 1 | ✓ `report/Product.tsx` | ✓ | ✓ | **None** |
| **Report: `station`** | ✓ `reports/station.ts` | ✓ · rank 1 | ✓ `report/Station.tsx` | ✓ | ✓ | **None** |
| **Report: `reject`** | ✓ `reports/reject.ts` | ✓ · rank 1 | ✓ `report/Reject.tsx` | ✓ | ✓ | **None** |
| **Report: `cone-weight`** | ✓ `reports/coneWeight.ts` | ✓ · rank 1 | ✓ `report/ConeWeight.tsx` | ✓ | ✓ | **None** |
| **Report: `sack`** | ✓ `reports/sack.ts` | ✓ · rank 1 | ✓ `report/Sack.tsx` | ✓ | ✓ | **None** |
| **Report: `calibration`** | ✓ `reports/calibration.ts` | ✓ · rank 1 | ✓ `report/Calibration.tsx` | ✓ | ✓ | **None** |
| **Report: `management-summary`** ("the one page meant for the GM") | ✓ `reports/summary.ts` | ✓ · **rank 3**, enforced inside `parse()` — `routes/reports.ts:98-112`, `common.ts:79` | ✓ `report/Summary.tsx`; client mirror `report/model.ts:34` | ✓ rank 3+ | ✓ rank 3+; below rank 3 the chip renders and the body says "not allowed" (`Report.tsx:191`) | **None** |
| **Report: `machine-product`** — per machine, per shift; IFL's answer to "sack stock per machine" | ✓ `reports/machineProduct.ts` via `services/machineProducts.ts:127` | ✓ · rank 1 | ✓ `report/MachineProduct.tsx` | ✓ | ✓ — but it is the tenth of ten undifferentiated chips (`Report.tsx:128-136`) despite being IFL's priority | **None** |
| **Report CSV export** | ✓ `services/reports/*` `reportCsv`; attribution in the filename and trailing rows, never a comment header | ✓ `GET /api/reports/:type/export?format=csv` — `routes/reports.ts:217` · **rank 3** | ✓ `Report.tsx:113` | ✓ rank 3+ | ✓ rank 3+ | **None** |
| **Report XLSX export** | ✓ `services/reports/xlsx.ts` `buildXlsx` | ✓ same route, `format=xlsx` · rank 3 | ✓ `Report.tsx:114` | ✓ rank 3+ | ✓ rank 3+ | **None** |
| **Report PDF** — IFL's Q33–37 answer asked for "Excel **and** PDF, designed, with graphics" | ✗ no generator anywhere; the only mention is the comment recording the request — `services/reports/xlsx.ts:3` | ✗ | partial — browser print only: `Report.tsx:107` `window.print()`, `report/PrintHead.tsx`, `@media print` at `app.css:799` | ✓ (as Print) | ✓ (as Print) | **Build** |
| **Print header** — line, plant clock, who, SMS version | ✓ `services/reports/header.ts` `buildHeader` | ✓ `GET /api/reports/header` — `routes/reports.ts:167` · rank 1 | ✓ `report/PrintHead.tsx` | ✓ | ✓ (appears on print) | **None** |
| **Shareable report state** — send a colleague the report you are looking at | n/a | ✓ the route takes type + filters | ✗ type and filters live in component state, not the URL — `Report.tsx:53,54`; `App.tsx` carries no report parameter | ✗ | ✗ a pasted link always lands on `daily`, unfiltered | **Surface** |
| **Legacy period report** (`/api/report`) | ✓ `services/report.ts` | ✓ `GET /api/report` — `app.ts:658` · rank 1 | ✗ `getReport` has no caller — `api.callers.test.ts:59-60` | ✗ curl only | ✗ — **superseded** by `/api/reports/daily` | **Decide** |
| **Downtime / stoppage detail** — full stoppage list, hourly buckets, MTBF, MTTR, `availabilityPct` | ✓ `services/downtime.ts:111,184-190` | ✓ `GET /api/downtime` — `app.ts:745` · rank 1 | partial — only `stoppageCount` / `stoppedSeconds` reach a screen, and via a *different* route (`reports/daily.ts:98-99`, `reports/summary.ts:118-119`). `getDowntime` itself has no caller — `api.callers.test.ts:39-40` | ✗ (the detail) | ✗ | **Decide** |

### 1.9 Operations, sync health and data integrity

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Sync health** — verdict, last pass, per-table outcome, watermark, generation label, halt reason and the command that clears it | ✓ `services/operations.ts` | ✓ `GET /api/operations` — `app.ts:703` · rank 1 | ✓ `health/SyncHealthBlock.tsx` (one component, two parents: `Health.tsx:40`, `Setup.tsx:53`) | ✓ | ✗ **Health's only entry is one sentence in the strip styled as a `<button className="strip-link">`** — `Bar.tsx:254-260`. No nav item, no link from any screen body. The other parent is admin-only | **Surface** |
| **System health** — DB size against SQL Express's 10 GB cap, service version, uptime, newest backup age | ✓ `services/health.ts` | ✓ `GET /api/health` — `app.ts:203` · public (detail nulled when unauthenticated) | ✓ `screens/Health.tsx` | ✓ | ✗ same single strip sentence | **Surface** |
| **Data-quality findings** — the worker's transform-time findings, with severity (`INFO`/`WARNING`/`ERROR`/`CRITICAL`), type, table and detail | ✓ `sms.dq_finding`, written by the worker | ✓ full rows served: `dq.findings: DqFinding[]` — `api.ts:945` | partial — **rendered as a bare count of ERROR+CRITICAL** (`SyncHealthBlock.tsx:51,98`). No screen ever lists a finding, names its type or shows its detail | ✗ (the detail) | ✗ | **Expose** |
| **`sms verify` — source ⇄ raw ⇄ canonical reconciliation**, per source generation, `COUNT`/`MIN(id)`/`MAX(id)`/`SUM(id)` checksum, with mismatch-direction diagnosis and IFL's archive floor honoured | ✓ `cli/src/commands/verify.ts:399-431,483` | ✗ **no route.** `/api/operations` reports pass *outcomes*; `/api/reconciliation` aggregates *within* canonical. Neither compares the source against what SMS holds | ✗ | ✗ terminal on the plant PC only | ✗ | **Route** |
| **Within-canonical reconciliation** — weight totals by classification state × plausibility for a period | ✓ `services/reconcile.ts:71` | ✓ `GET /api/reconciliation` — `routes/cone.ts:110` · **rank 3** | ✗ `getReconciliation` (`api.ts:1554`) has no caller — `api.callers.test.ts:37-38` | ✗ curl only | ✗ | **Decide** |
| **Source generation history** — every generation per table: id, label, open/closed, row bounds, fingerprint | ✓ `cli/src/commands/epoch.ts:22` (`epoch:list`) | partial — `/api/operations` serves the **open** generation's label and fingerprint only (`SyncHealthBlock.tsx` "Generation" column); the history is not served | partial (open only) | ✗ (history) | ✗ | **Route** |
| **Archived floor** — "the gap below id X is IFL's own retention, confirmed as of Y" | ✓ `sync-worker/src/epoch.ts:237-255` observes it every pass | ✗ **`grep archived_below_id api/src` → zero hits.** Exists only in `sms verify`'s console output (`verify.ts:578,609`) | ✗ | ✗ | ✗ | **Route** |
| **Shift-check (Q7 evidence)** — plant-stored `Shift` column vs SMS-derived shift, per day | ✓ `services/shiftCheck.ts` | ✓ `GET /api/shift-check` — `routes/cone.ts:146` · **rank 1** | ✓ `setup/RulesBlock.tsx:236-242` `ShiftCheckNote` | ✓ **admin only in practice** | ✗ — rank-1 data rendered inside a rank-4 screen, in the Rules section, where nobody would look for it. IFL's accounts are created at manager | **Surface** |
| **Register a new source generation** (`sms epoch:accept`) | ✓ `cli/src/commands/epoch.ts:105` | ✗ deliberately an operator act | ✗ | ✗ terminal | partial — the *halt* and its verbatim reason (including the command line) do appear: `SyncHealthBlock.tsx:120-127` | **None** |
| **Purge / drop a generation** (`epoch:purge`, `epoch:drop`) | ✓ `epoch.ts:333,446` | ✗ | ✗ | ✗ terminal | ✗ | **None** — destructive; CLI is the right place |
| **Rebuild a canonical table from raw** (`sms rebuild`) | ✓ `cli/src/commands/rebuild.ts:47` | ✗ | ✗ | ✗ terminal | partial — the app tells the admin to run it after a shift-rule change (`app.ts:1747-1755`) | **None** |
| **Rebuild audit log** (`sms.rebuild_audit`) | ✓ written by the CLI — `rebuild.ts:115,162` | ✗ no `SELECT` anywhere in `api/src` | ✗ | ✗ | ✗ | **Decide** |
| **Retention pruning** (`sms retention`) | ✓ `cli/src/commands/retention.ts:104` | ✗ | ✗ | ✗ terminal | ✗ | **None** — scheduled housekeeping |
| **Cutover reset** (`sms cutover`) | ✓ `cli/src/commands/cutover.ts:66` | ✗ | ✗ | ✗ terminal | ✗ | **None** — deliberately not a web action |
| **Shift/day summary** (`sms summary`) | ✓ `cli/src/commands/summary.ts:9` | ✗ | ✗ | ✗ terminal | ✗ | **None** — superseded by `/api/reports/daily` |
| **Manual sync trigger** (`sms sync`) | ✓ `cli/src/commands/sync.ts:19` | ✗ | ✗ | ✗ terminal | ✗ | **None** — the continuous worker is the normal path |

### 1.10 Auth, users, roles and audit

| Capability | Backend | API | Frontend | Reachable? | Discoverable? | Action |
|---|---|---|---|---|---|---|
| **Session auth** — login, logout, whoami; argon2, IP+username rate-limited, renewed while in use | ✓ `api/src/auth.ts` | ✓ `/api/auth/{login,logout,me}` — `app.ts:217,272,287` · public | ✓ `screens/Login.tsx`, `App.tsx` | ✓ | ✓ | **None** |
| **Roles** — 1 viewer · 2 engineer · 3 manager · 4 admin; writes only, never read access | ✓ migration 035, `sms.role`, `requireRole()` | ✓ enforced on every write route | ✓ `Setup.tsx:44` derives the names from `ROLE_RANK` rather than a fourth copy | ✓ | ✓ admin | **None** |
| **Own password change** — verifies current, revokes other sessions | ✓ `services/admin.ts` via `routes/ops.ts:49` | ✓ `POST /api/auth/password` · rank 1 | ✓ `screens/Account.tsx:46` | ✓ | partial — only behind the initials avatar menu (`Bar.tsx:170-198`); no label anywhere says "Account" | **None** |
| **Admin password reset** — revokes every session of the target | ✓ `services/admin.ts` via `routes/ops.ts:94` | ✓ `POST /api/admin/users/:id/password` · rank 4 | ✓ `Setup.tsx:313` | ✓ admin | ✓ admin | **None** |
| **Users: list / create / activate / change role** (last-admin guarded) | ✓ `services/admin.ts` | ✓ `/api/admin/users*` — `app.ts:1426,1429,1457` · rank 4 | ✓ `Setup.tsx` People block | ✓ admin | ✓ admin | **None** |
| **Setup CRUD: line, machines, stations, sources, rules** | ✓ `services/lineConfig.ts`, `services/admin.ts` | ✓ 11 `/api/admin/*` routes — `app.ts:1482-1759` · rank 4 | ✓ `setup/*.tsx` (5 blocks) | ✓ admin | ✓ admin — gear icon → Setup | **None** |
| **Setup audit log** — keyset-paged log of every configuration write, login, export and changeover | ✓ `services/audit.ts` `listAuditPage` | ✓ `GET /api/admin/audit` — `app.ts:1792` · rank 4 | ✓ `Setup.tsx` AuditLog block | ✓ admin | ✓ admin — ninth of nine stacked sections, no sub-navigation (`Setup.tsx:53-61`) | **None** |
| **`listAudit`** — a flat, non-paged audit read | ✓ `services/audit.ts:226` | ✗ | ✗ | ✗ | ✗ — **dead code**, superseded by `listAuditPage`; no caller anywhere in `api/`, `cli/` or `sync-worker/` | **Decide** |

---

## 2. The headline count

> ## 28 capabilities are built and not discoverable.
>
> Four of those twenty-eight are superseded duplicates whose *function* is discoverable
> through a newer path (`/api/weights`, `/api/calibration`, `/api/report`, `listAudit`).
>
> ### That leaves **24 capabilities whose function reaches no user by any route they would find.**

That is the answer to "why doesn't the product show what we built". It is not one missing
screen. It is twenty-four, and they fall into four different shapes that need four different
kinds of work:

| Shape | Count | Example |
|---|---|---|
| Built, routed, rendered — **but buried** | 10 | Setting the running product: four levels below a button labelled "Change" |
| Built, routed — **never rendered** | 4 | The changeover workflow; sack weight SPC |
| Built — **never routed** | 6 | `sms verify`; the `product_change` audit trail |
| Built and routed — **wire it or delete it, undecided** | 9 | `/api/reconciliation`; the Nelson rule table |

Two further capabilities are genuinely **not built**: server-side PDF, and XLSX for the
register.

**The one number that matters for scope:** of 94 capabilities, **63 are fine as they are**.
The product is not broadly broken. It is narrowly and repeatedly *unfindable* — and the
unfindable third clusters almost entirely in products/PDAS/changeover and in
operations/data-integrity, the two areas IFL named as their priorities.

---

## 3. Action lists

Ordered by value to the user within each bucket. Effort is a rough developer estimate for
the exposure work only, and assumes the backend is used as-is. **Items gated on IFL are not
estimated**, per the brief.

### 3.1 Expose — the backend works; build UI for it (4)

| # | Capability | What the user gains | Effort |
|---|---|---|---|
| 1 | **Changeover workflow** (`/api/changeover/{refs,plan,execute}`) | The thing IFL said matters most: per-machine product changeover per shift, run as one checked sequence instead of hand-typed `EXEC`s in SSMS. The **dry run works today** — it never opens the PDAS writer pool and reads only the sidecar mirror, so the plan, its blockers and the "this does not reach the machine" statement are all available with `PDAS_WRITE_ENABLED` off. Only the execute button waits on IFL | Plan-and-refs UI: **3–5 days** (one screen or sheet, four pickers, a plan result with blockers/warnings, ~10 client wrapper functions). Execute button: not estimated — gated on IFL's written authority |
| 2 | **Data-quality findings, listed** | Today an operator sees "Blocking findings: 2" and cannot learn what they are without SQL. The rows are already on the wire in full; the block renders only a count | **1–2 days** — a `<Details>` table under the existing count in `SyncHealthBlock.tsx` |
| 3 | **Sack weight SPC** | Sack weight gets the same control chart and Cp/Cpk the cone weight has. The engine, the route and the spec resolution all already take `type=sack`; only the client never asks | **1–2 days** — a cone/sack toggle on Weight, plus the limits question (sack spec source) which the spec resolution already handles |
| 4 | **Pallet / pack-schema reference (read)** | Lets a screen show which pallets and pack schemas are active without going through a changeover. Low standalone value; it mostly rides along with item 1 | **<1 day** if built with item 1; not worth a separate pass |

### 3.2 Route — the service works; build the API (6)

| # | Capability | What the user gains | Effort |
|---|---|---|---|
| 1 | **`sms verify` — reconciliation per source generation** | The only thing in the system that answers *"did the sync actually get everything?"* Neither `/api/operations` (pass outcomes) nor `/api/reconciliation` (within-canonical totals) can answer it. It is built, correct as of this week's archive-floor fix, read-only and cheap — and lives where no IFL user will ever go | **3–4 days** — a read-only route returning the last run's per-generation result, or running it on demand with a timeout. The logic is reusable as-is from `verify.ts` |
| 2 | **PDAS `product_change` audit trail** | "Show me every product/pallet/limit change anyone attempted, and what happened." Every attempt — success, refusal, and `outcome='disabled'` — has been faithfully recorded since migration 027 and has never been read back. This is the one screen an admin will want on the day PDAS writes go live | **2–3 days** — one keyset-paged read route plus a Setup/Operations block, modelled on the existing `/api/admin/audit` |
| 3 | **Archived floor** (`archived_below_id`, `archived_observed_utc`) | Turns "there is a gap in our records" into "the gap below id X is IFL's own monthly pruning, last confirmed Y". Without it, a normal IFL retention pass reads as data loss | **<1 day** — two columns added to the existing `/api/operations` epoch payload and one sentence in `SyncHealthBlock` |
| 4 | **Source generation history** (`epoch:list`) | The full record of every generation per table. Today only the open one is served, so July's 142,511 cones and September's 132,552 have no visible boundary in the app | **1–2 days** |
| 5 | **PDAS add blend / count / tube type** | Standalone use of three of the nine rights, instead of only as steps inside a changeover | Not estimated — gated on IFL's written authority for the nine rights |
| 6 | **PDAS create / retire pallet** | Same | Not estimated — same gate |

### 3.3 Surface — it exists in the UI and nobody can find it (10)

| # | Capability | What the user gains | Effort |
|---|---|---|---|
| 1 | **Sync health** | The one screen that says whether the data is trustworthy is reachable only by noticing that one sentence in the status strip is a button. IFL's accounts are managers, so the admin copy in Setup does not help them | **<1 day** for an entry point; the screen is built |
| 2 | **System health** (DB cap, version, uptime, backups) | Same entry point, same fix |  Included above |
| 3 | **Set the running product** | Rank-2 action, four levels below a button labelled only "Change". This is requirement 3 and the resolution of Q1 | **1–2 days** across items 3–7 (one product entry point) |
| 4 | **PDAS product write** (create / retire / change limits) | The two rights IFL confirmed on 11 Sep 2026, behind a collapsed `<Details>` with no outside signpost | Included above |
| 5 | **Product limits history** | Time-versioned limits — the thing that makes a reading judged by the limits in force at *its* time — visible only in the same two buried places | Included above |
| 6 | **SMS-local limit version write** | Same chain | Included above |
| 7 | **Changeover history / product timeline** | The full changeover record, behind a `linkish` button rendered as a block *note* | Included above |
| 8 | **Shift-check (Q7 evidence)** | Rank-1 data rendered inside a rank-4 screen, in the Rules section. No manager — which is what IFL's accounts are — can see the evidence for the shift decision | **<1 day** to move or mirror it |
| 9 | **Shareable report state** | A manager can send a colleague the report they are actually looking at. Today a pasted link always lands on `daily`, unfiltered — `Report.tsx:53,54` | **1 day** — `type` and the three filters into the URL, the way `sheet` and `period` already are |
| 10 | **Reject code dictionary** (pass-flag, severity) | The server accepts an engineer (`requireRole(2)`); the only UI is admin-only. A client gate **more restrictive** than the server — the opposite direction from the one the frontend audit checked for | **<1 day** |

### 3.4 Decide — wire it or delete it; a written decision is owed (9)

Four of these are held open by `web/src/api.callers.test.ts`'s `ALLOW_LIST`, which exists
precisely so that "nobody calls this" is a written decision rather than a silent rot. The
decision is overdue; the test will keep re-asking every run.

| # | Capability | The decision | Note |
|---|---|---|---|
| 1 | **`/api/reconciliation`** (rank 3) | Wire to Report, or delete | Real data, real answer; overlaps nothing else. The likeliest "wire" of the nine |
| 2 | **Downtime detail** (stoppage list, hourly, MTBF/MTTR, availability) | Wire, or delete | CLAUDE.md withdrew OEE deliberately ("no requirement asks for it"), so *delete* is a live and defensible option — the measured part already survives on Report |
| 3 | **Nelson rule reference table** (`/api/calibration/rules`) | Wire into Weight/StationSheet Details, or delete | Built for that block and never wired. Small either way |
| 4 | **Replay** (`?at=`) | Give it a control, or leave it URL-only and document it | `LIVE_ALLOW_AS_OF` is false in production, so this is a demo/verification tool. "Leave as-is, documented" is a legitimate outcome |
| 5 | **`/api/weights`** (legacy) | Delete the route and wrapper | Superseded by `/api/spc` + `/api/weight-stations` |
| 6 | **`/api/calibration`** (legacy) | Delete the route and wrapper | Superseded by `/api/weight-stations`; CLAUDE.md rule 6 forbids a second station table |
| 7 | **`/api/report`** (legacy) | Delete the route and wrapper | Superseded by `/api/reports/daily` |
| 8 | **`services/audit.ts:226` `listAudit`** | Delete | Dead code; no caller anywhere in the monorepo |
| 9 | **`sms.rebuild_audit`** | Serve it, or write down that it stays CLI-only | Lowest value here; nothing today asks to put rebuilds in front of a non-technical user |

Plus **8 superseded client wrappers** (`adminGetAudit`, `getRejects`, `getWeights`,
`getCalibration`, `getCalibrationAdjustments`, `recordCalibrationAdjustment`, `getRejectSpc`,
`getReport` — `api.callers.test.ts:45-60`) which are dead weight on live endpoints, not gaps.
Deleting them is a tidy-up, not a capability decision.

### 3.5 Build — genuinely not built (2)

| # | Capability | What the user gains | Effort |
|---|---|---|---|
| 1 | **Server-side PDF reports** | IFL's Q33–37 answer asked for "Excel **and** PDF, designed, with graphics". Today the only PDF is whatever the browser's print dialogue produces. The print stylesheet and `PrintHead` are real work already done, which lowers this considerably | **4–7 days**, depending on whether headless-Chrome print of the existing print stylesheet is acceptable (cheap) or a drawn PDF is required (expensive). **Ask before adding the dependency** — CLAUDE.md working rule 4 |
| 2 | **Register XLSX export** | Parity with the report exports; the register is CSV-only today | **1–2 days** — `buildXlsx` already exists; the register route hard-sets `text/csv` |

### 3.6 None — fine as it is (63)

Everything not listed above. This includes all ten report types, both report export formats,
the whole rejects cluster, the sacks cluster, the register and its detail sheets, live/wall/
attention, auth and Setup CRUD, and the seven CLI commands that are correctly CLI-only
(`epoch:accept/purge/drop`, `rebuild`, `retention`, `cutover`, `summary`, `sync`).

**One "None" that deserves a sentence:** *sack stock per machine* is not computable by anyone
from the data IFL supplied — `sack1_TP1U2` has no machine column — and every response says so
in the server's own words (`sackStock.ts:124`). IFL's 15 Sep 2026 answer redefines "stock" as
production per shift, which the `machine-product` report delivers. It is not a gap; it is an
answered question, and the app already states the answer rather than fabricating a figure.

---

## 4. Capability and action tallies

| Action | Count |
|---|---|
| **None** | 63 |
| **Surface** | 10 |
| **Decide** | 9 |
| **Route** | 6 |
| **Expose** | 4 |
| **Build** | 2 |
| **Total capabilities** | **94** |

Cross-cut by state:

| | Count |
|---|---|
| Backend ✓ or partial | 92 |
| …of those, API ✓ or partial | 85 |
| …of those, Frontend ✓ or partial | 71 |
| …of those, Reachable in the app | 71 |
| …of those, **Discoverable** | **64** |

The drop from 92 built to 64 discoverable is the whole finding. Note where the losses fall:
**7 lost at routing**, **14 lost at rendering**, **7 more lost at discoverability** — three
different failure modes, roughly evenly weighted. A programme that only builds screens fixes
half of it.

---

## 5. Contradictions between the two inventories

Each was settled by reading the code. Six were found; three are corrections to a stated fact,
three are things one audit left open that the other did not close.

### 5.1 `getShiftCheck` — "not verified whether any screen calls it" (backend §2) — **SETTLED: it does**

The backend inventory left this open and inferred a caller from its absence in the guard
test's `ALLOW_LIST`; the frontend inventory did not mention shift-check at all.

**Settled:** `web/src/screens/setup/RulesBlock.tsx:22,220,236,242` — the `ShiftCheckNote`
component calls it. The inference was correct, but the *consequence* both audits missed is
the finding: `GET /api/shift-check` is **rank 1** (`routes/cone.ts:146`), and its only
rendering is inside Setup, which the client gates at `rank >= 4` (`App.tsx:315`). IFL's
accounts are created at manager rank, so **no IFL user can see the Q7 evidence**. Recorded as
**Surface** in [§1.9](#19-operations-sync-health-and-data-integrity).

### 5.2 `management-summary` rank — "flag for follow-up, not a confirmed mismatch" (frontend §9) — **SETTLED: it matches**

The frontend audit could not confirm the server side because the report routes are not
individually gated with `requireRole` in registration order.

**Settled:** the gate lives inside `parse()` at `routes/reports.ts:98-112`, keyed off the
already-decoded type, with `REPORT_RANK['management-summary'] = 3` at
`services/reports/common.ts:79`. The client's `REPORT_MIN_RANK` (`report/model.ts:34`) says 3.
**They match.** The route file's own comment explains why the gate cannot be a route-order
`requireRole`: a path-encoding trick (`management%2Dsummary`) would otherwise reach a
literal-path gate registered "later". Not a mismatch; a deliberate and correct design.

### 5.3 CLI subcommand count — backend §5 says "11 subcommands"; there are **12**

The backend inventory's own §5 table lists twelve rows and its summary line says eleven
("8 command files, covering 11 subcommands (`epoch:` has 4)"). The arithmetic of its own
table is 1+4+1+1+1+1+2+1 = 12.

**Settled:** `cli/src/index.ts:46-79` dispatches exactly twelve cases — `sync`, `verify`,
`summary`, `rebuild`, `cutover`, `epoch:list`, `epoch:accept`, `epoch:purge`, `epoch:drop`,
`user:create`, `user:password`, `retention`. **12**, from 8 command files.

### 5.4 Report chip count — the frontend inventory says nine in one sentence and ten in the next

Frontend §8: "renders all nine report-type chips… a manager scanning for 'Machine product'
(the tenth type) has to read all ten chip labels."

**Settled: ten.** `Report.tsx:128-136` maps over `REPORT_TYPES`, which has ten entries
(`services/reports/common.ts:28-41`), and all ten have components under
`web/src/screens/report/`. The source of the confusion is a **stale comment in the code
itself** — `Report.tsx:127` still reads "The nine report types, as chips that wrap". The
rendering is correct; the comment is one type out of date. Worth a one-line fix, not a
capability finding.

### 5.5 `getStoppagePatterns` — backend §5 implies it is orphaned; it is not

Not stated as a contradiction by either audit, but easy to misread from the backend
inventory's treatment of `/api/stoppage-patterns` as deleted.

**Settled:** `services/downtime.ts:61` `getStoppagePatterns` is still called by
`services/report.ts:225`, which serves `/api/report`. So the function is routed — via a route
that *itself* has no screen caller. Two hops from a user, not one. It is covered by the
legacy-report **Decide** row, not by a separate finding.

### 5.6 Neither audit found two real gaps; both are now in the matrix

Not a disagreement, but the point of joining the two documents: each audit checked one
side, and two capabilities fall in the seam between them.

- **Sack weight SPC.** The backend audit recorded `/api/spc` as serving "cone or sack weight"
  and marked it reachable. The frontend audit recorded `getSpc` as having a caller and marked
  it fine. Both were true of the *route* and the *wrapper*; neither checked the *argument*.
  `services/spc.ts:297` takes `SpcType = 'cone' | 'sack'`, and `Weight.tsx:91,108` hardcode
  `type: 'cone'`. No file in `web/src` ever sends `sack`. **Built, routed, never rendered.**
- **Data-quality findings.** The backend audit recorded `/api/operations` as serving the "DQ
  finding roll-up" (true — `dq.findings: DqFinding[]`, full rows). The frontend audit recorded
  `SyncHealthBlock` as rendering sync state (true). Neither noticed that the block consumes
  the array only to take its `.length` (`SyncHealthBlock.tsx:51,98`). **Served in full,
  rendered as a number.**

---

## 6. What this matrix cannot tell you

State these limits plainly to anyone who uses this document to plan the next phase.

1. **It is a static read, not an execution.** Nothing here was run. "Backend ✓" means the code
   exists and its shape was read — not that it returns correct figures against live data.
   `sms verify` is called correct because its logic and its tests were read, not because it was
   executed against IFL's server.

2. **"Discoverable" is my judgement, not a measured fact.** Nobody watched a user try. Every
   `✗` in that column is defensible from the code — a control with no label, a screen with one
   entry point, a form four levels down — but the threshold between "buried" and "findable" is
   an opinion. The rows most exposed to this are the product/PDAS cluster, where I called a
   `<Details>` disclosure inside a sheet "not discoverable"; a reader who opens every
   disclosure would disagree. **The fix is user testing, and this document is not a substitute
   for it.**

3. **It cannot tell you whether a capability is worth exposing.** "Built and not discoverable"
   is not the same as "should be discoverable". Four of the twenty-eight are superseded
   duplicates that should be deleted, not surfaced. `/api/downtime`'s MTBF/MTTR detail is
   fully built and CLAUDE.md argues at length that nobody asked for it. The matrix reports
   supply; it says nothing about demand.

4. **It cannot see design quality.** A screen that renders a capability counts as `✓` whether
   it renders it well or badly. The frontend audit's ten context-preservation failures, the two
   sheets that bypass the shared `Failed` component, and Weight's ten-column table are all
   invisible in this matrix — every one of those rows reads `✓ ✓ ✓ ✓ ✓ None`. Read
   `FRONTEND-INVENTORY.md` §5 and §6 alongside this; they do not overlap.

5. **The capability boundary is a judgement call, and the totals move with it.** I counted the
   ten report types as ten capabilities because the brief asked for them individually, but
   merged the three changeover routes into one and the three PDAS product writes into one,
   because a user experiences each as a single thing. Drawn differently, "94" becomes 80 or
   115. **Use the shape of the distribution, not the absolute numbers**, and be suspicious of
   anyone who quotes 94 or 28 without the definitions above.

6. **It cannot distinguish "nobody can find it" from "nobody needs it".** The owner's
   complaint is that the product does not show what was built. This matrix proves the first
   half — twenty-eight built things do not show. It cannot prove that showing them would help.
   Some of these were built speculatively and their right ending is deletion, which is why
   **Decide** is a bucket of nine rather than an empty formality.

7. **Anything gated on IFL is unresolvable here.** The PDAS write path ships off by client
   mandate and stays off until IFL confirms in writing. Six of the nine rights in
   `pdasWrite.ts` have never been executed against a plant database. No amount of code reading
   settles whether `CreateMaterial` really refuses a duplicate blend/count/tube — the 15 Sep
   2026 audit found the field notes cited for that claim contain no error at all. Effort for
   those rows is deliberately left blank.

8. **One thing genuinely was not checked.** No field-by-field diff was performed between what
   the sync worker can write to `sms.dq_finding` (migrations 009, 016) and what
   `/api/operations` actually returns. `/api/operations` serves `findings` as full rows, so the
   **Expose** action stands either way — but if the route projects a subset, the exposure work
   is slightly larger than estimated. That is the only estimate in §3 with a known unknown
   under it.

---

*Phase 1 reports. It does not design. No screen, layout or wireframe is proposed above, and
none should be inferred from the order of the action lists — that order is value to the user,
not a build sequence.*
