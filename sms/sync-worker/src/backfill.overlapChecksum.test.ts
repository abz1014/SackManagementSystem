/**
 * C-010 / C-023 (D-62): the overlap proof's checksum must not depend on the
 * two databases' collations (character columns hashed as the same type under
 * one binary collation) and must not self-cancel (SUM, not XOR CHECKSUM_AGG).
 * Fake pools only; nothing opens a connection.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { julyDefFor, overlapChecksum } from './backfill.js';

function capturePool(log: string[]): ConnectionPool {
  return {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          log.push(sql);
          return { recordset: [{ n: 1, agg: 5 }] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('overlapChecksum SQL (C-010 / C-023)', () => {
  it('hashes character columns as the same type under one binary collation on both sides', async () => {
    for (const [table, kind] of [['pack1_TP1U2', 'cone'], ['sack1_TP1U2', 'sack']] as const) {
      const def = julyDefFor(table, kind);
      const srcLog: string[] = [];
      const rawLog: string[] = [];
      await overlapChecksum(capturePool(srcLog), capturePool(rawLog), def, 1, 1, 10);
      const src = srcLog[0]!;
      const raw = rawLog[0]!;
      const charCols = def.columns.filter((c) => c.type === 'varchar');
      expect(charCols.length).toBeGreaterThan(0);
      for (const c of charCols) {
        expect(src).toMatch(new RegExp(`CAST\\(\\[${c.src}\\] AS nvarchar\\(\\d+\\)\\) COLLATE Latin1_General_BIN2`));
        expect(raw).toMatch(new RegExp(`CAST\\(${c.raw} AS nvarchar\\(\\d+\\)\\) COLLATE Latin1_General_BIN2`));
      }
      for (const sql of [src, raw]) {
        expect(sql).toContain('SUM(CAST(CHECKSUM(');
        expect(sql).not.toContain('CHECKSUM_AGG');
      }
    }
  });

  it('the aggregate does not self-cancel on an even number of identical changes', () => {
    // Model of the two aggregates over per-row checksums.
    const xor = (a: number[]) => a.reduce((x, y) => x ^ y, 0);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const before = [11, 22, 33, 44];
    // two rows change by the same XOR mask: XOR cancels, SUM does not.
    const after = [11 ^ 7, 22 ^ 7, 33, 44];
    expect(xor(before)).toBe(xor(after)); // the old defect
    expect(sum(before)).not.toBe(sum(after)); // what the proof now uses
  });
});
