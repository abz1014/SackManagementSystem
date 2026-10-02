/** C-156 (D-97): the Readings headline must not print a "(0%)" rate when nothing was weighed. */
import { describe, expect, it } from 'vitest';
import { countLine, type CountState } from './Readings';
import { W } from '../lib/words';
import type { Period } from '../lib/period';

const PERIOD = { from: '2026-10-02', to: '2026-10-02', shift: null, live: false } as unknown as Period;
const ok = (n: number): CountState => ({ kind: 'ok', n });

describe('Readings headline - zero weighed (C-156)', () => {
  it('0 weighed, 0 rejected states both numbers and no rate', () => {
    const s = countLine(PERIOD, 'cones', ok(0), ok(0), false, []);
    expect(s).toContain(W.readings.countLineNoRate('0', '0'));
    expect(s).not.toContain('%');
  });
});
