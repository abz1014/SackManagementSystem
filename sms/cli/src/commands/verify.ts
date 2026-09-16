/**
 * `sms verify` — reconcile source ⇄ raw ⇄ canonical PER SOURCE GENERATION, then
 * summarise merge-key collisions and DQ findings. Read-only on both databases.
 *
 * WHY PER GENERATION. IFL restarts its `id` counter whenever it recreates a
 * table (2026-08-05: all four wide tables, identities back to 1), so the app
 * database holds generations of the same source table side by side
 * (`sms.source_epoch`) while the source itself holds only the newest. The
 * previous verify compared whole tables — COUNT(source) = COUNT(raw) =
 * COUNT(canonical) — which is permanently MISMATCH the moment raw carries two
 * generations. An alarm that is always on is no alarm: a genuine loss of
 * 130,000 rows would have looked identical to the expected noise.
 *
 * WHAT IT ASSERTS, per source table:
 *
 *   1. The OPEN epoch against the live source — the only place the source is
 *      the authority. The source's create_date and column fingerprint must be
 *      the ones the epoch row records (otherwise the epoch describes a
 *      different physical table and every number below it is meaningless), and
 *      COUNT, MIN(id), MAX(id) AND SUM(id) must agree between the source table
 *      and `sms_raw.<t> WHERE source_epoch = <open>`. The sum catches the
 *      equal-missing/equal-extra case that COUNT alone passes. Any difference
 *      is a STOP. No open epoch at all is a STOP too: the worker halts on the
 *      same fact, so nothing is being synced.
 *
 *   2. CLOSED epochs — the source cannot corroborate them. They are reported as
 *      archived and only raw ⇄ canonical is checked.
 *
 *   3. raw ⇄ canonical BY KEY (`raw_id`), both directions, for every epoch. A
 *      count match can hide one row missing and one row duplicated.
 *
 * Exit 0 only when every table has an open epoch that reconciles and every
 * raw ⇄ canonical check is clean. Against a running worker the source can be a
 * few rows ahead of raw at any instant (the acquisition lag is ~18 min, the
 * pass is every 60 s); that is reported as a STOP with the reason, and the cure
 * is to re-run once the pass has settled — never to widen the tolerance.
 *
 * `--weights` (roadmap Phase 4 item 3, 14 Sep 2026) adds the WEIGHT
 * reconciliation the id checksum cannot give: per open generation and per
 * source table that carries a weight column, COUNT, SUM, AVG, MIN and MAX of
 * the source's `Weight` against raw's `src_Weight` against canonical's
 * `weight_g` / `weight_kg` — same units end to end, no conversion in the
 * transform. Equal ids with a weight altered in flight would pass the checksum
 * and fail this. Aggregate SELECTs only, on the same read-only pool.
 *
 * THE ARCHIVED FLOOR (16 Sep 2026). Point 1 above compared the WHOLE source
 * table, no predicate. The sidecar's reason to exist is to keep what IFL
 * discards after about a month, so the day IFL prunes even its first row,
 * COUNT/MIN/SUM all disagree, forever — the worst place for this to fail is
 * live, at cutover, in front of the client. `sms.source_epoch.archived_below_id`
 * (migration 037) is the lowest id the sync worker has, on some past pass,
 * actually observed the source still holding (sync-worker/src/epoch.ts,
 * `observeArchivedFloor`) — when it is set, the open epoch's id checksum is
 * compared over `[archived_below_id, ∞)` instead of the whole table, and the
 * raw rows below it are reported as an ACCOUNTED-FOR remainder, with the date
 * they were first observed archived, rather than as a discrepancy. NULL (no
 * observation yet) is the old whole-table comparison, unchanged. A source MIN
 * that has fallen BELOW the recorded floor is not archiving — ids do not come
 * back once pruned — and is still a STOP, named as a reseed/restore/rebuild.
 *
 * `--from=<production day> --to=<production day>` (both YYYY-MM-DD, inclusive)
 * scopes the open epoch's id checksum to a production-day window instead of an
 * id range — the shape of question an acceptance engineer actually asks
 * ("reconcile last week against our own SELECT"), run beside IFL's own query at
 * the FAT. Production timestamps are the plant's wall clock (the Two Clocks
 * rule) and the acquisition lag is ~18 minutes, so a row from the last minutes
 * of the window may not have arrived yet — a boundary mismatch there is not
 * necessarily a real one; the output says so and names the window it used.
 */
