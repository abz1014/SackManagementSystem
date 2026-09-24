/**
 * changeover.ts's own pure logic (planChangeover's resolution/blocker/warning
 * rules, and executeChangeover's disabled early-return) — it had no test file
 * of any kind before this one, despite being the module behind IFL's 15 Sep
 * 2026 single most important requirement. Everything here is exercised
 * offline: a fake sidecar pool answers the mirror reads planChangeover makes,
 * and the writer handed in is disabled and throws if any of its write
 * methods are ever called — proving the dry run and the disabled refusal
 * never reach a real PDAS connection.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  planChangeover, executeChangeover, NO_ROLLBACK, OPERATOR_SELECTS_ON_MACHINE,
  type ChangeoverRequest, type ChangeoverDeps,
} from './changeover.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

class FakeRequest {
  private inputs = new Map<string, unknown>();
  constructor(private readonly db: FakeDb) {}
  input(name: string, _type: unknown, value: unknown): this {
    this.inputs.set(name, value);
    return this;
  }
  async query<T = Record<string, unknown>>(sql: string): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    return this.db.handle<T>(sql, this.inputs);
  }
}

/** The sidecar mirror readMirror() reads, and the sink recordDisabledAttempt() writes to. */
class FakeDb {
  statements: Stmt[] = [];
  request(): FakeRequest {
    return new FakeRequest(this);
  }

  async handle<T>(sql: string, inputs: Map<string, unknown>): Promise<{ recordset: T[]; rowsAffected: number[] }> {
    this.statements.push({ sql, inputs: new Map(inputs) });
    const rows = (r: Record<string, unknown>[]) => ({ recordset: r as T[], rowsAffected: [r.length] });

    if (sql.includes('FROM sms.blend')) return rows([{ id: 1, name: 'PolyBlend' }]);
    if (sql.includes('FROM sms.yarn_count')) return rows([{ id: 2, name: '30s' }]);
    if (sql.includes('FROM sms.tube_type')) return rows([{ id: 3, name: 'PP Tube', w: 12 }]);
    if (sql.includes('FROM sms.product')) {
      return rows([
        { product_id: 100, blend_id: 1, count_id: 2, tube_type_id: 3, active_flag: true, description: '205-IL0-SD', lot_code: null },
        { product_id: 101, blend_id: 5, count_id: 6, tube_type_id: 7, active_flag: false, description: 'Old Retired Lot', lot_code: null },
      ]);
    }
    if (sql.includes('FROM sms.pallet pl')) {
      return rows([
        { pallet_id: 50, product_id: 100, description: '205-IL0-SD', lot_code: null, pack_schema_id: 1, ps_desc: 'Sack 3x4', lot: 'LOT1', active_flag: true, desc1: 'Blue', label_type: 1, steam_prog: 0, routing: 0, pdas_created_at: new Date('2026-09-10T00:00:00Z') },
        { pallet_id: 51, product_id: 101, description: 'Old Retired Lot', lot_code: null, pack_schema_id: 1, ps_desc: 'Sack 3x4', lot: 'LOT-OLD', active_flag: false, desc1: null, label_type: 1, steam_prog: 0, routing: 0, pdas_created_at: new Date('2026-08-01T00:00:00Z') },
      ]);
    }
    if (sql.includes('INSERT INTO sms.product_change')) return rows([]);
    return rows([]);
  }
}

const ACTOR = { userId: 9, username: 'engineer' };
const BOUNDS = { setpointLoG: 1500, setpointHiG: 2100 };

/** A writer that is off, and blows up if any write method is ever reached — the assertion that a dry run and a disabled refusal never touch PDAS. */
function disabledWriter(reason = 'PDAS_WRITE_ENABLED is not true.'): ChangeoverDeps['writer'] {
  const notCalled = (): never => {
    throw new Error('must not be called while the writer is disabled');
  };
  return {
    enabled: false,
    disabledReason: reason,
    addBlend: notCalled,
    addCount: notCalled,
    addTubeType: notCalled,
    createProduct: notCalled,
    createPallet: notCalled,
    setProductActive: notCalled,
    setPalletActive: notCalled,
  } as unknown as ChangeoverDeps['writer'];
}

