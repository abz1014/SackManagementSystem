/**
 * The worker-side half of roadmap H7 (15 Sep 2026): sync-worker/src/index.ts's
 * checkPlantOffsetOnStartup composes @sms/shared's checkPlantOffset with
 * persistFindings/clearFindings from ./transform/dq.js to turn a plant-clock
 * mismatch into a standing WARNING dq_finding — visible on the Operations
 * screen, not only in a log a nobody reads on an air-gapped plant PC.
 *
 * This suite cannot import sync-worker/src/index.ts directly: its last line
 * — `main().catch(...)` — runs unconditionally on import and calls
 * `process.exit(1)` on failure, which would kill the test runner rather than
 * fail a test. No test in this package imports index.ts, for that reason.
 * Instead this exercises the exact same primitives, in the exact same order
 * and with the exact same arguments checkPlantOffsetOnStartup uses, over the
 * recording fake pool housekeeping.test.ts already established for this
 * package — pinning the finding's shape independently of index.ts's wiring.
 * `hostOffsetMinutes` is always passed explicitly to checkPlantOffset, never
 * left to default to plantOffsetMinutes(), so none of this depends on the
 * machine's real timezone.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { checkPlantOffset } from '@sms/shared';
import { clearFindings, persistFindings } from './transform/dq.js';

/** Must match sync-worker/src/index.ts's exported PLANT_CLOCK_MISMATCH. */
const PLANT_CLOCK_MISMATCH = 'plant_clock_mismatch';

interface Stmt { sql: string; inputs: Map<string, unknown> }

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
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

/** Reproduces sync-worker/src/index.ts's checkPlantOffsetOnStartup exactly, over an injected pool. */
async function runCheck(pool: ConnectionPool, expectedMinutes: number | undefined, hostOffsetMinutes: number): Promise<void> {
  const result = checkPlantOffset(expectedMinutes, hostOffsetMinutes);
  if (!result.checked) return;
  if (!result.mismatched) {
    await clearFindings(pool, PLANT_CLOCK_MISMATCH);
    return;
  }
  await persistFindings(pool, randomUUID(), [
    { check_name: PLANT_CLOCK_MISMATCH, severity: 'WARNING', subject_table: null, count: 1, detail: result.message },
  ]);
}

describe('the plant-clock mismatch finding', () => {
  it('raises a WARNING, pass-level (no subject_table) finding, deduplicated like every other state finding', async () => {
    const pool = fakePool();
    await runCheck(pool, 300, 0); // configured UTC+5, host reports UTC — the H7 scenario: a freshly imaged plant PC
    const ins = pool.statements.find((s) => /INSERT INTO sms\.dq_finding/.test(s.sql))!;
    expect(ins).toBeDefined();
    expect(ins.inputs.get('check')).toBe(PLANT_CLOCK_MISMATCH);
    expect(ins.inputs.get('sev')).toBe('WARNING');
    expect(ins.inputs.get('tbl')).toBeNull();
    expect(ins.sql).toMatch(/WHERE NOT EXISTS/); // persistFindings' dedupe: a restart loop must not flood the table
    expect(String(ins.inputs.get('detail'))).toMatch(/UTC offset of 0 minutes/);
    expect(String(ins.inputs.get('detail'))).toMatch(/PLANT_UTC_OFFSET_MINUTES says the plant is at 300/);
  });

  it('clears the finding (by check name only) when the host and configured offsets agree', async () => {
    const pool = fakePool();
    await runCheck(pool, 300, 300);
    const del = pool.statements.find((s) => /DELETE FROM sms\.dq_finding/.test(s.sql))!;
    expect(del).toBeDefined();
    expect(del.inputs.get('check')).toBe(PLANT_CLOCK_MISMATCH);
    expect(pool.statements.some((s) => /INSERT INTO sms\.dq_finding/.test(s.sql))).toBe(false);
  });

  it('never touches the database when PLANT_UTC_OFFSET_MINUTES is unset — skipped, not "checked against 0"', async () => {
    const pool = fakePool();
    await runCheck(pool, undefined, 300);
    expect(pool.statements).toHaveLength(0);
  });
});
