# IFL SMS Roadmap — Delivery Gap Analysis

**Against:** `IFL_SMS_Claude_Code_Development_Roadmap.md` (the 15-phase requirement roadmap derived from IFL's requirement/quotation document)
**Codebase state assessed:** working tree on `floor-first-rework` at commit `e86357f` plus 64 modified + 43 untracked files, as of 12 Sep 2026
**Method:** twelve independent assessment passes (one per roadmap phase or phase pair), each followed by an adversarial verification pass instructed to refute every "already in hand" claim by reading the cited code, then three cross-cutting passes (completeness, sequencing, delivery risk). Every status below is the *verified* status — where the verifier overturned the assessor, the corrected finding is what appears. Agents did not execute the test suite or write to any database; test counts quoted from project documents are marked as such.

**Framing.** The roadmap is the requirement. Everything that already exists in the codebase is credited toward it; nothing in the roadmap is treated as mistaken. Where the requirement's wording and the plant data differ, that is recorded as a **clarification to confirm with IFL**, not as an error. Code existing is not the same as a requirement being delivered — each phase therefore has a *remaining to satisfy* list even where the code is substantially written.

No cost, price or effort estimate is made anywhere in this document. Where a project document records its own estimate, it is quoted and cited.

---

## 0. The fact that changes every status below

The repository is in **three tiers**, and which tier you look at decides what "exists":

| Tier | What it holds | State |
|---|---|---|
| **GitHub remote** (`origin/main` at `b1c6de2`, 19 Aug 2026) | The pre-redesign app IFL called unusable: a 7,256-line `App.tsx`, no `screens/` directory, migrations 001–016 only, 8 of 28 test files, and a reader that selects the column `Source` — which IFL renamed to `MachineNo` on 5 Aug 2026 | **Cannot ingest IFL's current source tables.** Halts on the first table. |
| **Local branch** `floor-first-rework` (26 commits past `main`, ending `e86357f`, 9 Sep 2026) | The seven-screen redesign, Report, Wall, live/health service, sliding sessions, most screen fixes | **No upstream configured. Exists on one machine.** |
| **Working tree** (64 modified + 43 untracked files; 4,433 lines of code and 3,619 lines of docs untracked) | Migrations 017–027, the source-generation (epoch) subsystem, the rebuild/sync lock, the PDAS write path, time-versioned limits, ProductSheet, 14 of 28 test files, the corrected cutover runbook, all 10 Sep audit fixes | **No version-control history at all.** |

The working tree **cannot be committed piecemeal**: tracked, modified files import untracked modules at eight verified points (`cli/src/index.ts:7-8`, `sync-worker/src/runner.ts:13`, `pipeline.ts:9`, `api/src/app.ts:25-27`, `web/src/App.tsx:30`, `shared/src/index.ts:4`, `attention.ts:42`, `weightStations.ts:32`). Any partial commit leaves a tree that does not build.

`git tag` is empty. Every `package.json` reads `0.1.0`. There is no CI.

**Consequence for scoping:** every "in hand" item in this document is in hand *in the working tree on one laptop*. The first action of the whole programme, before any phase work, is the prepared atomic commit described in §16.

---

## 1. Phase summary

| Phase | Verified status | Confidence | One-line verdict |
|---|---|---|---|
| 0 — Freeze & baseline | **PARTIAL** | high | Raw material strong; none of the five acceptance criteria met, structurally, because nothing is committed |
| 1 — Configurable platform | **MOSTLY TO BUILD** | high | 5 of 10 config entities have no representation; the three hard-codings that fail acceptance are real |
| 2 — Integration layer | **PARTIAL** | high | Mechanism unusually strong and uncommitted; the adapter interface the word "formalize" names is 0% built |
| 3 — Canonical data model | **PARTIAL** | medium | 31 tables, 7 of 9 provenance fields; three fields stored-but-unread or dangling; no data dictionary |
| 4 — Cone weight module | **PARTIAL** | high | Ingestion, versioned limits, attribution real; five-state classification, weight reconciliation and approved fixture do not exist |
| 5 — Reject management | **PARTIAL** | high | Spine real; 4 of 5 named drilldowns missing or API-only; per-day-per-code does not exist; labels NULL |
| 6 — Product / PDAS | **PARTIAL** | high | Complete write path written; has never executed anywhere; no writer login even locally |
| 7 — Sack management & stock | **PARTIAL** | medium | Sack half in hand (working tree); stock ledger does not exist in any form; machine link impossible from data |
| 8 — Dashboards & reports | **PARTIAL** | high | 5 of 11 screens have a real home; 1 of 9 reports producible; IFL approval not started |
| 9 — Calibration analytics | **PARTIAL** | high | 7 of 8 items exist; median absent; several items computed but rendered nowhere |
| 10 — Optional AI/ML | **BLOCKED** | high | 53 days held vs 6-month minimum; one ledger row; no prediction target |
| 11 — Security & operations | **PARTIAL** | high | Auth/RBAC/audit core committed; rotation, retention, upgrade, DB maintenance, config backup absent |
| 12 — Testing & release | **MOSTLY TO BUILD** | medium | 266 unit cases (doc claim) all against fakes; UI tests structurally impossible; no perf, CI, FAT or SAT |
| 13 — Documentation | **MOSTLY TO BUILD** | medium | 2 of 13 deliverables substantially covered, both defective in committed form; 5 absent |
| 14 — Site commissioning | out of roadmap scope | — | Noted only where it gates other phases |

In five cases the adversarial verifier pulled the status **down** from the assessor's (1, 2, 3, 6, 12–13). In no case did it move a status up. The direction is consistent: the assessors credited code that exists but is unreachable by a user, untested for its defining behaviour, or resolved to the wrong source.

---

## 2. Phase 0 — Freeze and Baseline Existing SMS

**Verified status: PARTIAL.** The one acceptance criterion already satisfied is "no production credentials in source control" — verified four ways (git history over `*.env` on every branch, `git ls-files`, `git check-ignore`, a history-wide `-p` scan). The other four cannot be met until the tree is committed.

### Already in hand
- Self-tracking, per-file-transactional migration runner (`scripts/migrate.mjs`) — **uncommitted**; the committed runner is sequential auto-commit with no history table.
- 27 idempotent migrations (016 committed, 017–027 untracked); 026 carries a refuse-rather-than-half-apply `THROW` guard.
- 117-line `.env.example` covering every variable the code reads.
- Hardened backup script with a **recorded restore rehearsal** (19 Aug 2026: 75.7 MB, 5.6 s backup, 9.4 s restore, row counts matched) — on a pre-epoch, July-only schema.
- 28 test files; `npm ci` from a clean checkout still reproduces the tree (lockfile unmodified, no untracked file adds a dependency — verifier extended this check).
- Three written classifications of current work (`AUDIT-FINDINGS.md`, `SEPT-2026-BUILD-PLAN.md`, `DECISIONS-PENDING.md`).

### Remaining to satisfy
- **The atomic commit** (§16 has the preparation steps), push, branch decision (tag on `floor-first-rework` vs fast-forward to `main` — `main` is a strict ancestor so either is clean), and the repository's first annotated tag.
- A **captured test run** as an artefact. Two figures are on file a day apart (214; 266/266) and neither is a captured run.
- **From-zero database rehearsal**: migration 001 creates the *schema*, not the *database*. No `CREATE DATABASE` or `CREATE LOGIN sms_app` exists anywhere in `.sql/.mjs/.ps1/.md`. `DEPLOY.md` step 3 is one sentence of prose.
- **Correct `DEPLOY.md:168-173` before any migration rehearsal.** It tells the operator that re-running earlier migrations "is a no-op — they are all guarded." False: 026 has seven unguarded `ALTER COLUMN … NOT NULL` statements and 016 is a bare `DELETE`. Nothing seeds `sms.schema_migration` on a database migrated before the history table existed, so the new runner's first run on the *current dev database* re-applies 001–027 and 026's `THROW` fires. The fresh-database path is fine.
- Fold the stop-worker → 025 → `backfill-source-epoch.mjs` → 026 upgrade sequence into `DEPLOY.md` (exists only in the untracked epoch decision memo; the backfill script hard-codes this machine's id boundaries and epoch ids).
- Re-rehearse backup/restore on the current two-generation schema.
- Clean-checkout rehearsal on a machine that is not the development machine.
- `BASELINE.md` (does not exist) and `PROJECT_STATUS.md` (roadmap rule 15; does not exist).
- Per-file disposition manifest for all 107 changed paths, including the two dev-only scripts: `sms/q.mjs` (hard-codes the developer's absolute path incl. account name; **not gitignored** — `git add -A` would publish it) and `sms/sync-trace.mjs` (debug harness for a bug fixed in `e86357f`).
- Owner's decision on `DECISIONS-PENDING.md` §12 test residue (a station-7 adjustment reason "verification test", a `floor` operator account).
- Consolidated secrets-handling statement naming the four logins (`sms_app`, `sms_readonly`, `sms_backup`, `sms_pdas_writer`), issuer, storage, rotation.

### Verifier additions
- Root `typecheck` is `tsc -b shared sync-worker cli api` — **web is excluded**. There is **no root `build` script**; the build sequence exists only as prose at `DEPLOY.md:161`. Root `dev` is a Phase-0 stub (`echo "Step 0 scaffold …"`).
- **Three documents give three different table counts** (README 21, CLAUDE.md 25, CAPABILITIES 23). The migrations define **31** (27 `sms.*` + 4 `sms_raw.*`).
- `BASELINE.md` must distinguish a code-enforced flag (`PDAS_WRITE_ENABLED` — fail-closed in `config.ts:154`, tested) from an inert template key (`PLC_READER_ENABLED` — **zero TypeScript references**; listing it as "disabled" would assert a reader exists).
- No `.gitattributes`; git warns "LF will be replaced by CRLF" on 12 tracked files, so the freeze commit would otherwise be a whole-tree line-ending rewrite.
- No Node version pin (no `engines`, no `.nvmrc`); `DEPLOY.md` says "Node 20+" in prose; Node 20 reached end-of-life 30 Apr 2026; dev machine runs 22.
- The nightly backup is an instruction, not an installed job; the script passes the password on the `sqlcmd` command line; `-Server` defaults to the dev port `localhost,14330`.
- `DEPLOY.md` has two steps numbered 8.
- The UI has 1 test file of 28 (a pure date helper); 11 screens have no test. `BASELINE.md` must say so.

### Blocked on IFL
Target machine (Q65–70) for a meaningful clean-checkout rehearsal; live read-only login for a live rehearsal. Neither blocks committing, tagging, testing or writing `BASELINE.md`.

### Clarifications to confirm with IFL
Which artefact is the deliverable of record (the remote, or the working machine)? Should the baseline include the PDAS write path in its disabled state? Should the two test-data rows be removed or retained as audit trail? Is "clean baseline" code only, or is a database snapshot expected alongside? Should the backup/restore rehearsal be repeated and witnessed on IFL hardware?

---

## 3. Phase 1 — Convert to Configurable Platform

**Verified status: MOSTLY TO BUILD.** Judged against "a real user can change this at the right role, and it takes effect": 5 of 10 entities have no representation of any kind.

### The ten entities, one by one

| Entity | State | Evidence |
|---|---|---|
| Plant | **No representation** | Grepped all 27 migrations: no `sms.plant`. Appears only as text inside `LINE_NAME` |
| Unit | **No representation** | `sms.unit` (006) is a *unit-of-measure* table (kg/g). Two screens *parse* the `LINE_NAME` string on `·` to recover a unit label (`Line.tsx:273`, `Wall.tsx:245`) |
| Line | **Env-var only** | `LINE_ID` integer + `LINE_NAME` display string (default literal `'TP1 · Line 3 · Unit 2'`, `config.ts:15`). `line_id` is on every table but references no line table |
| Machine | **No representation** | Only `sms.station.machine NVARCHAR(64) NULL`, a free-text column; accepted by the API, not editable in the UI |
| Station | **Real table**, partial | `sms.station` (006, committed); rename UI works, audited. Roster is `SELECT TOP (14)` in `seedReference.ts:62`; **no INSERT path at any rank** (`admin.ts` is UPDATE-only, no POST route); no DQ finding for a station outside the roster |
| Data source | **Hard-coded in source** | `IFL_TABLES` const array (`iflTables.ts:44-108`); `source_system='ifl_sql'` literal at **six** sites, including a `DELETE` predicate in `rebuild.ts:69` |
| Product | **PDAS mirror, not configuration** | `seedProducts` MERGE-overwrites `sms.product` every 60 s; nothing typed survives |
| Product limit | **Real, time-versioned**, uncommitted | `sms.product_limit_version` (027) wired into the read path; its write path ships off pending written authority |
| Reject code | **Real, auto-discovered**, partial | Membership discovered from data; label editable at rank 3. But every UI rename **nulls `is_pass`** (`rejects.ts:101` unconditional `SET is_pass=@pass`, client sends `{label}` only); `severity` has zero references anywhere; unique index has no `line_id` |
| Shift | **Table exists, boundaries hard-coded** | `SHIFT_BOUNDARIES` const in `shift.ts:15` consumed by transform, `live.ts`, `wallClock.ts`; `setShiftRule` re-inserts `'06:00','14:00','22:00'` as literals (`admin.ts:158`); only `night_belongs_to` is read from the table; `mode` is stored and applied nowhere |

### Admin surface
`Setup.tsx` has five sections. An admin can change: station **name** only, and users. The three rule endpoints (`/api/admin/rules/weight|shift|plausibility`) exist, are rank-4-gated and audited, and have **zero UI call sites** — `RulesBlock` is a read-only `<dl>`. `web/src/api.ts:155-157` declares the client functions; nothing calls them.

### Audit of configuration changes
11 writers to `sms.audit_log` (the verifier corrected the assessor's count of 8 — `pdasWrite.ts` does call `recordAudit` on all three success paths). But the write is fire-and-forget (`app.ts:126-131`, `void … .catch`) — a rule change can commit while its audit row fails. Env-level changes (`LINE_ID`, `WEIGHT_BASIS`, source database names) leave no trace anywhere. `LINE_ID` is documented nowhere in `DEPLOY.md`.

### Multi-line
`line_id` column threading is real and complete. The API contract is single-line throughout: `cfg.lineId` at 57 sites in `app.ts`, no route accepts a line parameter, `live.ts` returns `{ lines: [line] }` with one element always. Migration 025 seeds eight epoch rows for `'localhost'` / `DATA_TP1U2` / `DATA_TP1U2_SIM` on **every fresh database**. `sms cutover` deletes every line's rows (no `line_id` predicate). The transform lock is one global string.

### Genuinely new
Plant/Unit/Line/Machine/Data-source entities and their admin forms; a station INSERT path; shift-boundary editing (parameterise `setShiftRule`, read the times at runtime, remove the const from three consumers); the three Setup rule forms; machine/description inputs on the station row; a DQ finding for observed-station-not-in-roster; config-change audit; the adapter-interface extraction (shared with Phase 2); configurability tests (every test in the suite uses `lineId: 1`); a "configure a new line" runbook section.

**Project-recorded estimate:** the adapter extraction is "roughly 1.5 weeks and a hard prerequisite for any second source" (`SPEC.md:91`, `ARCHITECTURE.md:226`, `CLAUDE.md:350`).

### Blocked on IFL
Machine-vs-station modelling (Q3 open); how many machines and of what kind (Q1 never confirmed in words; Q4 open); single vs multi-line (Q14, "to be settled at the textile-team meeting"); reject-code meanings (Q12); station names (Q11); weight basis (Q24); who may change limits/products (Q19/40/41); written PDAS authority; live login; Q7.

### Clarifications to confirm with IFL
Are Plant and Unit reporting dimensions or display labels? Are "machine" and "station" the same physical thing (the data has one column, `MachineNo` 1–14)? Does "adding a second machine" mean a 15th winding position, a sack-packing machine, or a machine on another line? Are 06/14/22 shift boundaries fixed across IFL or per-line configurable? Reject codes shared across lines or per line? Should product definitions stay owned by PDAS with SMS mirroring/writing back, or should SMS hold its own? Who at IFL may change each kind of configuration? Who registers a new source generation after a vendor rebuild? Second line in the same database or a separate installation?

---

## 4. Phase 2 — Formalize the Integration Layer

**Verified status: PARTIAL.** The mechanism catalogue is accurate and strong; the aggregate was over-credited because the requirement's operative word is *formalize* and the formalization — a common adapter interface — is 0% built.

### Already in hand (all uncommitted unless noted)
- Epoch-scoped incremental watermark (`MAX(src_id)` per `(line, source_epoch)`, null not 0 for an empty generation, floored at −1 for the genuine `id=0` row, 500-row overlap).
- Two-layer duplicate protection: application-side probe + `UNIQUE (line_id, source_epoch, src_id)` on all four raw tables, `UNIQUE raw_id` on canonical (026).
- Source-generation gate (`resolveEpoch`) halting on **three** conditions — no open generation, identity change (server/database/`create_date`), fingerprint drift — every message naming `sms epoch:accept`. Manual acceptance prints a plan and refuses without `--confirm`.
- Restore/backwards gate (`MAX(id)` below watermark within a generation) and a `raw_read_without_write` ERROR halt.
- `withRetry` (4×, exponential) on the source read; a worker loop that never dies from an integration failure (committed).
- Rebuild-vs-sync mutual exclusion via `sp_getapplock` on a pinned connection with the pool reaper defeated.
- Measured acquisition lag (median of 200 rows, capped at 2 h for judging, 24 h for reporting); freshness from the **oldest** source table; UI refuses to assert running/stopped unless health is `ok` (committed).
- Per-generation reconciliation on COUNT/MIN/MAX/**SUM(id)** with identity checked first, exit 0/1, six tests. (Committed `verify.ts` compares three whole-table counts and would read MISMATCH permanently.)
- Operations surface over `sync_run`; one structured JSON log line per worker pass.
- Read-only discipline: SELECT-only, parameterised, dedicated `sms_readonly` login; the API holds no source connection at all.
- PLC/OPC correctly unbuilt: five env-var names, a nullable `cone_id`/`cone_id_source` pair, no library in any of six manifests.

### Not built or partial
- **Adapter interface.** Zero hits for `IngestionAdapter` in any `.ts`; the runner news a concrete `IflSqlAdapter`; `persistRaw` is insert-only where a second source needs merge-and-enrich (a second-source row on an existing merge key would violate `UX_cone_merge2`).
- **Structured logging.** Exactly one file emits JSON (`sync-worker/src/index.ts`); the API, the retry warning and the lock errors are plain strings. A logging dependency needs approval first (CLAUDE.md rule 4).
- **Connection health.** `/api/health` is `SELECT 1` on the *app* database. Health is inferred from `sync_run` outcomes — but the epoch halt, the backwards halt and the seed step all run **before** `startSyncRun`, so a refused pass writes **no `sync_run` row**. Setup's per-table sync table keeps showing the *last* row with outcome `success` and only the Age column growing. `operations.ts` computes `'no-open-epoch'`; no screen renders it.
- **Per-table isolation.** `runOnce` rethrows inside the table loop; one halted table aborts the pass for three healthy ones.
- **Error classification.** `withRetry` retries a permissions failure, a bad query and a dropped socket identically; only the row read is retried — the epoch reads, `maxSourceId`, `getWatermark`, `seedProducts` and the transform are not, contrary to `ARCHITECTURE.md:277`.

### Defects found by the verifier
- `sync-worker/src/index.ts:15-17` opens the app pool *before* the IFL pool and *outside* the try/finally — every tick on which the IFL connect throws **orphans one connected app pool**, for the duration of an outage.
- `pipeline.ts:21-22` runs `seedReference` then `seedProducts` **before** `runOnce`, with no try/catch. `seedProducts` issues four cross-database SELECTs. A PDAS read-permission failure **aborts the entire pass every 60 s forever** with no `sync_run` row. `DEPLOY.md`'s cutover step 4 ("`sms sync` must halt with *No open source generation*") therefore cannot produce its documented halt on IFL's known login pattern (their `ibrahim` login has EXECUTE on PDAS procs and no table read).
- `seedProducts` does one MERGE per blend/count/tube/material plus one SELECT per material, sequentially, every 60 s, forever, for reference data that changes rarely.
- `/api/operations` is **not gated server-side** (`app.ts:594`, no `requireRole`); only the Setup screen is gated. Surfacing epoch status to non-admins needs no API change.
- `rebuild.ts:35` and `:69` carry `'ifl_sql'` literals; `:69` is `DELETE TOP (5000) … WHERE source_system='ifl_sql'` — a second source's canonical rows would survive a rebuild that reports the table cleared.
- The integration gates are tested only against `vi.mock` fakes; no test has ever executed the gate SQL against SQL Server.
- No CI exists.

### The "Sack Packing database"
The requirement names it as a third source. Everything IFL has supplied presents sack readings as `sack1_TP1U2` inside `DATA_TP1U2` on the same instance (`TP1-PDAS\PDAS`) as the cone tables; the code has one source pool and reads PDAS through cross-database three-part names. IFL's own topology document draws "Database Server Sack Packing" as a separate node. **This is a clarification to put to IFL** — if a separate system exists or is planned, it is new build (second connection, second epoch/fingerprint baseline, second reconciliation stream) and is exactly the case the missing adapter interface would make cheap.

### Genuinely new
Adapter interface and registry; source-agnostic transform/persist (including `rebuild.ts:35/:69`); merge-and-enrich upsert; explicit source connection probe and a health record written even when a pass is refused; structured logging across worker/API/CLI with a correlation id; error classification and retry around connection establishment; per-table failure isolation; epoch/schema status in the UI; a non-fatal full-column-list drift check (the fingerprint hashes only depended-on columns, so the next `MaterialId`-shaped addition is invisible — recommended at `SEPT-2026-DB-FINDINGS-RAW.md:279`); tests for `retry.ts`, `lock.ts`, and an end-to-end source-drop; a third-source adapter if IFL confirms one; the PLC/OPC adapter itself if confirmed (needs Q61–63, Q69).

### Blocked on IFL
Whether a separate Sack Packing database/server exists; live read-only login on both databases; written PDAS authority; whether the PLC reads limits live; PLC protocol/model/network (Q61–63, Q69); the 10 Jul – 5 Aug data.

### Clarifications to confirm with IFL
Is Sack Packing a separate database or server, or the same instance? If it will split, when, and with the same table shapes? Should plant-connection health be shown to non-admins, or is the one-line data-age sentence sufficient? When the source is rebuilt and SMS halts, who acts, and should the resume be a console command (as now, deliberately) or a button? How should SMS behave if the acquisition layer slows beyond the measured ~18 minutes? Does IFL have a log retention/location standard? Should `sms verify` run on a schedule? Is retention of superseded source generations what IFL wants?

---

## 5. Phase 3 — Canonical Production Data Model

**Verified status: PARTIAL** (confidence medium — the verifier could not inspect database state under the read-only rule). The model is the strongest-engineered part of the codebase and is unified **in the database, not in the type system**.

### Record types (11 named)

| Type | Table | State |
|---|---|---|
| ConeReading | `sms.cone_event` (003) | Full; committed; epoch/night/material columns uncommitted |
| SackReading | `sms.sack_event` (004) | Full; carries honest `production_ts_is_insert_time` |
| RejectEvent | `sms.reject_event` (008) | **No `attribution_method`/`attribution_confidence`**, no `merge_key_is_unique`; got `material_id` only via uncommitted 024 |
| Product | `sms.product` + lookups (006, 012, 020) | A MERGE-overwritten mirror, not a history; `lot_code` deliberately unpopulated |
| ProductLimit | `sms.product_limit_version` (027) | Append-only with `effective_is_lower_bound`; **entirely untracked** |
| Machine | **No table** | Folded into `sms.station.machine` free text; depends on Q3 |
| Station | `sms.station` (006) | Seeded 1..14; mutated by destructive UPDATE (the only unversioned reference table) |
| Shift | Rule table + stamped columns | No per-shift-instance entity; boundaries are a compile-time constant; `mode` stored, not applied |
| CalibrationAdjustment | `sms.calibration_adjustment` (015 + 019) | `amount_g` (019) untracked |
| DataQualityEvent | `sms.dq_finding` (009) | **`subject_ref` is never written** — findings are batch counts plus prose; not one can be joined to an offending row |
| AuditEvent | `sms.audit_log` (014) + three other audit-shaped tables | No single query answers "everything that happened" |

### Provenance fields (9 required)
7 present as literal columns on all three production tables. **Source table**: recoverable via the `source_epoch` FK hop (sufficient, including for rejects — the verifier corrected the assessor here). **Ingestion timestamp: absent from canonical.** `ingest_ts_utc` holds *IFL's* insert time (a naming trap). The canonical `ingest_run_id` is an **orphan key**: generated per transform pass at `runTransform.ts:311` and never inserted into `sms.sync_run`, so the assessor's claimed recovery join returns zero rows. Only `raw_id → sms_raw.read_at_utc` works, and `raw_id` is exposed by no API or screen.

### Defects
- `shared/src/domain/events.ts` — header claims both services import it "so the shape cannot drift." **Imported by nothing.** All 14 exports have zero importers. Its `AttributionMethod` union omits `'source_column'` (the value actually written) and lists three values nothing writes.
- **`TRANSFORM_VERSION` is still `1`** (`version.ts:6`, untouched since the initial commit) although attribution, `night_belongs_to` and `source_epoch` have all changed the raw→canonical logic. Rows from both regimes are indistinguishable by the column whose only purpose is to distinguish them.
- Stored `attribution_method` / `attribution_confidence` are **write-only**: read by no API query, shown on no screen. `ProductTimeline.verdict()` — the one function returning `limitsAreLowerBound` — has zero production callers.
- The epoch label is returned by the register API on every row and in CSV, rendered on Setup only, **not on the reading sheet** next to `source_row_id` — which since 5 Aug 2026 names two rows.
- The rebuild "snapshot gate" is a non-empty-string check (`rebuild.ts:23`).
- `shared/src/domain/plantClock.ts` is untracked and not exported by HEAD's `index.ts`, yet eleven modified files import it — a commit-ordering hazard.
- No test references `attribution()`, `'source_column'` or `src_MaterialId`; the three key functions are untested.
- No current data dictionary: `SPEC.md` §4 predates `raw_id`, `ingest_run_id`, `source_epoch`, `night_belongs_to`, names a non-existent `sms.material` table, and repeats the stale attribution enumeration. The only accurate description is the comment text inside 27 migration files.

### Genuinely new
Machine record (pending Q3); shift-instance entity if shift-level facts are wanted; attribution columns on `reject_event`; an ingestion-timestamp column or a sanctioned, exposed join (copy `sms_raw.ingest_run_id` onto the canonical row rather than minting a new UUID); user-reachable lineage; attribution/merge-key tests; station versioning; a unified audit query; a sidecar data dictionary.

### Blocked on IFL
Reject-code meanings (Q12); machine/station (Q3); weight basis (Q24); who sets limits (Q10/40); written PDAS authority; the 10 Jul – 5 Aug data; raw-layer retention (assigned to IFL by `ARCHITECTURE.md:260`); live login; lot→material mapping.

### Clarifications to confirm with IFL
Machine and station one thing or two? Should reject records also state how their product was determined? Is a sack timestamp meaning insert-time acceptable for reporting? Is provenance held one level up (on the generation row) and joined on demand acceptable? Must the trace be visible to a person on screen, or auditable by an engineer with SQL plus the reconciliation tool? Are further rebuilds expected, with advance notice? How long should the archive be kept? Weight basis? Code list? When did the current limits take effect (the bootstrap marks them "no later than")?

---

## 6. Phase 4 — Cone Weight Module

**Verified status: PARTIAL.**

### Already in hand
Full cone ingestion per generation; time-versioned limits resolver (`productLimits.ts`); row attribution (`'source_column'` / honest `'none'`); two separately-named judgements (scale bit vs product tolerance); signed distance computed; scale-vs-product disagreement count on Weight; station filter on register and `/api/production`; the one station table with bias vs line *and* vs target; app-owned plausibility rule (013); DQ findings on every pass; history preserved across the rebuild; shift recomputed with the plant's value kept beside it — the boundary test **exists and is committed** (`transform.test.ts:15-20`; verifier corrected the assessor); per-generation verify.

### What stops the requirement being satisfied
- **Five-way classification (within / low / high / rejected / unknown): TO BUILD.** The code has two independent two-state judgements plus prose. `ProductTimeline.verdict()` has zero production callers; the sheet's "under the lower limit" text comes from a **client-side re-implementation** (`ReadingSheet.tsx:196-200`). Four independent "outside product limits" implementations exist. The register list shows two states.
- **Weight-total / statistic reconciliation: does not exist in any form.** `sms verify` compares id checksums only. Three different weight populations exist today (`spc.ts` filters both plausibility bounds, `weights.ts` the lower only, `production.ts` none), so "the app's weight statistic" is not one number.
- **IFL-approved classification fixture: none.** Only developer unit tests over synthetic values.
- **Product-limit administration screen:** `ProductSheet.tsx` exists (untracked). Its limit-editing half renders only when `PDAS_WRITE_ENABLED=true`. Rank-1 accounts never see the product list at all (gated on `canWrite`). Setup has no product section; `REDESIGN.md` names a *Product limits* rule under Setup → Rules — absent.
- **Shift attribution validation:** the legacy-vs-corrected mismatch statistic is gone (`/api/shift-analysis` deleted at `f4b941a`); the web client still exports a dead call to it.
- **Faulty readings "per IFL-confirmed rules":** the 1500–2100 g / 40–60 kg bounds are the developer's measured defaults, never put to IFL. `dq.ts:71` hard-codes 1500/40 instead of reading the rule. Setup shows the window read-only.
- The versioned resolver is **vacuous on today's data**: migration 027's bootstrap row is stamped at migration time, so every July and September reading resolves to the bootstrap row — identical to the old mirror judgement. Time-versioning becomes observable only after the first future setpoint change, and nothing reads `product_limit_version` or `product_change` back.
- `spc.ts getSpec` reads USL/LSL from the **mirror**, not the catalogue; the Weight chart's limit lines and Cp/Cpk disagree with the target line on the same screen after the first setpoint change.
- Weight banner counts per material; the register filter it links to is built from the line-wide timeline with no material predicate and hard-codes `in_range = 1`.
- No screen reports which product is running on which machine, though six run concurrently and every September row carries `MaterialId`. The register has no product column or filter; `/api/production?product=` is called by no screen.
- **DQ findings are unreachable:** `Setup.tsx:62` filters `severity === 'error' || 'fault'` (lowercase; `'fault'` does not exist) against stored `'ERROR'/'WARNING'/'CRITICAL'/'INFO'`, so the Findings count always prints "none." **Committed at HEAD.**
- The reader **refuses the July shape by design** (`iflTables.ts:22-26`); the 10 Jul – 5 Aug window needs an ingest path or IFL-side reshaping, not only a request.
- Two `--confirm` CLI commands (`epoch:purge`, `cutover`) delete the archive of record with no backup precondition.

### Genuinely new
Weight reconciliation (SUM/AVG/MIN/MAX per epoch and period, ideally a flag on `sms verify`); the approved fixture and a harness against real rows; one server-side five-state classification consumed by every screen, plus register column and per-state filters; Setup → Rules *Product limits* section; editable forms for plausibility/weight basis/shift rule; a reader for `product_limit_version` / `product_change`; a station parameter on `/api/spc` and a Weight selector; a per-machine "product running" view; a product column/filter on the register; the legacy-vs-corrected shift statistic; an ingest path for the July-shape window.

### Blocked on IFL
Written PDAS authority (Q18 verbal only; Q19 open); who may change limits (Q40/41); the faulty-reading rule (Q10); weight basis (Q4/Q5/Q24); Q7; the Jul–Aug data (Q56); live login; reject-code meanings (Q12).

### Clarifications to confirm with IFL
How should the five states be derived, and which judgement governs when the scale's bit and the product tolerance disagree (they do on roughly a thousand cones)? Per-machine limits from each reading's material, or one line-wide product for reporting? Should pre-5-Aug readings be shown as "unknown" and never back-filled? Is SMS's append-only limits history acceptable as the record, with a "no later than" bootstrap? Is the setpoint on the same basis as the recorded weight? Which population for acceptance statistics? Does the PLC read limits live? Station filtering for cones/rejects only (sacks carry no machine)? Derived shift replaces or sits beside the plant's? Exclude the 2200–2354 g scale-fault population from averages as the chart already does? Machine names before the demo?

---

## 7. Phase 5 — Reject Management

**Verified status: PARTIAL.**

### Already in hand
Both reject streams imported into one canonical `reject_event`, discriminated by `reject_type`, under separate watermarks (shared id space handled); event time from `ProductionDate`, shift recomputed, plant's value kept; epoch handling reaches the reject tables; `sms.reject_code` with **auto-discovery** from the data, a rank-3 naming API with old→new audit, and an inline "Name it" UI; count and rate on one documented denominator (rejects ÷ cones + all rejects) across four services; a varying-sample-size p-chart with per-generation pooling and three tests; date drilldown on every surface; station filter on reject rows and a per-station rate; product filter on `/api/production`; structural source-vs-calculated separation (the plant's flags stored verbatim, tolerance verdict computed at read time, never stored); per-generation verify on both streams.

### The five named drilldowns

| Dimension | API | UI | Verdict |
|---|---|---|---|
| Date | everywhere | everywhere | **In hand** — but the reason breakdown is fixed to the 14-day trailing window, not the selected period |
| Shift | `/api/events`, `/api/production` only; **not** `/api/rejects` or `/api/reject-spc` | only the shift currently in progress can be selected | Partial |
| Product | `/api/production` only; not Pareto, trend or register; `REJECT_COLS` omits `material_id` so a reject row cannot even display its product | **no entry point anywhere** | Partial |
| Machine/station | rows yes; per-station rate yes; **not** on Pareto or trend | rows yes | Partial |
| Reject code | a **grouping** (Pareto), never a filter; no `WHERE` on any code column exists | Pareto bars not clickable | Partial |
| **Daily / code** | **does not exist** — no query groups codes by day | — | **To build** |

### Defects
- **Register dictionary join** (`register.ts:219-223`) uses plain equality on two nullable columns; weight rejects (NULL/NULL) can never match. The Pareto uses `ISNULL(-999)`. A label IFL supplies for weight rejects will show on the Pareto and **silently not in the register or its CSV**.
- **Reject detail sheet prints "Passed"** on every inspection reject (`reject_event` has no `in_range`; `ReadingSheet.tsx:110/118`); resolves the **line-wide product** (no `material_id` in `REJECT_COLS`); eyebrow says "Cone"; shows none of `reject_type`, the raw codes or the label; renders the product-limit block for a weightless row.
- **Line and Rejects disagree on the default period**: Line counts one shift up to the plant instant via `/api/production`; the Rejects headline uses `/api/reject-spc`, which accepts neither `shift` nor `tsTo`, so it counts the whole production day. Same period, two numbers. Replay (`?at=`) is not honoured; no range cap.
- **Every UI rename nulls `is_pass`** (`rejects.ts:101`, `api.ts:272`).
- **No `GET /api/reject-codes`**: the dictionary cannot be viewed as a whole; codes outside the trailing 14-day window cannot be named from the UI.
- The trend graph draws rate lines only — no UCL/LCL band, no out-of-control markers; episodes surface only as the headline sentence.
- No error state on the Rejects screen's fetches ("No cones were rejected" renders when `/api/rejects` fails); the inline save has no try/catch.
- "Record" shows `event_id` in the list and `source_row_id` in the sheet under the same word; the epoch label is rendered nowhere.
- The `unattributed` caveat on `/api/production` is computed from `cone_event` only; a product-filtered reject count silently drops every pre-rebuild reject.
- Zero tests on the reject import (`mapReject`), the Pareto, `setRejectLabel`'s UPDATE semantics, or `seedRejectCodes`.
- **The entire UI path to a reject row is uncommitted**: HEAD's `Readings.tsx` has no reject listing; HEAD's `App.tsx` routes "see the cones" to an unfiltered register.
- `CAPABILITIES.md:260` overclaims the register's filter surface and should not be shown to IFL.

### Genuinely new
Per-day-per-code drilldown (query, route, "reason sheet" UI, tests — the day axis needs a decision: production day or calendar date); a code filter and clickable Pareto; product parameter on Pareto/trend/register plus any UI control; station parameter on Pareto/trend; a past-shift selector; `GET /api/reject-codes` and a dictionary admin surface with `is_pass`/`severity` writers; reject-fact rendering on the sheet; `attribution_method` on `reject_event`; any automated test on the reject path.

### Blocked on IFL
The reject-code labels themselves (Q12 — the real distribution is a nine-code tail); whether a weight reject should carry a code at all; `is_pass`/`severity` semantics per code; what reject reporting IFL wants (Q33–37 entirely open); the Jul–Aug data.

### Clarifications to confirm with IFL
Product-wise reject reporting from 5 Aug only, and how to describe earlier rejects? Confirm `MachineNo` is the machine meant, and supply floor names. Are the two inspection codes one combined reason or two? Confirm the denominator. Shift basis for reports. Day = production day (06:00–06:00) or calendar date? Label retroactive or effective-dated? Fixed 14-day trend or stretch to period? Present the two generations as continuous or state the boundary? Export at manager rank — confirm the split.

---

## 8. Phase 6 — Product Management / PDAS Integration

**Verified status: PARTIAL.** The write path is written in full and **has never executed anywhere**.

### Already in hand
- Committed on `main`: the product mirror tables, `product_timeline`, `currentProduct.ts`, the three read routes and `POST /api/current-product` at rank 2 with an existence check, `audit_log`.
- Uncommitted: migrations 020/024/027; `attribution()`; `pdasWrite.ts` (595 lines) — `createProduct` via `dbo.CreateMaterial`, `setProductActive` via `dbo.SetMaterialStatusActive`, `updateProductLimits` via one parameterised single-row `UPDATE dbo.Materials` (setpoint, both offsets, Desc1, Desc2; `MaterialActive` excluded) plus one `nhs_events` row, in a transaction with `XACT_ABORT ON`; rails: fail-closed flag, ≥10-char reason, plausibility bounds, before-image comparison, `rowsAffected === 1` assert, echo-back with a CRITICAL finding on mismatch, lazy separate writer login; `config.ts` `resolvePdasWrite` degrading to disabled-with-reason; five routes at rank 3 with `DISABLED→503, CONFLICT→409, IMPLAUSIBLE→400, NOT_FOUND→404, PDAS_ERROR→422`; `ProductSheet.tsx`; five offline tests (verified passing: 32/32 across the four product test files).
- `sms cutover` leaves all product tables untouched.

### Never executed
`sms.product_change` has **0 rows** locally. `sys.server_principals` on the local instance lists only `sms_app` — **no `sms_pdas_writer` login exists even for the SEP07 copy**. `pdasWrite.test.ts` never reaches `pool()`. The proc dump files the parameter contract was read from are **not in the repository**; the `@error/@errorMsg/@materialId OUT` contract and the `returnValue` fallback cannot be re-checked without re-extracting the procs.

### Defects found by the verifier
- **`MaterialDesc3` carries real data on 3 of 14 live materials** ("Green", "Orange", "RED") and is not mirrored, shown, created or editable; the epoch decision memo §5.2 specified `MaterialDesc1..5`.
- **The audit can be actively misleading**: post-proc app-DB bookkeeping sits *inside* the try around the proc call, so an app-DB failure after `CreateMaterial` has succeeded is recorded as outcome `'error'` with `productId NULL`. Route-level zod rejections (400) write no `product_change` row; `setProductActive`'s short-reason refusal writes none.
- **The concurrency check is TOCTOU**: a plain `SELECT` under READ COMMITTED (no `UPDLOCK/HOLDLOCK`), then `UPDATE … WHERE MaterialId=@id` with no predicate on the before-values. A concurrent SSMS edit — the file's own justification for the whole feature — is silently overwritten and passes the `rowsAffected === 1` assert.
- `PdasWriter.pool()` caches the `connect()` promise; a first-attempt failure leaves a rejected promise cached until the API restarts.
- `seedProducts` compares the DECIMAL(10,2) mirror history with raw PDAS floats using `===`; any non-2dp value would append a new `'pdas_observed'` version every 60 s indefinitely (latent — today's values are integers).
- Write-path plausibility bounds are coupled to the cone **DQ** plausibility rule; creating an unusual product requires an admin to widen the app-wide outlier filter first.
- `z.coerce.boolean()` on `active` (`app.ts:1061`, `:1104`) coerces the string `"false"` to `true`.
- Time-versioned limits are applied on product-at, the outside-limits filter, attention and drift — **not** on the SPC chart spec, the Weight giveaway (`weights.ts` still prints "Historical cones carry no product attribution," now false for September rows), or the station table.
- `product_change` and `product_limit_version` have **no reader** (no route, screen or CLI). `product_timeline.superseded` is never set by any code — no correction path for a wrong changeover.
- The three write routes are **absent from the RBAC test's route table** despite a comment promising 503 coverage. `resolvePdasWrite` has no test.
- Rank-1 never sees the PDAS product list; `config.ts:139` says the disabled reason is shown on Setup — Setup has no such element.
- The epoch decision memo §5.3 specifies "rank 4 + an env flag" to enable; only the env flag exists. §5.4 specifies fixed 500–5000 g bounds; the code uses the DQ rule.
- The missing `db_datareader` on PDAS **blocks the entire sync**, not only the mirror (see Phase 2).
- `index.ts` never calls `pdas.close()` on shutdown (minor).

### Genuinely new
A reader for `product_change` and per-product limits history; fake-transaction tests for CONFLICT / NOT_FOUND / `rowsAffected≠1` / PDAS_ERROR / echo mismatch / post-commit bookkeeping; RBAC and 503 tests for the four routes; a `resolvePdasWrite` test; the conditional second-confirmation step and alternate wording if the PLC reads limits live (specified in the memo §5.5, not built); an enable/rollback runbook and a filed authorisation record; a product filter on any screen; `MaterialDesc3–5` handling; a changeover correction path; re-extraction of the 13 proc definitions into the repo; a "materials running" per-machine view.

### Blocked on IFL
Written authority (Q18 verbal only); `sms_pdas_writer` provisioning; an approved live test window; live `db_datareader`; whether the PLC reads limits live; who may change limits/products (Q19/40/41); lot mapping.

### Clarifications to confirm with IFL
Does the PLC read setpoint/offsets live or only at selection? Written confirmation of the proc-plus-single-UPDATE approach with `DATA_TP1U2` unchanged? Does "material" mean the PDAS `MaterialId` record? Which `Desc` fields matter? Retire (reversible) plus in-place change-limits confirmed as the model (retire-and-recreate is refused by `CreateMaterial` regardless of active flag)? Who is authorised? Which copy counts as "approved copy data"? Is a locally provisioned writer against SEP07 acceptable as the offline proof? Why does `MaterialId` jump from 21 to 1021? Does maintaining PDAS through SMS satisfy "update product details on machines" given PLC integration is out of scope?

---

## 9. Phase 7 — Sack Management and Stock Ledger

**Verified status: PARTIAL** (medium) — and PARTIAL *only when the working tree is counted*. On the committed tree alone this phase would be MOSTLY TO BUILD for live data.

### Sack management half — largely in hand, in the working tree
- Import pipeline: the **committed** reader cannot ingest a live sack (HEAD selects `Source` on `pack1` — the first table — and rethrows; HEAD's July watermark 5,462 exceeds September's restarted ids, so it would read nothing and report success forever).
- Insert-time flag captured end to end; the on-screen "Recorded" wording and caveat are uncommitted (audit fix M7). The caveat appears on the single-sack sheet only; the Readings list header says "Time"; Report/Line bucket sacks by insert-derived `shift_date` without saying so.
- Identity: `id` is the key, `SackNum` resets (one observed reset, 5,462 distinct values over a 0–9,652 range); canonical addressing by `sack_event_id` is uncommitted — HEAD addresses by `source_row_id`, which now names two rows. No DQ finding when `SackNum` resets.
- Weight basis: `interpretWeight` — described as "the ONLY place weight interpretation lives" — has **zero production callers**; the logic is duplicated in `production.ts`, `weights.ts` and `summary.ts`, absent from `register.ts` and `live.ts`. `/api/weights` is orphaned (no screen calls `getWeights`). `WEIGHT_BASIS`/`SACK_TARE_KG` are **inert after the first seed** (`IF NOT EXISTS`); Setup is read-only; the only change path is a hand-crafted rank-4 POST. `CAPABILITIES.md:785` claims "the toggle is built and versioned; answering it is one admin action."
- Sack history register, sheet and CSV; KPIs (count, kg, average, cones/sack) on Report/Line/Wall — but **no sack in-range KPI on any screen** (the CLI computes it; July measured 4.23% out of range).
- "Dependent" marker on Report — the **committed** wording says "IFL has been asked how sacks are linked to machines," which is false; the corrected wording is uncommitted. This prints on the one screen that leaves the building.

### Stock ledger half — nothing exists
Grep across every `.ts/.tsx/.sql/.mjs` for `ledger|stock|receipt|issue|consumption|opening_balance|closing_balance` finds only the unrelated calibration ledger and the Report "not shown" sentence. No migration among 001–027 and none of the 45 routes touches stock.

### The machine gate — decided by data, not by a built gate
The source sack table carries `id, Date, Shift, Area, SackNum, Weight, inRange` and (since August) `MaterialId` — **no machine or station column at any layer**, in either generation. IFL's own tag table (`dbo.t_items`) shows the sack PLC publishes **four sack tags** and no machine or weighing-time tag, so option (a) in the drafted question ("machine known at the sack PLC") would require IFL to *add a PLC tag*, not merely permit integration. The requirement's "machine ID unavailable" branch applies. The acceptance criterion ("no sack attributed to a machine without a defensible association") is satisfied trivially by absence — untested, unrecorded, unconfirmed by IFL — and must be re-proven once any association mechanism exists.

### Genuinely new
Ledger data model (append-only movements: receipt/issue/consumption/adjustment, quantity in sacks and/or kg, `material_id`, nullable `machine_id`, nullable `sack_event_id` for automatic receipts, plant-clock `occurred_at` + `recorded_at_utc`, `recorded_by`, reason) plus opening balance; balance derivation per period; automatic receipts from `sack_event`; manual routes at the rank IFL sets (Q43) with audit; a ledger screen or Report block; tests and a simulator scenario; the controlled manual association workflow if IFL chooses operator entry; a sack in-range KPI; a product filter on sacks; a `mapSack` unit test; a `SackNum`-reset DQ finding; a sack-blackout DQ finding (the trigger's four-tag completeness guard makes a total sack blackout a real failure mode).

**Project-recorded estimates:** "Fallback build if IFL answers *line level*: `sms.sack_stock_movement` … and a stock figure on Report. 1–2 weeks after the answer" (`REDESIGN.md:311`). `IFL_SACK_STOCK_QUESTION.md`'s own table: PLC = "Large — a new phase, and it reverses their own Q22"; manual entry = "Medium"; line-level = "Small".

### Blocked on IFL
Q28–32 (entirely open; the question was drafted 2 Sep 2026 and **has not been sent**); the machine-link option; the stock-out event; Q43; Q24 (gross/net); Q25 confirmation; Q3/Q4; Q52/57 and the Jul–Aug data; live login.

### Clarifications to confirm with IFL
Does "machine" for a sack mean the 14 winders or the packing scale(s)? Is a "receipt" each weighed sack (derivable automatically) or empty sacks arriving into a store (not in any data)? What unit — sacks, kg, both — and split by product and/or sack type? What event removes a sack from stock, and what record exists for it today? Is operator-entered association a "defensible" basis, and does it need a second approver? May the approximate cone window enter any stock arithmetic, or stay a labelled approximation? Is insert-time acceptable for sack time and shift; is the sack acquisition delay like the cones' ~18 minutes? Is the weight gross including the sack, is 0.5 kg the tare, and should a later basis change re-interpret history? Is there an existing stock figure to seed an opening balance? Is a second sack scale foreseen (the trigger's `Area` literal changed from `Sack-1` to `Sack-3`)?

---

## 10. Phase 8 — Dashboards and Reports

**Verified status: PARTIAL.** At HEAD the dashboards carry wrong reject rates (H1, H2), dead product controls (H3), unfiltered cross-links (H4), false calm states on failure (H14), a lag sample that reads the older generation, a register that cannot address September rows, a sheet that applies the wrong product to attributed rows, and a printed Report asserting a question was sent to IFL when it was not. Every fix exists only in the working tree.

### The eleven screens

| Required screen | Actual home | State |
|---|---|---|
| Line overview | `Line.tsx` | In hand (working tree) |
| Live production | Folded into Line's headline/last-readings and Wall; no dedicated screen | Partial — confirm with IFL |
| Cone readings | `Readings.tsx` | In hand (working tree; HEAD cannot address September rows) |
| Weight analysis | `Weight.tsx` | In hand (HEAD prints "Average cone weight is 0 g" on an empty period) |
| Rejects | `Rejects.tsx` | In hand (HEAD computes the wrong rate) |
| Sack management | A toggle inside Readings plus figures on Report; no screen | Partial — confirm scope |
| Product setup | `ProductSheet.tsx` overlay (untracked); write half flagged off; Setup has no product section | Partial |
| Reports | `Report.tsx` + `report.ts` | One report shape |
| Wall/dashboard | `Wall.tsx` | In hand; device unknown; more than 14 stations unresolved |
| System health | Inside admin-only Setup; IFL's manager-rank accounts cannot open it | Partial |
| User administration | Setup → People; write controls uncommitted; **no password reset/change, no delete**, no server-side last-admin guard | Partial |

### The nine report types

| Report | State |
|---|---|
| Daily | **Producible** — but the committed Report carries the false "IFL has been asked" sentence, and its "Rejected" figure counts *inspection* rejects (`reject_event`) while Readings' "Rejected cones" counts *scale* rejects (`in_range = 0`): two populations under one word, unlabelled |
| Shift | Partial — `/api/report` accepts no shift filter; "This shift" prints the whole production day |
| Product | **To build** — product filter is committed; no `groupBy=product`; no UI caller |
| Machine/station | Data exists (`/api/production?groupBy=station`, `/api/weight-stations`); no report surface, no CSV |
| Reject | Analytics only; no composed report; no CSV/print on the Rejects screen |
| Cone weight | Analytics only; no export or print header on Weight |
| Sack | Partial — totals and tables exist; basis and stock open |
| Calibration | Partial — adjustments endpoint returns newest 200 line-wide with no `from/to`; only surface is StationSheet; Report has no calibration section |
| Management summary | Verdict mark + four totals; no KPI set defined by IFL; no comparison against a prior period; quarter reachable via API only |

### Acceptance — IFL approves layouts and KPI definitions
Not started. Q33–37 are "entirely open." No KPI definition sheet exists in a form IFL could sign; the only formula reference (`CAPABILITIES.md` §4) is marked superseded and still describes withdrawn OEE material. `design/sms-redesign/*.dc.html` and the handoff spec exist and could support a layout pack.

### Additional findings
- `DEPLOY.md:70-75`, `CLAUDE.md` and `CAPABILITIES.md` address screens as `?v=…`; the app reads `?s=` (`App.tsx:71`) and falls back to Line for anything else. **The documented wall-display kiosk command does not produce a wall display, in any version.**
- Three orphaned client wrappers remain in `web/src/api.ts` (`getShiftAnalysis`, `getStoppagePatterns`, `getOee`) targeting deleted endpoints.
- `Weight.tsx:91` calls `getProduction` without `tsTo`, so under replay Weight covers the whole shift while Line and Wall stop at the replay instant.
- `Wall.tsx:68` calls `getAttention` with `from=undefined` on first render (a 400 that is swallowed).
- Readings' Print button prints whatever 100 rows are on screen with no header, period, line name or printed-by line — not a report surface.
- The shift-rule `mode` written by the admin endpoint is recorded but applied nowhere; the Setup control that appears to configure it is inert for that field.
- The three PDAS write routes have no RBAC test row.
- `CLAUDE.md` describes uncommitted code as done in several places; its own greppability rule is met by the working tree and violated by the repository history.

### Genuinely new
Product report (`groupBy=product`, section, CSV, the unattributed-readings sentence); calibration report with `from/to`; machine/station report surface; reject report composition plus the per-day-per-code sheet; cone-weight report surface with export/print; management summary per IFL's KPI list with period-over-period comparison and Excel/PDF/email if Q36/37 require them; a shift parameter on `/api/report`, `/api/rejects`, `/api/reject-spc`, `/api/calibration` (the redesign's own step-2 item); a dedicated sack screen and ledger; an every-user health screen plus service-level health; password reset/change, user delete, server-side last-admin guard, role rename; Setup product section and limits rule; quarter in the UI; UI render tests; a KPI definition sheet and layout pack.

### Blocked on IFL
Q33–37; Q28–32; Q24; Q12; Q18/19/40/41; Q39–43; Q65–67 and Urdu; Q46–48; Q56; Q1/3/4.

### Clarifications to confirm with IFL
Is a separate Live screen expected, and what should "live" mean given the ~18-minute acquisition lag? What should sack management let a user *do* beyond viewing? Should product setup live in admin Setup or remain reachable to supervisors/managers, and does "setup" include writing to PDAS? Which roles need the full health view, and should it include service and backup status? Password reset/change and deletion in the UI; app-local or directory accounts? Is a product report wanted despite the original Q1 answer, with pre-August shown as "not recorded"? Does "machine" mean the 14 numbered stations? Must reports use the derived shift? Calibration report contains only SMS-logged adjustments from go-live — confirm? KPI set and targets for the summary and Wall? Excel/PDF or scheduled email (the plant PC has no internet)? May reports print partial-coverage totals with the coverage sentence?

---

## 11. Phase 9 — Calibration Analytics, and Phase 10 — Optional AI/ML

**Verified status: PARTIAL** (Phase 9); **BLOCKED** on data and definition (Phase 10).

### Phase 9 — the eight named items

| Item | State | Notes |
|---|---|---|
| Mean weight | In hand | Line, subgroup, station, day |
| **Median weight** | **To build** | Not computed anywhere for weights; the only medians are acquisition lag and sync duration |
| Standard deviation | In hand for line-level; **per-station SD computed but rendered nowhere** | `/api/calibration` — the only endpoint carrying it — has no UI caller; `/api/weights` likewise orphaned |
| Drift | In hand | I-MR sigma, calendar-contiguous segmentation (uncommitted); **`attention.ts`'s calendar-gap logic is untested** (the assessor wrongly credited `attention.test.ts`) |
| Trend | In hand | Rule names defined for the UI (`NELSON_RULE_LABEL`) but never rendered; hover says "non-random pattern" |
| Station behaviour | In hand | One table: vs line, vs target, days held, reject rate, last adjusted. Target is line-wide while six materials run concurrently ("recorded, not built") |
| Nelson rules "where approved" | In hand (25 tests) | No record IFL approved the method; rules 4 and 7 (14–15 in a row) cannot fire on a ~20-day series; the UI statement of which rules are live was deleted in the redesign, and `nelson.ts:14-20` plus `CAPABILITIES.md:546` still describe it |
| Recommended adjustment | Partial, by design | An observation sentence ("has read about N g heavier for D days — check its scale first"); no gram figure or days-to-limit, because weighing data cannot distinguish a heavy scale from heavy cones. **Confirm with IFL whether this satisfies the line.** |
| Adjustment history (ledger) | In hand; `amount_g` uncommitted | UI form cannot set adjusted-at time or note; captures no before/after readings, reference weight, or product in force; line-wide adjustments (station NULL) shown on no screen; sheet caps the log at 6 rows |

Naming discipline is clean: zero user-facing occurrences of AI/ML/predict/forecast in `api/src` or `web/src`.

### Verifier additions
- Cp/Cpk and the chart's USL/LSL come from the **mirror** via `spc.ts getSpec`; the target line on the same screen comes from the time-versioned catalogue. They agree only until the first setpoint change.
- `StationSheet.tsx:230` compares a production-day string against genuine-UTC `adjustedAtUtc` with no plant-offset conversion — a client-side breach of the two-clocks rule (the web has no `toPlantMs` helper).
- The Nelson centerline and I-MR sigma include pre-adjustment days; only the run count restarts at an adjustment.
- Station naming is **rank 4** (admin-only), not rank 3 as the assessor stated; every IFL account created per `DEPLOY.md` guidance (manager) cannot name a station. 13 of 14 station names are NULL.
- The detector window is 14 *calendar* days ending at the newest production day, not "14 production days" as `CLAUDE.md` states.
- `REDESIGN.md` §5.3/§6 items still missing: pattern named in words on hover; flagged days named on the sheet; every adjustment ticked with amount and who; drift-test rules and a PLC-vs-product table in Details.
- "Advisory-only, never a machine command" holds today **by configuration** (`PDAS_WRITE_ENABLED=false`) and by the absence of a PLC path — not by architecture. If IFL confirms the PLC reads limits live, `POST /api/products/:id/limits` becomes a machine setpoint change once enabled.

### Phase 10 — data prerequisites against the sidecar (read-only queries, 12 Sep 2026)

| Prerequisite | State |
|---|---|
| ≥ 6 months good history (12 preferred) | **53 production days** across two generations (19 + 34) with a 25-day sampling gap — about 29% of six months, 15% of twelve. IFL retains ~1 month at source; history accrues only while SMS runs live |
| Machine/station identity | 100% of cone and reject rows; sacks none; names unpopulated |
| Product identity | 132,551 of 132,551 September rows; **0 of 142,510 July rows** (correctly not back-filled) |
| Weight readings | 275,061 cone rows, none null; basis unconfirmed |
| Actual reject outcome | Recorded but **ambiguous**: the scale's bit and the product tolerance disagree on ~1,000 July cones; code meanings unknown |
| Calibration/adjustment history | **One row** — a verification test with no amount; IFL has no records of its own (Q49/50 answered by absence) |
| Before/after weight performance | **No column, no computation** |
| A clear prediction target | Q46–48 open; the "is AI contractual" question unsent |

Earliest Phase 10 start is roughly six months after go-live, and go-live cannot be dated until the access and hardware questions are answered. The one real prediction that can be built now on the existing drift series — "reaches the action limit in about N days at the current rate" — is described as a plan in three documents and is not in code; it is the honest bridge between Phase 9 and Phase 10.

### Genuinely new
Median weight; days-to-limit projection labelled "if it continues at this rate"; before/after performance per adjustment; adjusted-at and note fields in the log form (API accepts both); configurable drift thresholds; per-station SD surfaced or the claim dropped; `spc.ts` routed through the versioned catalogue; plant-offset conversion in StationSheet; a calibration section on Report; the REDESIGN §5.3/§6 items; any ML pipeline (cannot start by the requirement's own gate).

### Blocked on IFL
Whether "AI" is contractual (Q24 in the redesign numbering; unsent); Q46–48; Q56 and Q51–55/57; Q4/5/24; Q10/12; Q1/3; Q39–41; go-live.

### Clarifications to confirm with IFL
Does an observation-plus-action sentence satisfy "recommended adjustment," or is a signed gram figure or a projected days-to-limit expected? Approve the Nelson rule set (all eight or a subset) and day-level application? Where is the median wanted? Confirm history is built forward from go-live through the SMS ledger, and what "before/after performance" means in IFL's procedure? Accept that 6–12 months accrue in the sidecar after go-live, or do backups hold older data? May pre-August readings be attributed by the line-wide record at lower confidence, or excluded from any model? Which judgement is the "actual" reject outcome? Phase 10 cones only? Confirm advisory-only.

---

## 12. Phase 11 — Security, Reliability and Operations

**Verified status: PARTIAL.** The core is genuinely in hand and mostly committed on `main`; the operational half is largely absent.

### In hand
- **Committed on `main`:** argon2 with timing-equalised verify; login limiter keyed on IP *and* username (8 fails / 15 min) with `TRUST_PROXY` off by default (the X-Forwarded-For bypass was reproduced and fixed in-project); hand-rolled CSP/nosniff/DENY/Referrer/Permissions headers, HSTS only when `req.secure`; TLS options A/B; `requireRole` with real-HTTP RBAC tests over **31 of 40** gated routes (the 9 uncovered include all three PDAS write POSTs); `audit_log` with 11 writers; the backup script (whose **committed defaults fail** — `-User sms_app` has no backup role; the L4 fix is uncommitted) and the 19 Aug restore rehearsal record.
- **Branch-only:** sliding session renewal — **never exercised by any test** (the RBAC fake DB returns no `expires_at_utc`); `live.ts` — the entire acquisition-health service — **does not exist on `main`**.
- **Uncommitted:** `lock.ts`, migrations 017–027, the `migrate.mjs` rewrite, the H10 access log, `pdasWrite.ts`.

### Not built
- **Log rotation:** none in code; the NSSM block sets `AppStdout` only for `SMS-Api`, so **every stderr warning the API writes** — the `COOKIE_SECURE` cookie-drop warning, the plant-offset mismatch, `[http]` access lines, `[audit]` failures, `'api error'` stacks — **is discarded under the documented install**.
- **Retention:** `sms.sync_run` gains ~5,760 rows/day and nothing prunes it, `audit_log`, `dq_finding` or `product_change`; `ARCHITECTURE.md` §12 assigns a 90-day policy implemented nowhere.
- **Database maintenance:** no `CHECKDB`, statistics, recovery model, log-file policy, or size monitoring; the Express 10 GB cap is "never checked or planned for."
- **Configuration backup:** nothing backs up `.env`, TLS material, NSSM definitions or scheduled tasks.
- **Upgrade procedure:** none distinct from first install; no rollback; no release versioning.
- **Scheduled backup task:** an instruction, not an artefact; the password would sit in a Task Scheduler argument string.
- **Provisioning SQL:** none for the `sms` database, `sms_app` or `sms_readonly`; `sms_app` runs DDL via `migrate.mjs` so it can `UPDATE/DELETE` `audit_log` — "append-only by construction" is unenforced (no trigger, no `DENY`).
- **Password change/reset:** none for any role, in UI, API or CLI; a forgotten password requires SQL. CLI accepts any non-empty password.
- **Health signals:** `/api/health` is `SELECT 1`; service, acquisition and database health are not separated; `lifetime.lastFailure.error` and the epoch/schema status are computed and **rendered nowhere**; the only health screen is admin-only while IFL's accounts are to be created at manager.
- **Recovery:** no `pool.on('error')` listener in any process; no SIGTERM/SIGINT handling; no NSSM `DependOnService` on SQL Server or restart throttle — the API exits 1 if the DB is not up at boot; orphaned `'running'` `sync_run` rows are never reconciled, so the cutover pre-check fails spuriously after any past crash; a non-numeric `SYNC_INTERVAL_SECONDS` yields `NaN` and a zero-delay polling loop against IFL's database; the transform lock covers rebuild only — `sms cutover` and `sms epoch:purge` take no lock and have no running-worker check; the `'persistent sync failure'` CRITICAL finding `ARCHITECTURE.md` §14 promises has no `check_name`.
- **The five acceptance failure modes** have never been rehearsed as such; `withRetry`, `classifyHealth` and `withTransformLock` have no tests.
- **IFL role mapping:** two developer defaults **disagree** (`DEPLOY.md` "everyone at manager" vs `REDESIGN.md` §7 engineer/manager split); no named-person table; Q39–41/43/19 open; AD vs local (Q18) never asked. The role rename (viewer/engineer/manager/admin) is designed, not built.
- Login/logout/failed-login, CSV export and every CLI write are not audited; the audit viewer is `TOP 500` with no paging.
- `LoginRateLimiter.map` is never pruned; `TtlCache` sweeps expired entries only on re-read.
- `DEPLOY.md` §"Operations & monitoring" points operators at an Operations screen and fields (`sourceAgeSeconds`, transform version) deleted on 3 Sep 2026.

### Genuinely new
(As listed above: rotation, retention job, DB maintenance plan, config backup procedure, upgrade/rollback procedure and release identifier, scheduled-task registration with off-box copy and `RESTORE VERIFYONLY`, restart/interruption rehearsal record and tests, password paths and guards, pool error listeners and graceful shutdown, the app-pool leak fix, service and database health signals, role rename migration, audit rows for auth/export/CLI if required, bounded limiter/cache, the persistent-failure finding, orphaned-run reconciliation.)

### Blocked on IFL
Role mapping and write matrix; AD/SSO vs local; backup regime and storage (deferred to IFL IT at deployment); retention policy; the plant host and live login for any recovery rehearsal; written PDAS authority.

### Clarifications to confirm with IFL
Which named people or titles hold which role, per write action? Directory accounts or app-local? Password and session policy (today: 6-char minimum, 8 fails then 15-minute lockout, 7-day sliding, wall display never expires)? Which events must be audited? Who operates the runbook and on what machine? IFL's backup regime? Retention of raw and canonical readings against the 10 GB cap? Does IFL remove old rows by deleting within a table or only by drop-and-recreate (this sets the longest recoverable outage)? TLS on the intranet, and an internal CA? Alerting on sync stop or backup failure (email is not possible on an air-gapped host)? Is the 18-minute acquisition delay acceptable as the definition of "current"?

---

## 13. Phase 12 — Testing and Release, and Phase 13 — Documentation

**Verified status: MOSTLY TO BUILD** (medium). By raw item count PARTIAL is arguable (about 5 in hand, 8 partial, 18 to build after downgrades), but every in-hand item is wholly or partly uncommitted, both documents credited as complete are defective in committed form, and everything release-shaped is absent.

### The eight test levels

| Level | State | Evidence |
|---|---|---|
| Unit — business rules | **In hand** | 28 files, 221 `it()` blocks, 266 cases (a document claim; not executed here). Untested modules: `spc.ts` (500 lines, the largest service), `weights`, `production`, `operations`, `rejects`, `admin`, `audit`, `currentProduct`; `lock`, `retry`, `store`, `IflSqlAdapter`, `pipeline`, all seeders; 6 of 7 CLI commands |
| Integration — source DB → historian → app | Partial | **No test opens a real SQL Server**; every test uses a fake pool or `vi.mock`. The RBAC suite boots the real Express app over real HTTP with the DB faked |
| Data reconciliation | Partial | The tool exists (per-generation logic uncommitted; HEAD is a whole-table check); no totals-level test |
| UI — critical workflows | **To build** | Structurally impossible today: vitest `environment: 'node'`, include `*.test.ts` only, no jsdom/testing-library/playwright in any manifest or `node_modules` |
| Failure tests | Mixed | Duplicate data ✔, source reset ✔, missing product ✔, invalid timestamps ✔ (mostly uncommitted); missing machine partial (the API-level test is arithmetic-only and untracked); **network loss ✗; source-DB-unavailable ✗** — a test would expose the pool leak and the narrow retry scope |
| Security | Partial | Unauthorised access ✔ and role escalation ✔ over 31/40 routes; **audit integrity ✗** — no test asserts an audit row for any action, and no DB-level enforcement exists |
| Performance | **To build** | None of the four dimensions; only point measurements in prose (11–15 ms; guardrails API < 100 ms, dashboard < 300 ms, sync pass < 30 s) |
| FAT/SAT checklist | **To build** | None exists; the only "acceptance" artefact is the 12 visual design checks |

No CI configuration exists anywhere.

### The thirteen documentation deliverables

| Deliverable | State |
|---|---|
| System architecture | Partial — `ARCHITECTURE.md` §10 and §14 stale; no diagram folding in the Sep 2026 subsystems |
| Database architecture | Partial — three conflicting table counts; no sidecar ER/catalogue |
| Integration specification | Partial — spread across `SCHEMA.md`, `iflTables.ts`, `ARCHITECTURE.md` §7, the untracked epoch memo |
| Data dictionary | Partial — IFL side is genuine (`SCHEMA.md` §2); **sidecar side does not exist** |
| User manual | **Absent** |
| Administrator manual | Partial — most of it is in `DEPLOY.md` |
| Backup/restore manual | In hand — but the **committed script fails on its defaults** and the committed prose disagrees with it |
| Installation manual | In hand — but the **committed cutover section is the retracted "first pass backfills" procedure** the project found fails silently; the wall-display URL is wrong in every version; no `CREATE DATABASE/LOGIN` |
| Troubleshooting guide | Partial — fragments only |
| FAT protocol | **Absent** |
| SAT protocol | **Absent** — blocked on live login, host, signatory |
| Change-control procedure | **Absent** |
| Release notes | **Absent** — no CHANGELOG, no tags, all `0.1.0` |

**Stale statements a handover must not carry:** `README.md:10` "21 tables", `:14` deleted floor screens, `:42` cutover-by-repointing; `CLAUDE.md:30` "25 app tables", "17 tests", "repoint `IFL_DB_SERVER`"; `SPEC.md:250` asserts a PLC-guard test that does not exist and its header says "no code written yet"; `CAPABILITIES.md` inverts `sack1`/`pack1` twice and describes deleted screens; `ARCHITECTURE.md` §14 promises a CRITICAL finding on disconnect not in code.

### Genuinely new
UI test infrastructure and tests (needs dependency approval); performance harness and results; network-loss and source-DB-unavailable tests; audit-integrity tests and DB-level tamper protection if required; a real-database integration test and totals reconciliation; FAT and SAT checklists and protocols; user manual; troubleshooting guide; change-control procedure; release notes and a version tag; CI.

### Clarifications to confirm with IFL
Is the sidecar what the requirement means by "historian"? Is the missing-machine scenario for cones/rejects only (a missing machine on a sack is the normal state)? Does "audit integrity" mean every write recorded with its actor, or tamper-evidence at database level? Expected concurrent user count (does the wall display count)? Peak production rate and number of lines to test against? Rebuild recurrence and the operator procedure for it? Which workflows are "critical," and on what device? Where is FAT held, what is the SAT evidence, who signs? Manual language(s) and template? Formal change approval from IFL after go-live for changes touching PDAS writes or the source connection?

---

## 14. Work no phase currently covers

Necessary work identified by the completeness pass that appears in no roadmap phase. Adding it does not critique the roadmap; it prevents it being missed at scoping.

| Sev | Item | What is unowned |
|---|---|---|
| **CRITICAL** | **Off-machine safeguarding and continuity** | The deliverable *and IFL's June–July data* exist on one laptop. The July generation (142,511 cones) survives only as the dev sidecar and an extracted MDF — IFL dropped the table on 5 Aug; whether their backups hold it is open (Q55). **Corrected 21 Sep 2026:** the previous version of this row said "the `SPS.rar` archive is no longer on disk" — false; both original client archives (`SPS Database TP1 Line3.rar`, the July sample, and `SPS (2).rar`, the September sample) were located on `D:\google download\` on this same machine on 21 Sep 2026. That correction does **not** soften the CRITICAL rating: `D:` is the second physical disk of the same single laptop, not a second machine or an off-site location, so every copy of IFL's data and of this deliverable remains in one building on one machine with no off-machine or off-site copy. Phase 0 commits and tags but names no push, no off-machine copy of the client data, no developer handover guide (the dev-environment setup exists only in a private memory directory; `README.md` is Phase-0-era), no second person or escrow. **Needed now:** a `git bundle` of the working tree, a backup of the dev app DB, and copies of the two extracted samples — before Phase 0 completes. |
| HIGH | **The IFL question cycle** | 36 of 70 questions open; `REDESIGN.md` §11's five items are "to send IFL together, now" — unsent since 3 Sep; `IFL_SACK_STOCK_QUESTION.md` drafted 2 Sep, unsent; the Jul–Aug data request "not yet formally requested"; PDAS authority verbal only. Answers are recorded in four places kept in sync by hand. No phase owns dispatch, tracking, deadlines, or what happens when an answer does not arrive. |
| HIGH | **Historical data retention (core function 11)** | No phase task implements retention or asks IFL for the decision `ARCHITECTURE.md` §12 assigns to them. Nothing prunes `sync_run` (~5,760 rows/day), `dq_finding`, `audit_log`; nothing probes database size against the Express 10 GB cap. |
| HIGH | **Go-live data disposition** | `DEPLOY.md`'s first-time setup creates a *fresh* DB (so neither archive would be on the plant); its cutover section assumes the *dev* DB is transported ("the sample generations stay as archived history"). No step transports, cleanses (test residue, dev admin hash, dev-era `sync_run`/`audit_log`/session rows) or **certifies** the archives — `source_epoch` stores no closing checksum, `verify` reports closed generations as "archived" without a source, and no verify transcript is stored anywhere. Once the sample copies are detached, "cone data reconciles" cannot be evidenced for the archives. |
| HIGH | **Backfilling the missing 10 Jul – 5 Aug period** | `SEPT-2026-DB-BRIEFING.md:109` says it "will load into epoch 1 by id with no further engineering." The code contradicts this on four points: the reader declares the July shape unsupported; `resolveEpoch` accepts rows only into an *open* generation and epoch 1 is seeded closed; `epoch:accept` closes the currently open generation, so loading an archive after go-live would displace the live one; `generation_ordinal` is `MAX+1` and drives p-chart pooling, so an earlier period loaded later would be ordered *after* the live generation. An archive-ingest path (shape-specific column maps, archive epochs that do not displace the live one, chronological ordinals, a closing reconciliation record) must be designed **before** the data request is answered, or the delivery will sit unloadable. The same applies to any 3–12-month history IFL supplies. |
| HIGH | **CI and roadmap rules 14–16** | No CI; no `PROJECT_STATUS.md` (rule 15); no per-phase closure checklist (rule 14); no tag or versioning convention (rule 16). `PROJECT_TECHNICAL_HISTORY.md` §21 records four incidents of the project's own docs overclaiming, each caught only by an ad-hoc audit — a structural guard is what is missing. |
| MEDIUM | **A living defect register** | The only severity-graded register is the one-off 10 Sep audit (untracked). Defects verified in code during this pass appear in no project record — see §17. The Definition of Done's "no critical/high unresolved defects" cannot be evidenced without one. |
| MEDIUM | **Phase 9 validation method** | Phase 9 has no acceptance section, yet the Definition of Done requires "calibration advisory is validated." Nothing defines validated; the only related gate (`REDESIGN.md` §12 step 5 — a week of simulator data with false positives counted, and a walkthrough with IFL) is not recorded as performed; the ledger has one test row; IFL has no records to validate against. Needs an agreed method, a recorded run, and IFL sign-off — which also depends on the unsent "AI" question. |
| MEDIUM | **Air-gapped host prerequisites** | `DEPLOY.md` says internet is not required, then runs `npm ci` on the plant server (needs the registry; `argon2` is a native module). No release archive or offline bundle; no Node pin (Node 20 EOL; dev on 22); no licence inventory or NOTICE; the self-hosted font ships without its OFL text; the plant-offset cross-check is optional, API-only, and warns to a stderr the documented install discards; no timezone/NTP prerequisite though the running/stopped judgement compares host clock to IFL timestamps. |
| MEDIUM | **Tunnel decommission and client-data handling** | `sms/ops/sms-watchdog.ps1` is committed with a public ngrok URL and the developer's absolute path; the running dev instance serves IFL's production readings over the internet behind a shared password. The extracted samples on the same machine include `DATA_TP1U2.Users` with plaintext passwords. No phase names standing the tunnel down, removing the dev-only scripts from the delivered tree, or agreeing with IFL how sample data is retained, returned or destroyed. |
| LOW | **Rule 6 review of an existing inference** | The sack sheet infers a cone-to-sack relationship from timestamps (0–254 cones between consecutive sacks, insert-time based). Roadmap rule 6 forbids timestamp inference of machine/sack relationships without IFL's explicit approval; `IFL-QUESTIONS-STATUS.md` tags this "[Our design]." No phase schedules approval or removal. |
| LOW | **Localisation** | `words.ts` anticipates Urdu; no switching mechanism exists; `format.ts` fixes en-US and a 12-hour clock; the device/Urdu question is unsent. |

---

## 15. Dependencies and delivery sequence

Planning support only; the roadmap's content is unchanged.

### Phases substantially in hand (work = commit, test-record, rehearsal, documentation, IFL approval)
2, 3, 4 (core), 6, 9, 11 (core). Each carries the short list of genuine gaps recorded in its section above.

### Phases that cannot be scheduled until an *unasked* question is answered
1 (Q1/Q3/Q4/Q14), 7 (Q28–32/Q43), 8 (Q33–37), 10 (Q46–48, Q51–57), and the enabling step of 6 (Q18/19). These are not waiting for a reply — the questions have not been sent. Treat them as one client-facing gate with one send date and plan the dependent waves from the reply date.

### Phases that cannot meet their acceptance on the data or access that exists today
- **7 (machine-level stock):** no machine column, no PLC tag, no stock-out record. Either IFL adds a sack-PLC tag or accepts an operator-recorded association — both IFL's choice. The line-level half of the ledger can be scoped once Q28–32 answer what a receipt and a consumption mean.
- **10 (AI/ML):** 53 days held against six months; one ledger row; no target. Entirely outside development: data arrives, the app goes live for months, IFL defines the target.
- **2/3/4 live reconciliation, 6 write path, 12 performance, 12/13 SAT:** unreachable on current access (no live login, no writer login, no host, no user count).

### Dependencies that run counter to the numbered order
- **Phase 0 needs slices of 11, 12 and 13** — from-zero bootstrap SQL; `DEPLOY.md:168-173` corrected and `schema_migration` seeding decided *before* the populated-database migration rehearsal; the dev-machine epoch seed moved out of migration 025 before the from-zero rehearsal; a captured test run; `BASELINE.md`/`PROJECT_STATUS.md`.
- **Phase 1's entity decisions should precede Phase 3's rebuild.** `TRANSFORM_VERSION` needs one bump and one snapshot-gated rebuild of 275,061 cone rows. If Q3 says machines and stations are distinct, or Q14 says multi-line, the canonical shape changes again. Sequence: commit → collect Q1/Q3/Q4/Q14 → decide entities → bump once, rebuild once.
- **Phases 1 and 2 share the adapter-interface item** (`IngestionAdapter` 0 hits; `IFL_TABLES` const; `'ifl_sql'` at six sites including `rebuild.ts:69`'s DELETE). Plan it once. The station roster (`TOP (14)`) and shift boundaries (`SHIFT_BOUNDARIES`) can be removed now regardless of answers.
- **Phase 8's report types depend on Phase 4/5 items**: per-day-per-code and a code filter (5), `groupBy=product` (6/8), the five-state classification (4), a shift parameter on `/api/report`, `/api/rejects`, `/api/reject-spc` (4/5). **Phase 9's chart depends on** routing `spc.ts` through the versioned catalogue (4/6).
- **One committed defect touches three phases:** `Setup.tsx:62` hides Phase 4's faulty-reading findings, Phase 2's DQ surfacing and Phase 11's health signal. Fix once, early.
- **Phase 10 sits behind go-live, behind Phase 11, behind two unasked access questions** (live `db_datareader` on both databases; the target host).

### Recommended waves
- **Day 0 — no IFL dependency:** repository preparation (`.gitattributes`, remove/ignore `q.mjs` and `sync-trace.mjs`, `engines`/`.nvmrc`) → atomic commit (or a short series in dependency order: `shared/plantClock` + `shared/index` → migrations 017–027 → sync-worker → cli → api → web, verifying the build after each) → push → branch decision → first annotated tag → **send the question pack**, referencing the tagged build. Also: the interim off-machine copy (`git bundle`, dev DB backup, the two extracted samples).
- **Wave A — immediately, no IFL dependency:** close Phase 0 by pulling forward its slices of 11/12/13. In the same wave, the phase-independent hardening: `Setup.tsx:62`; retire the client-side `judge()` in favour of one server-side classification; route `spc.ts` through the catalogue; the sync-worker app-pool leak; persist worker halts as a `sync_run`/`dq` row; move `seedProducts` behind failure isolation; behavioural tests for the three admin rule routes and the seeders; provision a local `sms_pdas_writer` against the SEP07 copy for offline PDAS tests; re-rehearse backup/restore on the two-generation schema; fix the `?v=`/`?s=` kiosk instruction and the duplicated step 8; correct the false Report sentence. Hold the `TRANSFORM_VERSION` bump for Wave B.
- **Wave B — after Q1/Q3/Q4/Q14:** Phase 1 entity decisions and schema; the shared adapter-interface item (incl. `rebuild.ts:35/:69`); then the single `TRANSFORM_VERSION` bump and rebuild Phase 3 needs.
- **Wave C — after live login and host:** Phase 11 cutover rehearsal on the live source with the deliberate halt and `epoch:accept`; `sms verify` on an `ifl_live` generation stored as the acceptance artefact; the five failure-mode rehearsals; scheduled backup task; NSSM `DependOnService`/`AppStderr`.
- **Wave D — after Q33–37, Q12, Q24:** Phase 4 five-state and weight reconciliation; Phase 5 drilldowns, dictionary population, per-day-per-code; Phase 8 report surfaces and the KPI sheet for IFL approval.
- **Wave E — after Q28–32/Q43:** Phase 7 ledger and, if chosen, the manual association workflow.
- **Wave F — after go-live plus accrual:** Phase 10.

---

## 16. Delivery risks, ranked

| Sev | Risk | Verified detail |
|---|---|---|
| **CRITICAL** | **No off-machine existence** | 107 uncommitted paths, 26 unpushed commits, zero tags, an interlocked change set. A clone of the remote yields the app IFL called unusable, with a reader that halts on the first table against the live plant. |
| **CRITICAL** | **Cutover step 4 cannot produce its documented halt on IFL's known login pattern** | `seedProducts` runs before the epoch gate, unguarded, and needs table SELECT on PDAS that IFL has not granted. On a proc-only login the worker halts with a permission error, writes no `sync_run` row, and retries the same failure every 60 s forever. No local rehearsal can surface this because the local `sms_readonly` user was created by this project. |
| HIGH | **The go-live procedure has never run against a live target, and five of eight steps have a code-verified way to go wrong** | The backup default `-Server` is the dev port and the password is on the command line; the pre-check on `finished_at_utc IS NULL` fails spuriously after any past crash; the string typed in `IFL_DB_SERVER` becomes part of the generation identity verbatim, so a later respelling halts the worker; `epoch:accept` closes the old row and inserts the new one without a transaction; a fresh plant DB carries eight `'localhost'` tombstones from migration 025; the kiosk URL lands on Line. |
| HIGH | **A halted or refused sync leaves no trace an IFL user can see** | The gates throw before `startSyncRun`; the API computes `'no-open-epoch'` and `lastFailure.error` and no screen renders either; the only health screen is admin-only while IFL's accounts are to be created at manager. Plus the per-tick pool leak and the `NaN` interval loop. |
| HIGH | **Silently-wrong-number classes are fixed case by case, not prevented by structure** | What *is* structural: the epoch and restore gates, `raw_read_without_write`, `guardZeroWrite`, freshness from the oldest table, `stateIsKnowable`. What is not: API↔UI contract drift is uncheckable at compile time (the web imports nothing from `@sms/shared`; `events.ts` is dead) — live instance `Setup.tsx:62`; two screens computing one figure two ways (`/api/reject-spc` no shift/tsTo); versioned limits applied inconsistently (`spc.ts` mirror); `REJECT_COLS` omitting `material_id`; the register's nullable join; `is_pass` nulling; `dq.ts` hard-codes. Thirteen live instances, several committed at HEAD. |
| HIGH | **Two `--confirm` commands delete the archive of record with no backup precondition, running-worker check or lock** | `cutover` chunk-deletes every raw and canonical table, all epochs (including tombstones migration 025's rationale says must survive) and all findings; `epoch:purge` deletes across seven tables. IFL keeps ~1 month at source. Both build id lists into SQL text (integer-validated, but contrary to working rule 3), as does `summary.ts`. |
| MEDIUM | **The single-line assumption is load-bearing at every layer** | `cfg.lineId` at 57 sites; no route accepts a line; `lines[]` always one element; `IFL_TABLES` const; `'ifl_sql'` literal incl. a DELETE; rows carry no line identity (a second worker stamps whatever its `.env` says); `LINE_ID` undocumented in `DEPLOY.md`; `cutover` has no `line_id` predicate; `reject_code` unique index has no `line_id`; `TOP (14)` roster with no INSERT path; one global lock string; migration 025's laptop seeds; `LINE_NAME` parsed by two screens. A second line today is a second full deployment sharing one database that one `cutover` would wipe. |
| MEDIUM | **Capabilities that have never touched a real target** | The PDAS write path; `epoch:accept` with provenance `ifl_live`; NSSM services (the only supervision that has actually run is the ngrok watchdog); the wall display on a TV; a from-zero `db:migrate`; a clean-checkout build on another machine; a post-epoch restore; a login without full read on PDAS. The integration gates are tested only against `vi.mock`. TLS termination *was* verified (19 Aug). |
| MEDIUM | **`DEPLOY.md` says a migration re-run is a no-op; 026 is not re-runnable; nothing seeds `schema_migration`** | The populated-database upgrade path exists only in the untracked epoch memo, and the backfill script hard-codes this machine's ids. No `CREATE DATABASE/LOGIN/USER` for `sms`/`sms_app` anywhere. |
| MEDIUM | **Delivery hygiene turns every "tested" claim into an honour-system assertion** | No CI; root typecheck excludes web; no root build; stub `dev`; no Node pin; 14 of 28 test files untracked, 8 on the remote; backup unscheduled. Secrets hygiene is the one area verified clean. |
| LOW | **The operator-facing half of the source-reset procedure is untested at any level** | No test references `epoch.ts` (CLI) or `cutover.ts`; the committed `DEPLOY.md` cutover section is the retracted procedure. |
| LOW | **Development residue would leak into a handover** | `q.mjs` (absolute path, not ignored), `sync-trace.mjs`, the committed watchdog with URL and path, and `.env` on disk with `LIVE_ALLOW_AS_OF=true` / `COOKIE_SECURE=false` (both must be reversed for the plant; the latter fails silently if set wrongly). |

---

## 17. Defects verified in this analysis that appear in no existing project register

These were confirmed in code by the verification passes and are not in `AUDIT-FINDINGS.md` or any other project record. Together with the audit's own findings they form the starting point for the living defect register §14 calls for. **C** = committed at HEAD; **W** = working tree only.

| Area | Defect | Where |
|---|---|---|
| UI/health | DQ findings count always "none" — severity compared in the wrong case against a CHECK-constrained set | `Setup.tsx:62` vs migration 009 — **C** |
| Rejects | Every label rename nulls `is_pass`; `severity` has zero references | `rejects.ts:101`, `api.ts:272` — C |
| Rejects | Register joins `reject_code` on nullable equality; weight-reject labels invisible in register/CSV | `register.ts:219-223` — C |
| Rejects | Reject sheet prints "Passed," resolves line-wide product, eyebrow "Cone," product block on weightless row | `ReadingSheet.tsx:110,118,66,99`; `REJECT_COLS` — W |
| Rejects | Reasons fixed to 14-day window, not selected period; `/api/rejects`, `/api/reject-spc` accept no `shift`/`tsTo`, no range cap → Line and Rejects disagree on the default period; replay ignored | `Rejects.tsx`, `app.ts:689-694,840-851` — C |
| Rejects | No `GET /api/reject-codes`; codes outside the trailing window unnameable; trend draws no control limits; no error state on fetches; "Record" shows two different ids | `Rejects.tsx`, `app.ts` — C/W |
| Products | `z.coerce.boolean()` turns `"false"` into `true` on the active routes | `app.ts:1061,1104` — W |
| Products | TOCTOU concurrency check; cached rejected connect promise; post-proc bookkeeping inside try (misleading audit); route zod rejections and short-reason retire unaudited; `MaterialDesc3` dropped; float vs DECIMAL `===`; write bounds coupled to the DQ rule | `pdasWrite.ts`, `seedProducts.ts:122-126` — W |
| Products | `spc.ts` limits and Cp/Cpk from the mirror; `weights.ts` stale attribution sentence and 1950 fallback; station table line-wide target | `spc.ts:159-197`, `weights.ts`, `weightStations.ts:88-95` — C |
| Sync | App pool orphaned per tick on IFL connect failure | `sync-worker/index.ts:15-17` — C |
| Sync | Non-numeric `SYNC_INTERVAL_SECONDS` → `NaN` → zero-delay loop | `sync-worker/index.ts:37` — C |
| Sync | `seedProducts` before the gate, unguarded; O(n) MERGEs per pass; halts write no `sync_run` row | `pipeline.ts:21-22`, `runner.ts:44-72` — C/W |
| Sync | Only the row read is retried; `rebuild.ts:35/:69` `'ifl_sql'` incl. DELETE | `runner.ts:82`, `rebuild.ts` — C |
| Model | `events.ts` dead contract; `TRANSFORM_VERSION` never bumped; `ingest_run_id` orphan; `subject_ref` never written; attribution write-only; shift-rule 1/5 live; epoch label not on the sheet; rebuild gate is a non-empty string; migration 025 seeds laptop tombstones; backfill script hard-codes this machine | various — C/W |
| Calibration | StationSheet compares production-day string to UTC without plant offset; Nelson centerline includes pre-adjustment days; line-wide adjustments unshown; per-station SD unrendered; `/api/calibration`, `/api/weights` orphaned | `StationSheet.tsx:230`, `calibration.ts`, `api.ts` — C |
| Screens | `Weight.tsx` no `tsTo`; `Wall.tsx` `from=undefined` on first render; Readings Print has no header; three orphaned `api.ts` wrappers; `format.ts` and `lib/strings.ts` dead; two `@fontsource` deps unused; HEAD `live.ts` samples the older generation for ~68 days | various — C |
| Ops/CLI | `cutover` and `epoch:purge` unlocked, no backup or running-worker check, string-built id lists; `epoch:accept` non-transactional; server string is identity; `station` survives cutover while epoch tombstones do not; orphaned `'running'` rows never reconciled; no INSERT station path; no DQ for station outside roster | `cutover.ts`, `epoch.ts`, `summary.ts:50-56`, `admin.ts`, `dq.ts` — W/C |
| Ops/docs | `DEPLOY.md:168-173` false no-op claim; 026 not re-runnable; no `schema_migration` seeding; duplicated step 8; `?v=` vs `?s=`; committed cutover section is the retracted procedure; committed Report sentence "IFL has been asked" is false; committed backup script fails on defaults, `-Server` dev port, password on cmdline; NSSM no `AppStderr` for API, no `DependOnService`; API exits 1 if DB not up at boot; §Operations references a deleted screen | `DEPLOY.md`, `words.ts:306` (HEAD), `backup-appdb.ps1` — C |
| Security | Audit fire-and-forget; `sms_app` has DDL so can mutate `audit_log`; limiter map never pruned; `TtlCache` sweep on re-read only; `auth.ts:238-241` claims a router-walk test that does not exist; `/api/operations` ungated server-side; rank-1 cannot see the product list; `config.ts:139` claims a Setup element that is absent | various — C/W |
| Docs | Three table counts (21/25/23 vs 31); `CAPABILITIES.md` `sack1`/`pack1` inverted twice, `:785` claims a built basis toggle, `:260` overclaims register filters; `SPEC.md:250` phantom PLC test, header "no code written yet"; `README.md:14,42`; `CLAUDE.md:30`; `nelson.ts:14-20` and `CAPABILITIES:546` describe a deleted UI statement; `CLAUDE.md` describes uncommitted code as done | — C |
| Build | Root typecheck excludes web; no root build; stub `dev`; no `engines`/`.nvmrc`; no `.gitattributes`; `q.mjs` not ignored; `plantClock.ts` untracked but imported by 11 modified files | — |
| Data path | Reader refuses the July shape; epoch 1 seeded closed; `accept` closes the live generation; ordinal `MAX+1` breaks chronology — the Jul–Aug window cannot be loaded as-is | `iflTables.ts:22-26`, `epoch.ts:104-170`, migration 025 — W |

---

## 18. Consolidated clarifications to put to IFL

Deduplicated across phases. Items marked **new** did not appear in the existing 70-question draft (`IFL-QUESTIONS-STATUS.md`) and were surfaced by this roadmap exercise.

**Machines and stations**
- Confirm 14 machines in words (Q1); are machine and station one thing (Q3); how many sack-packing machines (Q4); floor names for the 14 positions (Q11).
- **new** What does "adding a second machine" mean — a 15th winding position, a packing machine, or a machine on another line?
- **new** Are Plant and Unit reporting dimensions or display labels? Second line in the same database or a separate installation?

**Products and PDAS**
- Written authority for writes through `CreateMaterial`/`SetMaterialStatusActive` plus one single-row `UPDATE dbo.Materials` and one `nhs_events` row, `DATA_TP1U2` unchanged (Q18); who is authorised (Q19/40/41); does the PLC read limits live or at selection; is 1,960 g with or without the tube.
- **new** Which `MaterialDesc` fields matter (Desc3 carries real data); does "material" mean the PDAS record; confirm retire-plus-change-limits as the model; why does `MaterialId` jump 21→1021; which copy is "approved copy data"; is a local writer against SEP07 acceptable as offline proof; does maintaining PDAS through SMS satisfy "update product details on machines" given PLC integration is out of scope.
- **new** Should SMS hold its own product configuration, or remain a PDAS mirror with optional write-back?

**Sacks and stock**
- Q28–32 and Q43 in full (the drafted message); is the sack weight gross including the sack, is 0.5 kg the tare (Q24); confirm the timestamp is insert time (Q25); is the acquisition delay like the cones'.
- **new** Does "machine" for a sack mean the winders or the packing scale? Is a "receipt" each weighed sack or empty sacks arriving? Unit — sacks, kg, both, per product/type? What event removes a sack and what record exists? Is operator entry "defensible," and with a second approver? May the cone window enter arithmetic? Should a later basis change re-interpret history? Opening balance source? Is a second sack scale foreseen?
- **new** Is "Sack Packing" a separate database or server, or the same instance as the cone data; if it will split, when and with the same shapes?

**Shifts, timing, live data**
- Fix vs reproduce the plant's shift (Q7); latency expectation and whether a delay is acceptable (Q44/45).
- **new** Are 06/14/22 fixed across IFL or per-line? Derived shift replaces or sits beside the plant's on reports? Day = production day (06:00–06:00) or calendar date? Fixed 14-day trend or stretch to period? Present the two generations as continuous or state the boundary?

**Rejects**
- Every code's meaning (Q12); who decides limits (Q10).
- **new** Are the two inspection codes one reason or two? Confirm the denominator (rejects ÷ everything inspected). Label retroactive or effective-dated? Should a weight reject carry a code at all; `is_pass`/`severity` semantics? Which judgement is the "actual" reject outcome — the scale's bit or the product tolerance?

**Weights and classification**
- Gross/net basis for cones and sacks (Q4/5/24).
- **new** How should the five states be derived and which governs on disagreement? Per-machine or line-wide limits? Pre-5-Aug readings as "unknown," never back-filled? Is SMS's limits history acceptable as the record, with "no later than" bootstraps? Which population for acceptance statistics; exclude the 2200–2354 g population from averages?

**Reports and KPIs**
- Q33–37 in full.
- **new** Is a separate Live screen expected? Sack-management scope? Product report wanted despite Q1? Calibration report content? KPI set and targets for the summary and Wall; period-over-period comparison? May reports print partial coverage with the coverage sentence? Excel/PDF/email on an air-gapped host?

**Roles, security, operations**
- Who uses it and what each may do (Q38–43); AD/SSO vs local (Q18 original numbering).
- **new** Named people or titles per write action; password and session policy; which events must be audited; does "audit integrity" mean actor-recorded or tamper-evident; who operates the runbook and on what machine; backup regime; retention of raw/canonical against the 10 GB cap; does IFL delete within tables or only drop-and-recreate; TLS and an internal CA; alerting on sync stop or backup failure; is the 18-minute delay the definition of "current"; who acts on a worker halt — console command or button; a plant log standard; should `sms verify` run on a schedule.

**Data, history, access**
- The 10 Jul – 5 Aug data (Q56); how much history and backups (Q51–55/57); `db_datareader` on both live databases (Q58/59).
- **new** Are further rebuilds expected, with advance notice? How long should the archive be kept? Which artefact is the deliverable of record — the remote or the working machine? Should the baseline include the PDAS write path disabled; remove or keep the two test-data rows; is a database snapshot expected alongside the code?

**Calibration and AI**
- What "recommend calibration" means concretely, recommendation vs automatic, who approves (Q46–48); is "AI" contractual.
- **new** Does an observation-plus-action sentence satisfy "recommended adjustment"? Approve the Nelson rule set and day-level application? Where is the median wanted? Confirm history is built forward from go-live and what "before/after performance" means? Accept 6–12 months accruing post-go-live? Phase 10 cones only? Confirm advisory-only.

**Hardware, site, acceptance**
- Server/PC, location, floor display, UPS, network reach, who supplies hardware (Q65–70); device and Urdu.
- **new** Is the sidecar what "historian" means? Which workflows are "critical" for UI acceptance? Where is FAT held, what is the SAT evidence, who signs? Manual language and template? Formal change approval after go-live for PDAS-write or source-connection changes? Expected concurrent users (does the wall count)? Peak rate and number of lines for performance tests?

---

## 19. Method and limits

- Twelve assessment agents each read the code, migrations and tests for one phase and returned a structured object; twelve verifier agents each attacked one assessment by opening the cited files and re-running its greps, instructed to refute over-crediting. Three cross-cutting agents then read all twenty-four results plus the repository. Never more than three agents ran concurrently.
- All work was read-only. No test suite was executed; the 266/266 figure is a document claim (`SEPT-2026-BUILD-PLAN.md:252`) corroborated by static arithmetic on the current files. No database was written; the Phase 9 data volumes come from read-only SELECTs through the repository's own query runner against the local app database only.
- `PROJECT_TECHNICAL_HISTORY.md` and `IFL-QUESTIONS-STATUS.md` were used as leads only; every status cites code, a grep, git, or a primary project document.
- Where the assessor and verifier disagreed, the verifier's corrected finding is what appears. In every such case the correction ran in the conservative direction.
- Confidence is high on what the code does and does not do. It is medium on Phases 3, 7 and 12–13, where a database-state or execution check would have been needed to go further under the read-only rule.
