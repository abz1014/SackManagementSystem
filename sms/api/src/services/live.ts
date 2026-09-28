/**
 * Live line state — the one endpoint the floor screens ("Now", the sack and
 * cone lists' "this shift" scope) and the wall display poll.
 *
 * Built after IFL's first reaction to the app (2 Sep 2026): nothing on screen
 * was live, and the day view opened on yesterday. This endpoint answers the
 * questions a person standing at the line actually has — is it running, what
 * shift is it, how many so far, what was the last sack — from the plant's own
 * clock, and is cheap enough to poll every ten seconds.
 *
 * CLOCK. production_ts_utc is the PLANT'S WALL CLOCK labelled as UTC (see
 * sync-worker dq.ts and web format.ts). "Now" must be expressed the same way
 * or every comparison is five hours out on this UTC+5 plant. plantNowMs(),
 * imported from plantClock.ts — the ONE place this conversion is defined
 * (finding L2, Sep 2026 audit: this file used to carry its own second,
 * independent copy of the identical formula) — assumes this process runs on
 * the plant PC, so its local wall time IS the plant's. An `asOf` override
 * exists so a past moment can be replayed — gated by config, because a wall
 * display left on a replay URL would present old numbers as live.
 *
 * RUNNING / STOPPED uses the same 120 s inter-cone split as downtime.ts:
 * normal gaps have p99 ≈ 31 s and real stops start at 180 s+, so there is no
 * ambiguous middle. "Idle" (a full shift with nothing) is separated from
 * "stopped" so that the dev copy, which ends on 10 Jul 2026, reads as "no
 * readings since …" rather than as a 54-day stoppage.
 *
 * THE ACQUISITION LAG IS THE WHOLE DIFFICULTY, and it is invisible on the
 * supplied copy. IFL's acquisition layer writes a cone's row about 18 minutes
 * after the cone was weighed (measured across 142,509 real rows: 909 s
 * minimum, 1090 s mean). So the newest production timestamp this software can
 * possibly see is a quarter of an hour old even while the line runs flat out.
 *
 * Comparing that timestamp against the wall clock — which is what this file
 * did until the 2 Sep 2026 live rehearsal — therefore reports STOPPED, always,
 * on a perfectly healthy line. It never showed up in development because the
 * only data available was weeks old and everything read "no readings" anyway.
 *
 * The fix is to judge the line against the most recent moment data COULD exist
 * for, `now - lag`, rather than against `now`. The lag is measured from the
 * data itself: `src_Date - src_ProductionDate` over recent raw rows, which is
 * IFL's own insert time against their own production time. Every "recent"
 * window is likewise anchored on the newest reading rather than on the wall
 * clock, because "cones in the last ten minutes" is otherwise guaranteed zero.
 *
 * Every range predicate is on production_ts_utc_ms, which leads the unique
 * merge index on all three event tables (line_id, production_ts_utc_ms, …),
 * so each of these queries is an index seek over one shift, not a scan.
 *
 * SOURCE GENERATIONS — THE OWNER'S DECISION, 23 Sep 2026
 * -----------------------------------------------------
 * D-11 left this file, health.ts, machinesRunning.ts, app.ts and envelope.ts
 * unconstrained on purpose: the five are all "what is the NEWEST thing we
 * have" queries, and two defensible rules conflicted. The owner has chosen:
 * **the newest REAL generation** — prefer IFL's own data over simulator rows
 * — knowing and accepting the stated cost, which is that the plant-simulator
 * rehearsal stops driving the live screens (the simulator is never the real
 * generation) while `.env` stays pointed at `DATA_TP1U2_SIM`.
 *
 * `resolveLiveScope` below is that rule, resolved over the WHOLE table rather
 * than over a period: these screens have no period. At IFL it is a no-op —
 * their generations do not overlap in time and none is synthetic, so "newest
 * real" and "newest" are the same generation — which is exactly why it is
 * safe to adopt and why the simulator is the only thing it visibly changes.
 *
 * BUT THE CONSEQUENCE IS STATED, NEVER SILENT. If the newest real generation
 * ended on 7 Sep while rows keep arriving under another one, these screens
 * must say *why* they have gone quiet. A board reporting "stopped" when it
 * means "the data I trust ended two weeks ago" is the same over-claim the
 * Wall fix (`fc0e3c3`) removed, wearing a different hat. `LiveLine.generation`
 * carries the facts for that sentence: which generation is being read, how
 * many rows were left out, and the newest reading on record that this
 * generation does NOT contain, with the generation it belongs to.
 *
 * THE ACQUISITION LAG IS SCOPED WITH THE DATA, and this is not decoration.
 * Measured on the dev sidecar 23 Sep 2026: all 200 of the newest
 * `sms_raw.cone_raw` rows belong to epoch 13 (the simulator), so an unscoped
 * lag sample reported 1,041 s — the SIMULATOR's lag — while every figure
 * beside it came from IFL's September generation, whose own median lag is
 * 616 s. Judging one generation's line state by another generation's
 * acquisition delay is the defect D-11 is about, one level down.
 *
 * A DEV-ONLY OPT-IN TO THE SIMULATOR, ADDED 28 Sep 2026 (Task T1)
 * -----------------------------------------------------------------
 * The rule above is unconditional for anything a viewer reads about a
 * chosen PERIOD (reports, registers, charts) and stays that way. It is also
 * the DEFAULT for the live "now" screens this file serves — but on this dev
 * PC the frozen real September copy (generation 3, `DATA_TP1U2_SEP07`)
 * coexists with the live plant simulator (generation 4, `DATA_TP1U2_SIM`),
 * so `resolveLiveScope` always picks generation 3 and Line always says
 * "cannot tell" about anything happening right now — there is nothing live
 * to rehearse against. `setLiveScopeIncludesSimulator` below lets `app.ts`
 * flip a module-level policy, OFF BY DEFAULT and gated at startup by
 * `config.ts`'s `resolveLiveSimulator` (which refuses unless the source
 * database is a `_SIM` one on a local server — never the plant), so that the
 * live screens alone may poll generation 4 instead. Nothing else changes:
 * `resolveGenerationScope`'s real-first rule is still the only rule for
 * everything else, and even with the policy on, exactly one generation is
 * still chosen — never a mix.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import {
  DEFAULT_SHIFT_BOUNDARIES,
  parseShiftTime,
  shiftCodeFromMinutes,
  type NightBelongsTo,
  type ShiftBoundaries,
  type ShiftCode,
} from '@sms/shared';
import { TtlCache } from '../cache.js';
import { plantNowMs, plantOffsetMinutes } from './plantClock.js';
import { getLineIdentity } from './lineConfig.js';
import {
  epochFragment,
  noteOf,
  resolveGenerationScope,
  type GenerationNote,
  type GenerationScope,
} from './generation.js';

export const STOP_THRESHOLD_SECONDS = 120;
export const IDLE_THRESHOLD_SECONDS = 8 * 3600;
/** How many recent rows the acquisition lag is measured over. */
export const LAG_SAMPLE_ROWS = 200;
/** A sane ceiling. A lag beyond this is a clock fault, not an ingestion delay,
 *  and must not be allowed to mask a genuinely stopped line indefinitely. */