import mssql from 'mssql';
import type { ConnectionPool } from 'mssql';
import {
  loadSourceTables,
  readSourceIdentity,
  type IflTableDef,
  type SourceIdentity,
} from '@sms/sync-worker';
import { openContext, parseArgs } from '../context.js';

type TableDef = IflTableDef;

/** Where each raw table lands in canonical. reject_event is fed by TWO raw tables. */
const CANONICAL: Record<TableDef['key'], { table: string; typeFilter: string }> = {
  cone: { table: 'sms.cone_event', typeFilter: '' },
  sack: { table: 'sms.sack_event', typeFilter: '' },
  reject_qcs: { table: 'sms.reject_event', typeFilter: "AND c.reject_type = 'quality'" },
  reject_weight: { table: 'sms.reject_event', typeFilter: "AND c.reject_type = 'weight'" },
};

/** A production-day window, EXCLUSIVE upper bound — `to` is the instant after
 *  the last requested day ends. Plant wall clock (Two Clocks rule): these are
 *  compared to ProductionDate/Date verbatim, never converted. */
interface Range {
  from: Date;
  to: Date;
}

/**
 * The production-timestamp column this table kind is judged by, matching
 * transform.ts exactly: `ProductionDate` for cone/reject; `Date` for sack,
 * which has no ProductionDate (SCHEMA DQ-5) — getting this wrong would make
 * `--from/--to` silently exclude every sack rather than error.
 */
function productionColumn(def: TableDef): { src: string; raw: string } {
  return def.columns.some((c) => c.src === 'ProductionDate')
    ? { src: 'ProductionDate', raw: 'src_ProductionDate' }
    : { src: 'Date', raw: 'src_Date' };
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

interface EpochRow {
  epoch_id: number;
  source_table: string;
  source_server: string;
  source_db: string;
  source_created_key: string;
  schema_fingerprint: string;
  provenance: string;
  label: string;
  closed_utc: Date | null;
  /** The archived floor (migration 037) — see the file header. NULL until the
   *  worker has made its first observation for this open generation. */
  archived_below_id: number | null;
  archived_observed_utc: Date | null;
}

/** The four numbers two sides must agree on. BIGINT arrives from the driver as a string. */
interface IdStats {
  n: number;
  lo: number | null;
  hi: number | null;
  sum: number | null;
}
const EMPTY: IdStats = { n: 0, lo: null, hi: null, sum: null };
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const IND = '           '; // continuation indent under "  epoch NN  "
const fmtN = (v: number | null): string => (v === null ? '–' : String(v)).padStart(12);

/* ------------------------------------------------ weights (--weights) */

/** COUNT, SUM, AVG, MIN, MAX of one weight column on one side. */
export interface WeightStats {
  n: number;
  sum: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
}
const NO_WEIGHTS: WeightStats = { n: 0, sum: null, avg: null, min: null, max: null };

/** The source's weight column, when the kind has one; sacks and cones weigh, quality rejects do not. */
function weightColumns(def: TableDef): { src: string; raw: string; canon: string } | null {
  const col = def.columns.find((c) => c.src === 'Weight');
  if (!col) return null;
  return { src: col.src, raw: col.raw, canon: def.key === 'sack' ? 'weight_kg' : 'weight_g' };
}

const aggSql = (col: string) =>
  `COUNT(${col}) n, SUM(CAST(${col} AS DECIMAL(18,3))) s, AVG(CAST(${col} AS DECIMAL(18,3))) a, MIN(${col}) lo, MAX(${col}) hi`;

const readStats = (x: { n: unknown; s: unknown; a: unknown; lo: unknown; hi: unknown } | undefined): WeightStats =>
  x ? { n: Number(x.n), sum: num(x.s), avg: num(x.a), min: num(x.lo), max: num(x.hi) } : NO_WEIGHTS;

async function sourceWeights(ifl: ConnectionPool, def: TableDef, col: string): Promise<WeightStats> {
  const r = await ifl.request().query<{ n: unknown; s: unknown; a: unknown; lo: unknown; hi: unknown }>(
    `SELECT ${aggSql(`[${col}]`)} FROM [${def.sourceTable}]`,
  );
  return readStats(r.recordset[0]);
}

async function rawWeights(app: ConnectionPool, def: TableDef, col: string, line: number, epoch: number): Promise<WeightStats> {
  const r = await app
    .request()
    .input('line', mssql.Int, line)
    .input('e', mssql.Int, epoch)
    .query<{ n: unknown; s: unknown; a: unknown; lo: unknown; hi: unknown }>(
      `SELECT ${aggSql(col)} FROM ${def.rawTable} WHERE line_id = @line AND source_epoch = @e`,
    );
  return readStats(r.recordset[0]);
}

async function canonicalWeights(app: ConnectionPool, def: TableDef, col: string, line: number, epoch: number): Promise<WeightStats> {
  const canon = CANONICAL[def.key];
  const r = await app
    .request()
    .input('line', mssql.Int, line)
    .input('e', mssql.Int, epoch)
    .query<{ n: unknown; s: unknown; a: unknown; lo: unknown; hi: unknown }>(
      `SELECT ${aggSql(`c.${col}`)} FROM ${canon.table} c WHERE c.line_id = @line AND c.source_epoch = @e ${canon.typeFilter}`,
    );
  return readStats(r.recordset[0]);
}

/**
 * Equal when COUNT, SUM, MIN and MAX agree exactly (they are exact decimals
 * on every side) and AVG agrees to a thousandth — the one figure that is
 * computed, and that a driver may hand back with a rounding of its own.
 */
export function sameWeights(a: WeightStats, b: WeightStats): boolean {
  const eq = (x: number | null, y: number | null) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 0.0005);
  return a.n === b.n && eq(a.sum, b.sum) && eq(a.min, b.min) && eq(a.max, b.max) && eq(a.avg, b.avg);
}

