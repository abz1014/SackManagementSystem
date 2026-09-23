/**
 * `sms summary` — the figure someone reaches for before quoting a number to
 * IFL, and until 23 Sep 2026 the one command with NO epoch predicate at all.
 *
 * `sms.cone_event` / `sack_event` / `reject_event` hold every source
 * generation at once. Where two generations cover the same production day this
 * command summed them and printed one number with nothing on screen to say so.
 * IFL dropped and recreated their four weighing tables on 2026-08-05, ids
 * restarting at 1, so a date either side of that rebuild — once the missing
 * 10 Jul – 5 Aug data arrives, or on any re-ingest of a sample already loaded —
 * has exactly this shape with entirely real plant data.
 *
 * Measured on the development sidecar, read-only, 23 Sep 2026: shift_date
 * 1969-12-31 (the clock-fault rows, present in BOTH of IFL's copies) carried
 * 2 pooled cones and 3 pooled rejects, which are really 1 cone + 2 rejects of
 * generation 1 (DATA_TP1U2) and 1 cone + 1 reject of generation 3
 * (DATA_TP1U2_SEP07). Those are the numbers used below.
 *
 * `rebuild` (fb44b11) REFUSES a scope-less run because it deletes. This one
 * reports instead, because it is read-only and a command that refuses is a
 * command an operator routes around with ad-hoc SQL that has no epoch
 * predicate either. It must never pool silently; that is what these assert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

interface EpochRow {
  epoch_id: number;
  source_db: string;
  source_server: string;
  provenance: string;
  generation_ordinal: number;
}

const SRV = 'localhost\\SQLEXPRESS';
const EPOCHS: EpochRow[] = [
  { epoch_id: 1, source_db: 'DATA_TP1U2', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 1 },
  { epoch_id: 2, source_db: 'DATA_TP1U2', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 1 },
  { epoch_id: 3, source_db: 'DATA_TP1U2', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 1 },
  { epoch_id: 4, source_db: 'DATA_TP1U2', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 1 },
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 3 },
  { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 3 },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 3 },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', source_server: SRV, provenance: 'ifl_copy', generation_ordinal: 3 },
];

const world = {
  app: undefined as unknown as ReturnType<typeof fakePool>,
  maxDate: '2026-09-07' as string | null,
  basis: 'gross',
  tare: 0,
  epochs: EPOCHS,
  /** per-epoch counts the fake returns for cone / reject / sack. */
  cone: [] as { e: number; n: number }[],
  reject: [] as { e: number; n: number }[],
  sack: [] as { e: number; n: number; kg: number; inr: number }[],
};

/** ids bound as @e0.. on a statement, in order. */
const boundEpochs = (s: Stmt): number[] => {
  const out: number[] = [];
  for (let i = 0; s.inputs.has(`e${i}`); i++) out.push(s.inputs.get(`e${i}`) as number);
  return out;
};

