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
import { shiftBoundariesFrom, DEFAULT_SHIFT_BOUNDARIES, type NightBelongsTo, type ShiftMode } from '@sms/shared';
import type { SyncConfig } from '../config.js';
import { rawShortName, TABLE_SHAPES } from '../reader/iflTables.js';
import { loadSourceStreams } from '../reader/sourceTables.js';
import {
  mapCone,
  mapSack,
  mapReject,
  assignMergeKeys,
  coneKey,
  sackKey,
  rejectKey,
  type ShiftRule,
  type TransformRules,
} from './transform.js';
import {
  persistCanonical,
  existingRawIds,
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
/**
 * Lowest raw_id in a batch, by reduce and NOT by a spread into Math.min:
 * a fresh app database hands the transform the whole history in one batch
 * (142,511 cone rows on the July copy), and spreading that many arguments
 * overflows the call stack. This crashed the first backfill — the go-live
 * cutover path — while every incremental pass, at ~500 rows, sailed through.
 * persistRaw.ts found the identical bug earlier; this is the same fix.
 */
function minRawId(rows: ReadonlyArray<{ raw_id: number }>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const r of rows) if (r.raw_id < min) min = r.raw_id;
  return min;
}

/** Exposed for the regression test (finding H11, Sep 2026 audit): this
 *  function shipped with zero test coverage despite being the exact site of
 *  the 142,511-row stack overflow fixed in e86357f. */
export const __minRawIdForTest = minRawId;

/** Rows not yet in canonical, by raw_id — see existingRawIds for why not source_row_id. */
async function onlyFresh<T extends { raw_id: number }>(
  pool: ConnectionPool,
  table: string,
  sourceSystem: string,
  rows: T[],
  extraFilter = '',
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const seen = await existingRawIds(pool, table, sourceSystem, extraFilter, minRawId(rows));
  return rows.filter((r) => !seen.has(Number(r.raw_id)));
}
import {
  computeFindings,
  persistFindings,
  stationRosterFindings,
  PER_SUBJECT_CHECKS,
  detectSackBlackouts,
  loadNewestSack,
  loadPriorSackNums,
  sackNumResetFindings,
  type Finding,
  type StationRoster,
} from './dq.js';
import { seedRejectCodes } from './seedRejectCodes.js';
import {
  loadShiftRuleHistory,
  resolveShiftRuleAt,
  loadPlausibilityRuleHistory,
  resolvePlausibilityAt,
} from './ruleHistory.js';
import { checkShiftRuleDrift } from './shiftRuleDrift.js';
import { checkIsolatedProductionDay } from './isolatedDay.js';

type Raw = Record<string, unknown>;

/**
 * The raw row's own event instant, on the plant wall-clock convention — the
 * same field mapCone/mapSack/mapReject themselves read for production_ts.
 * Used to resolve the shift rule in force for THIS row (see rulesForRow,
 * below, in runTransform), independently of mapCone/mapSack/mapReject's own
 * (separate) copy of the same null-coalesce in transform.ts.
 *
 * Before this fix: a raw row missing BOTH src_ProductionDate and src_Date
 * (usesProductionDate=true) or missing src_Date (usesProductionDate=false)
 * produced `dt === undefined`, and `.getTime()` on that threw an unhandled
 * `TypeError: Cannot read properties of undefined (reading 'getTime')` —
 * naming neither the row nor the table, indistinguishable from a real code
 * bug. It now throws a plain Error naming the row's own raw_id and its
 * source table, the same way this file already reports other malformed rule
 * data (see resolveShiftRule / loadShiftRuleHistory's thrown Errors). It
 * still throws rather than skipping the row: a cone/sack/reject with no
 * usable time cannot be shift-resolved OR safely dropped silently — that
 * would remove a real production reading from canonical with no record of
 * why. The batch retries (nothing is watermarked or written yet at this
 * point) until whoever owns the data fixes or excludes the row.
 */
