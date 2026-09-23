/**
 * The X̄ control-limit fix (DEFECTS.md D-10, 23 Sep 2026): an I-MR band on
 * the SUBGROUP MEANS — centre X̿, limits X̿ ± 2.66·MR̄ — replacing the old
 * X̿ ± 3σ_within/√n_i band, which modelled only within-subgroup variation
 * and assumed zero between-subgroup wander. Measured on real data (see the
 * commit message and spc.ts's own comment), that assumption was false by
 * 1.76×-3.62×, and was the actual cause of the 16-38.5% violation rate D-10
 * first blamed on station bias sitting inside a subgroup.
 *
 * Pinned here:
 *  - MR̄ is computed only from TIME-CONTIGUOUS subgroup-mean pairs — a pair
 *    spanning a genuine data gap (missing buckets) must NOT enter MR̄, or a
 *    hole in production would be read as process wander.
 *  - Below a minimum number of contiguous pairs, the band is invalid rather
 *    than generously wide — no `xViolates` fires, and Nelson rules 2-8
 *    (which now share this same band's sigma) do not fire either.
 *  - The S-chart is untouched by any of this — pinned by asserting its
 *    numbers come out exactly as the old σ_within-based formula gives.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeightSpc, type SpecLimits } from './spc.js';

interface Captured { sql: string; params: Map<string, unknown> }
type SgRow = { b: Date; n: number; mean: number; s: number | null };

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function fakePool(opts: {
  summary: { n: number; mean: number; sd: number; minTs: Date; maxTs: Date; occDays: number };
  subgroups: SgRow[];
}): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          const s = sql.trim();
          if (s.includes('LEFT JOIN sms.source_epoch')) {
            // Single real generation in the window — the generation
            // predicate is not what this file is testing.
            return { recordset: [{ epoch_id: 9, gen: 3, label: 'Sept copy', provenance: 'ifl_copy', n: opts.summary.n }] };
          }
          if (s.includes('STDEV(CAST(') && s.includes(') excluded')) {
            return {
              recordset: [
                {
                  n: opts.summary.n,
                  mean: opts.summary.mean,
                  sd: opts.summary.sd,
                  excluded: 0,
                  minTs: opts.summary.minTs,
                  maxTs: opts.summary.maxTs,
                  occDays: opts.summary.occDays,
                },
              ],
            };
          }
          if (s.includes('PERCENTILE_CONT')) return { recordset: [{ med: opts.summary.mean }] };
          if (s.endsWith('ORDER BY b')) return { recordset: opts.subgroups };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

// Sized so pickBucketMinutes lands on 'daily' — see spc.ts's pickBucketMinutes:
// desiredBuckets = max(8, round(200/20)) = 10; targetMinutes = 12960/10 = 1296;
// NICE's first bucket >= 1296 minutes is 1440 (daily).
const SUMMARY = { n: 200, mean: 1975, sd: 8, minTs: day('2026-08-01'), maxTs: day('2026-08-10'), occDays: 10 };

describe('getWeightSpc — X̄ I-MR band', () => {
  it('computes MR̄ only from time-contiguous pairs, excluding a genuine data gap', async () => {
    // Day 1-3 contiguous, days 4-7 MISSING (a genuine gap), day 8-10 contiguous.
    const subgroups: SgRow[] = [
      { b: day('2026-08-01'), n: 20, mean: 1950, s: 6 },
      { b: day('2026-08-02'), n: 20, mean: 1954, s: 6 },
      { b: day('2026-08-03'), n: 20, mean: 1949, s: 6 },
      { b: day('2026-08-08'), n: 20, mean: 2000, s: 6 },
      { b: day('2026-08-09'), n: 20, mean: 1998, s: 6 },
      { b: day('2026-08-10'), n: 20, mean: 2001, s: 6 },
    ];
    // grandMean set near the FIRST cluster (~1951) so the test can show both
    // an in-band and an out-of-band verdict, not just "everything violates".
    const summary = { ...SUMMARY, mean: 1951 };
    const { pool } = fakePool({ summary, subgroups });
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-10', SPEC, PLAUS);

    expect(d.bucketLabel).toBe('daily');
    // Contiguous pairs only: |1954-1950|=4, |1949-1954|=5, |1998-2000|=2, |2001-1998|=3.
    // The day3->day8 jump (|2000-1949|=51) must NOT be counted.
    expect(d.xLimits.pairs).toBe(4);
    expect(d.xLimits.mrBar).toBeCloseTo(3.5, 5);
    expect(d.xLimits.valid).toBe(true);
    expect(d.xLimits.halfWidth).toBeCloseTo(2.66 * 3.5, 5); // = 9.31

    // The band is ONE width for the whole chart: every subgroup's xUcl/xLcl
    // is grandMean ± halfWidth, not a per-n value.
    const grandMean = summary.mean;
    for (const g of d.subgroups) {
      expect(g.xUcl).toBeCloseTo(grandMean + d.xLimits.halfWidth, 2);
      expect(g.xLcl).toBeCloseTo(grandMean - d.xLimits.halfWidth, 2);
    }
    // Band is 1951 ± 9.31 = [1941.69, 1960.31]. The first cluster (1949,
    // 1950, 1954) sits inside it; the second (1998, 2000, 2001) sits well
    // outside — the gap the model must actually distinguish.
    expect(d.subgroups.find((g) => g.mean === 1950)!.xViolates).toBe(false);
    expect(d.subgroups.find((g) => g.mean === 1954)!.xViolates).toBe(false);
    expect(d.subgroups.find((g) => g.mean === 1949)!.xViolates).toBe(false);
    expect(d.subgroups.find((g) => g.mean === 2000)!.xViolates).toBe(true);
    expect(d.subgroups.find((g) => g.mean === 1998)!.xViolates).toBe(true);
    expect(d.subgroups.find((g) => g.mean === 2001)!.xViolates).toBe(true);
    expect(d.xbarOutOfControl).toBe(3);
  });

  it('marks the band invalid, and suppresses every violation, below the minimum contiguous-pair count', async () => {
    // Two points only one bucket apart -> exactly one contiguous pair, below MIN_MR_PAIRS=3.
    const subgroups: SgRow[] = [
      { b: day('2026-08-01'), n: 20, mean: 1900, s: 6 }, // wildly off target
      { b: day('2026-08-02'), n: 20, mean: 2050, s: 6 }, // wildly off target
    ];
    const { pool } = fakePool({ summary: SUMMARY, subgroups });
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-02', SPEC, PLAUS);

    expect(d.xLimits.valid).toBe(false);
    expect(d.xLimits.pairs).toBe(1);
    // No band -> no violation claimed, however far the means sit from the grand mean.
    for (const g of d.subgroups) expect(g.xViolates).toBe(false);
    expect(d.xbarOutOfControl).toBe(0);
    for (const g of d.subgroups) expect(g.nelson).toEqual([]);
    expect(d.nelsonFlagged).toBe(0);
  });

  it('every point shares the same band sigma for Nelson rules 2-8 — no per-n scaling', async () => {
    const subgroups: SgRow[] = [
      { b: day('2026-08-01'), n: 5, mean: 1950, s: 6 }, // small n
      { b: day('2026-08-02'), n: 500, mean: 1953, s: 6 }, // large n — old model would give this a MUCH tighter se
      { b: day('2026-08-03'), n: 20, mean: 1949, s: 6 },
      { b: day('2026-08-04'), n: 20, mean: 1955, s: 6 },
    ];
    const { pool } = fakePool({ summary: SUMMARY, subgroups });
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-04', SPEC, PLAUS);
    // The X̄ band does not vary with n_i at all now.
    const widths = new Set(d.subgroups.map((g) => g.xUcl - g.xLcl));
    expect(widths.size).toBe(1);
  });

  it('leaves the S-chart untouched — sUcl/sLcl still come from σ_within, not the MR̄ band', async () => {
    const subgroups: SgRow[] = [
      { b: day('2026-08-01'), n: 20, mean: 1950, s: 6 },
      { b: day('2026-08-02'), n: 20, mean: 1954, s: 7 },
      { b: day('2026-08-03'), n: 20, mean: 1949, s: 5 },
    ];
    const { pool } = fakePool({ summary: SUMMARY, subgroups });
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-08-03', SPEC, PLAUS);
    // pooled within-subgroup sigma from n=20,s=6/7/5 each (19 dof): unchanged formula.
    const pooledNum = 19 * (36 + 49 + 25);
    const stdevWithin = Math.sqrt(pooledNum / (19 * 3));
    expect(d.stdevWithin).toBeCloseTo(stdevWithin, 2);
    const half = 3 / Math.sqrt(2 * 20);
    const expectedSUcl = stdevWithin * (1 + half);
    for (const g of d.subgroups) expect(g.sUcl).toBeCloseTo(expectedSUcl, 1);
  });
});
