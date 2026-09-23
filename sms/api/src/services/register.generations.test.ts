/**
 * `register.ts::countEvents` — RT-002/RT-029 follow-up (23 Sep 2026, WS-R).
 *
 * `listEvents` is deliberately unscoped (see its own "WHY THE REGISTER
 * LABELS AND DOES NOT FILTER" header): it is a LISTING, every row already
 * carries its own generation label, and filtering it would break drill-down
 * permalinks. `total`, on that same object, is a bare `COUNT(*)` summed
 * across every generation present in the window — correct as the sum of
 * what the listing shows, but wrong the moment a caller reads it alone as a
 * figure. `reports/sack.ts` and `reports/summary.ts` both did exactly that
 * (`listEvents(...).total`), and on 21 Aug – 7 Sep — the local dev sidecar's
 * simulator generation (epochs 13-16) overlapping IFL's real September
 * generation (epochs 9-12) — that reads a scale-rejected count roughly 6x
 * the true one (see the fixture below). `reports/daily.ts` hit the same
 * defect and, not owning this file, worked around it with its own private
 * COUNT query (23 Sep 2026); `countEvents` is the fix that query should have
 * been able to call instead of duplicating it.
 *
 * `countEvents` resolves its own `resolveGenerationScope` and never sees a
 * row: it is a second, separate function precisely so a caller after a
 * bare figure has no path that also silently pools. `boundEpochsOf` proves
 * the resulting query actually BINDS the chosen generation's epoch id, not
 * merely that the returned number happens to look right.
 *
 * FOUR-WINDOW TABLE (this file's own regression proof, against the real,
 * unmocked `countEvents` — only the connection pool is faked):
 *
 * | Window                | Generation          | Before (listEvents.total, still pooled by design) | After (countEvents.count) | Why |
 * |------------------------|----------------------|------------------------------------------------------|------------------------------|-----|
 * | 22 Jun – 10 Jul         | epoch 1, real         | 62 (unchanged — one generation, nothing to pool)      | 62 (unchanged)                 | single generation in range — a scoping fix must not move a single-generation window |
 * | 5 Aug – 20 Aug          | epoch 9, real         | 54 (unchanged — one generation, nothing to pool)      | 54 (unchanged)                 | single generation in range — regression guard |
 * | 21 Aug – 7 Sep          | epoch 9 over 13       | 355 (54 + 301, POOLED, wrong)                          | 54 (epoch 9 alone)             | simulator (epoch 13) excluded; 301 rows dropped, stated via `note.otherGenerationExcluded` |
 * | 21 – 23 Sep             | epoch 13, simulator   | 301 (unchanged — only generation present)              | 301 (unchanged, `note.generation.simulator: true`) | only generation present — labelled, never hidden |
 *
 * Rows 1 and 2 are the regression guard: `countEvents` scoping a window that
 * holds only one generation must return the exact same number `listEvents`
 * already did — a "fix" that moves an unambiguous window is a bug.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { countEvents, listEvents } from './register.js';
import { boundEpochsOf, type Captured } from '../testkit/generations.js';

const REAL_JULY = { epoch: 1, ordinal: 1, db: 'DATA_TP1U2', prov: 'ifl_copy' };
const REAL_SEPT = { epoch: 9, ordinal: 3, db: 'DATA_TP1U2_SEP07', prov: 'ifl_copy' };
/** Mislabelled provenance ('ifl_copy' on a `_SIM` database) exactly as epoch 13 is on the live dev sidecar — see generation.ts's file header. */
const SIM = { epoch: 13, ordinal: 4, db: 'DATA_TP1U2_SIM', prov: 'ifl_copy' };

/** This fixture's TRUE per-generation sack scale-rejected counts. */
const COUNTS: Record<number, number> = { [REAL_JULY.epoch]: 62, [REAL_SEPT.epoch]: 54, [SIM.epoch]: 301 };

