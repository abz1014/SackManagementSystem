/**
 * Quality > Rejects and the reason sheet (task E7). TRACE rows verified here:
 *   A3-039 (headline with denominators, two named verdicts, trend with episodes), A3-040 (Pareto, Name it at rank 2
 *   and absent below, jc filter), A3-041 (reason x day matrix, capped), A3-042 (st and pr filters, shared keys),
 *   A3-043 + A6-H10 + A6-H11 + G-9 (the "See the cones" and "By station" hops carry state),
 *   A3-057 + A6-S5 (reason sheet: per-day table, Name it, hops to Register day, Reports day, reject sheet),
 *   A1-038 (range clips the trend window), A1-040 + A4-13 (Name it write), A1-063..A1-067 and A2-018, A2-022, A2-073,
 *   A2-074 (the reads, with the filters on the wire).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import { live, pareto } from '../../../bridge/lib';
import { parseRoute } from '../../../route';
import { QualityRejectsScreen } from './QualityRejects';
import { ReasonSheet } from '../../../sheets/ReasonSheet/ReasonSheet';
import { NameIt } from '../../../sheets/ReasonSheet/NameIt';
import { inspectionReasons, paretoRows, vitalCount, parseReasonId, reasonIdOf } from './model';

installDomStubs();

const META = LIVE_FIXTURE.metadata;
const env = (data: unknown) => ({ data, metadata: META });
const ME = { username: 'test-user', displayName: 'Test User', role: 'engineer' } as const;

/* The September period, shaped like design/redesign-2026-10/mockup-data.json (pl): 15 inspection codes, 1 weight row. */
const CODES: Array<[number, number, number, number]> = [
  [11, 2, 1, 4240], [10, 1, 11, 1036], [5, 10, 1, 314], [2, 1, 1, 187], [8, 1, 2, 115],
  [9, 9, 1, 73], [1, 2, 2, 31], [7, 5, 1, 23], [17, 2, 11, 13], [18, 2, 0, 4],
];
const reasonRow = ([id, tube, mat, count]: (typeof CODES)[number]) => ({
  rejectCodeId: id, rejectType: 'quality', tubeCode: tube, materialCode: mat, label: null,
  displayLabel: `Tube ${tube} · Mat ${mat}`, count, pct: 0, cumulativePct: 0,
});
const REASONS = {
  total: 6089,
  reasons: [
    ...CODES.slice(0, 6).map(reasonRow),
    { rejectCodeId: 12, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'Weight out of range', count: 41, pct: 0.7, cumulativePct: 98.6 },
    ...CODES.slice(6).map(reasonRow),
  ],
  unattributed: null,
};
const DAYS = ['2026-09-05', '2026-09-06', '2026-09-07'];
const BY_DAY = {
  dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 3, total: 6089,
  rows: DAYS.flatMap((day) =>
    CODES.map(([id, tube, mat, count]) => ({
      day, rejectType: 'quality', tubeCode: tube, materialCode: mat, rejectCodeId: id, label: null,
      displayLabel: '', isPass: null, count: Math.round(count / 30), cones: 5000, inspected: 5000, ratePct: (100 * Math.round(count / 30)) / 5000,
    })),
  ),
};
const GEN = { generation: 3, totalProduced: 132550, totalRejects: 6048, totalInspected: 132665, pBar: 0.0456, firstBucketTs: '2026-08-05T00:00:00.000Z', lastBucketTs: '2026-09-07T00:00:00.000Z' };
const spc = (rejects: number, over: Partial<{ episodes: unknown[] }> = {}) => ({
  bucketSize: 'day', rejectTypeFilter: 'quality', totalProduced: 132550, totalRejects: rejects, pBar: 0.0456, spansGenerations: false,
  generations: [{ ...GEN, totalRejects: rejects }], outOfControlCount: 0,
  buckets: DAYS.map((d, i) => ({ bucketTs: `${d}T00:00:00.000Z`, generation: 3, produced: 5000, inspected: 5000, rejects: 100 + i * 50, rate: (100 + i * 50) / 5000, ucl: 0.05, lcl: 0.03, outOfControl: false })),
  episodes: over.episodes ?? [{ startTs: '2026-09-06T00:00:00.000Z', endTs: '2026-09-07T00:00:00.000Z', bucketCount: 2, totalRejects: 250, totalProduced: 10000 }],
});
const STATIONS = { stations: [3, 5].map((n) => ({ stationId: n, name: null, machine: null, description: null })) };
const PRODUCTS = { products: [{ productId: 12, description: '205-IL0-SD', lotCode: null, setpointG: 1960, blend: null, countText: null, tubeType: null, tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: null }] };
const REASON_ONE = {
  day: '2026-09-06', dayBasis: 'production_day', code: { rejectType: 'quality', tubeCode: 2, materialCode: 1 },
  rejectCodeId: 11, label: null, displayLabel: 'Tube 2 · Mat 1', isPass: null, total: 2, page: 1, pageSize: 200,
  rows: [
    { eventId: 9001, productionTsUtc: '2026-09-06T08:14:09Z', shiftCode: 'morning', station: 3, materialId: 12, productLabel: '205-IL0-SD', weightG: null, sourceRowId: 77, epochLabel: null, epochOrdinal: 3, epochSimulator: false, attributionMethod: 'source_column' },
    { eventId: 9002, productionTsUtc: '2026-09-06T09:20:00Z', shiftCode: 'morning', station: 5, materialId: null, productLabel: null, weightG: 1840, sourceRowId: 78, epochLabel: null, epochOrdinal: 3, epochSimulator: false, attributionMethod: null },
  ],
};

