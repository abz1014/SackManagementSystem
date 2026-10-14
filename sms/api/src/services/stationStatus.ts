/**
 * Station state, decided on the server (redesign task D2a).
 *
 * One answer per active station for the period on screen: how many cones it
 * weighed, what share of its inspected cones FAILED inspection, and whether
 * that is ok / watch / act compared with the line's own rate.
 *
 * THE RATE IS THE REJECTS SCREEN'S RATE. `failedPct` and `lineFailedPct` come
 * straight from `rejectRatesByStation` (weightStations.ts): rejects over
 * cones plus the rejects that are not already a cone row, the one definition
 * `rejectRateThreeWayAgreement.test.ts` pins against the Rejects headline and
 * the reports. Nothing is re-derived here.
 *
 * THE RULE (strictly greater, no rounding before comparing):
 *   - 0 cones in the period      -> 'nodata' (never 'ok': silence is not health)
 *   - 1-49 cones in the period   -> 'ok', reason "Too few cones to judge (under 50)"
 *                                   (decision E-4: a handful of cones can swing a
 *                                   rate past any multiple by chance; never watch/act)
 *   - line rate is 0             -> every station with cones is 'ok'
 *   - rate > 2.0 x line rate     -> 'act'
 *   - rate > 1.5 x line rate     -> 'watch'
 *   - otherwise                  -> 'ok'
 * The 1.5 / 2.0 multiples and the 50-cone floor are OUR assumptions, not an IFL-confirmed limit;
 * `thresholds.assumed` is true and the screen must say so.
 *
 * THE PERIOD ONLY. This is a plain count over the period on screen. It does
 * NOT use `flagged` / `projection` / drift from the 14-day detector window
 * (CLAUDE.md: the detectors ignore the period). `vsTargetG` and `product` are
 * taken only from the period rows (each station's OWN product and target),
 * and under a shift or shift range they are taken over THAT shift's cones
 * (getWeightStations' `narrowPopulation`), the same population `cones` and
 * `failedPct` count - fixed 14 Oct 2026, they used to cover the whole day.
 *
 * NO `tsTo`. The underlying count services (rejectRatesByStation,
 * getWeightStations) cannot cap by instant, so a replay instant could not be
 * honoured honestly. Decision (D2b): the option and the route parameter are
 * both dropped; the route accepts from/to (+ shift / shift range) only, and an
 * unknown `tsTo` query key is ignored rather than pretending to cap.
 */
import type { ConnectionPool } from 'mssql';
import type { ShiftRange } from '../shiftRange.js';
import { listStations } from './admin.js';
import { getWeightStations, rejectRatesByStation } from './weightStations.js';

export type StationState = 'ok' | 'watch' | 'act' | 'nodata';

export const WATCH_MULTIPLE = 1.5;
export const ACT_MULTIPLE = 2.0;
/** Fewer cones than this in the period: the rate is not judged (decision E-4). */
export const MIN_CONES = 50;

export interface StationStatusRow {
  station: number;
  name: string | null;
  cones: number;
  /** Percent of inspected cones that failed inspection; null when no cones. */
  failedPct: number | null;
  state: StationState;
  reasons: string[];
  /** Mean cone weight minus the station's own target, grams; null when none can be stated. */
  vsTargetG: number | null;
  /** The station's OWN product the target belongs to; null when mixed or unknown. */
  product: string | null;
  /**
   * Where `product`/`vsTargetG` came from: 'own' (the one material this
   * station ran), 'mixed' (several; product and vsTargetG are null), 'line'
   * (readings carry no material, the line-wide product is used), null when
   * the target context was unavailable.
   */
  productBasis: 'own' | 'mixed' | 'line' | null;
  /** Only when productBasis is 'mixed': how many materials the station ran. */
  materialsInPeriod?: number;
}

export interface StationStatusData {
  from: string;
  to: string;
  lineFailedPct: number | null;
  thresholds: { watch: number; act: number; minCones: number; assumed: true };
  stations: StationStatusRow[];
}

