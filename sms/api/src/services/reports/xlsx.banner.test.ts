/** D-75: the workbook banner must not say "All shifts" when the period names a shift range. */
import { describe, expect, it } from 'vitest';
import { titleRowsFor } from './xlsx.js';
import type { ReportHeader } from './common.js';

const base = {
  title: 'Daily report', lineName: 'TP1 Line 3', plantName: null, unitName: null,
  period: { from: '2026-09-01', to: '2026-09-02' }, periodLabel: '2026-09-01 to 2026-09-02', filters: {},
  generatedAtPlantUtc: '2026-09-08T10:00:00.000Z', smsVersion: '1.0',
} as unknown as ReportHeader;

describe('titleRowsFor — shift part of the banner', () => {
  it('omits "Shift: All shifts" for a shift-range export', () => {
    const h = { ...base, periodLabel: '1 Sep evening shift – 2 Sep morning shift' } as ReportHeader;
    const line = titleRowsFor(h, null)[2]!;
    expect(line).not.toContain('All shifts');
    expect(line).toContain('1 Sep evening shift');
  });
  it('still says "Shift: All shifts" when neither a shift nor a range is given', () => {
    expect(titleRowsFor(base, null)[2]).toContain('Shift: All shifts');
  });
  it('still names a single shift filter', () => {
    const h = { ...base, filters: { shift: 'night' } } as unknown as ReportHeader;
    expect(titleRowsFor(h, null)[2]).toContain('Shift: night');
  });
});
