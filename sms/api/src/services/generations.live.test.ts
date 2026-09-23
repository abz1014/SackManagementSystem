/**
 * SOURCE GENERATIONS, the five sites D-11 left for an owner decision
 * (23 Sep 2026): `live.ts`, `health.ts`, `machinesRunning.ts`, `app.ts` and
 * `envelope.ts`.
 *
 * THE DECISION THESE TESTS ENCODE. All five are "what is the NEWEST thing we
 * have" queries, and two defensible rules conflicted — see D-11 and
 * `ca34a23`'s message for both. The owner has chosen **the newest REAL
 * generation**: prefer IFL's own data over simulator rows. The stated cost
 * was accepted, not avoided — the plant-simulator rehearsal stops driving the
 * live screens, because the simulator is never the real generation, while
 * `.env` stays pointed at `DATA_TP1U2_SIM`.
 *
 * SO THE CONSEQUENCE IS THE THING UNDER TEST HERE, not just the filter. When
 * the newest real generation has ENDED and rows keep arriving under another
 * one, these screens go quiet, and a screen that prints "stopped" when it
 * means "the data I trust ended two weeks ago" is the same over-claim the
 * Wall fix (`fc0e3c3`) removed. Every service below must therefore report the
 * newest reading it did NOT use, and which generation owns it.
 *
 * MEASURED read-only on the development sidecar, 23 Sep 2026, `sqlcmd -E`
 * against the app-owned `sms` database. Nothing was executed against any IFL
 * database. These are the figures the fakes reproduce:
 *
 *                                    pooled (before)        gen 3 (after)
 *   live tip, cone+reject        1790080162370 (22 Sep)   1788782428860 (7 Sep)
 *   acquisition lag, median            1,041 s                  616 s
 *   newest production day            2026-09-22               2026-09-07
 *   /api/range production days              65                       34
 *   machine grid, stations / cones      14 / 603                 8 / 347
 *   machine grid, materials at the
 *     SAME (7 Sep) anchor                      6                        4
 *
 * The lag line is the one that is not merely a narrower number. All 200 of
 * the newest `sms_raw.cone_raw` rows belong to epoch 13, the simulator — so
 * before this pass the line state of IFL's September generation was judged
 * against the SIMULATOR's acquisition delay. Two halves of one piece of
 * arithmetic, describing two different physical tables.
 *
 * THE BOUNDARY CASE, exercised below: `shift_date = 1969-12-31`, the
 * clock-fault rows present in BOTH of IFL's own copies — 1 cone under epoch 1
 * and 1 under epoch 9. It is the only two-generation overlap on this machine
 * with no simulator anywhere in it, which makes it the case that matters at
 * the plant, where there is no simulator and there IS their own 5 Aug
 * rebuild.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  getLive,
  invalidateLiveConfigCache,
  resolveLiveScope,
  findNewerElsewhere,
} from './live.js';
import { acquisitionHealth } from './health.js';
import { getMachinesRunning } from './machinesRunning.js';
import { loadMeta } from '../envelope.js';

/* ------------------------------------------------------------ the sidecar */