function baseRequest(overrides: Partial<ChangeoverRequest> = {}): ChangeoverRequest {
  return {
    blend: { id: 1 },
    count: { id: 2 },
    tubeType: { id: 3 },
    material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: '205-IL0-SD-NEW', ppColour: 'Blue' },
    pallet: { packSchemaId: 1, lot: null, sackColour: 'Blue' },
    retire: { productIds: [], palletIds: [] },
    reason: 'Process engineer changeover, ticket 77',
    ...overrides,
  };
}

describe('planChangeover', () => {
  let db: FakeDb;
  let deps: ChangeoverDeps;
  beforeEach(() => {
    db = new FakeDb();
    deps = { pool: db as unknown as ConnectionPool, writer: disabledWriter(), bounds: BOUNDS };
  });

  it('reuses a blend/count/tube type given by id', async () => {
    const plan = await planChangeover(deps, baseRequest());
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('reuse');
    expect(blend.id).toBe(1);
    expect(blend.label).toBe('PolyBlend');
  });

  it('blocks a reference number the mirror does not know', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { id: 999 } }));
    expect(plan.blockers).toContain('No blend with number 999 is known to the mirror.');
  });

  it('matches a new name against an existing one case-insensitively, with a warning, instead of adding it', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'polyblend' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('reuse');
    expect(blend.id).toBe(1);
    expect(plan.warnings.some((w) => w.includes('already exists as blend 1'))).toBe(true);
  });

  it('plans to add a genuinely new blend', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'Cotton Mix' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('add');
    expect(blend.proc).toBe('AddBlend');
    expect(blend.id).toBeNull();
  });

  // Defect B4: AddBlend/AddCount/AddTubeType guard their INSERT with
  // `IF NOT EXISTS (... WHERE <col> LIKE @newName [AND TubeForm = @form])`
  // (verified against the proc bodies on PDAS_TP1U2_SEP07, 24 Sep 2026,
  // likePattern.ts's own header). A name that is not textually equal to an
  // existing one can still be refused by PDAS if it matches as a WILDCARD
  // PATTERN (`_` any one char, `%` any run, `[...]` a class). The mirror
  // only has one blend, "PolyBlend" (id 1).
  it('B4: blocks a new blend name that would collide with an existing one as a LIKE pattern ("_" wildcard), rather than planning to add it', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'PolyBl_nd' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).not.toBe('reuse'); // must not silently reuse a different row
    expect(plan.blockers.some((b) => b.includes('PolyBl_nd') && b.includes('blend 1') && b.includes('PolyBlend'))).toBe(true);
  });

  it('B4: blocks a new blend name that would collide via "%"', () => {
    return planChangeover(deps, baseRequest({ blend: { name: 'Poly%' } })).then((plan) => {
      expect(plan.blockers.some((b) => b.includes('Poly%'))).toBe(true);
    });
  });

  it('B4: an exact match (case-insensitive) still reuses, unaffected by the LIKE check', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'polyblend' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('reuse');
    expect(blend.id).toBe(1);
  });

  it('B4: an exact match with trailing whitespace still reuses (the request name is trimmed before any check)', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'PolyBlend   ' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('reuse');
    expect(blend.id).toBe(1);
  });

  it('B4: a name with no relation to any existing row is still planned to add', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'Cotton Mix' } }));
    const blend = plan.steps.find((s) => s.step === 'blend')!;
    expect(blend.action).toBe('add');
    expect(plan.blockers).toHaveLength(0);
  });

  it('B4: applies the same LIKE-collision block to a new count name', async () => {
    // mirror has one count, "30s" (id 2)
    const plan = await planChangeover(deps, baseRequest({ count: { name: '3_s' } }));
    expect(plan.blockers.some((b) => b.includes('3_s') && b.includes('count 2') && b.includes('30s'))).toBe(true);
  });

  it('B4: applies the same LIKE-collision block to a new tube type name', async () => {
    // mirror has one tube type, "PP Tube" (id 3)
    const plan = await planChangeover(deps, baseRequest({ tubeType: { name: 'PP T_be', tubeWeightG: 12 } }));
    expect(plan.blockers.some((b) => b.includes('PP T_be') && b.includes('tube type 3') && b.includes('PP Tube'))).toBe(true);
  });

  it('blocks a (blend, count, tube) triple that already exists as a product, active or not', async () => {
    const plan = await planChangeover(deps, baseRequest());
    expect(plan.blockers.some((b) => b.includes('already exists as product 100'))).toBe(true);
  });

  it('blocks a reason shorter than 10 characters', async () => {
    const plan = await planChangeover(deps, baseRequest({ reason: 'short' }));
    expect(plan.blockers.some((b) => b.includes('reason of at least 10 characters'))).toBe(true);
  });

  it('blocks a setpoint outside the plausible cone range', async () => {
    const plan = await planChangeover(
      deps,
      baseRequest({ blend: { name: 'Cotton Mix' }, material: { setpointG: 5000, offsetMinusG: 30, offsetPlusG: 30, lot: 'X', ppColour: null } }),
    );
    expect(plan.blockers.some((b) => b.includes('outside the plausible cone range'))).toBe(true);
  });

  it('blocks retiring a product the mirror does not know, and warns (not blocks) on one already retired', async () => {
    const req = baseRequest({ blend: { name: 'Cotton Mix' }, retire: { productIds: [101, 999], palletIds: [] } });
    const plan = await planChangeover(deps, req);
    expect(plan.blockers).toContain('No product 999 is known to the mirror, so it cannot be retired.');
    expect(plan.warnings.some((w) => w.includes('Product 101 (Old Retired Lot) is already retired'))).toBe(true);
  });

  it('blocks retiring a pallet the mirror does not know, and warns (not blocks) on one already retired', async () => {
    const req = baseRequest({ blend: { name: 'Cotton Mix' }, retire: { productIds: [], palletIds: [51, 999] } });
    const plan = await planChangeover(deps, req);
    expect(plan.blockers).toContain('No pallet 999 is known to the mirror, so it cannot be retired.');
    expect(plan.warnings.some((w) => w.includes('Pallet 51') && w.includes('already retired'))).toBe(true);
  });

  it('carries the honesty contract on every plan: reachesMachine is false, with the operator sentence verbatim', async () => {
    const plan = await planChangeover(deps, baseRequest({ blend: { name: 'Cotton Mix' } }));
    expect(plan.reachesMachine).toBe(false);
    expect(plan.operatorNote).toBe(OPERATOR_SELECTS_ON_MACHINE);
    expect(plan.operatorNote).toBe(
      'This makes the product available in PDAS and records what was intended. The operator still selects it on the QCS panel at the machine.',
    );
    expect(plan.noRollback).toBe(NO_ROLLBACK);
  });

  it('never touches the writer at all — planChangeover reads the mirror only', async () => {
    // disabledWriter()'s methods throw if reached; enabled/disabledReason are
    // the only properties planChangeover ever reads off deps.writer.
    await expect(planChangeover(deps, baseRequest())).resolves.toBeDefined();
  });
});