export const MAX_CREDIBLE_LAG_SECONDS = 2 * 3600;
/**
 * How large a lag may be and still be REPORTED.
 *
 * These are two different ceilings, and conflating them hid a whole state.
 * MAX_CREDIBLE is the point past which a lag stops being usable for judging
 * whether the line is running. Filtering the SAMPLE at that value before
 * taking the median, which this file used to do, also meant the measured lag
 * came back null in exactly the case the screens need to warn about — so
 * "readings are arriving two hours late" could never be said, and the state
 * meant to catch it was unreachable. The lag is now measured up to a day and
 * reported as measured; only the LINE STATE gets the credible cap.
 */
export const MAX_REPORTABLE_LAG_SECONDS = 24 * 3600;

/** Never call the pipeline stale sooner than this, however fast it runs. */
export const MIN_STALE_AFTER_SECONDS = 90;
/** Missed passes before the pipeline counts as stale. */
export const STALE_CADENCE_MULTIPLE = 3;
/** Used until two successful passes exist to measure a cadence from. */
export const DEFAULT_STALE_AFTER_SECONDS = 180;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How long the line's identity and shift rule are held between reads.
 *
 * /api/live is polled every ten seconds by every floor PC and wall screen,
 * and until 14 Sep 2026 the line name came from .env for free. Now it is a
 * row (sms.line, migration 028) and the shift boundaries are a row
 * (sms.shift_rule) — both change a few times a year, so re-reading them per
 * poll would add two queries per viewer per ten seconds for nothing. Sixty
 * seconds; and the admin routes call invalidateLiveConfigCache() on a
 * write, so a rename or a new rule shows on the next poll, not a minute on.
 */
export const CONFIG_CACHE_MS = 60_000;

export interface ShiftWindow {
  code: ShiftCode;
  /** Production day the shift is counted against (shift_date). */
  shiftDate: string;
  startMs: number;
  endMs: number;
}

/**
 * The shift in progress at plant time `tMs`, with its bounds and shift_date.
 * Pure. The boundaries are the line's shift rule (06/14/22 by default, the
 * values IFL confirmed under Q8 — since roadmap Phase 1 a row in
 * sms.shift_rule, editable in Setup); shift_date follows the same night rule
 * the transform stamps on every row, so "this shift" and "today" on the floor
 * screens agree with the Records they open into.
 *
 * Each shift ends where the next begins, so the three need not be eight
 * hours each — the old `start + 8h` was only true of the default. The night
 * shift is the one that wraps midnight: before morningStart it began on the
 * previous calendar day.
 */