/** `sms.source_epoch` for line 1, verbatim from the dev sidecar. */
const EPOCHS = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
  { epoch_id: 2, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - sacks' },
  { epoch_id: 3, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - quality rejects' },
  { epoch_id: 4, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - weight rejects' },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
  // 13-16 are the simulator's four tables, registered as `ifl_copy` by the
  // `cli epoch:accept` default removed in 6b76ae3. Those rows are LEFT
  // STANDING deliberately so the registration bug is not hidden, which is
  // precisely why `simulator` is derived from source_db, never provenance.
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
  { epoch_id: 15, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectQCS1_TP1U2 gen 4' },
  { epoch_id: 16, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectWeight1_TP1U2 gen 4' },
];

/** The sidecar's real shape: IFL's September generation beside the simulator. */
const PRESENT_DEV = [
  { tbl: 'cone_event', epoch_id: 1, n: 142_511 },
  { tbl: 'cone_event', epoch_id: 9, n: 132_552 },
  { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
  { tbl: 'sack_event', epoch_id: 2, n: 5_462 },
  { tbl: 'sack_event', epoch_id: 10, n: 5_435 },
  { tbl: 'sack_event', epoch_id: 14, n: 6_199 },
  { tbl: 'reject_event', epoch_id: 11, n: 900 },
  { tbl: 'reject_event', epoch_id: 12, n: 400 },
  { tbl: 'reject_event', epoch_id: 15, n: 1_100 },
];

const TIP_GEN3 = 1_788_782_428_860; // 2026-09-07T12:00:28.860Z, IFL's own tip
const TIP_SIM = 1_790_080_162_370; //  2026-09-22T…,            the simulator's

interface Seen {
  sql: string;
  inputs: Map<string, unknown>;
}

/**
 * A pool that answers the generation probe from `present` and `sms.source_epoch`
 * from EPOCHS, and every other statement from `answer`. Records the SQL and
 * bound parameters of the NON-probe statements, so a test can assert what the
 * service actually asked once its scope was resolved.
 */
function scopedPool(
  present: { tbl: string; epoch_id: number | null; n: number }[],
  answer: (sql: string, inputs: Map<string, unknown>) => unknown[] = () => [],
) {
  const seen: Seen[] = [];
  const mk = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => {
        inputs.set(n, v);
        return req;
      },
      query: async (sql: string) => {
        if (/AS tbl,\s*source_epoch/.test(sql)) return { recordset: present, rowsAffected: [0] };
        if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS, rowsAffected: [0] };
        seen.push({ sql, inputs: new Map(inputs) });
        return { recordset: answer(sql, inputs), rowsAffected: [1] };
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, seen };
}

/** The epoch ids a statement bound, in order — the predicate's real effect. */
const boundEpochs = (s: Seen): number[] =>
  [...s.inputs.entries()].filter(([k]) => /^ge[csr]\d+$/.test(k)).map(([, v]) => Number(v));

/** Numeric, because [9, 11, 12].sort() is [11, 12, 9]. */
const sortedEpochs = (s: Seen): number[] => boundEpochs(s).sort((a, b) => a - b);

const find = (seen: Seen[], re: RegExp): Seen => {
  const hit = seen.find((s) => re.test(s.sql));
  if (!hit) throw new Error(`no statement matching ${re}`);
  return hit;
};

// Every one of the five sites shares ONE cached scope (live.ts), so a test
// that did not clear it would inherit the previous test's generation.
beforeEach(() => invalidateLiveConfigCache());

/* ----------------------------------------------------------- the choice */

describe('resolveLiveScope — the newest REAL generation, and what it degrades to', () => {
  it('prefers IFL’s September generation over the NEWER simulator one', async () => {
    const { pool } = scopedPool(PRESENT_DEV);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
    // One generation spans one source_epoch row PER SOURCE TABLE. Getting
    // this wrong is the defect itself: cones from gen 3 over sacks from
    // gen 4 is a cones-per-sack ratio across two physical tables.
    expect(s.epochIds('cone_event')).toEqual([9]);
    expect(s.epochIds('sack_event')).toEqual([10]);
    expect([...s.epochIds('reject_event')].sort()).toEqual([11, 12]);
    // And it says what it left out rather than implying the period is whole.
    expect(s.spansGenerations).toBe(true);
    expect(s.otherGenerationExcluded).toBe(142_511 + 135_248 + 5_462 + 6_199 + 1_100);
  });

  it('degrades to "newest" when NOTHING is synthetic — the shape at IFL', async () => {
    // IFL has no simulator: their generations are their own July tables and
    // their own 5 Aug rebuild. "Newest real" must then be simply "newest",
    // or this rule would be a different rule at the plant than in the lab.
    const { pool } = scopedPool([
      { tbl: 'cone_event', epoch_id: 1, n: 142_511 },
      { tbl: 'cone_event', epoch_id: 9, n: 132_552 },
    ]);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 3, simulator: false });
    expect(s.epochIds('cone_event')).toEqual([9]);
  });

  it('when the ONLY generation present is the simulator, it is used and it SAYS so', async () => {
    // The rejected alternative was to soften the rule so the rehearsal keeps
    // working. It is not softened: a synthetic generation is used only when
    // there is no real one to prefer, and `simulator` is true so a caller
    // can never mistake it for the plant's.
    const { pool } = scopedPool([
      { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
      { tbl: 'sack_event', epoch_id: 14, n: 6_199 },
    ]);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });
    // Derived from source_db, NOT provenance: epoch 13 is registered
    // 'ifl_copy' and is the simulator, and that row stands deliberately.
    expect(s.generation!.provenance).toBe('ifl_copy');
    expect(s.epochIds('cone_event')).toEqual([13]);
  });

  it('the 1969-12-31 boundary: two of IFL’s OWN generations, no simulator at all', async () => {
    // The clock-fault rows present in both of IFL's copies. This is the case
    // that exists at the plant; the simulator overlap is only the one that is
    // big enough to measure on this laptop.
    const { pool } = scopedPool([
      { tbl: 'cone_event', epoch_id: 1, n: 1 },
      { tbl: 'cone_event', epoch_id: 9, n: 1 },
      { tbl: 'reject_event', epoch_id: 3, n: 2 },
      { tbl: 'reject_event', epoch_id: 11, n: 1 },
    ]);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 3, simulator: false });
    expect(s.epochIds('cone_event')).toEqual([9]);
    expect(s.epochIds('reject_event')).toEqual([11]);
    // 1 cone + 2 rejects of the July generation, counted rather than dropped.
    expect(s.otherGenerationExcluded).toBe(3);
    expect(s.spansGenerations).toBe(true);
  });

  it('claims nothing at all when no row carries an epoch', async () => {
    const { pool } = scopedPool([{ tbl: 'cone_event', epoch_id: null, n: 500 }]);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toBeNull();
    expect(s.spansGenerations).toBe(false);
    expect(s.epochIds('cone_event')).toEqual([]);
  });
});