describe('executeChangeover — the writer disabled (the normal, current state)', () => {
  it('returns the refusal without touching any write method, and records exactly one sms.product_change row at outcome=disabled', async () => {
    const db = new FakeDb();
    const deps: ChangeoverDeps = { pool: db as unknown as ConnectionPool, writer: disabledWriter(), bounds: BOUNDS };
    const req = baseRequest({ blend: { name: 'Cotton Mix' } });

    const result = await executeChangeover(deps, req, ACTOR);

    expect('refused' in result).toBe(true);
    if (!('refused' in result)) throw new Error('expected a refusal');
    expect(result.refused).toBe('PDAS_WRITE_ENABLED is not true.');

    const inserts = db.statements.filter((s) => s.sql.includes('INSERT INTO sms.product_change'));
    expect(inserts).toHaveLength(1);
    const ins = inserts[0]!;
    expect(ins.inputs.get('outcome')).toBe('disabled');
    expect(ins.inputs.get('op')).toBe('create');
    expect(ins.inputs.get('by')).toBe(ACTOR.userId);
    expect(ins.inputs.get('reason')).toBe(req.reason);
    expect(ins.inputs.get('msg')).toBe('PDAS_WRITE_ENABLED is not true.');
    expect(JSON.parse(ins.inputs.get('after') as string)).toEqual(req);
  });

  it('surfaces the writer\'s own disabledReason verbatim, whatever it says', async () => {
    const db = new FakeDb();
    const custom = 'Awaiting IFL\'s written authorisation (SEPT-2026-EPOCH-DECISION §6.2).';
    const deps: ChangeoverDeps = { pool: db as unknown as ConnectionPool, writer: disabledWriter(custom), bounds: BOUNDS };
    const result = await executeChangeover(deps, baseRequest({ blend: { name: 'Cotton Mix' } }), ACTOR);
    expect('refused' in result && result.refused).toBe(custom);
  });
});