/**
 * A fake pool behaving the way the real database would for this defect
 * shape: `resolveGenerationScope`'s two queries are answered from
 * `present` (with real per-generation row counts, so `note.
 * otherGenerationExcluded` comes out exact); the COUNT query
 * `countEvents` issues returns only the epoch(s) actually bound onto it —
 * an unscoped query (nothing bound) sums every present generation, a scoped
 * one sums only the epoch ids `andEpoch` bound.
 */
function fakePool(present: readonly { epoch: number; ordinal: number; db: string; prov: string }[]): {
  pool: ConnectionPool;
  calls: Captured[];
} {
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
          const call: Captured = { sql, params: new Map(params) };
          calls.push(call);
          if (sql.includes('GROUP BY source_epoch')) {
            return { recordset: present.map((g) => ({ tbl: 'sack_event', epoch_id: g.epoch, n: COUNTS[g.epoch] })) };
          }
          if (sql.includes('FROM sms.source_epoch')) {
            return {
              recordset: present.map((g) => ({
                epoch_id: g.epoch, source_db: g.db, generation_ordinal: g.ordinal, provenance: g.prov, label: null,
              })),
            };
          }
          if (sql.startsWith('SELECT COUNT(*) n FROM')) {
            const bound = boundEpochsOf([call], 'sack_event');
            const ids = bound.length > 0 ? bound : present.map((g) => g.epoch); // unscoped (UNSCOPED) falls back to every present generation
            const n = ids.reduce((s, id) => s + (COUNTS[id] ?? 0), 0);
            return { recordset: [{ n }] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

describe('countEvents — a figure cannot pool two generations, even when the window spans them', () => {
  it('row 1: single real generation (22 Jun – 10 Jul) — unchanged', async () => {
    const { pool } = fakePool([REAL_JULY]);
    const r = await countEvents(pool, 1, 'sack', { from: '2026-06-22', to: '2026-07-10', inRange: false });
    expect(r.count).toBe(62);
    expect(r.note.spansGenerations).toBe(false);
    expect(r.note.generation?.ordinal).toBe(1);
  });

  it('row 2: single real generation (5 Aug – 20 Aug) — unchanged, regression guard', async () => {
    const { pool } = fakePool([REAL_SEPT]);
    const r = await countEvents(pool, 1, 'sack', { from: '2026-08-05', to: '2026-08-20', inRange: false });
    expect(r.count).toBe(54);
    expect(r.note.spansGenerations).toBe(false);
  });

  it('row 3 — RED reproduced then fixed: 21 Aug – 7 Sep spans the real September generation and the simulator; countEvents excludes the simulator, listEvents.total still pools both by design', async () => {
    const from = '2026-08-21';
    const to = '2026-09-07';

    // The LISTING path — listEvents — is untouched by this fix and MUST
    // still pool: it is a listing, and every row it returns is individually
    // labelled with its own generation (proven in register.test.ts and
    // again just below). This is what "Before" in the table above records:
    // reports/sack.ts and reports/summary.ts read exactly this `.total`.
    const rowFor = (epoch: number, id: number) => ({
      line_id: 1, event_id: id, sack_event_id: id, source_row_id: id, source_epoch: epoch,
      weight_kg: 49, in_range: false,
    });
    const pooledRows = [
      ...Array.from({ length: 2 }, (_, i) => rowFor(REAL_SEPT.epoch, 9_000 + i)),
      ...Array.from({ length: 2 }, (_, i) => rowFor(SIM.epoch, 13_000 + i)),
    ];
    const listingPool = registerFakePool(pooledRows);
    const listed = await listEvents(listingPool, 1, 'sack', {
      from, to, inRange: false, sort: 'time', dir: 'desc', page: 1, pageSize: 50,
    });
    // The pooled figure this whole fix exists to stop a bare consumer from
    // reading: two generations' rows, summed into one number.
    expect(listed.total).toBe(4);
    expect(listed.generations?.map((g) => g.simulator).sort()).toEqual([false, true]);
    // But every row is labelled — the listing is not silently wrong, only
    // its bare `.total` is dangerous read alone.
    for (const row of listed.rows) expect((row.provenance as { epochId: number }).epochId).toBeDefined();

    // The FIGURE path — countEvents — is the fix: scoped to the newest real
    // generation (September), the simulator's 301 rows excluded and named.
    const { pool, calls } = fakePool([REAL_SEPT, SIM]);
    const r = await countEvents(pool, 1, 'sack', { from, to, inRange: false });
    expect(r.count).toBe(54); // NOT 355 (54 + 301) — the pooled figure the old `listEvents(...).total` call produced
    expect(r.count).not.toBe(54 + 301);
    expect(r.note.spansGenerations).toBe(true);
    expect(r.note.otherGenerationExcluded).toBe(301);
    expect(r.note.generation?.simulator).toBe(false); // real preferred over simulator

    // Proves an epoch predicate was actually BOUND onto the COUNT query —
    // not merely that the number happens to look right.
    const countCall = calls.find((c) => c.sql.startsWith('SELECT COUNT(*) n FROM'))!;
    expect(boundEpochsOf([countCall], 'sack_event')).toEqual([REAL_SEPT.epoch]);
    expect(boundEpochsOf([countCall], 'sack_event')).not.toContain(SIM.epoch);
  });

  it('row 4: only the simulator generation present (21 – 23 Sep) — stated, not hidden', async () => {
    const { pool } = fakePool([SIM]);
    const r = await countEvents(pool, 1, 'sack', { from: '2026-09-21', to: '2026-09-23', inRange: false });
    expect(r.count).toBe(301);
    expect(r.note.spansGenerations).toBe(false); // only one generation was present to span
    expect(r.note.generation?.simulator).toBe(true); // labelled, never hidden
  });
});

/** A minimal stand-in for register.test.ts's own `registerPool`, kept local so this file needs no cross-file fixture coupling. */
function registerFakePool(rows: { line_id: number; event_id: number; sack_event_id: number; source_row_id: number; source_epoch: number; weight_kg: number; in_range: boolean }[]): ConnectionPool {
  const REGISTRY: Record<number, { source_db: string; ordinal: number; provenance: string }> = {
    [REAL_SEPT.epoch]: { source_db: REAL_SEPT.db, ordinal: REAL_SEPT.ordinal, provenance: REAL_SEPT.prov },
    [SIM.epoch]: { source_db: SIM.db, ordinal: SIM.ordinal, provenance: SIM.prov },
  };
  const req = () => {
    const params = new Map<string, unknown>();
    const r = {
      input: (name: string, _t: unknown, v: unknown) => {
        params.set(name, v);
        return r;
      },
      query: async (sql: string) => {
        if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) {
          const by = new Map<number, typeof rows>();
          for (const row of rows) by.set(row.source_epoch, [...(by.get(row.source_epoch) ?? []), row]);
          return {
            recordset: [...by.entries()].map(([epoch_id, rs]) => ({
              epoch_id, source_db: REGISTRY[epoch_id]?.source_db ?? null, generation_ordinal: REGISTRY[epoch_id]?.ordinal ?? null,
              provenance: REGISTRY[epoch_id]?.provenance ?? null, label: null, n: rs.length,
            })),
          };
        }
        // The rows SELECT — foldProvenance reads prov_* columns; supply the minimum it needs.
        return {
          recordset: rows.map((row) => ({
            ...row, source_epoch_label: null,
            prov_source_system: 'ifl_sql', prov_source_table: 'sack1_TP1U2', prov_epoch_label: null,
            prov_source_row_id: row.source_row_id, prov_raw_id: row.event_id, prov_source_insert_utc: null,
            prov_ingested_at_utc: null, prov_ingest_run_id: null, prov_transform_version: 1,
            prov_attribution_method: null, prov_attribution_confidence: null, prov_night_belongs_to: null,
            prov_epoch_id: row.source_epoch,
          })),
        };
      },
    };
    return r;
  };
  return { request: req } as unknown as ConnectionPool;
}
