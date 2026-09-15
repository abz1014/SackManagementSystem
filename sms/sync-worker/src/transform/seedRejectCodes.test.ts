/**
 * seedRejectCodes inserts only the code pairs the line does not know yet, and
 * only for the configured line (roadmap Phase 5 item 6, 14 Sep 2026).
 *
 * The fake pool APPLIES the statement to an in-memory reject_event and
 * reject_code rather than answering with a canned count: the pre-Phase-5 seed
 * had no line in either its INSERT or its NOT EXISTS, and a canned response
 * would have passed it just the same. The fake honours exactly the SQL shape
 * the seed writes — DISTINCT over reject_event filtered by @line, NOT EXISTS
 * against reject_code on (line, type, ISNULL tube, ISNULL material).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { seedRejectCodes } from './seedRejectCodes.js';

interface Event { line_id: number; reject_type: string; tube_inspect_code: number | null; material_inspect_code: number | null }
interface Code { line_id: number; reject_type: string; tube_code: number | null; material_code: number | null }

function fakePool(events: Event[], codes: Code[]) {
  const statements: { sql: string; inputs: Map<string, unknown> }[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => { inputs.set(name, value); return req; },
        query: async (sql: string) => {
          statements.push({ sql, inputs: new Map(inputs) });
          // The fake implements only the statement it expects; anything else is a test failure.
          expect(sql).toMatch(/INSERT INTO sms\.reject_code \(line_id, reject_type, tube_code, material_code\)/);
          expect(sql).toMatch(/WHERE re\.line_id = @line/);
          expect(sql).toMatch(/rc\.line_id = re\.line_id/);
          expect(sql).toMatch(/ISNULL\(rc\.tube_code, -999\)\s+= ISNULL\(re\.tube_inspect_code, -999\)/);
          expect(sql).toMatch(/ISNULL\(rc\.material_code, -999\) = ISNULL\(re\.material_inspect_code, -999\)/);
          const line = inputs.get('line') as number;
          const seen = new Set<string>();
          let inserted = 0;
          for (const e of events) {
            if (e.line_id !== line) continue;
            const k = `${e.reject_type}|${e.tube_inspect_code ?? -999}|${e.material_inspect_code ?? -999}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const known = codes.some((c) =>
              c.line_id === e.line_id && c.reject_type === e.reject_type &&
              (c.tube_code ?? -999) === (e.tube_inspect_code ?? -999) && (c.material_code ?? -999) === (e.material_inspect_code ?? -999));
            if (known) continue;
            codes.push({ line_id: e.line_id, reject_type: e.reject_type, tube_code: e.tube_inspect_code, material_code: e.material_inspect_code });
            inserted++;
          }
          return { recordset: [], rowsAffected: [inserted] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements, codes };
}

const EVENTS: Event[] = [
  { line_id: 1, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  { line_id: 1, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 }, // duplicate pair
  { line_id: 1, reject_type: 'quality', tube_inspect_code: 2, material_inspect_code: 1 },
  { line_id: 1, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null },
  { line_id: 1, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null },
  { line_id: 2, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 }, // another line, same numbers
  { line_id: 2, reject_type: 'quality', tube_inspect_code: 9, material_inspect_code: 9 },
];

describe('seedRejectCodes', () => {
  it('inserts each unknown (type, tube, material) pair once, for the configured line only', async () => {
    const { pool, codes, statements } = fakePool(EVENTS, []);
    const n = await seedRejectCodes(pool, 1);
    expect(n).toBe(3);
    expect(statements[0]!.inputs.get('line')).toBe(1);
    expect(codes).toEqual([
      { line_id: 1, reject_type: 'quality', tube_code: 1, material_code: 3 },
      { line_id: 1, reject_type: 'quality', tube_code: 2, material_code: 1 },
      { line_id: 1, reject_type: 'weight', tube_code: null, material_code: null },
    ]);
  });

  it('is idempotent: a second pass inserts nothing, the weight code (NULL/NULL) included', async () => {
    const { pool, codes } = fakePool(EVENTS, []);
    await seedRejectCodes(pool, 1);
    const again = await seedRejectCodes(pool, 1);
    expect(again).toBe(0);
    expect(codes).toHaveLength(3);
  });

  it('a pair line 1 knows is still inserted for line 2 — the same numbers may mean a different fault there', async () => {
    const { pool, codes } = fakePool(EVENTS, [
      { line_id: 1, reject_type: 'quality', tube_code: 1, material_code: 3 },
    ]);
    const n = await seedRejectCodes(pool, 2);
    expect(n).toBe(2);
    expect(codes.filter((c) => c.line_id === 2)).toEqual([
      { line_id: 2, reject_type: 'quality', tube_code: 1, material_code: 3 },
      { line_id: 2, reject_type: 'quality', tube_code: 9, material_code: 9 },
    ]);
    // and nothing of line 1's was touched
    expect(codes.filter((c) => c.line_id === 1)).toHaveLength(1);
  });
});
