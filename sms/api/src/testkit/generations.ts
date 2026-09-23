/**
 * TWO-GENERATION FAKE POOL — the shared harness for `resolveGenerationScope`
 * (`services/generation.ts`), written per the 23 Sep 2026 red-team audit
 * (WS-F). WHY THIS EXISTS: an inventory of the suite the same day found that
 * every fixture in it is SINGLE-generation — one `sms.source_epoch` row, one
 * `source_db`. Six of the audit's eight CRITICAL findings were pooling
 * defects: a query silently summing rows from two physical generations of a
 * table IFL dropped and recreated on 2026-08-05. A single-generation fixture
 * cannot fail on that defect shape, because there is nothing in it to pool.
 * This module lets a test declare TWO (or more) generations, in one line
 * each, and answers exactly the two queries `resolveGenerationScope` issues
 * — no more, so a caller's OWN downstream queries (the actual figures) still
 * see the {recordset: []} default and must be stubbed by the caller the way
 * `spc.generations.test.ts`'s `fakePool` already does.
 *
 * MODELLED ON, NOT REPLACING, `services/spc.generations.test.ts`'s
 * `fakePool` — same shape (`request().input().query()`, calls captured as
 * `{sql, params}`), because `getWeightSpc` builds its OWN generation query by
 * hand (a `LEFT JOIN sms.source_epoch`) rather than calling
 * `resolveGenerationScope`. That fake cannot serve a caller that goes through
 * `resolveGenerationScope`'s own two-query shape (a UNION ALL present-rows
 * count, then a separate `sms.source_epoch` read) — this module is that
 * second idiom, not a rewrite of the first.
 *
 * THE MISLABELLED-SIMULATOR SHAPE IS DELIBERATE. On the live dev sidecar,
 * epochs 13-16 (the plant simulator's own tables, `source_db` ending
 * `_SIM`) are registered with `provenance = 'ifl_copy'` — a real bug in
 * `cli/src/commands/epoch.ts`'s old `--provenance` default, left standing on
 * purpose so the registration bug itself stays visible (see
 * `generation.ts`'s file header, "IS READ FROM source_db, NOT FROM
 * provenance"). A spec entry that sets `prov: 'ifl_copy'` on a `_SIM`
 * database is not a harness bug — it is the fixture reproducing a confirmed
 * live finding. `resolveGenerationScope`'s own `isSimulator` must still
 * detect it from `db`, and this harness exists partly to prove that.
 */
import type { ConnectionPool } from 'mssql';
import { EVENT_TABLES, type EventTable } from '../services/generation.js';

export interface Captured {
  sql: string;
  params: Map<string, unknown>;
}

/**
 * One physical generation of the four weighing tables, declared the way a
 * test should think about it: an epoch id, its ordinal, which database it
 * came from, what provenance it was (mis)registered under, and how many rows
 * of each canonical table fall inside the test's window.
 *
 * `rows` is keyed by canonical table name (`cone_event` / `sack_event` /
 * `reject_event`), matching `EventTable` — not by source table — because
 * `resolveGenerationScope` only ever asks about the canonical tables.
 */
export interface GenerationSpecEntry {
  epoch: number;
  ordinal: number;
  db: string;
  /** As IFL's tooling recorded it — may not match `db`. See file header. */
  prov: string;
  label?: string | null;
  rows: Partial<Record<EventTable, number>>;
}

const TABLE_LETTER: Record<EventTable, string> = {
  cone_event: 'c',
  sack_event: 's',
  reject_event: 'r',
};

/**
 * Every value bound onto a parameter whose name ends in `<letter><digits>`
 * for `table`'s letter (`epochFragment`'s own naming: `${prefix}${letter}
 * ${i}`, e.g. `gec0`, `wsc1`, or `rejects.ts`'s own `umc0`) — across every
 * `calls` entry given, not just the present-rows query. Proves an epoch
 * predicate was actually BOUND onto a downstream query, not merely that
 * `resolveGenerationScope` returned the right number.
 *
 * Deliberately more general than `generations.live.test.ts`'s own local
 * `boundEpochs`/`sortedEpochs` (`/^ge[csr]\d+$/`, hardcoding the `ge`
 * default prefix): that regex would silently miss `rejects.ts`'s own
 * `um`-prefixed secondary cone predicate (`epochWhere(..., { prefix: 'um'
 * })`, line ~217). This one matches on the letter immediately before the
 * trailing digits, independent of prefix, which is what `epochFragment`
 * actually guarantees — read `generations.live.test.ts` before extending
 * either one; do not invent a third regex beside these two.
 */
