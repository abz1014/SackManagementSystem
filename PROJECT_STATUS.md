# PROJECT_STATUS.md — IFL Sack Management System

**Full session handover: [`HANDOVER-2026-09-15.md`](HANDOVER-2026-09-15.md)** — read it first if resuming cold; it covers the dirty working tree this file's §3 does not yet reflect.

**As of:** 21 September 2026, UX programme Phase 8 (Testing) complete on top of Phases 5–7 and Wave C/D (roadmap Phases 1–5, 7–9 and 11 complete; 10, 12, 13 and the IFL-answer work of §7 remain) · branch `floor-first-rework`
**Kept under roadmap rule 15:** completed · in progress · blocked · IFL dependency · test status. Updated at the end of every phase or wave; `BASELINE.md` is the frozen Phase 0 picture and is not.

Phase numbering follows `IFL_SMS_Claude_Code_Development_Roadmap.md`; the evidence behind every status is in `ROADMAP-GAP-ANALYSIS.md` (§2–§13 per phase, §15 waves, §17 defect register, §18 IFL clarifications).

**A second, separate numbering exists since 16 Sep 2026: the UX programme** (`audit/IA-PROPOSAL.md` Phase 2a, `audit/OVERVIEW-SPEC.md` Phase 3, then Phase 4 drilldowns, Phase 5 Analytics, Phase 6 Expose backend, Phase 7 Reliability states, and now Phase 8 Testing — twenty-one commits `be5ac3e`…`6bcdffd`). It refines screens and, as of Phase 8, the test harness itself, inside roadmap phases already marked complete or partial above (mainly 4, 6, 8, 9, 11 and 12) rather than adding a new roadmap phase; see §2 below and `CLAUDE.md`'s dated "UX programme, Phase 8" section for what it actually changed. Do not read "Phase 8" in commit messages as roadmap Phase 8 (Dashboards & reports, itself long complete) — the two numbering schemes are independent, and roadmap Phase 12 (Testing & release) moves from PARTIAL-with-no-component-harness to PARTIAL-with-a-component-harness by this UX phase; it is not marked COMPLETE because performance, load, FAT and SAT are still untouched (see §1 row 12 and the "Not done" note under §2).

---

## 1. Phase board