/* ------------------------------------------------------ why it is quiet */

describe('findNewerElsewhere — the reason a screen has gone quiet', () => {
  it('names the instant and the generation, and that it is synthetic', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, () => [
      { sourceDb: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', ms: TIP_SIM },
    ]);
    const n = await findNewerElsewhere(pool, 1, TIP_GEN3, Number.MAX_SAFE_INTEGER);
    expect(n.newerElsewhereUtc).toBe(new Date(TIP_SIM).toISOString());
    expect(n.newerElsewhereSourceDb).toBe('DATA_TP1U2_SIM');
    // provenance says ifl_copy; source_db says otherwise, and source_db wins.
    expect(n.newerElsewhereSimulator).toBe(true);
    // Keyed on "newer than the tip", never on NOT IN (…): an index seek on
    // the merge index's leading columns, returning nothing in the ordinary
    // case — which is every poll at IFL.
    const q = find(seen, /production_ts_utc_ms > @tip/);
    expect(q.inputs.get('tip')).toBe(TIP_GEN3);
    expect(q.sql).not.toMatch(/NOT IN/);
  });

  it('says nothing rather than something vague when no reading is newer', async () => {
    const { pool } = scopedPool(PRESENT_DEV, () => []);
    const n = await findNewerElsewhere(pool, 1, TIP_GEN3, Number.MAX_SAFE_INTEGER);
    expect(n).toEqual({
      newerElsewhereUtc: null,
      newerElsewhereSourceDb: null,
      newerElsewhereLabel: null,
      newerElsewhereSimulator: false,
    });
  });
});

/* -------------------------------------------------------------- live.ts */