export function shiftWindowAt(tMs: number, rule: NightBelongsTo, b: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES): ShiftWindow {
  const d = new Date(tMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const code = shiftCodeFromMinutes(mins, b);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const at = (dayMs: number, minutes: number) => dayMs + minutes * 60_000;
  let startMs: number;
  let endMs: number;
  if (code === 'morning') {
    startMs = at(midnight, b.morningStart);
    endMs = at(midnight, b.eveningStart);
  } else if (code === 'evening') {
    startMs = at(midnight, b.eveningStart);
    endMs = at(midnight, b.nightStart);
  } else if (mins >= b.nightStart) {
    startMs = at(midnight, b.nightStart);
    endMs = at(midnight + DAY_MS, b.morningStart);
  } else {
    startMs = at(midnight - DAY_MS, b.nightStart);
    endMs = at(midnight, b.morningStart);
  }
  // Under start_day a 02:00 night reading belongs to the day the shift began,
  // which is the date of startMs; morning and evening start on t's own date,
  // so the same expression is right for all three codes.
  const dateAnchor = rule === 'start_day' ? startMs : tMs;
  return {
    code,
    shiftDate: new Date(dateAnchor).toISOString().slice(0, 10),
    startMs,
    endMs,
  };
}

/** The newest shift rule for a line, in the shape the window arithmetic takes. */
export interface LiveShiftRule {
  boundaries: ShiftBoundaries;
  nightBelongsTo: NightBelongsTo;
}

const shiftRuleCache = new TtlCache<LiveShiftRule>(CONFIG_CACHE_MS);
const lineIdentityCache = new TtlCache<{ lineName: string; lineShortName: string; plantName: string; unitName: string }>(CONFIG_CACHE_MS);

/**
 * The one source generation the "newest thing we have" queries read.
 *
 * Lives HERE rather than in `generation.ts` for two reasons. It is not a
 * second rule — it is `resolveGenerationScope` with no window, i.e. "over
 * everything on record" — and the four other sites that need it
 * (`health.ts`, `machinesRunning.ts`, `app.ts`, `envelope.ts`) all already
 * sit above this module in the import graph, so no cycle is created and no
 * file another worker holds is touched.
 *
 * CACHED, because /api/live is polled every ten seconds by every floor PC
 * and every wall screen, and the probe is a GROUP BY over three tables with
 * no date bound. Sixty seconds, the same TTL the line identity and the shift
 * rule already use: a generation appears when a plant rebuilds its tables,
 * which is a thing that has happened once.
 */
const liveScopeCache = new TtlCache<GenerationScope>(CONFIG_CACHE_MS);

/**
 * DEV-ONLY POLICY (28 Sep 2026, Task T1): whether `resolveLiveScope` may
 * choose the plant-simulator generation instead of always preferring the
 * newest REAL one. Off by default, matching the owner's 23 Sep 2026
 * decision exactly — `app.ts`'s createApp is the only place that flips this,
 * and only after `config.ts`'s `resolveLiveSimulator` has verified
 * LIVE_ALLOW_SIMULATOR was both requested and is safely local-only. A
 * module-level flag, not a request-scoped one: `liveScopeCache` above is
 * itself module-level and process-wide, and the live screens have no
 * concept of "whose policy" — there is one process, one live scope.
 */
let liveScopeSimulatorPolicy = false;

/**
 * Flip the dev-only policy above. Called once, from the first line of
 * `createApp` (app.ts), with `cfg.liveSimulator?.enabled === true` — never
 * from a route handler. Clears `liveScopeCache` so the NEXT poll re-resolves
 * under the new policy rather than serving a cached answer that was
 * resolved under the old one; the cache key below is ALSO namespaced by the
 * policy, so a stale entry from the other policy can never be served even if
 * a caller forgot to invalidate — belt and suspenders, not either alone.
 */
export function setLiveScopeIncludesSimulator(on: boolean): void {
  if (liveScopeSimulatorPolicy === on) return;
  liveScopeSimulatorPolicy = on;
  liveScopeCache.clear();
}

/** The dev-only policy's current value — for `index.ts`'s startup log and tests. */
export function liveScopeIncludesSimulator(): boolean {
  return liveScopeSimulatorPolicy;
}

export async function resolveLiveScope(pool: ConnectionPool, lineId: number): Promise<GenerationScope> {
  const key = `${lineId}:${liveScopeSimulatorPolicy ? 'sim' : 'real'}`;
  const hit = liveScopeCache.get(key);
  if (hit) return hit;
  const scope = await resolveGenerationScope(pool, lineId, {}, undefined, { preferReal: !liveScopeSimulatorPolicy });
  liveScopeCache.set(key, scope);
  return scope;
}

/**
 * What a live screen needs to say WHY it has gone quiet.
 *
 * `GenerationNote` says which generation was read and how much was left out.
 * These two fields say the part that matters to someone looking at a board:
 * there IS a newer reading, it is at this instant, and it belongs to that
 * generation. Without them "idle since 7 Sep" is indistinguishable from a
 * plant that has been dark for a fortnight.
 *
 * Null `newerElsewhereUtc` means no reading anywhere on record is newer than
 * the one shown — the ordinary case at IFL, and the case in which none of
 * these sentences should be printed at all.
 */
export interface LiveGenerationNote extends GenerationNote {
  newerElsewhereUtc: string | null;
  newerElsewhereSourceDb: string | null;
  newerElsewhereLabel: string | null;
  newerElsewhereSimulator: boolean;
}

export const emptyLiveGenerationNote = (): LiveGenerationNote => ({
  generation: null,
  spansGenerations: false,
  otherGenerationExcluded: 0,
  newerElsewhereUtc: null,
  newerElsewhereSourceDb: null,
  newerElsewhereLabel: null,
  newerElsewhereSimulator: false,
});

interface NewerRow {
  sourceDb: string | null;
  provenance: string | null;
  label: string | null;
  ms: string | number | null;
}

/**
 * The newest reading on record that the chosen generation does NOT contain,
 * and which generation owns it.
 *
 * Keyed on `production_ts_utc_ms > @tip` rather than on `source_epoch NOT IN
 * (…)`: `@tip` is by construction the newest instant inside the chosen
 * generation, so anything past it belongs to another one. That keeps this an
 * index seek on the merge index's leading columns and returns zero rows in
 * the ordinary case — which is the case on every poll at IFL.
 *
 * `self`, WHEN GIVEN, excludes the chosen generation's OWN rows from the
 * answer (28 Sep 2026, Task T1). `machinesRunning.ts` anchors its tip on
 * `sms.cone_event` alone (rule 1, this file's — its own — header), but this
 * query unions cones AND rejects: a reject in the SAME generation that is
 * newer than the cone-only tip used to win this MAX() and get reported as
 * "newer elsewhere", even though it belongs to the very generation already
 * being read. `self` is the chosen generation's own `(sourceDb, ordinal)`,
 * so a row from it is filtered out rather than mistaken for a different one.
 * Still never `NOT IN (…)` — the exclusion is a plain equality check on the
 * two columns that key a generation, ORed with "no epoch row at all", which
 * stays true (an unregistered epoch is never "self").
 */
export async function findNewerElsewhere(
  pool: ConnectionPool,
  lineId: number,
  tipMs: number,
  nowMs: number,
  self?: { sourceDb: string | null; ordinal: number } | null,
): Promise<Pick<LiveGenerationNote, 'newerElsewhereUtc' | 'newerElsewhereSourceDb' | 'newerElsewhereLabel' | 'newerElsewhereSimulator'>> {
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('tip', mssql.BigInt, tipMs)
    .input('now', mssql.BigInt, nowMs);
  if (self) {
    req.input('selfDb', mssql.NVarChar, self.sourceDb);
    req.input('selfOrd', mssql.Int, self.ordinal);
  }
  const r = await req.query<NewerRow>(`
      SELECT TOP 1 e.source_db AS sourceDb, e.provenance AS provenance, e.label AS label, MAX(t.ms) AS ms
        FROM (
          SELECT production_ts_utc_ms AS ms, source_epoch FROM sms.cone_event
           WHERE line_id = @line AND production_ts_utc_ms > @tip AND production_ts_utc_ms <= @now
          UNION ALL
          SELECT production_ts_utc_ms, source_epoch FROM sms.reject_event
           WHERE line_id = @line AND production_ts_utc_ms > @tip AND production_ts_utc_ms <= @now
        ) t
        LEFT JOIN sms.source_epoch e ON e.epoch_id = t.source_epoch
        ${self ? `WHERE e.epoch_id IS NULL OR ISNULL(e.source_db, N'') <> @selfDb OR ISNULL(e.generation_ordinal, -1) <> @selfOrd` : ''}
       GROUP BY e.source_db, e.provenance, e.label
       ORDER BY MAX(t.ms) DESC`);
  const row = r.recordset[0];
  if (!row || row.ms == null) {
    return {
      newerElsewhereUtc: null,
      newerElsewhereSourceDb: null,
      newerElsewhereLabel: null,
      newerElsewhereSimulator: false,
    };
  }
  return {
    newerElsewhereUtc: new Date(Number(row.ms)).toISOString(),
    newerElsewhereSourceDb: row.sourceDb,
    newerElsewhereLabel: row.label,
    // Same derivation as generation.ts: source_db first, because
    // `cli epoch:accept` defaulted provenance to 'ifl_copy' and epoch 13 is
    // registered as IFL's own while sitting on the simulator.
    newerElsewhereSimulator: row.provenance === 'simulator' || /_SIM$/i.test(row.sourceDb ?? ''),
  };
}

/** Called by the admin routes after a line rename or a new shift rule. */
export function invalidateLiveConfigCache(): void {
  shiftRuleCache.clear();
  lineIdentityCache.clear();
  liveScopeCache.clear();
}

/**
 * The line's shift rule: the newest sms.shift_rule row, its TIME columns read
 * back as 'HH:MM' (CONVERT style 108) and parsed into minutes. Falls back to
 * DEFAULT_SHIFT_BOUNDARIES / start_day ONLY when the line has no rule row —
 * a fresh database before its first Setup save — never over a row that
 * exists. The transform reads the same row the same way (runTransform.ts),
 * so the shift a floor screen names is the shift the Records carry.
 */
export async function loadShiftRule(pool: ConnectionPool, lineId: number): Promise<LiveShiftRule> {
  const key = String(lineId);
  const hit = shiftRuleCache.get(key);
  if (hit) return hit;
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ ms: string | null; es: string | null; ns: string | null; night_belongs_to: string | null }>(
      // RT24-04: "in force right now" — bounded by effective_from <=
      // SYSUTCDATETIME() so a future-dated row cannot be read as the current
      // shift boundary before its own effective date arrives.
      `SELECT TOP 1 CONVERT(varchar(5), morning_start, 108) AS ms, CONVERT(varchar(5), evening_start, 108) AS es,
              CONVERT(varchar(5), night_start, 108) AS ns, night_belongs_to
         FROM sms.shift_rule WHERE line_id = @line AND effective_from <= SYSUTCDATETIME() ORDER BY effective_from DESC`,
    );
  const row = r.recordset[0];
  const ms = row?.ms == null ? null : parseShiftTime(row.ms);
  const es = row?.es == null ? null : parseShiftTime(row.es);
  const ns = row?.ns == null ? null : parseShiftTime(row.ns);
  const boundaries: ShiftBoundaries =
    ms != null && es != null && ns != null && ms < es && es < ns
      ? { morningStart: ms, eveningStart: es, nightStart: ns }
      : DEFAULT_SHIFT_BOUNDARIES;
  const rule: LiveShiftRule = {
    boundaries,
    nightBelongsTo: row?.night_belongs_to === 'calendar_day' ? 'calendar_day' : 'start_day',
  };
  shiftRuleCache.set(key, rule);
  return rule;
}