| Phase | Status | What that means today |
|---|---|---|
| 0 — Freeze & baseline | **COMPLETE** (all five acceptance criteria met; adversarially re-checked) | Tag `v0.1.0-baseline`; `BASELINE.md`; from-zero DB rehearsal (reproduced independently); restore rehearsal; clean-checkout rehearsal (`npm ci` → gate → services started, in a fresh clone); no secrets in history (re-verified by hashing the real values); CI workflow. Three independent verifiers refuted five statements of the first closure and one real defect (the suite failed on UTC hosts); all fixed in `7a0c5f7`. What remains is not a criterion: a rehearsal on hardware other than the development machine waits on IFL's host (Q65–70), and CI has not run because nothing is pushed. Owner actions: push, branch decision, a copy on other hardware (§4). |
| 1 — Configurable platform | **COMPLETE — acceptance met, with three defaults awaiting IFL** | Migration 028: plant / unit / line / machine / station / data source / source table rows; reject codes per line; shift boundaries, night rule and mode are the versioned rule, read by the worker every pass and the API per request; source tables and `source_system` come from configuration (no `'ifl_sql'` or `pack1_TP1U2` literal on any live path); Setup › Line · Machines · Stations · Sources · Rules · Reject codes, every write audited in the same transaction. **Acceptance rehearsed 14 Sep 2026:** winder 15 added through Setup → its station appeared on the Weight/Readings station list with no code change; shift boundaries moved to 05:30/13:30/21:30 → `/api/live` moved the shift window the same second → restored to 06/14/22 (all three rows in `sms.shift_rule`, all in the audit log). Defaults that an IFL answer would change, editable as data: station N ↔ winder N (Q3), one line per installation (Q14), shift mode recorded not applied (Q7). |
| 2 — Integration layer | **COMPLETE for the SQL adapter; PLC/OPC adapter deliberately unbuilt** | `SourceAdapter` interface + `createAdapter` registry (`'ifl_sql'` → `IflSqlAdapter`; any other system code throws — the PLC/OPC adapter waits for IFL, roadmap 2B); driver errors classified `transient` / `auth` / `schema` and only transient ones retried, connect included; a table that halts no longer stops the others (each table's own `sync_run` row, healthy tables still transform, the pass reported failed with every halted table named); a source probe at the top of every pass; the full column list of every generation recorded and compared each pass (`source_columns_changed`); one JSON line per event from worker, API and CLI with a correlation id; Setup › Sync health prints the probe result, the halted tables and the reason verbatim. Acceptance: integration failure never crashes the worker or the API (rehearsed: connection refused → halt rows, recovery on the next pass); reconciliation per generation (`sms verify`, 12 generations OK after the rebuild); source reset cannot silently stop sync (epoch gate + backwards gate); lag visible (top bar, Setup); no writes to plant systems (SELECT-only login, PDAS writes off). |
| 3 — Canonical data model | **COMPLETE** | Migration 029 + `TRANSFORM_VERSION = 2` + a full rebuild of all three canonical tables (295,196 rows, 25 s, against a checksummed snapshot; `sms verify` clean on every generation afterwards): every reportable row carries source system, source table (via its generation), source row id, IFL's insert time, production time, **SMS's own ingestion time**, the sync pass that read it (a join that now resolves for 100 % of rows — it resolved for none before), transform version and attribution method/confidence (rejects included). `shared/src/domain/canonical.ts` is the one typed contract and the transform builds against it (the dead `events.ts` is gone). `dq_finding.subject_ref` points at the offending raw row. A person can read all of it on the reading sheet under *Where this reading came from*. `DATA-DICTIONARY.md` (37 tables, 369 columns, every one described) is generated by `npm run dictionary`. |
| 4 — Cone weight module | **COMPLETE — fixture and disagreement rule awaiting IFL approval** | ONE five-state classification (`shared/src/domain/classification.ts`: within · low · high · rejected · unknown), judged by the limits in force at the reading's own time, emitted on every register row, the sheet, the CSV and as counts on `/api/production`; the four scattered "outside limits" implementations are gone. Developer-proposed fixture of 24 cases (`sms/test/fixtures/cone-classification.json`) run by the suite — **awaiting IFL approval**, as is the rule for a scale/tolerance disagreement (state low/high with `scalePassed` kept and both facts printed). `sms verify --weights` reconciles COUNT/SUM/AVG/MIN/MAX per generation against the source; one population rule (both plausibility bounds, from the rule) across weights/SPC/production and the DQ check; station selector on the Weight chart; "What each machine is running" on Line; product column and filter on the register; Setup › Rules › Product limits (read-only history); shift-attribution check (`/api/shift-check`: 2.3 % of the week's cones carry a plant shift SMS derives differently) printed on Report and on the shift form. On the September generation: 132,497 within · 0 low · 0 high · 49 rejected · 4 unknown; every July cone is `unknown` because no product limits were in force before 5 Aug — honest, and a clarification for IFL. |
| 5 — Reject management | **COMPLETE — code meanings awaiting IFL (Q12)** | Per-day-per-code drilldown (`/api/rejects/by-day-code`, production-day basis stated) with a reason sheet listing that day's rejects of a code and inline naming at rank 3; Pareto bars clickable (code chip), station and product filters on Pareto/trend/list; `shift`/`tsTo` on `/api/rejects` and `/api/reject-spc` with a 366-day cap, and the Rejects headline uses Line's exact period so the two screens agree (tested); the trend draws the p-chart's UCL/LCL band and marks out-of-control days; reasons follow the selected period (the 14-day window stays for episode detection only); every fetch has a failure state; `unattributed` counts cones and rejects separately; register reject-code join per line. IFL can pick a period and trace every reject number to its rows (the sheet prints the source row id and its generation). |
| 6 — Product / PDAS | **BUILT, OFF** | Complete write path through the vendor's procs, tested against fakes, never executed against any PDAS database; `sms_pdas_writer` provisioned nowhere. Stays off until IFL confirms in writing (Q5). |
| 7 — Sack management & stock | **COMPLETE at line level; per-machine stays dependent** | Sacks screen (`?s=sacks`): sacks weighed, kg, in-range % (the CLI figure no screen showed), cones per sack (approximate, labelled), by shift and by product; the stock ledger (migration 033, append-only movements — opening / receipt / issue / consumption / adjustment; weighed sacks are derived receipts; `machine_id` is NULL by CHECK constraint and no code path sets it — roadmap rule 6); manual movements at rank 3 through `auditedWrite`; a stock sheet per day; `sack_num_reset` (INFO) and `sack_blackout` (WARNING, `SACK_BLACKOUT_HOURS`) findings. **IFL's answer of 15 Sep (Q28) reframes "sack stock per machine" as sack production per machine by shift/day — see §7; the ledger stays as built but the screen is to lead with production.** No sack is attributed to a machine (acceptance holds by construction and is stated on screen). |
| 8 — Dashboards & reports | **COMPLETE for the nine report types; layouts and KPIs await IFL approval; Excel/PDF to build (§7)** | One Report surface with the nine types (Daily · Shift · Product · Machine/station · Rejects · Cone weight · Sacks · Calibration · Management summary), each a composed `GET /api/reports/<type>` reusing the existing services, a CSV export (rank 3, audited) and a print header (line · period · filters · generated at plant time · by whom · SMS version); management summary with the prior period of equal length and deltas; `/api/report` gains `shift`; `groupBy=product` on production. `KPI-DEFINITIONS.md` (32 rows: definition, SQL-level formula, denominator, clock, exclusions — every row "IFL approval: awaiting") is the sheet for Phase 8's acceptance. Four defects closed: Weight passes `tsTo`, Wall never asks for an undefined day, Readings' print has the header, the three orphaned client wrappers are gone. All nine answer 200 on the sidecar (verified 15 Sep). |
| 9 — Calibration analytics | **COMPLETE — validation method awaiting IFL** | Median beside the mean (same population rule) on Weight, the station table and the sheet; per-station SD rendered; Nelson rules named on hover and on the sheet, the centreline and I-MR sigma restart at a logged adjustment, rules that cannot fire on the series length are said so; the station sheet compares days on the plant clock (`web/src/lib/plantClock.ts`); the adjustment form takes the plant time, a note, before/after/reference readings and the product in force (migration 034); adjustments filter by period and station and include line-wide ones; a **projection** ("at N g/day this station reaches the action limit in about K days if it continues at that rate" — OLS over the flagged run, never called a prediction); `CALIBRATION-VALIDATION.md` with a real sweep over the 53 days: 12 flagged episodes, all beginning with a measurable step, 11 of them in July where no product limits existed (a floor on the fallback threshold is recommended, value for IFL). |
| 10 — Optional AI/ML | **BLOCKED** | 53 production days held against a six-month minimum; one ledger row. Wave F, after go-live plus accrual. |
| 11 — Security & operations | **COMPLETE — role mapping, retention policy and the live-host rehearsal await IFL** | Password change (self) and reset (admin) with session revocation and a length policy; last-admin guard; login/logout/failed-login/export audited; limiter and cache bounded; `/api/health` (service · database size vs the 10 GB cap · acquisition · backups) and a Health screen every account can open; `pool.on('error')`, graceful SIGTERM/SIGINT, orphaned-run reconciliation at start, `persistent_sync_failure` CRITICAL after N consecutive halts (cleared by the next clean pass — loop or one-shot), hourly database-size check; `sms retention` (sync_run 90 d keeping the newest per table, non-CRITICAL findings 365 d, expired sessions; never audit/product_change/readings — IFL's decision); migration 030 makes `audit_log` append-only at the database (with the `db_ddladmin` caveat written down); `cutover`/`epoch:purge` take the lock, refuse a pass in flight and require `--backup=<existing .bak>`; scripts for DB maintenance, scheduled tasks (`-WhatIf` rehearsed) and configuration backup; DEPLOY.md gains Health, Scheduled tasks, Retention, Database maintenance, Configuration backup, Upgrading and rolling back; CHANGELOG 0.2.0. **Acceptance rehearsed 15 Sep 2026** (§2). |
| 12 — Testing & release | **PARTIAL** | 1240 tests passed / 4 skipped, 118 test files (21 Sep 2026, end of UX programme Phase 8; was 1194/110 at Phase 7, 1169/109 at Phase 6, 324 tests / 34 files at Phase 0 closure), all against fakes, passing under UTC±0 and UTC+5; CI workflow added (Wave A); `verify:release` gate (not re-run this pass — only `npx vitest run` was). There IS now a component harness, closed this phase: `vitest.config.ts` gained `environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']]`, keyed on file EXTENSION rather than directory so it cannot swallow `web/src/App.test.ts`'s own `globalThis.window` teardown into jsdom; `@testing-library/react`/`@testing-library/dom` mount the real `<App/>` for a 4-rank UI matrix (`web/src/rank.matrix.test.tsx`, closing the rank-1/viewer rendering gap open since Phase 5) and six state-carrying drilldown hops (`web/src/hops.test.tsx`), a route/client crosscheck (`web/src/rank.crosscheck.test.ts`) locks each write control's client-side rank to its server route, and three screens (`SyncHealthBlock`, `Readings`, `Weight`) carry two-sided failure-state tests. Of the 16 top-level files in `web/src/screens/`, 2 (Readings, Weight) now have a direct component test; the other 14, including Setup, do not. Still absent: any browser/layout harness (jsdom computes no layout; Wall at 1920px and print CSS remain unverified, and Playwright is explicitly deferred) and `@testing-library/user-event` (not installed, so Setup's form blocks and the Changeover confirm flow cannot be component-tested with realistic event sequences). The rank-1 matrix closes the *rendering* question only — nobody has signed in as a viewer on a live instance; that still needs Q65–70 and an IFL-created account. No performance, load, FAT or SAT material — this row stays PARTIAL for that reason. **One unexplained intermittent failure remains open** (roughly 1 run in 74 under `--sequence.shuffle`, never captured with a test name — see §6); a suite reported "green" carries that caveat. |
| 13 — Documentation | **PARTIAL** | `BASELINE.md`, `PROJECT_STATUS.md`, `DEPLOY.md` (corrected), credentials statement, technical history, questions status. Data dictionary, operator manual, FAT/SAT protocols absent. |
| 14 — Site commissioning | out of scope until a host exists | — |

---

## 2. Completed

### UX programme, Phase 8 — Testing (21 Sep 2026)
- Six commits (`c827e49`, `963ecb6`, `3f2de1b`, `58644d3`, `6bcdffd`, plus the
  brief-ordering commit already covered above). This phase added a test
  harness and 46 tests; it changed no production behaviour — the four
  content-hashed files in `web/dist` have identical sha256 sums before and
  after.
- **The project can render a React component in a test for the first time.**
  `sms/vitest.config.ts` was `environment: 'node'` collecting `*.test.ts`
  only. It now also collects `*.test.tsx` and gives only those files jsdom via
  `environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']]` — keyed on file
  extension, not directory, deliberately: `web/src/App.test.ts:18-28` assigns
  and then deletes `globalThis.window` in its own teardown, and a
  directory-keyed glob would have dropped that file into jsdom and had it
  delete the real window.
- **Three dev dependencies**, added to the ROOT `sms/package.json` only
  (`web/package.json` untouched, verified): `jsdom` pinned `^26.1.0` (`30.x`
  needs Node ≥22.22; this host runs v22.18.0), `@testing-library/react`, and
  `@testing-library/dom` (an RTL v16 peer, declared for a reproducible `npm
  ci`). `user-event` and `jest-dom` were considered and deliberately not
  added.
- **The rank-1 (viewer) rendering gap, open since Phase 5, is closed.**
  `web/src/rank.matrix.test.tsx` mounts the real `<App/>` at all four ranks
  against a faked `/api/auth/me` — no account, no database, which is what
  made this gap unreachable before (workers are forbidden to create or reset
  accounts). All seven nav entries render and are navigable at rank 1; Setup
  is absent below rank 4; five write controls are absent exactly one rank
  below their server gate and present at or above it, both sides asserted.
  This closes the *rendering* question only — nobody has yet signed in as a
  viewer on a live instance; that still needs the live read-only login
  (Q65–70) and an IFL-created account.
- **`web/src/rank.crosscheck.test.ts`** reads the `requireRole` off each write
  route and asserts it equals the client-side rank constant, six pairings —
  the mechanical form of the 3 Sep defect where the register's Export button
  was offered at rank 2 while the server gated it at 3.
- **Phase 7's failure states are locked down**, nine two-sided cases across
  `SyncHealthBlock`, `Readings` and `Weight` (`.test.tsx` beside each). Each
  asserts the absence of the false all-clear sentence it used to print — for
  example "None", "0 cones weighed", "No cones were weighed in this period",
  "all stations steady" — and, on the other side, that a healthy fetch still
  shows the real value, so a screen that just says "could not load"
  unconditionally would fail too.
- **Six drilldown hops** (`web/src/hops.test.tsx`), each asserting the URL
  against `routeSearch()` and that the destination's first request carried
  the handed-off value. One hop — Reading sheet → Product Catalogue — carries
  its id in the URL only, never in a request, and is documented as such in
  the file rather than given a hollow assertion.
- **A real test-ordering defect was found and fixed**, not merely worked
  around. `--sequence.shuffle` failed 14 of 15 runs. `api/src/routes/
  ops.test.ts` shared session cookies from a `beforeAll` while some of its own
  tests revoke sessions. `api/src/app.config.test.ts`'s failure had a
  different cause — a deliberately stateful fake DB accumulating mutations
  across tests with only one valid run order, not the first cause proposed for
  it. Both suites are now order-independent; 45 consecutive shuffled runs
  passed clean.
- **An unexplained rare flake remains open.** Roughly 1 failure in 74 full
  `npx vitest run` executions, never captured with a test name. 60 clean runs
  in normal order failed to reproduce it, and a worker correctly declined to
  apply a speculative fix without a capture. The one suggestive observation —
  `Weight.test.tsx` failed once while two heavy vitest processes ran
  concurrently, and did not reproduce without that load — is consistent with
  resource contention, but is **not proven and not a capture**. Treat every
  "the suite is green" claim made from this phase onward as carrying that
  caveat until it is captured and fixed. See §6.
- **Not done by this phase**: Phase 9 (visual polish, the last UX phase) has
  not started, including `report/PrintHead.tsx` (a failed header fetch
  silently drops the print attribution block, allow-listed in the reliability
  guard as deferred to Phase 9) and the Product screen's visual pass. There is
  still no browser harness — jsdom computes no layout, so nothing asserts
  anything about layout, print CSS, or the Wall at 1920px; Playwright was
  explicitly deferred by the owner and would layer on top of this harness, not
  replace it. `@testing-library/user-event` is not installed, so Setup's six
  form blocks and the Changeover confirm flow have no component test.

### UX programme, Phase 7 — Reliability states (21 Sep 2026)
- Six commits (`b689e99` a PROJECT_STATUS figure correction, not phase work; then
  `1d32f02`, `e596724`, `8611d2b`, `2bcaad8`, `48de0a7`). One defect class fixed
  throughout: a failed fetch rendering as an EMPTY or ZERO answer — the
  application asserting a fact it does not have — not new analytics.
- **Health's `SyncHealthBlock.tsx`** never read `ops.error` (verified: it now
  does, `web/src/screens/health/SyncHealthBlock.tsx`), so a failed
  `/api/operations` printed "None" for blocking DQ findings, "No data quality
  findings are open", and an empty per-table list — the one block whose job is
  to report breakage announced all-clear while blind. It now names the
  distinction in words. Four more instances of the same shape fixed on Weight,
  Readings, Product › Running and Wall.
- **Partial-failure naming**: where several fetches feed one statement, the
  screen now names which part failed instead of collapsing to one error —
  applied on Readings (a reject-count-only failure keeps the weighed total) and
  Weight (one fetch had been gating the whole screen).
- **`sms.verify_run`** (migration `039_dq_destination_and_verify_run.sql`) is a
  new table, written by `cli/src/commands/verify.ts` (verified: one `INSERT INTO
  sms.verify_run` per run, non-fatal on write failure) and read by
  `GET /api/system-history` (`api/src/services/systemHistory.ts`) alongside
  `sms.source_epoch` and `sms.rebuild_audit` — the first UI surface for any of
  the three. Health states it is the record of a manual run, not a live check;
  **`sms verify` over HTTP was deliberately not built** (no IFL connection from
  the API; the credential/host are open IFL questions Q65–70; a route would put
  table scans on the live plant server).
- **`GET /api/dq-destination`** (`api/src/app.ts`, resolves a DQ finding's
  `subjectRef` to its canonical row) and `GET /api/system-history` are both
  rank 1 — verified: neither has a `requireRole` call in `api/src/app.ts`.
  `reject_event` cannot say whether a reading came from the QCS check or the
  weight scale, so those DQ findings offer no destination link and say why,
  rather than guessing (a worker proved the danger by resolving one real
  `subjectRef` against both tables and getting two different plausible rows).
- **Two guards added**, both proven to fail when the defect is reintroduced
  (`web/src/reliability.guard.test.ts`): every `usePolling()` result's `.error`
  must be read in its own file, or carry a written `ALLOW_LIST`/`KNOWN_DEFECTS`
  entry (`KNOWN_DEFECTS` is empty — verified, no live exceptions currently
  claimed); and the ONE AUDIENCE rule (CLAUDE.md: every GET open to every
  signed-in account, roles gate writes only) is now mechanical on the client
  side, locking the exact set of `rank >=` read-tier gates in `App.tsx`. A
  server-side counterpart lives in `api/src/app.rbac.test.ts`.
- **`sms.source_epoch.last_seen_utc` has no writer anywhere in the
  repository** — verified by grep (only a column definition in migration
  `025_source_epoch.sql` and a read in `systemHistory.ts`); `web/src/lib/words.ts`
  now documents this ("Never populated") rather than the UI showing bare
  dashes unexplained. Recorded here as an open item, not fixed this phase.
- Test suite: **1194 passed / 4 skipped**, `npx vitest run` from `sms/`,
  observed 21 Sep 2026 (was 1169).
- **Not done by this phase:** roadmap Phases 8 (Testing) and 9
  (Documentation/visual polish) are unstarted — there is still no browser or
  component-test harness for any of the 16 top-level `web/src/screens/*.tsx`
  files (`vitest.config.ts` is `environment: 'node'`, `*.test.ts` only), and
  `web/src/screens/report/PrintHead.tsx` still silently drops its whole print
  attribution block on a failed header fetch (`if (!header) return null`),
  allow-listed as a deferred, cosmetic-only gap. Blocked on IFL, unchanged:
  written authority for the nine PDAS write rights, `AddTubeType`'s parameter
  name, weight basis (Q4/Q5), KPI approval (Q33-37), reject-code meanings
  (Q10), sack stock per machine (not computable), the 10 Jul – 5 Aug data, and
  the live read-only login/host (Q65-70, which is what blocks `sms verify`
  over HTTP). **The rank-1 (viewer) UI path has still never been exercised
  live** — Phase 7's guards close the client-side *gating* question
  mechanically; they do not close the *rendering* one. Verified against the
  local `_SEP07` dev copy only, never real plant data. The branch remains
  unpushed, now roughly 85 commits ahead of `origin/main`.

### UX programme, Phase 6 — Expose backend (16 Sep 2026)
- Four commits (`be4b9fc`, `fd85624`, `0d8b74a`, `177abc9`) put a UI on backend
  that already existed, routed and tested, but had no caller. Verified against
  the code: the nav bar (`SCREENS` in `web/src/ui/Bar.tsx`) now has **seven**
  entries (`line, readings, weight, rejects, sacks, product, report`), not
  eight — one more than Phase 5.
- **Product**, a 7th nav item with four tabs (Running/Changeover/Catalogue/
  History, URL key `pt`). `web/src/screens/ProductSheet.tsx` is deleted and
  unreferenced (grep-verified); its content moved into `Running.tsx` and
  `Catalogue.tsx`. Running pivots `/api/machines/running` by material; Line's
  own machine table is untouched, so the same capability is not on two
  screens.
- **The changeover workflow is reachable at last**, `?s=product&pt=changeover`
  over `/api/changeover/{refs,plan,execute}` (existed since roadmap Wave F,
  zero prior callers). Plan is rank 1; execute is `requireRole(PDAS_WRITE_RANK)`
  = rank 2 and returns `503 DISABLED` while `PDAS_WRITE_ENABLED=false`
  (verified in `api/src/routes/changeover.ts`), rendering the server's
  `disabledReason` verbatim with no optimistic UI.
- `sms.product_change`'s first reader: `GET /api/product-changes` (rank 1,
  keyset-paged, `api/src/services/productChanges.ts`), rendered on
  Product › History beside the product timeline.