/** Answers getLive's statements with the sidecar's own gen-3 figures. */
const liveAnswer = (sql: string): unknown[] => {
  if (/DATEDIFF\(SECOND, src_ProductionDate, src_Date\)/.test(sql)) {
    // IFL's September generation's own lag, not the simulator's 1,041 s.
    return Array.from({ length: 9 }, () => ({ lagSeconds: 616 }));
  }
  if (/SELECT MAX\(tip\) AS tip/.test(sql)) return [{ tip: TIP_GEN3 }];
  if (/production_ts_utc_ms > @tip/.test(sql)) {
    return [{ sourceDb: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', ms: TIP_SIM }];
  }
  if (/ORDER BY finished ASC/.test(sql)) return [{ target_table: 'cone_raw', ageSeconds: 40 }];
  // The newest cone — what the line state is judged on. Its production
  // instant IS the generation's tip, because that is what the tip is.
  if (/TOP 1 production_ts_utc AS ts, cone_event_id/.test(sql)) {
    return [{ ts: new Date(TIP_GEN3), event_id: 1, source_row_id: 1, source_station: 3, weight_g: 1950, in_range: true }];
  }
  return [];
};

describe('getLive — one generation, and the lag measured from the SAME one', () => {
  it('binds gen 3 to every event query, cones, sacks and rejects each to their own epochs', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, liveAnswer);
    await getLive(pool, 1, 'Line 3', { asOfMs: TIP_SIM });

    expect(boundEpochs(find(seen, /SUM\(CASE WHEN production_ts_utc_ms >= @shiftStart THEN 1 ELSE 0 END\) AS cones/))).toEqual([9]);
    expect(boundEpochs(find(seen, /AS sacks/))).toEqual([10]);
    expect(sortedEpochs(find(seen, /SELECT COUNT\(\*\) AS n FROM sms\.reject_event/))).toEqual([11, 12]);
    expect(boundEpochs(find(seen, /GROUP BY source_station/))).toEqual([9]);
    // The tip carries BOTH, because it is a UNION of cone and reject.
    expect(sortedEpochs(find(seen, /SELECT MAX\(tip\) AS tip/))).toEqual([9, 11, 12]);
  });

  it('measures the acquisition lag from the generation it judges — the 18-minute machinery, kept coherent', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, liveAnswer);
    const d = await getLive(pool, 1, 'Line 3', { asOfMs: TIP_SIM });

    const lag = find(seen, /FROM\s+sms_raw\.cone_raw/);
    // `sms_raw.cone_raw.source_epoch` references the same sms.source_epoch
    // rows the canonical tables do (migration 025), so the CONE fragment is
    // the right predicate without translation.
    expect(boundEpochs(lag)).toEqual([9]);
    // Still ordered by raw_id — OUR monotone identity, never IFL's restarted
    // src_id — and still capped at the reportable ceiling.
    expect(lag.sql).toMatch(/ORDER BY raw_id DESC/);
    expect(d.lines[0]!.ingestLagSeconds).toBe(616);
  });

  it('the lag still does its job: a reading one lag old is RUNNING, not stopped', async () => {
    // The regression the 2 Sep live rehearsal found, re-proved end to end
    // through the scoped query rather than through classifyLineState alone.
    const { pool } = scopedPool(PRESENT_DEV, liveAnswer);
    const d = await getLive(pool, 1, 'Line 3', { asOfMs: TIP_GEN3 + 616_000 });
    expect(d.lines[0]!.state.status).toBe('running');
    expect(d.lines[0]!.state.behindSeconds).toBe(0);
    // Without the lag the SAME reading would have read as stopped: 616 s is
    // past the 120 s stop threshold.
    expect(d.lines[0]!.state.sinceLastReadingSeconds).toBe(616);
  });

  it('freshness still comes from the OLDEST source table, and is NOT generation-scoped', async () => {
    // One dead feed used to hide behind three healthy ones. sms.sync_run is
    // the worker's own log, not an event table — scoping it to a generation
    // would be meaningless and would break exactly this.
    const { pool, seen } = scopedPool(PRESENT_DEV, liveAnswer);
    const d = await getLive(pool, 1, 'Line 3', { asOfMs: TIP_SIM });
    const fresh = find(seen, /FROM last_ok ORDER BY finished ASC/);
    expect(fresh.sql).not.toMatch(/ORDER BY finished DESC/);
    expect(boundEpochs(fresh)).toEqual([]);
    expect(d.lines[0]!.health.oldestTable).toBe('cone_raw');
    expect(d.lines[0]!.health.ageSeconds).toBe(40);
  });

  it('states WHY it is quiet instead of reporting a stopped line', async () => {
    const { pool } = scopedPool(PRESENT_DEV, liveAnswer);
    const d = await getLive(pool, 1, 'Line 3', { asOfMs: TIP_SIM });
    const line = d.lines[0]!;
    // The state arithmetic is correct and its conclusion would be false.
    expect(line.dataAsOfUtc).toBe(new Date(TIP_GEN3).toISOString());
    expect(line.state.status).toBe('idle');
    // …so the payload carries the reason, which is what the screen prints.
    expect(line.generation.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07' });
    expect(line.generation.spansGenerations).toBe(true);
    expect(line.generation.newerElsewhereUtc).toBe(new Date(TIP_SIM).toISOString());
    expect(line.generation.newerElsewhereSimulator).toBe(true);
  });

  it('asks the "why" question only when there IS another generation to name', async () => {
    // One generation on record: no extra round trip per poll, and no
    // sentence on screen. This is every poll at IFL before their next
    // rebuild, so it must not cost anything.
    const { pool, seen } = scopedPool(
      [{ tbl: 'cone_event', epoch_id: 9, n: 132_552 }],
      liveAnswer,
    );
    const d = await getLive(pool, 1, 'Line 3', { asOfMs: TIP_SIM });
    expect(seen.some((s) => /production_ts_utc_ms > @tip/.test(s.sql))).toBe(false);
    expect(d.lines[0]!.generation.newerElsewhereUtc).toBeNull();
  });

  it('puts the run-start predicate INSIDE the CTE, where LAG() reads its rows', async () => {
    // Applied to the CTE's OUTPUT it would compile, run, and still let
    // another generation's cones fill this one's gaps — the downtime.ts
    // defect (D-11) in the live screen's own run-start query.
    const { pool, seen } = scopedPool(PRESENT_DEV, (sql) =>
      /SELECT MAX\(tip\) AS tip/.test(sql) ? [{ tip: TIP_GEN3 }] : liveAnswer(sql),
    );
    await getLive(pool, 1, 'Line 3', { asOfMs: TIP_GEN3 + 10_000 });
    const run = find(seen, /LAG\(ms\) OVER \(ORDER BY ms\)/);
    const cteBody = run.sql.slice(0, run.sql.indexOf('LAG(ms)'));
    expect(cteBody).toMatch(/source_epoch = @gec0/);
    expect(cteBody).toMatch(/source_epoch IN \(@ger0, @ger1\)/);
  });
});

