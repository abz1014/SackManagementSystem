/**
 * Roadmap Phase 2b (16 Sep 2026): App.tsx's route model — `parseRoute` and
 * `routeSearch` are pure functions of the URL (a `URLSearchParams` in,
 * a `Route` object or a query string out), so they are tested directly here
 * rather than through a rendered component. This suite runs in a plain node
 * environment (see vitest.config.ts), where `window` does not exist by
 * default — `parseRoute` already falls back to a hardcoded default route
 * for that case, which is how it behaves under SSR. To exercise the real
 * parsing logic each test below stubs just enough of `window` —
 * `location.search` — for both `parseRoute()` and the `readAsOf()` call
 * inside it (lib/live.tsx) to read the same string a browser's
 * `URLSearchParams` would.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseRoute, routeSearch, type Route } from './App';

function withSearch<T>(search: string, fn: () => T): T {
  (globalThis as unknown as { window: unknown }).window = { location: { search } };
  try {
    return fn();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** The route a bare `?s=<view>` parses to — every new field at its default. */
function baseRoute(view: string): Route {
  return withSearch(`?s=${view}`, () => parseRoute());
}

describe('parseRoute / routeSearch — defaults', () => {
  it('a bare view has every new field at its default, and none of the new keys are written back', () => {
    const r = baseRoute('report');
    expect(r).toMatchObject({
      view: 'report',
      reportType: 'daily',
      reportShift: null,
      station: null,
      product: null,
      readingsListing: 'cones',
      readingsStates: [],
      readingsPage: 1,
      weightMode: 'time',
      weightChartType: 'cone',
      sacksUnit: 'sacks',
      sacksPage: 1,
      rejectsCode: null,
    });
    // A default Report view is a clean `?s=report` — no `rt`, no filters —
    // never a string of empty parameters.
    expect(routeSearch(r)).toBe('?s=report&p=shift');
  });

  it('omits every new key from the URL when the screen is at its default, for every screen this phase touched', () => {
    for (const view of ['readings', 'weight', 'sacks', 'rejects']) {
      const r = baseRoute(view);
      const params = new URLSearchParams(routeSearch(r));
      for (const key of ['rt', 'rsh', 'st', 'pr', 'rl', 'rcs', 'rp', 'wm', 'wt', 'su', 'sp', 'jc']) {
        expect(params.has(key), `${view} should not carry ${key} at its default`).toBe(false);
      }
    }
  });
});

