/**
 * loadSourceTables (roadmap Phase 1, 14 Sep 2026): the tables a line reads
 * are rows of sms.source_table, merged with the per-kind column shape that
 * stays in code. What these pin: a row becomes the same IflTableDef the
 * runner has always worked from; a line with no enabled rows is a halt with
 * the message that names the screen; a row the worker cannot use safely — an
 * unknown kind, a name that is not an identifier (it is bracket-quoted into
 * SQL), a raw table the transform does not read — is refused rather than
 * guessed around.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { defsFromRows, loadSourceTables, loadSourceStreams, noSourceTablesError } from './sourceTables.js';
import { DEFAULT_IFL_TABLES, TABLE_SHAPES } from './iflTables.js';

const ROWS = [
  { kind: 'cone', source_table: 'pack1_TP1U2', raw_table: 'sms_raw.cone_raw', system_code: 'ifl_sql' },
  { kind: 'sack', source_table: 'sack1_TP1U2', raw_table: 'sms_raw.sack_raw', system_code: 'ifl_sql' },
  { kind: 'reject_qcs', source_table: 'rejectQCS1_TP1U2', raw_table: 'sms_raw.reject_qcs_raw', system_code: 'ifl_sql' },
  { kind: 'reject_weight', source_table: 'rejectWeight1_TP1U2', raw_table: 'sms_raw.reject_weight_raw', system_code: 'ifl_sql' },
];

/** Answers every query from a routing table keyed by a SQL needle; records SQL and inputs. */
function fakePool(answers: { needle: string; rows: Record<string, unknown>[] }[]) {
  const calls: { sql: string; inputs: Map<string, unknown> }[] = [];
  const pool = {
    calls,
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          calls.push({ sql, inputs });
          const a = answers.find((x) => sql.includes(x.needle));
          return { recordset: a ? a.rows : [] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { calls: typeof calls };
}

describe('defsFromRows — rows become table definitions with their kind’s shape', () => {
  it('reproduces the seeded line-1 installation exactly', () => {
    expect(defsFromRows(ROWS, 1)).toEqual(DEFAULT_IFL_TABLES);
  });

  it('carries the data source’s system code onto the definition', () => {
    const [cone] = defsFromRows([{ ...ROWS[0]!, system_code: 'plant_sql' }], 2);
    expect(cone!.systemCode).toBe('plant_sql');
    expect(cone!.columns).toBe(TABLE_SHAPES.cone.columns);
  });

  it('halts, naming the screen, when the line has no rows', () => {
    expect(() => defsFromRows([], 2)).toThrow(
      'No source tables are configured for line 2. Add them in Setup › Sources (sms.source_table).',
    );
    expect(noSourceTablesError(2).message).toMatch(/Setup › Sources/);
  });

  it('refuses a kind this worker has no shape for', () => {
    expect(() => defsFromRows([{ ...ROWS[0]!, kind: 'pallet' }], 1)).toThrow(/no column shape for/);
  });

  it('refuses a source table name that is not a plain identifier — it is bracket-quoted into SQL', () => {
    expect(() => defsFromRows([{ ...ROWS[0]!, source_table: 'pack1]; DROP TABLE x; --' }], 1)).toThrow(/unsafe source table name/);
    expect(() => defsFromRows([{ ...ROWS[0]!, source_table: 'dbo.pack1_TP1U2' }], 1)).toThrow(/unsafe source table name/);
    expect(() => defsFromRows([{ ...ROWS[0]!, source_table: '' }], 1)).toThrow(/unsafe source table name/);
  });

  it('refuses a raw table that is not the one the transform reads for that kind', () => {
    // Rows written there would sync and never be transformed.
    expect(() => defsFromRows([{ ...ROWS[0]!, raw_table: 'sms_raw.cone_raw_v2' }], 1)).toThrow(/never be transformed/);
  });
});

describe('loadSourceTables — the enabled tables of a line, from sms.source_table', () => {
  it('asks for this line’s enabled rows through enabled sources, in configuration order', async () => {
    const pool = fakePool([{ needle: 'FROM sms.source_table st', rows: ROWS }]);
    const defs = await loadSourceTables(pool, 1);
    expect(defs.map((d) => d.sourceTable)).toEqual(['pack1_TP1U2', 'sack1_TP1U2', 'rejectQCS1_TP1U2', 'rejectWeight1_TP1U2']);
    const q = pool.calls[0]!;
    expect(q.inputs.get('line')).toBe(1);
    // Disabled rows and disabled sources are excluded by the query itself —
    // what the fake returns is by definition what the predicates admitted.
    expect(q.sql).toMatch(/st\.is_enabled = 1 AND ds\.is_enabled = 1/);
    expect(q.sql).toMatch(/JOIN sms\.data_source ds ON ds\.data_source_id = st\.data_source_id/);
    expect(q.sql).toMatch(/ORDER BY st\.source_table_id/);
  });

  it('halts with the "no source tables" message when the query returns nothing', async () => {
    const pool = fakePool([]);
    await expect(loadSourceTables(pool, 3)).rejects.toThrow(/No source tables are configured for line 3/);
  });
});

describe('loadSourceStreams — the system code and table name per kind, for the transform and rebuild', () => {
  it('reads every row of the line, enabled or not, and cites the configured table name', async () => {
    const pool = fakePool([{ needle: 'FROM sms.source_table st', rows: ROWS.map((r) => ({ ...r, system_code: 'plant_sql' })) }]);
    const streams = await loadSourceStreams(pool, 1);
    expect(streams.cone).toEqual({ systemCode: 'plant_sql', sourceTable: 'pack1_TP1U2' });
    expect(streams.reject_weight).toEqual({ systemCode: 'plant_sql', sourceTable: 'rejectWeight1_TP1U2' });
    expect(pool.calls[0]!.sql).not.toMatch(/is_enabled/);
    // every kind had a row: the acquisition fallback was not consulted
    expect(pool.calls).toHaveLength(1);
  });

  it('falls back to the line’s acquisition data source for a kind with no row', async () => {
    const pool = fakePool([
      { needle: 'FROM sms.source_table st', rows: [ROWS[0]!] },
      { needle: "WHERE role = 'acquisition'", rows: [{ system_code: 'ifl_sql' }] },
    ]);
    const streams = await loadSourceStreams(pool, 1);
    expect(streams.cone.sourceTable).toBe('pack1_TP1U2');
    expect(streams.sack).toEqual({ systemCode: 'ifl_sql', sourceTable: 'sack_raw' });
  });

  it('is the same halt when the line has no rows and no acquisition source', async () => {
    const pool = fakePool([]);
    await expect(loadSourceStreams(pool, 2)).rejects.toThrow(/No source tables are configured for line 2/);
  });
});
