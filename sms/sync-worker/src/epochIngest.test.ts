/**
 * Regression tests for epoch-scoped ingest (Sep 2026).
 *
 * The bug these pin was measured, not imagined: with the raw dedupe probe keyed
 * on (line_id, src_id) alone, a September batch of ids 1..132,552 landed
 * entirely inside July's occupied range and 132,552 of 132,552 rows were
 * discarded as "already seen" — then the transform advanced its watermark past
 * them, so they were never revisited. Two layers, both silent.
 *
 * persistRaw now scopes the probe by source_epoch; persistCanonical dedupes on
 * raw_id (OUR identity) rather than IFL's reusable source_row_id. The same run
 * was then proven live: 132,552 read, 132,552 written, at both layers.
 *
 * The fake pool answers from the SQL TEXT, not from the bound parameter. That
 * is deliberate: persistRaw binds @epoch regardless, so a fake keyed on the
 * parameter would keep passing after the predicate was deleted from the query
 * — which is exactly the mistake the first version of this file made.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { persistRaw } from './raw/persistRaw.js';
import { persistCanonical, type ColSpec } from './transform/persistCanonical.js';

interface BulkCapture {
  columns: string[];
  rows: unknown[][];
}

/**
 * Answers the dedupe probe the way a real table would: scoped by epoch ONLY IF
 * the SQL actually says `source_epoch = @epoch`; otherwise every occupied id
 * across all generations comes back, as an unscoped query would return.
 */
function fakeRawPool(occupied: Record<number, number[]>, bulkLog: BulkCapture[]): ConnectionPool {
  return {
    request: () => {
      const params: Record<string, unknown> = {};
      const req = {
        input: (name: string, _type: unknown, value: unknown) => {
          params[name] = value;
          return req;
        },
        query: async (sql: string) => {
          const scoped = /source_epoch\s*=\s*@epoch/.test(sql);
          const ids = scoped ? (occupied[Number(params.epoch)] ?? []) : Object.values(occupied).flat();
          return { recordset: ids.map((src_id) => ({ src_id })) };
        },
        bulk: async (table: { columns: { name: string }[]; rows: unknown[][] }) => {
          bulkLog.push({ columns: table.columns.map((c) => c.name), rows: table.rows });
          return { rowsAffected: [table.rows.length] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const DEF = {
  key: 'cone',
  sourceTable: 'pack1_TP1U2',
  rawTable: 'sms_raw.cone_raw',
  columns: [{ src: 'id', raw: 'src_id', type: 'int' }],
} as never;

describe('persistRaw — epoch-scoped dedupe', () => {
  it('ingests a new generation whose ids all collide with the previous one', async () => {
    // Epoch 1 already holds ids 1..5. Epoch 9 (a rebuilt source) sends the SAME ids.
    const bulkLog: BulkCapture[] = [];
    const pool = fakeRawPool({ 1: [1, 2, 3, 4, 5] }, bulkLog);
    const records = [1, 2, 3, 4, 5].map((src_id) => ({ src_id }));

    const res = await persistRaw(pool, DEF, 1, 'run', records, 9);

    expect(res).toEqual({ read: 5, written: 5 });
    expect(bulkLog).toHaveLength(1);
    // The epoch is written on every row, in the column migration 026 made NOT NULL.
    const epochIdx = bulkLog[0]!.columns.indexOf('source_epoch');
    expect(epochIdx).toBeGreaterThanOrEqual(0);
    expect(bulkLog[0]!.rows.every((r) => r[epochIdx] === 9)).toBe(true);
  });

  it('still skips rows already present in the SAME generation', async () => {
    const bulkLog: BulkCapture[] = [];
    const pool = fakeRawPool({ 1: [1, 2, 3] }, bulkLog);
    const records = [1, 2, 3, 4, 5].map((src_id) => ({ src_id }));

    const res = await persistRaw(pool, DEF, 1, 'run', records, 1);

    expect(res).toEqual({ read: 5, written: 2 });
    expect(bulkLog[0]!.rows).toHaveLength(2);
  });
});

describe('persistCanonical — dedupes on raw_id, not source_row_id', () => {
  const COLS: ColSpec[] = [
    { name: 'line_id', type: mssql.Int, nullable: false },
    { name: 'source_epoch', type: mssql.Int, nullable: false },
    { name: 'source_row_id', type: mssql.BigInt },
    { name: 'raw_id', type: mssql.BigInt },
  ];

  it('writes a row whose source_row_id already exists under another raw_id', async () => {
    // Two physically different cones, nine weeks apart, sharing IFL's counter
    // value 5. raw_id 1001 (July) is in canonical; raw_id 2001 (September) is
    // not. The probe row carries BOTH columns so a dedupe keyed on either one
    // gets a realistic answer — and only the raw_id-keyed one is right.
    const bulkLog: BulkCapture[] = [];
    const pool = {
      request: () => {
        const req = {
          input: () => req,
          query: async () => ({ recordset: [{ raw_id: 1001, source_row_id: 5 }] }),
          bulk: async (t: { columns: { name: string }[]; rows: unknown[][] }) => {
            bulkLog.push({ columns: t.columns.map((c) => c.name), rows: t.rows });
            return { rowsAffected: [t.rows.length] };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;

    const rows = [
      { line_id: 1, source_epoch: 1, source_row_id: 5, raw_id: 1001 },
      { line_id: 1, source_epoch: 9, source_row_id: 5, raw_id: 2001 },
    ];
    const res = await persistCanonical(pool, 'sms.cone_event', COLS, rows, { minRawId: 1001 });

    expect(res).toEqual({ read: 2, written: 1 });
    const rawIdx = bulkLog[0]!.columns.indexOf('raw_id');
    expect(bulkLog[0]!.rows[0]![rawIdx]).toBe(2001);
  });
});
