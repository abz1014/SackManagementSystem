/**
 * C-157 / D-87 (2 Oct 2026): the station sheet printed an undefined spread as
 * "0.0 g" (within-day SD of a single reading) and "0.00 g" (day-to-day sigma
 * over one day). The API now sends null for both; the sheet must show the
 * em dash the rest of the sheet uses for a missing number, not a zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render } from '../testkit/render';
import { installFakeFetch } from '../testkit/fetchRouter';
import { StationSheet } from './StationSheet';
import { W } from '../lib/words';
import type { AdjustmentList, StationRow, WeightStationRow, WeightStationsData } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const META = { serverTimeUtc: '2026-07-25T12:00:00Z', lastSyncUtc: '2026-07-25T12:00:00Z', version: 'test' } as const;

const ONE_DAY: WeightStationRow['days'] = [{ date: '2026-07-20', n: 1, mean: 1950, nelson: [] }];

function row(over: Partial<WeightStationRow> = {}): WeightStationRow {
  return {
    station: 7, n: 1, meanG: 1950, vsLineG: 0, vsTargetG: null, daysHeld: 1, flagged: false, rejectRatePct: null,
    lastAdjustedUtc: null, days: ONE_DAY, medianG: 1950, sdG: null, restartedOn: null, centrelineG: 1950,
    sigmaDayToDay: null, longestRun: 1, projection: null, targetBasis: 'line_product', ...over,
  };
}

async function renderSheet(over: Partial<WeightStationRow>) {
  const data = {
    from: '2026-07-12', to: '2026-07-25', days: 1, lineMeanG: 1950, targetG: null, productId: null, productLabel: null,
    thresholdG: 15, minDaysHeld: 3, lineRejectRatePct: null, stations: [row(over)],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 }, limits: null,
    rules: [], targetEffectiveFromUtc: null, limitsChangedInWindow: null, productChangesInWindow: 0,
  } as unknown as WeightStationsData;
  const adjustments: AdjustmentList = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 7 };
  installFakeFetch({
    '/api/weight-stations': { data, metadata: META },
    '/api/stations': { stations: [{ stationId: 7, name: 'Station 7' } as StationRow] },
    '/api/calibration/adjustments': adjustments,
  });
  const noop = () => {};
  const out = render(
    <StationSheet
      station={7} canAdjust={false} periodTo="2026-07-25" onClose={noop} onSeeReadings={noop}
      onSeeRejects={noop} onSeeCalibrationReport={noop} onSeeShiftReport={noop}
    />,
  );
  for (let i = 0; i < 20 && !out.container.querySelector('dl.kv'); i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  return out;
}

describe('StationSheet — an undefined spread reads as a dash, not a zero', () => {
  it('null sdG renders "—" beside the spread label, never "0.0 g"', async () => {
    const { container } = await renderSheet({});
    const dt = [...container.querySelectorAll('dt')].find((d) => d.textContent === W.calibration.colSd)!;
    const dd = dt.nextElementSibling!;
    expect(dd.textContent).toContain('—');
    expect(dd.textContent).not.toContain('0.0 g');
  });

  it('null sigmaDayToDay renders "—" in the centreline sentence, never "0.00 g"', async () => {
    const { container } = await renderSheet({});
    expect(container.textContent).toContain('day-to-day sigma —');
    expect(container.textContent).not.toContain('0.00 g');
  });

  it('a real spread still prints its number', async () => {
    const { container } = await renderSheet({ sdG: 8.1, sigmaDayToDay: 4.2 });
    expect(container.textContent).toContain('8.1 g');
    expect(container.textContent).toContain('day-to-day sigma 4.20 g');
  });
});
