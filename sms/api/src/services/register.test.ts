/**
 * Regression test for SEPT-2026-EPOCH-DECISION §4.2: IFL dropped and
 * recreated the wide tables on 2026-08-05, so every source identity restarted
 * at 1 and `source_row_id` stopped identifying a cone or a sack on its own —
 * July's id 5 and September's id 5 are different physical cones nine weeks
 * apart. The detail lookup used to run `TOP 1 … WHERE source_row_id=@id` with
 * no ORDER BY over a non-unique index, which returned whichever generation
 * the seek met first, and the newer generation's rows were unreachable by
 * permalink once an older row shared the number.
 *
 * This drives the real `getEventDetail` against a fake pool that actually
 * APPLIES the query's key column to an in-memory table, rather than handing
 * back a canned row: a fake that returns the September row regardless of the
 * SQL would pass just as happily against the source_row_id lookup this test
 * exists to pin.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getEventDetail, listEvents, exportEventsCsv, idCol } from './register.js';
import { UNSCOPED } from './generation.js';

type Row = Record<string, unknown>;

/**
 * Serves getEventDetail's single query by reading the key column out of its
 * WHERE clause (`… AND e.<key>=@id`) and filtering `rows` by the bound @line
 * and @id, honouring TOP 1 in table order — the same arbitrary "first match"
 * the real seek gave.
 */
function tablePool(rows: Row[]): ConnectionPool {
  const params = new Map<string, unknown>();
  const req = {
    input: (name: string, _type: unknown, value: unknown) => {
      params.set(name, value);
      return req;
    },
    query: async (sql: string) => {
      const m = /AND\s+(?:\w+\.)?(\w+)\s*=\s*@id\b/.exec(sql);
      if (!m) throw new Error(`no @id key in: ${sql}`);
      const key = m[1]!;
      const hit = rows.filter((r) => r.line_id === params.get('line') && r[key] === params.get('id'));
      return { recordset: hit.slice(0, 1) };
    },
  };
  return { request: () => req } as unknown as ConnectionPool;
}

// Two physically different cones that share IFL's id 5: one from the July
// copy (epoch 1), one from the live September source (epoch 9).
const JULY_CONE: Row = { line_id: 1, cone_event_id: 5, source_row_id: 5, source_epoch: 1, weight_g: 1949 };
const SEPT_CONE: Row = { line_id: 1, cone_event_id: 200_001, source_row_id: 5, source_epoch: 9, weight_g: 1963 };
const JULY_SACK: Row = { line_id: 1, sack_event_id: 7, source_row_id: 7, source_epoch: 2, weight_kg: 50.1 };
const SEPT_SACK: Row = { line_id: 1, sack_event_id: 9_001, source_row_id: 7, source_epoch: 10, weight_kg: 49.6 };

describe('getEventDetail — two epochs sharing a source_row_id (§4.2)', () => {
  it('addresses a cone by cone_event_id, so the September cone is reachable at all', async () => {
    const pool = tablePool([JULY_CONE, SEPT_CONE]);
    const row = await getEventDetail(pool, 1, 'cone', 200_001);
    expect(row).not.toBeNull();
    expect(row!.source_epoch).toBe(9);
    expect(row!.weight_g).toBe(1963);
  });

  it('returns the July cone at its own PK, not whichever row the seek met first', async () => {
    // September first in seek order: a source_row_id lookup for 5 would
    // answer with it.
    const pool = tablePool([SEPT_CONE, JULY_CONE]);
    const row = await getEventDetail(pool, 1, 'cone', 5);
    expect(row).not.toBeNull();
    expect(row!.source_epoch).toBe(1);
    expect(row!.weight_g).toBe(1949);
  });

  it('addresses a sack by sack_event_id likewise', async () => {
    const pool = tablePool([JULY_SACK, SEPT_SACK]);
    expect((await getEventDetail(pool, 1, 'sack', 9_001))?.source_epoch).toBe(10);
    expect((await getEventDetail(pool, 1, 'sack', 7))?.source_epoch).toBe(2);
  });

  it('idCol is the canonical PK for every type', () => {
    expect(idCol('cone')).toBe('cone_event_id');
    expect(idCol('sack')).toBe('sack_event_id');
    expect(idCol('reject')).toBe('reject_event_id');
  });
});

/**
 * Provenance on every register row (roadmap Phase 3 item 4, 14 Sep 2026).
 *
 * This fake serves whatever SELECT it is given from one in-memory table,
 * emulating only the two things the provenance depends on: the epoch JOIN
 * (each row carries the `ep.*` columns its `source_epoch` would join to) and
 * the `AS prov_*` aliases the query asks for. It also records the SQL, so a
 * test can pin that the columns come from the epoch row and not from
 * anywhere else.
 *
 * `sms.source_epoch` as this sidecar actually holds it, for the epoch ids the
 * fixtures below use — so the generation fold is tested against the real
 * shape: one generation owns one epoch row PER SOURCE TABLE (3 and 4 are both
 * generation 1's reject tables), and epoch 13 is the simulator recorded as
 * `ifl_copy`, which is left standing deliberately.
 */
