# SMS — Source Epochs and the PDAS Write Path: Build Decision

**Status:** build contract. Supersedes the seven-item source-epoch proposal.
**Date:** 2026-09-11. **Author:** technical lead, from three critiques plus first-hand verification against `localhost,14330`.
**Note on inputs:** the third critique (PDAS write path) did not reach me intact — §5 rests on facts I verified myself in `PDAS_TP1U2_SEP07` this session, cited inline.

Everything marked **FACT** was run against the live databases or read in the file named. Everything marked **JUDGEMENT** is my call and can be argued with.

---

## 1. VERDICT

**Build the epoch design — with the changes in §2. Do not build the seven items as written.**

The concept is forced by the data, not chosen. **FACT:** `DATA_TP1U2_SEP07.dbo.pack1_TP1U2` holds 132,552 rows at `id` 1..132,552; `sms_raw.cone_raw` holds 204,076 rows at `src_id` 1..204,076. Every September source id already exists in our raw layer under a different physical cone. Nothing short of a per-generation scope makes both datasets addressable in one sidecar.

The seven items as written would ingest **zero** September rows, because items 3 and 5 change indexes and "the dedupe key" but not the three queries that actually dedupe. **FACT**, all three read this session:

- `sync-worker/src/raw/persistRaw.ts:49-57` — `SELECT src_id FROM <raw> WHERE line_id=@line AND src_id BETWEEN @lo AND @hi`, then `records.filter(r => !seen.has(...))`. A September batch spans 1..132,552, entirely inside the occupied range → `fresh` is empty → `written = 0`, watermark never moves, and the pass re-reads the whole source table every 60 s forever.
- `sync-worker/src/transform/persistCanonical.ts:26-33` — `WHERE source_system='ifl_sql' AND source_row_id >= @minId`; `minId` is 1 at an epoch boundary, so the bound is inert and `seen` holds all 204,076 existing ids.
- `sync-worker/src/transform/runTransform.ts:76-87` `onlyFresh` → same function, and `runTransform.ts:300` calls `setWatermark(..., maxRawId(raw))` on the zero-write path, so the dropped raw rows are marked transformed and never revisited. That loss is not recoverable without a full rebuild.

Three further items are wrong rather than incomplete: item 6 (auto-register) is unreachable in the case it cites and unsafe elsewhere (§2 D6); items 1 and 2 define the column two incompatible ways (§2 D3); and a chunked backfill inside a migration file cannot run — **FACT:** `scripts/migrate.mjs:59-86` wraps every file in one explicit transaction, and `:90-101` sets no `requestTimeout`, so node-mssql's 15 s default applies to each batch.

---

## 2. THE CORRECTED DESIGN

### 2.1 Decisions (where the critics split, the pick and the reason)

| # | Decision | Reason |
|---|---|---|
| **D1** | **Raw dedupe is scoped by epoch.** `persistRaw`'s probe gains `AND source_epoch = @epoch`; `UX_cone_raw_src` becomes `(line_id, source_epoch, src_id)` UNIQUE. | Unanimous. `src_id` is IFL's counter and repeats. |
| **D2** | **Canonical dedupe moves to `raw_id`, NOT to `(source_epoch, source_row_id)`.** Critics disagreed; **critic 2 wins.** | `raw_id` is our own IDENTITY, monotone across epochs, needs no epoch threaded into three call sites, keeps the `>= @minRawId` scan bound meaningful (a `source_row_id >= 1` bound is no bound at all at every epoch boundary), and handles the mixed-epoch batch that `sms rebuild` produces with no special case. **FACT, measured today:** `cone_event` 204,076 rows / 204,076 distinct `raw_id` / 0 null; `sack_event` 8,201 / 8,201; `reject_event` 4,570 rows, 4,203 distinct `raw_id` but **4,570 distinct `(reject_type, raw_id)`** — exactly the split `persistCanonical`'s `extraExistingFilter` already uses. So the invariant becomes a UNIQUE index instead of an application convention. |
| **D3** | **`source_epoch` is a GLOBAL surrogate (`epoch_id` IDENTITY, FK), with NO DEFAULT.** Critics disagreed; **critic 1 wins.** | `sms.reject_event` is fed by two source tables whose generations advance independently — **FACT:** July `create_date`s `rejectQCS1 19 Jun 11:58:38` vs `rejectWeight1 22 Jun 11:20:25`; September `18:58:13` vs `18:59:18`. A per-table ordinal on that one canonical table is ambiguous. Critic 2's objection (an IDENTITY can't be backfilled as 1 on four tables) is an artifact of the proposal's `DEFAULT 1`; dropping the default and backfilling explicitly per table removes it. Keep `generation_ordinal` on the epoch row as a human label only. |
| **D4** | **No `DEFAULT` on `source_epoch`, ever.** | A column whose job is to prevent cross-generation confusion must not silently fill itself in when an insert path forgets it. `persistRaw` builds its bulk column list from `def.columns`, which is exactly the omission a default would hide. |
| **D5** | **`source_epoch` goes LAST in the merge indexes.** | `api/src/services/live.ts:44-48` documents that every range predicate seeks on `(line_id, production_ts_utc_ms)` as the index's leading prefix. Putting the epoch second breaks seven `getLive` queries plus `production.ts` and `rejectSpc.ts`. Trailing placement gives the same uniqueness. |
| **D6** | **Delete item 6. An unrecognised `create_date` HALTS.** Unanimous, and I agree. | It is unreachable for the case it cites (the fingerprint gate runs first — `runner.ts:41-51` — and the real 2026-08-05 rebuild renamed `Source`→`MachineNo` and added `MaterialId`, so it halts there). Where it would fire it cannot tell a vendor rebuild from a wrong `IFL_DB_NAME_DATA`, and **FACT, today:** `DATA_TP1U2_SIM`'s four tables all read `create_date 2026-09-11 10:32:11` while `sms.app_config` holds `epoch.* = 2026-09-02T14:42:03.900Z`. Under auto-registration the next pass would register a new generation and re-ingest the simulator's rows a second time, doubling every count. Replaced by `sms epoch:accept --confirm`. |
| **D7** | **The schema fingerprint moves onto the epoch row.** | It is a property of a generation, not of a table name. **FACT:** `fingerprint.*` in `app_config` is stamped `2026-07-23` and describes the July column list, while `IflSqlAdapter.fingerprint()` hashes `def.columns.map(c => c.src)` and `iflTables.ts` now names `MachineNo`/`MaterialId` — the next pass against **any** source halts on drift before the epoch gate is reached. |
| **D8** | **The simulator rows are purged, not relabelled.** | See §3. |
| **D9** | **Metadata migration / standalone backfill / DDL migration, in three artifacts.** | `migrate.mjs` transaction + 15 s timeout (above), and this is **Express Edition** — `ALTER TABLE ADD <col> NOT NULL DEFAULT` is a size-of-data rewrite, and `CREATE INDEX` cannot use `ONLINE=ON`. |

