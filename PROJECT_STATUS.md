# PROJECT_STATUS.md — IFL Sack Management System

**Full session handover: [`HANDOVER-2026-09-15.md`](HANDOVER-2026-09-15.md)** — read it first if resuming cold; it covers the dirty working tree this file's §3 does not yet reflect.

**As of:** 16 September 2026, UX programme Phase 6 (Expose backend) complete on top of Phase 5 and Wave C/D (roadmap Phases 1–5, 7–9 and 11 complete; 10, 12, 13 and the IFL-answer work of §7 remain) · branch `floor-first-rework`
**Kept under roadmap rule 15:** completed · in progress · blocked · IFL dependency · test status. Updated at the end of every phase or wave; `BASELINE.md` is the frozen Phase 0 picture and is not.

Phase numbering follows `IFL_SMS_Claude_Code_Development_Roadmap.md`; the evidence behind every status is in `ROADMAP-GAP-ANALYSIS.md` (§2–§13 per phase, §15 waves, §17 defect register, §18 IFL clarifications).

**A second, separate numbering exists since 16 Sep 2026: the UX programme** (`audit/IA-PROPOSAL.md` Phase 2a, `audit/OVERVIEW-SPEC.md` Phase 3, then Phase 4 drilldowns, Phase 5 Analytics, and now Phase 6 Expose backend — ten commits `be5ac3e`…`177abc9`). It refines screens inside roadmap phases already marked complete above (mainly 4, 6, 8 and 9) rather than adding a new roadmap phase; see §2 below and `CLAUDE.md`'s "UX programme, Phase 6" section for what it actually changed. Do not read "Phase 6" in commit messages as roadmap Phase 6 (Product/PDAS) — the two numbering schemes are independent, and this UX phase is what finally put a UI on top of roadmap Phase 6's PDAS write path (still off).

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
| 12 — Testing & release | **PARTIAL** | 1169 tests passed / 4 skipped, 109 test files (16 Sep 2026, end of UX programme Phase 6; was 324 tests / 34 files at Phase 0 closure), all against fakes, passing under UTC±0 and UTC+5; CI workflow added (Wave A); `verify:release` gate. UI screens untested; no performance, FAT or SAT material. |
| 13 — Documentation | **PARTIAL** | `BASELINE.md`, `PROJECT_STATUS.md`, `DEPLOY.md` (corrected), credentials statement, technical history, questions status. Data dictionary, operator manual, FAT/SAT protocols absent. |
| 14 — Site commissioning | out of scope until a host exists | — |

---

## 2. Completed

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

Nothing is mid-change on the roadmap track; the working tree is clean at every commit above. Separately, the UX programme (§2, not a roadmap phase) has moved past Phase 6: the Product nav item, its Running/Changeover/Catalogue/History tabs, and the changeover-workflow UI are now built (§2), closing the four drilldown hops that `053e4de` had left with no destination. Phases 7, 8 and 9 of the UX programme (reliability states, testing, visual polish of the Product screen) are **not started**. Roadmap Wave B itself has not begun, because every item in it depends on an IFL answer (§5) or on an owner decision (§4).

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
| Suite | vitest, **1169 tests passed / 4 skipped** (16 Sep 2026, end of UX programme Phase 6, observed via `npx vitest run` from `sms/`); 1164 at the end of UX programme Phase 5; 888 passing at the end of Wave C/D round 2 (15 Sep 2026); 324 at the Phase 0 closure, verified under UTC and in a fresh clone |
| Gate | `npm run verify:release` — typecheck (all five workspaces) · tests · build; exit 0 |
| CI | `.github/workflows/ci.yml` runs the same gate plus a clean-tree check and a tracked-secret-file check on every push to `main`/`floor-first-rework` and every PR. **Has not run yet** — nothing is pushed. |
| Database needed | None. Every test runs against a fake `mssql` pool or pure functions. |
| Known failures | None. One existed at `0dd33fa` and was found only by an adversarial run under `TZ=UTC` (two `plantClock` tests, `-0` vs `0`); fixed and pinned in `7a0c5f7`. |
| Coverage gaps | Web: 14 test files (route parsing, API callers, the targets guard, lib helpers, and two nested screens/** modules — `product/ProductLimitsBlock.tsx` and `report/model.ts`); all 16 top-level files in `web/src/screens/` (`ls web/src/screens/*.tsx`) have no direct component test — verified by hand in the browser. No performance, load, FAT or SAT tests. The PDAS write path is tested against fakes only and has never executed against a PDAS database. |
| Live verification recorded this wave | Forced source failure → four `halted` rows → Setup shows the reason → healthy pass supersedes them (`478c456`). Weight reject 18376 and quality reject 18335 sheets (`a473d4d`). |

---

## 7. How to update this file

At the end of each wave or phase: move items from §3 to §2 with their commit ids; re-state §1 for any phase whose verified status changed; refresh §6's counts from a captured run; keep §4 and §5 as the true list of what is waiting on whom. Do not record a capability here that cannot be pointed to in code or in a recorded rehearsal.
