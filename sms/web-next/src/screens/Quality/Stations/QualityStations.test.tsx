/**
 * Quality > Stations (task E5), on the real figures of design/redesign-2026-10/mockup-data.json.
 * TRACE rows verified here:
 *   A1-062 / A3-037 / B5-06  the ONE station table (state, cones, failed inspection, failed weight check, mean vs target)
 *   A2-011                   GET /api/weight-stations feeds the pattern columns
 *   A2-083 / G-18 / B5-25    state Act/Watch/No data arrives decided (never computed in the view) and is explained as assumed
 *   B5-03                    the pattern check is its own boxed group: always the last 14 production days
 *   B4-04 / X-1              a station that ran several products shows the short marker, the full sentence once
 *   A6-S1                    a row opens the station sheet (sheet=station:N); the Quality tab strip is present
 *   (failure naming rule)    a failed part is named; the parts that did load keep their figures
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LiveProvider } from '../../../../../web/src/lib/live';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch } from '../../../../../web/src/testkit/fetchRouter';
import { parseRoute } from '../../../route';
import type { ScreenProps } from '../../registry';
import { QualityStationsScreen } from './QualityStations';
import { URLS, routes, stationStatus, weightStations, type PeriodId } from './testkit/pd1';

installDomStubs();

const USER = { username: 'u', displayName: 'U', role: 'viewer' } as never;

type GoMock = ReturnType<typeof vi.fn<ScreenProps['go']>>;

function mount(id: PeriodId, over = {}, go: GoMock = vi.fn<ScreenProps['go']>()) {
  window.history.replaceState(null, '', URLS[id]);
  const route = parseRoute(new URLSearchParams(window.location.search));
  installFakeFetch(routes(id, over));
  const utils = render(
    <LiveProvider asOf={null}>
      <QualityStationsScreen route={route} rank={1} user={USER} go={go} />
    </LiveProvider>,
  );
  return { ...utils, go, route };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const rowsOf = (c: HTMLElement) => Array.from(c.querySelectorAll('tbody tr[data-station]')) as HTMLElement[];
const order = (c: HTMLElement) => rowsOf(c).map((r) => Number(r.getAttribute('data-station')));

describe('Quality > Stations on PD1 (1 Sep 2026)', () => {
  it('lists all 14 stations worst first with station 8 as Act at 53.9 %', async () => {
    const { container } = mount('pd1');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    expect(order(container)).toEqual([8, 9, 10, 14, 13, 2, 1, 3, 4, 5, 6, 7, 11, 12]);
    const first = rowsOf(container)[0]!;
    expect(first.textContent).toContain('Station 8');
    expect(within(first).getByText('Act')).toBeTruthy();
    expect(first.textContent).toMatch(/53\.9\s?%/);
    expect(first.textContent).toContain('223 cones');
    expect(first.textContent).toContain('412');
    expect(within(rowsOf(container)[1]!).getByText('Watch')).toBeTruthy();
    expect(within(rowsOf(container)[13]!).getAllByText('No data').length).toBeGreaterThan(0);
  });

  it('states the verdict in one sentence from the server-decided states', async () => {
    mount('pd1');
    await screen.findByText('1 station needs action.');
    expect(screen.getByText(/more than twice the line's 14\.57 %/)).toBeTruthy();
  });

  it('splits the table: "This period" columns, then a boxed pattern check that is always the last 14 days', async () => {
    const { container } = mount('pd1');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    const groups = Array.from(container.querySelectorAll('thead tr.qs-group th'));
    expect(groups[0]!.textContent).toMatch(/This period/);
    expect(groups[0]!.getAttribute('colspan')).toBe('6');
    const box = groups[1]!;
    expect(box.textContent).toMatch(/Pattern check/);
    expect(box.textContent).toMatch(/always the last 14 production days/);
    expect(box.getAttribute('title')).toMatch(/19 Aug 2026 . 1 Sep 2026/);
    expect(box.getAttribute('colspan')).toBe('2');
    const heads = Array.from(container.querySelectorAll('thead tr:nth-child(2) th')).map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Days with a note', 'Result', 'Failed inspection or weight check', 'Failed weight check (scale)']));
    // the two boxed headers carry the box class, the period headers do not
    const boxed = Array.from(container.querySelectorAll('thead tr:nth-child(2) th.qs-pat')).map((h) => h.textContent);
    expect(boxed).toEqual(['Days with a note', 'Result']);
  });

  it('days with a note and the result come from the 14-day check (station 14 has 6 days with a note)', async () => {
    const { container } = mount('pd1');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    const r14 = container.querySelector('tr[data-station="14"]')!;
    const cells = r14.querySelectorAll('td');
    expect(cells[6]!.textContent).toBe('6');
    expect(cells[7]!.textContent).toBe('Nothing flagged');
    const r13 = container.querySelector('tr[data-station="13"]')!;
    expect(r13.querySelectorAll('td')[6]!.textContent).toBe('2');
  });

  it('a station with no cones is No data, never OK, and its weight columns say No data', async () => {
    const { container } = mount('pd1');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    const r6 = container.querySelector('tr[data-station="6"]')!;
    expect(within(r6 as HTMLElement).getAllByText('No data').length).toBeGreaterThanOrEqual(3);
    expect(within(r6 as HTMLElement).queryByText('OK')).toBeNull();
  });

  it('the thresholds are explained and marked as assumed (from copy.ts RESERVED, not written here)', async () => {
    mount('pd1');
    await screen.findByText('How states are decided');
    fireEvent.click(screen.getByText('How states are decided'));
    expect(screen.getByText(/more than 2 times the line's rate \(over 29\.1 %/)).toBeTruthy();
    expect(screen.getByText(/Assumed until IFL confirms/)).toBeTruthy();
    expect(screen.getByText(/always look at the last 14 production days/)).toBeTruthy();
  });

  it('a row opens the station sheet by pushing sheet=station:N', async () => {
    const { container, go, route } = mount('pd1');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    fireEvent.click(rowsOf(container)[0]!);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]![0]).toMatchObject({ ...route, sheet: { kind: 'station', id: '8' } });
    go.mockClear();
    fireEvent.keyDown(rowsOf(container)[1]!, { key: 'Enter' });
    expect(go.mock.calls[0]![0].sheet).toEqual({ kind: 'station', id: '9' });
  });

  it('shows the Quality tab strip with Stations selected, and a tab change keeps the period keys', async () => {
    const { go } = mount('pd1');
    const tab = await screen.findByRole('tab', { name: 'Stations' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Rejects' }));
    expect(go.mock.calls[0]![0]).toMatchObject({ s: 'quality', t: 'rejects', sheet: null });
    expect(go.mock.calls[0]![0].keys.p).toBe('pick');
  });
});

describe('failed parts are named; the parts that loaded keep their figures', () => {
  it('a failed per-station count names itself and leaves state and cones standing', async () => {
    const { container } = mount('pd1', { '/api/production': new Response('{}', { status: 500 }) });
    await screen.findByText(/Couldn't load the per-station counts/);
    const r8 = container.querySelector('tr[data-station="8"]')!;
    expect(r8.textContent).toContain('Act');
    expect(r8.textContent).toMatch(/53\.9\s?%/);
    // the weight-check column shows a dash, not a zero
    expect(r8.querySelectorAll('td')[4]!.textContent).toBe('–');
  });

  it('a failed 14-day check names itself and the period columns stay', async () => {
    const { container } = mount('pd1', { '/api/weight-stations': new Response('{}', { status: 500 }) });
    await screen.findByText(/Couldn't load the 14-day pattern check/);
    const r8 = container.querySelector('tr[data-station="8"]')!;
    expect(r8.textContent).toMatch(/53\.9\s?%/);
    expect(r8.querySelectorAll('td')[6]!.textContent).toBe('–');
    expect(r8.querySelectorAll('td')[7]!.textContent).toBe('–');
  });

  it('a failed station list is an error with a retry, not an empty table', async () => {
    mount('pd1', { '/api/station-status': new Response('{}', { status: 500 }) });
    await screen.findByText(/Couldn't load the station list/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('No data')).toBeNull();
  });
});

describe('Quality > Stations on PL (5 Aug to 7 Sep 2026)', () => {
  it('lists 14 stations; station 8 is Act at 14.5 % and the Act station set matches the mockup', async () => {
    const { container } = mount('pl');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    expect(order(container).slice(0, 3)).toEqual([8, 14, 10]);
    const first = rowsOf(container)[0]!;
    expect(first.textContent).toMatch(/14\.5\s?%/);
    expect(first.textContent).toContain('874 cones');
    expect(first.textContent).toContain('6,010');
    expect(first.textContent).toContain('−9.9 g');
    await screen.findByText('3 stations need action.');
    expect(screen.getByText(/more than twice the line's 4\.59 %/)).toBeTruthy();
  });

  it('X-1: a station that ran several products shows the short marker and the full sentence is printed once', async () => {
    const { container } = mount('pl');
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    const r14 = container.querySelector('tr[data-station="14"]')!;
    expect(r14.querySelectorAll('td')[5]!.textContent).toMatch(/products/);
    expect(screen.getAllByText(/no single target applies, because more than one product ran/i)).toHaveLength(1);
  });

  it('stations 6 and 7 missing from the weight feed still show their cones, with No data in the pattern columns and a note', async () => {
    const { container } = mount('pl', { '/api/weight-stations': weightStations('pl', [6, 7]) });
    await waitFor(() => expect(rowsOf(container)).toHaveLength(14));
    const r7 = container.querySelector('tr[data-station="7"]')!;
    expect(r7.querySelectorAll('td')[2]!.textContent).toBe('5,136');
    expect(r7.querySelectorAll('td')[6]!.textContent).toBe('No data');
    expect(r7.querySelectorAll('td')[7]!.textContent).toBe('No data');
    expect(r7.querySelectorAll('td')[5]!.textContent).toBe('No data');
    await screen.findByText(/Stations 6 and 7 did not appear in the weight-by-station feed/);
  });

  it('stationStatus fixture stays consistent with the documented rule', () => {
    const s = stationStatus('pl').data.stations as Array<{ station: number; state: string }>;
    expect(s.filter((x) => x.state === 'act').map((x) => x.station).sort((a, b) => a - b)).toEqual([8, 10, 14]);
  });
});

describe('phone (under 768 px): one card per station, the pattern check still a boxed group of its own', () => {
  it('lists cards, opens a station from a card, and shows the boxed pattern group after "Show all"', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    );
    const { container, go } = mount('pd1');
    const list = await screen.findByRole('list', { name: 'Stations, worst first' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(14));
    const first = within(list).getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('Station 8');
    expect(first.textContent).toMatch(/53\.9\s?%/);
    expect(container.querySelector('.qs-pat-card')).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'Show all' }));
    const box = container.querySelector('.qs-pat-card') as HTMLElement;
    expect(box.textContent).toMatch(/Pattern check, last 14 days/);
    expect(box.textContent).toMatch(/Days with a note/);
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(first);
    expect(go.mock.calls[0]![0].sheet).toEqual({ kind: 'station', id: '8' });
    vi.restoreAllMocks();
  });
});