### 2.2 Migration 025 — metadata only (commits in milliseconds)

`sms/db/migrations/025_source_epoch.sql`

```sql
-- 025_source_epoch.sql — one row per (line, source table, physical generation).
-- METADATA ONLY. The row backfill is scripts/backfill-source-epoch.mjs and the
-- constraints/indexes are 026. Splitting them is not style: migrate.mjs wraps a
-- whole file in one transaction at a 15s request timeout, and this is Express.

IF OBJECT_ID('sms.source_epoch', 'U') IS NULL
BEGIN
    CREATE TABLE sms.source_epoch (
        epoch_id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_source_epoch PRIMARY KEY,
        line_id            INT            NOT NULL,
        source_table       VARCHAR(64)    NOT NULL,   -- 'pack1_TP1U2', ...
        source_server      NVARCHAR(128)  NOT NULL,   -- identity, not decoration:
        source_db          NVARCHAR(128)  NOT NULL,   -- the failure guarded against is
                                                      -- "pointed at the wrong database"
        source_created_key VARCHAR(40)    NOT NULL,   -- sys.tables.create_date as the
                                                      -- adapter's ISO string, byte-for-byte
        schema_fingerprint CHAR(32)       NOT NULL,   -- replaces app_config fingerprint.*
        provenance         VARCHAR(20)    NOT NULL,   -- 'ifl_live'|'ifl_copy'|'simulator'
        generation_ordinal INT            NOT NULL,   -- human label only ("2nd pack1")
        label              NVARCHAR(64)   NOT NULL,
        note               NVARCHAR(1000) NULL,
        first_seen_utc     DATETIME2(3)   NOT NULL CONSTRAINT DF_se_first DEFAULT SYSUTCDATETIME(),
        last_seen_utc      DATETIME2(3)   NULL,
        closed_utc         DATETIME2(3)   NULL,       -- set when superseded or purged
        registered_by      NVARCHAR(64)   NOT NULL    -- 'bootstrap'|'cli:epoch-accept'|'cutover'
    );
    -- registration is idempotent: runOnce is NOT under a lock (pipeline.ts:23-27),
    -- so two passes must not be able to split one generation in two.
    CREATE UNIQUE INDEX UX_source_epoch_identity ON sms.source_epoch
        (line_id, source_table, source_server, source_db, source_created_key);
    -- at most one OPEN epoch per (line, table)
    CREATE UNIQUE INDEX UX_source_epoch_open ON sms.source_epoch (line_id, source_table)
        WHERE closed_utc IS NULL;
END
GO

-- Seed order is fixed so epoch_ids are deterministic: 1-4 = IFL's July copy,
-- 5-8 = the plant simulator. Fingerprints are copied from app_config, which is
-- the only surviving record of what those generations' columns were.
IF NOT EXISTS (SELECT 1 FROM sms.source_epoch)
BEGIN
    INSERT INTO sms.source_epoch
      (line_id, source_table, source_server, source_db, source_created_key,
       schema_fingerprint, provenance, generation_ordinal, label, registered_by, note)
    VALUES
      (1,'pack1_TP1U2',      'localhost','DATA_TP1U2','2026-06-19T11:53:05.000Z','5ba1cb11b4503f74a4abff08903d9fc1','ifl_copy',1,'July copy — cones','bootstrap','IFL sample 22 Jun - 10 Jul 2026; source generation dropped by IFL 2026-08-05.'),
      (1,'sack1_TP1U2',      'localhost','DATA_TP1U2','2026-06-18T18:47:43.000Z','06ee47196e50eba946195cb560e5e9c3','ifl_copy',1,'July copy — sacks','bootstrap',NULL),
      (1,'rejectQCS1_TP1U2', 'localhost','DATA_TP1U2','2026-06-19T11:58:38.000Z','3d83a0d9923c291ed1d3ca3b18b512cf','ifl_copy',1,'July copy — quality rejects','bootstrap',NULL),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2','2026-06-22T11:20:25.000Z','ccfee05bc955984edf3a27a1ecd4ebfe','ifl_copy',1,'July copy — weight rejects','bootstrap',NULL),
      (1,'pack1_TP1U2',      'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','5ba1cb11b4503f74a4abff08903d9fc1','simulator',2,'Simulator — cones','bootstrap','scripts/simulate-plant.mjs. SYNTHETIC. Purged 2026-09-11.'),
      (1,'sack1_TP1U2',      'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','06ee47196e50eba946195cb560e5e9c3','simulator',2,'Simulator — sacks','bootstrap','SYNTHETIC. Purged 2026-09-11.'),
      (1,'rejectQCS1_TP1U2', 'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','3d83a0d9923c291ed1d3ca3b18b512cf','simulator',2,'Simulator — quality rejects','bootstrap','SYNTHETIC. Purged 2026-09-11.'),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.903Z','ccfee05bc955984edf3a27a1ecd4ebfe','simulator',2,'Simulator — weight rejects','bootstrap','SYNTHETIC. Purged 2026-09-11.');
END
GO

-- Nullable, no default: pure metadata on Express, instant on 204k rows.
ALTER TABLE sms_raw.cone_raw          ADD source_epoch INT NULL;
ALTER TABLE sms_raw.sack_raw          ADD source_epoch INT NULL;
ALTER TABLE sms_raw.reject_qcs_raw    ADD source_epoch INT NULL;
ALTER TABLE sms_raw.reject_weight_raw ADD source_epoch INT NULL;
ALTER TABLE sms.cone_event            ADD source_epoch INT NULL;
ALTER TABLE sms.sack_event            ADD source_epoch INT NULL;
ALTER TABLE sms.reject_event          ADD source_epoch INT NULL;
ALTER TABLE sms.sync_run              ADD source_epoch INT NULL;  -- NULL = pre-epoch pass
GO
```

> **Verify the four July `create_date` values before running.** I read them from `DATA_TP1U2` this session as 18/19/19/22 Jun; the ISO strings above must equal what `IflSqlAdapter.sourceEpoch()` produces (`new Date(create_date).toISOString()`), not what SSMS prints. If they differ the seed is still correct — those generations are closed and never re-matched — but `epoch:accept` comparisons must use the adapter's own format.

### 2.3 The backfill — `sms/scripts/backfill-source-epoch.mjs` (standalone)

