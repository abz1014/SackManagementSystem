# CLAUDE.md — IFL Sack Management System (SMS)

## Project purpose

Build a **Sack Management System** web application for **Ibrahim Fibres Limited (IFL)**, reporting on sack and cone production from the TP1 Line 3 / Unit 2 yarn spinning line. Styled and architected to match our existing **Energy Management System (EMS)** app.

The plant runs Siemens S7-1500 PLCs that weigh every cone and every sack; readings land in SQL Server via a tag-acquisition layer. SMS surfaces that data as dashboards, reports, and (pending scope confirmation) CRUD screens.

**Primary source of truth for the data model: [`SCHEMA.md`](SCHEMA.md).** Read it before writing any query.

**Client-facing questionnaire: [`QUESTIONS.md`](../QUESTIONS.md)** — the 22 questions sent to IFL, written in plain language. *(Currently located at `Desktop/QUESTIONS.md`, one level above the project root.)* `SCHEMA.md` §4 holds the same items as technical open questions (OQ-1 … OQ-15); `QUESTIONS.md` is the shareable version. Keep the two in sync as answers arrive.

**Phase 1 scope and design: [`SPEC.md`](SPEC.md).**

**Phase 2 architecture — [`ARCHITECTURE.md`](ARCHITECTURE.md) — FROZEN BUILD CONTRACT (23 Jul 2026).** Raw→canonical layers, transform versioning, time-versioned attribution, reference-data tables, CDC-safe watermark (overlap window + schema fingerprint), DQ+Operations with severity, generalized+metadata API, CLI verify tool, retention/backup policy. Further architecture changes come from running-code evidence only. Build order: Models→Reader→Transform→CLI→Operations→API→**Dashboard (demo, step 7)**→analyses→Auth→Admin→Hardening.

## Current phase

**Phase 0 (Database Discovery) — COMPLETE.** → `SCHEMA.md`, `QUESTIONS.md`
**Phase 1 — COMPLETE (build steps 0–13 done & verified).** Full stack under `sms/`: sync-worker (IFL→raw→canonical, continuous self-healing loop) · CLI (sync/verify/summary/rebuild/user:create) · Express API (auth, RBAC, /production, /operations, /shift-analysis, /rejects, /weights, admin) · React web (Dashboard, Shift, Rejects, Weights, Admin, login, Current Product). 25 app tables, session-cookie auth (argon2), 17 tests, perf 11–15ms. Deployment: `DEPLOY.md`. All four blocked client questions (Q1/Q4-5/Q7/Q10) resolved or self-answering + one admin action from applying. **Awaiting IFL answers + go-live cutover (repoint `IFL_DB_SERVER`).**

### IFL answers — decisive points (23 Jul 2026)

- **Q1:** no product data in DB; **product-wise historical reporting not required.** App adds a **Current Product** selector (Process Engineer sets it), stored in the **app-owned DB**. → `NullAttribution` default for history; `ManualEntryAttribution` forward-only.
- **Q21 (HARD):** **zero modifications to IFL's DB** — no schema, indexes, tables, procs, or data. Retires the "add indexes" option. All optimisation is app-side.
- **Q22:** **no PLC integration in scope.** Component B is now indefinitely deferred; `cone_id` column stays nullable but its PLC path is dormant. Q2 redirects cone traceability to `rejectWeight1_TP1U2.[Source]` (a station, not a unique id).
- **Q12:** dispatch **not required** (confirmed out).
- **Q19 vs Q21 vs Q1 → open decision D0:** IFL says "connect directly" (Q19) but forbids DB indexes (Q21), while Q1 forces an app-owned writable DB anyway. **Recommend sidecar sync (SPEC §1 Option B).** Needs user call.
- **Still blocking:** weights gross/net + units (Q4/Q5), reject-code meanings (Q10), shift fix-vs-reproduce (Q7). Shift boundaries confirmed 06/14/22 (Q8).
- **Still pending:** single vs multi-line (Q14), hosting (Q20) — both to be settled at the upcoming textile-team meeting.

### Revised phase plan (21 July 2026)

Commissioning is split by **component**, not just by activity. Phase 1 does **not** touch the PLCs.

| Component | Phase | Status |
|---|---|---|
| **A** — Read-only sync: IFL SQL Server → local sidecar DB | **1** | Specced |
| **B** — Direct S7-1500 PLC reader for `P1_ConeID` | **2 — DEFERRED** | **Stub + disabled flag only** |
| **C** — Web app, queries local sidecar DB only | **1** | Specced |

**Phase 1 = A + C.** **Stop for user approval between every phase.**

### 🚫 Phase 1 hard constraints

1. **Do not implement Component B.** No PLC reader logic. (Q22: PLC integration is out of scope entirely.)
2. **Do not add any PLC dependency** — no `snap7`, `python-snap7`, `S7NetPlus`, or equivalent, in any manifest.
3. **Do not write to IFL's databases, and do not alter them in any way** — no schema, **indexes**, tables, procs, or data (Q21, hard client constraint). Reads only. Writes (Current Product, users, notes) go to the **app-owned DB only**.
4. **Web app queries the app-owned DB** (sidecar). *Pending D0:* IFL's Q19 says "connect directly"; do not finalise the data-access path until D0 is decided.