const EPOCH_REGISTRY: Record<number, { source_db: string; ordinal: number; provenance: string }> = {
  1: { source_db: 'DATA_TP1U2', ordinal: 1, provenance: 'ifl_copy' },
  3: { source_db: 'DATA_TP1U2', ordinal: 1, provenance: 'ifl_copy' },
  4: { source_db: 'DATA_TP1U2', ordinal: 1, provenance: 'ifl_copy' },
  9: { source_db: 'DATA_TP1U2_SEP07', ordinal: 3, provenance: 'ifl_copy' },
  11: { source_db: 'DATA_TP1U2_SEP07', ordinal: 3, provenance: 'ifl_copy' },
  13: { source_db: 'DATA_TP1U2_SIM', ordinal: 4, provenance: 'ifl_copy' },
};

function registerPool(rows: Row[], sqlSeen: string[] = []): ConnectionPool {
  const mk = () => {
    const params = new Map<string, unknown>();
    const req = {
      input: (name: string, _type: unknown, value: unknown) => {
        params.set(name, value);
        return req;
      },
      query: async (sql: string) => {
        sqlSeen.push(sql);
        // The register's count is a GROUP BY source_epoch since 23 Sep 2026
        // (RegisterPage's header). Answered here the way SQL Server would:
        // one row per distinct epoch, carrying that epoch's own registration.
        if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) {
          const by = new Map<number | null, Row[]>();
          for (const r of rows) {
            const e = (r.source_epoch as number | null) ?? null;
            by.set(e, [...(by.get(e) ?? []), r]);
          }
          return {
            recordset: [...by.entries()].map(([epoch_id, rs]) => ({
              epoch_id,
              source_db: EPOCH_REGISTRY[epoch_id ?? -1]?.source_db ?? null,
              generation_ordinal: EPOCH_REGISTRY[epoch_id ?? -1]?.ordinal ?? null,
              provenance: EPOCH_REGISTRY[epoch_id ?? -1]?.provenance ?? null,
              label: (rs[0]!.prov_epoch_label as string | null) ?? null,
              n: rs.length,
            })),
          };
        }
        if (/SELECT COUNT\(\*\) n/.test(sql)) return { recordset: [{ n: rows.length }] };
        const m = /AND\s+(?:\w+\.)?(\w+)\s*=\s*@id\b/.exec(sql);
        const hit = m ? rows.filter((r) => r[m[1]!] === params.get('id')) : rows;
        // Copied: foldProvenance mutates the row it is given.
        return { recordset: hit.map((r) => ({ ...r })) };
      },
    };
    return req;
  };
  return { request: mk } as unknown as ConnectionPool;
}

// A September cone under the live generation, exactly as the JOIN would
// return it: the epoch's table and label ride along under the prov_ aliases.
const SEPT_CONE_FULL: Row = {
  line_id: 1, event_id: 200_001, cone_event_id: 200_001, source_row_id: 5, source_epoch: 9,
  source_epoch_label: 'Live source - cones', production_ts_utc: new Date('2026-09-07T03:12:44Z'),
  shift_code: 'morning', shift_date: '2026-09-07', weight_g: 1963, in_range: true,
  prov_source_system: 'ifl_sql', prov_source_table: 'pack1_TP1U2', prov_epoch_label: 'Live source - cones',
  prov_source_row_id: 5, prov_raw_id: 275_113, prov_source_insert_utc: new Date('2026-09-07T03:30:51Z'),
  prov_ingested_at_utc: new Date('2026-09-07T03:31:02.417Z'), prov_ingest_run_id: 'C0FFEE00-0000-4000-8000-000000000001',
  prov_transform_version: 2, prov_attribution_method: 'source_column', prov_attribution_confidence: 'high',
  prov_night_belongs_to: 'start_day', prov_epoch_id: 9,
};
// A quality reject transformed BEFORE the worker's Phase 3 change: migration
// 029 added the attribution columns, nothing has filled them yet.
const OLD_REJECT: Row = {
  line_id: 1, event_id: 31, reject_event_id: 31, source_row_id: 31, source_epoch: 3, reject_type: 'quality',
  source_epoch_label: 'July copy - quality rejects', production_ts_utc: new Date('2026-07-01T09:00:00Z'),
  prov_source_system: 'ifl_sql', prov_source_table: 'rejectQCS1_TP1U2', prov_epoch_label: 'July copy - quality rejects',
  prov_source_row_id: 31, prov_raw_id: 31, prov_source_insert_utc: new Date('2026-07-01T12:40:00Z'),
  prov_ingested_at_utc: null, prov_ingest_run_id: 'C0FFEE00-0000-4000-8000-000000000002',
  prov_transform_version: 1, prov_attribution_method: null, prov_attribution_confidence: null,
  prov_night_belongs_to: null, prov_epoch_id: 3,
};