Not a migration. `requestTimeout: 600000`, **no explicit transaction** (each chunk auto-commits so the log truncates between chunks; peak log is one chunk), driven by clustered-key range so each chunk is a range seek, resumable because the verification predicate is `source_epoch IS NULL`.

**FACT — the boundaries, measured this session.** `raw_id` is the honest split, not `src_id`: `sms_raw.cone_raw` has an identity gap at `raw_id 142,512` (142,511 → 142,513).

| table | epoch 1 (`ifl_copy` July) | epoch 2 (`simulator`) | total |
|---|---|---|---|
| `cone_raw` | `raw_id <= 142511` → 142,511 rows | `raw_id >= 142513` → 61,565 | 204,076 |
| `sack_raw` | `raw_id <= 5462` → 5,462 | `raw_id >= 5463` → 2,739 | 8,201 |
| `reject_qcs_raw` | `raw_id <= 2900` → 2,900 | `raw_id >= 2901` → 1,303 | 4,203 |
| `reject_weight_raw` | `raw_id <= 246` → 246 (includes the legitimate `src_id = 0` row, at `raw_id 246`) | `raw_id >= 247` → 121 | 367 |

```js
// per raw table, chunked by clustered key:
//   UPDATE <t> SET source_epoch = @e WHERE raw_id BETWEEN @lo AND @lo+4999 AND source_epoch IS NULL
// advancing @lo, with CHECKPOINT between chunks.
// then canonical, by JOIN on raw_id — never by source_row_id ranges:
UPDATE c SET c.source_epoch = r.source_epoch
FROM sms.cone_event c JOIN sms_raw.cone_raw r ON r.raw_id = c.raw_id
WHERE c.raw_id BETWEEN @lo AND @lo+4999;
-- sack_event ← sack_raw the same way.
-- reject_event is fed by TWO raw tables, so it needs the type discriminator:
UPDATE c SET c.source_epoch = r.source_epoch
FROM sms.reject_event c JOIN sms_raw.reject_qcs_raw r ON r.raw_id = c.raw_id
WHERE c.reject_type = 'quality' AND c.reject_event_id BETWEEN @lo AND @lo+4999;
-- … and again with reject_weight_raw / reject_type='weight'.
```

Exit condition, asserted by the script before it returns 0: `SELECT COUNT(*) WHERE source_epoch IS NULL` = 0 on all seven tables.

### 2.4 Purge the simulator epoch (see §3 for why)

Runs after the backfill, before 026, as `sms epoch:purge --epoch=5,6,7,8 --confirm` (or the same SQL by hand):

```sql
DELETE FROM sms.cone_event   WHERE source_epoch = 5;   -- 61,565
DELETE FROM sms.sack_event   WHERE source_epoch = 6;   --  2,739
DELETE FROM sms.reject_event WHERE source_epoch IN (7,8); -- 1,303 + 121
DELETE FROM sms_raw.cone_raw          WHERE source_epoch = 5;
DELETE FROM sms_raw.sack_raw          WHERE source_epoch = 6;
DELETE FROM sms_raw.reject_qcs_raw    WHERE source_epoch = 7;
DELETE FROM sms_raw.reject_weight_raw WHERE source_epoch = 8;
UPDATE sms.source_epoch SET closed_utc = SYSUTCDATETIME(),
       note = CONCAT(note, ' Rows purged ', CONVERT(varchar(19), SYSUTCDATETIME(), 126), '.')
 WHERE epoch_id IN (5,6,7,8);
```

The epoch rows stay as tombstones. That is the point: the record of what was in this database survives the deletion of the rows.

### 2.5 Migration 026 — constraints and indexes (worker stopped)

First, a one-line fix so this file can finish: `scripts/migrate.mjs:96-101` gains `requestTimeout: 600000` in the connection config. It benefits every future migration and does not change the transaction semantics.

`sms/db/migrations/026_source_epoch_constraints.sql` — order matters: **create the new unique index under a new name, verify, then drop the old one.** Drop-first leaves the raw tables with no uniqueness, and `runFullSync` (`sync-worker/src/pipeline.ts:23-27`) calls `runOnce` **outside** `withTransformLock`, so two readers can race.

```sql
-- cone shown; sack / reject_qcs / reject_weight follow the same shape.
ALTER TABLE sms_raw.cone_raw ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms_raw.cone_raw ADD CONSTRAINT FK_cone_raw_epoch
    FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
GO
CREATE UNIQUE INDEX UX_cone_raw_src2 ON sms_raw.cone_raw (line_id, source_epoch, src_id);
CREATE INDEX IX_cone_raw_wm ON sms_raw.cone_raw (line_id, source_epoch, src_id DESC);
GO
DROP INDEX UX_cone_raw_src ON sms_raw.cone_raw;   -- the index that BLOCKS epoch-2 ids: last
GO

-- canonical -----------------------------------------------------------------
ALTER TABLE sms.cone_event ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms.cone_event ADD CONSTRAINT FK_cone_event_epoch
    FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
GO
-- D2: the canonical dedupe key becomes OUR identity. Enforce it.
CREATE UNIQUE INDEX UX_cone_raw_id  ON sms.cone_event (raw_id);
CREATE UNIQUE INDEX UX_sack_raw_id  ON sms.sack_event (raw_id);
CREATE UNIQUE INDEX UX_reject_raw_id ON sms.reject_event (reject_type, raw_id);
GO
-- D5: epoch LAST. (line_id, production_ts_utc_ms) stays a seekable prefix.
CREATE UNIQUE INDEX UX_cone_merge2 ON sms.cone_event
    (line_id, production_ts_utc_ms, hanger_num, ingest_seq, source_epoch);
GO
DROP INDEX UX_cone_merge ON sms.cone_event;
GO
CREATE UNIQUE INDEX UX_sack_merge2 ON sms.sack_event
    (line_id, production_ts_utc_ms, ingest_seq, source_epoch);
GO
DROP INDEX UX_sack_merge ON sms.sack_event;
GO
CREATE UNIQUE INDEX UX_reject_merge2 ON sms.reject_event
    (line_id, reject_type, production_ts_utc_ms, hanger_num, ingest_seq, source_epoch);
GO
DROP INDEX UX_reject_merge ON sms.reject_event;
GO
-- source_row_id stays a DISPLAYED field, never an address (§4.2). Its lookup
-- index gains the epoch so a missing predicate fails loudly.
DROP INDEX IX_cone_source ON sms.cone_event;
CREATE UNIQUE INDEX UX_cone_source ON sms.cone_event (line_id, source_epoch, source_row_id);
DROP INDEX IX_sack_source ON sms.sack_event;
CREATE UNIQUE INDEX UX_sack_source ON sms.sack_event (line_id, source_epoch, source_row_id);
DROP INDEX IX_reject_source ON sms.reject_event;
CREATE UNIQUE INDEX UX_reject_source ON sms.reject_event
    (line_id, reject_type, source_epoch, source_row_id) WHERE source_row_id IS NOT NULL;
GO
-- the gates now live on the epoch row
DELETE FROM sms.app_config WHERE config_key LIKE 'fingerprint.%' OR config_key LIKE 'epoch.%';
GO
```

