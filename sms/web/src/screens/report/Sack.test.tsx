/**
 * The Sack report screen after IFL reports D-S2/D-S6 (1 Oct 2026): an average
 * sack column in the shift and day tables, no cone-inspection column in a table
 * headed by sack figures, and a sentence saying how many cone-only days the day
 * table left out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch, type FakeFetch } from '../../testkit/fetchRouter';
import { META_FIXTURE } from '../../testkit/fixtures';
import { W } from '../../lib/words';
import { fmtKg } from '../../lib/fmt';
import type { ReportLine, SackReportData } from '../../api';
import { SackSection } from './Sack';
import { LineTable } from './shared';

const line = (group: string, over: Partial<ReportLine> = {}): ReportLine => ({
  group, cones: 5000, rejectedCones: 77, rejectRatePct: 1.5, conesInRangePct: 98, sacks: 100, sackWeightKg: 4725,
  avgSackKg: 47.25, conesPerSack: 50, sacksPassedScalePct: 91.2, ...over,
});

const base: SackReportData = {
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-03' }, filters: {}, weightBasis: 'as_recorded',
  totals: line('total'), rejectedByScale: 9, inRangePct: 91.2, conesPerSack: 50,
  byShift: [line('morning'), line('evening', { avgSackKg: null })],
  byDay: [line('2026-09-02', { avgSackKg: 47.31 })],
  omittedConeOnlyDays: 2,
  byProduct: [], distribution: null,
  caveats: { time: 'time caveat', machine: 'machine caveat', conesPerSack: 'cones-per-sack caveat' },
};

const headers = (c: HTMLElement) => [...c.querySelectorAll('thead th')].map((th) => th.textContent);

describe('SackSection — D-S2 average column, D-S6 omitted days', () => {
  it('both tables carry the average sack column; a group with no plausible sack prints a dash', () => {
    const { container } = render(<SackSection d={base} products={[]} />);
    const tables = [...container.querySelectorAll('table.ifl-table')].slice(0, 2);
    expect(tables).toHaveLength(2);
    for (const t of tables) expect(headers(t as HTMLElement)).toContain(W.report.averageSack);
    const shiftRows = [...tables[0]!.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');
    expect(shiftRows[0]).toContain(fmtKg(47.25));
    expect(shiftRows[1]).toContain('—');
    expect(tables[1]!.textContent).toContain(fmtKg(47.31));
  });

  it('a table headed by sack figures has no cone-inspection column, and no cone-reject number in its rows', () => {
    const { container } = render(<SackSection d={base} products={[]} />);
    const [shiftTable, dayTable] = [...container.querySelectorAll('table.ifl-table')].slice(0, 2) as HTMLElement[];
    for (const t of [shiftTable!, dayTable!]) {
      expect(headers(t)).not.toContain(W.reports.rejectedAtInspection);
      expect(headers(t)).toContain(W.reports.colSacksPassedScale); // the scale's own verdict stays
      expect(t.textContent).not.toContain('77'); // rejectedCones of the fixture
    }
  });

  it('says how many days with cones but no sack are not listed, with the right plural', () => {
    const two = render(<SackSection d={base} products={[]} />);
    expect(two.container.textContent).toContain('2 days with cones weighed but no sack are not listed here');
    two.unmount();
    const one = render(<SackSection d={{ ...base, omittedConeOnlyDays: 1 }} products={[]} />);
    expect(one.container.textContent).toContain('1 day with cones weighed but no sack is not listed here');
  });

  it('says nothing about omitted days when none were left out, or when the figure was not computed', () => {
    for (const omittedConeOnlyDays of [0, undefined]) {
      const { container, unmount } = render(<SackSection d={{ ...base, omittedConeOnlyDays }} products={[]} />);
      expect(container.textContent).not.toContain('not listed here');
      unmount();
    }
  });
});

describe('LineTable — sack mode', () => {
  const rows = [line('morning')];
  it('without sackScale (Daily, Shift) it keeps the cone-inspection column and has no average column', () => {
    const { container } = render(<LineTable rows={rows} head={W.report.colShift} />);
    expect(headers(container)).toContain(W.reports.rejectedAtInspection);
    expect(headers(container)).not.toContain(W.report.averageSack);
    expect(headers(container)).not.toContain(W.reports.colSacksPassedScale);
  });
  it('avgSack adds the average column on its own; sackScale swaps the inspection column for the scale verdict', () => {
    const avg = render(<LineTable rows={rows} head={W.report.colShift} avgSack />);
    expect(headers(avg.container)).toContain(W.report.averageSack);
    expect(headers(avg.container)).toContain(W.reports.rejectedAtInspection);
    avg.unmount();
    const sack = render(<LineTable rows={rows} head={W.report.colShift} sackScale />);
    expect(headers(sack.container)).not.toContain(W.reports.rejectedAtInspection);
    expect(headers(sack.container)).toContain(W.reports.colSacksPassedScale);
  });
  it('every body row has exactly as many cells as the header has columns, in every mode', () => {
    for (const mode of [{}, { avgSack: true }, { sackScale: true }, { sackScale: true, avgSack: true }]) {
      const { container, unmount } = render(<LineTable rows={rows} head={W.report.colShift} {...mode} />);
      expect(container.querySelector('tbody tr')!.children).toHaveLength(container.querySelectorAll('thead th').length);
      unmount();
    }
  });
});

describe('SackSection — the stock ledger is per production day and says so under a shift narrowing', () => {
  let fake: FakeFetch | null = null;
  afterEach(() => { fake?.restore(); fake = null; });

  const flow = (sacks: number) => ({ sacks, kg: sacks * 47 });
  const ledger = {
    from: '2026-09-01', to: '2026-09-03', product: null, basis: 'line', machineLevel: { enabled: false, reason: 'No sack is attributed to a machine.' },
    dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: 'r', weightBasis: 'as_recorded', tareKg: 0,
    opening: flow(0), closing: flow(5),
    totals: { openingEntries: flow(0), receipts: flow(5), weighed: flow(5), issues: flow(0), consumption: flow(0), adjustments: flow(0) },
    days: [{ day: '2026-09-02', opening: flow(0), receipts: flow(5), issues: flow(0), consumption: flow(0), adjustments: flow(0), closing: flow(5) }],
    byMaterial: [], kgMissing: 0, countedSinceDay: '2026-09-01', manualMovementRows: 0,
  };
  const withLedger = () => { fake = installFakeFetch({ '/api/sacks/stock': { data: ledger, metadata: META_FIXTURE } }); };

  it('a report narrowed to one shift labels the ledger as whole-day; the same report over whole days does not', async () => {
    withLedger();
    const narrowed = render(<SackSection d={{ ...base, filters: { shift: 'night' } }} products={[]} />);
    await waitFor(() => expect(narrowed.container.textContent).toContain(W.reports.stockColClosing));
    expect(narrowed.container.textContent).toContain(W.reports.stockWholeDays);
    narrowed.unmount();
    const whole = render(<SackSection d={base} products={[]} />);
    await waitFor(() => expect(whole.container.textContent).toContain(W.reports.stockColClosing));
    expect(whole.container.textContent).not.toContain(W.reports.stockWholeDays);
  });

  it('a shift-bounded range (the page zoom) is a narrowing too', async () => {
    withLedger();
    const { container } = render(<SackSection d={base} products={[]} shiftRangeApplied />);
    await waitFor(() => expect(container.textContent).toContain(W.reports.stockColClosing));
    expect(container.textContent).toContain(W.reports.stockWholeDays);
  });
});