export function eventMsOfRaw(raw: Raw, usesProductionDate: boolean, rawTable: string): number {
  const dt = (usesProductionDate ? (raw.src_ProductionDate ?? raw.src_Date) : raw.src_Date) as
    | Date
    | null
    | undefined;
  if (dt == null) {
    const missing = usesProductionDate ? 'src_ProductionDate and src_Date are both' : 'src_Date is';
    throw new Error(
      `Raw row raw_id=${String(raw.raw_id)} in ${rawTable} has no usable event time (${missing} null) — ` +
        `cannot resolve the shift rule in force for it. Fix or exclude this row before transform can proceed.`,
    );
  }
  return dt.getTime();
}

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

/**
 * One row per check per pass, not one per reject stream.
 *
 * The quality and weight streams are checked separately (each has its own
 * source-id ordering, which the stale-clock test depends on), but they land in
 * ONE canonical table. Persisting both results verbatim wrote two
 * `no_station` rows for `reject_event` on the same pass, and Operations
 * counts dq_finding ROWS by severity — so a single fault was reported twice.
 * Counts are summed and both details kept, so the split stays visible.
 *
 * Per-subject checks (PER_SUBJECT_CHECKS) pass through untouched: a
 * `station_not_in_roster` finding is one per (machine, source table,
 * generation) by design, and the two reject streams are two source tables.
 */
function mergeByCheck(...groups: Finding[][]): Finding[] {
  const out = new Map<string, Finding>();
  const passThrough: Finding[] = [];
  for (const f of groups.flat()) {
    if (PER_SUBJECT_CHECKS.has(f.check_name)) {
      passThrough.push(f);
      continue;
    }
    const prev = out.get(f.check_name);
    if (!prev) {
      out.set(f.check_name, { ...f });
      continue;
    }
    prev.count += f.count;
    prev.detail = `${prev.detail} | ${f.detail}`;
  }
  return [...out.values(), ...passThrough];
}

/**
 * The shift rule currently on file, read fresh from sms.shift_rule at the
 * start of every pass: the three boundaries, the night-attribution rule and
 * the mode (Q7, still open — carried, not applied).
 *
 * Fixes finding H5 (Sep 2026 audit) and finishes it (roadmap Phase 1, 14 Sep
 * 2026): admin.ts's /api/admin/rules/shift wrote this table and told the
 * caller "rebuild canonical to apply" — but the transform is a pure, DB-free
 * mapping (by design: see transform.ts) that only ever read
 * cfg.appConfig.shift.nightBelongsTo, itself frozen from the
 * SHIFT_NIGHT_BELONGS_TO env var at process startup. A rebuild after using
 * that endpoint re-derived the OLD rule, silently. The first fix read the
 * night rule from the row; the boundaries stayed a shared constant, so a
 * rule with different start times was half-applied. Now the whole row is
 * the rule.
 *
 * TIME columns come back as 'HH:MM' (CONVERT style 108, five characters) and
 * go through the shared validator, so a row whose times are not
 * morning < evening < night — impossible through the API, possible in SSMS —
 * stops the pass with a message rather than stamping rows with a rule that
 * has no night. Falls back to the env default with the seed boundaries only
 * when the table has no row for the line (a fresh install before
 * seedReference has run), matching the plausibility rule's fallback in
 * api/src/services/admin.ts.
 */
export async function resolveShiftRule(
  pool: ConnectionPool,
  lineId: number,
  fallback: { nightBelongsTo: NightBelongsTo; mode: ShiftMode },
): Promise<ShiftRule> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ ms: string; es: string; ns: string; nb: NightBelongsTo; mode: ShiftMode }>(
      `SELECT TOP 1 CONVERT(varchar(5), morning_start, 108) ms,
              CONVERT(varchar(5), evening_start, 108) es,
              CONVERT(varchar(5), night_start, 108) ns,
              night_belongs_to nb, mode
         FROM sms.shift_rule WHERE line_id=@line ORDER BY effective_from DESC`,
    );
  const row = r.recordset[0];
  if (!row) {
    // Seed values (Q8, confirmed 06/14/22) — the fallback only until
    // seedReference writes the first rule row for this line.
    return { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: fallback.nightBelongsTo, mode: fallback.mode };
  }
  const boundaries = shiftBoundariesFrom(row.ms, row.es, row.ns);
  if (!boundaries) {
    throw new Error(
      `The shift rule on file for line ${lineId} is not usable: morning ${row.ms}, evening ${row.es}, ` +
        `night ${row.ns} must be three HH:MM times in increasing order. Fix it in Setup › Rules ` +
        `(sms.shift_rule) — nothing is transformed under a rule that has no night.`,
    );
  }
  return { boundaries, nightBelongsTo: row.nb ?? fallback.nightBelongsTo, mode: row.mode ?? fallback.mode };
}