> `UX_cone_source` being UNIQUE is a real assertion — verify it builds. If it fails, two rows in one epoch share a source id and that is a defect to fix before proceeding, not an index to relax.

### 2.6 Code changes, by file, in the order they must be applied

**Sync worker — ingest (do these together; the system is broken between a and f).**

1. `sync-worker/src/epoch.ts` *(new)* — `resolveEpoch(appPool, iflPool, def, cfg): Promise<EpochRow>`. Reads `sys.tables.create_date` **schema-qualified** (`AND SCHEMA_NAME(schema_id) = 'dbo'`, throw if more than one row) and the fingerprint; matches the OPEN row in `sms.source_epoch` on `(line_id, source_table, source_server, source_db, source_created_key)`. **Throws** when: the source reports no `create_date` (there is no safe default — defaulting to "latest" or to 1 reproduces the original bug exactly); the key is unknown; or the fingerprint differs from the matched row's. The error names `sms epoch:accept`.
2. `sync-worker/src/store.ts:36-48` — `getWatermark(pool, rawTable, lineId, epochId)`, `WHERE line_id=@line AND source_epoch=@epoch`. Return `number | null` (`null` = no rows in this epoch), not `0`. Callers use `watermark ?? 0`; the backwards-gate guards on `watermark !== null` so it is not permanently skipped for a small epoch. Keep `Math.max(-1, …)` — **FACT:** `sms_raw.reject_weight_raw` holds a legitimate `src_id = 0` row (at `raw_id 246`).
3. `sync-worker/src/runner.ts` — **invert the order:** resolve the epoch first, then the fingerprint (from the epoch row), then the per-epoch watermark. Today `:53` reads the watermark before `:77` resolves the epoch. Delete the `app_config` `epoch.*`/`fingerprint.*` gates (both now on the epoch row). Pass `epochId` to `persistRaw` and to `startSyncRun`. Keep both halts. Escalate `raw_read_without_write` from `WARNING` to `ERROR` and make it halt the table's pass: once the probe is epoch-scoped it can only mean id-space reuse **inside** a generation. It must also be deduped before it can fire every minute — **FACT:** `persistFindings` (`transform/dq.ts:119-137`) is a bare INSERT; migration 016 was a one-time cleanup, not a constraint. 4 tables × 1,440 passes = 5,760 rows/day otherwise.
4. `sync-worker/src/raw/persistRaw.ts` — `epochId` parameter; `AND source_epoch = @epoch` at `:56`; `table.columns.add('source_epoch', mssql.Int, { nullable: false })` and the value in the row build at `:72-74`.
5. `sync-worker/src/transform/persistCanonical.ts` — rename `existingSourceIds` → `existingRawIds`; select `raw_id`; bound `AND raw_id >= @minRawId`; `persistCanonical` filters `!seen.has(Number(r.raw_id))`. `extraFilter` keeps carrying `AND reject_type = '…'`. Add `{ name: 'source_epoch', type: mssql.Int, nullable: false }` to `CONE_COLS`, `SACK_COLS`, `REJECT_COLS`.
6. `sync-worker/src/transform/runTransform.ts` — `onlyFresh` keys on `raw_id`; `minSourceRowId` → `minRawId` (keep the reduce, not the spread — it is the fix from `e86357f`). **Do not advance the watermark on a zero-write batch:** if `raw.length > 0 && written === 0`, raise a CRITICAL `dq_finding` and leave the watermark. Scope `seedExistingCollisions` (`:224-252`) with `AND source_epoch = @epoch` and bound its scan by epoch as well as `minTs` — **FACT:** both copies carry a 1970-01-01 clock-fault row on `pack1` (July `id 3824`, Sept `id 5047`), so on a full backfill `minTs` degenerates to the Unix epoch and the `GROUP BY` scans the whole canonical table.
7. `sync-worker/src/transform/transform.ts` — carry `source_epoch` from the raw row onto the mapped row; add it to `coneKey`/`sackKey`/`rejectKey` and to `CONE_KEY_SQL`/`SACK_KEY_SQL`/`REJECT_KEY_SQL` in `runTransform.ts`. This also removes a latent bug for free: `assignMergeKeys` (`:280-299`) sorts a collision group by `source_row_id`, so after a `rebuild` a cross-epoch group would be batch-local and September's id 104,089 would sort **before** July's 164,564 — the two rows would swap `ingest_seq` and therefore swap merge keys, contradicting the file's own "re-runs are no-ops" contract. With the epoch in the key the cross-epoch group cannot form.
8. `sync-worker/src/store.ts` `startSyncRun` — write `source_epoch`.

**CLI.**

9. `cli/src/commands/epoch.ts` *(new)* — `sms epoch:list` (id, label, provenance, server/db, created key, fingerprint, row counts, date range, open/closed); `sms epoch:accept --table=<t>|--all --confirm --label "…" --provenance ifl_live` (prints the current open row, the new `create_date`, the new fingerprint, the source server/database and the source `MAX(id)`, then registers and closes the old row); `sms epoch:drop --epoch=N --confirm` as the precise undo for a wrong registration; `sms epoch:purge --epoch=N --confirm` (§2.4).
10. `cli/src/commands/verify.ts` — rewrite per §4.1.
11. `cli/src/commands/cutover.ts` — keep, narrow the doc comment: it is no longer the answer to a source rebuild (that is `epoch:accept`); it is "throw everything reproducible away and start again". It must also clear `sms.source_epoch` and re-bootstrap.

**API.**

12. `api/src/services/live.ts:372` — `ORDER BY raw_id DESC`. Apply this **independently and first**; it is correct today and would otherwise measure the acquisition lag from the older generation for ~68 days (§4.3).
13. `api/src/services/register.ts:75` — `idCol` returns the canonical PK for all three types (`cone_event_id` / `sack_event_id` / `reject_event_id`); add the PK to `CONE_COLS`/`SACK_COLS`; keep `source_row_id` as a displayed column, labelled with its epoch.
14. `api/src/services/weights.ts:140,155` — select the PK as `id` for the extreme-weight deep links.
15. `api/src/services/operations.ts` + Setup — print the epoch label beside `watermark_from`/`watermark_to`.
16. Detectors (§4.5): `weightStations.ts:124-130`, `attention.ts:150-153`, `rejectSpc.ts:196-210`, `nelson.ts` via `calibration.ts`, `web/src/lib/period.ts:165-171`.

