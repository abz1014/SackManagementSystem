/**
 * C-039 / D-86 (2 Oct 2026): `limitsChangedInPeriod` counted a product's
 * CREATION version as "a change". A change needs a predecessor: the first
 * version a product ever has is its start, not an edit of anything. Live,
 * materials 1021-1024 (created 11 Aug, 18 Aug, 3 Sep, 3 Sep) reported 1
 * limits change in a period that contained only their creation, while the
 * PDAS diff shows 0 limit changes.
 *
 * (reports/product.ts and weightStations.ts carry the identical filter and
 * were changed with it; getSpec is the one with a direct unit seam.)
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getSpec } from './spc.js';

const v = (from: string, sp: string) => ({
  product_id: 1022, setpoint_g: sp, offset_minus_g: '50.00', offset_plus_g: '50.00',
  effective_from: new Date(from), effective_is_lower_bound: false, source: 'pdas_observed',
});

/** `rows` newest first, as `ORDER BY effective_from DESC` returns them. */
function pool(rows: ReturnType<typeof v>[]): ConnectionPool {
  return {
    request() {
      return {
        input() { return this; },
        async query(sql: string) {
          if (sql.includes('FROM sms.product_limit_version')) return { recordset: rows, rowsAffected: [rows.length] };
          if (sql.includes('FROM sms.product p')) {
            return { recordset: [{ product_id: 1022, description: '205-IL0-SD', lot_code: null, active_flag: true }], rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
    },
  } as unknown as ConnectionPool;
}

describe('getSpec — limitsChangedInPeriod counts changes, not creations', () => {
  it('the only version begins inside the period: it is the product\'s creation, so 0 changes', async () => {
    const s = await getSpec(pool([v('2026-08-18T10:00:00Z', '1950.00')]), 1022, null, null, 'cone', { from: '2026-08-05', to: '2026-08-31' });
    expect(s.source).toBe('product');
    expect(s.limitsChangedInPeriod).toBe(0);
  });

  it('a creation before the period and one edit inside it: 1 change', async () => {
    const s = await getSpec(
      pool([v('2026-08-20T10:00:00Z', '1960.00'), v('2026-08-01T00:00:00Z', '1950.00')]),
      1022, null, null, 'cone', { from: '2026-08-05', to: '2026-08-31' },
    );
    expect(s.nominal).toBe(1960);
    expect(s.limitsChangedInPeriod).toBe(1);
  });

  it('creation and an edit both inside the period: only the edit counts', async () => {
    const s = await getSpec(
      pool([v('2026-08-20T10:00:00Z', '1960.00'), v('2026-08-10T00:00:00Z', '1950.00')]),
      1022, null, null, 'cone', { from: '2026-08-05', to: '2026-08-31' },
    );
    expect(s.limitsChangedInPeriod).toBe(1);
  });
});