export type LineStatus = 'running' | 'stopped' | 'idle' | 'no_data';

/**
 * Whether the numbers on screen can be trusted right now.
 *
 * Deliberately separate from the LINE state. If the sync worker stops, the
 * newest reading keeps ageing while nothing arrives, and within two minutes
 * the line-state arithmetic reports "Stopped 3 min" about a line running flat
 * out. An amber dot in the corner does not undo a wrong headline, so when this
 * is anything but 'ok' no screen may assert running or stopped.
 *
 * 'lag_unknown' (RT-006, 23 Sep 2026 red-team audit): the acquisition-lag
 * sample came back with zero rows — nothing to measure yet — which is
 * exactly the state `sms epoch:accept` produces the moment it opens a new
 * generation, literally IFL's installation day. classifyHealth used to fall
 * through the null-lag case to 'ok' and the line-state arithmetic then
 * defaulted the lag to 0, so a healthy line's newest reading was judged
 * against the WALL CLOCK with no lag correction and printed "⟨line⟩ has been
 * stopped for N min" in alarm styling about a pipeline that simply had not
 * yet measured its own delay. This kind says the honest thing: not stale,
 * not late, not no-data — just not yet measurable, so no screen may assert
 * running or stopped until a lag sample exists.
 */
export type LiveHealthKind = 'ok' | 'stale' | 'late' | 'lag_unknown' | 'no_data';

export interface SyncHealth {
  /**
   * Seconds since the OLDEST of the source tables last synced successfully.
   *
   * The oldest, not the newest: the response envelope's freshness uses
   * MAX(finished_at_utc) across all four tables, so a dead cone feed hides
   * behind three healthy ones and the app reports itself current while the
   * only table any screen reads is frozen.
   */
  ageSeconds: number | null;
  /** The table furthest behind, so Setup can name it. */
  oldestTable: string | null;
  /** The MEASURED gap between successful passes. Null until two exist. */
  cadenceSeconds: number | null;
  /** Age beyond which the pipeline counts as stale. Derived, not assumed. */
  staleAfterSeconds: number;
}

export interface LiveHealth extends SyncHealth {
  kind: LiveHealthKind;
  /** The lag past which the line state is no longer asserted. */
  lagCeilingSeconds: number;
}

/**
 * Sync freshness, measured rather than assumed.
 *
 * The cadence comes from the gaps between recent successful passes instead of
 * a hardcoded sixty seconds, so changing the worker's schedule cannot silently
 * turn every screen's freshness warning into a false alarm.
 */
export async function getSyncHealth(pool: ConnectionPool, lineId: number): Promise<SyncHealth> {
  const [oldest, gaps] = await Promise.all([
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ target_table: string; ageSeconds: number | null }>(`
        WITH last_ok AS (
          SELECT target_table, MAX(finished_at_utc) AS finished
            FROM sms.sync_run
           WHERE line_id = @line AND outcome = 'success'
           GROUP BY target_table
        )
        SELECT TOP 1 target_table, DATEDIFF(SECOND, finished, SYSUTCDATETIME()) AS ageSeconds
          FROM last_ok ORDER BY finished ASC`),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ gapSeconds: number | null }>(`
        WITH passes AS (
          SELECT run_id, MAX(finished_at_utc) AS finished
            FROM sms.sync_run
           WHERE line_id = @line AND outcome = 'success'
           GROUP BY run_id
        ),
        recent AS (
          SELECT TOP 20 finished, LAG(finished) OVER (ORDER BY finished) AS prev
            FROM passes ORDER BY finished DESC
        )
        SELECT DATEDIFF(SECOND, prev, finished) AS gapSeconds FROM recent WHERE prev IS NOT NULL`),
  ]);

  const row = oldest.recordset[0];
  const sample = gaps.recordset
    .map((g) => Number(g.gapSeconds))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const cadenceSeconds = sample.length ? sample[Math.floor(sample.length / 2)]! : null;

  return {
    ageSeconds: row?.ageSeconds == null ? null : Number(row.ageSeconds),
    oldestTable: row?.target_table ?? null,
    cadenceSeconds,
    staleAfterSeconds:
      cadenceSeconds == null
        ? DEFAULT_STALE_AFTER_SECONDS
        : Math.max(MIN_STALE_AFTER_SECONDS, Math.round(cadenceSeconds * STALE_CADENCE_MULTIPLE)),
  };
}

