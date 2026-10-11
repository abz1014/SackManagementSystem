/**
 * S3 F-2 (Stage 3, 11 Oct 2026): product changes on the report screens.
 *
 * User impact: only the machine-product report showed when a winder changed product, and its time column was headed just
 * "When", which did not say that it is the first cone of the new product (the panel selection is never seen). The product,
 * daily, shift and shift-production reports now carry the same table. jsdom, no session; values are synthetic copies of the real
 * changes measured on sms_audit (winder 13, 1022 to 20, first cone 7 Sep 10:37).
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ProductChangesBlock } from './ProductChanges';
import { MachineProductSection } from './MachineProduct';
import { ShiftSection } from './Shift';
import type { MachineProductChange, MachineProductReportData, ShiftReportData } from '../../api';

const CHANGE: MachineProductChange = {
  station: 13, machineName: 'M13', day: '2026-09-07', shift: 'morning', fromMaterialId: 1022, fromProductName: '205-IL0-SD',
  toMaterialId: 20, toProductName: '205-IL0-SD', firstUtc: '2026-09-07T10:37:10.310Z', kind: 'between_shifts', fromBeforePeriod: true,
};
const LABELS = { '1022': '205-IL0-SD #1022', '20': '205-IL0-SD #20' };

describe('ProductChangesBlock', () => {
  it('shows the table headed "First cone of the new product", the labels, the before-the-period mark and the time rule once', () => {
    const { container } = render(<ProductChangesBlock d={{ productChanges: [CHANGE], productChangeLabels: LABELS }} />);
    const heads = [...container.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(heads).toEqual(['First cone of the new product', 'Machine', 'From', 'To']);
    const text = container.textContent ?? '';
    expect(text).toContain('205-IL0-SD #1022');
    expect(text).toContain('(before this period)');
    expect(text).toContain('10:37');
    expect(text.match(/not at the moment the panel selection was made/g)?.length).toBe(1);
    expect(container.querySelector('.no-print')).not.toBeNull();
  });

  it('says plainly when there was none or could not be read, and renders nothing for a payload that predates the field', () => {
    expect(render(<ProductChangesBlock d={{ productChanges: [] }} />).container.textContent).toContain('No product change was read on any winder in this period.');
    expect(render(<ProductChangesBlock d={{ productChanges: null }} />).container.textContent).toContain('Product changes could not be read for this period.');
    expect(render(<ProductChangesBlock d={{}} />).container.textContent).toBe('');
  });
});

describe('where the block appears', () => {
  const line = { group: 'g', cones: 10, rejectedCones: 0, rejectRatePct: 0, conesInRangePct: 90, sacks: 1, sackWeightKg: 40, avgSackKg: 40, conesPerSack: 10 };
  const shiftData = (extra: object): ShiftReportData => ({
    period: { period: 'custom', from: '2026-09-07', to: '2026-09-07' },
    shift: null,
    shifts: [{ shift: 'morning', coverage: { daysInPeriod: 1, daysWithData: 1, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07', complete: true }, totals: line, byDay: [line], readings: null }],
    shiftCheck: null,
    timeLostNote: 'n',
    ...extra,
  } as unknown as ShiftReportData);

  it('the shift report prints it, with its changes', () => {
    const { container } = render(<ShiftSection d={shiftData({ productChanges: [CHANGE], productChangeLabels: LABELS })} />);
    expect(container.textContent).toContain('Product changes');
    expect(container.textContent).toContain('First cone of the new product');
  });

  it('the machine-product report keeps its own table, now headed "First cone of the new product", with the time rule hidden in print', () => {
    const d = {
      period: { period: 'custom', from: '2026-09-07', to: '2026-09-07' }, filters: {}, columns: [{ day: '2026-09-07', shift: 'morning', cones: 5 }], rows: [{ station: 13, stationName: null, machineName: 'M13', cells: [null], cones: 5, materials: 1 }], changes: [CHANGE], products: [],
      labels: LABELS, conesWithoutStation: 0, note: 'n',
    } as unknown as MachineProductReportData;
    const { container } = render(<MachineProductSection d={d} onOpen={() => {}} />);
    const heads = [...container.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(heads).toContain('First cone of the new product');
    const rule = [...container.querySelectorAll('p')].find((p) => (p.textContent ?? '').includes('not at the moment the panel selection was made'));
    expect(rule?.className).toContain('no-print');
  });
});