const fmtW = (v: number | null): string => (v === null ? '–' : v.toFixed(3)).padStart(14);
const weightLine = (label: string, w: WeightStats) =>
  `${IND}${label.padEnd(10)}${String(w.n).padStart(10)}${fmtW(w.sum)}${fmtW(w.avg)}${fmtW(w.min)}${fmtW(w.max)}`;

/**
 * The weight reconciliation for one table's generations. Returns how many
 * comparisons MISMATCHED. Open generations are compared source ⇄ raw ⇄
 * canonical; closed ones raw ⇄ canonical only, since the source no longer
 * holds them.
 */
export async function verifyWeights(
  ctx: { app: ConnectionPool; ifl: ConnectionPool },
  def: TableDef,
  epochs: { epoch_id: number; closed_utc: Date | null }[],
  line: number,
  sourceReadable: boolean,
): Promise<number> {
  const cols = weightColumns(def);
  if (!cols) {
    console.log(`${IND}weights    no weight column in ${def.sourceTable} — nothing to reconcile`);
    return 0;
  }
  let mismatches = 0;
  for (const e of epochs) {
    const raw = await rawWeights(ctx.app, def, cols.raw, line, e.epoch_id);
    const canon = await canonicalWeights(ctx.app, def, cols.canon, line, e.epoch_id);
    const open = e.closed_utc === null;
    console.log(`${IND}weights    epoch ${e.epoch_id} ${open ? 'OPEN' : 'closed'} — ${cols.src} → ${cols.raw} → ${cols.canon}`);
    console.log(`${IND}${''.padEnd(10)}${'count'.padStart(10)}${'sum'.padStart(14)}${'avg'.padStart(14)}${'min'.padStart(14)}${'max'.padStart(14)}`);
    if (open && sourceReadable) {
      const src = await sourceWeights(ctx.ifl, def, cols.src);
      console.log(weightLine('source', src));
      const ok = sameWeights(src, raw);
      console.log(`${weightLine('raw', raw)}   ${ok ? 'OK' : 'MISMATCH'}`);
      if (!ok) mismatches++;
    } else {
      console.log(weightLine('raw', raw) + (open ? '   (source not readable — not compared)' : ''));
    }
    const ok2 = sameWeights(raw, canon);
    console.log(`${weightLine('canonical', canon)}   ${ok2 ? 'OK' : 'MISMATCH'}`);
    if (!ok2) mismatches++;
  }
  return mismatches;
}

