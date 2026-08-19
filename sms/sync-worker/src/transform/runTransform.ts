/**
 * Transform runner (Step 3): raw → canonical. Reads sms_raw.*, maps via the
 * pure transform, assigns merge keys, runs DQ, persists idempotently.
 *
 * INCREMENTAL since the Aug 2026 audit: each stream keeps a watermark (max
 * raw_id transformed, in sms.app_config) and a pass reads only raw rows past
 * it. The original design re-read and re-mapped the ENTIRE raw layer every
 * pass — correct (persist is insert-if-absent) but O(total history) per pass:
 * measured 2.5s at 151k rows and growing linearly forever, which would
 * eventually blow the 60s cadence on live. It also re-detected the same
 * standing data faults every pass and re-INSERTed them as new dq_finding rows
 * (+8/pass, unbounded). Batch-scoping fixes both: a pass with nothing new
 * does nothing, and a finding is recorded once, when its rows are ingested.
 *
 * What batch-scoping must NOT lose (and how it doesn't):
 *  - stale-clock detection across the batch boundary: the running maximum is
 *    seeded from canonical's newest timestamp (computeFindings initialMaxMs).
 *  - merge-key collisions across the batch boundary: a new row can collide
 *    with a HISTORICAL row's merge key. Under full re-read that produced the
 *    same deterministic ingest_seq every pass; batch-local assignment would
 *    give the new row seq 0 and violate the UX_*_merge unique index — the
 *    pass would fail and retry the same batch forever. seedExistingCollisions
 *    offsets batch seqs past history's and clears merge_key_is_unique.
 *  - rebuild: `sms rebuild` deletes canonical then re-transforms, so it must
 *    reset the stream's watermark first (resetTransformWatermarks, called by
 *    the CLI) or the re-run would see an empty batch and rebuild nothing.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { SyncConfig } from '../config.js';
import {
  mapCone,
  mapSack,
  mapReject,
  assignMergeKeys,
  coneKey,
  sackKey,
  rejectKey,
} from './transform.js';
import {
  persistCanonical,
  existingSourceIds,
  CONE_COLS,
  SACK_COLS,
  REJECT_COLS,
} from './persistCanonical.js';

/**
 * Drop batch rows already in canonical BEFORE findings/collision seeding, not
 * only at persist time. A re-read of already-transformed rows (failure retry,
 * watermark rewind) otherwise self-collides with its own canonical copies and
 * records spurious merge-collision findings for data that isn't new — caught
 * live in the Aug 2026 audit's rewind test.
 */
async function onlyFresh<T extends { source_row_id: number }>(
  pool: ConnectionPool,
  table: string,
  rows: T[],
  extraFilter = '',
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const seen = await existingSourceIds(
    pool, table, extraFilter, Math.min(...rows.map((r) => r.source_row_id)),
  );
  return rows.filter((r) => !seen.has(Number(r.source_row_id)));
}
import { computeFindings, persistFindings, type Finding } from './dq.js';
import { seedRejectCodes } from './seedRejectCodes.js';

type Raw = Record<string, unknown>;

// ---- transform watermarks (sms.app_config) ---------------------------------

const WM_KEYS = {
  cone: 'transform_wm_cone_raw',
  sack: 'transform_wm_sack_raw',
  reject_qcs: 'transform_wm_reject_qcs_raw',
  reject_weight: 'transform_wm_reject_weight_raw',
} as const;

/** Which watermarks feed which canonical table — rebuild resets by table. */
const WM_BY_TABLE: Record<string, string[]> = {
  cone_event: [WM_KEYS.cone],
  sack_event: [WM_KEYS.sack],
  reject_event: [WM_KEYS.reject_qcs, WM_KEYS.reject_weight],
};

/**
 * Read a stream's watermark. When the key does not exist yet, self-seed from
 * what canonical has ALREADY transformed (`MAX(raw_id)` via fallbackSql) —
 * covers the mid-life upgrade from the pre-watermark design, where treating a
 * missing key as 0 would trigger one final full re-read and re-record every
 * standing finding the dedupe migration just removed. On a truly fresh
 * install canonical is empty, MAX is NULL, and the seed is 0 as it should be.
 */
async function getWatermark(pool: ConnectionPool, key: string, fallbackSql: string): Promise<number> {
  const r = await pool
    .request()
    .input('k', mssql.VarChar(64), key)
    .query<{ v: string }>(`SELECT config_value v FROM sms.app_config WHERE config_key=@k`);
  if (r.recordset[0]) return Number(r.recordset[0].v);
  const f = await pool.request().query<{ m: number | null }>(fallbackSql);
  const seeded = f.recordset[0]?.m == null ? 0 : Number(f.recordset[0].m);
  await setWatermark(pool, key, seeded);
  return seeded;
}