const EXPECTED_SEPT_PROVENANCE = {
  sourceSystem: 'ifl_sql',
  sourceTable: 'pack1_TP1U2',
  epochLabel: 'Live source - cones',
  sourceRowId: 5,
  rawId: 275_113,
  sourceInsertUtc: '2026-09-07T03:30:51.000Z',
  ingestedAtUtc: '2026-09-07T03:31:02.417Z',
  ingestRunId: 'C0FFEE00-0000-4000-8000-000000000001',
  transformVersion: 2,
  attributionMethod: 'source_column',
  attributionConfidence: 'high',
  nightBelongsTo: 'start_day',
  epochId: 9,
  // SEPT_CONE_FULL carries no prov_epoch_ordinal/prov_epoch_source_db (the
  // fixture predates Task B, 28 Sep 2026) — the honest reading is "not
  // known", never an invented 3/false.
  epochOrdinal: null,
  epochSimulator: false,
};

describe('provenance — where a reading came from, on every row (Phase 3 item 4)', () => {
  it('the reading sheet (getEventDetail) carries a provenance object with the epoch label and source table joined in', async () => {
    const sql: string[] = [];
    const row = await getEventDetail(registerPool([SEPT_CONE_FULL], sql), 1, 'cone', 200_001);
    expect(row).not.toBeNull();
    expect(row!.provenance).toEqual(EXPECTED_SEPT_PROVENANCE);
    // Folded, not duplicated: no loose prov_* column survives on the row.
    expect(Object.keys(row!).some((k) => k.startsWith('prov_'))).toBe(false);
    // The reading's own columns are untouched.
    expect(row!.event_id).toBe(200_001);
    expect(row!.source_epoch_label).toBe('Live source - cones');
    // The two epoch facts are selected from the JOINED epoch row.
    expect(sql[0]).toContain('ep.source_table AS prov_source_table');
    expect(sql[0]).toContain('ep.label AS prov_epoch_label');
    expect(sql[0]).toContain('LEFT JOIN sms.source_epoch ep ON ep.epoch_id = e.source_epoch');
  });

  it('the register list (listEvents) folds provenance onto every row', async () => {
    const second = { ...SEPT_CONE_FULL, cone_event_id: 200_002, event_id: 200_002 };
    const page = await listEvents(registerPool([SEPT_CONE_FULL, second]), 1, 'cone', {
      sort: 'time', dir: 'desc', page: 1, pageSize: 50,
    }, UNSCOPED);
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
    for (const r of page.rows) expect(r.provenance).toEqual(EXPECTED_SEPT_PROVENANCE);
  });

  it('a reject transformed before the attribution columns were written passes null through — nothing invented', async () => {
    const row = await getEventDetail(registerPool([OLD_REJECT]), 1, 'reject', 31);
    const p = row!.provenance as Record<string, unknown>;
    expect(p.attributionMethod).toBeNull();
    expect(p.attributionConfidence).toBeNull();
    expect(p.ingestedAtUtc).toBeNull();
    expect(p.nightBelongsTo).toBeNull();
    expect(p.sourceTable).toBe('rejectQCS1_TP1U2');
    expect(p.transformVersion).toBe(1);
  });

  it('the CSV keeps every existing column in place and appends provenance as trailing columns', async () => {
    const { csv, truncated } = await exportEventsCsv(registerPool([SEPT_CONE_FULL]), 1, 'cone', { sort: 'time', dir: 'desc' }, UNSCOPED);
    expect(truncated).toBe(false);
    const [header, line] = csv.split('\n');
    const headers = header!.split(',');
    const own = Object.keys(SEPT_CONE_FULL).filter((k) => !k.startsWith('prov_'));
    expect(headers.slice(0, own.length)).toEqual(own);
    expect(headers.slice(own.length)).toEqual([
      'provenance.sourceSystem', 'provenance.sourceTable', 'provenance.epochLabel', 'provenance.sourceRowId',
      'provenance.rawId', 'provenance.sourceInsertUtc', 'provenance.ingestedAtUtc', 'provenance.ingestRunId',
      'provenance.transformVersion', 'provenance.attributionMethod', 'provenance.attributionConfidence',
      'provenance.nightBelongsTo', 'provenance.epochId', 'provenance.epochOrdinal', 'provenance.epochSimulator',
    ]);
    const cells = line!.split(',');
    expect(cells.slice(own.length)).toEqual([
      'ifl_sql', 'pack1_TP1U2', 'Live source - cones', '5', '275113', '2026-09-07T03:30:51.000Z',
      '2026-09-07T03:31:02.417Z', 'C0FFEE00-0000-4000-8000-000000000001', '2', 'source_column', 'high', 'start_day', '9',
      '', 'false',
    ]);
    // The object itself is never a cell.
    expect(headers).not.toContain('provenance');
    expect(line).not.toContain('[object Object]');
  });
});