/**
 * The line's station ids, once per pass, for the roster check. Every station
 * row on the line counts, active or not: a reading from a station marked
 * inactive in Setup is still a reading from a station the line HAS, and
 * telling an operator to "add it in Setup › Machines" would be wrong advice.
 */
async function loadStationRoster(pool: ConnectionPool, lineId: number): Promise<StationRoster> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ station_id: number }>(`SELECT station_id FROM sms.station WHERE line_id = @line`);
  return { lineId, stations: new Set(r.recordset.map((x) => Number(x.station_id))) };
}

// ---- batch helpers ----------------------------------------------------------

/**
 * `SELECT *`, deliberately: the mappers need every src_ column, and since
 * roadmap Phase 3 they also copy the raw row's OWN `ingest_run_id` and
 * `read_at_utc` onto the canonical row as its provenance. Narrowing this to a
 * column list would have to keep those two, and transform.ts's
 * provenanceOfRaw throws if they are missing rather than inventing them.
 */
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
async function seedExistingCollisions<
  T extends { production_ts_utc_ms: number; ingest_seq: number; source_epoch: number },
>(
  pool: ConnectionPool,
  table: string,
  rows: T[],
  keyFn: (r: T) => string,
  keyExprSql: string, // SQL expression producing the same key string as keyFn
): Promise<void> {
  if (rows.length === 0) return;
  const minTs = rows.reduce((m, r) => Math.min(m, r.production_ts_utc_ms), Infinity);
  // Scoped to the generations actually present in this batch. Two reasons:
  // the key includes the epoch, so rows from other generations can never
  // collide and scanning them is waste; and both IFL copies carry a
  // 1970-01-01 clock-fault row on pack1, so on a full backfill minTs
  // degenerates to the Unix epoch and the GROUP BY would otherwise sweep the
  // whole canonical table.
  const epochs = [...new Set(rows.map((r) => r.source_epoch))];
  const req = pool.request().input('minTs', mssql.BigInt, minTs);
  epochs.forEach((e, i) => req.input(`e${i}`, mssql.Int, e));
  const inList = epochs.map((_, i) => `@e${i}`).join(', ');
  const r = await req.query<{ k: string; max_seq: number }>(
    `SELECT ${keyExprSql} k, MAX(ingest_seq) max_seq
     FROM ${table}
     WHERE production_ts_utc_ms >= @minTs AND source_epoch IN (${inList})
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
const CONE_KEY_SQL = `CONCAT(production_ts_utc_ms, '|', ISNULL(CAST(hanger_num AS varchar(20)), ''), '|', source_epoch)`;
const SACK_KEY_SQL = `CONCAT(production_ts_utc_ms, '|', source_epoch)`;
const REJECT_KEY_SQL = `CONCAT(reject_type, '|', production_ts_utc_ms, '|', ISNULL(CAST(hanger_num AS varchar(20)), ''), '|', source_epoch)`;

/**
 * The transform must never advance its watermark past rows it did not write.
 *
 * `fresh` is what onlyFresh said was NOT yet in canonical; `written` is what
 * the bulk insert actually landed. If the first is non-zero and the second is
 * zero, rows were dropped between the two — and advancing the watermark would
 * mark them transformed forever. Under the old source_row_id dedupe that is
 * exactly how a whole generation vanished silently (every September row
 * "already seen", watermark advanced, never revisited). Keyed on raw_id it
 * should now be unreachable; if it is reached, that is a defect to stop on.
 *
 * Note what this is NOT: fresh === 0 with raw rows present is legitimate
 * (a crash between persist and setWatermark re-reads rows that are already
 * in canonical) and the watermark should advance.
 */
async function guardZeroWrite(
  pool: ConnectionPool,
  runId: string,
  table: string,
  fresh: number,
  written: number,
): Promise<void> {
  if (fresh === 0 || written > 0) return;
  const detail =
    `${fresh} rows for ${table} were not yet in canonical but the insert wrote none of them. ` +
    `Watermark NOT advanced so they are retried; investigate before it advances.`;
  await persistFindings(pool, runId, [
    { check_name: 'transform_zero_write', severity: 'CRITICAL', subject_table: table, count: fresh, detail },
  ]);
  throw new Error(detail);
}

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
  // The transform pass's own id is for its dq_finding rows only. Canonical
  // rows carry the RAW row's ingest_run_id (roadmap Phase 3) so that
  // canonical → sync_run is a join that returns rows; a per-transform UUID
  // written to no other table was the reason it never did (migration 029).
  const runId = randomUUID();
  const out: TransformOutcome[] = [];

  // Configuration, resolved once per pass (roadmap Phase 1): each kind's
  // system code and source table name come from sms.source_table, and the
  // station roster is what the line has rows for.
  const streams = await loadSourceStreams(appPool, cfg.lineId);
  const roster = await loadStationRoster(appPool, cfg.lineId);
  // RT24-04 (23 Sep 2026 red-team audit, transform side, fixed 24 Sep 2026):
  // resolveShiftRule/loadPlausibilityRule (still below, kept for other
  // callers) each read only the NEWEST version and applied it to every row in
  // the pass regardless of that row's own production time — so a rebuild
  // after an admin edits a rule in Setup bakes TODAY's rule into stored
  // shift_code/shift_date/outlier_weight for readings from BEFORE the edit.
  // ruleHistory.ts loads every version once per pass; each row below is
  // stamped with the version in force at ITS OWN production time.
  const shiftHistory = await loadShiftRuleHistory(appPool, cfg.lineId, cfg.appConfig.shift);
  const plausibilityHistory = await loadPlausibilityRuleHistory(appPool, cfg.lineId);
  const plausibilityAt = (productionMs: number) => resolvePlausibilityAt(plausibilityHistory, productionMs);
  // Everything EXCEPT the shift rule — that is resolved per row, below,
  // from each raw row's OWN event time (see eventMsOfRaw / rulesForRow).
  const baseRulesFor = (kind: keyof typeof streams): Omit<TransformRules, 'shift'> => ({
    lineId: cfg.lineId,
    sourceSystem: streams[kind].systemCode,
  });
  const rulesForRow = (
    base: Omit<TransformRules, 'shift'>,
    raw: Raw,
    usesProductionDate: boolean,
    rawTable: string,
  ): TransformRules => ({
    ...base,
    shift: resolveShiftRuleAt(shiftHistory, eventMsOfRaw(raw, usesProductionDate, rawTable)),
  });

  // cones ---------------------------------------------------------------------
  {
    const wm = await getWatermark(appPool, WM_KEYS.cone, `SELECT MAX(raw_id) m FROM sms.cone_event`);
    const raw = await readRawSince(appPool, TABLE_SHAPES.cone.rawTable, wm);
    if (raw.length === 0) {
      out.push({ table: 'cone_event', read: 0, written: 0, findings: [] });
    } else {
      const rules = baseRulesFor('cone');
      const rows = await onlyFresh(
        appPool, 'sms.cone_event', rules.sourceSystem,
        assignMergeKeys(raw.map((r) => mapCone(r, rulesForRow(rules, r, true, TABLE_SHAPES.cone.rawTable))), coneKey),
      );
      await seedExistingCollisions(appPool, 'sms.cone_event', rows, coneKey, CONE_KEY_SQL);
      const priorMaxMs = await maxCanonicalTs(appPool, 'sms.cone_event');
      const findings = [
        ...computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g, priorMaxMs, plausibilityAt),
        ...stationRosterFindings(rows, roster, rawShortName(TABLE_SHAPES.cone.rawTable), streams.cone.sourceTable),
      ];
      const res = await persistCanonical(appPool, 'sms.cone_event', CONE_COLS, rows, {
        sourceSystem: rules.sourceSystem,
        minRawId: rows.length ? minRawId(rows) : undefined,
      });
      await persistFindings(appPool, runId, findings);
      await guardZeroWrite(appPool, runId, 'cone_event', rows.length, res.written);
      await setWatermark(appPool, WM_KEYS.cone, maxRawId(raw));
      out.push({ table: 'cone_event', read: raw.length, written: res.written, findings });
    }
  }

  // sacks ---------------------------------------------------------------------
  {
    const wm = await getWatermark(appPool, WM_KEYS.sack, `SELECT MAX(raw_id) m FROM sms.sack_event`);
    const raw = await readRawSince(appPool, TABLE_SHAPES.sack.rawTable, wm);
    // The newest canonical sack BEFORE this batch lands: the anchor the
    // blackout check measures the batch's first gap from, and — when the
    // batch is empty — the start of the open gap that catches a total sack
    // blackout (roadmap Phase 7, 15 Sep 2026; dq.ts sackBlackoutFindings).
    const priorSack = await loadNewestSack(appPool, cfg.lineId);
    if (raw.length === 0) {
      // No new sack rows is exactly the case the blackout check exists for:
      // it is judged against the cones, which the block above just persisted.
      const findings = await detectSackBlackouts(appPool, cfg.lineId, [], priorSack, cfg.sackBlackoutHours);
      await persistFindings(appPool, runId, findings);
      out.push({ table: 'sack_event', read: 0, written: 0, findings });
    } else {
      const rules = baseRulesFor('sack');
      const rows = await onlyFresh(
        appPool, 'sms.sack_event', rules.sourceSystem,
        assignMergeKeys(raw.map((r) => mapSack(r, rulesForRow(rules, r, false, TABLE_SHAPES.sack.rawTable))), sackKey),
      );
      await seedExistingCollisions(appPool, 'sms.sack_event', rows, sackKey, SACK_KEY_SQL);
      const priorMaxMs = await maxCanonicalTs(appPool, 'sms.sack_event');
      // No roster check: sack rows carry no machine number (iflTables.ts).
      // The two sack checks (Phase 7): a SackNum reset within a generation,
      // seeded from each generation's newest canonical row; and a gap in the
      // sack stream while cones were being weighed.
      const priorSackNums = await loadPriorSackNums(appPool, cfg.lineId, rows.map((r) => r.source_epoch));
      const findings = [
        ...computeFindings(rows, 'sack', 'sack_event', (r) => r.weight_kg, priorMaxMs, plausibilityAt),
        ...sackNumResetFindings(rows, priorSackNums),
        ...(await detectSackBlackouts(appPool, cfg.lineId, rows, priorSack, cfg.sackBlackoutHours)),
      ];
      const res = await persistCanonical(appPool, 'sms.sack_event', SACK_COLS, rows, {
        sourceSystem: rules.sourceSystem,
        minRawId: rows.length ? minRawId(rows) : undefined,
      });
      await persistFindings(appPool, runId, findings);
      await guardZeroWrite(appPool, runId, 'sack_event', rows.length, res.written);
      await setWatermark(appPool, WM_KEYS.sack, maxRawId(raw));
      out.push({ table: 'sack_event', read: raw.length, written: res.written, findings });
    }
  }

  // rejects (two raw sources → one canonical) ---------------------------------
  {
    const wmQ = await getWatermark(appPool, WM_KEYS.reject_qcs, `SELECT MAX(raw_id) m FROM sms.reject_event WHERE reject_type='quality'`);
    const wmW = await getWatermark(appPool, WM_KEYS.reject_weight, `SELECT MAX(raw_id) m FROM sms.reject_event WHERE reject_type='weight'`);
    const qcs = await readRawSince(appPool, TABLE_SHAPES.reject_qcs.rawTable, wmQ);
    const wt = await readRawSince(appPool, TABLE_SHAPES.reject_weight.rawTable, wmW);
    if (qcs.length === 0 && wt.length === 0) {
      out.push({ table: 'reject_event', read: 0, written: 0, findings: [] });
    } else {
      // Two raw streams, two source tables: each keeps its own system code.
      const qRules = baseRulesFor('reject_qcs');
      const wRules = baseRulesFor('reject_weight');
      const mapped = assignMergeKeys(
        [
          ...qcs.map((r) => mapReject(r, 'quality', rulesForRow(qRules, r, true, TABLE_SHAPES.reject_qcs.rawTable))),
          ...wt.map((r) => mapReject(r, 'weight', rulesForRow(wRules, r, true, TABLE_SHAPES.reject_weight.rawTable))),
        ],
        rejectKey,
      );
      // quality and weight rejects share source_row_id spaces → freshness and
      // persistence are per type
      const qFresh = await onlyFresh(
        appPool, 'sms.reject_event', qRules.sourceSystem,
        mapped.filter((r) => r.reject_type === 'quality'),
        "AND reject_type = 'quality'",
      );
      const wFresh = await onlyFresh(
        appPool, 'sms.reject_event', wRules.sourceSystem,
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
        sourceSystem: qRules.sourceSystem,
        extraExistingFilter: "AND reject_type = 'quality'",
        minRawId: q.length ? minRawId(q) : undefined,
      });
      const rw = await persistCanonical(appPool, 'sms.reject_event', REJECT_COLS, w, {
        sourceSystem: wRules.sourceSystem,
        extraExistingFilter: "AND reject_type = 'weight'",
        minRawId: w.length ? minRawId(w) : undefined,
      });
      // Finding H7 (Sep 2026 audit): this used to check ONLY the weight-type
      // batch — quality rejects (2,900 of the real 19-day copy's 3,146, ~12x
      // the weight-type count) never had future/stale-clock/no-station/
      // collision checks run on them at all. Checked as two separate calls,
      // not one on the concatenated array: q and w are independent raw
      // streams with their own source-id ordering, and the stale-clock check
      // assumes rows arrive in that order — interleaving two differently-
      // ordered streams would produce false positives, not a stricter check.
      const findings = mergeByCheck(
        computeFindings(q, 'reject', 'reject_event', (r) => r.weight_g, priorMaxMs, plausibilityAt),
        computeFindings(w, 'reject', 'reject_event', (r) => r.weight_g, priorMaxMs, plausibilityAt),
        stationRosterFindings(q, roster, rawShortName(TABLE_SHAPES.reject_qcs.rawTable), streams.reject_qcs.sourceTable),
        stationRosterFindings(w, roster, rawShortName(TABLE_SHAPES.reject_weight.rawTable), streams.reject_weight.sourceTable),
      );
      await persistFindings(appPool, runId, findings);
      await guardZeroWrite(appPool, runId, 'reject_event', q.length, rq.written);
      await guardZeroWrite(appPool, runId, 'reject_event', w.length, rw.written);
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

  // keep the reject-code lookup populated with any new code pairs (labels
  // pending Q10) — for THIS line only, since migration 028 keyed codes per line.
  await seedRejectCodes(appPool, cfg.lineId);

  // RT24-04's drift check: read-only, line-wide (not per stream), so it runs
  // once at the end of the pass rather than inside any one of the three
  // blocks above. No-op inside checkShiftRuleDrift itself when the line has
  // only one shift_rule version on file.
  const driftFindings = await checkShiftRuleDrift(appPool, cfg.lineId, shiftHistory);
  await persistFindings(appPool, runId, driftFindings);

  // RT24-09 (24 Sep 2026): read-only, line-wide, same reason as the drift
  // check above — one GROUP BY over sms.cone_event per pass, not per stream.
  const isolatedDayFindings = await checkIsolatedProductionDay(appPool, cfg.lineId);
  await persistFindings(appPool, runId, isolatedDayFindings);

  return out;
}