/** Pure: which of the four states the pipeline is in. */
export function classifyHealth(
  dataAsOfMs: number | null,
  sync: SyncHealth,
  ingestLagSeconds: number | null,
  replay: boolean,
): LiveHealthKind {
  // A replay is pinned to a past instant on purpose and is bannered
  // separately; sync freshness says nothing about it.
  if (replay) return dataAsOfMs == null ? 'no_data' : 'ok';
  if (dataAsOfMs == null) return 'no_data';
  if (sync.ageSeconds == null || sync.ageSeconds > sync.staleAfterSeconds) return 'stale';
  // RT-006: an unmeasured lag must never fall through to 'ok' — see the
  // 'lag_unknown' doc comment on LiveHealthKind above. Checked before the
  // MAX_CREDIBLE_LAG_SECONDS test below, which only makes sense once a lag
  // has actually been measured.
  if (ingestLagSeconds == null) return 'lag_unknown';
  if (ingestLagSeconds > MAX_CREDIBLE_LAG_SECONDS) return 'late';
  return 'ok';
}

export interface LineState {
  status: LineStatus;
  /** Wall-clock age of the newest reading — a cone, or a reject if one is
   *  more recent (finding M4: a span producing only rejects must not read as
   *  full downtime). What a person sees on a clock. */
  sinceLastReadingSeconds: number | null;
  /** How far the newest reading falls short of where it should be given the
   *  lag. This, not the wall-clock age, is how long the line has been down. */
  behindSeconds: number | null;
}

/**
 * Line state, judged against the most recent moment data could exist for.
 *
 * `lagMs` is how long IFL's acquisition layer takes to write a row. A running
 * line's newest reading sits almost exactly `lag` behind the wall clock, so
 * that is the baseline; anything further behind is the line, not the pipeline.
 * Pure.
 */
export function classifyLineState(lastReadingMs: number | null, nowMs: number, lagMs = 0): LineState {
  if (lastReadingMs == null) return { status: 'no_data', sinceLastReadingSeconds: null, behindSeconds: null };
  const lag = Math.min(Math.max(0, lagMs), MAX_CREDIBLE_LAG_SECONDS * 1000);
  const sinceLastReadingSeconds = Math.max(0, Math.round((nowMs - lastReadingMs) / 1000));
  const behindSeconds = Math.max(0, Math.round((nowMs - lag - lastReadingMs) / 1000));
  if (behindSeconds <= STOP_THRESHOLD_SECONDS) return { status: 'running', sinceLastReadingSeconds, behindSeconds };
  if (behindSeconds <= IDLE_THRESHOLD_SECONDS) return { status: 'stopped', sinceLastReadingSeconds, behindSeconds };
  return { status: 'idle', sinceLastReadingSeconds, behindSeconds };
}

export interface LiveLine {
  lineId: number;
  /** sms.line.display_name — what every screen prints for this line. */
  lineName: string;
  /** sms.line.name — the short name a headline uses ("Line 3 is running");
   *  lineName is the full display name ("TP1 · Line 3 · Unit 2") for the bar
   *  and the report. Before Phase 1 the screens derived the short name by
   *  splitting the env string on '·'; now it is a column. */
  lineShortName: string;
  /** sms.plant.name / sms.plant_unit.name, so no screen parses lineName on '·' again. */
  plantName: string;
  unitName: string;
  /** Plant wall clock at generation, in the production_ts convention. */
  plantNowUtc: string;
  /**
   * The plant's offset from UTC in minutes at that instant, as this server
   * sees it (roadmap Phase 9 item 4, 15 Sep 2026). The web converts every
   * app-written UTC instant it must compare with a production day using
   * THIS figure, never the browser's own zone: a phone on the plant Wi-Fi
   * set to another timezone would otherwise place an adjustment on the
   * wrong production day (web/src/lib/plantClock.ts).
   */
  plantOffsetMinutes: number;
  /** True when the clock was moved by an `asOf` override — never live. */
  replay: boolean;
  shift: {
    code: ShiftCode;
    shiftDate: string;
    startUtc: string;
    endUtc: string;
    elapsedSeconds: number;
    remainingSeconds: number;
  };
  /**
   * The newest production time any reading carries, and how far behind the
   * wall clock the plant's own acquisition runs. Everything time-relative on
   * the live screens is anchored here rather than on the clock.
   */
  dataAsOfUtc: string | null;
  ingestLagSeconds: number | null;
  /** Whether the figures below can be trusted, and why not when they cannot. */
  health: LiveHealth;
  /**
   * Which source generation every figure below was read from, and what was
   * left out of it. Always set. A consumer must treat a missing value as
   * "not stated", never as "nothing was excluded" (generation.ts).
   */
  generation: LiveGenerationNote;
  state: {
    status: LineStatus;
    /** Seconds since the newest cone reading, on the wall clock. */
    sinceLastReadingSeconds: number | null;
    /** How long the line has actually been down, net of the acquisition lag. */
    behindSeconds: number | null;
    /** Start of the current uninterrupted run when running; else null. */
    runStartUtc: string | null;
    stopThresholdSeconds: number;
  };
  thisShift: {
    cones: number;
    conesInRange: number;
    conesInRangePct: number | null;
    rejectedCones: number;
    sacks: number;
    sackWeightKg: number;
    conesPerHour: number | null;
  };
  /** Counted backwards from `dataAsOfUtc`, not from the wall clock: with an
   *  18-minute acquisition lag, "the last ten minutes" is always empty. */
  recent: {
    conesLast10Min: number;
    conesLastHour: number;
    sacksLastHour: number;
  };
  /** `eventId` is the canonical PK — what the register's permalink takes.
   *  `sourceRowId` is IFL's own id, kept for display: since the 2026-08-05
   *  source rebuild it names two rows (register.ts, IDENTITY). */
  lastSack: {
    ts: string;
    eventId: number;
    sourceRowId: number;
    sackNum: number | null;
    weightKg: number | null;
    inRange: boolean | null;
  } | null;
  lastCone: {
    ts: string;
    eventId: number;
    sourceRowId: number;
    station: number | null;
    weightG: number | null;
    inRange: boolean | null;
  } | null;
  lastReject: { ts: string; rejectType: string; station: number | null } | null;
  /** Cones this shift per winding station, plus when each last produced. */
  stations: { station: number; cones: number; lastTs: string }[];
}

