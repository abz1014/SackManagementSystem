import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ShiftProductionSection, fmtKg2 } from './ShiftProduction';
import type { ShiftProductionFigures, ShiftProductionReportData } from '../../api';

const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };

/**
 * A figure row. `weighed` and `weighedKg` default to the pre-D1 shape (every cone a pass, no kilograms);
 * pass explicit values where the cone and its weight-reject record are the same cone.
 */
const fig = (pass: number, weightRejects: number, efficiencyPct: number | null, weighed = pass, weighedKg: number | null = 0): ShiftProductionFigures => ({
  weighed, pass, weightRejects, total: pass + weightRejects, efficiencyPct, weighedKg,
});

const sp: ShiftProductionReportData = {
  period: P, filters: {}, lineId: 1,
  summary: [
    { shift: 'morning', ...fig(11970, 30, 99.75, 12000, 23400.5) },
    { shift: 'evening', ...fig(100, 0, 100, 100, 195) },
  ],
  grandTotal: fig(12070, 30, 99.75, 12100, 23595.5),
  rows: [
    { date: '2026-09-01', shift: 'morning', winder: 1, ...fig(9, 1, 90, 10, 19.5) },
    { date: '2026-09-01', shift: 'morning', winder: 2, ...fig(5, 0, null, 5, null) },
  ],
  shiftTotals: [{ date: '2026-09-01', shift: 'morning', ...fig(14, 1, 93.33, 15, 19.5) }],
  dayTotals: [{ date: '2026-09-01', ...fig(14, 1, 93.33, 15, 19.5) }],
  winderTotals: [{ winder: 1, ...fig(9, 1, 90, 10, 19.5) }, { winder: 2, ...fig(5, 0, 100, 5, null) }],
  withoutWinder: { pass: 4, weightRejects: 0 },
  loop: { hangersSeen: 299 },
  scaleRejectedCones: 3,
  kgBasis: { basis: 'net', label: 'net of the 70 g cone tube set in Setup', implausible: 2 },
  note: 'Each cone is counted once.',
  pendingIfl: ['CTS loop is taken to mean the whole line.'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const text = (c: HTMLElement) => c.textContent ?? '';

describe('ShiftProductionSection', () => {
  it('renders the figures, efficiency format, DD-MM-YYYY and a portrait root', () => {
    const { container } = render(<ShiftProductionSection d={sp} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const t = text(container);
    expect(t).toContain('12,000');
    expect(t).toContain('99.75');
    expect(t).toContain('100.00');
    expect(t).toContain('90.00');
    expect(t).toContain('—');
    expect(t).toContain('01-09-2026');
    expect(t).not.toContain('2026-09-01');
    expect(t).toContain('Each cone is counted once.');
    const low = [...container.querySelectorAll('td.n')].find((td) => td.textContent === '90.00') as HTMLElement;
    expect(low.classList.contains('eff-low')).toBe(true);
    const full = [...container.querySelectorAll('td.n')].find((td) => td.textContent === '100.00') as HTMLElement;
    expect(full.classList.contains('eff-low')).toBe(false);
  });

  it('carries Weighed beside Pass, and the weighed kilograms, in every table', () => {
    const { container } = render(<ShiftProductionSection d={sp} />);
    const tables = [...container.querySelectorAll('table.ifl-table')];
    expect(tables).toHaveLength(3);
    for (const table of tables) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
      expect(heads).toContain('Weighed');
      expect(heads).toContain('Pass');
      expect(heads).toContain('Weighed (kg)');
    }
    const t = text(container);
    expect(t).toContain('23,400.50');
    expect(t).toContain('23,595.50');
    expect(t).toContain('19.50');
  });

  it('an unknown weight prints a dash, never a 0.00', () => {
    expect(fmtKg2(null)).toBe('—');
    expect(fmtKg2(undefined)).toBe('—');
    expect(fmtKg2(0)).toBe('0.00');
    expect(fmtKg2(1234.5)).toBe('1,234.50');
    const { container } = render(<ShiftProductionSection d={sp} />);
    // winder 2 on the 1st: 5 cones weighed, no plausible weight
    const winder2 = [...container.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td.n')?.textContent === '2' && tr.textContent?.includes('5'));
    expect(winder2?.textContent).toContain('—');
    expect(winder2?.textContent).not.toContain('0.00');
  });

  it('puts a total after each shift, a total after each day, and a grand total on the summary and on the winder table', () => {
    const { container } = render(<ShiftProductionSection d={sp} />);
    const totals = [...container.querySelectorAll('tr.total')].map((tr) => tr.querySelector('td')?.textContent);
    expect(totals).toEqual(['Grand total', 'Shift total', 'Day total, 01-09-2026', 'Grand total']);
  });

  it('says the loop, the scale-bit-versus-reject-records line and the kg basis in plain sentences', () => {
    const { container } = render(<ShiftProductionSection d={sp} />);
    const t = text(container);
    expect(t).toContain('CTS loop: the line’s one hanger loop — 299 hanger numbers seen in this period.');
    expect(t).toContain('The scale’s own in-range bit marked 3 cones; the weight-reject records hold 30; they are separate records and are not merged.');
    expect(t).toContain('Weighed kg is the sum of the plausible cone weights, net of the 70 g cone tube set in Setup. 2 readings outside the plausibility window are not in it.');
    expect(t).toContain('4 pass');
  });

  it('prints "Assumed until IFL confirms" on screen only, and nothing when the report assumes nothing', () => {
    const { container, rerender } = render(<ShiftProductionSection d={sp} />);
    const pending = container.querySelector('[data-testid="pending-ifl"]');
    expect(pending?.textContent).toContain('Assumed until IFL confirms');
    expect(pending?.textContent).toContain('CTS loop is taken to mean the whole line.');
    expect(pending?.classList.contains('no-print')).toBe(true);
    rerender(<ShiftProductionSection d={{ ...sp, pendingIfl: [] }} />);
    expect(container.querySelector('[data-testid="pending-ifl"]')).toBeNull();
  });

  it('a shift whose cones all lack a winder still shows its total, labelled with its date and shift', () => {
    const lone: ShiftProductionReportData = {
      ...sp,
      rows: [],
      shiftTotals: [{ date: '2026-09-02', shift: 'night', ...fig(6, 0, 100, 6, 11.7) }],
      dayTotals: [{ date: '2026-09-02', ...fig(6, 0, 100, 6, 11.7) }],
      winderTotals: [],
    };
    const { container } = render(<ShiftProductionSection d={lone} />);
    const t = text(container);
    expect(t).toContain('02-09-2026 Night: Shift total');
    // an empty winder table is not drawn
    expect(container.querySelectorAll('table.ifl-table')).toHaveLength(2);
  });

  it('a single hanger reads "1 hanger number", a single scale reject "1 cone"', () => {
    const { container } = render(<ShiftProductionSection d={{ ...sp, loop: { hangersSeen: 1 }, scaleRejectedCones: 1, kgBasis: { ...sp.kgBasis!, implausible: 1 } }} />);
    const t = text(container);
    expect(t).toContain('— 1 hanger number seen in this period.');
    expect(t).toContain('marked 1 cone;');
    expect(t).toContain('1 reading outside the plausibility window is not in it.');
  });

  it('a payload from an older server (no day or winder totals, no loop, no basis) still renders', () => {
    const old = { ...sp } as Partial<ShiftProductionReportData>;
    delete old.dayTotals; delete old.winderTotals; delete old.loop; delete old.kgBasis; delete old.scaleRejectedCones;
    const { container } = render(<ShiftProductionSection d={old as ShiftProductionReportData} />);
    const t = text(container);
    expect(t).toContain('12,000');
    expect(t).not.toContain('hanger numbers seen');
    expect(t).not.toContain('in-range bit');
    expect(container.querySelectorAll('table.ifl-table')).toHaveLength(2);
  });

  it('empty state says no cones were weighed, keeps the note and what the report assumes', () => {
    const empty = { ...sp, rows: [], summary: [], shiftTotals: [], dayTotals: [], winderTotals: [], grandTotal: fig(0, 0, null, 0, null) };
    const { container } = render(<ShiftProductionSection d={empty} />);
    const t = text(container);
    expect(t).toContain('No cones were weighed in this period.');
    expect(t).toContain('Each cone is counted once.');
    expect(container.querySelector('[data-testid="pending-ifl"]')).not.toBeNull();
    expect(container.querySelectorAll('table')).toHaveLength(0);
  });
});
