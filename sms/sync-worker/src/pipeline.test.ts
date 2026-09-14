/**
 * runFullSync's failure isolation (Wave A, Sep 2026 roadmap gap analysis).
 *
 * Until 14 Sep 2026 the product mirror and the readings were coupled: a PDAS
 * read failure threw out of runFullSync before the reader ran, so a login
 * without table read on PDAS — or PDAS being down — stopped every cone, sack
 * and reject from being ingested. And a halt in the reference seed, or a
 * transform failure, wrote nothing anywhere: four 'success' rows quietly aged.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('./reader/iflTables.js', () => ({
  IFL_TABLES: [
    { key: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', columns: [] },
    { key: 'sack', sourceTable: 'sack1_TP1U2', rawTable: 'sms_raw.sack_raw', columns: [] },
  ],
}));

const seedReference = vi.fn(async (): Promise<void> => undefined);
vi.mock('./seed/seedReference.js', () => ({ seedReference: () => seedReference() }));

const seedProducts = vi.fn(async (): Promise<void> => undefined);
vi.mock('./seed/seedProducts.js', () => ({ seedProducts: () => seedProducts() }));

const runOnce = vi.fn(async () => [{ table: 'sms_raw.cone_raw', read: 3, written: 3, watermarkFrom: 0 }]);
vi.mock('./runner.js', () => ({ runOnce: () => runOnce() }));

const runTransform = vi.fn(async () => [{ table: 'cone_event', read: 3, written: 3, findings: [] }]);
vi.mock('./transform/runTransform.js', () => ({ runTransform: () => runTransform() }));

vi.mock('./lock.js', () => ({ withTransformLock: (_c: unknown, fn: () => Promise<unknown>) => fn() }));

interface Halt { runId: string; targetTable: string; error: string }
const recordHaltedRun = vi.fn(async (_p: unknown, _h: Halt): Promise<void> => undefined);
vi.mock('./store.js', () => ({ recordHaltedRun: (p: unknown, h: Halt) => recordHaltedRun(p, h) }));

interface Finding { check_name: string; severity: string; subject_table: string | null; detail: string }
const persistFindings = vi.fn(async (_p: unknown, _r: string, _f: Finding[]): Promise<void> => undefined);
const clearFindings = vi.fn(async (_p: unknown, _c: string): Promise<void> => undefined);
vi.mock('./transform/dq.js', () => ({
  persistFindings: (p: unknown, r: string, f: Finding[]) => persistFindings(p, r, f),
  clearFindings: (p: unknown, c: string) => clearFindings(p, c),
}));

const { runFullSync, PRODUCT_MIRROR_FAILED, TRANSFORM_FAILED } = await import('./pipeline.js');

const pool = {} as ConnectionPool;
const cfg = { lineId: 1, overlapRows: 500, pdasDbName: 'PDAS_TP1U2', app: {} } as never;

beforeEach(() => {
  for (const m of [seedReference, seedProducts, runOnce, runTransform, recordHaltedRun, persistFindings, clearFindings]) m.mockClear();
  seedReference.mockResolvedValue(undefined);
  seedProducts.mockResolvedValue(undefined);
});

describe('runFullSync — the product mirror is isolated from ingestion', () => {
  it('a PDAS failure records a finding and the readings are STILL ingested and transformed', async () => {
    seedProducts.mockRejectedValueOnce(new Error("The SELECT permission was denied on the object 'Materials'"));
    const r = await runFullSync(pool, pool, cfg);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(runTransform).toHaveBeenCalledTimes(1);
    expect(r.productMirrorError).toMatch(/SELECT permission was denied/);
    const f = persistFindings.mock.calls.find((c) => c[2][0]!.check_name === PRODUCT_MIRROR_FAILED)!;
    expect(f[2][0]!.severity).toBe('ERROR');
    expect(f[2][0]!.subject_table).toBe('product');
    expect(f[2][0]!.detail).toMatch(/readings are still being ingested/);
    expect(f[2][0]!.detail).toMatch(/SELECT permission was denied/);
    // A mirror failure is a table-level fault, not a pass halt: no sync_run rows.
    expect(recordHaltedRun).not.toHaveBeenCalled();
  });

  it('a successful mirror clears the standing finding, so it disappears when PDAS is back', async () => {
    const r = await runFullSync(pool, pool, cfg);
    expect(r.productMirrorError).toBeNull();
    expect(clearFindings).toHaveBeenCalledWith(pool, PRODUCT_MIRROR_FAILED);
    expect(persistFindings.mock.calls.some((c) => c[2][0]!.check_name === PRODUCT_MIRROR_FAILED)).toBe(false);
  });

  it('the finding detail is bounded to the column width', async () => {
    seedProducts.mockRejectedValueOnce(new Error('x'.repeat(2_000)));
    await runFullSync(pool, pool, cfg);
    const f = persistFindings.mock.calls.find((c) => c[2][0]!.check_name === PRODUCT_MIRROR_FAILED)!;
    expect(f[2][0]!.detail.length).toBeLessThanOrEqual(500);
  });
});

describe('runFullSync — halts before the reader leave a row per table', () => {
  it('a reference-seed failure writes one halted row per source table, same pass, and rethrows', async () => {
    seedReference.mockRejectedValueOnce(new Error('Invalid object name sms.shift_rule'));
    await expect(runFullSync(pool, pool, cfg)).rejects.toThrow(/shift_rule/);
    const h = recordHaltedRun.mock.calls.map((c) => c[1]);
    expect(h.map((x) => x.targetTable)).toEqual(['cone_raw', 'sack_raw']);
    expect(new Set(h.map((x) => x.runId)).size).toBe(1);
    expect(h[0]!.error).toMatch(/^Pass halted at reference seed, before any table was read\. Invalid object name/);
    expect(runOnce).not.toHaveBeenCalled();
  });
});

describe('runFullSync — a transform failure is a standing CRITICAL finding, not a sync_run halt', () => {
  it('records the finding, does not touch sync_run, and rethrows', async () => {
    runTransform.mockRejectedValueOnce(new Error('Could not acquire the transform/rebuild lock within 60000ms'));
    await expect(runFullSync(pool, pool, cfg)).rejects.toThrow(/rebuild lock/);
    const f = persistFindings.mock.calls.find((c) => c[2][0]!.check_name === TRANSFORM_FAILED)!;
    expect(f[2][0]!.severity).toBe('CRITICAL');
    expect(f[2][0]!.subject_table).toBeNull();
    expect(f[2][0]!.detail).toMatch(/every screen is falling behind/);
    // The raw tables DID sync; their rows must not be contradicted.
    expect(recordHaltedRun).not.toHaveBeenCalled();
    expect(clearFindings).not.toHaveBeenCalledWith(pool, TRANSFORM_FAILED);
  });

  it('a completed transform clears it', async () => {
    await runFullSync(pool, pool, cfg);
    expect(clearFindings).toHaveBeenCalledWith(pool, TRANSFORM_FAILED);
  });
});