export interface LiveData {
  lines: LiveLine[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());

/**
 * What the line is called, from sms.line (migration 028). `fallbackName` is
 * the env LINE_NAME, used only when the row is missing — a database that
 * predates 028 — so the wall display keeps its title through the upgrade.
 * Plant and unit have no env equivalent (the screens used to PARSE them out
 * of the name, which is the hack 028 retires), so they are empty then.
 */
async function loadLineIdentity(pool: ConnectionPool, lineId: number, fallbackName: string) {
  const key = String(lineId);
  const hit = lineIdentityCache.get(key);
  if (hit) return hit;
  const row = await getLineIdentity(pool, lineId);
  const id = row
    ? { lineName: row.displayName, lineShortName: row.name, plantName: row.plant.name, unitName: row.unit.name }
    // Pre-028 database: the env string is all there is, so the short name is
    // recovered the way the screens used to do it — the segment that says
    // "Line", else the whole string.
    : {
        lineName: fallbackName,
        lineShortName:
          fallbackName.split('·').map((p) => p.trim()).filter(Boolean).find((p) => /line/i.test(p)) ?? fallbackName,
        plantName: '',
        unitName: '',
      };
  lineIdentityCache.set(key, id);
  return id;
}

export async function getLive(
  pool: ConnectionPool,
  lineId: number,
  /** Env LINE_NAME: the fallback title for a database without an sms.line row. */
  lineName: string,
  opts: { asOfMs?: number } = {},
): Promise<LiveData> {
  const replay = opts.asOfMs != null;
  const nowMs = opts.asOfMs ?? plantNowMs();

  const [identity, shiftRule] = await Promise.all([
    loadLineIdentity(pool, lineId, lineName),
    loadShiftRule(pool, lineId),
  ]);
  const shift = shiftWindowAt(nowMs, shiftRule.nightBelongsTo, shiftRule.boundaries);

  // The one generation every query below reads. See the file header for the
  // rule and the owner's 23 Sep 2026 decision behind it.
  const scope = await resolveLiveScope(pool, lineId);
  const coneF = epochFragment(scope, 'cone_event');
  const sackF = epochFragment(scope, 'sack_event');
  const rejF = epochFragment(scope, 'reject_event');
  const andF = (f: { sql: string | null }) => (f.sql ? ` AND ${f.sql}` : '');
  const bindF = (req: mssql.Request, ...fs: { params: { name: string; id: number }[] }[]) => {
    for (const f of fs) for (const p of f.params) req.input(p.name, mssql.Int, p.id);
    return req;
  };

  /**
   * Measure IFL's acquisition lag from their own two timestamps, over the most
   * recent rows. This reads the RAW layer rather than canonical because the
   * source insert time is deliberately not carried into canonical — the raw
   * layer exists to preserve exactly this kind of source fact. It is the app's
   * own database either way; nothing here touches IFL's.
   *
   * Median, not mean: a single clock-fault row in the sample would otherwise
   * drag the lag by hours and hide a genuinely stopped line.
   *
   * ORDER BY raw_id, NOT src_id. `src_id` is IFL's counter, and IFL restarts it:
   * they dropped and recreated the four wide tables on 2026-08-05 and every
   * identity went back to 1. Ordering by it means "newest" is whichever
   * GENERATION happens to hold the biggest numbers, not the newest reading —
   * so once a second generation lands, this samples the OLDER one until the new
   * one out-counts it (~68 days at 3,000 cones/day against our 204,076). The
   * whole acquisition-lag and line-state machinery would then run on stale rows
   * with no visible symptom. `raw_id` is OUR identity column: monotone by
   * ingest, never reused, never reset.
   *
   * SCOPED TO THE SAME GENERATION as everything else (23 Sep 2026). `raw_id`
   * ordering picks the newest INGESTED rows, which on this sidecar are all
   * the simulator's: the lag came back 1,041 s from epoch 13 while the state
   * it was used to judge came from epoch 9, whose own median is 616 s. The
   * sample must be drawn from the generation being judged, or the two
   * halves of the arithmetic describe different physical tables.
   * `sms_raw.cone_raw.source_epoch` references the same `sms.source_epoch`
   * rows the canonical tables do (migration 025), so the cone fragment is
   * the right predicate here without translation.
   */
  const lagReq = bindF(
    pool.request().input('line', mssql.Int, lineId).input('take', mssql.Int, LAG_SAMPLE_ROWS),
    coneF,
  );
  const lagRes = await lagReq.query<{ lagSeconds: number }>(`
      SELECT TOP (@take) DATEDIFF(SECOND, src_ProductionDate, src_Date) AS lagSeconds
        FROM sms_raw.cone_raw
       WHERE line_id = @line AND src_Date IS NOT NULL AND src_ProductionDate IS NOT NULL${andF(coneF)}
       ORDER BY raw_id DESC`);
  const lagSamples = lagRes.recordset
    .map((r) => Number(r.lagSeconds))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= MAX_REPORTABLE_LAG_SECONDS)
    .sort((a, b) => a - b);
  const ingestLagSeconds = lagSamples.length ? lagSamples[Math.floor(lagSamples.length / 2)]! : null;
  // Reported as measured; capped only where it is USED to judge the line.
  const lagMs = Math.min(ingestLagSeconds ?? 0, MAX_CREDIBLE_LAG_SECONDS) * 1000;

  // One lower bound serves both the shift totals and the rolling hour: the
  // hour can begin before the shift did (twenty minutes into a shift, "last
  // hour" reaches back into the previous one), so the scan starts at the
  // earlier of the two and CASE picks each window out of the same rows.
  // The newest production time on record. Every "recent" window is measured
  // back from here, because a window measured back from the wall clock lands
  // entirely inside the acquisition lag and is always empty.
  // Cones AND rejects, because this is "the newest production time on
  // record" and a reject is a reading. Cone-only left the line able to
  // report `running` (which counts rejects since finding M4) beside a frozen
  // `dataAsOfUtc` and empty recent windows — a self-contradictory answer
  // during exactly the span M4 exists to describe: inspection rejecting
  // everything, no good cones.
  const tipReq = bindF(
    pool.request().input('line', mssql.Int, lineId).input('now', mssql.BigInt, nowMs),
    coneF,
    rejF,
  );
  const tipRes = await tipReq.query<{ tip: number | null }>(
    // RT-021 (23 Sep 2026 red-team audit): a vendor clock-fault row
    // (production_ts_utc_ms = 0) sits in the currently-live generation and
    // used to win this MAX() whenever `@now`/`asOf` landed before the
    // generation's real data starts — measured live: dataAsOfUtc
    // "1970-01-01T00:00:00.000Z", behindSeconds 1,783,244,983 (56.5 years).
    // `> 0` is a literal floor, not a bound parameter — this is still "the
    // newest reading on record", minus the one row that is not one.
    `SELECT MAX(tip) AS tip FROM (
         SELECT MAX(production_ts_utc_ms) AS tip FROM sms.cone_event
          WHERE line_id = @line AND production_ts_utc_ms > 0 AND production_ts_utc_ms <= @now${andF(coneF)}
         UNION ALL
         SELECT MAX(production_ts_utc_ms) FROM sms.reject_event
          WHERE line_id = @line AND production_ts_utc_ms > 0 AND production_ts_utc_ms <= @now${andF(rejF)}
       ) t`,
  );
  const dataAsOfMs = tipRes.recordset[0]?.tip != null ? Number(tipRes.recordset[0].tip) : null;
  const anchorMs = dataAsOfMs ?? nowMs;