export interface StationStatusOptions {
  from: string;
  to: string;
  shift?: 'morning' | 'evening' | 'night' | null;
  shiftRange?: ShiftRange;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Pure decision, exported for tests. `rate` and `lineRate` are percents. */
export function decideState(
  cones: number,
  rate: number | null,
  lineRate: number | null,
): { state: StationState; reasons: string[] } {
  if (cones <= 0 || rate == null) {
    return { state: 'nodata', reasons: ['No cones weighed in this period'] };
  }
  if (cones < MIN_CONES) {
    return { state: 'ok', reasons: [`Too few cones to judge (under ${MIN_CONES})`] };
  }
  if (lineRate == null || lineRate <= 0) return { state: 'ok', reasons: [] };
  if (rate > ACT_MULTIPLE * lineRate) {
    return { state: 'act', reasons: [`More than ${ACT_MULTIPLE} times the line rate (over ${round(ACT_MULTIPLE * lineRate, 1)} %)`] };
  }
  if (rate > WATCH_MULTIPLE * lineRate) {
    return { state: 'watch', reasons: [`More than ${WATCH_MULTIPLE} times the line rate (over ${round(WATCH_MULTIPLE * lineRate, 1)} %)`] };
  }
  return { state: 'ok', reasons: [] };
}

export async function getStationStatus(
  pool: ConnectionPool,
  lineId: number,
  opts: StationStatusOptions,
): Promise<StationStatusData> {
  const { from, to } = opts;
  const [stationRows, rates] = await Promise.all([
    listStations(pool, lineId),
    rejectRatesByStation(pool, lineId, from, to, undefined, opts.shiftRange, opts.shift ?? null),
  ]);

  const denom = rates.totalCones + rates.totalUnmatchedRejects;
  const lineRate = denom > 0 ? (100 * rates.totalRejects) / denom : null;

  // Optional target context. Never let it break the state decision.
  const targets = new Map<number, number | null>();
  const products = new Map<number, { label: string | null; basis: 'own' | 'mixed' | 'line'; materials?: number }>();
  try {
    const w = await getWeightStations(pool, lineId, from, to, undefined, {
      from, to, shiftRange: opts.shiftRange, shift: opts.shift ?? null, narrowPopulation: true,
    });
    for (const s of w.stations) {
      targets.set(s.station, s.n > 0 ? s.vsTargetG : null);
      const basis = s.targetBasis === 'station_material' ? 'own' : s.targetBasis === 'mixed' ? 'mixed' : 'line';
      products.set(s.station, {
        label: basis === 'mixed' ? null : (s.targetProductLabel ?? (basis === 'line' ? (w.productLabel ?? null) : null)),
        basis,
        materials: s.materialsInWindow,
      });
    }
  } catch {
    /* target context unavailable: the state is unaffected */
  }

  const stations: StationStatusRow[] = stationRows
    .filter((s) => s.isActive)
    .map((s) => {
      const cones = rates.cones.get(s.stationId) ?? 0;
      const rate = cones > 0 ? (rates.rates.get(s.stationId) ?? null) : null;
      const { state, reasons } = decideState(cones, rate, lineRate);
      const vs = targets.get(s.stationId);
      const pr = products.get(s.stationId);
      return {
        station: s.stationId,
        name: s.name,
        cones,
        failedPct: rate == null ? null : round(rate, 2),
        state,
        reasons,
        vsTargetG: vs == null ? null : round(vs, 1),
        product: pr?.label ?? null,
        productBasis: pr?.basis ?? null,
        ...(pr?.basis === 'mixed' && pr.materials != null ? { materialsInPeriod: pr.materials } : {}),
      };
    });

  return {
    from,
    to,
    lineFailedPct: lineRate == null ? null : round(lineRate, 2),
    thresholds: { watch: WATCH_MULTIPLE, act: ACT_MULTIPLE, minCones: MIN_CONES, assumed: true },
    stations,
  };
}
