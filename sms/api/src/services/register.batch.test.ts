/**
 * Task B (28 Sep 2026, owner decision): "the Readings and Sacks registers
 * list ONE data batch by default, the same one Line and Report use for that
 * period. They disclose the others and offer a switch to them."
 *
 * Measured on the dev copy for 1-28 Sep, BEFORE this fix: Readings said
 * 179,097 cones weighed where the real count is 19,792, and 4,523 rejected
 * by inspection where the real count is 901 — `listEvents`'s `total` pooling
 * every generation present in the window, silently. This file drives the
 * real `listEvents`/`exportEventsCsv`, through a fake pool that actually
 * APPLIES the bound `source_epoch`/`IN (...)` predicate to an in-memory
 * table (not a canned recordset), so a regression that stops binding the
 * scope, or stops reading `total` off the scoped generation, fails here —
 * not merely "looks plausible".
 *
 * RED, confirmed by temporarily reverting `scopedTotal` (register.ts) to
 * `return pooledTotal` unconditionally: 'auto lists only the newest real
 * generation…' below fails `expected 2 to be 4`, and 'listing a batch by
 * explicit key…' fails the same way — both read the pooled figure instead
 * of the scoped one. Restored before this file shipped.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { exportEventsCsv, listEvents, tableFor } from './register.js';
import { resolveGenerationScope, UNSCOPED, type EventTable } from './generation.js';

type Row = Record<string, unknown>;

const REGISTRY: Record<number, { source_db: string; ordinal: number; provenance: string; label: string }> = {
  9: { source_db: 'DATA_TP1U2_SEP07', ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
  14: { source_db: 'DATA_TP1U2_SIM', ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
};

/**
 * Applies the bound epoch predicate for real: the rows/count query binds
 * `ge<letter><i>` parameters (generation.ts's `epochFragment`) whenever the
 * scope constrains the table, and this fake filters `rows` by them —
 * proving the WHERE actually narrows the result, not merely that the right
 * number happens to come back.
 */
