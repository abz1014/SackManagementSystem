/**
 * C-030 (D-64): persistFindings' NOT EXISTS keyed on (check, table, detail) and the
 * detail carries only a row count, so a LATER batch with the same count was dropped.
 * The first offending raw id (subject_ref) is part of the key: the same batch re-run
 * is still idempotent, a new batch of the same size is recorded.
 * A tiny in-memory model of sms.dq_finding evaluates the predicate the code sends.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { persistFindings, type Finding } from './dq.js';

interface Row { check: string; tbl: string | null; detail: string; ref: number | null }

function modelPool() {
  const rows: Row[] = [];
  const sqls: string[] = [];
  const pool = {
    request: () => {
      const p: Record<string, unknown> = {};
      const req = {
        input: (n: string, _t: unknown, v: unknown) => {
          p[n] = v;
          return req;
        },
        query: async (sql: string) => {
          sqls.push(sql);
          const where = sql.slice(sql.indexOf('NOT EXISTS'));
          const usesRef = /subject_ref/.test(where);
          const exists = rows.some(
            (r) =>
              r.check === p.check &&
              (r.tbl ?? '') === ((p.tbl as string | null) ?? '') &&
              r.detail === p.detail &&
              (!usesRef || (r.ref ?? -1) === ((p.ref as number | null) ?? -1)),
          );
          if (!exists) rows.push({ check: String(p.check), tbl: (p.tbl as string | null) ?? null, detail: String(p.detail), ref: (p.ref as number | null) ?? null });
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, rows, sqls };
}

const batch = (ref: number): Finding => ({
  check_name: 'merge_key_collision',
  severity: 'INFO',
  subject_table: 'sack_event',
  count: 2,
  detail: '2 rows share a non-unique merge key (DQ-2)',
  subject_ref: ref,
});

describe('persistFindings dedupe (C-030)', () => {
  it('the dedupe predicate includes subject_ref', async () => {
    const m = modelPool();
    await persistFindings(m.pool, 'run', [batch(10)]);
    expect(m.sqls[0]!.slice(m.sqls[0]!.indexOf('NOT EXISTS'))).toMatch(/subject_ref/);
  });

  it('two batches with the same check/table/count but different first raw ids are both recorded', async () => {
    const m = modelPool();
    await persistFindings(m.pool, 'run', [batch(10)]);
    await persistFindings(m.pool, 'run', [batch(77)]);
    expect(m.rows.map((r) => r.ref)).toEqual([10, 77]);
  });

  it('the same batch persisted twice is still recorded once', async () => {
    const m = modelPool();
    await persistFindings(m.pool, 'run', [batch(10)]);
    await persistFindings(m.pool, 'run', [batch(10)]);
    expect(m.rows).toHaveLength(1);
  });

  it('findings with no subject_ref still dedupe on (check, table, detail)', async () => {
    const m = modelPool();
    const f: Finding = { check_name: 'transform_failed', severity: 'CRITICAL', subject_table: null, count: 1, detail: 'x' };
    await persistFindings(m.pool, 'run', [f]);
    await persistFindings(m.pool, 'run', [f]);
    expect(m.rows).toHaveLength(1);
  });
});