function routes(extra: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 },
    '/api/rejects': env(REASONS),
    '/api/reject-spc': ({ search }: { search: URLSearchParams }) => env(search.get('rejectType') === 'weight' ? spc(41) : spc(6048)),
    '/api/rejects/by-day-code': env(BY_DAY),
    '/api/rejects/reason': env(REASON_ONE),
    '/api/stations': STATIONS,
    '/api/products': PRODUCTS,
    ...extra,
  } as Routes;
}

let ff: FakeFetch | null = null;
const go = vi.fn();
function open(query: string, rank: number, extra: Routes = {}) {
  window.history.replaceState(null, '', `/next/?${query}`);
  ff = installFakeFetch(routes(extra));
  const route = parseRoute(new URLSearchParams(query));
  return render(
    <live.LiveProvider asOf={null}>
      <QualityRejectsScreen route={route} rank={rank} user={ME as never} go={go} />
    </live.LiveProvider>,
  );
}
beforeEach(() => { go.mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); ff?.restore(); ff = null; window.history.replaceState(null, '', '/'); });

const QUERY = 's=quality&t=rejects';
const reasonList = () => screen.getByRole('list', { name: 'Failed inspection by reason' });
const findList = () => screen.findByRole('list', { name: 'Failed inspection by reason' });

describe('headline, KPIs and the two verdicts (A3-039)', () => {
  it('names both verdicts, divides by the cones checked, and never says bare "rejected"', async () => {
    open(QUERY, 1);
    await findList();
    // 6,048 of 132,665 = 4.56 %; 41 of 132,665 = 0.03 %; together 6,089 = 4.59 %, the Today/Reports figure.
    expect(await screen.findByText(/4\.6 % of cones failed inspection\./)).toBeTruthy();
    expect(screen.getByText('Failed inspection')).toBeTruthy();
    expect(screen.getByText('Weight-reject records')).toBeTruthy();
    expect(screen.queryByText('Failed weight check (scale)', { selector: '.kpi-label' })).toBeNull();
    expect(screen.getByText('6,048 of 132,665 cones checked')).toBeTruthy();
    expect(screen.getByText('41 records over 132,665 cones checked')).toBeTruthy();
    expect(screen.getByText(/Together 6,089 of 132,665 cones checked \(4\.6 %\)/)).toBeTruthy();
    expect(screen.getByText('Top reason share')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\brejected\b/i);
  });

  it('unnamed codes read "Code 2/1 (not named yet)"', async () => {
    open(QUERY, 1);
    const list = await findList();
    expect(within(list).getByRole('button', { name: 'Code 2/1 (not named yet)' })).toBeTruthy();
  });

  it('puts the weight-check row in its own verdict, not in the inspection list', async () => {
    open(QUERY, 1);
    const list = await findList();
    expect(within(list).queryByText(/Weight out of range/)).toBeNull();
    expect(within(list).queryByText(/weight/i)).toBeNull();
  });
});

