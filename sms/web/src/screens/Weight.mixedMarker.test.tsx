/**
 * S3 X-1 (Stage 3, 9 Oct 2026). User impact: a station that ran two products used to print a whole sentence in the
 * narrow vs-target column; it now prints a short "2 products" marker there and the full sentence once, under the table.
 * Layout is measured by layout-tests/s3-x1-weight-mixed-row-height.spec.ts; this file pins the words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { render } from '../testkit/render';
import { META_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { Envelope, ProductionData, WeightStationRow, WeightStationsData } from '../api';
import { WeightScreen } from './Weight';

afterEach(() => { vi.unstubAllGlobals(); });

const PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
};
function noop(): void {}
const props = {
  period: PERIOD, mode: 'time' as const, onModeChange: noop, chartType: 'cone' as const, onChartTypeChange: noop,
  chartStation: null, onChartStationChange: noop, onOpenStation: noop, onSeeOutside: noop,
};

function row(station: number, mixed: boolean): WeightStationRow {
  return {
    station, n: 812, meanG: 1949, vsLineG: 1, vsTargetG: mixed ? null : -1, daysHeld: 0, flagged: false, rejectRatePct: 2.0,
    lastAdjustedUtc: null, days: [], medianG: 1949, sdG: 3.2, restartedOn: null, centrelineG: 1949, sigmaDayToDay: 1.1,
    longestRun: 5, projection: null, targetBasis: mixed ? 'mixed' : 'station_material', ...(mixed ? { materialsInWindow: 2 } : {}),
  };
}
function stationsEnvelope(rows: WeightStationRow[]): Envelope<WeightStationsData> {
  return {
    data: {
      from: '2026-08-24', to: '2026-09-07', days: 14, lineMeanG: 1948, targetG: 1950, productId: 231, productLabel: '201-IH0-SD',
      thresholdG: 5, minDaysHeld: 3, lineRejectRatePct: 2.1, stations: rows,
      disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
      limits: { loG: 1900, hiG: 2000 }, rules: [], targetEffectiveFromUtc: '2026-09-01T00:00:00Z', limitsChangedInWindow: 0,
      productChangesInWindow: 0,
    },
    metadata: META_FIXTURE,
  };
}
const PRODUCTION: Envelope<ProductionData> = {
  data: { groupBy: 'none', rows: [{ group: 'line', cones: 500, rejectedCones: 10, sacks: 20, sackWeightKg: 550, conesInRangePct: 98 }], states: null, implausible: 0, unattributed: null },
  metadata: META_FIXTURE,
};
function install(rows: WeightStationRow[]) {
  installFakeFetch({
    '/api/weight-stations': stationsEnvelope(rows),
    '/api/stations': { stations: [] },
    '/api/production': PRODUCTION,
    '/api/spc': () => { throw new Error('not needed here'); },
  });
}

describe('Weight station table - the mixed-product marker', () => {
  it('prints "2 products" in the vs-target cell and the full sentence once, below the table', async () => {
    install([row(1, true), row(2, false), row(3, true)]);
    const { container } = render(<WeightScreen {...props} />);
    await waitFor(() => expect(container.querySelector('table.station-tbl')).not.toBeNull());
    const cells = Array.from(container.querySelectorAll('table.station-tbl tbody tr')).map((tr) => tr.children[4]!.textContent);
    // A non-breaking space keeps the marker on one line in the narrow column.
    expect(cells[0]).toBe('2\u00A0products');
    expect(cells[2]).toBe('2\u00A0products');
    expect(cells[1]).not.toContain('products');
    const text = container.textContent ?? '';
    expect(text.split('no single target applies').length - 1).toBe(1);
    const table = container.querySelector('table.station-tbl')!;
    const note = Array.from(container.querySelectorAll('p')).find((p) => (p.textContent ?? '').includes('no single target applies'))!;
    expect(note).toBeTruthy();
    expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prints no footnote when no station is mixed', async () => {
    install([row(1, false), row(2, false)]);
    const { container } = render(<WeightScreen {...props} />);
    await waitFor(() => expect(container.querySelector('table.station-tbl')).not.toBeNull());
    expect((container.textContent ?? '').toLowerCase()).not.toContain('no single target applies');
    expect(container.textContent ?? '').not.toContain(' products');
  });
});
