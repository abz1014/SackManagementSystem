# PROJECT_STATUS.md — IFL Sack Management System

**Full session handover: [`HANDOVER-2026-09-15.md`](HANDOVER-2026-09-15.md)** — read it first if resuming cold; it covers the dirty working tree this file's §3 does not yet reflect.

**As of:** 23 September 2026 (§2's first entry) — correctness and charting work across twenty-two commits, on top of the UX programme's close on 21 September · branch `floor-first-rework`

> **Correction, 23 Sep 2026.** The line above used to end "…and the IFL-answer work of §7
> remain". **There is no §7 covering IFL answers** — §7 of this file is "How to update this
> file", and the Phase 7 row of §1 below carried the same dangling pointer. The IFL answers
> of 15 September live in `handover/IFL-ANSWERS-2026-09-15.md` and are now folded, question by
> question, into `IFL-QUESTIONS-STATUS.md`. The single list of what IFL must still answer —
> fifteen asks, ordered by what each unblocks — is the new
> [`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md).

**Kept under roadmap rule 15:** completed · in progress · blocked · IFL dependency · test status. Updated at the end of every phase or wave; `BASELINE.md` is the frozen Phase 0 picture and is not.

Phase numbering follows `IFL_SMS_Claude_Code_Development_Roadmap.md`; the evidence behind every status is in `ROADMAP-GAP-ANALYSIS.md` (§2–§13 per phase, §15 waves, §17 defect register, §18 IFL clarifications).

**The living defect register is [`DEFECTS.md`](DEFECTS.md)** (started 22 Sep 2026) — it triages every §17 row against the code as it stands today (most are fixed; the still-open ones carry their own R-series ids) and tracks new defects going forward. This is the evidence behind "no critical/high unresolved defects" in the Definition of Done; §17 itself is now a historical snapshot, not the current picture.

**A second, separate numbering exists since 16 Sep 2026: the UX programme** (`audit/IA-PROPOSAL.md` Phase 2a, `audit/OVERVIEW-SPEC.md` Phase 3, then Phase 4 drilldowns, Phase 5 Analytics, Phase 6 Expose backend, Phase 7 Reliability states, Phase 8 Testing, and now Phase 9 Print & visual polish, which CLOSES it — twenty-five commits `be5ac3e`…`08398b9`). It refines screens and, as of Phase 8, the test harness itself, inside roadmap phases already marked complete or partial above (mainly 4, 6, 8, 9, 11 and 12) rather than adding a new roadmap phase; see §2 below and `CLAUDE.md`'s dated "UX programme, Phase 9" section for what it actually changed, and the same file's Phase 8 section immediately below it for the harness work Phase 9 builds on. Do not read "Phase 8" or "Phase 9" in commit messages as roadmap Phase 8/9 (Dashboards & reports / Calibration analytics, both long complete) — the two numbering schemes are independent, and roadmap Phase 12 (Testing & release) moves from PARTIAL-with-no-component-harness to PARTIAL-with-a-component-harness-and-print-CSS by these two UX phases; it is not marked COMPLETE because performance, load, FAT and SAT are still untouched, no browser/layout harness exists to verify print or the Wall, and print itself has only ever been checked by viewport-resize simulation, never a real print dialog (see §1 row 12 and the "Not done" notes under §2).

---

## 1. Phase board

| Phase | Status | What that means today |
|---|---|---|
| 0 — Freeze & baseline | **COMPLETE** (all five acceptance criteria met; adversarially re-checked) | Tag `v0.1.0-baseline`; `BASELINE.md`; from-zero DB rehearsal (reproduced independently); restore rehearsal; clean-checkout rehearsal (`npm ci` → gate → services started, in a fresh clone); no secrets in history (re-verified by hashing the real values); CI workflow. Three independent verifiers refuted five statements of the first closure and one real defect (the suite failed on UTC hosts); all fixed in `7a0c5f7`. What remains is not a criterion: a rehearsal on hardware other than the development machine waits on IFL's host (Q65–70), and CI has not run because nothing is pushed. Owner actions: push, branch decision, a copy on other hardware (§4). |
| 1 — Configurable platform | **COMPLETE — acceptance met, with three defaults awaiting IFL** | Migration 028: plant / unit / line / machine / station / data source / source table rows; reject codes per line; shift boundaries, night rule and mode are the versioned rule, read by the worker every pass and the API per request; source tables and `source_system` come from configuration (no `'ifl_sql'` or `pack1_TP1U2` literal on any live path); Setup › Line · Machines · Stations · Sources · Rules · Reject codes, every write audited in the same transaction. **Acceptance rehearsed 14 Sep 2026:** winder 15 added through Setup → its station appeared on the Weight/Readings station list with no code change; shift boundaries moved to 05:30/13:30/21:30 → `/api/live` moved the shift window the same second → restored to 06/14/22 (all three rows in `sms.shift_rule`, all in the audit log). Defaults that an IFL answer would change, editable as data: station N ↔ winder N (Q3), one line per installation (Q14), shift mode recorded not applied (Q7). |
| 2 — Integration layer | **COMPLETE for the SQL adapter; PLC/OPC adapter deliberately unbuilt** | `SourceAdapter` interface + `createAdapter` registry (`'ifl_sql'` → `IflSqlAdapter`; any other system code throws — the PLC/OPC adapter waits for IFL, roadmap 2B); driver errors classified `transient` / `auth` / `schema` and only transient ones retried, connect included; a table that halts no longer stops the others (each table's own `sync_run` row, healthy tables still transform, the pass reported failed with every halted table named); a source probe at the top of every pass; the full column list of every generation recorded and compared each pass (`source_columns_changed`); one JSON line per event from worker, API and CLI with a correlation id; Setup › Sync health prints the probe result, the halted tables and the reason verbatim. Acceptance: integration failure never crashes the worker or the API (rehearsed: connection refused → halt rows, recovery on the next pass); reconciliation per generation (`sms verify`, 12 generations OK after the rebuild); source reset cannot silently stop sync (epoch gate + backwards gate); lag visible (top bar, Setup); no writes to plant systems (SELECT-only login, PDAS writes off). |
| 3 — Canonical data model | **COMPLETE** | Migration 029 + `TRANSFORM_VERSION = 2` + a full rebuild of all three canonical tables (295,196 rows, 25 s, against a checksummed snapshot; `sms verify` clean on every generation afterwards): every reportable row carries source system, source table (via its generation), source row id, IFL's insert time, production time, **SMS's own ingestion time**, the sync pass that read it (a join that now resolves for 100 % of rows — it resolved for none before), transform version and attribution method/confidence (rejects included). `shared/src/domain/canonical.ts` is the one typed contract and the transform builds against it (the dead `events.ts` is gone). `dq_finding.subject_ref` points at the offending raw row. A person can read all of it on the reading sheet under *Where this reading came from*. `DATA-DICTIONARY.md` (37 tables, 369 columns, every one described) is generated by `npm run dictionary`. |
| 4 — Cone weight module | **COMPLETE — fixture and disagreement rule awaiting IFL approval** | ONE five-state classification (`shared/src/domain/classification.ts`: within · low · high · rejected · unknown), judged by the limits in force at the reading's own time, emitted on every register row, the sheet, the CSV and as counts on `/api/production`; the four scattered "outside limits" implementations are gone. Developer-proposed fixture of 24 cases (`sms/test/fixtures/cone-classification.json`) run by the suite — **awaiting IFL approval**, as is the rule for a scale/tolerance disagreement (state low/high with `scalePassed` kept and both facts printed). `sms verify --weights` reconciles COUNT/SUM/AVG/MIN/MAX per generation against the source; one population rule (both plausibility bounds, from the rule) across weights/SPC/production and the DQ check; station selector on the Weight chart; "What each machine is running" on Line; product column and filter on the register; Setup › Rules › Product limits (read-only history); shift-attribution check (`/api/shift-check`: 2.3 % of the week's cones carry a plant shift SMS derives differently) printed on Report and on the shift form. On the September generation: 132,497 within · 0 low · 0 high · 49 rejected · 4 unknown; every July cone is `unknown` because no product limits were in force before 5 Aug — honest, and a clarification for IFL. |
| 5 — Reject management | **COMPLETE — code meanings are an IFL data-entry task, not a wait** (corrected 23 Sep 2026: IFL answered on 15 Sep that there is no predefined list and the meanings are typed into Setup › Reject codes; nobody has typed them yet, so the labels are honestly blank) | Per-day-per-code drilldown (`/api/rejects/by-day-code`, production-day basis stated) with a reason sheet listing that day's rejects of a code and inline naming at rank 3; Pareto bars clickable (code chip), station and product filters on Pareto/trend/list; `shift`/`tsTo` on `/api/rejects` and `/api/reject-spc` with a 366-day cap, and the Rejects headline uses Line's exact period so the two screens agree (tested); the trend draws the p-chart's UCL/LCL band and marks out-of-control days; reasons follow the selected period (the 14-day window stays for episode detection only); every fetch has a failure state; `unattributed` counts cones and rejects separately; register reject-code join per line. IFL can pick a period and trace every reject number to its rows (the sheet prints the source row id and its generation). |
| 6 — Product / PDAS | **BUILT, OFF** | Complete write path through the vendor's procs, tested against fakes, never executed against any PDAS database; `sms_pdas_writer` provisioned nowhere. Stays off until IFL confirms in writing (Q5). |
| 7 — Sack management & stock | **COMPLETE at line level; per-machine stays dependent** | Sacks screen (`?s=sacks`): sacks weighed, kg, in-range % (the CLI figure no screen showed), cones per sack (approximate, labelled), by shift and by product; the stock ledger (migration 033, append-only movements — opening / receipt / issue / consumption / adjustment; weighed sacks are derived receipts; `machine_id` is NULL by CHECK constraint and no code path sets it — roadmap rule 6); manual movements at rank 3 through `auditedWrite`; a stock sheet per day; `sack_num_reset` (INFO) and `sack_blackout` (WARNING, `SACK_BLACKOUT_HOURS`) findings. **IFL's answer of 15 Sep (Q28) reframes "sack stock per machine" as sack production per machine by shift/day — recorded in `handover/IFL-ANSWERS-2026-09-15.md` and in `IFL-QUESTIONS-STATUS.md` Q28 (the old "see §7" pointed at nothing). Done: the screen leads with the period's figures and the same by shift and by product, with the ledger third (`web/src/screens/Sacks.tsx`, re-read 23 Sep 2026), and the tenth report type *Product by machine and shift* exists because of this answer.** No sack is attributed to a machine (acceptance holds by construction and is stated on screen). |
| 8 — Dashboards & reports | **COMPLETE for TEN report types; Excel and PDF both built; KPI definitions await IFL approval** | One Report surface with **ten** types — Daily · Shift · Product · Machine/station · Rejects · Cone weight · Sacks · Calibration · Management summary, plus **Product by machine and shift**, the tenth, added on IFL's 15 Sep answer to Q28 (verified 23 Sep 2026: `REPORT_TYPES` in `api/src/services/reports/common.ts` and in `web/src/api.ts` both list ten, `machine-product` registered last). This row said "nine" until 23 Sep 2026. Excel and PDF are no longer "to build": `reports/xlsx.ts` ships real chart/drawing/dataBar parts (`f61eb35`) and `reports/pdf.ts` renders server-side (`47ac224`) — whether they meet IFL's "beautiful, with graphics" is a judgement only IFL can make by looking. Each type is each a composed `GET /api/reports/<type>` reusing the existing services, a CSV export (rank 3, audited) and a print header (line · period · filters · generated at plant time · by whom · SMS version); management summary with the prior period of equal length and deltas; `/api/report` gains `shift`; `groupBy=product` on production. `KPI-DEFINITIONS.md` (32 rows: definition, SQL-level formula, denominator, clock, exclusions — every row "IFL approval: awaiting") is the sheet for Phase 8's acceptance. Four defects closed: Weight passes `tsTo`, Wall never asks for an undefined day, Readings' print has the header, the three orphaned client wrappers are gone. All nine answer 200 on the sidecar (verified 15 Sep). |
| 9 — Calibration analytics | **COMPLETE — validation method awaiting IFL** | Median beside the mean (same population rule) on Weight, the station table and the sheet; per-station SD rendered; Nelson rules named on hover and on the sheet, the centreline and I-MR sigma restart at a logged adjustment, rules that cannot fire on the series length are said so; the station sheet compares days on the plant clock (`web/src/lib/plantClock.ts`); the adjustment form takes the plant time, a note, before/after/reference readings and the product in force (migration 034); adjustments filter by period and station and include line-wide ones; a **projection** ("at N g/day this station reaches the action limit in about K days if it continues at that rate" — OLS over the flagged run, never called a prediction); `CALIBRATION-VALIDATION.md` with a real sweep over the 53 days: 12 flagged episodes, all beginning with a measurable step, 11 of them in July where no product limits existed (a floor on the fallback threshold is recommended, value for IFL). |
| 10 — Optional AI/ML | **BLOCKED** | 53 production days held against a six-month minimum; one ledger row. Wave F, after go-live plus accrual. |
| 11 — Security & operations | **COMPLETE — role mapping, retention policy and the live-host rehearsal await IFL** | Password change (self) and reset (admin) with session revocation and a length policy; last-admin guard; login/logout/failed-login/export audited; limiter and cache bounded; `/api/health` (service · database size vs the 10 GB cap · acquisition · backups) and a Health screen every account can open; `pool.on('error')`, graceful SIGTERM/SIGINT, orphaned-run reconciliation at start, `persistent_sync_failure` CRITICAL after N consecutive halts (cleared by the next clean pass — loop or one-shot), hourly database-size check; `sms retention` (sync_run 90 d keeping the newest per table, non-CRITICAL findings 365 d, expired sessions; never audit/product_change/readings — IFL's decision); migration 030 makes `audit_log` append-only at the database (with the `db_ddladmin` caveat written down); `cutover`/`epoch:purge` take the lock, refuse a pass in flight and require `--backup=<existing .bak>`; scripts for DB maintenance, scheduled tasks (`-WhatIf` rehearsed) and configuration backup; DEPLOY.md gains Health, Scheduled tasks, Retention, Database maintenance, Configuration backup, Upgrading and rolling back; CHANGELOG 0.2.0. **Acceptance rehearsed 15 Sep 2026** (§2). |
| 12 — Testing & release | **PARTIAL** | 1246 tests passed / 4 skipped, 120 test files (21 Sep 2026, end of UX programme Phase 9; was 1240/118 at Phase 8, 1194/110 at Phase 7, 1169/109 at Phase 6, 324 tests / 34 files at Phase 0 closure), all against fakes, passing under UTC±0 and UTC+5; CI workflow added (Wave A); `verify:release` gate (not re-run this pass — `npx vitest run` and `npm run typecheck` were). The component harness (closed at Phase 8: `vitest.config.ts`'s `environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']]`, the rank-1 UI matrix, six drilldown hops, the route/client rank crosscheck) is unchanged by Phase 9. Phase 9 adds `PrintHead.test.tsx` (two-sided: header present vs a failed fetch's degraded block) and `web/src/print.landscape.guard.test.ts` (a source-level guard proving app.css's print-landscape CSS selector and Report.tsx's rendered aria-label stay in agreement — proven to fail on a deliberately mismatched string and pass once restored). Of the 16 top-level files in `web/src/screens/`, 2 (Readings, Weight) have a direct component test; the other 14, including Setup, do not. Still absent: any browser/layout harness (jsdom computes no layout; Wall at 1920px and print CSS are verified only by viewport-resize simulation plus an injected stylesheet, never a real print dialog — see CLAUDE.md's Phase 9 section) and `@testing-library/user-event` (not installed, so Setup's form blocks and the Changeover confirm flow cannot be component-tested with realistic event sequences). The rank-1 matrix closes the *rendering* question only — nobody has signed in as a viewer on a live instance; that still needs Q65–70 and an IFL-created account. No performance, load, FAT or SAT material — this row stays PARTIAL for that reason. **One unexplained intermittent failure remains open** (roughly 1 run in 74 under `--sequence.shuffle`, never captured with a test name — see §6); a suite reported "green" carries that caveat. |
| 13 — Documentation | **PARTIAL** | `BASELINE.md`, `PROJECT_STATUS.md`, `DEPLOY.md` (corrected — the font claim in its "Internet access is not required" section was itself wrong until this pass, see §6/CLAUDE.md), credentials statement, technical history, questions status. Data dictionary, operator manual, FAT/SAT protocols absent. |
| 14 — Site commissioning | out of scope until a host exists | — |

---

## 2. Completed

### 23 September 2026 — correctness, charting and the source-generation sweep (twenty-two commits)

Not a roadmap phase and not a UX phase: a day of correctness work on top of a closed
programme. Recorded here under rule 15 because several of these changed a **number IFL would
read**, not only how it looked. Every claim below is the commit's own, re-checked against the
tree at the time of writing; nothing here has run against live plant data.

- **The X̄ control-limit model was replaced** (`6052b69`) and **rule-1 marks restored**
  (`c1d176c`) — closing `DEFECTS.md` D-10, which had been fixed on 22 Sep by *suppressing*
  the marks. The old band (`X̿ ± 3·σ_within/√n`) flagged ~16 % of subgroups at month scale
  against a textbook ~0.3 %; the new I-MR band on the subgroup means measures 5.6–13.1 % on
  the three real generations. **Nelson rules 2–8 stay suppressed** — measured at 37.6–54.8 %
  on the same windows, which is noise, and the screen now says they are withheld rather than
  letting their absence read as "no patterns found".
- **The reject rate was being computed three different ways, two of them double-counting**
  (`4f68945`, `ede05e9`, `c1d176c`). A rejected cone was counted twice in the denominator in
  `report.ts` and `rejects.ts`, a bug `rejectSpc.ts` had already been fixed for.
- **Source generations stopped being pooled** (`6052b69`, `ca34a23`, `8673ffd`, `0a0f030`,
  `4b514b2`) — IFL dropped and recreated their weighing tables on 5 Aug 2026, so a model
  fitted across that boundary is fitted across two different records. Tracked as **D-11** in
  `DEFECTS.md`, **partly fixed**: the still-unconstrained call sites are listed there by
  `file:line` rather than being described as done.
- **Charts, exports and print** — real charts on Sacks and Line, the calibration table stopped
  contradicting its own Mean column (`29f4e70`), a chart drawn from a failed refresh now says
  so (`8d60ee9`), distinct product names in every export (`71ac170`), and a report that
  dropped its only row was fixed (`0c07499`/`8673ffd`).
- **`rebuild` and `epoch:accept` must now name the generation** (`fb44b11`, `6b76ae3`) — no
  default, print the plan or do nothing.

**Documents brought true the same day** (this pass): `IFL-QUESTIONS-STATUS.md` rewritten with
IFL's 15 September answers, eight days after they were given and as
`handover/contracts/WAVE-F-CONTRACT.md` item 5 required; `IFL-DEMO-WALKTHROUGH.md` reconciled
(it re-asked **nineteen** questions Hassan had already answered — all removed and replaced by
what the answer was and what it changed); and the consolidated
**[`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md)** created — fifteen asks, ordered by what
each unblocks, each stating what is blocked and what it costs to stay blocked.

**Not done, and named rather than left implicit:** the test suite was **not** re-captured for
this entry. Three workers were committing to source files throughout the day, so any count
taken mid-pass would describe a tree nobody will ever have again; §6 therefore still carries
the 22 Sep figure with its date. Re-run `npx vitest run` from `sms/` once the tree settles and
update §6 from that run, not from this paragraph.

### UX programme, Phase 9 — Print & visual polish (21 Sep 2026) — CLOSES the nine-phase UX programme

- Four commits (`c14cae0`, `99c9e40`, `a95b355`, `08398b9`), plus a guard test
  committed alongside this record. Full detail, including the honest
  three-way split on the twelve acceptance checks and every item still
  blocked on IFL, is in `CLAUDE.md`'s dated "UX programme, Phase 9" section —
  not repeated in full here.
- Product screen composition fixed: a dead `.big` class outside a Sheet had
  left the product code (the screen's own reason to exist) at body size; a
  seventh, off-ramp type size in Catalogue is gone; the tab strip gained the
  spacing class the other tab strips already had and stopped printing a
  solid ink pill; two tabs' duplicated `first` attribute, which had erased
  the hairline under the tab strip, is removed.
- The register's Print button (`Readings.tsx:253`, no `disabled` gate, unlike
  Report's) can no longer leave the page with no attribution: `PrintHead.tsx`
  used to return `null` on a failed header fetch; it now prints a degraded
  block naming exactly what could not be stated, never the browser's own
  clock standing in for the plant's.
- Print CSS stops silently clipping report tables: explicit `@page` margins,
  `.tw` widens to the full page under print, and — by owner decision, after
  both orientations were screenshotted for comparison — reports print
  landscape while the Readings register stays portrait.
- MachineProduct (~103 columns on the dev range) print-suppresses itself
  with a one-line pointer to its CSV export, rather than clipping a
  structurally unfixable table.
- **A new fragility, disclosed rather than left implicit:** the landscape
  rule depends on a UI copy string (`W.reports.selectorLabel`) staying in
  sync with a hardcoded CSS selector in `app.css`. `web/src/
  print.landscape.guard.test.ts` (new this phase) reads both off disk and
  fails if they disagree — proven red on a deliberately mismatched string,
  green once restored, clean `git status` after. The cleaner long-term fix
  (a first-class wrapper class on `<main>`) is named but not built, since
  this phase does not own `Report.tsx`/`App.tsx`.
- **This is a simulation of print, not a verification of print.** No real
  print dialog exists in this environment; every clipping/fit claim above
  comes from viewport resize plus an injected stylesheet. No real user has
  seen any of this on real plant data, printed or otherwise.
- **The twelve acceptance checks from the 3 Sep design handoff live at
  `design/handoff-2026-09-03/README.md:623-655`** — `CLAUDE.md` used to point
  readers at `REDESIGN.md` for them, which contains no such checklist; that
  pointer is corrected in this same pass. Of the twelve: check 1 fails
  permanently by arithmetic (Line, Weight, Rejects and Report each need all
  six type steps); several were re-verified this phase; several are reasoned
  from unchanged code rather than re-observed; and 3/7/8/12 remain
  browser-only checks this programme has never had a harness to observe at
  all. Do not collapse that three-way split back into "eleven of twelve."
- Suite: **1246 passed / 4 skipped** (was 1240/4 at Phase 8), `npx vitest run`
  from `sms/`, observed 21 Sep 2026. `npm run typecheck` (all five
  workspaces) clean the same date.
- **`sms/DEPLOY.md`'s font claim was also corrected in this pass** (not a
  Phase 9 UI change, but found while closing the programme's documentation):
  it stated fonts were "system stacks (Segoe UI / Cascadia Mono)" with no
  self-hosting; `app.css` in fact self-hosts Instrument Sans
  (`web/public/fonts/InstrumentSans-Variable.woff2`) precisely because the
  plant PC has no internet and a Google Fonts link would silently fall back
  to Segoe UI with no error. "Cascadia Mono" does not appear anywhere in the
  application's own source (`design/tokens.css`, a separate design-token
  reference file outside `sms/`, uses it as an unrelated monospace-stack
  fallback and was not in scope for this pass). The true conclusion — no CDN,
  no external host, no `<link>` in `index.html` — is unchanged; only the
  false premise is corrected, plus a note that `web/dist/fonts/` must
  physically reach the plant host as part of the build output.

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
  written authority for the nine PDAS write rights (`AddTubeType`'s parameter
  *signature* was confirmed 21 Sep 2026 by a Windows-auth catalogue read of
  `PDAS_TP1U2_SEP07` — see `CLAUDE.md`'s dated section of the same name; that
  is not the authority to call it), weight basis (Q4/Q5), KPI approval
  (Q33-37), reject-code meanings (Q10), sack stock per machine (not
  computable), the 10 Jul – 5 Aug data, and the live read-only login/host
  (Q65-70, which is what blocks `sms verify`
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

Nothing is mid-change on the roadmap track; the working tree is clean at every commit above. Separately, **the UX programme (§2, not a roadmap phase) is now CLOSED**: Phase 9 (Print & visual polish), the last of the nine UX phases, landed the same day as this update (§2) — the Product screen's dead type classes and print leaks are fixed, the register's print header degrades honestly instead of silently, print CSS stops clipping report tables, MachineProduct print-suppresses itself in favour of its CSV, and a new guard locks the print-landscape CSS selector to the copy string it depends on. Nothing further is planned under the UX programme numbering; any future screen work is roadmap work proper. Roadmap Wave B itself has not begun, because every item in it depends on an IFL answer (§5) or on an owner decision (§4).

**23 September 2026:** twenty-two commits of correctness and charting work landed (§2's first
entry) and the IFL-facing documents were brought true. Two things are mid-flight rather than
finished, and are named here rather than in a completed section: **D-11** (source generations
pooled across IFL's 5 August rebuild) is **partly fixed** — `DEFECTS.md` lists the remaining
call sites by `file:line`; and the archive-ingest path (**R-17**) is still unbuilt, which is
what would block loading the 10 Jul – 5 Aug data on the day IFL sends it.

---

## 4. Blocked — owner decision (not IFL)

These are not done unilaterally. Each is one action.

| # | Decision | Why it is the owner's |
|---|---|---|
| 1 | `git push` of `floor-first-rework` and the tag; whether `main` fast-forwards | Outward-facing; the branch has no upstream. CI runs only after this. |
| 2 | A copy of `D:\sms-backups\*` (two bundles, the baseline `.bak`, the script-statement `.bak`) **on other hardware** — the artefacts are now on both physical disks of the development machine and nowhere else | The July generation (142,511 cones) exists nowhere else; IFL dropped the table. |
| 3 | Send **[`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md)** — fifteen asks, ordered by what each unblocks (rewritten 23 Sep 2026; the old pointer here said "36 open" and pointed at a file that did not contain IFL's 15 Sep answers) | Client communication. Every wave after A waits on some of these. |
| 3b | **Say which is true about the PDAS write authority.** `handover/IFL-ANSWERS-2026-09-15.md:7` says it was still verbal on 15 Sep and the flag should stay off; commit `af420a4` (22 Sep) says in its message that IFL granted it and the owner instructed the path be enabled. No document records that grant, and `sms/.env` reads `PDAS_WRITE_ENABLED=false` today (read 23 Sep 2026). | Only the owner knows which happened, and it decides whether ask 3 is sent at all. |
| 4 | Explain or drop the `sms_real` database on the development instance; delete or deliberately keep `sms/.env.backup-before-sim` (ignored, never committed, real values) | Data and secrets on the owner's machine. |
| 5 | The two test-data rows (`DECISIONS-PENDING.md` §12: station-7 "verification test" adjustment, `floor` account) — remove or keep as audit trail | Owner's data. |
| 6 | Provision `sms_pdas_writer` locally against the SEP07 copy so the write path can be exercised offline | Touches a copy of client data. |
| 7 | `TRANSFORM_VERSION` bump + rebuild | Deliberately held for Wave B (needs Q1/Q3/Q4/Q14 first so it is bumped once). |

---

## 5. IFL dependency

**Rewritten 23 September 2026.** The table that stood here was written before IFL's answers
of 15 September and listed as blocking several things they had already settled. It also mixed
two incompatible question-numbering schemes in the same row — see the numbering warning at the
top of `IFL-QUESTIONS-STATUS.md`, which is real and still unresolved. The full list, in plain
language and ordered by what it unblocks, is **[`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md)**.

**Closed by IFL's answers of 15 September 2026** (do not carry these forward as blockers):
machine ↔ station (one concept); who may change products, limits and sack figures (the process
engineer, one role); who sets weight limits (nobody fixed — editable in Setup); reject-code
meanings (no predefined list — an IFL data-entry task in the delivered software, not a wait);
sack weight basis (gross); what "sack stock per machine" means (production per machine by
shift and day); which reports and how often (all of them, daily and per shift); Excel and PDF
with graphics; no auto-email; the dashboard's content; data freshness; AI = recommendation
only; no PLC work at all; and who supplies the PC (the owner).

| Gates | Still needed from IFL | Ask # |
|---|---|---|
| Go-live: cutover, reconciliation against IFL's own data, scheduled backup, service install | A live read-only login on the plant server + the host name | 1 |
| Installation day | Can the supplied PC reach the plant databases (network) | 2 |
| The changeover workflow's final step — Hassan's own key requirement | Written PDAS authority for the nine rights, **or** written confirmation it was already given (see §4 item 3b) | 3 |
| A truthful target on every August report | What weight limits were in force before 11 Sep 2026 | 4 |
| Formal sign-off of the reporting phase | Approval of the 32 KPI definitions | 5 |
| The Weight headline stating a difference rather than two facts | Cone weight basis + real tube and tare weights | 6 |
| Continuity of history (and it decays — IFL keeps about a month) | The 10 Jul – 5 Aug 2026 data | 9 |
| Any predictive work that deserves the name | 6–12 months of history | 10 |

**One thing that is ours, not IFL's, and would otherwise be mistaken for an IFL dependency:**
even when the 10 Jul – 5 Aug data arrives, the reader and epoch machinery cannot load it as it
stands (`DEFECTS.md` R-17, HIGH). That work should be done before the data lands, not after.

Rule 17 applies: nothing above is guessed past. Work proceeds on whatever does not depend on them.

---

## 6. Test status

> **Not re-captured on 23 September 2026, deliberately.** Twenty-two commits landed today from
> three workers editing source concurrently; a count taken mid-pass would describe a tree that
> no longer exists by the time anyone reads it. The figures below are the last captured run,
> with its own date. Re-run `npx vitest run` from `sms/` once the tree settles and replace this
> row from that run. For reference only — these are the commits' own reported numbers, not a
> run this pass observed — today's commits report full-suite figures rising through 1,410,
> 1,427, 1,439, 1,465 and **1,519 passed / 4 skipped** as they landed (`git log --since` on
> 23 Sep 2026).

| | Value |
|---|---|
| Suite | vitest, **1246 tests passed / 4 skipped**, 120 test files (21 Sep 2026, end of UX programme Phase 9 — the programme's close — observed via `npx vitest run` from `sms/` — this run); 1240/118 at the end of UX programme Phase 8; 1194/110 at the end of UX programme Phase 7; 1169/109 at the end of UX programme Phase 6; 1164 at the end of UX programme Phase 5; 888 passing at the end of Wave C/D round 2 (15 Sep 2026); 324 at the Phase 0 closure, verified under UTC and in a fresh clone |
| Gate | `npm run verify:release` — typecheck (all five workspaces) · tests · build; exit 0 (not re-run this pass — `npx vitest run` and `npm run typecheck` were, both clean) |
| CI | `.github/workflows/ci.yml` runs the same gate plus a clean-tree check and a tracked-secret-file check on every push to `main`/`floor-first-rework` and every PR. **Has not run yet** — nothing is pushed. |
| Database needed | None. Every test runs against a fake `mssql` pool or pure functions. |
| Known failures | **One open, unexplained, intermittent.** Roughly 1 failure in 74 full `npx vitest run` executions under `--sequence.shuffle`; no test name has ever been captured for it. 60 clean runs in normal order did not reproduce it. The one suggestive-but-unproven observation: `Weight.test.tsx` failed once while two heavy vitest processes ran concurrently, and did not reproduce without that load, consistent with resource contention rather than a code defect — **not proven, not a capture**; do not "fix" it speculatively. Two ordering defects that WERE captured and fixed in this phase: `api/src/routes/ops.test.ts` shared session cookies from a `beforeAll` while some of its own tests revoke sessions, and `api/src/app.config.test.ts` used a deliberately stateful fake DB that only tolerated one run order — both now independent, 45 consecutive shuffled runs clean. Separately, one timezone defect existed at `0dd33fa`, found only by an adversarial run under `TZ=UTC` (two `plantClock` tests, `-0` vs `0`); fixed and pinned in `7a0c5f7`. |
| Coverage gaps | Web: a component harness exists as of UX Phase 8 (`environmentMatchGlobs` in `vitest.config.ts`, keyed on the `.test.tsx` extension; `@testing-library/react`/`@testing-library/dom` added to the root `sms/package.json` only), but coverage under it is thin: of the 16 top-level files in `web/src/screens/`, only 2 (`Readings.tsx`, `Weight.tsx`) have a direct component test, plus the nested `screens/health/SyncHealthBlock.tsx`, the rank-1 UI matrix (`rank.matrix.test.tsx`), the rank/route crosscheck (`rank.crosscheck.test.ts`) and six drilldown hops (`hops.test.tsx`). The other 14 screens, including Setup's six form blocks, have none — `@testing-library/user-event` is not installed, so realistic form and confirm-flow interaction cannot be tested yet. No browser/layout harness exists at all: jsdom computes no layout, so nothing asserts anything about layout, print CSS, or the Wall at 1920px; Playwright is deferred by the owner and would sit on top of this harness, not replace it. A real HTTP route/RBAC harness DOES exist for the API (`api/src/app.routes.test.ts`, `api/src/app.rbac.test.ts` — real Express, fake pool, `node fetch`). No performance, load, FAT or SAT tests. The PDAS write path is tested against fakes only and has never executed against a PDAS database. |
| Live verification recorded this wave | Forced source failure → four `halted` rows → Setup shows the reason → healthy pass supersedes them (`478c456`). Weight reject 18376 and quality reject 18335 sheets (`a473d4d`). |

---

## 7. How to update this file

At the end of each wave or phase: move items from §3 to §2 with their commit ids; re-state §1 for any phase whose verified status changed; refresh §6's counts from a captured run; keep §4 and §5 as the true list of what is waiting on whom. Do not record a capability here that cannot be pointed to in code or in a recorded rehearsal.
