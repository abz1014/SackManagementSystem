/**
 * Station sheet (task E5, G-4 "mapped, decided E-8"), on the real figures of
 * design/redesign-2026-10/mockup-data.json.
 * TRACE rows verified here:
 *   A6-S1   sheet=station:N opens from the URL as an overlay (dialog, Escape/close hands back to the caller)
 *   A3-059  drift, daily means, adjustments ledger, days-to-limit, 4 hops, Nelson details all present
 *   A1-062  weight-stations feeds the pattern block (14 days, whatever the period)
 *   A1-077 / A2-027   the ledger reads GET /api/calibration/adjustments
 *   A1-078 / A2-028 / A4-12   record an adjustment: rank 2, no optimistic UI, failed save named
 *   A6-H01 / H02 / H03 / H07  the four hops carry the station and the period, drop the screen's own keys, close the sheet
 *   A3-035 / RT-020   days-to-limit with its 90% range, or "drift not established", wording from words.ts via the bridge
 *   B5-05   no grams to adjust by
 *   B5-03   the pattern block is labelled as always the last 14 production days
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveProvider } from '../../../../web/src/lib/live';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../../../web/src/testkit/fetchRouter';
import { parseRoute } from '../../route';
import type { ScreenProps } from '../../screens/registry';
import { StationSheet } from './StationSheet';
import { adjustmentIndex } from './DailyChart';
import { hopRoute } from './hops';
import { META, URLS, routes, weightStations, type PeriodId } from '../../screens/Quality/Stations/testkit/pd1';

installDomStubs();
// The sheet resolves the plant clock first, then eight fetches: slower than the 1 s default under load.
configure({ asyncUtilTimeout: 4000 });

const USER = { username: 'u', displayName: 'U', role: 'engineer' } as never;
type GoMock = ReturnType<typeof vi.fn<ScreenProps['go']>>;

function mount(id: PeriodId, station: number, opts: { rank?: number; over?: Routes; extra?: string; go?: GoMock } = {}) {
  window.history.replaceState(null, '', `${URLS[id]}&sheet=station:${station}${opts.extra ?? ''}`);
  const route = parseRoute(new URLSearchParams(window.location.search));
  const fake = installFakeFetch(routes(id, opts.over));
  const go: GoMock = opts.go ?? vi.fn<ScreenProps['go']>();
  const onClose = vi.fn();
  const utils = render(
    <LiveProvider asOf={null}>
      <StationSheet route={route} rank={opts.rank ?? 1} user={USER} go={go} onClose={onClose} />
    </LiveProvider>,
  );
  return { ...utils, go, onClose, route, fake };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const dlg = () => screen;

describe('station sheet opens from the URL (PD1, station 8)', () => {
  it('names the station, shows its decided state and the four period figures', async () => {
    mount('pd1', 8);
    await dlg().findByText('Act');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Station 8');
    await waitFor(() => expect(dlg().getByText('223 of 412 cones')).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).toMatch(/53\.9\s?%/);
    expect(dlg().getByText('Failed weight check (scale)')).toBeTruthy();
    expect(dlg().getByText('0.0 %')).toBeTruthy();
    expect(dlg().getByText('−4.6 g')).toBeTruthy();
    expect(dlg().getByText('Cones weighed')).toBeTruthy();
  });

  it('Escape and the close button hand control back to the caller', async () => {
    const { onClose } = mount('pd1', 8);
    await dlg().findByText('Act');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the pattern block as its own box that always reads 14 days, with the chart and a steady verdict', async () => {
    mount('pd1', 8);
    const box = await dlg().findByRole('heading', { name: 'Pattern check' });
    expect(box.closest('section')!.className).toContain('ss-box');
    expect(dlg().getByText(/Always the last 14 production days, whatever period is chosen/)).toBeTruthy();
    await dlg().findByText('Steady.');
    expect(dlg().getByText('Cone weight by day')).toBeTruthy();
    expect(dlg().getByText('The pattern test did not fire on any day in the window.')).toBeTruthy();
  });

  it('never advises an adjustment in grams (NO OVER-CLAIMING)', async () => {
    mount('pd1', 14);
    await dlg().findByText(/Pattern check/);
    await waitFor(() => expect(dlg().getByText('Days the pattern test fired')).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).not.toMatch(/reduce|increase|adjust (it )?by/i);
  });

  it('lists the top reasons for the whole line and says they are not split by station', async () => {
    mount('pd1', 8);
    await dlg().findByText('Tube 2 · Mat 1');
    expect(dlg().getByText('97.6 %')).toBeTruthy();
    expect(dlg().getByText('whole line, not split by station yet')).toBeTruthy();
  });

  it('shows the product the target is judged against, the last reading, and that a winder’s product is known only from its cones', async () => {
    mount('pd1', 8);
    await dlg().findByText('Judged against');
    expect(dlg().getByText('Last reading')).toBeTruthy();
    expect(dlg().getByText(/known only from the cones it weighed/)).toBeTruthy();
  });

  it('an unknown station number is a plain not-found, not a blank sheet', async () => {
    mount('pd1', 99);
    await dlg().findByText(/no readings in the window this sheet looks at/);
  });
});

describe('failed parts are named; the rest of the sheet keeps its figures', () => {
  it('a failed reasons fetch names itself and the KPIs stay', async () => {
    mount('pd1', 8, { over: { '/api/rejects': new Response('{}', { status: 500 }) } });
    await dlg().findByText(/Couldn't load the reject reasons/);
    expect(screen.getByRole('dialog').textContent).toMatch(/53\.9\s?%/);
  });

  it('a failed 14-day check names itself and the period figures stay', async () => {
    mount('pd1', 8, { over: { '/api/weight-stations': new Response('{}', { status: 500 }) } });
    await dlg().findByText(/Couldn't load the 14-day pattern check/);
    expect(screen.getByRole('dialog').textContent).toMatch(/53\.9\s?%/);
  });

  it('a failed per-station count names itself and does not print a zero', async () => {
    mount('pd1', 8, { over: { '/api/production': new Response('{}', { status: 500 }) } });
    await dlg().findByText(/Couldn't load this station.s counts/);
    expect(dlg().queryByText('223 of 412 cones')).toBeNull();
  });

  it('a failed station state is named and nothing is claimed about the state', async () => {
    mount('pd1', 8, { over: { '/api/station-status': new Response('{}', { status: 500 }) } });
    await dlg().findByText(/Couldn't load the station state/);
    expect(dlg().queryByText('Act')).toBeNull();
    expect(dlg().queryByText('OK')).toBeNull();
  });

  it('a failed adjustment log is named', async () => {
    mount('pd1', 8, { over: { '/api/calibration/adjustments': new Response('{}', { status: 500 }) } });
    await dlg().findByText(/Couldn't load the adjustment log/);
  });
});

describe('the four hops (A6-H01, H02, H03, H07)', () => {
  it('are all present as real links', async () => {
    mount('pd1', 8);
    await dlg().findByText('Act');
    const hrefs = Array.from(screen.getByRole('dialog').querySelectorAll<HTMLAnchorElement>('a[data-hop]')).map((a) => [a.dataset.hop, a.getAttribute('href')]);
    expect(hrefs.map((h) => h[0])).toEqual(['register', 'rejects', 'calibration', 'machine-product']);
    expect(hrefs[0]![1]).toMatch(/s=quality&t=register.*st=8/);
    expect(hrefs[1]![1]).toMatch(/s=quality&t=rejects.*st=8/);
    expect(hrefs[2]![1]).toMatch(/s=reports/);
    expect(hrefs[2]![1]).toContain('rt=calibration');
    expect(hrefs[2]![1]).toContain('st=8');
    expect(hrefs[3]![1]).toMatch(/s=reports/);
    expect(hrefs[3]![1]).toContain('rt=machine-product');
    expect(hrefs[3]![1]).toContain('st=8');
    for (const [, h] of hrefs) {
      expect(h).toContain('p=pick');
      expect(h).not.toContain('sheet=');
    }
  });

  it('a click carries the station and the period, drops the page of the screen being left, and closes the sheet', async () => {
    const { go } = mount('pd1', 8, { extra: '&rp=3&rl=sacks&jc=2' });
    await dlg().findByText('Act');
    fireEvent.click(dlg().getByText(/Open in Register/));
    const next = go.mock.calls[0]![0];
    expect(next).toMatchObject({ s: 'quality', t: 'register', sheet: null });
    expect(next.keys).toMatchObject({ st: '8', p: 'pick', from: '2026-09-01', to: '2026-09-01' });
    expect(next.keys.rp).toBeUndefined();
    expect(next.keys.rl).toBeUndefined();
    expect(next.keys.jc).toBeUndefined();
    go.mockClear();
    fireEvent.click(dlg().getByText('Rejects at this station'));
    expect(go.mock.calls[0]![0]).toMatchObject({ s: 'quality', t: 'rejects', sheet: null, keys: { st: '8' } });
    go.mockClear();
    fireEvent.click(dlg().getByText('Calibration report'));
    expect(go.mock.calls[0]![0]).toMatchObject({ s: 'reports', t: null, sheet: null, keys: { st: '8', rt: 'calibration' } });
    go.mockClear();
    fireEvent.click(dlg().getByText('Product by station report'));
    expect(go.mock.calls[0]![0]).toMatchObject({ s: 'reports', t: null, sheet: null, keys: { st: '8', rt: 'machine-product' } });
  });

  it('hopRoute is pure and keeps unrelated keys', () => {
    const r = parseRoute(new URLSearchParams('s=quality&t=stations&sheet=station:3&p=today&wm=dist'));
    const h = hopRoute(r, 'register', 3);
    expect(h.keys).toEqual({ p: 'today', wm: 'dist', st: '3' });
    expect(h.sheet).toBeNull();
  });
});

describe('record an adjustment (rank 2, no optimistic UI)', () => {
  it('is absent at rank 1', async () => {
    mount('pd1', 8, { rank: 1 });
    await dlg().findByText('Act');
    expect(dlg().queryByRole('button', { name: 'Log an adjustment' })).toBeNull();
    expect(dlg().queryByText('Record an adjustment')).toBeNull();
  });

  it('is present at rank 2 and opens a form', async () => {
    mount('pd1', 8, { rank: 2 });
    const btn = await dlg().findByRole('button', { name: 'Log an adjustment' });
    fireEvent.click(btn);
    expect(dlg().getByLabelText(/Amount \(grams, signed\)/)).toBeTruthy();
    expect(dlg().getByLabelText(/Adjusted at \(plant time\)/)).toBeTruthy();
    expect(dlg().getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('posts the entry, shows nothing until the server accepted it, then reads the ledger again', async () => {
    const ledger: Array<Record<string, unknown>> = [];
    let release: (() => void) | null = null;
    const posts: unknown[] = [];
    const over: Routes = {
      '/api/calibration/adjustments': async ({ init }: { init?: RequestInit }) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          await new Promise<void>((res) => {
            release = res;
          });
          ledger.push({
            adjustmentId: 1, adjustedAtUtc: '2026-09-01T10:00:00Z', adjustedAtPlant: '2026-09-01T15:00:00Z', stationId: 8,
            amountG: -2.5, beforeG: null, afterG: null, referenceG: null, productId: null, productLabel: null,
            reason: 'Scale drift check', note: null, recordedBy: 'u',
          });
          return { adjustmentId: 1, adjustments: ledger, plantOffsetMinutes: 300, from: null, to: null, station: 8 };
        }
        return { adjustments: ledger, plantOffsetMinutes: 300, from: null, to: null, station: 8 };
      },
    };
    const { fake } = mount('pd1', 8, { rank: 2, over });
    fireEvent.click(await dlg().findByRole('button', { name: 'Log an adjustment' }));
    fireEvent.change(dlg().getByLabelText(/Amount \(grams, signed\)/), { target: { value: '-2.5' } });
    fireEvent.change(dlg().getByLabelText(/^Why/), { target: { value: 'Scale drift check' } });
    const reads = () => fake.requests.filter((r) => r.startsWith('/api/calibration/adjustments')).length;
    const before = reads();
    fireEvent.click(dlg().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ stationId: 8, amountG: -2.5, reason: 'Scale drift check' });
    // pending: the entry is NOT in the log, the button is busy
    expect(dlg().queryByText('Scale drift check', { selector: 'td' })).toBeNull();
    expect((dlg().getByRole('button', { name: 'Saving' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      release!();
    });
    await waitFor(() => expect(dlg().getByText(/Scale drift check/, { selector: 'td' })).toBeTruthy());
    expect(reads()).toBeGreaterThan(before + 1);
    expect(dlg().queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a failed save is named, nothing is recorded, and what was typed stays', async () => {
    const over: Routes = {
      '/api/calibration/adjustments': ({ init }: { init?: RequestInit }) =>
        init?.method === 'POST' ? new Response('{}', { status: 500 }) : { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 8 },
    };
    mount('pd1', 8, { rank: 2, over });
    fireEvent.click(await dlg().findByRole('button', { name: 'Log an adjustment' }));
    fireEvent.change(dlg().getByLabelText(/Amount \(grams, signed\)/), { target: { value: '1.5' } });
    fireEvent.click(dlg().getByRole('button', { name: 'Save' }));
    await dlg().findByText(/Couldn't save the adjustment. Nothing was recorded/);
    expect((dlg().getByLabelText(/Amount \(grams, signed\)/) as HTMLInputElement).value).toBe('1.5');
  });
});

describe('days to limit and the ledger', () => {
  const flagged = (projection: unknown) => {
    const ws = weightStations('pd1');
    const row = ws.data.stations.find((s: { station: number }) => s.station === 14);
    Object.assign(row, { flagged: true, vsLineG: 9, daysHeld: 4, longestRun: 14, projection });
    return { '/api/weight-stations': ws };
  };
  const base = {
    slopeGPerDay: 0.8, overDays: 5, towards: 'upper', limitG: 2000, distanceG: 40, confidence: 0.9, nPoints: 5, assumption: 'linear_over_run',
  };

  it('prints the 90% range of days to the limit (RT-020), with the assumption beside it', async () => {
    mount('pd1', 14, { over: flagged({ ...base, daysToLimit: 12, daysLow: 8, daysHigh: 20, status: 'established' }) });
    const p = await dlg().findByTestId('projection');
    expect(p.textContent).toMatch(/about 8–20 days \(90% range\)/);
    expect(p.textContent).toMatch(/A projection from recent readings/);
    expect(dlg().getByText(/Has read about 9 g heavier than the line for 4 days/)).toBeTruthy();
  });

  it('says "drift not established" instead of a day count when the range includes zero', async () => {
    mount('pd1', 14, {
      over: flagged({ ...base, daysToLimit: null, daysLow: null, daysHigh: null, status: 'not_established', reason: 'The 90% range on the slope includes zero.' }),
    });
    const p = await dlg().findByTestId('projection');
    expect(p.textContent).toMatch(/Drift not established from 5 days/);
    expect(p.textContent).not.toMatch(/in about \d+/);
  });

  it('draws the days before the newest adjustment as their own series and lists the entry in the ledger', async () => {
    const adj = {
      adjustmentId: 7, adjustedAtUtc: '2026-08-27T05:00:00Z', adjustedAtPlant: '2026-08-27T10:00:00Z', stationId: null,
      amountG: 3, beforeG: 1950, afterG: 1953, referenceG: 1952, productId: null, productLabel: 'Blue', reason: 'Monthly check', note: 'with engineer', recordedBy: 'ahmed',
    };
    mount('pd1', 14, { over: { '/api/calibration/adjustments': { adjustments: [adj], plantOffsetMinutes: 300, from: null, to: null, station: 14 } } });
    // the legend and the direct label at the line's end both name the series
    expect((await dlg().findAllByText('Since the last adjustment')).length).toBeGreaterThanOrEqual(1);
    expect(dlg().getAllByText('Before the last adjustment').length).toBeGreaterThanOrEqual(1);
    expect(dlg().getByText('Monthly check', { exact: false, selector: 'td' })).toBeTruthy();
    expect(dlg().getByText('whole line', { exact: false, selector: '.ss-mut' })).toBeTruthy();
    expect(dlg().getByText("A logged adjustment restarts that station's pattern from that moment.")).toBeTruthy();
    expect(dlg().getByText('+3.0 g')).toBeTruthy();
  });

  it('adjustmentIndex places the newest adjustment on the production day whose end is at or after it (two clocks)', () => {
    const days = [
      { date: '2026-08-26', n: 1, mean: 1, nelson: [] },
      { date: '2026-08-27', n: 1, mean: 1, nelson: [] },
      { date: '2026-08-28', n: 1, mean: 1, nelson: [] },
    ];
    // 21:00 UTC on the 27th is 02:00 plant time on the 28th: the old string comparison put the tick on the 27th.
    expect(adjustmentIndex(days, ['2026-08-27T21:00:00Z'], 300)).toBe(2);
    expect(adjustmentIndex(days, [], 300)).toBe(-1);
  });

  it('keeps the Nelson explanation behind a disclosure', async () => {
    mount('pd1', 14);
    const sum = await dlg().findByText('How this is calculated');
    fireEvent.click(sum);
    expect(dlg().getByText(/Flagged when the station has held one side of the line/)).toBeTruthy();
  });
});

void META;
