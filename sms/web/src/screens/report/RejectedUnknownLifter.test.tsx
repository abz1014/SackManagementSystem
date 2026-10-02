/**
 * Rejected Unknown (Lifter) report, screen (task W1-R8, 1 Oct 2026; definition
 * narrowed in gate round 1): table A per lifter, table B (rejects with no
 * lifter or winder recorded, or the one-sentence empty state), table B2 (the
 * separate list of zero reason codes, meaning not confirmed by IFL), block C
 * for the zeroed-clock records, the cap and clock-fault sentences, and the
 * assumptions.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { RejectedUnknownLifterSection, type RejectedUnknownLifterView } from './RejectedUnknownLifter';
import type { LifterRow, UnknownLifterReject } from '../../api';

const lifter = (n: number | null, over: Partial<LifterRow> = {}): LifterRow => ({
  lifter: n, cones: 100, inspected: 101, qualityRejects: 3, zeroCodeRejects: 0, weightRejects: 1, total: 4, ratePct: 3.96, ...over,
});
const reject = (over: Partial<UnknownLifterReject> = {}): UnknownLifterReject => ({
  date: '2026-08-15', shift: 'night', producedAtUtc: '2026-08-16T04:17:16.150Z', hanger: 27, winder: 2, lifter: 2, rejectType: 'quality',
  tubeCode: 0, materialCode: 0, weightG: null, why: ['Reason code is zero'], ...over,
});
const base: RejectedUnknownLifterView = {
  period: { period: 'custom', from: '2026-08-15', to: '2026-08-15' }, filters: {}, lineId: 1,
  lifters: Array.from({ length: 14 }, (_, i) => lifter(i + 1)),
  total: lifter(null, { cones: 1400, inspected: 1414, qualityRejects: 42, weightRejects: 14, total: 56, ratePct: 3.96 }),
  unknownCount: 0, list: [], listTotal: 0, listCap: 5000, zeroCodeList: [], zeroCodeTotal: 0, excludedClockFault: 0,
  zeroedClock: { generation: null, rows: [] },
  note: 'THE DRAFT NOTE', pendingIfl: [], generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};
const rowsOf = (c: HTMLElement, table: number) => [...c.querySelectorAll('table')[table]!.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));

describe('RejectedUnknownLifterSection', () => {
  it('table A: a row per lifter and a total, with the rate to 2 dp', () => {
    const { container } = render(<RejectedUnknownLifterSection d={base} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const a = rowsOf(container, 0);
    expect(a).toHaveLength(15);
    expect(a[0]).toEqual(['1', '100', '101', '3', '0', '1', '4', '3.96']);
    expect(a[13]![0]).toBe('14');
    expect(a[14]).toEqual(['Total', '1,400', '1,414', '42', '0', '14', '56', '3.96']);
  });

  it('every reject carries a lifter: says so in one sentence and prints no list table', () => {
    const { container } = render(<RejectedUnknownLifterSection d={base} />);
    expect(container.textContent).toContain('Every rejected cone in this period carries a lifter number.');
    expect(container.textContent).toContain('Rejects with no lifter recorded');
    // the old draft title (which folded the zero code in) is gone
    expect(container.textContent).not.toContain('no winder or a zero reason code');
    expect(container.querySelectorAll('table')).toHaveLength(1);
  });

  it('the "No lifter recorded" bucket reads in words, and a lifter with nothing inspected shows a dash rate', () => {
    const d = { ...base, lifters: [lifter(1, { cones: 0, inspected: 0, total: 0, qualityRejects: 0, weightRejects: 0, ratePct: null }), lifter(null, { cones: 2, inspected: 2, total: 0, qualityRejects: 0, weightRejects: 0, ratePct: 0 })] };
    const { container } = render(<RejectedUnknownLifterSection d={d} />);
    const a = rowsOf(container, 0);
    expect(a[0]![7]).toBe('—');
    expect(a[1]![0]).toBe('No lifter recorded');
    expect(a[1]![7]).toBe('0.00');
  });

  it('table B: each unknown reject with its time of day (plant clock), hanger, codes and why', () => {
    const list = [
      reject({ lifter: null, winder: null, hanger: 105, tubeCode: 1, materialCode: 11, why: ['No lifter recorded', 'No winder recorded'], producedAtUtc: '2026-08-15T21:32:41.867Z', shift: 'evening' }),
      reject({ rejectType: 'weight', tubeCode: null, materialCode: null, weightG: 2035, why: ['No winder recorded'], winder: null }),
    ];
    const { container } = render(<RejectedUnknownLifterSection d={{ ...base, unknownCount: 2, list, listTotal: 2 }} />);
    expect(container.textContent).not.toContain('Every rejected cone in this period carries a lifter number.');
    const b = rowsOf(container, 1);
    expect(b[0]).toEqual(['15-08-2026', '9:32:41 PM', 'Evening', '105', '—', '—', 'Quality', '1', '11', '—', 'No lifter recorded; No winder recorded']);
    expect(b[1]).toEqual(['15-08-2026', '4:17:16 AM', 'Night', '27', '2', '—', 'Weight', '—', '—', '2,035', 'No winder recorded']);
  });

  it('states how many of how many a cut list shows, and the zeroed-clock records left out of A and B', () => {
    const d = { ...base, unknownCount: 7000, list: [reject({ lifter: null, why: ['No lifter recorded'] })], listTotal: 7000, excludedClockFault: 1 };
    const { container } = render(<RejectedUnknownLifterSection d={d} />);
    expect(container.textContent).toContain('Showing the first 1 of 7,000.');
    expect(container.textContent).toContain('1 record with a zeroed clock (before 1970) cannot be placed in any period and is left out of this list.');
  });

  it('table B2: a zero-coded reject with a lifter is NOT in the no-lifter list; it sits in its own, clearly titled list', () => {
    const z = reject({ hanger: 27, why: ['Reason code is zero'] });
    const { container } = render(<RejectedUnknownLifterSection d={{ ...base, zeroCodeList: [z], zeroCodeTotal: 1 }} />);
    // B says every reject has a lifter; B2 lists the zero-coded one
    expect(container.textContent).toContain('Every rejected cone in this period carries a lifter number.');
    expect(container.textContent).toContain('Rejects with a zero reason code — meaning not confirmed by IFL');
    expect(container.textContent).toContain('Whether IFL counts such a reject as "unknown" is not confirmed.');
    expect(container.querySelectorAll('table')).toHaveLength(2);
    const b2 = rowsOf(container, 1);
    expect(b2).toHaveLength(1);
    expect(b2[0]).toEqual(['15-08-2026', '4:17:16 AM', 'Night', '27', '2', '2', 'Quality', '0', '0', '—', 'Reason code is zero']);
  });

  it('table B and B2 are two tables when both have rows, B first', () => {
    const b = reject({ lifter: null, winder: null, hanger: 105, tubeCode: 1, materialCode: 11, why: ['No lifter recorded', 'No winder recorded'] });
    const z = reject({ hanger: 27, why: ['Reason code is zero'] });
    const { container } = render(<RejectedUnknownLifterSection d={{ ...base, unknownCount: 1, list: [b], listTotal: 1, zeroCodeList: [z], zeroCodeTotal: 1 }} />);
    expect(container.querySelectorAll('table')).toHaveLength(3);
    expect(rowsOf(container, 1)[0]![3]).toBe('105');
    expect(rowsOf(container, 2)[0]![3]).toBe('27');
    const text = container.textContent ?? '';
    expect(text.indexOf('Rejects with no lifter recorded')).toBeLessThan(text.indexOf('Rejects with a zero reason code'));
  });

  it('B2 with nothing says so in one sentence, and states how many of how many a cut list shows', () => {
    const none = render(<RejectedUnknownLifterSection d={base} />);
    expect(none.container.textContent).toContain('No rejected cone in this period carries a zero reason code.');
    none.unmount();
    const cut = render(<RejectedUnknownLifterSection d={{ ...base, zeroCodeList: [reject()], zeroCodeTotal: 7000 }} />);
    expect(cut.container.textContent).toContain('Showing the first 1 of 7,000.');
  });

  it('B2 is not printed for a period with no cones and no rejects', () => {
    const empty = { ...base, lifters: [], total: lifter(null, { cones: 0, inspected: 0, qualityRejects: 0, weightRejects: 0, total: 0, ratePct: null }) };
    const { container } = render(<RejectedUnknownLifterSection d={empty} />);
    expect(container.textContent).not.toContain('zero reason code —');
  });

  it('block C lists the zeroed-clock records of the period\'s own data batch, whatever the period, and says which batch', () => {
    const z = reject({
      date: '1969-12-31', producedAtUtc: '1970-01-01T00:00:00.000Z', hanger: 270, winder: null, lifter: null,
      why: ['No lifter recorded', 'No winder recorded', 'Reason code is zero', 'Clock zeroed (1970)'],
    });
    const { container } = render(<RejectedUnknownLifterSection d={{ ...base, zeroedClock: { generation: 'September copy - cones', rows: [z] } }} />);
    expect(container.textContent).toContain('Records with a zeroed clock');
    expect(container.textContent).toContain('Shown for September copy - cones, whatever period was chosen.');
    const c = rowsOf(container, 1);
    expect(c[0]![0]).toBe('31-12-1969');
    expect(c[0]![10]).toContain('Clock zeroed (1970)');
  });

  it('block C with a data batch and no zeroed records says so; with no data batch at all it is not shown', () => {
    const none = render(<RejectedUnknownLifterSection d={{ ...base, zeroedClock: { generation: 'July copy - cones', rows: [] } }} />);
    expect(none.container.textContent).toContain('No record with a zeroed clock in this data batch.');
    none.unmount();
    const hidden = render(<RejectedUnknownLifterSection d={base} />);
    expect(hidden.container.textContent).not.toContain('Records with a zeroed clock');
  });

  it('prints the draft definition as assumed until IFL confirms, and the report\'s own note', () => {
    const { container, getAllByRole } = render(<RejectedUnknownLifterSection d={{ ...base, pendingIfl: ['IFL has not defined "unknown (lifter)".'] }} />);
    expect(container.textContent).toContain('Assumed until IFL confirms');
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['IFL has not defined "unknown (lifter)".']);
    expect(container.textContent).toContain('THE DRAFT NOTE');
  });

  it('a period with no cones and no rejects: the empty state and the note, no tables', () => {
    const empty = { ...base, lifters: [], total: lifter(null, { cones: 0, inspected: 0, qualityRejects: 0, weightRejects: 0, total: 0, ratePct: null }) };
    const { container } = render(<RejectedUnknownLifterSection d={empty} />);
    expect(container.textContent).toContain('No cones or rejects were recorded in this period.');
    expect(container.textContent).toContain('THE DRAFT NOTE');
    expect(container.querySelector('table')).toBeNull();
  });

  it('an older or partial payload (no lists, no zeroed block) renders the empty state and does not crash', () => {
    const partial = { period: base.period, filters: {}, lineId: 1, note: 'N', pendingIfl: ['A'], generationNote: base.generationNote } as unknown as RejectedUnknownLifterView;
    const { container } = render(<RejectedUnknownLifterSection d={partial} />);
    expect(container.textContent).toContain('No cones or rejects were recorded in this period.');
    expect(container.textContent).toContain('A');
  });
});
