/**
 * RT24-05: pdasWrite.ts's echo-back check can only fire under a role that
 * holds SELECT on the PDAS tables it writes to. This module answers that
 * question directly via HAS_PERMS_BY_NAME rather than waiting to infer it
 * from a failed write. These tests drive it entirely offline against a
 * duck-typed pool.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { PDAS_EXEC_PROCS, PDAS_SELECT_TABLES, probePdasPermissions, resetPdasPermissionsCache } from './pdasPermissions.js';

afterEach(() => resetPdasPermissionsCache());

/** A pool answering HAS_PERMS_BY_NAME(...) = 1 for everything except the named gaps. */
function fakePermsPool(opts: { missingSelect?: string[]; missingExecute?: string[] } = {}): () => Promise<ConnectionPool> {
  const missingSelect = new Set(opts.missingSelect ?? []);
  const missingExecute = new Set(opts.missingExecute ?? []);
  const pool = {
    request: () => ({
      query: async (sql: string) => {
        const m = /HAS_PERMS_BY_NAME\('dbo\.(\w+)', 'OBJECT', '(SELECT|EXECUTE)'\)/.exec(sql);
        if (!m) throw new Error(`unexpected query: ${sql}`);
        const name = m[1] ?? '';
        const perm = m[2] ?? '';
        const missing = perm === 'SELECT' ? missingSelect.has(name) : missingExecute.has(name);
        return { recordset: [{ ok: missing ? 0 : 1 }] };
      },
    }),
  };
  return async () => pool as unknown as ConnectionPool;
}

describe('probePdasPermissions', () => {
  it('canReadBack: true and both lists empty when every SELECT/EXECUTE grant is present', async () => {
    const status = await probePdasPermissions({ writerPool: fakePermsPool() });
    expect(status.canReadBack).toBe(true);
    expect(status.missingSelect).toEqual([]);
    expect(status.missingExecute).toEqual([]);
    expect(status.checkedAtUtc).toEqual(expect.any(String));
  });

  it('canReadBack: false and names every table missing SELECT, under an EXECUTE-only role', async () => {
    const status = await probePdasPermissions({
      writerPool: fakePermsPool({ missingSelect: [...PDAS_SELECT_TABLES] }),
    });
    expect(status.canReadBack).toBe(false);
    expect(status.missingSelect.sort()).toEqual([...PDAS_SELECT_TABLES].sort());
    // An EXECUTE-only role still holds EXECUTE on every proc — this maps 0/1
    // into the report independently of the SELECT gap.
    expect(status.missingExecute).toEqual([]);
  });

  it('reports a missing EXECUTE grant independently of the SELECT gap', async () => {
    const status = await probePdasPermissions({
      writerPool: fakePermsPool({ missingSelect: ['Blends'], missingExecute: ['AddBlend', 'CreatePallet'] }),
    });
    expect(status.canReadBack).toBe(false);
    expect(status.missingSelect).toEqual(['Blends']);
    expect(status.missingExecute.sort()).toEqual(['AddBlend', 'CreatePallet'].sort());
    // Every proc pdasWrite.ts calls is checked — not a subset.
    expect(PDAS_EXEC_PROCS).toContain('SetPalletStatusActive');
  });

  it('caches for 10 minutes: a second call inside the window does not re-query', async () => {
    let queries = 0;
    const pool = {
      request: () => ({
        query: async () => {
          queries += 1;
          return { recordset: [{ ok: 1 }] };
        },
      }),
    };
    const deps = { writerPool: async () => pool as unknown as ConnectionPool };
    const t0 = 1_000_000;
    await probePdasPermissions(deps, t0);
    const queriesAfterFirst = queries;
    await probePdasPermissions(deps, t0 + 5 * 60_000);
    expect(queries).toBe(queriesAfterFirst); // still cached

    await probePdasPermissions(deps, t0 + 11 * 60_000);
    expect(queries).toBeGreaterThan(queriesAfterFirst); // cache expired, re-queried
  });
});
