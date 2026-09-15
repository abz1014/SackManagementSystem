/**
 * The stock ledger's arithmetic, its validation rules and what its writes
 * put in the database (roadmap Phase 7, 15 Sep 2026). Pure functions where
 * the logic is pure; a recording fake pool where SQL is what matters.
 *
 * Pinned here:
 *  - opening is carried (the balance before `from`, then each day's closing);
 *  - closing = opening + openingEntries + receipts − issues − consumption ± adjustments;
 *  - weighed sacks are receipts, with the net basis applied like production.ts;
 *  - a negative quantity is accepted for an adjustment and refused otherwise;
 *  - occurredAtPlant is required, plant-clock, not in the future;
 *  - the INSERT never names machine_id, and goes through one transaction
 *    with its audit row.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  buildLedger, daysOf, getStockLedger, insertMovement, parsePlantLocal, signOf, validateMovement,
  type LedgerFacts,
} from './sackStock.js';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 15 Sep 2026 12:00 plant time

const baseFacts = (over: Partial<LedgerFacts> = {}): LedgerFacts => ({
  from: '2026-09-10',
  to: '2026-09-12',
  product: null,
  priorWeighed: [],
  priorManual: [],
  weighed: [],
  manual: [],
  weightBasis: 'as_recorded',
  tareKg: 0.5,
  products: new Map([[21, 'Cotton 30s']]),
  ...over,
});

describe('buildLedger — the balance arithmetic', () => {
  it('carries the opening balance from before the period and each day into the next', () => {
    const led = buildLedger(baseFacts({
      // 100 sacks weighed before the period, and a hand-recorded issue of 30 before it.
      priorWeighed: [{ materialId: 21, sacks: 100, kg: 5000 }],
      priorManual: [{ materialId: 21, type: 'issue', sacks: 30, kg: 1500, noKg: 0, rows: 1 }],
      weighed: [
        { day: '2026-09-10', materialId: 21, sacks: 10, kg: 500 },
        { day: '2026-09-12', materialId: 21, sacks: 5, kg: 250 },
      ],
      manual: [
        { day: '2026-09-11', materialId: 21, type: 'consumption', sacks: 4, kg: 200, noKg: 0, rows: 2 },
        { day: '2026-09-12', materialId: 21, type: 'adjustment', sacks: -1, kg: -50, noKg: 0, rows: 1 },
      ],
    }));
    expect(led.opening).toEqual({ sacks: 70, kg: 3500 });
    expect(led.days.map((d) => d.day)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    // day 1: 70 + 10 weighed
    expect(led.days[0]!.opening.sacks).toBe(70);
    expect(led.days[0]!.receipts.sacks).toBe(10);
    expect(led.days[0]!.weighed.sacks).toBe(10);
    expect(led.days[0]!.closing.sacks).toBe(80);
    // day 2: nothing weighed, 4 consumed
    expect(led.days[1]!.opening.sacks).toBe(80);
    expect(led.days[1]!.receipts.sacks).toBe(0);
    expect(led.days[1]!.consumption.sacks).toBe(4);
    expect(led.days[1]!.closing.sacks).toBe(76);
    expect(led.days[1]!.movements).toBe(2);
    // day 3: 5 weighed, a -1 correction
    expect(led.days[2]!.opening.sacks).toBe(76);
    expect(led.days[2]!.adjustments.sacks).toBe(-1);
    expect(led.days[2]!.closing.sacks).toBe(80);
    expect(led.closing).toEqual({ sacks: 80, kg: 4000 });
    expect(led.totals.receipts.sacks).toBe(15);
    expect(led.totals.consumption.sacks).toBe(4);
    expect(led.totals.adjustments.sacks).toBe(-1);
  });

  it('closing = opening + openingEntries + receipts − issues − consumption + adjustments, on one day', () => {
    const led = buildLedger(baseFacts({
      from: '2026-09-10',
      to: '2026-09-10',
      weighed: [{ day: '2026-09-10', materialId: null, sacks: 12, kg: 600 }],
      manual: [
        { day: '2026-09-10', materialId: null, type: 'opening', sacks: 50, kg: 2500, noKg: 0, rows: 1 },
        { day: '2026-09-10', materialId: null, type: 'receipt', sacks: 3, kg: 150, noKg: 0, rows: 1 },
        { day: '2026-09-10', materialId: null, type: 'issue', sacks: 20, kg: 1000, noKg: 0, rows: 1 },
        { day: '2026-09-10', materialId: null, type: 'consumption', sacks: 7, kg: 350, noKg: 0, rows: 1 },
        { day: '2026-09-10', materialId: null, type: 'adjustment', sacks: 2, kg: 100, noKg: 0, rows: 1 },
      ],
    }));
    const d = led.days[0]!;
    expect(d.opening.sacks).toBe(0);
    expect(d.openingEntries.sacks).toBe(50);
    expect(d.receipts.sacks).toBe(15); // 12 weighed + 3 manual
    expect(d.weighed.sacks).toBe(12);
    expect(d.issues.sacks).toBe(20);
    expect(d.consumption.sacks).toBe(7);
    expect(d.adjustments.sacks).toBe(2);
    expect(d.closing.sacks).toBe(0 + 50 + 15 - 20 - 7 + 2);
    expect(d.closing.kg).toBe(0 + 2500 + 750 - 1000 - 350 + 100);
  });

  it('applies the net basis to weighed kg the way production.ts does, and never to manual kg', () => {
    const led = buildLedger(baseFacts({
      from: '2026-09-10',
      to: '2026-09-10',
      weightBasis: 'net',
      tareKg: 0.5,
      weighed: [{ day: '2026-09-10', materialId: 21, sacks: 10, kg: 500 }],
      manual: [{ day: '2026-09-10', materialId: 21, type: 'issue', sacks: 2, kg: 99, noKg: 0, rows: 1 }],
    }));
    expect(led.days[0]!.weighed.kg).toBe(495); // 500 − 10 × 0.5
    expect(led.days[0]!.issues.kg).toBe(99);
    expect(led.closing.kg).toBe(396);
  });

  it('keeps a per-material ledger with its own carried opening, and counts rows lacking kg', () => {
    const led = buildLedger(baseFacts({
      priorWeighed: [{ materialId: 21, sacks: 40, kg: 2000 }, { materialId: null, sacks: 5, kg: 250 }],
      priorManual: [{ materialId: 21, type: 'issue', sacks: 10, kg: null, noKg: 1, rows: 1 }],
      weighed: [{ day: '2026-09-11', materialId: 21, sacks: 6, kg: 300 }],
      manual: [{ day: '2026-09-11', materialId: null, type: 'consumption', sacks: 1, kg: null, noKg: 1, rows: 1 }],
    }));
    const cotton = led.byMaterial.find((m) => m.materialId === 21)!;
    const none = led.byMaterial.find((m) => m.materialId === null)!;
    expect(cotton.productName).toBe('Cotton 30s');
    expect(cotton.opening.sacks).toBe(30);
    expect(cotton.closing.sacks).toBe(36);
    expect(cotton.kgMissing).toBe(1);
    expect(none.opening.sacks).toBe(5);
    expect(none.closing.sacks).toBe(4);
    expect(led.kgMissing).toBe(2);
    // the no-product bucket is listed last
    expect(led.byMaterial[led.byMaterial.length - 1]!.materialId).toBeNull();
    // and the line total is the sum of the materials
    expect(led.closing.sacks).toBe(cotton.closing.sacks + none.closing.sacks);
  });

  it('states its basis and why there is no machine level, on every response', () => {
    const led = buildLedger(baseFacts());
    expect(led.basis).toBe('line');
    expect(led.machineLevel.enabled).toBe(false);
    expect(led.machineLevel.reason).toMatch(/no machine or station/);
    expect(led.machineLevel.reason).toMatch(/has not been asked/);
    expect(led.dayBasis).toBe('production_day');
    expect(led.sackTimeIsInsertTime).toBe(true);
    expect(led.receiptMeaning).toMatch(/developer's reading/);
  });

  it('emits every day of the period, empty days included, so the balance line is continuous', () => {
    expect(daysOf('2026-09-28', '2026-10-02')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    const led = buildLedger(baseFacts({ from: '2026-09-28', to: '2026-10-02', priorWeighed: [{ materialId: null, sacks: 3, kg: 150 }] }));
    expect(led.days).toHaveLength(5);
    for (const d of led.days) expect(d.closing.sacks).toBe(3);
  });

  it('signs: issue and consumption subtract; opening, receipt and adjustment add as given', () => {
    expect(signOf('issue')).toBe(-1);
    expect(signOf('consumption')).toBe(-1);
    expect(signOf('opening')).toBe(1);
    expect(signOf('receipt')).toBe(1);
    expect(signOf('adjustment')).toBe(1);
  });
});

describe('validateMovement — the rules beyond shape', () => {
  const ok = { movementType: 'issue', quantitySacks: 5, occurredAtPlant: '2026-09-15T10:30', reason: 'to warehouse' };

  it('accepts a well-formed issue and returns the plant-clock instant', () => {
    const v = validateMovement(ok, NOW);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.occurredAtPlant.toISOString()).toBe('2026-09-15T10:30:00.000Z');
      expect(v.value.quantityKg).toBeNull();
      expect(v.value.materialId).toBeNull();
      expect(v.value.reason).toBe('to warehouse');
    }
  });

  it('refuses a negative quantity for anything but an adjustment', () => {
    for (const t of ['opening', 'receipt', 'issue', 'consumption']) {
      const v = validateMovement({ ...ok, movementType: t, quantitySacks: -2 }, NOW);
      expect(v.ok, t).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/only an adjustment may be negative/);
    }
    const adj = validateMovement({ ...ok, movementType: 'adjustment', quantitySacks: -2, reason: 'miscount' }, NOW);
    expect(adj.ok).toBe(true);
  });

  it('refuses a zero quantity', () => {
    const v = validateMovement({ ...ok, quantitySacks: 0 }, NOW);
    expect(v.ok).toBe(false);
  });

  it('requires occurredAtPlant, as a plant-clock time, not in the future', () => {
    const { occurredAtPlant: _drop, ...without } = ok;
    void _drop;
    expect(validateMovement(without, NOW).ok).toBe(false);
    expect(validateMovement({ ...ok, occurredAtPlant: 'yesterday' }, NOW).ok).toBe(false);
    const future = validateMovement({ ...ok, occurredAtPlant: '2026-09-15T14:00' }, NOW);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/future/);
    // an hour of skew is allowed
    expect(validateMovement({ ...ok, occurredAtPlant: '2026-09-15T12:45' }, NOW).ok).toBe(true);
  });

  it('an adjustment needs a reason; other movements may omit one', () => {
    const noReason = validateMovement({ movementType: 'adjustment', quantitySacks: 1, occurredAtPlant: '2026-09-15T10:30' }, NOW);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toMatch(/reason/);
    const issue = validateMovement({ movementType: 'issue', quantitySacks: 1, occurredAtPlant: '2026-09-15T10:30' }, NOW);
    expect(issue.ok).toBe(true);
  });

  it('refuses an unknown movement type and a negative kg on a non-adjustment', () => {
    expect(validateMovement({ ...ok, movementType: 'dispatch' }, NOW).ok).toBe(false);
    expect(validateMovement({ ...ok, quantityKg: -3 }, NOW).ok).toBe(false);
    expect(validateMovement({ ...ok, movementType: 'adjustment', quantityKg: -3, reason: 'x' }, NOW).ok).toBe(true);
  });

  it('parsePlantLocal treats a trailing Z as the same plant-clock value, never a zone conversion', () => {
    expect(parsePlantLocal('2026-09-15T10:30')?.toISOString()).toBe('2026-09-15T10:30:00.000Z');
    expect(parsePlantLocal('2026-09-15T10:30:15Z')?.toISOString()).toBe('2026-09-15T10:30:15.000Z');
    expect(parsePlantLocal('2026-09-15 10:30')).toBeNull();
    expect(parsePlantLocal('2026-13-45T10:30')).toBeNull();
  });
});

/* ---------------------------------------------------------- the SQL side */

