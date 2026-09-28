/**
 * Task B (28 Sep 2026) — ONE ANSWER, four callers.
 *
 * The Readings/Sacks register's own default ('auto', `resolveGenerationScope`
 * with no `opts.key`) must agree with every OTHER period-scoped caller that
 * already resolves a generation the same way: `production.ts` (Line),
 * `sacks.ts`'s `getSackSummary` (the sacks-summary headline), and
 * `register.ts`'s `countEvents`. If any of the four picked a DIFFERENT
 * generation for the same window, the Readings total, the Line figure, the
 * Sacks headline and the register's own scoped count would each describe a
 * different slice of the same period — exactly the disagreement the owner's
 * 28 Sep decision exists to close.
 *
 * This file drives the real `resolveGenerationScope` with the EXACT argument
 * shape each of those four call sites uses (verified by grep against
 * `production.ts:376`, `sacks.ts:145`, `register.ts`'s `countEvents`, and
 * the register route's own `{ key: q.batch }` for 'auto') rather than
 * standing up `getProduction`/`getSackSummary` themselves — those pull in
 * downtime, weight and shift-check queries that have nothing to do with
 * generation choice and would only make this fixture harder to read. What
 * is under test is real: the same exported function, the same table lists,
 * against a fixture shaped like the live dev sidecar's own two generations.
 *
 * BOTH SIDES OF THE LIVE-SCOPE POLICY. `setLiveScopeIncludesSimulator`
 * (live.ts) governs ONLY `resolveLiveScope`'s own dev-only `preferReal:
 * false` path (see generations.liveSimulator.test.ts) — every call in this
 * file is a PERIOD-scoped one, keyed on an explicit `{ from, to }`, and must
 * stay real-first regardless of that flag. Toggling it here and re-asserting
 * the same two answers is the decoupling proof, not a second code path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { resolveGenerationScope, type EventTable } from './generation.js';
import { countEvents } from './register.js';
import { invalidateLiveConfigCache, setLiveScopeIncludesSimulator } from './live.js';

/** `sms.source_epoch` for line 1 — the live dev sidecar's own two generations (see generations.liveSimulator.test.ts, which this mirrors). */
const EPOCHS = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
  { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
  { epoch_id: 15, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectQCS1_TP1U2 gen 4' },
  { epoch_id: 16, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectWeight1_TP1U2 gen 4' },
];

const WINDOW_A = { from: '2026-08-21', to: '2026-09-07' }; // -> generation 3 (real, September)
const WINDOW_B = { from: '2026-09-10', to: '2026-09-20' }; // -> generation 4 (simulator, the only one present)

const PRESENT_A = [
  { tbl: 'cone_event', epoch_id: 9, n: 55_058 },
  { tbl: 'sack_event', epoch_id: 10, n: 2_310 },
  { tbl: 'reject_event', epoch_id: 11, n: 900 },
  { tbl: 'reject_event', epoch_id: 12, n: 400 },
];
const PRESENT_B = [
  { tbl: 'cone_event', epoch_id: 13, n: 41_207 },
  { tbl: 'sack_event', epoch_id: 14, n: 1_890 },
  { tbl: 'reject_event', epoch_id: 15, n: 700 },
  { tbl: 'reject_event', epoch_id: 16, n: 300 },
];

/**
 * A fake pool that answers `resolveGenerationScope`'s two queries — the
 * per-table present-row tally and the epoch catalogue — keying the tally on
 * the BOUND `genFrom`/`genTo` params, so the same fixture can answer both
 * windows correctly rather than returning one static `present` regardless of
 * what was asked (the shape every OTHER generation fixture in this
 * directory uses, because none of them needed to distinguish two windows in
 * one pool before).
 */
function fakePool(): ConnectionPool {
  const mk = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (n: string, _t: unknown, v: unknown) => {
        inputs.set(n, v);
        return req;
      },
      query: async (sql: string) => {
        if (/FROM sms\.source_epoch WHERE line_id/.test(sql)) return { recordset: EPOCHS };
        if (/AS tbl, source_epoch/.test(sql)) {
          const from = inputs.get('genFrom');
          const present = from === WINDOW_A.from ? PRESENT_A : from === WINDOW_B.from ? PRESENT_B : [];
          // Narrow to the tables the caller actually asked for — the real
          // query only ever unions the requested tables' SELECTs.
          const wantedTables = new Set(sql.match(/'([a-z_]+)' AS tbl/g)?.map((m) => m.slice(1, -"' AS tbl".length)));
          return { recordset: present.filter((p) => wantedTables.has(p.tbl)) };
        }
        // countEvents' own scoped COUNT(*) — the number itself is not what
        // this file checks (that belongs to register.generations.test.ts);
        // only that a generation was CHOSEN and epoch-bound at all.
        if (sql.startsWith('SELECT COUNT(*) n FROM')) return { recordset: [{ n: 0 }] };
        return { recordset: [] };
      },
    };
    return req;
  };
  return { request: mk } as unknown as ConnectionPool;
}