**Tests (each locks a failure that was real).**

- Ingest epoch 2 (`src_id` 1..N) into a raw table already holding epoch-1 rows over the same id range; assert `written === read`.
- Transform the same; assert canonical rows written and `raw_id` unique.
- Zero-write batch: assert the transform watermark does **not** advance and a CRITICAL finding exists.
- `resolveEpoch` with an unknown `create_date` throws, and with `null` throws.
- Two rows, same `(line_id, production_ts_utc_ms, hanger_num)`, different epochs: both insert, `merge_key_is_unique` stays 1 on both.
- `verify` returns 0 with one open and one closed epoch present.
- Day-adjacency: a station heavy on 2026-07-10 and on 2026-08-26 reports `daysHeld = 1`, not 2.

### 2.7 Runbook order

0. Stop the worker service. `SELECT TOP 5 * FROM sms.sync_run WHERE finished_at_utc IS NULL` → none. Back up `sms`. (`sms_log` is already 584 MB against 200 MB of data — check free disk first.)
1. Apply `live.ts` `ORDER BY raw_id DESC` (independent, safe now).
2. `requestTimeout` in `migrate.mjs`; apply migration **025**.
3. Run `backfill-source-epoch.mjs`; assert 0 nulls on seven tables.
4. Purge the simulator epoch (§2.4); re-assert counts: `cone_raw` 142,511, `sack_raw` 5,462, `reject_qcs_raw` 2,900, `reject_weight_raw` 246.
5. Apply migration **026**. Expect a few seconds of blocked `/api/live` (it reads `sms_raw.cone_raw`; Express cannot build indexes ONLINE).
6. Deploy the code changes (§2.6 items 1-16) and run the tests.
7. Point `IFL_DB_NAME_DATA` at `DATA_TP1U2_SEP07`. The pass **halts** on an unknown generation — that is the gate working.
8. `sms epoch:accept --all --confirm --provenance ifl_copy --label "September copy"` → epochs 9-12. Start the worker; backfill 132,552 cones.
9. `sms verify`. Open epoch triple equal; closed epochs reported as archived.

---

## 3. THE 204,076 EXISTING ROWS — WHAT THEY TRUTHFULLY ARE

**FACT (measured this session, `sms_raw.cone_raw`):** one unbroken id space, **two physical provenances**.

| rows | `src_id` | `ProductionDate` | what it is |
|---|---|---|---|
| 142,511 | 1..142,511 | 1970-01-01 (one clock fault) … 2026-07-10 11:23:10 | IFL's real July sample, read from `DATA_TP1U2` |
| 61,565 | 142,512..204,076 | 2026-08-26 14:28:51 … 2026-09-03 20:00:18 | `scripts/simulate-plant.mjs`, via `DATA_TP1U2_SIM` — **synthetic** |

