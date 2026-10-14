import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const st = {
  stations: [] as { stationId: number; name: string | null; isActive: boolean }[],
  rates: new Map<number, number>(),
  cones: new Map<number, number>(),
  totalCones: 0,
  totalRejects: 0,
  totalUnmatchedRejects: 0,
};

const defaultWs = () => ({
  productLabel: 'P12',
  stations: [{ station: 1, n: 100, meanG: 1950, vsTargetG: -4.26 }, { station: 2, n: 0, meanG: 0, vsTargetG: 3 }] as Record<string, unknown>[],
});
const ws = { data: defaultWs() };
const wsArgs = vi.hoisted(() => ({ last: [] as unknown[] }));

vi.mock('./admin.js', () => ({ listStations: async () => st.stations }));
vi.mock('./weightStations.js', () => ({
  rejectRatesByStation: async () => ({
    rates: st.rates, cones: st.cones, totalCones: st.totalCones,
    totalRejects: st.totalRejects, totalUnmatchedRejects: st.totalUnmatchedRejects,
  }),
  getWeightStations: async (...a: unknown[]) => {
    wsArgs.last = a;
    return ws.data;
  },
}));

const { getStationStatus, decideState } = await import('./stationStatus.js');
const pool = {} as ConnectionPool;
const run = () => getStationStatus(pool, 1, { from: '2026-09-01', to: '2026-09-07' });

function setup(line: number, rows: { id: number; cones: number; rate?: number; active?: boolean }[]) {
  st.stations = rows.map((r) => ({ stationId: r.id, name: `S${r.id}`, isActive: r.active ?? true }));
  st.rates = new Map(rows.filter((r) => r.rate != null).map((r) => [r.id, r.rate!]));
  st.cones = new Map(rows.map((r) => [r.id, r.cones]));
  st.totalCones = 1000;
  st.totalUnmatchedRejects = 0;
  st.totalRejects = (line * 1000) / 100; // line rate = `line` %
}

describe('getStationStatus', () => {
  it('1.5x exactly is ok, just over is watch', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 3 }, { id: 2, cones: 100, rate: 3.01 }]);
    const r = await run();
    expect(r.stations[0]!.state).toBe('ok');
    expect(r.stations[1]!.state).toBe('watch');
  });
  it('2x exactly is watch, just over is act', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 4 }, { id: 2, cones: 100, rate: 4.01 }]);
    const r = await run();
    expect(r.stations[0]!.state).toBe('watch');
    expect(r.stations[1]!.state).toBe('act');
  });
  it('no cones is nodata, never ok', async () => {
    setup(2, [{ id: 1, cones: 0 }]);
    const s = (await run()).stations[0]!;
    expect(s.state).toBe('nodata');
    expect(s.failedPct).toBeNull();
    expect(s.reasons.length).toBe(1);
  });
  it('line rate 0 makes every station with cones ok', async () => {
    setup(0, [{ id: 1, cones: 50, rate: 5 }, { id: 2, cones: 0 }]);
    const r = await run();
    expect(r.stations[0]!.state).toBe('ok');
    expect(r.stations[1]!.state).toBe('nodata');
  });
  it('excludes inactive stations', async () => {
    setup(2, [{ id: 1, cones: 10, rate: 1 }, { id: 2, cones: 10, rate: 1, active: false }]);
    expect((await run()).stations.map((s) => s.station)).toEqual([1]);
  });
  it('reason text states the threshold, thresholds are assumed', async () => {
    setup(14.55, [{ id: 1, cones: 100, rate: 40 }, { id: 2, cones: 100, rate: 25 }]);
    const r = await run();
    expect(r.stations[0]!.reasons).toEqual(['More than 2 times the line rate (over 29.1 %)']);
    expect(r.stations[1]!.reasons).toEqual(['More than 1.5 times the line rate (over 21.8 %)']);
    expect(r.thresholds).toEqual({ watch: 1.5, act: 2, minCones: 50, assumed: true });
    expect(r.lineFailedPct).toBe(14.55);
  });
  it('carries vsTargetG and product from the period rows only', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 2 }, { id: 2, cones: 0 }]);
    const r = await run();
    expect(r.stations[0]!.vsTargetG).toBe(-4.3);
    expect(r.stations[0]!.product).toBe('P12');
    expect(r.stations[1]!.vsTargetG).toBeNull();
  });
  it('49 cones is never watch/act: ok with the too-few reason; 50 is judged', async () => {
    setup(2, [{ id: 1, cones: 49, rate: 90 }, { id: 2, cones: 50, rate: 90 }, { id: 3, cones: 1, rate: 100 }]);
    const r = await run();
    expect(r.stations[0]!.state).toBe('ok');
    expect(r.stations[0]!.reasons).toEqual(['Too few cones to judge (under 50)']);
    expect(r.stations[0]!.failedPct).toBe(90);
    expect(r.stations[1]!.state).toBe('act');
    expect(r.stations[2]!.state).toBe('ok');
  });
  it('0 cones stays nodata, not the too-few case', () => {
    expect(decideState(0, null, 2).state).toBe('nodata');
    expect(decideState(1, 5, 2).state).toBe('ok');
  });
  it('decideState: unknown line rate is ok', () => {
    expect(decideState(5, 9, null).state).toBe('ok');
  });
  it('each station gets its own product and target; mixed is null with a marker; July rows use the line product', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 2 }, { id: 2, cones: 100, rate: 2 }, { id: 3, cones: 100, rate: 2 }, { id: 4, cones: 100, rate: 2 }]);
    ws.data = {
      productLabel: 'LINE-DEFAULT',
      stations: [
        { station: 1, n: 100, vsTargetG: -2, targetBasis: 'station_material', targetProductLabel: '205-IL0-SD' },
        { station: 2, n: 100, vsTargetG: 5, targetBasis: 'station_material', targetProductLabel: 'Star Green' },
        { station: 3, n: 100, vsTargetG: null, targetBasis: 'mixed', targetProductLabel: null, materialsInWindow: 2 },
        { station: 4, n: 100, vsTargetG: 1.04, targetBasis: 'line_product', targetProductLabel: 'LINE-DEFAULT' },
      ],
    };
    try {
      const r = (await run()).stations;
      expect(r[0]).toMatchObject({ product: '205-IL0-SD', productBasis: 'own', vsTargetG: -2 });
      expect(r[1]).toMatchObject({ product: 'Star Green', productBasis: 'own', vsTargetG: 5 });
      expect(r[2]).toMatchObject({ product: null, productBasis: 'mixed', vsTargetG: null, materialsInPeriod: 2 });
      expect(r[3]).toMatchObject({ product: 'LINE-DEFAULT', productBasis: 'line', vsTargetG: 1 });
    } finally {
      ws.data = defaultWs();
    }
  });
});

describe('getStationStatus - shift scope of the target context (14 Oct 2026)', () => {
  it('asks getWeightStations to narrow the mean to the same shift and range as the counts', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 2 }]);
    const range = { from: '2026-09-01', fromShift: 'morning', to: '2026-09-02', toShift: 'evening' } as never;
    await getStationStatus(pool, 1, { from: '2026-09-01', to: '2026-09-02', shift: 'evening', shiftRange: range });
    expect(wsArgs.last[5]).toMatchObject({ from: '2026-09-01', to: '2026-09-02', shift: 'evening', shiftRange: range, narrowPopulation: true });
  });
});