describe('Pareto from the shared lib (A3-040)', () => {
  it('shares are recomputed over the inspection reasons and the vital few comes from lib/pareto', () => {
    const rows = inspectionReasons(REASONS.reasons);
    expect(rows).toHaveLength(CODES.length);
    expect(rows[0]!.share).toBeCloseTo((100 * 4240) / CODES.reduce((t, c) => t + c[3], 0), 5);
    expect(rows[rows.length - 1]!.runShare).toBeCloseTo(100, 5);
    expect(vitalCount(rows)).toBe(pareto.vitalFew(rows.map((r) => ({ cumulativePct: r.runShare })), 80));
    expect(paretoRows(rows, (r) => r.code).every((r, i) => r.cumulativePct === rows[i]!.runShare)).toBe(true);
  });

  it('shows the top 8 and a "Show all N" that opens the rest', async () => {
    open(QUERY, 1);
    const list = await findList();
    expect(within(list).getAllByRole('listitem').filter((li) => li.getAttribute('aria-hidden') !== 'true')).toHaveLength(8);
    const all = screen.getAllByRole('button', { name: 'Show all 10' })[0]!;
    fireEvent.click(all);
    expect(within(reasonList()).getAllByRole('listitem').filter((li) => li.getAttribute('aria-hidden') !== 'true')).toHaveLength(10);
    expect(screen.getAllByRole('button', { name: 'Show top 8' }).length).toBeGreaterThan(0);
  });
});