Labelling all 204,076 "epoch 1" would record the true fact (one generation, one unbroken counter — the simulator continued IFL's identity, which is why 142,512 follows 142,511) and erase the fact that matters: half of it never happened on a plant. These rows feed the calibration advisory, the Nelson rules and the station-drift table.

**Decision (D8): register the simulator rows as epochs 5-8 with `provenance='simulator'`, then DELETE them, keeping the epoch rows as tombstones.**

The decisive reason is arithmetic, not tidiness. **FACT:** the simulator window (26 Aug – 3 Sep) overlaps the real September copy (5 Aug – 7 Sep) by **nine days**. Keeping both means every count, rate, control limit and reject ratio for those nine days is double-counted from two different worlds unless every single query carries a provenance predicate. A join of the two on exact `ProductionDate` finds only 3 matches (none sharing `HangerNum`), so nothing would *crash* — it would just be quietly wrong, which is worse.

Rehearsal against arriving data is not lost: `APP_DB_NAME` is env-driven, so the simulator gets its own app database (`sms_sim`) and its own epoch row there. Synthetic readings do not belong in the database that answers "is station 7 drifting".

**Alternative if the owner wants rehearsal in this same database:** keep the rows as epochs 5-8 and add `AND provenance = 'ifl_live' OR provenance = 'ifl_copy'` to every analytic query by default, surfaced in the UI. That is a larger change and a permanent tax. I do not recommend it.

**JUDGEMENT on the final shape after step 8:** epochs 1-4 = July (`ifl_copy`, closed), 5-8 = simulator (purged, closed), 9-12 = September (open). `provenance` for 9-12 is `ifl_copy` until the worker is pointed at IFL's live server, at which point that is another `epoch:accept` and another generation — which is exactly right, because it *is* a different physical source.

---

## 4. WHAT BREAKS ELSEWHERE ONCE TWO EPOCHS COEXIST

### 4.1 `sms verify` becomes permanently MISMATCH — BLOCKER

**FACT:** `cli/src/commands/verify.ts:33-40` counts the whole current source against the whole raw and canonical tables and asserts `src === raw && raw === can`. Under append, raw holds two generations and the source holds one. All four streams read MISMATCH on correct data, forever — and `cutover.ts` closes by calling a MISMATCH "a STOP condition". An alarm that is always on is no alarm, and a genuine loss of 132,552 rows would look identical to the expected noise.

**Fix — three assertions, per epoch:**

1. **Open epoch vs the live source** (the only place the source is the authority): `COUNT(*)`, `MIN(id)`, `MAX(id)` **and** `SUM(CAST(id AS BIGINT))`. The sum catches the equal-missing/equal-extra case that COUNT alone passes. Any difference is a STOP.
2. **Closed epochs:** source cannot corroborate them. Print `— archived — N rows, source generation no longer present`, and check raw↔canonical only.
3. **raw → canonical, by key not by count:** `SELECT COUNT(*) FROM <raw> r WHERE NOT EXISTS (SELECT 1 FROM <canon> c WHERE c.raw_id = r.raw_id AND <type filter>)`, and the reverse. Two index scans once `UX_*_raw_id` exists.

Plus: print the source **server and database** in the header (an "OK" from a verify accidentally pointed at the July copy is currently indistinguishable from a real one), print the epoch table above the reconciliation, assert the source's `create_date` matches the open epoch, and distinguish "the source has rows we do not" (STOP) from "we hold rows the source no longer does" (archive, informational).

### 4.2 Every cone and sack permalink returns an arbitrary generation — BLOCKER

**FACT:** `api/src/services/register.ts:75` addresses cone and sack rows by `source_row_id`; `getEventDetail` runs `SELECT TOP 1 … WHERE line_id=@line AND source_row_id=@id` with no `ORDER BY`; and `IX_cone_source (line_id, source_row_id)` is **not unique** (read from `sys.indexes`). With two epochs, any id ≤ 132,552 matches two physically different cones nine weeks apart and TOP 1 returns whichever the seek yields first — in practice the older one. The same id is the visible row identity in the list and in the CSV export, and `weights.ts:140,155` deep-links on it.

**Fix:** address by the canonical PK, as `reject_event` already does (`register.ts:9-14` documents why that pattern exists). One change to `idCol` plus adding the PK to `CONE_COLS`/`SACK_COLS`, versus threading an epoch through every permalink, filter and CSV column. Keep `source_row_id` as a *displayed* field labelled with its epoch — it is the number IFL's own engineers will quote.

### 4.3 `live.ts` would measure the acquisition lag from the wrong generation — MAJOR

**FACT:** `api/src/services/live.ts:364-372` samples `DATEDIFF(SECOND, src_ProductionDate, src_Date)` `ORDER BY src_id DESC`. Once September restarts at 1, the highest `src_id` belongs to the older generation for ~68 days at 3,000 cones/day. That lag sets `lagMs`, which sets `classifyLineState` (running/stopped/idle), the `late` health state, `anchorMs`, and the cones-per-hour divisor — the whole 18-minute-lag machinery from the 2 Sep rehearsal, silently running on stale data.

**Fix:** `ORDER BY raw_id DESC`. It is our own monotone insertion identity and is what "the rows we most recently ingested" means. Correct today, epoch or no epoch — ship it first and separately. Freshness (oldest source table, not newest) is already right and unaffected.

### 4.4 Reject rates, SPC and the 25-day hole — MAJOR

**FACT:** after the purge the app DB has no rows between 2026-07-11 and 2026-08-04 — a permanent 25-day hole.

- `rejectSpc.ts:147` builds `sortedTimes` from buckets **that have data**, and the episode loop at `:196-210` walks consecutive **array entries**. An out-of-control 2026-07-10 and an out-of-control 2026-08-05 merge into one "episode" spanning 26 days, presented on Home as a burst — which the file's own header defines as "a specific event: bad batch, mis-calibration".
- `p̄` is pooled across the whole range, so one set of control limits is computed over two generations with entirely different product attribution (July: no `MaterialId` at all; September: up to six materials concurrently).
- **Fix:** break an episode at a bucket gap greater than one bucket; compute `p̄` per epoch (or refuse a window that spans an epoch boundary, which is the honest position).
- **Not broken, worth recording:** `report.ts` already returns `daysInPeriod`, `daysWithData`, `firstDayWithData` and `complete`, so the Report screen states its own coverage. `downtime.ts` PARTITIONs gaps `BY shift_date`, so the hole is never reported as a 25-day stoppage.

### 4.5 Three detectors count "consecutive days" by array adjacency — MAJOR

**FACT:** `weightStations.ts:124-130` and `attention.ts:150-153` both walk the days-with-data array backwards with no calendar test (`for (let i = days.length-1; …) { if (sign(...) !== side) break; run.unshift(...) }`), then report `run.length` as `daysHeld`; the Home screen prints "has read about N g heavier for D days". `nelson.ts`'s rule 2 ("9 in a row on one side") and rule 3 ("6 in a row trending") run over `calibration.ts`'s day points with the same exposure. With the hole, 2026-07-10 and 2026-08-05 are adjacent entries.

**Fix:** `break` the run when `daysBetween(days[i].date, days[i+1].date) > 1`. And `web/src/lib/period.ts:165-171` `trailingWindow` clamps only at `firstDay`, never at a hole — it must return `daysWithData` alongside `requestedDays` so a screen says "the last 14 days — 3 of them hold readings".

### 4.6 Product attribution is asymmetric across the boundary — MAJOR

**FACT:** all 142,511 July raw rows carry `src_MaterialId = NULL` (the column did not exist in that generation), and so did all 61,565 simulator rows. September carries it on 100% of rows. So every epoch-1 canonical row has `attribution_method = 'none'` and back-filling it would be the fabrication CLAUDE.md rule 1 forbids.

**Consequence:** `/api/production?product=` over a range spanning both generations silently returns September rows only, for a period the UI says covers both; a product-mix chart reads 100% "unknown" for the older half.

**Fix:** every product-filtered endpoint returns, alongside its rows, the count of rows in the requested range carrying no attribution, and the screen says "N of M readings in this period predate product recording" rather than silently narrowing the period.

### 4.7 PDAS needs no epoch — verified, and recorded so nobody adds one by symmetry

**FACT:** `Materials` was not rebuilt. Ids 1-18 are identical across `PDAS_TP1U2` and `PDAS_TP1U2_SEP07` (same `BlendId`/`CountId`/`MaterialSetpointWeight`); September only **added** 20, 21, 1021-1024. The identity extended (max 18 → 1024) rather than reset. `material_id` is epoch-independent and the attribution join is safe across generations. Do not put `source_epoch` on the reference tables.

### 4.8 Operational record and housekeeping — MINOR

- `sms.sync_run` gains `source_epoch` (NULL for pre-epoch passes), or `watermark_from`/`watermark_to` become uninterpretable numbers that jump from 204,076 to 1 with no explanation in `operations.ts` and the Setup panel.
- **FACT:** `sms.snap25_cone_event`, `snap25_sack_event`, `snap25_reject_event` are referenced by **no** code (grep across `sms/`, excluding `dist` and `node_modules`). They are stale manual snapshots from the September audit. Drop them, or they will one day be mistaken for data — and they will not carry the epoch column.
- **Retention:** `ARCHITECTURE.md`'s retention policy assumes one generation. Decide and write down: closed epochs are retained indefinitely (that is the owner's whole requirement here), the default period on every screen never reaches across a closed boundary, and the archived generation is reported as archived rather than silently included.

---

## 5. THE PDAS WRITE PATH

### 5.1 The facts that set the shape (all verified in `PDAS_TP1U2_SEP07` this session)