/* ------------------------------------------------------------ health.ts */

describe('acquisitionHealth — the screen whose job is to report breakage', () => {
  it('scopes the tip AND the lag, and reports which generation it measured', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, liveAnswer);
    const a = await acquisitionHealth(pool, 1);
    expect(sortedEpochs(find(seen, /SELECT MAX\(tip\) AS tip/))).toEqual([9, 11, 12]);
    expect(boundEpochs(find(seen, /FROM\s+sms_raw\.cone_raw/))).toEqual([9]);
    expect(a.generation!.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07' });
    expect(a.generation!.newerElsewhereUtc).toBe(new Date(TIP_SIM).toISOString());
    // The same classification function live.ts uses, so the Health screen and
    // the strip on every other screen cannot disagree.
    expect(a.kind).toBe('ok');
  });

  it('leaves sms.sync_run unscoped, so the oldest-table rule survives', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, liveAnswer);
    await acquisitionHealth(pool, 1);
    expect(boundEpochs(find(seen, /FROM last_ok ORDER BY finished ASC/))).toEqual([]);
  });
});

/* --------------------------------------------------- machinesRunning.ts */

describe('getMachinesRunning — the anchor is still MAX(), over ONE generation', () => {
  const roster = [{ station_id: 1, name: 'W1', machine_name: 'Winder 1', is_active: true }];
  const answer = (sql: string): unknown[] => {
    if (/SELECT MAX\(production_ts_utc_ms\) AS ms/.test(sql)) return [{ ms: String(TIP_GEN3) }];
    if (/FROM sms\.station s/.test(sql)) return roster;
    if (/production_ts_utc_ms > @tip/.test(sql)) {
      return [{ sourceDb: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', ms: TIP_SIM }];
    }
    return [];
  };

  it('anchors on the newest reading IN THE GENERATION, not on the newest row in the table', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, answer);
    const d = await getMachinesRunning(pool, 1);
    // Rule 1 is intact — the anchor is still a MAX over the whole table, not
    // the selected period; the table it maximises over is now one generation.
    const a = find(seen, /SELECT MAX\(production_ts_utc_ms\) AS ms/);
    expect(boundEpochs(a)).toEqual([9]);
    expect(a.sql).not.toMatch(/@start/);
    // …so the sentences b91f7d5 put on screen stay true of what was queried.
    expect(d.asOfUtc).toBe(new Date(TIP_GEN3).toISOString());
    expect(d.windowStartUtc).toBe(new Date(TIP_GEN3 - 2 * 60 * 60 * 1000).toISOString());
  });

  it('binds the predicate inside the `w` CTE, where ROW_NUMBER partitions its rows', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, answer);
    await getMachinesRunning(pool, 1);
    const w = find(seen, /WITH w AS/);
    expect(boundEpochs(w)).toEqual([9]);
    const cte = w.sql.slice(0, w.sql.indexOf('newest AS'));
    expect(cte).toMatch(/source_epoch = @gec0/);
  });

  it('says why the grid is a window into a generation that has ended', async () => {
    const { pool } = scopedPool(PRESENT_DEV, answer);
    const d = await getMachinesRunning(pool, 1);
    expect(d.generation.generation).toMatchObject({ ordinal: 3 });
    expect(d.generation.newerElsewhereUtc).toBe(new Date(TIP_SIM).toISOString());
  });

  it('carries the note even with no readings at all', async () => {
    const { pool } = scopedPool(PRESENT_DEV, (sql) =>
      /SELECT MAX\(production_ts_utc_ms\) AS ms/.test(sql) ? [{ ms: null }] : answer(sql),
    );
    const d = await getMachinesRunning(pool, 1);
    expect(d.asOfUtc).toBeNull();
    expect(d.generation.generation).toMatchObject({ ordinal: 3 });
  });
});

