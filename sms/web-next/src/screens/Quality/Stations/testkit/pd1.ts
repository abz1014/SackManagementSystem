/**
 * Real figures for the station tests: design/redesign-2026-10/mockup-data.json, fetched read-only
 * from sms_audit on 13 Oct 2026. PL is 5 Aug to 7 Sep 2026 (34 production days); PD1 is 1 Sep 2026.
 * The mock holds the API answers that exist (production by station, weight-stations, rejects,
 * machines/running); the station-status answer does not exist there, so it is rebuilt from the same
 * per-station figures using the documented rule (more than 2 times the line rate = act, more than
 * 1.5 times = watch, under 50 cones = ok, no cones = nodata). Test side only; the screen decides nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIVE_FIXTURE } from '../../../../../../web/src/testkit/fixtures';
import type { Routes } from '../../../../../../web/src/testkit/fetchRouter';

// vitest runs from sms/; the design folder sits beside it. (import.meta.url is not a file URL in jsdom.)
const FILE = resolve(process.cwd(), '..', 'design', 'redesign-2026-10', 'mockup-data.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MOCK: any = JSON.parse(readFileSync(FILE, 'utf8'));

export const META = LIVE_FIXTURE.metadata;
export type PeriodId = 'pd1' | 'pl';

export const URLS: Record<PeriodId, string> = {
  pd1: '/next/?s=quality&t=stations&p=pick&from=2026-09-01&to=2026-09-01',
  pl: '/next/?s=quality&t=stations&p=pick&from=2026-08-05&to=2026-09-07',
};

const round1 = (v: number) => Math.round(v * 10) / 10;

function decide(cones: number, rate: number | null, line: number | null): 'ok' | 'watch' | 'act' | 'nodata' {
  if (cones <= 0 || rate == null) return 'nodata';
  if (cones < 50) return 'ok';
  if (line == null || line <= 0) return 'ok';
  if (rate > 2 * line) return 'act';
  if (rate > 1.5 * line) return 'watch';
  return 'ok';
}

export function stationStatus(id: PeriodId) {
  const p = MOCK[id];
  const line: number = p.raw.weightStations.lineRejectRatePct;
  const product: string = p.derived.targetLabel;
  const stations = p.derived.perStation.map((s: { station: number; name: string; cones: number; rejectRatePctFromWeightStations: number | null; vsTargetG: number | null }) => ({
    station: s.station,
    name: s.name,
    cones: s.cones,
    failedPct: s.rejectRatePctFromWeightStations,
    state: decide(s.cones, s.rejectRatePctFromWeightStations, line),
    reasons: [],
    vsTargetG: s.cones > 0 && s.vsTargetG != null ? round1(s.vsTargetG) : null,
    product,
  }));
  return {
    data: {
      from: p.raw.weightStations.from,
      to: p.raw.weightStations.to,
      lineFailedPct: p.derived.failedInspectionPct,
      thresholds: { watch: 1.5, act: 2, minCones: 50, assumed: true },
      stations,
    },
    metadata: META,
  };
}

export function weightStations(id: PeriodId, drop: number[] = []) {
  const w = JSON.parse(JSON.stringify(MOCK[id].raw.weightStations));
  w.stations = w.stations.filter((s: { station: number }) => !drop.includes(s.station));
  return { data: w, metadata: META };
}

export function prodByStation(id: PeriodId) {
  return { data: MOCK[id].raw.prodStation, metadata: META };
}

export function prodOneStation(id: PeriodId, station: number) {
  const row = MOCK[id].raw.prodStation.rows.find((r: { group: string }) => Number(r.group) === station);
  const rows = row ? [{ ...row, group: 'all' }] : [];
  return { data: { ...MOCK[id].raw.prodStation, groupBy: 'none', rows }, metadata: META };
}

export function rejects(id: PeriodId) {
  return { data: MOCK[id].raw.rejects, metadata: META };
}

export function machinesRunning(id: PeriodId) {
  return { data: MOCK[id].raw.machinesRunning, metadata: META };
}

export const RANGE = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };

export const EMPTY_LEDGER = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 8 };

export function routes(id: PeriodId, over: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE,
    '/api/station-status': stationStatus(id),
    '/api/production': ({ search }: { search: URLSearchParams }) =>
      search.get('station') ? prodOneStation(id, Number(search.get('station'))) : prodByStation(id),
    '/api/weight-stations': weightStations(id),
    '/api/rejects': rejects(id),
    '/api/machines/running': machinesRunning(id),
    '/api/calibration/adjustments': EMPTY_LEDGER,
    ...over,
  };
}
