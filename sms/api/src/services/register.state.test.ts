/**
 * The register's state column and `?state=` filter (roadmap Phase 4 item 1,
 * 14 Sep 2026) — pinned at the SQL the service issues, through a recording
 * fake pool, since the classification itself is proven against the fixture in
 * coneState.test.ts and this file only needs to show the register USES it:
 * one CASE for the column, the same CASE for the filter, and nothing else
 * judging a cone.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { exportEventsCsv, getEventDetail, listEvents } from './register.js';
import type { StateContext } from './coneState.js';

interface Captured { sql: string; params: Map<string, unknown> }

function recordingPool(answer: (sql: string) => Record<string, unknown>[]): { pool: ConnectionPool; calls: Captured[] } {
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
          return { recordset: answer(sql) };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const CTX: StateContext = {
  plausibility: { loG: 1500, hiG: 2100 },
  windows: [{ materialId: 14, fromMs: null, toMs: null, loG: 1930, hiG: 1990 }],
};

const answer = (sql: string) => (sql.includes('COUNT(*)') ? [{ n: 1 }] : [{ event_id: 1, state: 'low' }]);

describe('listEvents — state', () => {
  it('emits a state column for cones when a classification context is given', async () => {
    const { pool, calls } = recordingPool(answer);
    const page = await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX });
    const rows = calls.find((c) => c.sql.includes('OFFSET'))!;
    expect(rows.sql).toMatch(/\) AS state FROM sms\.cone_event e/);
    expect(rows.sql).toContain("WHEN e.in_range = 0 THEN 'rejected'");
    expect(rows.params.get('scPlausLo')).toBe(1500);
    expect(rows.params.get('scMat0')).toBe(14);
    expect(page.rows[0]!.state).toBe('low');
  });

  it('emits no state column without a context, and never for sacks or rejects', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 });
    await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX });
    await listEvents(pool, 1, 'reject', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX });
    for (const c of calls) expect(c.sql).not.toContain('AS state');
  });

  it('filters by the SAME CASE: `(CASE …) IN (@state0, @state1)` with the names bound', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX, states: ['low', 'high'] });
    const count = calls[0]!;
    expect(count.sql).toMatch(/\(CASE WHEN e\.weight_g IS NULL[^]*END\) IN \(@state0, @state1\)/);
    expect(count.params.get('state0')).toBe('low');
    expect(count.params.get('state1')).toBe('high');
    // The filter's CASE and the column's CASE bind under different prefixes so
    // one statement can hold both.
    const rows = calls[1]!;
    expect(rows.params.has('fsPlausLo')).toBe(true);
    expect(rows.params.has('scPlausLo')).toBe(true);
  });

  it('an empty state list, or a list with no context, matches nothing rather than everything', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX, states: [] });
    expect(calls[0]!.sql).toContain('1 = 0');
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, states: ['within'] });
    expect(calls[2]!.sql).toContain('1 = 0');
  });

  it('ignores a state filter on sacks — they have no classification', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, classification: CTX, states: ['rejected'] });
    expect(calls[0]!.sql).not.toContain('CASE');
    expect(calls[0]!.sql).not.toContain('1 = 0');
  });
});

describe('listEvents — product', () => {
  it('filters cones and rejects by material_id, never sacks', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, product: 14 });
    await listEvents(pool, 1, 'reject', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, product: 14 });
    await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50, product: 14 });
    expect(calls[0]!.sql).toContain('e.material_id = @product');
    expect(calls[0]!.params.get('product')).toBe(14);
    expect(calls[2]!.sql).toContain('e.material_id = @product');
    expect(calls[4]!.sql).not.toContain('@product');
  });

  it('cone and reject rows carry product_name from the mirror; sacks do not join it', async () => {
    const { pool, calls } = recordingPool(answer);
    await listEvents(pool, 1, 'cone', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 });
    await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 });
    expect(calls[1]!.sql).toContain('AS product_name');
    expect(calls[1]!.sql).toContain('LEFT JOIN sms.product p ON p.product_id = e.material_id');
    expect(calls[3]!.sql).not.toContain('sms.product p');
  });
});

describe('detail and CSV carry the same state', () => {
  it('getEventDetail adds the state column for a cone with a context', async () => {
    const { pool, calls } = recordingPool(() => [{ event_id: 7, state: 'rejected' }]);
    const row = await getEventDetail(pool, 1, 'cone', 7, CTX);
    expect(calls[0]!.sql).toContain('AS state');
    expect(row!.state).toBe('rejected');
  });

  it('exportEventsCsv puts `state` after the reading\'s own columns, before provenance', async () => {
    const { pool, calls } = recordingPool(() => [
      { event_id: 1, weight_g: 1900, in_range: true, state: 'low', prov_source_system: 'ifl_sql', prov_epoch_label: 'x' },
    ]);
    const { csv } = await exportEventsCsv(pool, 1, 'cone', { sort: 'time', dir: 'desc', classification: CTX, states: ['low'] });
    // Selected by SHAPE, not by position: since 23 Sep 2026 the export also
    // runs a generation tally first (register.ts, RegisterPage's header), and
    // that one is a COUNT with no column list to carry `state`.
    const rowsQuery = calls.find((c) => c.sql.includes('SELECT TOP (@cap)'))!;
    expect(rowsQuery.sql).toContain('AS state');
    // The tally counts the SAME population the file does — the state filter
    // is on it too, or the two would disagree about what was matched.
    const tally = calls.find((c) => c.sql.includes('AS epoch_id'))!;
    expect(tally.sql).toContain("IN (@state0)");
    const header = csv.split('\n')[0]!.split(',');
    expect(header.indexOf('state')).toBeGreaterThan(header.indexOf('in_range'));
    expect(header.indexOf('state')).toBeLessThan(header.indexOf('provenance.sourceSystem'));
    expect(csv.split('\n')[1]).toContain('low');
  });
});