export function boundEpochsOf(calls: readonly Captured[], table: EventTable): number[] {
  const letter = TABLE_LETTER[table];
  const out: number[] = [];
  for (const call of calls) {
    for (const [name, value] of call.params) {
      const m = /([a-zA-Z])(\d+)$/.exec(name);
      const paramLetter = m?.[1];
      if (paramLetter && paramLetter.toLowerCase() === letter && typeof value === 'number') {
        out.push(value);
      }
    }
  }
  return out;
}

/**
 * Answers `resolveGenerationScope`'s two queries from `spec`. Returns
 * `undefined` for anything else, so both pool builders below can share this
 * one recognizer and differ only in what happens on a miss (default-empty
 * for `fakeGenerationPool`; positional fallback for `fakePositionalPool`).
 */
function answerScopeQuery(sql: string, spec: readonly GenerationSpecEntry[]): { recordset: unknown[] } | undefined {
  // resolveGenerationScope's present-rows query: a UNION ALL of per-table
  // counts, each part literally
  // `SELECT '<table>' AS tbl, source_epoch AS epoch_id, COUNT(*) AS n
  //  FROM sms.<table> WHERE ... GROUP BY source_epoch`.
  if (sql.includes('GROUP BY source_epoch')) {
    const recordset: { tbl: EventTable; epoch_id: number; n: number }[] = [];
    for (const g of spec) {
      for (const t of EVENT_TABLES) {
        const n = g.rows[t];
        if (n != null && sql.includes(`FROM sms.${t}`)) {
          recordset.push({ tbl: t, epoch_id: g.epoch, n });
        }
      }
    }
    return { recordset };
  }

  // resolveGenerationScope's second query: the line's sms.source_epoch rows.
  if (sql.includes('FROM sms.source_epoch')) {
    const recordset = spec.map((g) => ({
      epoch_id: g.epoch,
      source_db: g.db,
      generation_ordinal: g.ordinal,
      provenance: g.prov,
      label: g.label ?? null,
    }));
    return { recordset };
  }

  return undefined;
}

export interface FakeGenerationPool {
  pool: ConnectionPool;
  calls: Captured[];
  /** `boundEpochsOf(this.calls, table)` — see that function's doc. */
  boundEpochs(table: EventTable): number[];
}

/**
 * Build a fake `ConnectionPool` that answers `resolveGenerationScope`'s two
 * queries from `spec`, plus a generic `{recordset: []}` for anything else the
 * caller's OWN code issues afterward (the caller stubs those itself, same as
 * `spc.generations.test.ts`'s `fakePool`).
 */