interface Stmt { sql: string; inputs: Map<string, unknown> }

function recordingPool(responses: unknown[][] = []) {
  const statements: Stmt[] = [];
  const txLog: string[] = [];
  let i = 0;
  const makeReq = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (name: string, _type: unknown, value: unknown) => {
        inputs.set(name, value);
        return req;
      },
      query: async (sql: string) => {
        statements.push({ sql, inputs: new Map(inputs) });
        return { recordset: responses[i++] ?? [], rowsAffected: [1] };
      },
    };
    return req;
  };
  const pool = {
    request: makeReq,
    transaction: () => ({
      begin: async () => { txLog.push('begin'); },
      commit: async () => { txLog.push('commit'); },
      rollback: async () => { txLog.push('rollback'); },
      request: makeReq,
    }),
  };
  return { pool: pool as unknown as ConnectionPool, statements, txLog };
}

describe('getStockLedger — what it asks the database', () => {
  it('binds line, from, to and the product on every period query, and never a machine', async () => {
    const { pool, statements } = recordingPool([[], [], [], [], [{ basis: 'net', tare: 0.5 }], []]);
    const led = await getStockLedger(pool, 1, { from: '2026-09-01', to: '2026-09-07', product: 21, tsTo: '2026-09-07T20:00:00.000Z' });
    expect(led.weightBasis).toBe('net');
    expect(led.tareKg).toBe(0.5);
    const sackQueries = statements.filter((s) => s.sql.includes('sms.sack_event'));
    const ledgerQueries = statements.filter((s) => s.sql.includes('sms.sack_stock_movement'));
    expect(sackQueries).toHaveLength(2);
    expect(ledgerQueries).toHaveLength(2);
    for (const s of [...sackQueries, ...ledgerQueries]) {
      expect(s.inputs.get('line')).toBe(1);
      expect(s.inputs.get('from')).toBe('2026-09-01');
      expect(s.inputs.get('product')).toBe(21);
      expect(s.sql).toMatch(/material_id = @product/);
      expect(s.sql).not.toMatch(/machine/);
      // no literal dates anywhere in the SQL
      expect(s.sql).not.toMatch(/2026-09/);
    }
    // the in-period sack query honours the replay cap on the production instant
    const inPeriod = sackQueries.find((s) => s.sql.includes('BETWEEN @from AND @to'))!;
    expect(inPeriod.sql).toMatch(/production_ts_utc_ms <= @tsTo/);
    expect(inPeriod.inputs.get('tsTo')).toBe(new Date('2026-09-07T20:00:00.000Z').getTime());
    // the prior queries read strictly before `from`
    const prior = sackQueries.find((s) => s.sql.includes('shift_date < @from'));
    expect(prior).toBeDefined();
  });
});