async function setWatermark(pool: ConnectionPool, key: string, value: number): Promise<void> {
  await pool
    .request()
    .input('k', mssql.VarChar(64), key)
    .input('v', mssql.NVarChar(255), String(value))
    .query(
      `MERGE sms.app_config AS t
       USING (SELECT @k AS config_key) AS s ON t.config_key = s.config_key
       WHEN MATCHED THEN UPDATE SET config_value=@v, updated_at_utc=SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES (@k, @v);`,
    );
}

/** Reset the transform watermark(s) feeding a canonical table, so the next
 *  runTransform re-reads that stream's raw layer from the start. Used by the
 *  CLI rebuild command after it deletes the canonical rows. */
export async function resetTransformWatermarks(pool: ConnectionPool, table: string): Promise<void> {
  for (const key of WM_BY_TABLE[table] ?? []) await setWatermark(pool, key, 0);
}

// ---- batch helpers ----------------------------------------------------------

async function readRawSince(pool: ConnectionPool, table: string, watermark: number): Promise<Raw[]> {
  const r = await pool
    .request()
    .input('wm', mssql.BigInt, watermark)
    .query(`SELECT * FROM ${table} WHERE raw_id > @wm ORDER BY raw_id`);
  return r.recordset as Raw[];
}

const maxRawId = (rows: Raw[]): number => rows.reduce((m, r) => Math.max(m, Number(r.raw_id)), 0);

async function maxCanonicalTs(pool: ConnectionPool, table: string): Promise<number> {
  const r = await pool
    .request()
    .query<{ m: number | null }>(`SELECT MAX(production_ts_utc_ms) m FROM ${table}`);
  return r.recordset[0]?.m == null ? -Infinity : Number(r.recordset[0].m);
}

/**
 * Cross-batch merge-key collision seeding. For every batch row whose merge
 * key already exists in canonical, shift the batch's ingest_seq past the
 * existing maximum and clear merge_key_is_unique — otherwise the bulk insert
 * violates the UX_*_merge unique index and the pass wedges on this batch.
 * The scan is bounded to canonical rows at/after the batch's earliest
 * timestamp: batches are recent, so this window is small on live.
 */
async function seedExistingCollisions<T extends { production_ts_utc_ms: number; ingest_seq: number }>(
  pool: ConnectionPool,
  table: string,
  rows: T[],
  keyFn: (r: T) => string,
  keyExprSql: string, // SQL expression producing the same key string as keyFn
): Promise<void> {
  if (rows.length === 0) return;
  const minTs = rows.reduce((m, r) => Math.min(m, r.production_ts_utc_ms), Infinity);
  const r = await pool
    .request()
    .input('minTs', mssql.BigInt, minTs)
    .query<{ k: string; max_seq: number }>(
      `SELECT ${keyExprSql} k, MAX(ingest_seq) max_seq
       FROM ${table} WHERE production_ts_utc_ms >= @minTs
       GROUP BY ${keyExprSql}`,
    );
  if (r.recordset.length === 0) return;
  const existing = new Map(r.recordset.map((x) => [x.k, x.max_seq]));
  for (const row of rows) {
    const maxSeq = existing.get(keyFn(row));
    if (maxSeq != null) {
      row.ingest_seq += maxSeq + 1;
      if ('merge_key_is_unique' in row) {
        (row as { merge_key_is_unique: boolean }).merge_key_is_unique = false;
      }
    }
  }
}

// SQL twins of coneKey/sackKey/rejectKey in transform.ts — must stay in step.
const CONE_KEY_SQL = `CONCAT(production_ts_utc_ms, '|', ISNULL(CAST(hanger_num AS varchar(20)), ''))`;
const SACK_KEY_SQL = `CAST(production_ts_utc_ms AS varchar(20))`;
const REJECT_KEY_SQL = `CONCAT(reject_type, '|', production_ts_utc_ms, '|', ISNULL(CAST(hanger_num AS varchar(20)), ''))`;

export interface TransformOutcome {
  table: string;
  read: number;
  written: number;
  findings: Finding[];
}