function fakePool() {
  const statements: Stmt[] = [];
  const pool = {
    statements,
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          const stmt: Stmt = { sql, inputs: new Map(inputs) };
          statements.push(stmt);
          const scoped = boundEpochs(stmt);
          const not = /NOT IN/.test(sql);
          const keep = <T extends { e: number }>(rows: T[]): T[] =>
            scoped.length === 0
              ? rows
              : rows.filter((r) => (not ? !scoped.includes(r.e) : scoped.includes(r.e)));

          if (/MAX\(shift_date\)/.test(sql)) return { recordset: [{ d: world.maxDate }], rowsAffected: [1] };
          if (/FROM sms\.weight_rule/.test(sql)) {
            return { recordset: [{ basis: world.basis, sack_tare_kg: world.tare }], rowsAffected: [1] };
          }
          if (/FROM sms\.source_epoch/.test(sql)) return { recordset: world.epochs, rowsAffected: [1] };
          if (/FROM sms\.cone_event/.test(sql)) return { recordset: keep(world.cone), rowsAffected: [1] };
          if (/FROM sms\.reject_event/.test(sql)) return { recordset: keep(world.reject), rowsAffected: [1] };
          if (/FROM sms\.sack_event/.test(sql)) return { recordset: keep(world.sack), rowsAffected: [1] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

vi.mock('@sms/sync-worker', () => ({
  // Pulled in only because summary re-uses parseEpochList (rebuild.ts) and
  // idInClause (epoch.ts); none of it is called by this command.
  loadSourceStreams: async () => ({}),
  loadSourceTables: async () => [],
  readSourceIdentity: async () => ({}),
  openEpoch: async () => null,
  runTransform: async () => [],
  resetTransformWatermarks: async () => undefined,
  withTransformLock: (_c: unknown, fn: () => Promise<unknown>) => fn(),
  TABLE_SHAPES: {},
}));
vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {} },
    openContext: async () => ({
      cfg: { lineId: 1, app: { server: SRV, database: 'sms' } },
      app: world.app,
      ifl: world.app,
      close: async () => {},
    }),
  };
});

const { summary, summaryLines, foldGenerations, generationLabel } = await import('./summary.js');

let logged: string[] = [];
let errored: string[] = [];