- DQ findings are listed (grouped by `subjectTable`) on Health, no API change.
  Reconciliation (`GET /api/reconciliation`) is wired on Health, its rank
  lowered from 3 to 1 by owner decision — it is a read of SMS's own
  `sms.cone_event` aggregates, not a comparison against IFL's source (`sms
  verify` is that, has no HTTP route). A UI sentence claiming a grouping the
  endpoint does not do ("by source table and generation") was removed.
- Test suite: **1169 passed / 4 skipped** (`npx vitest run` from `sms/`,
  observed 16 Sep 2026; was 1164 before this phase).
- **Not done by this phase:** reliability states (DQ-finding → source-table
  destination, source-generation history, `sms.rebuild_audit`, archived floor,
  `sms verify` over HTTP — 3-4 days of new backend); testing (still no
  automated route/browser harness — every hop was verified by hand, by grep,
  and by the vitest run above); visual polish of the Product screen. Blocked
  on IFL, unchanged: written authority for all nine PDAS write rights,
  `AddTubeType`'s parameter name, weight basis (Q4/Q5), KPI approval (Q33-37),
  reject-code meanings (Q10); sack stock per machine remains not computable
  from IFL's data. Everything verified against the local `_SEP07` dev copy
  only, never against real plant data. The rank-1 (viewer) UI path was never
  exercised live in Phase 5 or 6 — workers were signed in as admin and
  forbidden to create or reset accounts — so rank gating rests on code
  inspection and the RBAC test only. The branch remains unpushed, now roughly
  80 commits ahead of `origin/main`.

### UX programme, Phase 5 — Analytics (16 Sep 2026)
- Six commits (`be5ac3e`, `5503406`, `0510afd`, `cc1ffe3`, `856e981`, `1f16faf`) closing the
  one place the owner's §8 rule ("never judge a reading by today's mirror") did not yet
  hold: the cone-weight report's figure tile took its target from `weights.ts`'s
  "current product, right now" figure (`FALLBACK_CONE_SETPOINT_G = 1950` with none
  selected) while its own `vs target` column, in the same report, already used the period's
  own versioned target. Now one target, resolved at the period end
  (`api/src/services/reports/coneWeight.ts`'s `target.inForceAtUtc` / `target.source`).
- Per-station-per-material targets: a station running exactly one material is judged
  against that material's target; a station running more than one gets no number, not a
  blend (`WeightStationRow.targetBasis`, `api/src/services/weightStations.ts`); pre-
  `MaterialId` July rows fall back to the line-wide product, marked as such. Reaches the
  station table on the web, not just the chart.
- A guard test, `web/src/targets.guard.test.ts`, greps the committed source for the
  fallback/current-product identifiers outside their one legitimate home and fails if a
  report `target` field omits `inForceAtUtc` or an explicit `'none'` source — proven to
  fail on the pre-fix tree (`be5ac3e^`).
- Count-shaped KPIs stopped reporting a coverage hole as a trend; an explicit
  `KpiShape = 'total' | 'rate'` (`api/src/services/reports/summary.ts`) replaced a
  unit-string heuristic that had also wrongly suppressed non-coverage-sensitive ratios
  (Average sack kg, Cones per sack). The Pareto's cumulative line (server-computed since
  day one) is now rendered. A cone/sack weight-chart toggle (`wt` URL key) was added,
  rendering the absence of a sack tolerance rather than inventing one.
- This phase made existing engineering honest and visible; it added no new analytic. Test
  suite: **1164 passed / 4 skipped** (`npx vitest run` from `sms/`, observed 16 Sep 2026;
  was 1138 before this phase). Typecheck/build were not re-run in this pass — re-run before
  relying on that gate.
- **Not done by this phase:** the Product nav item and its Running/Changeover/Catalogue/
  History tabs; the changeover workflow UI over `/api/changeover/{refs,plan,execute}`;
  reconciliation. Four Phase-4 drilldown hops (`053e4de`) still have no destination.
  Weight basis (Q4/Q5), KPI approval (Q33-37), reject-code meanings (Q10) and the missing
  sack tolerance are all unchanged and still blocked on IFL. Verified against the local
  `_SEP07` dev copy only.

### Day 0 (14 Sep 2026)
- Repository preparation: `.gitattributes`, `q.mjs`/`sync-trace.mjs` ignored, Node 22 pin (`.nvmrc`, `engines`), root `typecheck` covering all five workspaces, root `build`, `verify:release`.
- Atomic baseline commit `a585302` (114 paths) and annotated tag `v0.1.0-baseline`; staged set checked for secrets and client data before committing.
- Copies of the repository (`git bundle --all`, verified) and a checksummed app-DB backup (`RESTORE VERIFYONLY` passed) — first to `C:\sms-backups` (which turned out to be the OS disk, not a second drive), then on 14 Sep 14:08 hash-matched to `D:\sms-backups` on the second physical disk.
- Captured release gate: `sms/BASELINE-RUN-2026-09-14.txt`.

### Wave C/D round 2 — Phases 7, 8 and 9 (15 Sep 2026)
- **Sacks** — screen, line-level ledger (033), two findings. **Reports** — nine types, CSV, print header, KPI sheet, four defects. **Calibration** — median, SD, Nelson names, plant-clock fix, ledger fields (034), projection, validation document. 888 tests (was 732). Verified on the sidecar: all nine report types, the sack summary/stock/movements endpoints, the station sheet with median/SD/flagged days.

### Wave C/D round 1 — Phases 4, 5 and 11 (15 Sep 2026)
- **Cone weight** — one five-state classification + fixture, weight reconciliation, one population rule, machine view, shift check, product-limits history. **Rejects** — per-day-per-code + reason sheet, filters, control band, agreement with Line. **Operations & security** — passwords, health endpoint and screen, recovery, retention, append-only audit, destructive-command gates, ops scripts, upgrade procedure, version 0.2.0. 732 tests (was 498).
- **Recovery rehearsal (roadmap Phase 11 acceptance), 15 Sep 2026, on the development sidecar:** (1) a `running` sync_run row planted 3 h old → the next worker start marked it `failed — orphaned: the worker was restarted mid-pass`; (2) source unreachable (`IFL_DB_PORT=1`) for 5 passes at a 5 s interval → three connect attempts per pass (transient only), one `halted` row per table per pass, `/api/operations.source.halted` = all four tables with the `[transient]` reason, `/api/health` `degraded`, `persistent_sync_failure` CRITICAL raised at the threshold; (3) source restored, one pass → all four tables `success`, the CRITICAL finding cleared, health `ok`, raw and canonical counts identical before and after (275,063 / 275,063): **no data lost, none duplicated**; (4) the API restarted twice during the rehearsal — sessions survived (server-side). Not rehearsed here: a SQL Server service restart (needs an administrator session on this machine) and an NSSM-supervised restart (no service installed on the development machine) — both are in DEPLOY.md's procedure and remain for the plant host. Two defects the rehearsal found are fixed: a connection halt was not counted as a failed probe, and a one-shot pass did not clear the standing finding.

### Wave B — Phases 2 and 3 (14 Sep 2026)
- **Integration layer formalised** — adapter interface and registry, error classification, transient-only retry, per-table isolation, source probe, column-list drift, structured JSON logging, health `source` block on `/api/operations` and Setup. **Canonical model traceable** — migration 029, `TRANSFORM_VERSION = 2`, rebuild of 295,196 rows, provenance on every row and on screen, `canonical.ts`, `subject_ref`, rebuild gate, `DATA-DICTIONARY.md`. 498 tests (was 417).

### Wave B — Phase 1 (14 Sep 2026)
- **Configurable platform** — migration 028 (`plant`, `plant_unit`, `line`, `machine`, `station.machine_id`, `data_source`, `source_table`, `reject_code.line_id`), the worker's `loadSourceTables`/`resolveShiftRule`/`station_not_in_roster`, the API's `/api/config`, the admin routes and `auditedWrite` (one transaction for the change and its audit row), and the six Setup sections. 417 tests (was 324). Rehearsed live: a 15th machine and a shift-boundary change, both through configuration only.

### Wave A — Phase 0 closure and phase-independent hardening
- **`92df608`** — from-zero bootstrap (`db/bootstrap/00_create_app_database.sql`, least-privilege `sms_app`), the IFL read-only login template for their DBA, dev epoch seed moved out of migration 025, `migrate.mjs --mark-applied-through`, `DEPLOY.md` migration guidance made true (026 is not re-runnable), NSSM `AppStderr`/`DependOnService`/rotation, the *Credentials and secrets* section, `?v=`→`?s=`, duplicated step 8, three table counts reconciled (31), `CAPABILITIES.md` inversions, `SPEC.md` phantom test. From-zero migration rehearsal and restore re-rehearsal on the two-generation schema, both recorded.
- **`478c456`** — every sync halt writes a `sync_run` row per table (`outcome = 'halted'`, reason in `error_text`); Setup prints the reason; PDAS mirror failure is a standing finding and no longer stops ingestion; transform failure is a standing CRITICAL finding; both clear on recovery; app-pool leak on IFL connect failure fixed; `SYNC_INTERVAL_SECONDS`/`SYNC_OVERLAP_ROWS`/`LINE_ID` validated as whole numbers. Verified against the sidecar with a forced source failure. 23 new tests.
- **`a473d4d`** — reject sheet tells the truth ("Rejected cone", the reason, "not weighed", the row's own product); weight rejects match their code row in the register; renaming a reject code no longer wipes its pass flag; `z.boolean()` on the product-active routes; Setup's blocking-findings count compares against the real severities; SPC limits from the versioned history at the end of the period, with a note when they changed inside it; one server-side verdict via `/api/product-at?weightG=` and the client `judge()` removed. Verified in the browser on two September rejects. 34 new tests (routes, getSpec, seeders).
- **`0dd33fa`** — `BASELINE.md`, this file, `.github/workflows/ci.yml` (typecheck · test · build · clean-tree check · no-secret-file check; no new dependency).
- **`7a0c5f7`** — after three adversarial verifiers: the `-0` timezone defect that would have made CI red on first push; `CHECKSUM` + self-verification in the backup script; the CI secret-file check run from the repository root; simulator env keys and the `sms_sim` login documented; `DEPLOY.md` step 6 and the 31-table figure corrected. Then the clean-checkout rehearsal (fresh clone on the second disk, `npm ci`, full gate, API + worker + CLI started from `dist/`), the second-disk copies of every artefact, and this file and `BASELINE.md` corrected to what is actually true.

---

## 3. In progress

Nothing is mid-change on the roadmap track; the working tree is clean at every commit above. Separately, the UX programme (§2, not a roadmap phase) has moved past Phase 7: Phase 8 (Testing) is now built (§2) — the project can render a React component under test for the first time, the rank-1 viewer UI matrix and six drilldown hops are locked down, and a real test-ordering defect was found and fixed. UX programme Phase 9 (visual polish, the last UX phase) is **not started**. Roadmap Wave B itself has not begun, because every item in it depends on an IFL answer (§5) or on an owner decision (§4).

---

## 4. Blocked — owner decision (not IFL)

These are not done unilaterally. Each is one action.

| # | Decision | Why it is the owner's |
|---|---|---|
| 1 | `git push` of `floor-first-rework` and the tag; whether `main` fast-forwards | Outward-facing; the branch has no upstream. CI runs only after this. |
| 2 | A copy of `D:\sms-backups\*` (two bundles, the baseline `.bak`, the script-statement `.bak`) **on other hardware** — the artefacts are now on both physical disks of the development machine and nowhere else | The July generation (142,511 cones) exists nowhere else; IFL dropped the table. |
| 3 | Send the IFL question pack (`IFL-QUESTIONS-STATUS.md`, 36 open; §18 of the gap analysis for the consolidated set) | Client communication. Every wave after A waits on some of these. |
| 4 | Explain or drop the `sms_real` database on the development instance; delete or deliberately keep `sms/.env.backup-before-sim` (ignored, never committed, real values) | Data and secrets on the owner's machine. |
| 5 | The two test-data rows (`DECISIONS-PENDING.md` §12: station-7 "verification test" adjustment, `floor` account) — remove or keep as audit trail | Owner's data. |
| 6 | Provision `sms_pdas_writer` locally against the SEP07 copy so the write path can be exercised offline | Touches a copy of client data. |
| 7 | `TRANSFORM_VERSION` bump + rebuild | Deliberately held for Wave B (needs Q1/Q3/Q4/Q14 first so it is bumped once). |

---

## 5. IFL dependency

Consolidated in `ROADMAP-GAP-ANALYSIS.md` §18 and numbered in `IFL-QUESTIONS-STATUS.md`. The ones that gate the next waves:

| Wave | Needs from IFL | Gates |
|---|---|---|
| B | Q1/Q3/Q4/Q14 — plant/unit/line/machine entities, multi-line intent | Phase 1 schema, adapter extraction, the single `TRANSFORM_VERSION` bump |
| C | The live read-only login (`10_ifl_readonly_login.template.sql`) and the target host (Q65–70) | Phase 11 live cutover rehearsal, `sms verify` on an `ifl_live` generation, scheduled backup, NSSM install |
| D | Q33–37 (weight states, reconciliation), Q12 (KPI/report approval), Q24/Q10 (reject code meanings) | Phases 4, 5, 8 |
| E | Q28–32, Q43 — sack↔machine association, stock ledger definition | Phase 7 |
| — | The 10 Jul – 5 Aug 2026 data (exists at IFL, not sent) | Continuity of history; note the July reader shape must be re-enabled to load it |
| — | Written authority for PDAS writes (Q5) | Phase 6 switch-on |

Rule 17 applies: nothing above is guessed past. Work proceeds on whatever does not depend on them.

---

## 6. Test status

| | Value |
|---|---|
| Suite | vitest, **1240 tests passed / 4 skipped**, 118 test files (21 Sep 2026, end of UX programme Phase 8, observed via `npx vitest run` from `sms/` — this run); 1194/110 at the end of UX programme Phase 7; 1169/109 at the end of UX programme Phase 6; 1164 at the end of UX programme Phase 5; 888 passing at the end of Wave C/D round 2 (15 Sep 2026); 324 at the Phase 0 closure, verified under UTC and in a fresh clone |
| Gate | `npm run verify:release` — typecheck (all five workspaces) · tests · build; exit 0 (not re-run this pass — only `npx vitest run` was) |
| CI | `.github/workflows/ci.yml` runs the same gate plus a clean-tree check and a tracked-secret-file check on every push to `main`/`floor-first-rework` and every PR. **Has not run yet** — nothing is pushed. |
| Database needed | None. Every test runs against a fake `mssql` pool or pure functions. |
| Known failures | **One open, unexplained, intermittent.** Roughly 1 failure in 74 full `npx vitest run` executions under `--sequence.shuffle`; no test name has ever been captured for it. 60 clean runs in normal order did not reproduce it. The one suggestive-but-unproven observation: `Weight.test.tsx` failed once while two heavy vitest processes ran concurrently, and did not reproduce without that load, consistent with resource contention rather than a code defect — **not proven, not a capture**; do not "fix" it speculatively. Two ordering defects that WERE captured and fixed in this phase: `api/src/routes/ops.test.ts` shared session cookies from a `beforeAll` while some of its own tests revoke sessions, and `api/src/app.config.test.ts` used a deliberately stateful fake DB that only tolerated one run order — both now independent, 45 consecutive shuffled runs clean. Separately, one timezone defect existed at `0dd33fa`, found only by an adversarial run under `TZ=UTC` (two `plantClock` tests, `-0` vs `0`); fixed and pinned in `7a0c5f7`. |
| Coverage gaps | Web: a component harness exists as of UX Phase 8 (`environmentMatchGlobs` in `vitest.config.ts`, keyed on the `.test.tsx` extension; `@testing-library/react`/`@testing-library/dom` added to the root `sms/package.json` only), but coverage under it is thin: of the 16 top-level files in `web/src/screens/`, only 2 (`Readings.tsx`, `Weight.tsx`) have a direct component test, plus the nested `screens/health/SyncHealthBlock.tsx`, the rank-1 UI matrix (`rank.matrix.test.tsx`), the rank/route crosscheck (`rank.crosscheck.test.ts`) and six drilldown hops (`hops.test.tsx`). The other 14 screens, including Setup's six form blocks, have none — `@testing-library/user-event` is not installed, so realistic form and confirm-flow interaction cannot be tested yet. No browser/layout harness exists at all: jsdom computes no layout, so nothing asserts anything about layout, print CSS, or the Wall at 1920px; Playwright is deferred by the owner and would sit on top of this harness, not replace it. A real HTTP route/RBAC harness DOES exist for the API (`api/src/app.routes.test.ts`, `api/src/app.rbac.test.ts` — real Express, fake pool, `node fetch`). No performance, load, FAT or SAT tests. The PDAS write path is tested against fakes only and has never executed against a PDAS database. |
| Live verification recorded this wave | Forced source failure → four `halted` rows → Setup shows the reason → healthy pass supersedes them (`478c456`). Weight reject 18376 and quality reject 18335 sheets (`a473d4d`). |

---

## 7. How to update this file

At the end of each wave or phase: move items from §3 to §2 with their commit ids; re-state §1 for any phase whose verified status changed; refresh §6's counts from a captured run; keep §4 and §5 as the true list of what is waiting on whom. Do not record a capability here that cannot be pointed to in code or in a recorded rehearsal.