function batchPool(rows: Row[]): { pool: ConnectionPool; sqlSeen: string[] } {
  const sqlSeen: string[] = [];
  const mk = () => {
    const params = new Map<string, unknown>();
    const req = {
      input: (name: string, _t: unknown, v: unknown) => {
        params.set(name, v);
        return req;
      },
      query: async (sql: string) => {
        sqlSeen.push(sql);
        if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) {
          // The unconstrained tally — every batch present, never filtered.
          const by = new Map<number, Row[]>();
          for (const r of rows) by.set(r.source_epoch as number, [...(by.get(r.source_epoch as number) ?? []), r]);
          return {
            recordset: [...by.entries()].map(([epoch_id, rs]) => ({
              epoch_id,
              source_db: REGISTRY[epoch_id]?.source_db ?? null,
              generation_ordinal: REGISTRY[epoch_id]?.ordinal ?? null,
              provenance: REGISTRY[epoch_id]?.provenance ?? null,
              label: REGISTRY[epoch_id]?.label ?? null,
              n: rs.length,
            })),
          };
        }
        // The rows SELECT (listEvents) or the capped export SELECT — both
        // carry whatever `ge*` params `andEpoch` bound, if any.
        const boundEpochIds = [...params.entries()].filter(([k]) => k.startsWith('ge')).map(([, v]) => v as number);
        const filtered = boundEpochIds.length > 0 ? rows.filter((r) => boundEpochIds.includes(r.source_epoch as number)) : rows;
        return {
          recordset: filtered.map((r) => ({
            ...r,
            prov_source_system: 'ifl_sql',
            prov_source_table: 'sack1_TP1U2',
            prov_epoch_label: REGISTRY[r.source_epoch as number]?.label ?? null,
            prov_source_row_id: r.source_row_id,
            prov_raw_id: r.event_id,
            prov_source_insert_utc: null,
            prov_ingested_at_utc: null,
            prov_ingest_run_id: null,
            prov_transform_version: 1,
            prov_attribution_method: null,
            prov_attribution_confidence: null,
            prov_night_belongs_to: null,
            prov_epoch_id: r.source_epoch,
          })),
        };
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, sqlSeen };
}

/** `sms.source_epoch` for line 1, the two rows this fixture's generations own. */
const EPOCHS = [
  { epoch_id: 9, source_db: REGISTRY[9]!.source_db, generation_ordinal: REGISTRY[9]!.ordinal, provenance: REGISTRY[9]!.provenance, label: REGISTRY[9]!.label },
  { epoch_id: 14, source_db: REGISTRY[14]!.source_db, generation_ordinal: REGISTRY[14]!.ordinal, provenance: REGISTRY[14]!.provenance, label: REGISTRY[14]!.label },
];

/** A pool that answers BOTH resolveGenerationScope's two queries (from EPOCHS) and the register's own queries (from `rows`) — so a scope can be resolved and then handed to listEvents/exportEventsCsv against the same in-memory table. */
function combinedPool(rows: Row[]): { pool: ConnectionPool; sqlSeen: string[] } {
  const { pool: register, sqlSeen } = batchPool(rows);
  const mk = () => {
    const inner = (register.request as () => { input: (n: string, t: unknown, v: unknown) => unknown; query: (sql: string) => Promise<unknown> })();
    const params = new Map<string, unknown>();
    const req = {
      input: (name: string, t: unknown, v: unknown) => {
        params.set(name, v);
        inner.input(name, t, v);
        return req;
      },
      query: async (sql: string) => {
        if (/AS tbl, source_epoch/.test(sql)) {
          // resolveGenerationScope's present-row tally, over the SAME rows.
          const by = new Map<number, Row[]>();
          for (const r of rows) by.set(r.source_epoch as number, [...(by.get(r.source_epoch as number) ?? []), r]);
          return { recordset: [...by.entries()].map(([epoch_id, rs]) => ({ tbl: 'sack_event', epoch_id, n: rs.length })) };
        }
        if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS };
        return inner.query(sql);
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, sqlSeen };
}

const SEPT_A: Row = { line_id: 1, event_id: 1, sack_event_id: 1, source_row_id: 1, source_epoch: 9, weight_kg: 49.1, in_range: true };
const SEPT_B: Row = { line_id: 1, event_id: 2, sack_event_id: 2, source_row_id: 2, source_epoch: 9, weight_kg: 48.6, in_range: true };
const SIM_A: Row = { line_id: 1, event_id: 101, sack_event_id: 101, source_row_id: 1, source_epoch: 14, weight_kg: 49.0, in_range: true };
const SIM_B: Row = { line_id: 1, event_id: 102, sack_event_id: 102, source_row_id: 2, source_epoch: 14, weight_kg: 48.9, in_range: true };
const ALL_ROWS = [SEPT_A, SEPT_B, SIM_A, SIM_B];

describe('listEvents — one batch by default (owner decision, 28 Sep 2026)', () => {
  it("'auto' lists only the newest real generation present — total, rows and the tally all agree", async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const scope = await resolveGenerationScope(pool, 1, {}, ['sack_event']);
    expect(scope.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });

    const page = await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 }, scope);
    expect(page.total).toBe(2); // NOT 4 — the pooled figure this fix removes from `total`
    expect(page.rows.map((r) => r.event_id).sort()).toEqual([1, 2]);
    // The full breakdown survives, for the disclosure the screen shows.
    expect(page.generations?.length).toBe(2);
    expect(page.generations?.find((g) => g.simulator)?.rows).toBe(2);
    expect(page.generation?.spansGenerations).toBe(true);
    expect(page.generation?.otherGenerationExcluded).toBe(2);
    expect(page.generation?.excludedSimulator).toBe(2);
  });

  it('an explicit batch key lists the OTHER generation instead, still with the full disclosure', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const scope = await resolveGenerationScope(pool, 1, {}, ['sack_event'], { key: 'DATA_TP1U2_SIM#4' });
    expect(scope.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });

    const page = await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 }, scope);
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.event_id).sort()).toEqual([101, 102]);
    expect(page.generation?.otherGenerationExcluded).toBe(2);
  });

  it('epoch:<id> resolves to the SAME generation its own key would, for the cones-since-previous-sack shape ReadingSheet.tsx needs', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const byKey = await resolveGenerationScope(pool, 1, {}, ['sack_event'], { key: 'DATA_TP1U2_SEP07#3' });
    const byEpoch = await resolveGenerationScope(pool, 1, {}, ['sack_event'], { key: 'epoch:9' });
    expect(byEpoch.generation).toEqual(byKey.generation);
    expect(byEpoch.epochIds('sack_event')).toEqual(byKey.epochIds('sack_event'));
  });

  it('a batch key naming a generation this line never registered matches nothing — never falls back to pooling', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const scope = await resolveGenerationScope(pool, 1, {}, ['sack_event'], { key: 'DATA_TP1U2_GHOST#99' });
    expect(scope.generation).toBeNull();

    const page = await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 }, scope);
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
    // The tally is UNAFFECTED — a reader can still see what the period holds
    // and switch to a real batch, even though nothing was listed.
    expect(page.generations?.length).toBe(2);
  });

  it('UNSCOPED (no epoch tracking in this window at all) still pools, unchanged — the one case where pooling is correct', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const page = await listEvents(pool, 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 }, UNSCOPED);
    expect(page.total).toBe(4);
    expect(page.rows).toHaveLength(4);
    expect(page.generation?.spansGenerations).toBe(false);
  });
});

describe('exportEventsCsv — the same scope, plus a disclosure trailer', () => {
  it('a scoped export carries the "Data batch" / "Excluded from another data batch" trailer', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const scope = await resolveGenerationScope(pool, 1, {}, ['sack_event']);
    const { csv } = await exportEventsCsv(pool, 1, 'sack', { sort: 'time', dir: 'desc' }, scope);
    expect(csv).toContain('Data batch: September copy - sacks');
    expect(csv).toContain('Excluded from another data batch: 2 readings');
  });

  it('UNSCOPED carries no trailer — nothing was excluded', async () => {
    const { pool } = combinedPool(ALL_ROWS);
    const { csv } = await exportEventsCsv(pool, 1, 'sack', { sort: 'time', dir: 'desc' }, UNSCOPED);
    expect(csv).not.toContain('Data batch:');
    expect(csv).not.toContain('Excluded from another data batch');
  });

  it('tableFor maps every register type to its canonical event table', () => {
    const m: Record<string, EventTable> = { cone: 'cone_event', sack: 'sack_event', reject: 'reject_event' };
    for (const [type, table] of Object.entries(m)) expect(tableFor(type as 'cone' | 'sack' | 'reject')).toBe(table);
  });
});