beforeEach(() => {
  world.app = fakePool();
  world.maxDate = '2026-09-07';
  world.basis = 'gross';
  world.tare = 0;
  world.epochs = EPOCHS;
  world.cone = [];
  world.reject = [];
  world.sack = [];
  logged = [];
  errored = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logged.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errored.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const out = (): string => logged.join('\n');

/* ------------------------------------------------------------ pure parts */

const gen = (o: Partial<Parameters<typeof generationLabel>[0]> = {}): Parameters<typeof generationLabel>[0] => ({
  key: 'k',
  ordinal: 1,
  sourceDb: 'DATA_TP1U2',
  provenance: 'ifl_copy',
  epochIds: [1],
  cones: 0,
  rejects: 0,
  sacks: 0,
  sackKg: 0,
  sacksInRange: 0,
  ...o,
});

describe('foldGenerations', () => {
  const meta = new Map(
    EPOCHS.map((e) => [
      e.epoch_id,
      { ordinal: e.generation_ordinal, sourceDb: e.source_db, sourceServer: e.source_server, provenance: e.provenance },
    ]),
  );

  it('folds the four source tables of ONE physical generation into one block', () => {
    const g = foldGenerations(
      meta,
      new Map([[1, 8134]]),
      new Map([[3, 300], [4, 3]]),
      new Map([[2, { n: 292, kg: 13775.8, inRange: 292 }]]),
      'gross',
      0,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.epochIds).toEqual([1, 2, 3, 4]);
    expect(g[0]!.cones).toBe(8134);
    expect(g[0]!.rejects).toBe(303);
    expect(g[0]!.sacks).toBe(292);
  });

  it('keeps two generations apart and never produces a combined row', () => {
    const g = foldGenerations(
      meta,
      new Map([[1, 1], [9, 1]]),
      new Map([[3, 1], [4, 1], [11, 1]]),
      new Map(),
      'gross',
      0,
    );
    expect(g.map((x) => x.ordinal)).toEqual([1, 3]);
    expect(g[0]!.cones).toBe(1);
    expect(g[1]!.cones).toBe(1);
    expect(g.some((x) => x.cones === 2)).toBe(false);
  });

  it('applies the net-basis tare per generation, not once across the pool', () => {
    const g = foldGenerations(
      meta,
      new Map(),
      new Map(),
      new Map([
        [2, { n: 10, kg: 500, inRange: 10 }],
        [10, { n: 4, kg: 200, inRange: 4 }],
      ]),
      'net',
      1.5,
    );
    expect(g[0]!.sackKg).toBe(500 - 15);
    expect(g[1]!.sackKg).toBe(200 - 6);
  });

  it('gives an epoch with no source_epoch row its own named block rather than merging it', () => {
    const g = foldGenerations(meta, new Map([[99, 7]]), new Map(), new Map(), 'gross', 0);
    expect(g).toHaveLength(1);
    expect(g[0]!.provenance).toBe('unknown');
    expect(generationLabel(g[0]!)).toContain('unregistered epoch');
  });
});

describe('summaryLines', () => {
  it('one generation prints the familiar block AND names the generation', () => {
    const lines = summaryLines(1, '2026-08-10', null, 'gross', [gen({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', epochIds: [9, 10, 11, 12], cones: 5635, rejects: 94, sacks: 235, sackKg: 11098.6, sacksInRange: 227 })], [], false);
    const t = lines.join('\n');
    expect(t).toContain('Total cones produced         5635');
    expect(t).toContain('source generation      gen 3 · DATA_TP1U2_SEP07 (ifl_copy) · epochs 9, 10, 11, 12');
    expect(t).not.toContain('SOURCE GENERATIONS COVER THIS DATE');
  });

  it('two generations print two blocks, a banner, and NO pooled total', () => {
    const lines = summaryLines(
      1,
      '2026-08-05',
      null,
      'gross',
      [
        gen({ ordinal: 1, epochIds: [1, 3], cones: 4102, rejects: 61 }),
        gen({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', epochIds: [9, 11], cones: 5635, rejects: 94 }),
      ],
      [],
      false,
    );
    const t = lines.join('\n');
    expect(t).toContain('2 SOURCE GENERATIONS COVER THIS DATE');
    expect(t).toContain('4102');
    expect(t).toContain('5635');
    // The pooled figure the old command would have printed.
    expect(t).not.toContain('9737');
    expect(t).not.toContain('155');
    expect(t).toContain('--epoch=1,3');
  });

  it('names what --epoch left out instead of dropping it silently', () => {
    const lines = summaryLines(1, '1969-12-31', null, 'gross',
      [gen({ ordinal: 1, epochIds: [1, 3, 4], cones: 1, rejects: 2 })],
      [gen({ ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', epochIds: [9, 11], cones: 1, rejects: 1 })],
      true);
    const t = lines.join('\n');
    expect(t).toContain('EXCLUDED by --epoch');
    expect(t).toContain('gen 3 · DATA_TP1U2_SEP07 (ifl_copy) · epochs 9, 11 — 1 cone(s), 1 reject(s), 0 sack(s)');
  });

  it('an empty in-scope set says so differently when a scope was named', () => {
    expect(summaryLines(1, '2026-01-01', null, 'gross', [], [], true).join('\n')).toContain('named by --epoch');
    expect(summaryLines(1, '2026-01-01', null, 'gross', [], [], false).join('\n')).toContain('No rows on this date.');
  });
});

/* ------------------------------------------------------- the command */

describe('sms summary', () => {
  it('a window spanning IFL\'s 2026-08-05 rebuild reports per generation, never one sum', async () => {
    // Both generations on one production day: what IFL's own rebuild produces
    // the moment the missing 10 Jul - 5 Aug data is loaded beside the
    // September copy. No simulator involved.
    world.cone = [{ e: 1, n: 4102 }, { e: 9, n: 5635 }];
    world.reject = [{ e: 3, n: 61 }, { e: 11, n: 94 }];
    world.sack = [
      { e: 2, n: 180, kg: 8500.5, inr: 180 },
      { e: 10, n: 235, kg: 11098.6, inr: 227 },
    ];
    expect(await summary(['--date=2026-08-05'])).toBe(0);
    const t = out();
    expect(t).toContain('2 SOURCE GENERATIONS COVER THIS DATE');
    expect(t).toContain('4102');
    expect(t).toContain('5635');
    expect(t).not.toContain('9737'); // 4102 + 5635, the old pooled cone count
    expect(t).not.toContain('155'); // 61 + 94, the old pooled reject count
    expect(t).not.toContain('415'); // 180 + 235, the old pooled sack count
    expect(t).not.toContain('19599.1'); // the old pooled sack weight
  });

  it('a clean single-generation date is unchanged apart from naming its generation', async () => {
    // Measured on the sidecar, 2026-07-01: epoch 1 only.
    world.cone = [{ e: 1, n: 8134 }];
    world.reject = [{ e: 3, n: 300 }, { e: 4, n: 3 }];
    world.sack = [{ e: 2, n: 292, kg: 13775.8, inr: 292 }];
    expect(await summary(['--date=2026-07-01'])).toBe(0);
    const t = out();
    expect(t).toContain('Total cones produced         8134');
    expect(t).toContain('Total rejected cones          303');
    expect(t).toContain('Total sacks produced          292');
    expect(t).toContain('Total sack weight (kg)    13775.8   [basis: gross]');
    expect(t).toContain('Sacks in-range             100.0%');
    expect(t).toContain('gen 1 · DATA_TP1U2 (ifl_copy)');
    expect(t).not.toContain('SOURCE GENERATIONS COVER THIS DATE');
  });

  it('every canonical count is grouped by source_epoch — the regression guard', async () => {
    world.cone = [{ e: 1, n: 1 }];
    await summary(['--date=1969-12-31']);
    const canon = world.app.statements.filter((s) => /FROM sms\.(cone|reject|sack)_event/.test(s.sql));
    expect(canon.length).toBeGreaterThan(0);
    for (const s of canon) expect(s.sql).toMatch(/GROUP BY source_epoch/);
  });

  it('--epoch binds each id as a parameter and reports what it excluded', async () => {
    world.cone = [{ e: 1, n: 1 }, { e: 9, n: 1 }];
    world.reject = [{ e: 3, n: 1 }, { e: 4, n: 1 }, { e: 11, n: 1 }];
    expect(await summary(['--date=1969-12-31', '--epoch=1,3,4'])).toBe(0);
    const t = out();
    expect(t).toContain('Total cones produced            1');
    expect(t).toContain('Total rejected cones            2');
    expect(t).toContain('EXCLUDED by --epoch');
    expect(t).toContain('gen 3 · DATA_TP1U2_SEP07');
    const scoped = world.app.statements.filter((s) => /source_epoch (NOT )?IN \(@e0/.test(s.sql));
    expect(scoped.length).toBeGreaterThan(0);
    for (const s of scoped) {
      expect(boundEpochs(s)).toEqual([1, 3, 4]);
      expect(s.sql).not.toMatch(/IN \(1,\s*3,\s*4\)/);
    }
  });

  it('--epoch with nothing usable in it is refused, not silently ignored', async () => {
    expect(await summary(['--date=2026-07-01', '--epoch=abc'])).toBe(2);
    expect(errored.join('\n')).toContain('names no valid epoch id');
    expect(world.app.statements).toHaveLength(0);
  });

  it('the default date is resolved WITHIN the named scope, not across all generations', async () => {
    world.cone = [{ e: 9, n: 5 }];
    await summary(['--epoch=9']);
    const probe = world.app.statements.find((s) => /MAX\(shift_date\)/.test(s.sql));
    expect(probe).toBeDefined();
    expect(probe!.sql).toMatch(/source_epoch IN \(@e0\)/);
    expect(boundEpochs(probe!)).toEqual([9]);
  });

  it('line_id is bound, never interpolated (working rule 3)', async () => {
    world.cone = [{ e: 1, n: 1 }];
    await summary(['--date=1969-12-31']);
    expect(world.app.statements.length).toBeGreaterThan(0);
    for (const s of world.app.statements) {
      expect(s.sql).not.toMatch(/line_id\s*=\s*\d/);
      if (/line_id/.test(s.sql)) expect(s.inputs.get('line')).toBe(1);
    }
  });
});