describe('insertMovement — one transaction, no machine, an audit row', () => {
  const rule = { boundaries: { morningStart: 360, eveningStart: 840, nightStart: 1320 }, nightBelongsTo: 'start_day' as const };

  it('writes the row and its audit entry inside one transaction, with the production day derived under the shift rule', async () => {
    const { pool, statements, txLog } = recordingPool([[{ movement_id: 41, recorded_at_utc: new Date('2026-09-15T05:00:00Z') }], []]);
    const out = await insertMovement(pool, 1, 7, {
      movementType: 'issue',
      quantitySacks: 5,
      quantityKg: 250,
      materialId: 21,
      // 02:30 on the 15th is the night shift that began on the 14th → production day 14th
      occurredAtPlant: new Date('2026-09-15T02:30:00.000Z'),
      reason: 'to warehouse',
    }, rule);
    expect(out.movementId).toBe(41);
    expect(out.productionDay).toBe('2026-09-14');
    expect(txLog).toEqual(['begin', 'commit']);

    const insert = statements.find((s) => s.sql.includes('INSERT INTO sms.sack_stock_movement'))!;
    expect(insert.sql).not.toMatch(/machine/i);
    expect(insert.sql).toMatch(/'manual'/);
    expect(insert.inputs.get('line')).toBe(1);
    expect(insert.inputs.get('material')).toBe(21);
    expect(insert.inputs.get('type')).toBe('issue');
    expect(insert.inputs.get('sacks')).toBe(5);
    expect(insert.inputs.get('kg')).toBe(250);
    expect(insert.inputs.get('day')).toBe('2026-09-14');
    expect(insert.inputs.get('by')).toBe(7);
    expect((insert.inputs.get('at') as Date).toISOString()).toBe('2026-09-15T02:30:00.000Z');

    const audit = statements.find((s) => s.sql.includes('INSERT INTO sms.audit_log'))!;
    expect(audit.inputs.get('action')).toBe('stock.movement');
    expect(audit.inputs.get('type')).toBe('sack_stock_movement');
    expect(audit.inputs.get('target')).toBe('41');
    expect(audit.inputs.get('actor')).toBe(7);
    expect(String(audit.inputs.get('detail'))).toMatch(/issue 5 sacks \/ 250 kg product 21 at 2026-09-15 02:30 plant time \(day 2026-09-14\) — to warehouse/);
  });

  it('rolls back and rethrows when the insert fails, so no audit row stands for a movement that was not written', async () => {
    const { pool, txLog } = recordingPool();
    const failing = {
      ...pool,
      transaction: () => ({
        begin: async () => { txLog.push('begin'); },
        commit: async () => { txLog.push('commit'); },
        rollback: async () => { txLog.push('rollback'); },
        request: () => {
          const req = { input: () => req, query: async () => { throw new Error('CK_sack_stock_qty'); } };
          return req;
        },
      }),
    } as unknown as ConnectionPool;
    await expect(insertMovement(failing, 1, 7, {
      movementType: 'issue', quantitySacks: 5, quantityKg: null, materialId: null,
      occurredAtPlant: new Date('2026-09-15T10:30:00.000Z'), reason: null,
    }, rule)).rejects.toThrow(/CK_sack_stock_qty/);
    expect(txLog).toEqual(['begin', 'rollback']);
  });
});