/* ---------------------------------------------------------- envelope.ts */

describe('loadMeta — transformVersion describes the rows being shown', () => {
  it('scopes MAX(transform_version) to the generation the screens read', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, () => [
      { weightBasis: 'gross', shiftMode: 'corrected', transformVersion: 1, lastSyncUtc: null, sourceAgeSeconds: 10 },
    ]);
    const m = await loadMeta(pool, 1);
    const q = find(seen, /MAX\(transform_version\)/);
    expect(boundEpochs(q)).toEqual([9]);
    expect(q.sql).toMatch(/MAX\(transform_version\) FROM sms\.cone_event WHERE line_id=@line AND source_epoch = @gec0/);
    expect(m.transformVersion).toBe(1);
  });

  it('is one statement still — the scope probe is cached, not re-run per request', async () => {
    const { pool, seen } = scopedPool(PRESENT_DEV, () => [
      { weightBasis: 'gross', shiftMode: 'corrected', transformVersion: 2, lastSyncUtc: null, sourceAgeSeconds: 10 },
    ]);
    await loadMeta(pool, 1);
    await loadMeta(pool, 1);
    await loadMeta(pool, 1);
    // Three envelopes, three statements. The probe itself is intercepted by
    // the fake before `seen`, so what this proves is that loadMeta adds no
    // second round trip of its own per call.
    expect(seen.filter((s) => /MAX\(transform_version\)/.test(s.sql))).toHaveLength(3);
  });
});
