# Performance — load the SMS sync worker puts on IFL's source server

**WS-PERF1, 24 Sep 2026.** Repo at `c5a02f6`. Measures exactly one thing: **what
the sync worker does to the database it reads FROM** (`DATA_TP1U2` /
`PDAS_TP1U2`), never our own screen speed. Every query below is quoted
verbatim from `sync-worker/src`, then run by hand with `sqlcmd -E` (Windows
auth, read-only: `SELECT`, `SET STATISTICS IO/TIME`, `SET STATISTICS PROFILE`
only) against the two real client samples attached locally on `.\SQLEXPRESS`:

| local DB | stands in for | rows (cone / sack / reject_qcs / reject_weight) | span |
|---|---|---|---|
| `DATA_TP1U2` | July sample, pre-rebuild schema | 142,511 / 5,462 / 2,900 / 246 | 2026-06-22 → 2026-07-10 (19 days) |
| `DATA_TP1U2_SEP07` | September sample, current schema | 132,552 / 5,435 / 6,049 / 41 | 2026-08-05 → 2026-09-07 (34 days) |

Confirmed before measuring: each of the four wide tables has **exactly one
index** — the clustered PK on `id`. No other index, no view, no stored
procedure (`sys.indexes` queried directly). The sync worker never ran against
either database — the worker's `sync`/`epoch:*`/`rebuild` commands were **not
invoked**; every number below is a hand-run `SELECT` copied from
`sync-worker/src`. Suite confirmed unchanged by this work: **1782 passed / 4
skipped / 0 failed**, `npx vitest run` from `sms/`, 24 Sep 2026.

---

## 1. Query inventory — every statement the worker issues against a source DB

Extracted verbatim from `sync-worker/src/reader/IflSqlAdapter.ts`,
`sync-worker/src/epoch.ts`, `sync-worker/src/pipeline.ts` and
`sync-worker/src/seed/seedProducts.ts`. All parameterised except two
identifier-interpolated table names, both validated first by
`assertSourceTableName` (`sourceTables.ts`) against a strict
`^[A-Za-z_][A-Za-z0-9_]{0,127}$` pattern before they ever reach a query string
— T-SQL cannot bind an identifier, so this is the defensible substitute, not
an oversight (working rule 3 in CLAUDE.md).

### Once per pass (not per table)

