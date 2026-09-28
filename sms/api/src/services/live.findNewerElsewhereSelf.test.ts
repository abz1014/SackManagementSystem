/**
 * COMMIT 1 (Task T1, 28 Sep 2026): `findNewerElsewhere`'s own `self`
 * exclusion, and that `getMachinesRunning` passes it.
 *
 * WHY THIS EXISTS. `machinesRunning.ts` anchors its tip on `sms.cone_event`
 * ALONE (its own file header, rule 1), but `findNewerElsewhere` unions cones
 * AND rejects when it looks for something newer than the tip it is given.
 * Without an exclusion, a reject in the SAME chosen generation that is newer
 * than the cone-only anchor used to win `findNewerElsewhere`'s own MAX() and
 * be reported as "newer elsewhere" — a self-report about the very generation
 * already being read. `self`, an optional 5th parameter, fixes it: a WHERE
 * clause ORed onto "no epoch row at all" (so an unregistered epoch is never
 * mistaken for self), never `NOT IN (…)` — `generations.live.test.ts` (not
 * touched by this task) already pins that the query never uses that form,
 * and this file re-pins it for the `self` branch specifically.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { findNewerElsewhere, invalidateLiveConfigCache } from './live.js';
import { getMachinesRunning } from './machinesRunning.js';

interface Seen {
  sql: string;
  inputs: Map<string, unknown>;
}

/** A minimal recording pool: every query is captured and answered from `answer`. */
function fakePool(answer: (sql: string, inputs: Map<string, unknown>) => unknown[] = () => []) {
  const seen: Seen[] = [];
  const mk = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => {
        inputs.set(n, v);
        return req;
      },
      query: async (sql: string) => {
        seen.push({ sql, inputs: new Map(inputs) });
        return { recordset: answer(sql, inputs), rowsAffected: [1] };
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, seen };
}

describe('findNewerElsewhere — the optional self exclusion', () => {
  it('with self: the predicate is present, and there is still no NOT IN', async () => {
    const { pool, seen } = fakePool();
    await findNewerElsewhere(pool, 1, 1000, 2000, { sourceDb: 'DATA_TP1U2_SEP07', ordinal: 3 });
    const q = seen[seen.length - 1]!;
    expect(q.sql).toMatch(
      /WHERE e\.epoch_id IS NULL OR ISNULL\(e\.source_db, N''\) <> @selfDb OR ISNULL\(e\.generation_ordinal, -1\) <> @selfOrd/,
    );
    expect(q.sql).not.toMatch(/NOT IN/);
    expect(q.inputs.get('selfDb')).toBe('DATA_TP1U2_SEP07');
    expect(q.inputs.get('selfOrd')).toBe(3);
  });

  it('without self: the SQL is unchanged — no selfDb/selfOrd predicate at all', async () => {
    const { pool, seen } = fakePool();
    await findNewerElsewhere(pool, 1, 1000, 2000);
    const q = seen[seen.length - 1]!;
    expect(q.sql).not.toMatch(/selfDb/);
    expect(q.sql).not.toMatch(/selfOrd/);
    expect(q.inputs.has('selfDb')).toBe(false);
    expect(q.inputs.has('selfOrd')).toBe(false);
    expect(q.sql).not.toMatch(/NOT IN/);
  });

  it('self: null (the shape every caller falls back to with no chosen generation) behaves the same as omitted', async () => {
    const { pool, seen } = fakePool();
    await findNewerElsewhere(pool, 1, 1000, 2000, null);
    const q = seen[seen.length - 1]!;
    expect(q.sql).not.toMatch(/selfDb/);
    expect(q.inputs.has('selfDb')).toBe(false);
  });
});

/* --------------------------------------------------- getMachinesRunning */

/** `sms.source_epoch` for line 1: IFL's own generation beside the simulator's. */
const EPOCHS = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
];
const PRESENT = [
  { tbl: 'cone_event', epoch_id: 9, n: 132_552 },
  { tbl: 'cone_event', epoch_id: 13, n: 135_248 },
];
const TIP_GEN3 = 1_788_782_428_860; // 2026-09-07T12:00:28.860Z
const TIP_SIM = 1_790_080_162_370; //  2026-09-22T…

/**
 * Same `scopedPool` shape `generations.live.test.ts` uses (copied per this
 * task's own brief, not imported — that file is not touched by this task).
 */
function scopedPool(present: { tbl: string; epoch_id: number | null; n: number }[], answer: (sql: string, inputs: Map<string, unknown>) => unknown[]) {
  const seen: Seen[] = [];
  const mk = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => {
        inputs.set(n, v);
        return req;
      },
      query: async (sql: string) => {
        if (/AS tbl,\s*source_epoch/.test(sql)) return { recordset: present, rowsAffected: [0] };
        if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS, rowsAffected: [0] };
        seen.push({ sql, inputs: new Map(inputs) });
        return { recordset: answer(sql, inputs), rowsAffected: [1] };
      },
    };
    return req;
  };
  return { pool: { request: mk } as unknown as ConnectionPool, seen };
}

const roster = [{ station_id: 1, name: 'W1', machine_name: 'Winder 1', is_active: true }];

/** Answers getMachinesRunning's own statements, none of which run a station in the window. */
const answer = (sql: string): unknown[] => {
  // The most specific pattern first: lastSeenUtc's own per-station MAX, not
  // the anchor's plain MAX (both contain "MAX(production_ts_utc_ms)").
  if (/SELECT source_station AS st, MAX\(production_ts_utc_ms\) AS ms/.test(sql)) return [];
  if (/WITH w AS/.test(sql)) return []; // no station produced inside the window
  if (/SELECT MAX\(production_ts_utc_ms\) AS ms FROM sms\.cone_event/.test(sql)) return [{ ms: String(TIP_GEN3) }];
  if (/FROM sms\.station s/.test(sql)) return roster;
  if (/production_ts_utc_ms > @tip/.test(sql)) {
    return [{ sourceDb: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', ms: String(TIP_SIM) }];
  }
  return [];
};

describe('getMachinesRunning — passes the chosen generation as findNewerElsewhere\'s self', () => {
  it('binds selfDb/selfOrd to the chosen generation, and the predicate excludes it, not the simulator', async () => {
    invalidateLiveConfigCache();
    const { pool, seen } = scopedPool(PRESENT, answer);
    const d = await getMachinesRunning(pool, 1);

    const newer = seen.find((s) => /production_ts_utc_ms > @tip/.test(s.sql));
    expect(newer, 'findNewerElsewhere query not issued').toBeTruthy();
    expect(newer!.inputs.get('selfDb')).toBe('DATA_TP1U2_SEP07');
    expect(newer!.inputs.get('selfOrd')).toBe(3);
    expect(newer!.sql).toMatch(/ISNULL\(e\.source_db, N''\) <> @selfDb/);
    expect(newer!.sql).not.toMatch(/NOT IN/);

    // And the answer itself still names the simulator as "newer elsewhere" —
    // self only excludes the CHOSEN generation's own rows, never a genuinely
    // different one.
    expect(d.generation.newerElsewhereSourceDb).toBe('DATA_TP1U2_SIM');
  });

  it('with no other generation present at all, findNewerElsewhere is never even asked', async () => {
    invalidateLiveConfigCache();
    const { pool, seen } = scopedPool([{ tbl: 'cone_event', epoch_id: 9, n: 132_552 }], answer);
    await getMachinesRunning(pool, 1);
    expect(seen.some((s) => /production_ts_utc_ms > @tip/.test(s.sql))).toBe(false);
  });
});