1. `dbo.Materials`: `MaterialId` **IDENTITY**, `BlendId`, `CountId`, `TubeTypeId`, `MaterialSetpointWeight float`, `MaterialWeightOffsetMinus/Plus float`, `MaterialActive bit DEFAULT 0`, `MaterialDesc1..5 nvarchar(255)`, `Timestamp datetime DEFAULT getdate()`.
2. **The vendor's entire mutation surface is create + activate.** 13 procs; only `CreateMaterial` (INSERT) and `SetMaterialStatusActive` (`UPDATE MaterialActive` only) touch `Materials`. **No proc updates a setpoint, an offset, or a description.**
3. **`CreateMaterial` rejects a duplicate `(BlendId, CountId, TubeTypeId)` with error -7001 "Material already exist" — and its `IF NOT EXISTS` check does NOT consider `MaterialActive`.** This is decisive: **"retire and re-create" is impossible for the same triple.** You cannot express "same yarn, new target weight" as a new MaterialId. Any design premised on retire+create as the general edit mechanism is dead on arrival.
4. **`Timestamp` has `DEFAULT getdate()` and is touched by nothing on UPDATE** (triggers: `Materials_Trig_ColumnsValuesMaxLen` is INSERT-only; `…_ActiveChanged` is UPDATE and only maintains `nhs_columnsMaxLen`). **PDAS therefore retains no record whatsoever that a setpoint was edited.** The audit trail has to be ours.
5. `…_ActiveChanged` is written single-row (`SELECT @active = t.[MaterialActive] FROM INSERTED t`). A multi-row UPDATE mis-evaluates it. Every write we issue must be single-row.
6. Both procs log to `dbo.nhs_events (Src, Severity, Logtext)` — the vendor's own event log, still being written (latest row 2026-09-07 11:46:29).
7. **The scale's in-range bit is exactly the material's limits.** Over all 132,551 attributed September cones, `InRange = 1` ⟺ `Weight BETWEEN setpoint - offsetMinus AND setpoint + offsetPlus`: **0 disagreements.**
   **JUDGEMENT, and the caveat that goes with it:** every active material carries the same 1960 ± 50, so this cannot formally separate "the PLC reads the material row" from "the PLC uses a constant that happens to equal it". But the conservative reading is the only responsible one: **editing `MaterialSetpointWeight` is a process-control write, not a reporting write.** Treat it as changing what the plant rejects until IFL says otherwise.
8. Six materials genuinely run concurrently: 20 (49,050 cones, 3 machines), 21 (52,887, 12 machines), 1021 (21,149, 5), 1022 (6,262, 2), 1023 (2,107, 1), 1024 (1,095, 1). A single line-wide "Current Product" remains the wrong model.

### 5.2 Chosen approach

**A single guarded writer service, using the vendor's procs where they exist and one parameterised single-row UPDATE where they do not — with an app-side, time-versioned mirror as the source of truth for history.**

Rejected alternatives, briefly: *creating our own stored proc in PDAS* (a schema modification to a vendor database — the same class of change Q21 forbids on `DATA_TP1U2`, and it would be overwritten by a vendor upgrade); *retire + create as the edit mechanism* (impossible, fact 3); *writing only to our own DB and letting engineers keep hand-writing SQL* (fails the confirmed deliverable).

**Three operations, and no fourth:**

| operation | mechanism | rank |
|---|---|---|
| `createProduct` | `EXEC dbo.CreateMaterial` — never a raw INSERT. The proc allocates the id, enforces the triple, writes `nhs_events`. Surface its `-7001`/`-7003`/`-7004` to the user in words. | ≥ 3 |
| `setProductActive` | `EXEC dbo.SetMaterialStatusActive` | ≥ 3 |
| `updateProductLimits` | No proc exists. `UPDATE dbo.Materials SET MaterialSetpointWeight=@sp, MaterialWeightOffsetMinus=@mi, MaterialWeightOffsetPlus=@pl, MaterialDesc1..5=@d WHERE MaterialId=@id` — single row, parameterised, `SET XACT_ABORT ON`, plus one `nhs_events` row in the vendor's own format so their log shows the change. `MaterialActive` is untouched, so the ActiveChanged trigger is a no-op. | ≥ 3 |

**Calling contract** — `api/src/services/pdasWrite.ts`, the **only** module holding a writable PDAS pool:

```ts
updateProductLimits(p: {
  productId: number;
  before: ProductLimits;   // the exact six values the operator was shown
  after:  ProductLimits;
  reason: string;          // required, >= 10 chars
  actor:  { userId: number; username: string };
}): Promise<{ ok: true; observedAfter: ProductLimits } | { ok: false; code: 'CONFLICT'|'IMPLAUSIBLE'|'NOT_FOUND'|'DISABLED'; message: string }>
```

### 5.3 Permission model

- **Writes: rank ≥ 3 (manager).** Heavier than `/api/current-product`'s `requireRole(2)` because this changes what the scale accepts, not what a report is labelled. **FACT:** ranks are `operator 1, supervisor 2, manager 3, admin 4` (`011_auth.sql:11`), and DEPLOY.md already says to create IFL's accounts at manager rank, so this does not lock anyone out.
- **Enabling the write path at all: rank 4 + an env flag `PDAS_WRITE_ENABLED` defaulting to `false`.** Off until IFL confirms §6.
- **Read access unchanged** — no read tiers (the one-audience rule).
- **Enforced by the login, not by code discipline:** a dedicated SQL login `sms_pdas_writer` with `UPDATE`/`INSERT` on `dbo.Materials`, `EXECUTE` on the two procs, `INSERT` on `dbo.nhs_events`, and nothing else. `DATA_TP1U2` stays read-only on its own login — **Q21 is unchanged for the acquisition database.**

### 5.4 Safety rails

1. **Single row or rollback.** `WHERE MaterialId = @id`; assert `@@ROWCOUNT = 1`.
2. **Optimistic concurrency.** Re-read the row inside the transaction and compare all six fields against the `before` image the operator was shown. Mismatch → abort with "someone changed this product since you opened it". IFL's engineers still have their own SQL access; this is not hypothetical.
3. **Plausibility bounds** (`sms.plausibility_rule`, the table already exists): setpoint 500–5000 g, each offset 0 – setpoint/2. Every observed value today is 1950/1960 ± 30/40/50.
4. **Echo-back.** After commit, re-read and store `observedAfter`. Any difference raises a CRITICAL `dq_finding` on the Operations screen.
5. **No DELETE, ever. No other PDAS table** except `nhs_events`. No schema changes.
6. **Append-only app-side record** — new `sms.product_change` (product_id, before/after JSON, `effective_from` = the instant PDAS accepted it, `changed_at`, `changed_by`, `reason`, outcome) plus a `sms.audit_log` row. Since PDAS keeps nothing (fact 4), this is the only audit trail that will exist.
7. **Time-versioned limits — the architectural core.** New `sms.product_limit_version (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from, source 'pdas_observed'|'sms_write', changed_by, reason)`, append-only. The reference sync writes a `pdas_observed` row whenever the mirrored values differ from the newest version; a `limitsAt(product_id, ts)` lookup — the same shape as `api/src/services/productAt.ts` — gives every reading the limits in force **at its own time**. Without this, editing a setpoint retroactively rewrites the meaning of every past reading attributed to that material, which is precisely the defect REDESIGN rule 1 was written to kill. **Note:** `sms.product` currently mirrors `setpoint_weight_g` but **not** the two offsets (`006_reference.sql`) — add them.
8. **We do not write to machines.** Q22 stands. Requirement line 3 ("update product details on machines") stays half-met and the UI must not imply otherwise.

