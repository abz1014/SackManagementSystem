/**
 * Regression tests for the independent verification of the exported report
 * PDFs, 25 Sep 2026 (scratchpad VERIFICATION.md). One block per finding fixed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { resolveGenerationScope, epochFragment } from '../generation.js';
import { describeRanTarget, RETIRED_MARKER, type RanProduct } from './ranProducts.js';
import { generationDisclosureLines } from './common.js';
import { trendPoint } from './reject.js';

/** A pool whose first query answers the per-table counts and second the epoch registry. */
function fakeGenPool(present: { tbl: string; epoch_id: number; n: number }[], epochs: { epoch_id: number; source_db: string; generation_ordinal: number; provenance: string; label: string }[]) {
  const req = () => {
    const r = {
      input: () => r,
      query: async (sql: string) => ({ recordset: /FROM sms\.source_epoch/.test(sql) ? epochs : present }),
    };
    return r;
  };
  return { request: req } as unknown as ConnectionPool;
}

// Epoch ids as on the dev copy: July 1-4 (ordinal 1), September 9-12 (ordinal 3),
// simulator 13-16 (ordinal 4, provenance recorded WRONGLY as 'ifl_copy').
const EPOCHS = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy -- cones' },
  { epoch_id: 2, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy -- sacks' },
  { epoch_id: 3, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy -- rejects' },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy -- cones' },
  { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy -- sacks' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'gen 4 -- cones' },
];

describe('M19/M20 — the management summary prior period reads ONE generation for every table', () => {
  it('a single stray Sept-copy cone does not outrank the July copy that covers the period', async () => {
    const pool = fakeGenPool(
      [
        { tbl: 'cone_event', epoch_id: 1, n: 67_044 },
        { tbl: 'sack_event', epoch_id: 2, n: 2_689 },
        { tbl: 'reject_event', epoch_id: 3, n: 1_666 },
        { tbl: 'cone_event', epoch_id: 9, n: 1 }, // the clock-fault row dated 2026-07-12
      ],
      EPOCHS,
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-07-02', to: '2026-08-04' });
    expect(s.generation?.label).toBe('July copy -- cones');
    expect(s.epochIds('cone_event')).toEqual([1]);
    expect(s.epochIds('sack_event')).toEqual([2]);
    expect(s.epochIds('reject_event')).toEqual([3]);
    expect(s.otherGenerationExcluded).toBe(1);
  });

  it('a table with rows only in ANOTHER generation reads nothing, never unconstrained', async () => {
    // Before the fix: epochIds('sack_event') was [] → no predicate → the July
    // sacks were pooled into a period whose cones came from September.
    const pool = fakeGenPool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 5_000 },
        { tbl: 'sack_event', epoch_id: 2, n: 2_000 },
      ],
      EPOCHS,
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-01', to: '2026-08-10' });
    expect(s.generation?.ordinal).toBe(3);
    expect(s.epochIds('sack_event')).toEqual([-1]);
    expect(epochFragment(s, 'sack_event').sql).toBe('source_epoch = @ges0');
  });

  it('rows with no epoch at all (pre-tracking sidecar) stay unconstrained', async () => {
    const pool = fakeGenPool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 5_000 },
        { tbl: 'sack_event', epoch_id: null as unknown as number, n: 10 },
      ],
      EPOCHS,
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-01', to: '2026-08-10' });
    expect(s.epochIds('sack_event')).toEqual([]);
  });
});

describe('R6/R7 — simulator data is named as the plant simulator, detected from source_db', () => {
  it('counts excluded simulator rows even though provenance says ifl_copy', async () => {
    const pool = fakeGenPool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 44_749 },
        { tbl: 'cone_event', epoch_id: 13, n: 106_386 },
      ],
      EPOCHS,
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-24', to: '2026-09-06' });
    expect(s.generation?.label).toBe('September copy -- cones');
    expect(s.otherGenerationExcluded).toBe(106_386);
    expect(s.excludedSimulator).toBe(106_386);
  });

  it('the printed disclosure says "plant simulator", not merely "another generation"', () => {
    const lines = generationDisclosureLines({
      spansGenerations: true,
      sourceGeneration: 'September copy -- cones',
      otherGenerationExcluded: { count: 106_386, percent: null, simulator: 106_386 },
    });
    expect(lines![1]).toMatch(/all from the plant simulator \(DATA_TP1U2_SIM/);
  });
});

