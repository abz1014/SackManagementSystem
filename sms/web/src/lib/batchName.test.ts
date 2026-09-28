/**
 * This CASES table is identical, character for character, to the one in
 * `api/src/services/batchName.test.ts` — deliberately, so the API and web
 * copies of `batchName` (there is no shared package between them) can never
 * drift apart without a failing test on at least one side. If you change a
 * case here, change it there too.
 */
import { describe, expect, it } from 'vitest';
import { batchName } from './batchName';

const CASES: { name: string; ordinal: number | null; simulator: boolean; expected: string }[] = [
  { name: 'a real IFL generation', ordinal: 3, simulator: false, expected: 'IFL data batch 3' },
  { name: 'a simulator generation', ordinal: 4, simulator: true, expected: 'Simulator data batch 4' },
  { name: 'no ordinal, not simulator', ordinal: null, simulator: false, expected: 'Unregistered data batch' },
  { name: 'no ordinal, simulator flag set', ordinal: null, simulator: true, expected: 'Unregistered data batch' },
  { name: 'ordinal 1, the oldest known generation', ordinal: 1, simulator: false, expected: 'IFL data batch 1' },
];

describe('batchName', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(batchName({ ordinal: c.ordinal, simulator: c.simulator })).toBe(c.expected);
    });
  }
});