export interface VerifyArgs {
  weights: boolean;
  /** --from/--to: a production-day window (plant wall clock), given together
   *  or not at all. `to` is EXCLUSIVE — the instant after the last requested
   *  day ends — so a same-day window is `[from, from+1day)`. */
  from: Date | null;
  to: Date | null;
}

/** `sms verify [--weights] [--from=YYYY-MM-DD --to=YYYY-MM-DD]` */
export function parseVerifyArgs(args: string[]): VerifyArgs {
  const opts = parseArgs(args);
  const day = (key: 'from' | 'to'): Date | null => {
    const v = opts[key];
    if (v === undefined) return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new Error(
        `--${key} must be a production day as YYYY-MM-DD (the plant's wall clock, not a browser's local date), got "${String(v)}"`,
      );
    }
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`--${key}=${v} is not a real calendar day.`);
    return d;
  };
  const from = day('from');
  const toDay = day('to');
  if ((from === null) !== (toDay === null)) {
    throw new Error('--from and --to must be given together — a window needs both bounds.');
  }
  const to = toDay === null ? null : new Date(toDay.getTime() + 86_400_000); // exclusive: the day AFTER --to
  if (from !== null && to !== null && from >= to) {
    throw new Error(`--from must be on or before --to (got --from after --to).`);
  }
  return { weights: args.includes('--weights'), from, to };
}

async function sourceStats(ifl: ConnectionPool, def: TableDef, range: Range | null): Promise<IdStats> {
  const req = ifl.request();
  let where = '';
  if (range) {
    const col = productionColumn(def).src;
    req.input('from', mssql.DateTime, range.from).input('to', mssql.DateTime, range.to);
    where = ` WHERE [${col}] >= @from AND [${col}] < @to`;
  }
  const r = await req.query<{ n: number; lo: unknown; hi: unknown; s: unknown }>(
    `SELECT COUNT(*) n, MIN([id]) lo, MAX([id]) hi, SUM(CAST([id] AS BIGINT)) s
       FROM [${def.sourceTable}]${where}`,
  );
  const x = r.recordset[0];
  return x ? { n: Number(x.n), lo: num(x.lo), hi: num(x.hi), sum: num(x.s) } : EMPTY;
}

/** One scan of the raw table gives every epoch's WHOLE (unfiltered) stats at
 *  once — still drives the "Source generations" listing and, together with a
 *  floor-scoped rawStatsFiltered call, the archived remainder count. */
async function rawStatsByEpoch(
  app: ConnectionPool,
  def: TableDef,
  line: number,
): Promise<Map<number, IdStats>> {
  const r = await app
    .request()
    .input('line', mssql.Int, line)
    .query<{ e: number; n: number; lo: unknown; hi: unknown; s: unknown }>(
      `SELECT source_epoch e, COUNT(*) n, MIN(src_id) lo, MAX(src_id) hi,
              SUM(CAST(src_id AS BIGINT)) s
         FROM ${def.rawTable}
        WHERE line_id = @line
        GROUP BY source_epoch`,
    );
  return new Map(
    r.recordset.map((x) => [
      Number(x.e),
      { n: Number(x.n), lo: num(x.lo), hi: num(x.hi), sum: num(x.s) },
    ]),
  );
}

/**
 * Raw stats for ONE epoch, scoped to `id >= floor` (the archived floor) OR to
 * a production-day window — never both: the floor answers "what does
 * archiving account for", the window answers "what happened on these days",
 * and this tool has no case yet that asks both at once.
 */
async function rawStatsFiltered(
  app: ConnectionPool,
  def: TableDef,
  line: number,
  epoch: number,
  scope: { floor: number } | { range: Range },
): Promise<IdStats> {
  const req = app.request().input('line', mssql.Int, line).input('e', mssql.Int, epoch);
  let cond: string;
  if ('floor' in scope) {
    req.input('floor', mssql.BigInt, scope.floor);
    cond = 'src_id >= @floor';
  } else {
    const col = productionColumn(def).raw;
    req.input('from', mssql.DateTime, scope.range.from).input('to', mssql.DateTime, scope.range.to);
    cond = `[${col}] >= @from AND [${col}] < @to`;
  }
  const r = await req.query<{ n: number; lo: unknown; hi: unknown; s: unknown }>(
    `SELECT COUNT(*) n, MIN(src_id) lo, MAX(src_id) hi, SUM(CAST(src_id AS BIGINT)) s
       FROM ${def.rawTable}
      WHERE line_id = @line AND source_epoch = @e AND ${cond}`,
  );
  const x = r.recordset[0];
  return x ? { n: Number(x.n), lo: num(x.lo), hi: num(x.hi), sum: num(x.s) } : EMPTY;
}