### Phase 2 readiness — VERIFIED STATUS (audited 17 Aug 2026)

> **Read this section as a status report, not as a design intent.** Three of the
> five items below were previously written here as accomplished fact and were
> not true in the code. They were corrected only after an audit grepped for them
> and found nothing — after they had already been repeated to the customer-facing
> side of the project. **Anything in this file that claims a capability must be
> greppable in the code, or must say plainly that it is a plan.**
> Marked ✅ implemented / ⚠️ partial / ❌ designed only.

1. ✅ **IMPLEMENTED — `cone_id` column exists and is nullable** on `sms.cone_event`, alongside **`cone_id_source`** (provenance: `plc_direct` \| `sql_sync` \| null). Both null in Phase 1. Verified: `sms/db/migrations/003_cone_event.sql:36`.
2. ❌ **DESIGNED ONLY — ingestion is NOT adapter-based.** There is no `IngestionAdapter` interface anywhere in the codebase (zero hits in any `.ts`). `SPEC.md` §3 and `ARCHITECTURE.md` §10 describe an *intended* shape. In reality the runner news a concrete `IflSqlAdapter`, `transform.ts` bakes in `source_system: 'ifl_sql'`, and `persistRaw` is insert-only. Adding a second source is a refactor (~1.5 wk), not a drop-in. **Do not quote §3 as evidence of pluggability.**
3. ✅ **IMPLEMENTED — cross-source merge key** `(line_id, production_ts_utc_ms, hanger_num)` is on every row and enforced by a unique index. Verified: `UX_cone_merge` on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)`, `003_cone_event.sql:55`. See `SPEC.md` §3.2 for the DQ-2 collision caveat. *Caveat:* a `plc_direct` row arriving on an existing merge key would **violate** this index, not enrich the row — Phase 2 needs a merge-and-enrich upsert, not `UPDATE ... SET cone_id`.
4. ❌ **DESIGNED ONLY — there is no PLC stub and no test.** `PLC_READER_ENABLED` and the host/rack/slot keys appear **only** in `.env.example`; no TypeScript file reads them, nothing validates them, no stub class exists, and **no test asserts anything about them** (3 test files total: `appConfig`, `fingerprint`, `transform` — zero PLC references). What IS true, and is the only version safe to state externally: **no PLC library appears in any of the five package manifests.** That is a convention, enforced by review, not by a test. Describe this as *a documented, dependency-free re-entry point* — never as "PLC-ready" or "a stub".
5. ⚠️ **PARTIAL — `NullAttribution` is a comment, not an abstraction.** There is no `ProductAttributionStrategy` type. `transform.ts:97` hardcodes `attribution_method: 'none'` with `NullAttribution` in a trailing comment, and all 142,511 rows carry it. The *effect* (no product attribution) is correct and honest; the *swappability* is not built. `/api/production?product=` is wired and dead.

### Consequence of unanswered Q1

Phase 1 ships with `NullAttribution`: **no product-wise or lot-wise reporting.** All time/shift/station-wise reporting works. Do not fabricate product attribution to fill the gap.

## Working rules (apply to the whole project)

1. **Never hardcode credentials.** Connection details come from environment variables only, loaded from `.env`. `.env` is in `.gitignore`; commit a `.env.example` with placeholder values.
2. **Treat the client DB as production data.** Default to **read-only** queries. Do not issue `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER` — including adding indexes — without explicit user approval. (See OQ-14 and SCHEMA.md §5.9.)
3. **Parameterised queries only.** No string-concatenated SQL, ever.
4. **Ask before adding any dependency** or making an architectural decision not already agreed.
5. **Keep docs current.** Update `CLAUDE.md` and `SCHEMA.md` whenever a decision is made or understanding changes. Record answered open questions in `SCHEMA.md` (mark them RESOLVED with the answer and date) rather than deleting them.
6. **Flag ambiguity, don't guess.** If a column's meaning, unit, or semantics is unclear, add it to the open-questions list.
7. **Validate all inputs**; handle loading and error states in every UI slice.
8. After each vertical slice: **run it**, tell the user how to verify it, and commit with a clear message.

## Database

Two SQL Server databases, delivered as a detached `DATA` folder inside `SPS.adding` (a RAR archive despite the extension).

| DB | Role |
|---|---|
| `DATA_TP1U2` | PLC acquisition — sack/cone weights, rejects. **The main SMS source.** |
| `PDAS_TP1U2` | Product master (blends, counts, tube types, materials, pallets) + vendor label module. |

**Local analysis instance:** attached to `.\SQLEXPRESS` as `DATA_TP1U2` and `PDAS_TP1U2`.
**Production instance:** not yet known — see OQ-12.

### Connection approach

```
# .env  (never committed)
DB_SERVER=<plant-server>\<instance>
DB_NAME_DATA=DATA_TP1U2
DB_NAME_PDAS=PDAS_TP1U2
DB_USER=<read-only login>
DB_PASSWORD=<secret>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true   # plant-local server, self-signed cert
```

Request a **dedicated read-only SQL login** from IFL — do not use `sa` or the vendor app's account.

### Non-negotiable query rules (from SCHEMA.md)

- Query the **`*_TP1U2` wide tables** (`sack1_TP1U2`, `pack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`). **Never** the raw EAV tables (`sack1`, `pack1`, …) — 6× the rows, zero extra information.
- Event time for cone/reject data is **`ProductionDate`**, not `Date`. `Date` is insert time and lags by ~3.8 h on average.
- The stored `Shift` column is derived from insert time and is therefore **wrong for many rows**. Recompute from `ProductionDate` (pending OQ-4).
- Row key is **`id`**. Never `SackNum` (resets to 0) or `reference_value` (collides; 8.4 % of groups).
- Filter vendor seed data: `Materials.MaterialId > 10`, `Pallets.PalletId > 10`.
- Cast `Counts.Count` (nvarchar) to int before ordering.
- Exclude/flag outliers in aggregates: sacks < 40 kg, cones < 1500 g.

### Known constraints

- **`DATA_TP1U2` has no foreign keys** and no views or stored procedures — only triggers.
- **The two databases cannot be joined** — there is no product/lot key on the weighing data (OQ-1, blocking).
- **No dispatch data exists** anywhere (OQ-15). If dispatch is in scope it is a new module.
- Wide tables have only a clustered PK on `id`; date-range queries will scan. Index additions need client approval.
- Only **19 production days** of data (2026-06-22 → 2026-07-10). Two further
  dates appear in the raw data and are excluded as clock faults: 1969-12-31 and
  2026-06-21, holding 1 and 2 readings.

## Security

- **Do not reuse `DATA_TP1U2.Users`.** It holds 3 accounts with **plaintext passwords equal to the usernames** and no role column. Build fresh auth with hashed passwords (see OQ-8 re: AD/SSO vs app-local).
- Deployment target is the **plant intranet, no cloud dependency** — but still hash passwords, use parameterised queries, and scope the DB login to read-only.

## Tech stack — DECIDED (23 Jul 2026)

**React + Node + TypeScript, end to end.** Chosen for a **solo developer**: one language across frontend, API, and sync worker; shared types; minimal moving parts. EMS uses a different stack — we are deliberately *not* mirroring it (the brief's "mirror EMS" is superseded here; UI/UX freedom was the explicit goal).

| Decision | Choice | Notes |
|---|---|---|
| **D0** data access | **Sidecar sync** (SPEC §1 Option B) | App-owned DB required anyway (Q1). **Deployment plan (confirmed by user):** develop against the supplied copy, then integrate on IFL's live DB — under sidecar this is just **repointing the sync worker's source connection string** (copy → live); API/UI unchanged. Read-only, no load or index needs on the live server (honours Q21). |
| **D1** app/sidecar DB engine | **SQL Server Express** | Already on the plant PC; same driver as source; free. |
| **D2** stack | **React + Node + TypeScript** | Frontend: React + TypeScript. Backend API + Component A sync worker: Node + TypeScript. |
| **D3** sync cadence | 60 s incremental on `MAX(id)` watermark | Per table. |
| **D4** backfill | One-off full-history load, then incremental | |
| **D5** auth | Session cookies (not JWT) | Single-server intranet. AD vs app-local pending Q18. |

**Provisional library choices (ask before adding anything beyond these):**
- SQL Server driver: `mssql` (Tedious under the hood) — used by both the API and the sync worker.
- Sync worker supervised as a Windows Service via **NSSM** or `node-windows` (boots with machine, restarts on crash).
- Frontend build: Vite. API framework: TBD at first slice (Express vs Fastify) — will propose, not assume.

Target environment: SQL Server on the plant LAN, app on a local industrial PC/server, no cloud dependency.

Record further decisions here as they are made.

## Conventions

To be established in Phase 2 (naming, folder structure, error handling, commit message style). Mirror EMS patterns where they exist.

## Repository layout (current)

```
SPS.adding              # original client archive (RAR) — do not commit
extracted/              # unpacked MDF/LDF files — do not commit
schema_dump/            # raw introspection output — do not commit
introspect.sql          # metadata introspection script
dq.sql, dq2.sql         # data-quality profiling scripts
SCHEMA.md               # ← data model source of truth (IFL's DB)
SPEC.md                 # ← Phase 1 scope, sidecar schema, interfaces
CLAUDE.md               # ← this file
../QUESTIONS.md         # ← client questionnaire (moved to Desktop)
```

`.gitignore` must exclude `.env`, `SPS.adding`, `extracted/`, `schema_dump/`, and any `*.mdf` / `*.ldf`.
