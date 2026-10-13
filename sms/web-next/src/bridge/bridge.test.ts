import { describe, expect, it } from 'vitest';
import { getRange } from './api';
import { period } from './lib';
import { W } from './words';
import { OLD_DATE_FMT } from '../../../web/src/lib/fmtContext';
import { NEXT_DATE_FMT } from './dateFmt';

describe('bridge', () => {
  it('re-exports existing web code', () => {
    expect(typeof getRange).toBe('function');
    expect(typeof period.resolvePeriod).toBe('function');
    expect(W).toBeDefined();
  });

  it('the old renderers keep the old date format unless the redesign provides its own', () => {
    // plant clock labelled UTC: 1 September 2026, 21:33:02
    const at = '2026-09-01T21:33:02Z';
    expect(OLD_DATE_FMT.clock(at)).toBe('9:33 PM');
    expect(OLD_DATE_FMT.dayShort('2026-09-01')).toMatch(/^1 Sept?$/);
    expect(NEXT_DATE_FMT.clock(at)).toBe('21:33');
    expect(NEXT_DATE_FMT.clockSec(at)).toBe('21:33:02');
    expect(NEXT_DATE_FMT.dayLong('2026-09-01')).toBe('1 Sep 2026');
    expect(NEXT_DATE_FMT.dayShort('2026-09-01')).toBe('1 Sep');
    expect(NEXT_DATE_FMT.plantInstant(at)).toBe('1 Sep 2026, 21:33');
  });
});