export async function runTransform(
  appPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<TransformOutcome[]> {
  const runId = randomUUID();
  const out: TransformOutcome[] = [];

  // cones ---------------------------------------------------------------------
  {
    const wm = await getWatermark(appPool, WM_KEYS.cone, `SELECT MAX(raw_id) m FROM sms.cone_event`);
    const raw = await readRawSince(appPool, 'sms_raw.cone_raw', wm);
    if (raw.length === 0) {
      out.push({ table: 'cone_event', read: 0, written: 0, findings: [] });
    } else {
      const rows = await onlyFresh(
        appPool, 'sms.cone_event',
        assignMergeKeys(raw.map((r) => mapCone(r, cfg, runId)), coneKey),
      );
      await seedExistingCollisions(appPool, 'sms.cone_event', rows, coneKey, CONE_KEY_SQL);
      const priorMaxMs = await maxCanonicalTs(appPool, 'sms.cone_event');
      const findings = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g, priorMaxMs);
      const res = await persistCanonical(appPool, 'sms.cone_event', CONE_COLS, rows, {
        minSourceRowId: rows.length ? Math.min(...rows.map((r) => r.source_row_id)) : undefined,
      });
      await persistFindings(appPool, runId, findings);
      await setWatermark(appPool, WM_KEYS.cone, maxRawId(raw));
      out.push({ table: 'cone_event', read: raw.length, written: res.written, findings });
    }
  }

  // sacks ---------------------------------------------------------------------
  {
    const wm = await getWatermark(appPool, WM_KEYS.sack, `SELECT MAX(raw_id) m FROM sms.sack_event`);
    const raw = await readRawSince(appPool, 'sms_raw.sack_raw', wm);
    if (raw.length === 0) {
      out.push({ table: 'sack_event', read: 0, written: 0, findings: [] });
    } else {
      const rows = await onlyFresh(
        appPool, 'sms.sack_event',
        assignMergeKeys(raw.map((r) => mapSack(r, cfg, runId)), sackKey),
      );
      await seedExistingCollisions(appPool, 'sms.sack_event', rows, sackKey, SACK_KEY_SQL);
      const priorMaxMs = await maxCanonicalTs(appPool, 'sms.sack_event');
      const findings = computeFindings(rows, 'sack', 'sack_event', (r) => r.weight_kg, priorMaxMs);
      const res = await persistCanonical(appPool, 'sms.sack_event', SACK_COLS, rows, {
        minSourceRowId: rows.length ? Math.min(...rows.map((r) => r.source_row_id)) : undefined,
      });
      await persistFindings(appPool, runId, findings);
      await setWatermark(appPool, WM_KEYS.sack, maxRawId(raw));
      out.push({ table: 'sack_event', read: raw.length, written: res.written, findings });
    }
  }

  // rejects (two raw sources → one canonical) ---------------------------------
  {
    const wmQ = await getWatermark(appPool, WM_KEYS.reject_qcs, `SELECT MAX(raw_id) m FROM sms.reject_event WHERE reject_type='quality'`);
    const wmW = await getWatermark(appPool, WM_KEYS.reject_weight, `SELECT MAX(raw_id) m FROM sms.reject_event WHERE reject_type='weight'`);
    const qcs = await readRawSince(appPool, 'sms_raw.reject_qcs_raw', wmQ);
    const wt = await readRawSince(appPool, 'sms_raw.reject_weight_raw', wmW);
    if (qcs.length === 0 && wt.length === 0) {
      out.push({ table: 'reject_event', read: 0, written: 0, findings: [] });
    } else {
      const mapped = assignMergeKeys(
        [
          ...qcs.map((r) => mapReject(r, 'quality', cfg, runId)),
          ...wt.map((r) => mapReject(r, 'weight', cfg, runId)),
        ],
        rejectKey,
      );
      // quality and weight rejects share source_row_id spaces → freshness and
      // persistence are per type
      const qFresh = await onlyFresh(
        appPool, 'sms.reject_event',
        mapped.filter((r) => r.reject_type === 'quality'),
        "AND reject_type = 'quality'",
      );
      const wFresh = await onlyFresh(
        appPool, 'sms.reject_event',
        mapped.filter((r) => r.reject_type === 'weight'),
        "AND reject_type = 'weight'",
      );
      const rows = [...qFresh, ...wFresh];
      await seedExistingCollisions(appPool, 'sms.reject_event', rows, rejectKey, REJECT_KEY_SQL);
      // prior max BEFORE persisting, or the batch would be measured against itself
      const priorMaxMs = await maxCanonicalTs(appPool, 'sms.reject_event');
      const q = qFresh;
      const w = wFresh;
      const rq = await persistCanonical(appPool, 'sms.reject_event', REJECT_COLS, q, {
        extraExistingFilter: "AND reject_type = 'quality'",
        minSourceRowId: q.length ? Math.min(...q.map((r) => r.source_row_id)) : undefined,
      });
      const rw = await persistCanonical(appPool, 'sms.reject_event', REJECT_COLS, w, {
        extraExistingFilter: "AND reject_type = 'weight'",
        minSourceRowId: w.length ? Math.min(...w.map((r) => r.source_row_id)) : undefined,
      });
      const findings = computeFindings(w, 'reject', 'reject_event', (r) => r.weight_g, priorMaxMs);
      await persistFindings(appPool, runId, findings);
      if (qcs.length > 0) await setWatermark(appPool, WM_KEYS.reject_qcs, maxRawId(qcs));
      if (wt.length > 0) await setWatermark(appPool, WM_KEYS.reject_weight, maxRawId(wt));
      out.push({
        table: 'reject_event',
        read: qcs.length + wt.length,
        written: rq.written + rw.written,
        findings,
      });
    }
  }

  // keep the reject-code lookup populated with any new code pairs (labels pending Q10)
  await seedRejectCodes(appPool);

  return out;
}