describe('reason x day matrix is capped (A3-041)', () => {
  it('draws 8 reason rows, then all on "Show all"', async () => {
    open(QUERY, 1);
    const table = await screen.findByRole('table', { name: /When each reason happened/ });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 8);
    expect(screen.getByText(/Top 8 reasons shown/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all 10' })[0]!);
    const grown = await screen.findByRole('table', { name: /When each reason happened/ });
    expect(within(grown).getAllByRole('row')).toHaveLength(1 + 10);
  });

  it('a cell opens the reason sheet for that reason and day', async () => {
    open(QUERY, 1);
    const table = await screen.findByRole('table', { name: /When each reason happened/ });
    fireEvent.click(within(table).getAllByRole('button')[0]!);
    expect(go).toHaveBeenCalledTimes(1);
    const next = go.mock.calls[0]![0];
    expect(next.sheet.kind).toBe('reason');
    expect(parseReasonId(next.sheet.id)).toMatchObject({ day: '2026-09-05', rejectType: 'quality', tubeCode: 2, materialCode: 1 });
  });
});

describe('jc, st, pr round-trip (A3-040, A3-042, A1-064..A1-066)', () => {
  it('reads the three keys, sends them on the wire, marks the followed reason', async () => {
    open(`${QUERY}&st=3&pr=12&jc=2-1`, 1);
    const list = await findList();
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Code 2/1 (not named yet)' }).getAttribute('aria-pressed')).toBe('true'));
    const reqs = ff!.requests;
    expect(reqs.some((r) => r.startsWith('/api/rejects?') && r.includes('station=3') && r.includes('product=12'))).toBe(true);
    expect(reqs.some((r) => r.startsWith('/api/reject-spc?') && r.includes('code=2-1') && r.includes('station=3'))).toBe(true);
    expect(reqs.some((r) => r.startsWith('/api/rejects/by-day-code?') && r.includes('product=12'))).toBe(true);
    expect((screen.getByLabelText('Station') as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText('Product') as HTMLSelectElement).value).toBe('12');
    // the chip names the reason and clearing it removes only jc
    fireEvent.click(screen.getByRole('button', { name: 'Remove Reason: Code 2/1 (not named yet)' }));
    expect(go.mock.calls.at(-1)![0].keys).toEqual({ st: '3', pr: '12' });
  });

  it('choosing a reason writes jc; changing the station writes st; "All" removes it', async () => {
    open(`${QUERY}&st=3`, 1);
    const list = await findList();
    fireEvent.click(within(list).getByRole('button', { name: 'Code 1/11 (not named yet)' }));
    expect(go.mock.calls.at(-1)![0].keys).toEqual({ st: '3', jc: '1-11' });
    fireEvent.change(screen.getByLabelText('Station'), { target: { value: '5' } });
    expect(go.mock.calls.at(-1)![0].keys).toEqual({ st: '5' });
    fireEvent.change(screen.getByLabelText('Station'), { target: { value: '' } });
    expect(go.mock.calls.at(-1)![0].keys).toEqual({});
  });

  it('drops a followed reason the period cannot name, replacing history', async () => {
    open(`${QUERY}&jc=99-99`, 1);
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(go.mock.calls[0]![0].keys.jc).toBeUndefined();
    expect(go.mock.calls[0]![1]).toEqual({ replace: true });
  });
});

describe('the old hops all exist and carry state (A3-043, G-9, A6-H10, A6-H11)', () => {
  it('"See the cones" opens the Register on cones that failed inspection with period and filters', async () => {
    open(`${QUERY}&p=yesterday&st=3&pr=12`, 1);
    const a = (await screen.findByRole('link', { name: 'See the cones' })) as HTMLAnchorElement;
    const q = new URLSearchParams(a.getAttribute('href')!.slice(1));
    expect(q.get('s')).toBe('quality');
    expect(q.get('t')).toBe('register');
    expect(q.get('rf')).toBe('inspectionRejects');
    expect(q.get('rl')).toBe('inspectionRejects');
    expect(q.get('p')).toBe('yesterday');
    expect(q.get('st')).toBe('3');
    expect(q.get('pr')).toBe('12');
    fireEvent.click(a);
    expect(go.mock.calls.at(-1)![0]).toMatchObject({ s: 'quality', t: 'register' });
  });

  it('"By station" opens Stations with the period and product but not the station filter', async () => {
    open(`${QUERY}&p=yesterday&st=3&pr=12`, 1);
    const a = (await screen.findByRole('link', { name: 'By station' })) as HTMLAnchorElement;
    const q = new URLSearchParams(a.getAttribute('href')!.slice(1));
    expect(q.get('t')).toBe('stations');
    expect(q.get('p')).toBe('yesterday');
    expect(q.get('pr')).toBe('12');
    expect(q.has('st')).toBe(false);
    fireEvent.click(a);
    expect(go.mock.calls.at(-1)![0]).toMatchObject({ s: 'quality', t: 'stations' });
  });
});

describe('Name it (A1-040, A4-13)', () => {
  it('is absent at rank 1', async () => {
    open(QUERY, 1);
    const list = await findList();
    expect(within(list).queryByRole('button', { name: 'Name it' })).toBeNull();
  });
  it('is present at rank 2', async () => {
    open(QUERY, 2);
    const list = await findList();
    expect(within(list).getAllByRole('button', { name: 'Name it' })).toHaveLength(8);
  });

  const noop = () => {};
  it('with writes off it is disabled and prints the server reason verbatim', () => {
    const REASON = 'Writes are switched off on this server until IFL confirms.';
    render(<NameIt rank={2} codeId={11} label={null} disabledReason={REASON} onSaved={noop} />);
    const b = screen.getByRole('button', { name: 'Name it' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(screen.getByText(REASON)).toBeTruthy();
  });
  it('shows nothing at all below the rank, even with writes off', () => {
    const { container } = render(<NameIt rank={1} codeId={11} label={null} disabledReason="off" onSaved={noop} />);
    expect(container.textContent).toBe('');
  });
  it('saves through PUT /api/reject-codes/:id with no optimistic change, then refetches', async () => {
    let body = '';
    ff = installFakeFetch({ '/api/reject-codes/11': ({ init }: { init?: RequestInit }) => { body = String(init?.body); return { ok: true }; } } as Routes);
    const saved = vi.fn();
    render(<NameIt rank={2} codeId={11} label={null} onSaved={saved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fireEvent.change(screen.getByLabelText('Name for this reason'), { target: { value: 'Loose tube' } });
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(JSON.parse(body)).toEqual({ label: 'Loose tube' });
  });
  it('a refusal keeps the editor open and says so', async () => {
    ff = installFakeFetch({ '/api/reject-codes/11': new Response('{"error":"no"}', { status: 403 }) } as Routes);
    const saved = vi.fn();
    render(<NameIt rank={2} codeId={11} label={null} onSaved={saved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fireEvent.change(screen.getByLabelText('Name for this reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't save the name\./);
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name for this reason')).toBeTruthy();
  });
});

describe('a failed fetch is named, never "none" (CLAUDE.md, rule: name which part failed)', () => {
  it('failed reasons: says so, keeps the rates that did load, no "No cones failed"', async () => {
    open(QUERY, 1, { '/api/rejects': new Response('{"error":"down"}', { status: 500 }) });
    expect(await screen.findAllByText("Couldn't load the reasons.")).not.toHaveLength(0);
    expect(screen.queryByText('No cones failed inspection in this period.')).toBeNull();
    expect(await screen.findByText('6,048 of 132,665 cones checked')).toBeTruthy();
  });
  it('failed rate series: the KPI says which part, and the headline asserts nothing', async () => {
    open(QUERY, 1, { '/api/reject-spc': ({ search }: { search: URLSearchParams }) => (search.get('rejectType') === 'weight' ? new Response('{}', { status: 500 }) : env(spc(6048))) });
    expect(await screen.findAllByText(/Couldn't load the (failed-inspection|weight-reject) rate\./)).not.toHaveLength(0);
    expect((document.querySelector('.ui-pagehead__sentence')?.textContent ?? '')).toBe('How many cones failed a check, why, is it getting worse, and where?');
  });
  it('failed trend: the chart names its part, no rising verdict, the list and rates are unaffected', async () => {
    open(QUERY, 1, { '/api/reject-spc': ({ search }: { search: URLSearchParams }) => (search.has('shift') ? env(search.get('rejectType') === 'weight' ? spc(41) : spc(6048)) : new Response('{}', { status: 500 })) });
    await findList();
    expect(await screen.findByText("Couldn't load the trend.")).toBeTruthy();
    expect(screen.queryByText(/rising since/)).toBeNull();
    expect(screen.getByText('6,048 of 132,665 cones checked')).toBeTruthy();
  });
});

describe('the trend is a fixed, labelled window with a mean line (A3-039, A1-038)', () => {
  it('asks /api/range, labels the window, draws daily rate and window mean, states a rise', async () => {
    open(QUERY, 1);
    await findList();
    expect((await screen.findAllByRole('region', { name: /Daily failed-inspection rate, last \d+ production days/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fixed window: it does not follow the period/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/^Failed inspection has been rising since Sun 6 Sep/)).toBeTruthy();
    expect(ff!.requests.some((r) => r === '/api/range')).toBe(true);
    const trendReq = ff!.requests.find((r) => r.startsWith('/api/reject-spc?') && r.includes('rejectType=quality') && !r.includes('shift'))!;
    // window to = the plant's shift date (2026-09-07), never the period's own from
    expect(trendReq).toContain('to=2026-09-07');
  });
});

describe('reason ids keep the old shape', () => {
  it('round-trips and refuses nonsense', () => {
    const id = { day: '2026-09-06', rejectType: 'quality' as const, tubeCode: 2, materialCode: null };
    expect(reasonIdOf(id)).toBe('2026-09-06|quality|2|');
    expect(parseReasonId(reasonIdOf(id))).toEqual(id);
    expect(parseReasonId('nope')).toBeNull();
    expect(parseReasonId('2026-09-06|other|1|1')).toBeNull();
  });
});

describe('ReasonSheet (A3-057, A6-S5, A1-067)', () => {
  function openSheet(rank: number, id = '2026-09-06|quality|2|1', extra: Routes = {}) {
    window.history.replaceState(null, '', '/next/?s=quality&t=rejects');
    ff = installFakeFetch(routes(extra));
    const route = { ...parseRoute(new URLSearchParams('s=quality&t=rejects')), sheet: { kind: 'reason' as const, id } };
    return render(
      <live.LiveProvider asOf={null}>
        <ReasonSheet route={route} rank={rank} user={ME as never} go={go} onClose={vi.fn()} />
      </live.LiveProvider>,
    );
  }

  it('names the reason, counts its cones and lists them with station, product and record', async () => {
    openSheet(1);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByText(/2 cones failed inspection for Code 2\/1 \(not named yet\)/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Code 2/1 (not named yet)', level: 2 })).toBeTruthy();
    expect(await screen.findByText('Station 3')).toBeTruthy();
    expect(screen.getByText('Product not recorded')).toBeTruthy();
    expect(ff!.requests.some((r) => r.startsWith('/api/rejects/reason?') && r.includes('day=2026-09-06') && r.includes('code=2-1'))).toBe(true);
  });

  it('shows the per-day breakdown for the period and a day row moves the sheet (replace)', async () => {
    openSheet(1);
    const table = await screen.findByRole('table', { name: 'Day by day in this period' });
    expect(ff!.requests.some((r) => r.startsWith('/api/rejects/by-day-code?') && r.includes('code=2-1'))).toBe(true);
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    fireEvent.click(rows[1]!);
    const [next, opts] = go.mock.calls.at(-1)!;
    expect(next.sheet.kind).toBe('reason');
    expect(opts).toEqual({ replace: true });
  });

  it('a cone row opens its reject sheet; the two day hops carry the day', async () => {
    openSheet(1);
    const cones = await screen.findByRole('table', { name: 'Cones on 2026-09-06' });
    fireEvent.click(within(cones).getAllByRole('row')[1]!);
    expect(go.mock.calls.at(-1)![0].sheet).toEqual({ kind: 'reject', id: '9001' });

    const reg = (await screen.findByRole('link', { name: 'See this day in the Register' })) as HTMLAnchorElement;
    const q = new URLSearchParams(reg.getAttribute('href')!.slice(1));
    expect([q.get('s'), q.get('t'), q.get('p'), q.get('from'), q.get('to'), q.get('rl')]).toEqual(['quality', 'register', 'pick', '2026-09-06', '2026-09-06', 'inspectionRejects']);
    const rep = screen.getByRole('link', { name: 'See this day on the reject report' }) as HTMLAnchorElement;
    const r = new URLSearchParams(rep.getAttribute('href')!.slice(1));
    expect([r.get('s'), r.get('rt'), r.get('p'), r.get('from')]).toEqual(['reports', 'reject', 'pick', '2026-09-06']);
  });

  it('Name it is absent at rank 1 and present at rank 2', async () => {
    const { unmount } = openSheet(1);
    await screen.findByText(/2 cones failed inspection/);
    expect(screen.queryByRole('button', { name: 'Name it' })).toBeNull();
    unmount();
    ff?.restore();
    openSheet(2);
    await screen.findByText(/2 cones failed inspection/);
    expect(screen.getByRole('button', { name: 'Name it' })).toBeTruthy();
  });

  it('a failed reason fetch is named, and a malformed id is "couldn\'t load", not a crash', async () => {
    const { unmount } = openSheet(1, '2026-09-06|quality|2|1', { '/api/rejects/reason': new Response('{}', { status: 500 }) });
    expect((await screen.findAllByText("Couldn't load this reason.")).length).toBeGreaterThan(0);
    unmount();
    ff?.restore();
    openSheet(1, 'garbage');
    expect(await screen.findByText("Couldn't load this reason.")).toBeTruthy();
  });
});