describe('Report — type and filters round-trip', () => {
  it('a non-default type and every filter survive parse → write → parse', () => {
    const r1 = withSearch('?s=report&rt=reject&rsh=night&st=5&pr=21', () => parseRoute());
    expect(r1.reportType).toBe('reject');
    expect(r1.reportShift).toBe('night');
    expect(r1.station).toBe(5);
    expect(r1.product).toBe(21);

    const url = routeSearch(r1);
    const r2 = withSearch(url, () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('an unknown report type falls back to daily, never crashing or rendering an empty screen', () => {
    const r = withSearch('?s=report&rt=nonsense', () => parseRoute());
    expect(r.reportType).toBe('daily');
  });

  it('an unrecognised shift filter is dropped rather than kept as garbage', () => {
    const r = withSearch('?s=report&rsh=midnight', () => parseRoute());
    expect(r.reportShift).toBeNull();
  });
});

describe('Readings — listing, station, states and page round-trip', () => {
  it('a non-default listing, the shared station, cone states and a page survive the round trip', () => {
    const r1 = withSearch('?s=readings&rl=sacks&st=3&rcs=low,high&rp=4', () => parseRoute());
    expect(r1.readingsListing).toBe('sacks');
    expect(r1.station).toBe(3);
    expect(r1.readingsStates).toEqual(['low', 'high']);
    expect(r1.readingsPage).toBe(4);

    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('an unknown listing falls back to cones, not a blank screen', () => {
    const r = withSearch('?s=readings&rl=bogus', () => parseRoute());
    expect(r.readingsListing).toBe('cones');
  });

  it('a cone-state list keeps only the values the server actually judges cones by', () => {
    const r = withSearch('?s=readings&rcs=low,bogus,high,rejected', () => parseRoute());
    expect(r.readingsStates).toEqual(['low', 'high', 'rejected']);
  });

  it('a non-numeric, zero, negative or fractional page falls back to 1', () => {
    for (const rp of ['abc', '0', '-3', '2.5', '']) {
      const r = withSearch(`?s=readings&rp=${encodeURIComponent(rp)}`, () => parseRoute());
      expect(r.readingsPage, `rp=${rp}`).toBe(1);
    }
  });

  it('rf=inspectionRejects with no explicit rl still seeds the inspection-reject listing — the one behaviour an old link depended on', () => {
    const r = withSearch('?s=readings&rf=inspectionRejects', () => parseRoute());
    expect(r.readingsListing).toBe('inspectionRejects');
    // And because that IS the default for this rf, routeSearch omits rl.
    expect(new URLSearchParams(routeSearch(r)).has('rl')).toBe(false);
  });

  it('an explicit rl overrides the rf-derived default', () => {
    const r = withSearch('?s=readings&rf=inspectionRejects&rl=sacks', () => parseRoute());
    expect(r.readingsListing).toBe('sacks');
    // Now that it differs from the derived default, it IS written back.
    expect(new URLSearchParams(routeSearch(r)).get('rl')).toBe('sacks');
  });
});

describe('Weight — mode and the shared station round-trip', () => {
  it('a non-default chart mode and the shared station survive the round trip', () => {
    const r1 = withSearch('?s=weight&wm=dist&st=7', () => parseRoute());
    expect(r1.weightMode).toBe('dist');
    expect(r1.station).toBe(7);
    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('an unknown mode falls back to the time chart', () => {
    const r = withSearch('?s=weight&wm=bogus', () => parseRoute());
    expect(r.weightMode).toBe('time');
  });

  // UX Phase 5 Brief 3 unit U6 (16 Sep 2026): the chart's cone/sack toggle,
  // following the exact `wm` pattern above.
  it('?wt=sack parses to the sack chart type and round-trips through routeSearch', () => {
    const r1 = withSearch('?s=weight&wt=sack', () => parseRoute());
    expect(r1.weightChartType).toBe('sack');
    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('an unknown chart type falls back to cone', () => {
    const r = withSearch('?s=weight&wt=bogus', () => parseRoute());
    expect(r.weightChartType).toBe('cone');
  });
});

describe('Sacks — unit and page round-trip', () => {
  it('a non-default unit and page survive the round trip', () => {
    const r1 = withSearch('?s=sacks&su=kg&sp=3', () => parseRoute());
    expect(r1.sacksUnit).toBe('kg');
    expect(r1.sacksPage).toBe(3);
    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('an unknown unit falls back to sacks', () => {
    const r = withSearch('?s=sacks&su=lbs', () => parseRoute());
    expect(r.sacksUnit).toBe('sacks');
  });
});

describe('Rejects — station, product and code, sharing station/product with the other screens', () => {
  it('station, product and code all round-trip', () => {
    const r1 = withSearch('?s=rejects&st=2&pr=9&jc=quality:5:7', () => parseRoute());
    expect(r1.station).toBe(2);
    expect(r1.product).toBe(9);
    expect(r1.rejectsCode).toBe('quality:5:7');
    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });

  it('the SAME `st` key that filters Rejects also filters Report and Weight — proving the shared key, not three local ones', () => {
    const onReport = withSearch('?s=report&st=6', () => parseRoute());
    const onWeight = withSearch('?s=weight&st=6', () => parseRoute());
    const onRejects = withSearch('?s=rejects&st=6', () => parseRoute());
    expect(onReport.station).toBe(6);
    expect(onWeight.station).toBe(6);
    expect(onRejects.station).toBe(6);
  });

  it('a garbage station or product id is dropped rather than parsed as a number', () => {
    const r = withSearch('?s=rejects&st=abc&pr=-1', () => parseRoute());
    expect(r.station).toBeNull();
    expect(r.product).toBeNull();
  });
});

describe('no-regression pin — an old link with only the pre-Phase-2b keys still parses exactly as before', () => {
  it('a plain screen switch carries no new-field noise', () => {
    const r = withSearch('?s=weight&p=today', () => parseRoute());
    expect(r.view).toBe('weight');
    expect(r.period).toEqual({ key: 'today' });
    expect(r.sheet).toBeNull();
    expect(r.at).toBeNull();
    expect(r.readingsFilter).toBeNull();
    // Every field this phase added is inert at its default.
    expect(r.reportType).toBe('daily');
    expect(r.reportShift).toBeNull();
    expect(r.station).toBeNull();
    expect(r.product).toBeNull();
    expect(r.weightMode).toBe('time');
    expect(r.weightChartType).toBe('cone');
  });

  it('a sheet deep link, a replay instant and a picked period parse exactly as the pre-Phase-2b keys alone describe them', () => {
    const search = '?s=line&p=pick&from=2026-09-01&to=2026-09-07&sheet=station:7&at=2026-09-07T09:00:00.000Z';
    const r = withSearch(search, () => parseRoute());
    expect(r.view).toBe('line');
    expect(r.period).toEqual({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-07' } });
    expect(r.sheet).toEqual({ kind: 'station', id: '7' });
    expect(r.at).toBe('2026-09-07T09:00:00.000Z');
    expect(r.readingsListing).toBe('cones');
    expect(r.readingsPage).toBe(1);
    expect(r.sacksUnit).toBe('sacks');
    expect(r.rejectsCode).toBeNull();
  });

  it('the old rf=inspectionRejects link into Readings still lands on the inspection-reject listing with no page or station carried over', () => {
    const r = withSearch('?s=readings&rf=inspectionRejects', () => parseRoute());
    expect(r.readingsFilter).toBe('inspectionRejects');
    expect(r.readingsListing).toBe('inspectionRejects');
    expect(r.station).toBeNull();
    expect(r.readingsStates).toEqual([]);
    expect(r.readingsPage).toBe(1);
  });
});

describe('the period and the replay instant survive alongside the new keys', () => {
  it('a picked period and a replay instant sit beside a report type and the shared station without interference', () => {
    const search = '?s=report&p=pick&from=2026-09-01&to=2026-09-07&at=2026-09-07T09:00:00.000Z&rt=sack&st=4';
    const r = withSearch(search, () => parseRoute());
    expect(r.period).toEqual({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-07' } });
    expect(r.at).toBe('2026-09-07T09:00:00.000Z');
    expect(r.reportType).toBe('sack');
    expect(r.station).toBe(4);

    // And they still all survive one more parse → write → parse cycle together.
    const r2 = withSearch(routeSearch(r), () => parseRoute());
    expect(r2).toEqual(r);
  });

  it('the shift period and a cone-state filter on Readings coexist through a full round trip', () => {
    const r1 = withSearch('?s=readings&p=shift&rcs=within,rejected&rp=2', () => parseRoute());
    expect(r1.period).toEqual({ key: 'shift' });
    expect(r1.readingsStates).toEqual(['within', 'rejected']);
    expect(r1.readingsPage).toBe(2);
    const r2 = withSearch(routeSearch(r1), () => parseRoute());
    expect(r2).toEqual(r1);
  });
});