/** raw → canonical and canonical → raw, by raw_id, within one epoch. */
async function keyGaps(
  app: ConnectionPool,
  def: TableDef,
  line: number,
  epoch: number,
): Promise<{ rawOnly: number; canonOnly: number }> {
  const canon = CANONICAL[def.key];
  const req = () => app.request().input('line', mssql.Int, line).input('e', mssql.Int, epoch);
  const a = await req().query<{ n: number }>(
    `SELECT COUNT(*) n FROM ${def.rawTable} r
      WHERE r.line_id = @line AND r.source_epoch = @e
        AND NOT EXISTS (SELECT 1 FROM ${canon.table} c
                         WHERE c.raw_id = r.raw_id ${canon.typeFilter})`,
  );
  const b = await req().query<{ n: number }>(
    `SELECT COUNT(*) n FROM ${canon.table} c
      WHERE c.line_id = @line AND c.source_epoch = @e ${canon.typeFilter}
        AND NOT EXISTS (SELECT 1 FROM ${def.rawTable} r WHERE r.raw_id = c.raw_id)`,
  );
  return { rawOnly: Number(a.recordset[0]?.n ?? 0), canonOnly: Number(b.recordset[0]?.n ?? 0) };
}

/**
 * Say WHICH way the open epoch disagrees with its source, over whatever range
 * was actually compared (`raw` may already be scoped to the archived floor or
 * to a --from/--to window — see verify() below). The directions mean
 * different things operationally, so they are named, not just counted.
 *
 * CORRECTED 16 Sep 2026 (part of "sms verify survives a prune"). The old
 * `weAhead` branch claimed unconditionally that "the worker's backwards gate
 * halts on this" — but that gate (runner.ts) tests `sourceMax < watermark`,
 * MAX(id) only, and deleting the source's OLDEST rows never moves MAX. Naming
 * the wrong gate here cost real operator time chasing a halt that could never
 * fire. Now that the id-comparison callers scope `raw` to what the source
 * COULD still hold (the archived floor, or a --from/--to window), a
 * `raw.lo < src.lo` mismatch here means something INSIDE the compared range —
 * not a bottom prune, which is filtered out before diagnose() ever runs — so
 * the backwards-gate claim is only made for the one shape that gate can
 * actually produce: our recorded top exceeding the source's current top.
 */
function diagnose(src: IdStats, raw: IdStats): string[] {
  const out: string[] = [];
  const lt = (a: number | null, b: number | null) => a !== null && b !== null && a < b;
  const sourceAhead = raw.n < src.n || lt(raw.hi, src.hi) || lt(src.lo, raw.lo) || (raw.n === 0 && src.n > 0);
  const topFell = lt(src.hi, raw.hi);
  const weAhead = raw.n > src.n || topFell || lt(raw.lo, src.lo);
  if (sourceAhead) {
    out.push(
      `→ the source has rows we do not (count ${raw.n - src.n >= 0 ? '+' : ''}${raw.n - src.n} on our side).`,
      `  If the worker is running they may not have arrived yet — re-run after its next pass.`,
      `  If it persists, the sync is incomplete or halted: check 'sms epoch:list' and sync_run.`,
    );
  }
  if (weAhead && topFell) {
    out.push(
      `→ our highest id (${raw.hi}) is ABOVE the source's current highest (${src.hi}): the source's top`,
      `  has fallen within an OPEN generation. That IS what the worker's watermark gate (its watermark`,
      `  vs the source's current MAX(id)) halts on — it will catch this on its next pass if it has not`,
      `  already. Read-only from here: an operator decides.`,
    );
  } else if (weAhead) {
    out.push(
      `→ we hold more rows than the source does, inside the compared range, with the SAME top id: a row`,
      `  exists on our side the source's current range does not, or the reverse. This is NOT what the`,
      `  watermark gate catches (MAX(id) alone; neither table's top moved) and NOT a bottom prune (that`,
      `  is excluded from this comparison already) — it needs an operator, not a re-run or a wider floor.`,
    );
  }
  if (!sourceAhead && !weAhead) {
    const d = (raw.sum ?? 0) - (src.sum ?? 0);
    out.push(
      `→ same count and id range, different ids (sum differs by ${d >= 0 ? '+' : ''}${d}): rows are`,
      `  missing on one side and extra on the other. COUNT alone would have passed this.`,
    );
  }
  return out;
}