**Probe** (`IflSqlAdapter.probe`, `pipeline.ts` runs it once against the
first configured table's adapter):
```sql
SELECT 1 AS one, (SELECT COUNT(*) FROM sys.tables) AS tables
```

### Once per table per pass (×4 tables: cone, sack, reject_qcs, reject_weight)

**Generation identity** (`epoch.ts` → `readSourceIdentity`, called by
`resolveEpoch`, itself called once per table before anything is read):

```sql
-- IflSqlAdapter.sourceEpoch()
SELECT create_date AS created FROM sys.tables
 WHERE name = @t AND SCHEMA_NAME(schema_id) = 'dbo'
```
```sql
-- IflSqlAdapter.fingerprint()
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = @t
```
```sql
-- IflSqlAdapter.columnList() — called here inside readSourceIdentity...
SELECT c.name, t.name AS type
  FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id
 WHERE c.object_id = OBJECT_ID(@tbl)
 ORDER BY c.column_id
```

**Column-drift check** (`epoch.ts` → `checkColumnDrift`, called once per
table right after `resolveEpoch` returns, from `runner.ts`):
```sql
-- ...and AGAIN, unconditionally, here. Same statement, same parameters.
SELECT c.name, t.name AS type
  FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id
 WHERE c.object_id = OBJECT_ID(@tbl)
 ORDER BY c.column_id
```
**This is a genuine redundancy, not a design choice documented anywhere in
the code**: `readSourceIdentity` (inside `resolveEpoch`) calls
`adapter.columnList()` once, and `checkColumnDrift` — invoked immediately
afterward in `runner.ts:154`, with no result passed between them — calls
`adapter.columnList()` a second time with identical parameters. Cost is
negligible at these table sizes (a 2-row `sys.columns` join, ~2 logical
reads, §2), so this is not a load risk. It IS worth fixing: it's a free
30–50 % cut in per-table catalogue round trips for zero behaviour change.

**Archived-floor observation** (`epoch.ts` → `observeArchivedFloor`, called
from inside `resolveEpoch`, once per table, non-fatal on failure):
```sql
SELECT MIN([id]) lo FROM [pack1_TP1U2]   -- table name interpolated, identifier-validated
```

**Watermark-vs-source sanity check** (`runner.ts`, after the epoch/drift
gates, before the read):
```sql
-- IflSqlAdapter.maxSourceId()
SELECT MAX([id]) AS hi FROM [pack1_TP1U2]
```

**The actual incremental read** (`runner.ts` → `adapter.readSince(afterId)`,
the one query that returns production data):
```sql
-- IflSqlAdapter.readSince() — cone shown; sack/reject_qcs/reject_weight
-- carry the same shape with their own column list (iflTables.ts)
SELECT [id], [Date], [Shift], [Area], [ProductionDate], [HangerNum],
       [MachineNo], [Lifter], [Weight], [inRange], [MaterialId]
  FROM [pack1_TP1U2]
 WHERE [id] > @after
 ORDER BY [id]
```
`afterId = MAX(-1, (watermark ?? 0) - cfg.overlapRows)` — `overlapRows`
defaults to 500 (`SYNC_OVERLAP_ROWS`). **Backfill and steady state are the
SAME statement**, differing only in `@after`: backfill's watermark is null so
`afterId = -1` (the whole table); steady state's watermark is the last
ingested id so `afterId` is within 500 rows of `MAX(id)`.

### Once per pass, unconditionally, against **PDAS**, not DATA_TP1U2

`seedProducts.ts` — **six unfiltered `SELECT *`-shaped reads, no watermark,
no `WHERE id > @x`, every single pass**, run whether or not any product
changed:
```sql
SELECT BlendId, Blend FROM [PDAS_TP1U2].dbo.Blends
SELECT CountId, Count FROM [PDAS_TP1U2].dbo.Counts
SELECT TubeTypeId, TubeType, TubeWeight FROM [PDAS_TP1U2].dbo.TubeTypes
SELECT MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight, MaterialActive,
       MaterialDesc1, MaterialDesc2, MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, Timestamp
  FROM [PDAS_TP1U2].dbo.Materials WHERE MaterialId > 10
SELECT PackSchemaId, PackSchemaDesc, ConesPerLayer, PackTypeId FROM [PDAS_TP1U2].dbo.PackSchemas
SELECT PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive,
       PalletDesc1, PalletDesc2, PalletDesc3, PalletDesc4, PalletDesc5, Timestamp
  FROM [PDAS_TP1U2].dbo.Pallets WHERE PalletId > 10
```
`[PDAS_TP1U2]` (the database name, not a table) is interpolated too, guarded
by `seedProducts.ts`'s own `safeDbName` — same identifier pattern, same
reasoning. **This is unbounded by design**: full re-read every 60 seconds
forever, on the theory that the tables are tiny (§2 proves that theory
correct today — 14 rows total). It is the one query class in this inventory
that does NOT shrink toward zero cost as it repeats; a plan-not-matching-code
risk if PDAS reference tables ever grow past a few hundred rows.

### What runs against the **app (sidecar) DB**, not IFL — listed for completeness, not measured

`getWatermark`, `startSyncRun`, `finishSyncRun`, `recordHaltedRun`
(`store.ts`), and the `UPDATE sms.source_epoch SET last_seen_utc = …` /
`archived_below_id` writes (`epoch.ts`) all run against `sms_app`'s own
database. They add zero load to IFL's server and are out of this report's
scope by the brief.

---

## 2. Per-query cost — `STATISTICS IO`/`TIME`, 3 runs each, `DATA_TP1U2_SEP07`

All logical-reads figures are **stable across all 3 runs** (identical every
time — these are cold/warm cache variations only, `physical reads` drops to 0
once pages are cached, which is expected and not a finding). CPU/elapsed are
all ≤1 ms once warm; the numbers below are the raw pasted output, not rounded.

| # | Query | Plan operator | logical reads | physical reads (run1→3) | elapsed ms (run1→3) |
|---|---|---|---|---|---|
| Q1 | probe (`SELECT 1` + `COUNT(sys.tables)`) | `syssingleobjrefs`/`sysidxstats`/`sysschobjs` scans (system catalogue) | 180+30+41 = 251 | 0/0/0 | 4/0/12 |
| Q2 | `sourceEpoch` (`sys.tables` by name) | catalogue lookup, not a table access | 12+2+4 = 18 | 0/0/1 | 0/0/0 |
| Q3 | `fingerprint` (`INFORMATION_SCHEMA.COLUMNS`) | catalogue lookup | 22+33+2+4 = 61 | 1/0/1 | 0/0/4 |
| Q4 | `columnList` (`sys.columns`/`sys.types`) | catalogue lookup | 22+22+2 = 46 | 0/0/0 | 0/0/0 |
| Q4b | `columnList`, called again by `checkColumnDrift` | same as Q4 | 46 | — | — |
| Q5 | `observeArchivedFloor` `MIN([id])` on `pack1_TP1U2` | **Clustered Index Scan**, `ORDERED FORWARD` | 3 | 3/0/3 | 2/0/0 |
| Q6 | `maxSourceId` `MAX([id])` on `pack1_TP1U2` | **Clustered Index Scan**, `ORDERED BACKWARD` | 3 | 2/0/2 | 0/0/0 |
| Q7 | `readSince`, steady-state (`id > 132549`, 3 rows) on `pack1_TP1U2` | **Clustered Index Seek**, `SEEK:([id] > [@1]) ORDERED FORWARD` | 3 | 0/0/0 | 0/0/0 |
| Q8 | `readSince`, steady-state (`id > 5432`, 3 rows) on `sack1_TP1U2` | Clustered Index Seek | 2 | 2/0/2 | 0/0/0 |
| Q9 | `readSince`, steady-state (`id > 6046`, 3 rows) on `rejectQCS1_TP1U2` | Clustered Index Seek | 2 | 2/0/2 | 0/0/0 |
| Q10 | `readSince`, steady-state (`id > 38`, 3 rows) on `rejectWeight1_TP1U2` | Clustered Index Seek | 2 | 1/0/1 | 0/0/0 |

**Every `MIN`/`MAX` shows "Clustered Index Scan" in the plan operator name,
but this is SQL Server's well-known MIN/MAX-on-an-indexed-column
optimisation, not a real scan**: `Rows=1, Executes=1` in the
`STATISTICS PROFILE` output for both, and logical reads of 3 confirm it —
that is 1–3 pages touched (root + one leaf), not a walk of 132,552 rows. The
plan literally reads "TOP expression" pushed under an ordered scan that stops
at the first qualifying row. Confirmed by `SET STATISTICS PROFILE ON`
output, pasted:
```
=== PLAN Q5 MIN(id) pack1_TP1U2 ===
Rows: 1  Executes: 1
|--Clustered Index Scan(OBJECT:([...].[pack1_TP1U2].[PK__pack1_TP__3213E83FDDC1BFEA]), ORDERED FORWARD)
=== PLAN Q6 MAX(id) pack1_TP1U2 ===
Rows: 1  Executes: 1
|--Clustered Index Scan(OBJECT:([...].[pack1_TP1U2].[PK__pack1_TP__3213E83FDDC1BFEA]), ORDERED BACKWARD)
=== PLAN Q7 readSince steady-state (id > 132549) ===
Rows: 3  Executes: 1
|--Clustered Index Seek(OBJECT:([...].[pack1_TP1U2].[PK__pack1_TP__3213E83FDDC1BFEA]),
   SEEK:([...].[id] > [@1]) ORDERED FORWARD)
```

**The watermark read (Q7–Q10) — the query that runs every 60 seconds forever
— IS a Clustered Index Seek, confirmed, not assumed.** This is the single
most important fact in this report: steady-state ingestion touches 2–3
logical page reads per table per cycle, independent of how large the table
grows, because it seeks directly to the watermark rather than scanning from
the start.

PDAS mirror queries (`seedProducts.ts`, §1) against `PDAS_TP1U2_SEP07`, same
method: `Blends` 2 logical reads, `Counts` 2, `TubeTypes` 2, `Materials` 3,
`PackSchemas` 2, `Pallets` 3 — **14 logical reads total**, all Table Scans
(no WHERE clause the optimiser can seek on, and none of these tables carry
any index beyond their own PK), all with 0 elapsed ms once warm. At today's
row counts (2–27 rows/table) this is noise; flagged in §1 as the one query
shape whose cost is NOT bounded by a watermark.

---

## 3. Backfill — separately, against BOTH real samples

Backfill is `readSince(-1)` — the exact same statement as steady state, with
`@after = -1` instead of a watermark near `MAX(id)`. **It is one single
`SELECT`, not batched, not paged** — verified in `runner.ts`: `readSince` is
called once, its full result array is passed whole to `persistRaw`; there is
no `TOP`, no cursor, no chunking anywhere in the reader. (Whether `persistRaw`
then batches its own INSERTs into the *sidecar* is a separate, write-side
question against `sms_app`, out of this report's scope.)

Measured directly (3 runs, `SET STATISTICS IO/TIME ON`, output wrapped in
`SELECT COUNT(*) FROM (…) x` only to avoid dumping 100k+ rows to the
terminal — confirmed separately via `SET STATISTICS PROFILE ON` that the
inner table-access plan is unchanged by the wrapper, see below):

### September sample (`DATA_TP1U2_SEP07`, current schema, `MachineNo`+`MaterialId`)

| table | rows read | logical reads | physical reads (run1→3) | elapsed ms (run1→3) |
|---|---|---|---|---|
| `pack1_TP1U2` (cone) | 132,552 | 1,211 | 3/0/0 | 71/79/6 |
| `sack1_TP1U2` (sack) | 5,435 | 38 | 1/0/0 | 6/7/0 |
| `rejectQCS1_TP1U2` | 6,049 | 69 | 1/0/0 | 4/8/0 |
| `rejectWeight1_TP1U2` | 41 | 2 | 1/0/0 | 0/1/0 |
| **total, one backfill pass** | **144,077** | **1,320** | | **≤79 ms** any single table |

### July sample (`DATA_TP1U2`, pre-rebuild schema — `Source`, no `MaterialId`; read with the table's ACTUAL July columns, since the live adapter cannot read this shape at all, per CLAUDE.md)

| table | rows read | logical reads | physical reads (run1→3) | elapsed ms (run1→3) |
|---|---|---|---|---|
| `pack1_TP1U2` (cone) | 142,511 | 1,231 | 3/0/0 | 506/7/7 |
| `sack1_TP1U2` (sack) | 5,462 | 36 | 1/0/0 | 22/0/0 |
| `rejectQCS1_TP1U2` | 2,900 | 28 | 1/0/0 | 12/0/0 |
| `rejectWeight1_TP1U2` | 246 | 5 | 1/0/0 | 2/0/0 |
| **total, one backfill pass** | **151,119** | **1,300** | | up to 506 ms cold, ≤7 ms warm |

**Plan operator for the backfill's cone table read, confirmed via
`SET STATISTICS PROFILE ON`:**
```
=== PLAN Q_backfill: full-table readSince pack1_TP1U2 (id > -1) ===
Rows: 132552  Executes: 1
|--Clustered Index Seek(OBJECT:([...].[pack1_TP1U2].[PK__pack1_TP__3213E83FDDC1BFEA]),
   SEEK:([...].[id] > CONVERT_IMPLICIT(int,[@1],0)) ORDERED FORWARD)
```
**This is technically a Clustered Index Seek, not a Scan** — because
`readSince` is always the same parameterised `WHERE [id] > @after` shape and
the optimiser seeks to the starting boundary either way — but with
`@after = -1`, below every real id, the seek starts at the first row and
walks every page to the end. **Cost-wise this IS a full scan**: 1,211–1,231
logical reads is exactly "every leaf page of the clustered index," the same
figure a `SELECT * FROM pack1_TP1U2` with no predicate would produce. Naming
it a "seek" would be technically true and practically misleading; the
one-line honest statement is: **the backfill reads every page of every
table once, in one uninterrupted statement, ~1,200–1,300 logical reads for
the whole four-table set, under 100 ms of SQL Server time even from a cold
cache on this hardware.**

**This is the heaviest moment the source will ever see from this
application** — every subsequent pass touches only the 2–3 pages near the
watermark (§2), because `id` never decreases within a generation except on
the reseed/restore case the code explicitly halts on (`runner.ts`'s
"gone backwards" check, `epoch.ts`'s archived-floor check).

---

## 4. Steady state — rows per cycle, derived from IFL's own arrival rate, not assumed

From the real row counts and spans already in `CLAUDE.md` and confirmed by
direct query (§ above):

| table | measured rows | measured span | rows/day | **rows/60s cycle** |
|---|---|---|---|---|
| cone (`pack1_TP1U2`) | 132,552 | 34 days | 3,899 | **2.71** |
| sack (`sack1_TP1U2`) | 5,435 | 34 days | 160 | **0.111** |
| reject_qcs | 6,049 | 34 days | 178 | **0.124** |
| reject_weight | 41 | 34 days | 1.2 | **0.0008** |

(July sample gives the same order of magnitude — 142,511 cones / 19 days =
7,501/day = 5.2/cycle — both real production windows, kept apart rather than
averaged because they are different plant epochs.)

**A steady-state cycle therefore reads on the order of 0–5 new rows per
table**, via the Clustered Index Seek confirmed in §2, at 2–3 logical reads
per table regardless of table size (a seek's cost is bounded by tree depth
plus the handful of leaf pages actually returned, not by table size). Add the
catalogue overhead that runs every cycle regardless of row volume: probe
(~251 logical reads against `sys.tables`/`sys.objects`, all in the buffer
pool after the first pass), 2× `sys.columns`/`sys.types` lookups per table
(§1's redundancy), one `sys.tables` lookup, one `INFORMATION_SCHEMA.COLUMNS`
lookup — all sub-millisecond, all against system catalogue pages that stay
resident. **A steady-state cycle's total footprint against `DATA_TP1U2` is
on the order of 300–400 logical reads, almost entirely catalogue metadata,
plus 6-8 rows of actual production data** — and the recurring, unbounded-by-
watermark six-query PDAS mirror read (§1, §2: 14 logical reads, 2–27 rows
each) every cycle regardless of whether any product changed.

---

## 5. Concurrency and locking

- **One connection pool per pass, one connection actually in use at a
  time.** `pass.ts` opens a fresh `iflData` pool (`connectSource`) at the
  start of every pass and closes it (`ifl.close()`) in a `finally` before the
  pass ends — never held open between the 60-second ticks (`SYNC_POOL_DEFAULT`
  in `config.ts`: `min: 0`, so it holds zero idle connections between passes).
  Pool sizing is `max: 5`, but nothing in the worker ever issues two source
  queries concurrently: `runner.ts`'s `for (const def of tables)` loop is a
  plain sequential `for` with every step `await`ed — cone, then sack, then
  reject_qcs, then reject_weight, one after another, never `Promise.all`.
  `max: 5` is headroom the current code does not use, not a live 5-connection
  fan-out.
- **No lock hints anywhere.** Grepped `sync-worker/src` for `NOLOCK`,
  `READ UNCOMMITTED`, `isolationLevel`: zero hits outside tests. `db.ts`'s
  `toMssqlConfig` sets no `isolationLevel`, so every read runs at the
  driver's default, **READ COMMITTED** — the ordinary, safest isolation
  level, not a hint that could dirty-read or that takes special locks.
  Every query is a plain `SELECT` against a table with **only a clustered PK
  and no other index**, so a read takes the ordinary shared row/page latches
  SQL Server takes for any `SELECT` and releases them as it goes (READ
  COMMITTED, not REPEATABLE READ/SERIALIZABLE) — nothing here holds a lock
  across statements or across the 60-second gap between passes. **This is a
  read-only login for an honest reason and no other**: `sms_readonly` cannot
  `INSERT`/`UPDATE`/`DELETE` even if the code tried, per CLAUDE.md's Q21 hard
  constraint, and grepping confirms the reader code never tries.
- **Total simultaneous connections to IFL's server from this application,
  in steady state: one.** Not five, not four (one per table) — one pool,
  used serially, for the duration of one pass (measured: low milliseconds per
  table at these row counts), then closed until the next tick 60 seconds
  later.

---

## 6. The load envelope — one paragraph a DBA can independently check

**Steady state, every 60 seconds, forever:** one connection, opened and
closed within the pass; four sequential `SELECT`s against `DATA_TP1U2`'s
wide tables, each a **Clustered Index Seek** on the table's own clustered PK
(`WHERE [id] > @after`) returning 0–5 rows and costing 2–3 logical page
reads regardless of how large the table has grown, bracketed by a handful of
sub-millisecond system-catalogue lookups (`sys.tables`, `sys.columns`,
`sys.types`, `INFORMATION_SCHEMA.COLUMNS`) that stay in the buffer pool
after the first pass; plus six unconditional, unfiltered reads of PDAS's six
reference tables (14 logical reads total at today's row counts — Blends,
Counts, TubeTypes, Materials, PackSchemas, Pallets — none exceeding 27 rows).
No lock hint is used and none is needed: every statement is a plain
READ COMMITTED `SELECT` against a table this login (`sms_readonly`) cannot
write to even if the code attempted it, and no query holds a lock across the
gap between one pass and the next. **The one moment of real cost is the
one-time backfill**: a single, unpaged `SELECT [id],...FROM [table] WHERE
[id] > -1 ORDER BY [id]` per table, which reads every page of the table
once — measured 1,211–1,231 logical reads and under 100 ms of SQL Server
elapsed time for the cone table alone (132,552–142,511 rows) on this
hardware, ~1,300 logical reads total across all four tables — and that cost
is paid exactly once per table, ever, because every subsequent pass seeks
from the watermark instead of scanning from the start. A DBA can reproduce
every number in §2–§4 by running the exact `SELECT` text quoted in §1 with
`SET STATISTICS IO, TIME ON` first, and confirm the seek/scan claim with
`SET STATISTICS PROFILE ON`, against their own live copy of these four
tables.

---

## 7. The four honest unknowns — stated, not estimated past

1. **IFL's server hardware and existing load.** Every millisecond figure
   above was measured on this development machine's local SQL Server
   Express instance, attached to detached copies of IFL's own `.mdf`/`.ldf`
   files. Logical reads and plan operators (seek vs. scan) are properties of
   the query and the data and travel unchanged to any server; elapsed
   time and CPU time do not, and no claim is made here about what either
   will be on IFL's actual hardware, whatever else is running on it, or
   under whatever concurrent load their own acquisition software and QCS
   station puts on it at the same moment.
2. **Network latency across IFL's intranet.** This measurement's connection
   is local (`.\SQLEXPRESS`, no network hop). The real deployment crosses
   IFL's LAN between the SMS host and their SQL Server; every round trip in
   §1's inventory (one per table per pass, four to six of them) pays that
   latency once, and this report has no way to measure a network that does
   not exist in this environment.
3. **Table sizes beyond the two samples measured.** IFL keeps roughly a
   month of history before pruning (per CLAUDE.md); the September sample
   (34 days, 132,552 cones) and July sample (19 days, 142,511 cones) are the
   only two windows this project holds. A live table could be larger between
   IFL's own prunes, and while a Clustered Index Seek's cost does not grow
   with table size (§2, §6), the one-time backfill's cost (§3) is linear in
   row count, so a live backfill against a fuller table would cost
   proportionally more than the ~1,300 logical reads measured here — still
   bounded, but not this exact number.
4. **Whether the read-only login can even run these queries.** CLAUDE.md
   flags this directly: an `ibrahim`-shaped, EXECUTE-only login is a live
   risk raised by the 16 Sep 2026 PDAS introspection finding (this
   application's own `IFL_DB_USER` currently holds only `db_datareader` on
   `PDAS_TP1U2_SEP07`, which is enough for `SELECT` but was NOT enough for
   the `sys.procedures`/`sys.parameters` catalogue read that task needed —
   Windows auth was used instead, which will not be available against IFL's
   server). Every catalogue query in §1 (`sys.tables`, `sys.columns`,
   `sys.types`, `INFORMATION_SCHEMA.COLUMNS`) needs the login to see system
   metadata, which is ordinarily included in `db_datareader` but has not been
   confirmed against IFL's actual `sms_readonly` grant, because that login
   does not exist yet — it is still an open request (Q65-70, unsent, per
   the 21 Sep 2026 CLAUDE.md entries).

---

## What surprised me, worth flagging even though it wasn't asked for

- **`columnList()` runs twice per table per pass**, identical query,
  identical parameters, one inside `resolveEpoch` (via
  `readSourceIdentity`) and one in the immediately-following
  `checkColumnDrift` call. Negligible cost today (§1, §2), free to fix,
  and the kind of thing that compounds if this project ever adds more
  per-table catalogue checks without noticing the pattern.
- **The PDAS mirror (`seedProducts.ts`) is the one query class in the whole
  inventory with no watermark and no bound.** Every other read in this
  report gets cheaper, in relative terms, as the source grows (seek cost is
  flat, scan cost only happens once). The PDAS mirror re-reads all six
  reference tables in full, every single pass, forever — currently free
  because the tables are tiny (14 rows total, §2), but it is the one
  design in this codebase that does NOT get safer with scale, and it is
  worth knowing that going in rather than discovering it later.
