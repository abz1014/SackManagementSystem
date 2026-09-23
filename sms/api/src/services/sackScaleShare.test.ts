/**
 * THE PER-DAY SACK IN-RANGE FIGURE (`sacksPassedScalePct`, 23 Sep 2026).
 *
 * Before this field the sack report's `byDay` rows carried `conesInRangePct`
 * and nothing else — a CONE figure on a SACK report — so "how did sack
 * packing go over the period?" could not be answered or charted from any
 * endpoint in the application. The shape came from `production.ts`'s day
 * grouping, not from the report, which is why the fix belongs here.
 *
 * TWO RULES THESE TESTS EXIST TO HOLD:
 *
 *  1. ONE STATUS VOCABULARY (CLAUDE.md). The flag is the SCALE's own
 *     `sack_event.in_range` bit and is named as the scale's. There is NO
 *     "within product tolerance" companion, because IFL's data carries no
 *     sack tolerance to compute one from — verified 23 Sep 2026 against the
 *     attached copies: `sack1_TP1U2` is (id, Date, Shift, Area, SackNum,
 *     Weight, inRange, MaterialId) and nothing else, and PDAS's
 *     MaterialSetpointWeight / WeightOffsetMinus / WeightOffsetPlus are the
 *     CONE setpoint. A future pass that adds a sack tolerance must get it
 *     from IFL first, not from these columns.
 *  2. NO SILENT ZERO. A group with no sack carrying a verdict is null, never
 *     0 %, because 0 % says the scale failed every sack in it.
 *
 * Against the real sidecar the field varies as a real measurement should:
 * gen 1 gives 100 / 99.3 / 99.7 / 88.5 / 85.8 % over its first five days,
 * gen 3 gives 93.8 / 82.2 / 89.3 / 94.3 / 98.5 %.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';

interface SackRow { grp: string; n: number; kg: number; judged: number; passed: number }

/**
 * Answers the generation resolution, the weight rule and the sack aggregate;
 * everything else returns an empty recordset, which `getProduction` folds to
 * zero cones and zero rejects. `sackSql` captures the statement so the shape
 * of the query itself can be asserted, not just its output.
 */
function fakePool(sacks: SackRow[]) {
  const seen: string[] = [];
  const pool = {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          seen.push(sql);
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) {
            return { recordset: [{ tbl: 'sack_event', epoch_id: 2, n: sacks.length }] };
          }
          if (sql.includes('FROM sms.source_epoch')) {
            return {
              recordset: [
                { epoch_id: 2, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - sacks' },
              ],
            };
          }
          if (sql.includes('FROM sms.weight_rule')) return { recordset: [{ basis: 'as_recorded', tare: 0.5 }] };
          if (sql.includes('FROM sms.sack_event')) return { recordset: sacks };
          return { recordset: [] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, seen };
}

const day = (grp: string, n: number, judged: number, passed: number): SackRow =>
  ({ grp, n, kg: n * 47.2, judged, passed });

describe('sacksPassedScalePct — the per-day sack figure', () => {
  it('is on every day row, to one decimal', async () => {
    const { pool } = fakePool([day('2026-06-22', 234, 234, 234), day('2026-06-25', 348, 348, 308)]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-25', groupBy: 'day' });
    const by = new Map(r.rows.map((x) => [x.group, x.sacksPassedScalePct]));
    expect(by.get('2026-06-22')).toBe(100);
    expect(by.get('2026-06-25')).toBe(88.5);
  });

  it('is a SEPARATE field from conesInRangePct, not a rename of it', async () => {
    // The specific confusion this field exists to end: a sack report row
    // carrying only a cone figure. Both must be present and independent.
    const { pool } = fakePool([day('2026-06-22', 10, 10, 5)]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-22', groupBy: 'day' });
    const row = r.rows[0]!;
    expect(row.sacksPassedScalePct).toBe(50);
    expect(row).toHaveProperty('conesInRangePct');
    expect(row.conesInRangePct).not.toBe(row.sacksPassedScalePct);
  });

  it('is NULL, never 0, when no sack in the group carried a verdict', async () => {
    const { pool } = fakePool([day('2026-06-22', 12, 0, 0)]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-22', groupBy: 'day' });
    expect(r.rows[0]!.sacks).toBe(12);
    expect(r.rows[0]!.sacksPassedScalePct).toBeNull();
  });

  it('divides by the sacks the scale JUDGED, not by every sack', async () => {
    // in_range is nullable. A sack with no verdict is neither passed nor
    // failed, and counting it in the denominator would report a quality
    // drop that is really a gap in the data.
    const { pool } = fakePool([day('2026-06-22', 100, 50, 45)]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-22', groupBy: 'day' });
    expect(r.rows[0]!.sacksPassedScalePct).toBe(90); // 45/50, not 45/100
  });

  it('is null on a station grouping — sacks carry no station at any layer', async () => {
    const { pool } = fakePool([]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-25', groupBy: 'station' });
    for (const row of r.rows) expect(row.sacksPassedScalePct).toBeNull();
  });
});

describe('the query that produces it', () => {
  it('reads the SCALE bit, and asks for no tolerance of any kind', async () => {
    const { pool, seen } = fakePool([day('2026-06-22', 1, 1, 1)]);
    await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-22', groupBy: 'day' });
    // NB: the generation-resolution UNION also reads sms.sack_event, so the
    // aggregate is identified by its own projection, not by its FROM.
    const sackSql = seen.find((s) => s.includes('ISNULL(SUM(weight_kg)'))!;
    expect(sackSql).toContain('in_range = 1');
    expect(sackSql).toContain('in_range IS NOT NULL');
    // IFL's data holds no sack setpoint or offset. If one of these ever
    // appears in this query, it came from the CONE product master and the
    // figure above has silently stopped being the scale's verdict.
    for (const forbidden of ['setpoint', 'offset', 'tolerance', 'limit_']) {
      expect(sackSql.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('rides the SAME generation scope as the counts and the kilograms beside it', async () => {
    // A sack's weight and the scale's verdict on it must come from one
    // population. They are one SELECT for that reason; this fails if a later
    // pass splits the verdict into a second, unscoped query.
    const { pool, seen } = fakePool([day('2026-06-22', 1, 1, 1)]);
    const r = await getProduction(pool, 1, { from: '2026-06-22', to: '2026-06-22', groupBy: 'day' });
    const sackStatements = seen.filter((s) => s.includes('ISNULL(SUM(weight_kg)'));
    expect(sackStatements).toHaveLength(1);
    expect(sackStatements[0]).toContain('source_epoch');
    expect(r.generationNote?.generation?.sourceDb).toBe('DATA_TP1U2');
    expect(r.generationNote?.generation?.simulator).toBe(false);
  });
});