export async function verify(args: string[] = []): Promise<number> {
  const { weights, from, to } = parseVerifyArgs(args);
  const range: Range | null = from && to ? { from, to } : null;
  const ctx = await openContext({ needIfl: true });
  const line = ctx.cfg.lineId;
  let stops = 0;
  let gapsChecked = 0;
  let weightMismatches = 0;
  const stop = (msg: string): void => {
    stops++;
    console.log(msg);
  };

  try {
    // (a) Which source, which app DB. An OK from a verify pointed at the wrong
    //     copy must not read like an OK against the live server.
    console.log('verify — source ⇄ raw ⇄ canonical, per source generation\n');
    console.log(`  source   ${ctx.cfg.iflData.server}/${ctx.cfg.iflData.database}`);
    console.log(`  app      ${ctx.cfg.app.server}/${ctx.cfg.app.database}   (line ${line})`);
    if (range) {
      console.log(
        `  window   ${isoDay(range.from)} .. ${isoDay(new Date(range.to.getTime() - 1))} (production day, plant wall clock)`,
      );
      console.log(
        `           acquisition lag is ~18 min — a row from the final minutes of the window may not have`,
      );
      console.log(
        `           arrived yet; a boundary mismatch there is not necessarily real. Re-run after the next`,
      );
      console.log(`           sync pass before treating it as one.`);
    }

    // The tables this line reads are configuration (sms.source_table, roadmap
    // Phase 1), loaded here as the worker loads them at the start of a pass.
    // A line with none is the same halt the worker records: there is nothing
    // to reconcile, and saying so is the verdict.
    const tables = await loadSourceTables(ctx.app, line);

    // (b) The generations this line knows about.
    const epochs = (
      await ctx.app.request().input('line', mssql.Int, line).query<EpochRow>(
        `SELECT epoch_id, source_table, source_server, source_db, source_created_key,
                schema_fingerprint, provenance, label, closed_utc,
                archived_below_id, archived_observed_utc
           FROM sms.source_epoch
          WHERE line_id = @line
          ORDER BY epoch_id`,
      )
    ).recordset;

    console.log('\nSource generations');
    console.log(
      `   ${'id'.padStart(3)}  ${'table'.padEnd(20)} ${'provenance'.padEnd(10)} ${'state'.padEnd(6)} ${'raw rows'.padStart(9)}  label`,
    );
    const rawStats = new Map<TableDef['key'], Map<number, IdStats>>();
    for (const def of tables) rawStats.set(def.key, await rawStatsByEpoch(ctx.app, def, line));
    for (const e of epochs) {
      const def = tables.find((d) => d.sourceTable === e.source_table);
      const rows = def ? (rawStats.get(def.key)?.get(e.epoch_id)?.n ?? 0) : 0;
      console.log(
        `   ${String(e.epoch_id).padStart(3)}  ${e.source_table.padEnd(20)} ${e.provenance.padEnd(10)} ` +
          `${(e.closed_utc === null ? 'OPEN' : 'closed').padEnd(6)} ${String(rows).padStart(9)}  ${e.label}`,
      );
    }
    if (epochs.length === 0) console.log('   (none registered for this line)');

    console.log('\nReconciliation');
    for (const def of tables) {
      const canon = CANONICAL[def.key];
      const mine = epochs.filter((e) => e.source_table === def.sourceTable);
      const stats = rawStats.get(def.key) ?? new Map<number, IdStats>();
      console.log(
        `\n${def.sourceTable} → ${def.rawTable} → ${canon.table}` +
          (canon.typeFilter ? ` (${def.key === 'reject_qcs' ? 'quality' : 'weight'})` : ''),
      );

      // Every raw row must sit under one of THIS table's generations. The FK only
      // proves the epoch exists, not that it belongs to this table.
      for (const [e, s] of stats) {
        if (!mine.some((x) => x.epoch_id === e)) {
          stop(`  ${s.n} raw rows carry source_epoch ${e}, which is not a generation of ${def.sourceTable}   STOP`);
        }
      }

      // What the source says it is right now — needed for the open epoch, and
      // for the message when there is none.
      let now: SourceIdentity | null = null;
      let identityError: string | null = null;
      try {
        now = await readSourceIdentity(ctx.ifl, def, ctx.cfg.iflData);
      } catch (err) {
        identityError = err instanceof Error ? err.message : String(err);
      }

      for (const e of mine) {
        const raw = stats.get(e.epoch_id) ?? EMPTY;

        if (e.closed_utc !== null) {
          // (d) The source cannot corroborate a closed generation.
          console.log(
            `  epoch ${String(e.epoch_id).padEnd(3)} closed  — archived — ${raw.n} rows, source generation no longer present`,
          );
        } else {
          // (c) The open generation against the live source.
          console.log(
            `  epoch ${String(e.epoch_id).padEnd(3)} OPEN    registered as ${e.source_server}/${e.source_db} created ${e.source_created_key}`,
          );
          if (now === null) {
            stop(`${IND}identity   cannot read the source: ${identityError}   STOP`);
          } else {
            const sameSource =
              now.server === e.source_server &&
              now.database === e.source_db &&
              now.createdKey === e.source_created_key;
            const sameSchema = now.fingerprint === e.schema_fingerprint;
            if (!sameSource) {
              stop(
                `${IND}identity   source reports ${now.server}/${now.database} created ${now.createdKey}   STOP\n` +
                  `${IND}→ not the generation this epoch describes; its counts cannot be compared. Check\n` +
                  `${IND}  IFL_DB_SERVER / IFL_DB_NAME_DATA first — a wrong database looks exactly like this.\n` +
                  `${IND}  If the source really was rebuilt or repointed:\n` +
                  `${IND}    sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
              );
            } else if (!sameSchema) {
              stop(
                `${IND}identity   create_date matches · fingerprint ${now.fingerprint} ≠ ${e.schema_fingerprint}   STOP\n` +
                  `${IND}→ the columns this app depends on changed under a live generation (schema drift).\n` +
                  `${IND}  Review the source schema; if intended: sms epoch:accept --table=${def.sourceTable} --confirm`,
              );
            } else {
              console.log(`${IND}identity   create_date matches · fingerprint matches   OK`);
            }

            if (sameSource) {
              // Part 2: --from/--to replaces the id range with a production-day
              // window. Part 1: otherwise, once the worker has observed a floor
              // for this generation, scope to [floor, ∞) instead of the whole
              // table — see the file header and epoch.ts's observeArchivedFloor.
              const floor = e.archived_below_id == null ? null : Number(e.archived_below_id);
              const src = await sourceStats(ctx.ifl, def, range);
              const cmp: IdStats = range
                ? await rawStatsFiltered(ctx.app, def, line, e.epoch_id, { range })
                : floor !== null
                  ? await rawStatsFiltered(ctx.app, def, line, e.epoch_id, { floor })
                  : raw;
              const same = src.n === cmp.n && src.lo === cmp.lo && src.hi === cmp.hi && src.sum === cmp.sum;
              const scope = range
                ? `window ${isoDay(range.from)}..${isoDay(new Date(range.to.getTime() - 1))}`
                : floor !== null
                  ? `id ≥ ${floor} (archived floor)`
                  : 'whole table';
              console.log(`${IND}compared over ${scope}`);
              console.log(`${IND}${''.padEnd(9)}${'count'.padStart(12)}${'min'.padStart(12)}${'max'.padStart(12)}${'sum'.padStart(12)}`);
              console.log(`${IND}source   ${fmtN(src.n)}${fmtN(src.lo)}${fmtN(src.hi)}${fmtN(src.sum)}`);
              if (same) {
                console.log(`${IND}raw      ${fmtN(cmp.n)}${fmtN(cmp.lo)}${fmtN(cmp.hi)}${fmtN(cmp.sum)}   OK`);
              } else {
                stop(
                  `${IND}raw      ${fmtN(cmp.n)}${fmtN(cmp.lo)}${fmtN(cmp.hi)}${fmtN(cmp.sum)}   STOP\n` +
                    diagnose(src, cmp).map((l) => `${IND}${l}`).join('\n'),
                );
              }

              // The remainder: raw rows below the floor, held on purpose, never
              // asked of the source. Reported as an accounted-for fact — this is
              // the whole point of Part 1 — with the date archiving was first
              // observed, not silently folded into either row above.
              if (!range && floor !== null) {
                const remainder = raw.n - cmp.n;
                const observed = e.archived_observed_utc ? new Date(e.archived_observed_utc).toISOString() : 'unknown';
                console.log(
                  `${IND}archived   ${remainder} row(s) held below id ${floor} — the source no longer holds ` +
                    `them; first observed ${observed}   (accounted for, not compared)`,
                );
                // Ids do not reappear once pruned. If the LIVE source's own min has
                // fallen below what was already recorded as archived, the worker's
                // own ratchet (observeArchivedFloor) has not yet caught a reseed —
                // this is the same fact as its halt, surfaced here too so a `verify`
                // run between sync passes does not read as a clean pass.
                if (src.lo !== null && src.lo < floor) {
                  stop(
                    `${IND}archived   the source's current MIN(id) is ${src.lo}, BELOW the recorded floor ${floor}   STOP\n` +
                      `${IND}→ ids do not come back once pruned: this is a reseed, a restore, or a rebuild — not\n` +
                      `${IND}  archiving. The worker halts on this too (observeArchivedFloor); if it has not run\n` +
                      `${IND}  since, it will on its next pass. If this really is a new generation:\n` +
                      `${IND}    sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
                  );
                }
              }
            }
          }
        }

        // (e) raw ⇄ canonical by key, every epoch, both directions.
        const gap = await keyGaps(ctx.app, def, line, e.epoch_id);
        gapsChecked++;
        const text = `${IND}raw ⇄ canonical   ${gap.rawOnly} raw without canonical · ${gap.canonOnly} canonical without raw`;
        if (gap.rawOnly === 0 && gap.canonOnly === 0) console.log(`${text}   OK`);
        else stop(`${text}   STOP`);
      }

      // (f) --weights: the weight aggregates, every generation of this table.
      if (weights) {
        weightMismatches += await verifyWeights(ctx, def, mine, line, now !== null);
      }

      if (!mine.some((e) => e.closed_utc === null)) {
        const reports = now
          ? `the source reports ${now.server}/${now.database} created ${now.createdKey} fp ${now.fingerprint}`
          : `and the source's identity could not be read: ${identityError}`;
        stop(
          `  OPEN      none — no open generation for ${def.sourceTable}; ${reports}   STOP\n` +
            `${IND}→ nothing is being reconciled against the source, and the worker halts on the same fact.\n` +
            `${IND}  Register it deliberately:  sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
        );
      }
    }

    // (g) Unchanged checks that still make sense across generations: the DQ-2
    //     collision flag is per canonical row, and findings are what they are.
    const collisions = await ctx.app
      .request()
      .query<{ n: number }>('SELECT COUNT(*) n FROM sms.cone_event WHERE merge_key_is_unique = 0');
    console.log(`\nMerge-key collisions (cone, DQ-2): ${collisions.recordset[0]?.n ?? 0}`);

    const dq = await ctx.app
      .request()
      .query<{ severity: string; n: number }>(`SELECT severity, COUNT(*) n FROM sms.dq_finding GROUP BY severity`);
    const order = ['CRITICAL', 'ERROR', 'WARNING', 'INFO'];
    const bySev = new Map(dq.recordset.map((r) => [r.severity, Number(r.n)]));
    console.log('DQ findings: ' + order.map((s) => `${s}=${bySev.get(s) ?? 0}`).join('  '));

    // (h)
    if (weights) {
      console.log(
        weightMismatches === 0
          ? 'Weights: every compared generation agrees on count, sum, avg, min and max'
          : `Weights: ${weightMismatches} MISMATCH — a weight differs between source, raw and canonical; see above`,
      );
    }
    if (stops === 0 && weightMismatches === 0) {
      console.log(
        `\n✓ every open generation reconciles with its source; raw ⇄ canonical clean on ${gapsChecked} epoch(s)`,
      );
      return 0;
    }
    if (stops > 0) console.log(`\n✗ ${stops} STOP condition(s) — see above`);
    else console.log(`\n✗ weight reconciliation failed — see above`);
    return 1;
  } finally {
    await ctx.close();
  }
}