export function fakeGenerationPool(spec: readonly GenerationSpecEntry[]): FakeGenerationPool {
  const calls: Captured[] = [];

  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => {
          params.set(name, value);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          return answerScopeQuery(sql, spec) ?? { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;

  return { pool, calls, boundEpochs: (table) => boundEpochsOf(calls, table) };
}

/**
 * WAVE 2 CONVERSION HELPER. `weightStations.basis.test.ts` and its five
 * siblings (`weightStations.test.ts`, `.phase9.`, `.target.`, `.periodTarget.`,
 * `.window.`) use a POSITIONAL `fakePool(...responses)` — response N for
 * query N, no SQL matching, documented in-file by an ordered comment (e.g.
 * "rejectRatesByStation's per-station query, its totals query, ..."). Once
 * Wave 2 adds `resolveGenerationScope` to `weightStations.ts`, that call
 * issues its OWN two queries before the ones the comment enumerates — every
 * existing index shifts by one (or two: the present-rows query answers
 * standalone even when the SECOND, `sms.source_epoch`, query is also new),
 * and the file fails on query COUNT AND ORDER, not on a value, pointing
 * whoever is debugging it at the wrong line.
 *
 * This wraps a positional pool so the two scope queries are answered
 * TRANSPARENTLY — matched by the same `answerScopeQuery` this module's own
 * `fakeGenerationPool` uses — and consume no slot in `responses`. A Wave 2
 * file converts by changing
 *   `fakePool([], [{ cones: 300, rejects: 0 }], [], [...])`
 * to
 *   `fakePositionalPool(ONE_REAL_GENERATION, [], [{ cones: 300, rejects: 0 }], [], [...])`
 * — the response ARRAY is untouched; only the call site gains the spec
 * argument. `calls` (and therefore `boundEpochs`) EXCLUDES the two scope
 * queries for the same reason: `reports/reports.test.ts`'s product report
 * test asserts `toHaveLength(2)` on statements matching `FROM sms.cone_event`
 * — the scope probe's present-rows query also contains that substring (it is
 * a UNION part `FROM sms.cone_event WHERE ... GROUP BY source_epoch`), so a
 * `calls` list that counted it would silently turn a real "2" assertion into
 * a false failure at "3". Filtering it out of `calls` here is what keeps
 * that assertion, and every other length-based one in the converted files,
 * true without being rewritten.
 *
 * CHOICE MADE OVER THE ALTERNATIVE (a SQL-matching pool in the
 * `spc.generations.test.ts` idiom): six files, ~30 positional response
 * arrays between them, built and reasoned about as "the Nth query" in their
 * own comments. Rewriting each into SQL-matched responses is a real rewrite
 * of working fixture data, is exactly the kind of change six workers would
 * hand-roll slightly differently, and is what produced today's two git-index
 * collisions. Absorbing the scope queries costs each file ONE argument.
 */
export function fakePositionalPool(
  spec: readonly GenerationSpecEntry[],
  responses: readonly unknown[][],
): { pool: ConnectionPool; calls: Captured[]; boundEpochs(table: EventTable): number[] } {
  const calls: Captured[] = [];
  let i = 0;

  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => {
          params.set(name, value);
          return req;
        },
        query: async (sql: string) => {
          const scoped = answerScopeQuery(sql, spec);
          if (scoped) return scoped; // absorbed — no slot consumed, not recorded
          calls.push({ sql, params });
          return { recordset: responses[i++] ?? [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;

  return { pool, calls, boundEpochs: (table) => boundEpochsOf(calls, table) };
}

/**
 * The ordinary shape at IFL and the default a converted positional file
 * should reach for first: one real generation, enough rows on every table
 * that no plausible WHERE-clause substring match in `answerScopeQuery`
 * starves it. Mirrors the dev sidecar's own September generation
 * (`generations.live.test.ts`'s `EPOCHS`/`PRESENT_DEV`).
 */
export const ONE_REAL_GENERATION: readonly GenerationSpecEntry[] = [
  {
    epoch: 9,
    ordinal: 3,
    db: 'DATA_TP1U2_SEP07',
    prov: 'ifl_copy',
    label: 'September copy',
    rows: { cone_event: 132_552, sack_event: 5_435, reject_event: 1_300 },
  },
];

/**
 * The pooling-defect shape: IFL's real September generation beside the
 * plant simulator's — mislabelled `provenance: 'ifl_copy'` exactly as epoch
 * 13 is on the live dev sidecar (see this file's header). A test built on
 * this spec, unlike one built on `ONE_REAL_GENERATION`, FAILS when the SUT
 * pools instead of scoping — there are two generations in it to pool.
 */
export const TWO_GENERATIONS_WITH_MISLABELLED_SIMULATOR: readonly GenerationSpecEntry[] = [
  {
    epoch: 9,
    ordinal: 3,
    db: 'DATA_TP1U2_SEP07',
    prov: 'ifl_copy',
    label: 'September copy',
    rows: { cone_event: 55_058, sack_event: 5_435, reject_event: 1_300 },
  },
  {
    epoch: 13,
    ordinal: 4,
    db: 'DATA_TP1U2_SIM',
    prov: 'ifl_copy', // mislabelled — see file header; source_db is what betrays it
    label: 'pack1_TP1U2 gen 4',
    rows: { cone_event: 135_226, sack_event: 6_199, reject_event: 1_100 },
  },
];
