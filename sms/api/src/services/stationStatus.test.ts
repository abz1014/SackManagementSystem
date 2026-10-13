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

vi.mock('./admin.js', () => ({ listStations: async () => st.stations }));
vi.mock('./weightStations.js', () => ({
  rejectRatesByStation: async () => ({
    rates: st.rates, cones: st.cones, totalCones: st.totalCones,
    totalRejects: st.totalRejects, totalUnmatchedRejects: st.totalUnmatchedRejects,
  }),
  getWeightStations: async () => ({
    productLabel: 'P12',
    stations: [{ station: 1, n: 100, meanG: 1950, vsTargetG: -4.26 }, { station: 2, n: 0, meanG: 0, vsTargetG: 3 }],
  }),
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
    setup(14.55, [{ id: 1, cones: 10, rate: 40 }, { id: 2, cones: 10, rate: 25 }]);
    const r = await run();
    expect(r.stations[0]!.reasons).toEqual(['More than 2 times the line rate (over 29.1 %)']);
    expect(r.stations[1]!.reasons).toEqual(['More than 1.5 times the line rate (over 21.8 %)']);
    expect(r.thresholds).toEqual({ watch: 1.5, act: 2, assumed: true });
    expect(r.lineFailedPct).toBe(14.55);
  });
  it('carries vsTargetG and product from the period rows only', async () => {
    setup(2, [{ id: 1, cones: 100, rate: 2 }, { id: 2, cones: 0 }]);
    const r = await run();
    expect(r.stations[0]!.vsTargetG).toBe(-4.3);
    expect(r.stations[0]!.product).toBe('P12');
    expect(r.stations[1]!.vsTargetG).toBeNull();
  });
  it('decideState: unknown line rate is ok', () => {
    expect(decideState(5, 9, null).state).toBe('ok');
  });
});