  // Why the screens are quiet, when they are. Only asked once there IS a tip
  // to be newer than, and only when the window genuinely holds more than one
  // generation — so the ordinary single-generation poll pays nothing.
  //
  // `self` excludes the chosen generation's own rows: this query unions
  // cones AND rejects (dataAsOfMs's tip does too), so without it a reject
  // newer than the cone-only anchor elsewhere in machinesRunning.ts could
  // self-report — see findNewerElsewhere's own doc comment.
  const self = scope.generation ? { sourceDb: scope.generation.sourceDb, ordinal: scope.generation.ordinal } : null;
  const newerElsewhere =
    dataAsOfMs != null && scope.spansGenerations
      ? await findNewerElsewhere(pool, lineId, dataAsOfMs, nowMs, self)
      : {
          newerElsewhereUtc: null,
          newerElsewhereSourceDb: null,
          newerElsewhereLabel: null,
          newerElsewhereSimulator: false,
        };

  const hourAgoMs = anchorMs - HOUR_MS;
  const tenMinAgoMs = anchorMs - 10 * 60_000;
  const lo = Math.min(shift.startMs, hourAgoMs);

  const bind = (req: mssql.Request) =>
    req
      .input('line', mssql.Int, lineId)
      .input('lo', mssql.BigInt, lo)
      .input('now', mssql.BigInt, nowMs)
      .input('shiftStart', mssql.BigInt, shift.startMs)
      .input('hourAgo', mssql.BigInt, hourAgoMs)
      .input('tenAgo', mssql.BigInt, tenMinAgoMs);

