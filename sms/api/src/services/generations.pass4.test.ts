/**
 * SOURCE GENERATIONS, the four services ca34a23 left unconstrained
 * (23 Sep 2026). `register.ts`, `sackStock.ts`, `productAt.ts` and
 * `machineProducts.ts`.
 *
 * WHY THESE FOUR, AND WHY THEY ARE NOT ALL FIXED THE SAME WAY. IFL dropped
 * and recreated their four weighing tables on 2026-08-05, restarting every
 * identity at 1; `sms.source_epoch` keeps the generations apart, and a query
 * spanning the boundary reads two physically different tables as one. Three
 * of these four services FILTER to one generation. The register does not: it
 * is a listing of individual readings, every row already carries its epoch's
 * label, and hiding half the readings from a reader who asked for all of them
 * would be a worse lie than showing both. What the register does instead is
 * DECOMPOSE its count, which was the one pooled FIGURE it published.
 *
 * MEASURED, read-only, on the development sidecar on 23 Sep 2026. These are
 * the numbers the fakes below reproduce; none is invented.
 *
 *   2026-08-21 – 2026-09-07 (epoch 9, IFL's own September generation, and
 *   epoch 13, the plant simulator — the only overlap this machine has that is
 *   large enough to measure):
 *
 *     register, cones          pooled 190,306   ·  gen 3 (epoch 9)  55,058
 *     register, sacks          pooled   8,509   ·  gen 3 (epoch 10)  2,310
 *     sack ledger, weighed kg  pooled 402,170   ·  gen 3           109,248
 *     machine grid, cells with
 *       more than one material pooled 380 of 756 · gen 3   2 of 390
 *
 *   The last line is the one that is not merely a wrong figure. 378 of the
 *   380 mid-shift product changeovers the grid reported did not happen: both
 *   generations run the same six material ids over those days, so pooling
 *   puts two materials in one (station, day, shift) cell and `foldCells`
 *   emits a changeover between them, timed at a real reading time.
 *
 * THE BOUNDARY CASE. `shift_date = 1969-12-31` holds the clock-fault rows
 * that exist in BOTH of IFL's own copies — 1 cone under epoch 1 and 1 under
 * epoch 9, 2 rejects under epochs 3/4 and 1 under epoch 11. It is the only
 * two-generation overlap on this machine with no simulator anywhere in it,
 * and it is therefore the case that matters at the plant, where there is no
 * simulator and there IS their own 5 Aug rebuild. It is exercised below.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { listEvents, exportEventsCsv, foldGenerationTally, countExported } from './register.js';
import { UNSCOPED } from './generation.js';
import { getStockLedger } from './sackStock.js';
import { getMachineProductShifts } from './machineProducts.js';
import { productDisagreement } from './productAt.js';
import type { ProductTimeline } from './productAt.js';

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
  // 13-16 are the simulator's four tables, registered as `ifl_copy` by the
  // epoch.ts default removed in 6b76ae3. The rows are LEFT STANDING so the
  // registration bug stays visible, which is exactly why `simulator` must be
  // derived from source_db and not from provenance.
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
];

interface Probe {
  tbl: string;
  epoch_id: number | null;
  n: number;
}

/**
 * A pool that answers the generation probe from `present`, the source_epoch
 * read from EPOCHS, and every other statement from `answer`. Records the SQL
 * and the bound parameters of the NON-probe statements, so a test can assert
 * what the service actually asked once its scope was resolved.
 */
function scopedPool(present: Probe[], answer: (sql: string) => unknown[] = () => []) {
  const seen: { sql: string; inputs: Map<string, unknown> }[] = [];
  const mk = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => {
        inputs.set(n, v);
        return req;
      },
      query: async (sql: string) => {
        if (/GROUP BY source_epoch\s*$/.test(sql.trim()) || /AS tbl,\s*source_epoch/.test(sql)) {
          return { recordset: present, rowsAffected: [0] };
        }
        if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS, rowsAffected: [0] };
        seen.push({ sql, inputs: new Map(inputs) });
        return { recordset: answer(sql), rowsAffected: [1] };
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, seen };
}

/** The epoch ids a statement bound, in order — the predicate's real effect. */
const boundEpochs = (s: { inputs: Map<string, unknown> }): unknown[] =>
  [...s.inputs.entries()].filter(([k]) => /^ge[csr]\d+$/.test(k)).map(([, v]) => v);

/* ------------------------------------------------------- register: labels */

