/**
 * COMMIT 3 (Task T1, 28 Sep 2026): the dev-only LIVE_ALLOW_SIMULATOR policy,
 * end to end — `resolveGenerationScope`'s `preferReal` option, `live.ts`'s
 * `setLiveScopeIncludesSimulator`/`liveScopeIncludesSimulator`, and
 * `resolveLiveScope` passing the policy through.
 *
 * THE PROBLEM THIS FLAG ANSWERS. `resolveLiveScope`'s real-first rule (the
 * owner's 23 Sep 2026 decision, `live.ts`'s own file header) is correct at
 * IFL and correct for every period-scoped report — and it means that on THIS
 * dev PC, where the frozen real September copy (generation 3,
 * `DATA_TP1U2_SEP07`) coexists with the live plant simulator (generation 4,
 * `DATA_TP1U2_SIM`), the live "now" screens always read generation 3 and
 * therefore always say "cannot tell" about anything happening right now —
 * there is nothing live to rehearse against. The flag lets the live scope
 * alone pick generation 4 instead, gated at startup by `config.ts`'s
 * `resolveLiveSimulator` so it can never do anything against a real plant
 * connection (see `config.liveSimulator.test.ts`).
 *
 * `scopedPool`/`EPOCHS`/`PRESENT_DEV` below are copied from
 * `generations.live.test.ts` (per this task's own brief — that file is not
 * touched by this task) so the two files describe the SAME dev sidecar shape
 * without one importing test fixtures from the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  getLive,
  invalidateLiveConfigCache,
  liveScopeIncludesSimulator,
  resolveLiveScope,
  setLiveScopeIncludesSimulator,
} from './live.js';
import { resolveGenerationScope } from './generation.js';
import { plantNowMs } from './plantClock.js';

/** `sms.source_epoch` for line 1, verbatim from the dev sidecar (see generations.live.test.ts). */
const EPOCHS = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
  { epoch_id: 2, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - sacks' },
  { epoch_id: 3, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - quality rejects' },
  { epoch_id: 4, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - weight rejects' },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
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

/** Just IFL's own generation — no simulator rows present at all. */
const PRESENT_NO_SIM = [
  { tbl: 'cone_event', epoch_id: 9, n: 132_552 },
  { tbl: 'sack_event', epoch_id: 10, n: 5_435 },
  { tbl: 'reject_event', epoch_id: 11, n: 900 },
  { tbl: 'reject_event', epoch_id: 12, n: 400 },
];

interface Seen {
  sql: string;
  inputs: Map<string, unknown>;
}

/** Copied from generations.live.test.ts (see file header) — that file is untouched by this task. */
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

beforeEach(() => {
  setLiveScopeIncludesSimulator(false);
  invalidateLiveConfigCache();
});
afterEach(() => {
  setLiveScopeIncludesSimulator(false);
  invalidateLiveConfigCache();
  vi.useRealTimers();
});

describe('resolveLiveScope — the dev-only policy', () => {
  it('1. default policy (off) picks the real SEP07 generation, exactly as before this task', async () => {
    expect(liveScopeIncludesSimulator()).toBe(false);
    const { pool } = scopedPool(PRESENT_DEV);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
  });

  it('2. policy on picks generation 4, with epoch ids cone 13 / sack 14 / reject 15', async () => {
    setLiveScopeIncludesSimulator(true);
    expect(liveScopeIncludesSimulator()).toBe(true);
    const { pool } = scopedPool(PRESENT_DEV);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });
    expect(s.epochIds('cone_event')).toEqual([13]);
    expect(s.epochIds('sack_event')).toEqual([14]);
    expect(s.epochIds('reject_event')).toEqual([15]);
  });

  it('3. policy on, but no simulator generation present at all, still picks generation 3', async () => {
    setLiveScopeIncludesSimulator(true);
    const { pool } = scopedPool(PRESENT_NO_SIM);
    const s = await resolveLiveScope(pool, 1);
    expect(s.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
  });

  it('4. toggling the policy changes the answer WITHOUT a separate cache invalidation', async () => {
    const { pool } = scopedPool(PRESENT_DEV);
    const before = await resolveLiveScope(pool, 1);
    expect(before.generation).toMatchObject({ ordinal: 3 });

    // No invalidateLiveConfigCache() call here — setLiveScopeIncludesSimulator
    // itself must clear the cache, or this next resolve would still answer
    // from the cached "off" entry.
    setLiveScopeIncludesSimulator(true);
    const after = await resolveLiveScope(pool, 1);
    expect(after.generation).toMatchObject({ ordinal: 4, simulator: true });
  });

  it('5. a period-scoped resolveGenerationScope call stays real-first regardless of the live policy — reports stay real', async () => {
    // The live policy is ON here, but this is NOT a call through
    // resolveLiveScope — it is the same kind of call a report/register
    // service makes, with its own window. It must not inherit the live
    // screens' policy at all: the two are decoupled by design.
    setLiveScopeIncludesSimulator(true);
    const { pool } = scopedPool(PRESENT_DEV);
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-21', to: '2026-09-07' });
    expect(s.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
  });
});

describe('getLive — policy on, the simulator generation drives the live "now" screens', () => {
  it('6. health ok, generation.simulator true, nothing newer elsewhere, running, self bound', async () => {
    setLiveScopeIncludesSimulator(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
    const plantNow = plantNowMs();
    const LAG_SECONDS = 1090; // the simulator's own measured mean lag (this file's sibling's header)
    const TIP = plantNow - LAG_SECONDS * 1000;

    const answer = (sql: string): unknown[] => {
      if (/DATEDIFF\(SECOND, src_ProductionDate, src_Date\)/.test(sql)) {
        return Array.from({ length: 9 }, () => ({ lagSeconds: LAG_SECONDS }));
      }
      if (/SELECT MAX\(tip\) AS tip/.test(sql)) return [{ tip: TIP }];
      // Nothing newer than the chosen generation's own tip — self excludes
      // the chosen generation's own rows, and there is nothing else newer.
      if (/production_ts_utc_ms > @tip/.test(sql)) return [];
      if (/DATEDIFF\(SECOND, prev, finished\)/.test(sql)) {
        return Array.from({ length: 5 }, () => ({ gapSeconds: 60 }));
      }
      if (/ORDER BY finished ASC/.test(sql)) return [{ target_table: 'cone_raw', ageSeconds: 40 }];
      if (/TOP 1 production_ts_utc AS ts, cone_event_id/.test(sql)) {
        return [{ ts: new Date(TIP), event_id: 1, source_row_id: 1, source_station: 3, weight_g: 1950, in_range: true }];
      }
      if (/LAG\(ms\) OVER \(ORDER BY ms\)/.test(sql)) return [{ runStart: new Date(TIP) }];
      return [];
    };

    const { pool, seen } = scopedPool(PRESENT_DEV, answer);
    const d = await getLive(pool, 1, 'Line 3');
    const line = d.lines[0]!;

    expect(line.health.kind).toBe('ok');
    expect(line.generation.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });
    expect(line.generation.newerElsewhereUtc).toBeNull();
    expect(line.state.status).toBe('running');

    const newer = seen.find((s) => /production_ts_utc_ms > @tip/.test(s.sql));
    expect(newer, 'findNewerElsewhere query not issued').toBeTruthy();
    expect(newer!.inputs.get('selfDb')).toBe('DATA_TP1U2_SIM');
    expect(newer!.inputs.get('selfOrd')).toBe(4);
  });
});