  const [cones, sacks, rejects, lastCone, lastSack, lastReject, stations] = await Promise.all([
    bindF(bind(pool.request()), coneF).query<{ cones: number; inRange: number; last10: number; lastHour: number }>(`
      SELECT
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN 1 ELSE 0 END) AS cones,
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart AND in_range = 1 THEN 1 ELSE 0 END) AS inRange,
        SUM(CASE WHEN production_ts_utc_ms >= @tenAgo THEN 1 ELSE 0 END) AS last10,
        SUM(CASE WHEN production_ts_utc_ms >= @hourAgo THEN 1 ELSE 0 END) AS lastHour
      FROM sms.cone_event
      WHERE line_id = @line AND production_ts_utc_ms >= @lo AND production_ts_utc_ms <= @now${andF(coneF)}`),
    bindF(bind(pool.request()), sackF).query<{ sacks: number; kg: number; lastHour: number }>(`
      SELECT
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN 1 ELSE 0 END) AS sacks,
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN weight_kg ELSE 0 END) AS kg,
        SUM(CASE WHEN production_ts_utc_ms >= @hourAgo THEN 1 ELSE 0 END) AS lastHour
      FROM sms.sack_event
      WHERE line_id = @line AND production_ts_utc_ms >= @lo AND production_ts_utc_ms <= @now${andF(sackF)}`),
    bindF(bind(pool.request()), rejF).query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM sms.reject_event
      WHERE line_id = @line AND production_ts_utc_ms >= @shiftStart AND production_ts_utc_ms <= @now${andF(rejF)}`),
    bindF(bind(pool.request()), coneF).query<{
      ts: Date; event_id: number; source_row_id: number; source_station: number | null; weight_g: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, cone_event_id AS event_id, source_row_id, source_station, weight_g, in_range
      FROM sms.cone_event WHERE line_id = @line AND production_ts_utc_ms <= @now${andF(coneF)}
      ORDER BY production_ts_utc_ms DESC`),
    bindF(bind(pool.request()), sackF).query<{
      ts: Date; event_id: number; source_row_id: number; sack_num: number | null; weight_kg: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, sack_event_id AS event_id, source_row_id, sack_num, weight_kg, in_range
      FROM sms.sack_event WHERE line_id = @line AND production_ts_utc_ms <= @now${andF(sackF)}
      ORDER BY production_ts_utc_ms DESC`),
    bindF(bind(pool.request()), rejF).query<{ ts: Date; reject_type: string; source_station: number | null }>(`
      SELECT TOP 1 production_ts_utc AS ts, reject_type, source_station
      FROM sms.reject_event WHERE line_id = @line AND production_ts_utc_ms <= @now${andF(rejF)}
      ORDER BY production_ts_utc_ms DESC`),
    bindF(bind(pool.request()), coneF).query<{ station: number; cones: number; lastTs: Date }>(`
      SELECT source_station AS station, COUNT(*) AS cones, MAX(production_ts_utc) AS lastTs
      FROM sms.cone_event
      WHERE line_id = @line AND production_ts_utc_ms >= @shiftStart AND production_ts_utc_ms <= @now
        AND source_station IS NOT NULL AND source_station > 0${andF(coneF)}
      GROUP BY source_station ORDER BY source_station`),
  ]);

  const sync = await getSyncHealth(pool, lineId);
  const lastConeRow = lastCone.recordset[0] ?? null;
  const lastReadingMs = lastConeRow ? new Date(lastConeRow.ts).getTime() : null;
  // Finding M4 (Sep 2026 audit): judging running/stopped on cones alone reads
  // a span producing only rejects — inspection stations active, no good
  // cones — as full downtime. classifyLineState only cares that it is given
  // the newest RELEVANT reading, not what kind it is, so the newest of
  // either stream is what "the line is producing something" actually means.
  const lastRejectRowForState = lastReject.recordset[0] ?? null;
  const lastRejectMs = lastRejectRowForState ? new Date(lastRejectRowForState.ts).getTime() : null;
  const lastActivityMs =
    lastReadingMs == null ? lastRejectMs : lastRejectMs == null ? lastReadingMs : Math.max(lastReadingMs, lastRejectMs);
  const state = classifyLineState(lastActivityMs, nowMs, lagMs);

  // Start of the current run: the newest reading that followed a gap longer
  // than the stop threshold (or the first in the 24 h window). Only
  // meaningful while running; a stopped line has no current run.
  //
  // Over cones AND rejects, matching what `status` is judged on. Cone-only
  // returned null — "running since never" — for a run carried by rejects
  // alone, and would have measured a gap as a break in the run when the line
  // was in fact producing rejects throughout it.
  let runStartUtc: string | null = null;
  if (state.status === 'running') {
    const runReq = bindF(
      pool
        .request()
        .input('line', mssql.Int, lineId)
        .input('lo', mssql.BigInt, nowMs - DAY_MS)
        .input('now', mssql.BigInt, nowMs)
        .input('gapMs', mssql.BigInt, STOP_THRESHOLD_SECONDS * 1000),
      coneF,
      rejF,
    );
    // The predicate goes INSIDE the CTE, where LAG() reads its rows —
    // exactly as downtime.ts had to (D-11). Applied to the CTE's output it
    // would compile, run, and still let another generation's cones fill this
    // one's gaps, so a run that genuinely broke would read as continuous.
    const r = await runReq.query<{ runStart: Date | null }>(`
        WITH a AS (
          SELECT production_ts_utc AS ts, production_ts_utc_ms AS ms
            FROM sms.cone_event
           WHERE line_id = @line AND production_ts_utc_ms > @lo AND production_ts_utc_ms <= @now${andF(coneF)}
          UNION ALL
          SELECT production_ts_utc, production_ts_utc_ms
            FROM sms.reject_event
           WHERE line_id = @line AND production_ts_utc_ms > @lo AND production_ts_utc_ms <= @now${andF(rejF)}
        ),
        c AS (
          SELECT ts, ms, LAG(ms) OVER (ORDER BY ms) AS prev_ms FROM a
        )
        SELECT MAX(ts) AS runStart FROM c WHERE prev_ms IS NULL OR ms - prev_ms > @gapMs`);
    runStartUtc = iso(r.recordset[0]?.runStart ?? null);
  }

  const c = cones.recordset[0];
  const s = sacks.recordset[0];
  const shiftCones = num(c?.cones);
  const elapsedSeconds = Math.max(0, Math.round((nowMs - shift.startMs) / 1000));
  // The rate divides by the time the counts actually COVER, which ends at the
  // data tip, not now. Dividing by wall-clock elapsed understates a running
  // line by roughly the acquisition lag every time.
  const coveredSeconds = Math.max(1, Math.round((Math.min(anchorMs, nowMs) - shift.startMs) / 1000));
  const lastSackRow = lastSack.recordset[0] ?? null;
  const lastRejectRow = lastReject.recordset[0] ?? null;

  const line: LiveLine = {
    lineId,
    lineName: identity.lineName,
    lineShortName: identity.lineShortName,
    plantName: identity.plantName,
    unitName: identity.unitName,
    plantNowUtc: new Date(nowMs).toISOString(),
    // Taken now, not at the replay instant: the plant observes no daylight
    // saving, and the value is what a viewer needs to place today's
    // app-written instants on production days.
    plantOffsetMinutes: plantOffsetMinutes(),
    replay,
    shift: {
      code: shift.code,
      shiftDate: shift.shiftDate,
      startUtc: new Date(shift.startMs).toISOString(),
      endUtc: new Date(shift.endMs).toISOString(),
      elapsedSeconds,
      remainingSeconds: Math.max(0, Math.round((shift.endMs - nowMs) / 1000)),
    },
    dataAsOfUtc: dataAsOfMs != null ? new Date(dataAsOfMs).toISOString() : null,
    ingestLagSeconds,
    health: {
      ...sync,
      kind: classifyHealth(dataAsOfMs, sync, ingestLagSeconds, replay),
      lagCeilingSeconds: MAX_CREDIBLE_LAG_SECONDS,
    },
    generation: { ...noteOf(scope), ...newerElsewhere },
    state: {
      status: state.status,
      sinceLastReadingSeconds: state.sinceLastReadingSeconds,
      behindSeconds: state.behindSeconds,
      runStartUtc,
      stopThresholdSeconds: STOP_THRESHOLD_SECONDS,
    },
    thisShift: {
      cones: shiftCones,
      conesInRange: num(c?.inRange),
      conesInRangePct: shiftCones > 0 ? Math.round((1000 * num(c?.inRange)) / shiftCones) / 10 : null,
      rejectedCones: num(rejects.recordset[0]?.n),
      sacks: num(s?.sacks),
      sackWeightKg: Math.round(num(s?.kg) * 100) / 100,
      conesPerHour: coveredSeconds >= 600 ? Math.round((shiftCones * 3600) / coveredSeconds) : null,
    },
    recent: {
      conesLast10Min: num(c?.last10),
      conesLastHour: num(c?.lastHour),
      sacksLastHour: num(s?.lastHour),
    },
    lastSack: lastSackRow
      ? {
          ts: iso(lastSackRow.ts)!,
          eventId: Number(lastSackRow.event_id),
          sourceRowId: Number(lastSackRow.source_row_id),
          sackNum: lastSackRow.sack_num,
          weightKg: lastSackRow.weight_kg == null ? null : Number(lastSackRow.weight_kg),
          inRange: lastSackRow.in_range,
        }
      : null,
    lastCone: lastConeRow
      ? {
          ts: iso(lastConeRow.ts)!,
          eventId: Number(lastConeRow.event_id),
          sourceRowId: Number(lastConeRow.source_row_id),
          station: lastConeRow.source_station,
          weightG: lastConeRow.weight_g == null ? null : Number(lastConeRow.weight_g),
          inRange: lastConeRow.in_range,
        }
      : null,
    lastReject: lastRejectRow
      ? { ts: iso(lastRejectRow.ts)!, rejectType: lastRejectRow.reject_type, station: lastRejectRow.source_station }
      : null,
    stations: stations.recordset.map((r) => ({
      station: Number(r.station),
      cones: num(r.cones),
      lastTs: iso(r.lastTs)!,
    })),
  };

  return { lines: [line] };
}