describe('register — the rows stay pooled and labelled; the COUNT stops being one bare figure', () => {
  it('decomposes the total into generations instead of filtering the listing', () => {
    // The measured 21 Aug - 7 Sep cone window.
    const { total, generations } = foldGenerationTally([
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones', n: 55_058 },
      { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', n: 135_248 },
    ]);
    // `total` still counts every row the register lists — pagination is over
    // it and must stay correct.
    expect(total).toBe(190_306);
    expect(generations).toHaveLength(2);
    // Newest first, and IFL's own generation is nameable on its own.
    expect(generations[0]!.ordinal).toBe(4);
    expect(generations[1]).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', rows: 55_058 });
    // Derived from source_db, NOT from provenance — epoch 13 says 'ifl_copy'
    // and is the simulator. This is the whole reason generation.ts does not
    // trust the provenance column.
    expect(generations[0]!.simulator).toBe(true);
    expect(generations[1]!.simulator).toBe(false);
  });

  it('folds on (source_db, ordinal), so one reject generation is ONE generation and not two', () => {
    // reject_event is fed by two source tables, so generation 1 owns epochs 3
    // AND 4. Keying on epoch_id would report this listing as two generations.
    const { total, generations } = foldGenerationTally([
      { epoch_id: 3, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - quality rejects', n: 2_900 },
      { epoch_id: 4, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - weight rejects', n: 246 },
    ]);
    expect(total).toBe(3_146);
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({ key: 'DATA_TP1U2#1', ordinal: 1, rows: 3_146 });
  });

  it('gives an unregistered epoch its own entry rather than merging it into a neighbour', () => {
    const { generations } = foldGenerationTally([
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones', n: 10 },
      { epoch_id: 99, source_db: null, generation_ordinal: null, provenance: null, label: null, n: 4 },
    ]);
    expect(generations).toHaveLength(2);
    const orphan = generations.find((g) => g.ordinal === null)!;
    expect(orphan.rows).toBe(4);
    expect(orphan.label).toMatch(/unregistered/);
    // Sorted last, so the figure at the top is the one the period is about.
    expect(generations[generations.length - 1]).toBe(orphan);
  });

  it('the 1969-12-31 boundary: two of IFL’s OWN generations, one row each, no simulator', async () => {
    // The clock-fault rows present in both client copies: cone epoch 1 and
    // cone epoch 9, one row apiece. Before this change the register said
    // "2 readings" with nothing to say it was two different source tables.
    const rows = [
      { line_id: 1, cone_event_id: 5, event_id: 5, source_epoch: 1, prov_epoch_id: 1, prov_epoch_label: 'July copy - cones' },
      { line_id: 1, cone_event_id: 200_001, event_id: 200_001, source_epoch: 9, prov_epoch_id: 9, prov_epoch_label: 'September copy - cones' },
    ];
    const pool = {
      request: () => {
        const req = {
          input: () => req,
          query: async (sql: string) => {
            if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) {
              return {
                recordset: [
                  { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones', n: 1 },
                  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones', n: 1 },
                ],
              };
            }
            return { recordset: rows.map((r) => ({ ...r })) };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;

    const page = await listEvents(pool, 1, 'cone', {
      from: '1969-12-31', to: '1969-12-31', sort: 'time', dir: 'desc', page: 1, pageSize: 50,
    }, UNSCOPED);
    // BOTH rows still list — the register does not hide a generation.
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(2);
    // …and the 2 is no longer bare.
    expect(page.generations).toHaveLength(2);
    expect(page.generations!.map((g) => g.ordinal)).toEqual([3, 1]);
    expect(page.generations!.every((g) => g.rows === 1)).toBe(true);
    expect(page.generations!.some((g) => g.simulator)).toBe(false);
  });

  it('the CSV cap can drop a whole generation, and `exported` is what says so', () => {
    // Two generations match the filters; the cap let through only the newer.
    const generations = [
      { key: 'DATA_TP1U2_SIM#4', ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', label: 'gen 4', simulator: true, rows: 135_248 },
      { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', label: 'gen 3', simulator: false, rows: 55_058 },
    ];
    const keyOfEpoch = new Map([[13, 'DATA_TP1U2_SIM#4'], [9, 'DATA_TP1U2_SEP07#3']]);
    const rows = Array.from({ length: 20_000 }, () => ({ provenance: { epochId: 13 } }));
    const exported = countExported(rows, generations, keyOfEpoch);
    expect(exported).toHaveLength(1);
    expect(exported[0]!.key).toBe('DATA_TP1U2_SIM#4');
    expect(exported[0]!.rows).toBe(20_000);
    // Generation 3 matched 55,058 rows and not one of them is in the file.
    // `truncated` alone could never have stated that.
    expect(exported.some((g) => g.key === 'DATA_TP1U2_SEP07#3')).toBe(false);
  });

  it('exportEventsCsv reports both what matched and what the cap let through', async () => {
    const { pool } = scopedPool([], (sql) =>
      /AS epoch_id/.test(sql) && /GROUP BY/.test(sql)
        ? [
            { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones', n: 2 },
            { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones', n: 1 },
          ]
        : [
            { line_id: 1, event_id: 1, weight_g: 1949, prov_epoch_id: 1, prov_epoch_label: 'July copy - cones' },
            { line_id: 1, event_id: 2, weight_g: 1963, prov_epoch_id: 9, prov_epoch_label: 'September copy - cones' },
            { line_id: 1, event_id: 3, weight_g: 1955, prov_epoch_id: 9, prov_epoch_label: 'September copy - cones' },
          ],
    );
    const out = await exportEventsCsv(pool, 1, 'cone', { from: '1969-12-31', to: '2026-09-07', sort: 'time', dir: 'desc' }, UNSCOPED);
    expect(out.generations.map((g) => g.rows)).toEqual([2, 1]);
    expect(out.exported.map((g) => g.rows)).toEqual([2, 1]);
    // Every row carries its own epoch id as a trailing CSV column.
    expect(out.csv.split('\n')[0]).toContain('provenance.epochId');
  });
});

/* ------------------------------------------------ machineProducts: events */

describe('machineProducts — pooling did not blur a figure, it INVENTED a changeover', () => {
  const params = { from: '2026-08-21', to: '2026-09-07' };

  it('constrains the grid to one generation and says which', async () => {
    const { pool, seen } = scopedPool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 55_058 },
        { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
      ],
      () => [],
    );
    const data = await getMachineProductShifts(pool, 1, params);
    // Generation 3 — IFL's own — is preferred over the newer simulator one.
    expect(data.generationNote!.generation!.ordinal).toBe(3);
    expect(data.generationNote!.generation!.simulator).toBe(false);
    expect(data.generationNote!.spansGenerations).toBe(true);
    expect(data.generationNote!.otherGenerationExcluded).toBe(135_248);

    // The grid query binds epoch 9 and nothing else…
    const grid = seen.find((s) => /GROUP BY c\.source_station/.test(s.sql))!;
    expect(grid.sql).toMatch(/source_epoch = @/);
    expect(boundEpochs(grid)).toEqual([9]);
    // …and so does the no-station count, which is read as "and these are in
    // no cell" — only true of the generation the cells came from.
    const noSt = seen.find((s) => /source_station IS NULL/.test(s.sql))!;
    expect(boundEpochs(noSt)).toEqual([9]);
  });

  it('leaves a single-generation period untouched — no predicate, same answer', async () => {
    const { pool, seen } = scopedPool([{ tbl: 'cone_event', epoch_id: 9, n: 55_058 }]);
    const data = await getMachineProductShifts(pool, 1, params);
    expect(data.generationNote!.spansGenerations).toBe(false);
    expect(data.generationNote!.otherGenerationExcluded).toBe(0);
    const grid = seen.find((s) => /GROUP BY c\.source_station/.test(s.sql))!;
    expect(boundEpochs(grid)).toEqual([9]);
  });

  it('binds the epoch as a parameter and never as a literal', async () => {
    const { pool, seen } = scopedPool([
      { tbl: 'cone_event', epoch_id: 9, n: 10 },
      { tbl: 'cone_event', epoch_id: 13, n: 10 },
    ]);
    await getMachineProductShifts(pool, 1, params);
    for (const s of seen) {
      expect(s.sql).not.toMatch(/source_epoch\s*(=|IN)\s*\(?\s*\d/);
      expect(s.sql).not.toMatch(/2026-08-21|2026-09-07/);
    }
  });
});

/* ---------------------------------------------------- sackStock: balances */

describe('sackStock — a double-counted receipt compounds down the whole ledger', () => {
  const q = { from: '2026-08-21', to: '2026-09-07' };

  it('scopes the weighed side to one generation, on BOTH the period and the prior window', async () => {
    const { pool, seen } = scopedPool([
      { tbl: 'sack_event', epoch_id: 10, n: 2_310 },
      { tbl: 'sack_event', epoch_id: 14, n: 6_199 },
    ]);
    const led = await getStockLedger(pool, 1, q);
    expect(led.generationNote!.generation!.ordinal).toBe(3);
    expect(led.generationNote!.otherGenerationExcluded).toBe(6_199);

    const weighed = seen.filter((s) => /FROM sms\.sack_event/.test(s.sql));
    // the in-period receipts, the opening balance, and the residue count
    expect(weighed.length).toBeGreaterThanOrEqual(3);
    const inPeriod = weighed.find((s) => /BETWEEN @from AND @to/.test(s.sql))!;
    const prior = weighed.find((s) => /shift_date < @from/.test(s.sql) && !/NOT \(/.test(s.sql))!;
    expect(boundEpochs(inPeriod)).toEqual([10]);
    expect(boundEpochs(prior)).toEqual([10]);
  });

  it('the manual movements are NOT scoped — they are app-owned and carry no epoch', async () => {
    const { pool, seen } = scopedPool([
      { tbl: 'sack_event', epoch_id: 10, n: 2_310 },
      { tbl: 'sack_event', epoch_id: 14, n: 6_199 },
    ]);
    await getStockLedger(pool, 1, q);
    for (const s of seen.filter((x) => /sms\.sack_stock_movement/.test(x.sql))) {
      expect(s.sql).not.toMatch(/source_epoch/);
    }
  });

  it('names the prior sacks the opening balance leaves out rather than folding them in', async () => {
    const { pool } = scopedPool(
      [
        { tbl: 'sack_event', epoch_id: 10, n: 2_310 },
        { tbl: 'sack_event', epoch_id: 14, n: 6_199 },
      ],
      (sql) => (/NOT \(/.test(sql) ? [{ n: 5_462 }] : []),
    );
    const led = await getStockLedger(pool, 1, q);
    // 5,462 is the July sample's own sack count: real sacks, in another
    // generation, deliberately outside this opening balance AND deliberately
    // not silent. What an opening balance means across IFL's 5 Aug rebuild is
    // still an open question — this states the residue, it does not answer it.
    expect(led.openingOtherGenerations).toBe(5_462);
  });

  it('claims nothing when the period holds one generation', async () => {
    const { pool } = scopedPool([{ tbl: 'sack_event', epoch_id: 10, n: 2_310 }]);
    const led = await getStockLedger(pool, 1, q);
    expect(led.generationNote!.spansGenerations).toBe(false);
    expect(led.openingOtherGenerations).toBe(0);
  });
});

/* -------------------------------------------------- productAt: the verdict */

describe('productAt — the limits-vs-scale count decides whether the line is flagged', () => {
  const timeline: ProductTimeline = { entries: [] } as unknown as ProductTimeline;

  it('scopes the disagreement count to one generation and states which', async () => {
    const { pool, seen } = scopedPool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 55_058 },
        { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
      ],
      () => [{ total: 55_058, judged: 55_058, passedOut: 12, rejectedIn: 3 }],
    );
    const d = await productDisagreement(pool, 1, timeline, { from: '2026-08-21', to: '2026-09-07' });
    expect(d.generationNote!.generation!.ordinal).toBe(3);
    expect(d.generationNote!.otherGenerationExcluded).toBe(135_248);
    const count = seen.find((s) => /FROM sms\.cone_event/.test(s.sql))!;
    expect(count.sql).toMatch(/source_epoch = @/);
    expect(boundEpochs(count)).toEqual([9]);
  });

  it('the boundary: cone epochs 1 and 9 on one production day resolve to the newer generation', async () => {
    const { pool, seen } = scopedPool(
      [
        { tbl: 'cone_event', epoch_id: 1, n: 1 },
        { tbl: 'cone_event', epoch_id: 9, n: 1 },
      ],
      () => [{ total: 1, judged: 0, passedOut: 0, rejectedIn: 0 }],
    );
    const d = await productDisagreement(pool, 1, timeline, { from: '1969-12-31', to: '1969-12-31' });
    // Both are IFL's own; neither is the simulator; the newer wins and the
    // older is reported as excluded rather than dropped in silence.
    expect(d.generationNote!.generation!.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(d.generationNote!.generation!.simulator).toBe(false);
    expect(d.generationNote!.spansGenerations).toBe(true);
    expect(d.generationNote!.otherGenerationExcluded).toBe(1);
    expect(boundEpochs(seen.find((s) => /FROM sms\.cone_event/.test(s.sql))!)).toEqual([9]);
  });
});