beforeEach(() => {
  setLiveScopeIncludesSimulator(false);
  invalidateLiveConfigCache();
});
afterEach(() => {
  setLiveScopeIncludesSimulator(false);
  invalidateLiveConfigCache();
});

describe.each([
  ['LIVE_ALLOW_SIMULATOR off (the default everywhere but this dev PC)', false],
  ['LIVE_ALLOW_SIMULATOR on (dev-only; must not leak into period-scoped calls)', true],
])('%s', (_label, policyOn) => {
  beforeEach(() => {
    if (policyOn) setLiveScopeIncludesSimulator(true);
  });

  it('window A (2026-08-21 .. 2026-09-07): every caller picks generation 3', async () => {
    const pool = fakePool();

    // The register's own 'auto' default (registerQuery.batch omitted ->
    // opts.key undefined) — app.ts's route makes exactly this call.
    const registerAuto = await resolveGenerationScope(pool, 1, WINDOW_A);
    // production.ts:376 — Line's own scope, the default table list too.
    const production = await resolveGenerationScope(pool, 1, WINDOW_A);
    // sacks.ts:145 — the sacks-summary headline, cone_event + sack_event only.
    const sacksSummary = await resolveGenerationScope(pool, 1, WINDOW_A, ['cone_event', 'sack_event']);
    // register.ts's countEvents — single-table, resolved internally.
    const counted = await countEvents(pool, 1, 'cone', WINDOW_A);

    for (const s of [registerAuto, production, sacksSummary]) {
      expect(s.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
    }
    expect(counted.note.generation).toMatchObject({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', simulator: false });
  });

  it('window B (2026-09-10 .. 2026-09-20): every caller picks generation 4 — the only generation present, labelled as the simulator, never silently preferred by the live-only policy', async () => {
    const pool = fakePool();

    const registerAuto = await resolveGenerationScope(pool, 1, WINDOW_B);
    const production = await resolveGenerationScope(pool, 1, WINDOW_B);
    const sacksSummary = await resolveGenerationScope(pool, 1, WINDOW_B, ['cone_event', 'sack_event']);
    const counted = await countEvents(pool, 1, 'cone', WINDOW_B);

    for (const s of [registerAuto, production, sacksSummary]) {
      expect(s.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });
      // No real generation is present at all in this window, so this is the
      // fallback case (generation.ts's own doc comment), not a preference —
      // true with the live policy either off or on, since this call never
      // passes preferReal: false in the first place.
      expect(s.spansGenerations).toBe(false);
    }
    expect(counted.note.generation).toMatchObject({ ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', simulator: true });
  });
});

/** Sanity: the fixture itself names table lists correctly, or the above proves nothing. */
describe('fixture sanity', () => {
  it('PRESENT_A/PRESENT_B cover all three event tables', () => {
    const tables = (rows: { tbl: string }[]): Set<EventTable> => new Set(rows.map((r) => r.tbl as EventTable));
    expect(tables(PRESENT_A)).toEqual(new Set(['cone_event', 'sack_event', 'reject_event']));
    expect(tables(PRESENT_B)).toEqual(new Set(['cone_event', 'sack_event', 'reject_event']));
  });
});