### 5.5 Exact UI wording

Two distinct actions, never one "Edit" button. The user must not be able to reach the destructive-in-meaning path by accident, and the honest asymmetry is that one keeps the product number and one cannot exist at all for the same triple.

**Action A — "Change weight limits"** (in-place; keeps the MaterialId)

> **Change weight limits — 205-IL0-SD · Blend 2 · Count 2 · Tube 23 (product 20)**
>
> Target 1960 g → **1965 g**
> Accepted range 1910 – 2010 g → **1915 – 2015 g**
>
> This changes the limits the scale uses from now on. Readings already recorded keep the limits that were in force when they were weighed.
>
> Product 20 keeps its number, so past and future readings stay under the same product. If this is really a different yarn, create a new product instead.
>
> Why is this changing? *(required)* ______________
>
> **[ Change the limits ]**   [ Cancel ]

**Action B — "Create a new product"** (new MaterialId; the only path that produces one)

> A new product gets a **new number**. Readings from now on are recorded against it; nothing already recorded moves.
>
> PDAS allows only one product per blend + count + tube type. **Blend 2 · Count 2 · Tube 23 already exists as product 20.** To create a new product, change one of those three — or change the limits on product 20 instead.

**Action C — "Retire"** (deactivate; never "delete")

> Retire product 20. It stops being selectable on the machine. Readings already recorded keep it, and you can bring it back later.

**Words never to use:** "Edit product" alone (ambiguous between A and B); "Delete"; "Update the machine" or anything implying we wrote to the PLC.

**Pending IFL's answer on propagation (§6), Action A carries one more line, and it is not optional:**

> The scale picks up the new limits when the product is next selected on the machine.

If IFL confirms the PLC reads the values live, that line becomes "The scale uses the new limits immediately" and the button gains a second confirmation step, because a mistyped digit then changes what the plant rejects within seconds.

---

## 6. RISKS AND OPEN QUESTIONS

### 6.1 What we decide (no client input needed)

| | Decision | Residual risk |
|---|---|---|
| R1 | Canonical dedupe keys on `raw_id`, not on the epoch. | `raw_id` must never be reused. It is an IDENTITY; `sms rebuild` re-reads raw and does not renumber it. Locked by `UX_*_raw_id`. |
| R2 | Global `epoch_id`, no DEFAULT, FK-enforced. | An insert path that forgets the column now fails loudly. That is the intent. |
| R3 | Auto-registration deleted; halt + `sms epoch:accept`. | An operator action on a genuine vendor rebuild — which has happened **once** in this project's life (2026-08-05). Cheap against a silent doubling of the GM's production figures. |
| R4 | Simulator rows purged; rehearsal moves to its own app DB. | We lose the ability to demo "live" motion on this exact database until a simulator DB is set up. One env var. |
| R5 | PDAS writes go through the vendor's procs where they exist, and one guarded UPDATE where they do not. No new PDAS objects. | A vendor upgrade could add its own edit proc; switch to it when it appears. |
| R6 | Write rank ≥ 3, `PDAS_WRITE_ENABLED=false` by default. | None. |
| R7 | Limits are time-versioned app-side; readings are always judged by the limits in force at their own time. | Versions before our mirror started are unknown — record `effective_from` as "not earlier than" and say so. |

### 6.2 What IFL must confirm (in priority order)

1. **Does the PLC/HMI read `Materials.MaterialSetpointWeight` and the two offsets live, or only when a material is selected/activated at the machine?** This decides Action A's wording and whether it needs a second confirmation. **It gates the write path going live.** Our evidence: the in-range bit reproduces the material's limits exactly on 132,551/132,551 rows, but all active materials share 1960 ± 50, so the data cannot answer it.
2. **Confirm in writing that SMS may write to `PDAS_TP1U2.dbo.Materials`** (and only that table plus `nhs_events`), and that `DATA_TP1U2` stays read-only. Q21 was a blanket "zero modifications to IFL's DB"; the 2026-09-11 confirmation is about PDAS only and should say so explicitly, with the writer login provisioned by their DBA.
3. **Who may change a setpoint?** We are proposing manager rank. IFL may want it narrower (named process engineers) or a second approver.
4. **Is 26 days of production (2026-07-11 → 2026-08-04) recoverable from a backup?** IFL's own DB no longer holds June–July at all. If it is recoverable it becomes another epoch and the hole closes; if not, the hole is permanent and §4.4/§4.5 are permanent requirements rather than transitional ones.
5. **Does IFL want July retained at all?** The whole append design exists to keep it. If they do not, the answer is a one-line `epoch:purge` and a much smaller change — worth asking before we build it.
6. **Sack stock per machine** remains blocked: `sack1_TP1U2` still carries no machine column even in the September schema. Unchanged by any of this, and still the largest missing module.
7. **The `MaterialId` jump 21 → 1021** means someone reseeded the PDAS identity. Harmless for us (we never assume density), but worth asking whether 1021+ is a separate numbering convention we should display differently.

### 6.3 The two things most likely to bite during the build

- **The fingerprint gate halts before anything else.** Stored fingerprints are July's (`app_config`, stamped 2026-07-23) and `iflTables.ts` now depends on `MachineNo`/`MaterialId`. Nothing ingests until D7 moves the fingerprint onto the epoch row. Expect the first post-migration pass to halt; that is correct.
- **`sourceEpoch()`'s key is fragile.** `sys.tables.create_date` is a `datetime` (3.33 ms granularity) converted by `new Date(created).toISOString()` through a driver whose `useUTC` setting shifts it five hours on this plant (`config.ts:113-116`). Store the adapter's string **byte-for-byte** as `source_created_key`, seed epochs 1-4 from the `app_config` values (which the adapter itself produced) rather than re-deriving them, and never store it as a datetime. Under halt-on-unknown a format drift is a loud stop; under auto-registration it would have been a new epoch every 60 seconds — a third reason item 6 had to go.