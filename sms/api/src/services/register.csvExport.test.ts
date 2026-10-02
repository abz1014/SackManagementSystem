/** Register CSV export: the formula guard (D-72). */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { exportEventsCsv } from './register.js';
import { UNSCOPED } from './generation.js';

type Row = Record<string, unknown>;

function pool(rows: Row[]): ConnectionPool {
  const mk = () => {
    const req = {
      input: () => req,
      query: async (sql: string) => {
        if (/TOP \(@cap\)/.test(sql)) return { recordset: rows.map((r) => ({ ...r })) };
        return { recordset: [] };
      },
    };
    return req;
  };
  return { request: mk } as unknown as ConnectionPool;
}

const ROW: Row = {
  line_id: 1, cone_event_id: 1, source_epoch: 9, delta_g: -7.51, lot_code: '=x',
  prov_source_system: 'ifl_sql', prov_epoch_label: 'Live source — cones', prov_epoch_id: 9,
};

describe('exportEventsCsv — formula guard', () => {
  it('leaves a negative numeric cell unprefixed and prefixes a formula-looking string', async () => {
    const { csv } = await exportEventsCsv(pool([ROW]), 1, 'cone', { sort: 'time', dir: 'desc' }, UNSCOPED);
    const [header, line] = csv.split('\n');
    const cells = line!.split(',');
    const at = (h: string) => cells[header!.split(',').indexOf(h)];
    expect(at('delta_g')).toBe('-7.51');
    expect(at('lot_code')).toBe("'=x");
  });
});