const p = (id: number, label: string, setpointG: number | null, active: boolean | null = true, cones = 100): RanProduct => ({
  productId: id, label: active === false ? `${label} ${RETIRED_MARKER}` : label, cones, setpointG,
  inForceAtUtc: '2026-08-05T00:00:00.000Z', inForceIsLowerBound: false, active,
});

describe('C6/C7/W8/T4 — the target names the products that RAN', () => {
  it('several products with one setpoint: all named, one target', () => {
    const t = describeRanTarget([p(20, '205-IL0-SD #20', 1960), p(21, '205-IL0-SD #21', 1960), p(1023, '205-IL0-SD #1023', 1960)]);
    expect(t.targetG).toBe(1960);
    expect(t.label).toMatch(/#20, 205-IL0-SD #21 and 205-IL0-SD #1023/);
    expect(t.label).toMatch(/3 products ran, all with setpoint 1960\.0 g/);
    expect(t.label).not.toMatch(/201-IH0-SD/);
  });
  it('a retired product that ran carries the marker inline', () => {
    const t = describeRanTarget([p(17, 'STR-RED', 1960, false)]);
    expect(t.label).toBe(`STR-RED ${RETIRED_MARKER}`);
  });
  it('different setpoints: no single target, and says why', () => {
    const t = describeRanTarget([p(20, 'A', 1960), p(30, 'B', 1850)]);
    expect(t.targetG).toBeNull();
    expect(t.omittedReason).toMatch(/did not share one setpoint/);
    expect(t.label).toMatch(/A 1960\.0 g; B 1850\.0 g/);
  });
  it('nothing carried a product: no label, caller falls back', () => {
    expect(describeRanTarget([]).label).toBeNull();
  });
});

describe('R4 — a day BELOW the lower limit is counted, separately from above', () => {
  it('flags belowLower from the bucket rate and lcl', () => {
    const b = { bucketTs: '2026-09-06T00:00:00.000Z', generation: 3, produced: 3_444, inspected: 3_453, rejects: 35, rate: 0.0101, ucl: 0.08, lcl: 0.054, outOfControl: false };
    expect(trendPoint(b).belowLower).toBe(true);
    expect(trendPoint({ ...b, rate: 0.07 }).belowLower).toBe(false);
    expect(trendPoint({ ...b, lcl: 0 }).belowLower).toBe(false);
  });
});

describe('R9 — the reject trend matches unmatched rejects against the SAME generation\'s cones', () => {
  it('rejectSpc binds a cone-side epoch predicate inside the NOT EXISTS when given a scope', () => {
    const src = readFileSync(fileURLToPath(new URL('../rejectSpc.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/unmatchedConeEpoch = filters\.scope\s*\n?\s*\? epochWhere\(unmatchedReq, filters\.scope, 'cone_event'/);
    const rep = readFileSync(fileURLToPath(new URL('./reject.ts', import.meta.url)), 'utf8');
    expect(rep).toMatch(/scope,\s*\n\s*\}\),\s*\n\s*\]\);/);
  });
});

describe('K6 — histogram buckets survive floating-point division', () => {
  it('49.40 / 0.05 floors to 987 in IEEE doubles; the query rounds before FLOOR', () => {
    expect(Math.floor(49.4 / 0.05)).toBe(987); // the defect, in JS too
    expect(Math.floor(Math.round((49.4 / 0.05) * 1e6) / 1e6)).toBe(988);
    const src = readFileSync(fileURLToPath(new URL('../weights.ts', import.meta.url)), 'utf8');
    expect(src).toContain('FLOOR(ROUND((weight_kg - @sackAdj)/@sackBucket, 6))');
    expect(src).not.toMatch(/FLOOR\(\(weight_kg - @sackAdj\)\/@sackBucket\)/);
  });
});

describe('R9 — the printed day rate is not double-rounded', () => {
  it('321 / 2,832 prints 11.33 %, not 11.34 %', () => {
    const b = { bucketTs: '2026-08-29T00:00:00.000Z', generation: 3, produced: 2830, inspected: 2832, rejects: 321, rate: 0.11335, ucl: 0.08124, lcl: 0.05303, outOfControl: true };
    expect(trendPoint(b).ratePct).toBe(11.33);
  });
});
