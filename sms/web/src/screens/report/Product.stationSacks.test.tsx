/**
 * C-005 (owner option A, 7 Oct 2026; DEFECTS.md D-181): a Product report narrowed to one winder
 * must not print a Sacks column (sacks carry no winder); it prints the server's one-sentence
 * reason once. Without the flag the Sacks column stays. jsdom, no session needed: ProductSection
 * is a pure component of its payload. Rows are the measured 11 Aug 2026 evening, station 4 figures.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProductSection } from './Product';
import type { ProductReportData } from '../../api';

const NOTE = 'Sacks are not shown: the sack scale records no winder, so sack figures cannot be narrowed to station 4.';

const base = (group: string, id: number, cones: number, rej: number) => ({
  group, cones, rejectedCones: rej, rejectRatePct: 2, conesInRangePct: 98, sacks: null, sackWeightKg: null, avgSackKg: null, conesPerSack: null,
  productId: id, productLabel: `Product ${id}`, weight: { n: cones, avgG: 1951, sdG: 12, minG: 1920, maxG: 1985 },
  states: { within: cones, low: 0, high: 0, rejected: 0, unknown: 0 }, implausible: 0, target: null, vsTargetG: null,
});

const OMITTED = {
  period: { period: 'custom', from: '2026-08-11', to: '2026-08-11' },
  filters: { shift: 'evening', station: 4 },
  rows: [base('21', 21, 44, 1), base('1021', 1021, 69, 3)],
  unattributed: { cones: 0, rejects: 0, sacks: null, ofCones: 113, ofRejects: 4, ofSacks: null },
  note: 'Each reading is grouped by the product recorded on it by the plant.',
  sacksOmitted: true,
  sackNote: NOTE,
} as unknown as ProductReportData;

const WITH_SACKS = {
  ...OMITTED,
  filters: { shift: 'evening' },
  rows: [{ ...base('21', 21, 1103, 14), sacks: 43, sackWeightKg: 2025.9, avgSackKg: 47.1, conesPerSack: 25.7 }],
  unattributed: { cones: 0, rejects: 0, sacks: 0, ofCones: 1103, ofRejects: 14, ofSacks: 43 },
  sacksOmitted: undefined,
  sackNote: undefined,
} as unknown as ProductReportData;

describe('C-005: Product section under a station filter', () => {
  it('has no Sacks column and shows the reason exactly once', () => {
    const { container, getAllByRole } = render(<ProductSection d={OMITTED} products={[]} />);
    const heads = getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(heads).not.toContain('Sacks');
    const text = container.textContent ?? '';
    expect(text.split(NOTE).length - 1).toBe(1);
    expect(text).toContain('Product 21');
    expect(text).toContain('Product 1021');
  });

  it('control: without the flag the Sacks column and its figure are there and no reason is printed', () => {
    const { container, getAllByRole } = render(<ProductSection d={WITH_SACKS} products={[]} />);
    expect(getAllByRole('columnheader').map((h) => h.textContent?.trim())).toContain('Sacks');
    expect(container.textContent ?? '').not.toContain('sack scale records no winder');
  });
});
