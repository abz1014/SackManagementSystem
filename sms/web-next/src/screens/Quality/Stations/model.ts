/**
 * Pure model of the Stations table: joins the three server answers (state, per-station counts,
 * 14-day pattern) into one row per station. It decides nothing: the state arrives decided
 * (stationStatus.ts), the pattern verdict arrives decided (weightStations.ts), and a figure
 * that could not be read stays null so the screen can say so instead of printing a zero.
 */
import type { ProductionRow, StationStatusRow, WeightStationRow, WeightStationsData } from '../../../bridge/api';
import { W } from '../../../bridge/words';
import { fmt } from '../../../bridge/lib';
import type { UiState } from '../../../ui/StatusPill';

export const STATE_ORDER: Record<UiState, number> = { act: 0, watch: 1, ok: 2, nodata: 3 };

/** One decimal, grouped: 1950.1 -> "1,950.1". */
export function g1(v: number): string {
  return v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "+9.9 g" / "−9.9 g" (a real minus sign); a value that rounds to zero carries no sign. */
export function signedG(v: number | null): string | null {
  if (v == null) return null;
  const text = `${g1(Math.abs(v))} g`;
  return Math.round(v * 10) === 0 ? text : `${v > 0 ? '+' : '−'}${text}`;
}

/** "14.5 %" to the given decimals; null stays null. */
export function pct(v: number | null, decimals = 1): string | null {
  return v == null ? null : `${v.toFixed(decimals)} %`;
}

export type TargetCell =
  | { kind: 'value'; text: string; lineProduct: boolean }
  | { kind: 'mixed'; materials: number }
  | { kind: 'none' }
  | { kind: 'nodata' }
  | { kind: 'unavailable' };

export type PatternCell =
  | { kind: 'unavailable' }
  | { kind: 'nodata' }
  | { kind: 'clear'; days: number }
  | { kind: 'flag'; days: number; text: string };

export interface StationRowModel {
  station: number;
  name: string | null;
  state: UiState;
  cones: number;
  failedPct: number | null;
  /** Rejected cones in the period; null when the counts could not be read or the station has none listed. */
  failedN: number | null;
  /** Share of cones the scale itself failed; null when unknown. */
  weightFailPct: number | null;
  target: TargetCell;
  product: string | null;
  productBasis: 'own' | 'mixed' | 'line' | null;
  pattern: PatternCell;
}

export function patternOf(row: WeightStationRow | undefined, data: WeightStationsData | null): PatternCell {
  if (!data) return { kind: 'unavailable' };
  if (!row) return { kind: 'nodata' };
  const days = row.days.filter((d) => d.nelson.length > 0).length;
  if (!row.flagged) return { kind: 'clear', days };
  const g = fmt.fmtG(Math.abs(row.vsLineG));
  const text = row.vsLineG > 0 ? W.weight.readsHeavier(g, row.daysHeld) : W.weight.readsLighter(g, row.daysHeld);
  return { kind: 'flag', days, text };
}

export function targetOf(s: StationStatusRow, ws: WeightStationRow | undefined, data: WeightStationsData | null): TargetCell {
  const signed = signedG(s.vsTargetG);
  if (signed != null) return { kind: 'value', text: signed, lineProduct: ws?.targetBasis === 'line_product' };
  if (s.cones <= 0) return { kind: 'nodata' };
  if (!data) return { kind: 'unavailable' };
  if (!ws) return { kind: 'nodata' };
  if (ws.targetBasis === 'mixed') return { kind: 'mixed', materials: ws.materialsInWindow ?? 2 };
  return { kind: 'none' };
}

export function buildRows(
  status: readonly StationStatusRow[],
  counts: readonly ProductionRow[] | null,
  data: WeightStationsData | null,
): StationRowModel[] {
  const byCounts = new Map<number, ProductionRow>();
  for (const r of counts ?? []) byCounts.set(Number(r.group), r);
  const byWs = new Map<number, WeightStationRow>();
  for (const r of data?.stations ?? []) byWs.set(r.station, r);

  return status.map((s) => {
    const c = byCounts.get(s.station);
    const ws = byWs.get(s.station);
    return {
      station: s.station,
      name: s.name,
      state: s.state,
      cones: s.cones,
      failedPct: s.failedPct,
      failedN: c ? c.rejectedCones : null,
      weightFailPct: c && c.conesInRangePct != null ? Math.max(0, 100 - c.conesInRangePct) : null,
      target: targetOf(s, ws, data),
      product: s.product,
      productBasis: s.productBasis ?? null,
      pattern: patternOf(ws, data),
    };
  });
}

/** Worst first: Act, Watch, OK, No data; inside a state the higher failed-inspection rate first. */
export function sortWorstFirst(rows: readonly StationRowModel[]): StationRowModel[] {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.failedPct == null && b.failedPct != null) return 1;
    if (b.failedPct == null && a.failedPct != null) return -1;
    const byRate = a.failedPct != null && b.failedPct != null ? b.failedPct - a.failedPct : 0;
    return byRate !== 0 ? byRate : a.station - b.station;
  });
}

/** Stations whose weight figures are missing from the 14-day feed, for the note under the table. */
export function missingFromFeed(rows: readonly StationRowModel[]): number[] {
  return rows.filter((r) => r.pattern.kind === 'nodata' && r.cones > 0).map((r) => r.station).sort((a, b) => a - b);
}
