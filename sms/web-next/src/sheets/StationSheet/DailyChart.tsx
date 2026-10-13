/**
 * The station's daily mean weight over the pattern window, with the product tolerance as a band
 * when one was in force, and the days before the newest adjustment drawn grey (they describe a
 * scale that no longer exists). A click on a day sets the WHOLE-page period to that day's shifts
 * (TRACE A7-03); a "Zoomed in - Back" control is offered while the period is a zoomed range.
 *
 * THE TWO CLOCKS: the ledger's instants are genuine UTC, the daily means are production days on
 * the plant clock. The adjustment is placed on the day whose END is at or after it, through the
 * offset the API reports (lib/plantClock), never by comparing strings.
 */
import { LineChart } from '../../charts';
import type { LimitSpec } from '../../charts';
import type { PeriodParams } from '../../bridge/chart';
import { period as P, plantClock, fmt } from '../../bridge/lib';
import { C, formatDate, FRAGMENTS } from '../../copy';

const S = C.qualityStations;
const SF = FRAGMENTS.qualityStations;

export interface DailyPoint {
  date: string;
  n: number;
  mean: number;
  nelson: number[];
}

export interface DailyChartProps {
  stationLabel: string;
  days: readonly DailyPoint[];
  /** Genuine-UTC instants of this station's and the line-wide adjustments. */
  adjustedAtUtc: readonly string[];
  offsetMinutes: number;
  /** The product tolerance in force for the line; null when none (or when this station has no single target). */
  limits: { loG: number; hiG: number } | null;
  zoomed: boolean;
  onZoom: (p: PeriodParams) => void;
  onRetry?: () => void;
}

const axisLabel = (date: string) => formatDate(date).replace(/ \d{4}$/, '');

/** Index of the production day the newest adjustment falls on; -1 when there is none. */
export function adjustmentIndex(days: readonly DailyPoint[], adjustedAtUtc: readonly string[], offsetMinutes: number): number {
  if (adjustedAtUtc.length === 0) return -1;
  const newest = [...adjustedAtUtc].sort().slice(-1)[0]!;
  return days.findIndex((d) => plantClock.dayEndsAtOrAfter(d.date, newest, offsetMinutes));
}

export function DailyChart(p: DailyChartProps) {
  const adj = adjustmentIndex(p.days, p.adjustedAtUtc, p.offsetMinutes);
  const means = p.days.map((d) => d.mean);
  const series =
    adj > 0
      ? [
          { name: S.seriesSince, values: means.map((v, i) => (i >= adj ? v : null)), slot: 1 },
          { name: S.seriesBefore, values: means.map((v, i) => (i <= adj ? v : null)), slot: 6 },
        ]
      : [{ name: p.stationLabel, values: means, slot: 1 }];
  const limits: LimitSpec | undefined = p.limits
    ? { lower: p.limits.loG, upper: p.limits.hiG, lowerText: fmt.fmtG(p.limits.loG), upperText: fmt.fmtG(p.limits.hiG) }
    : undefined;

  return (
    <LineChart
      chartId="station-sheet-daily"
      title={S.dailyTitle}
      unit="g"
      caption={limits ? S.limitsNote : undefined}
      categories={p.days.map((d) => axisLabel(d.date))}
      series={series}
      limits={limits}
      defaultH={190}
      errorPart={SF.chartPart}
      onRetry={p.onRetry}
      periodFor={(i) => {
        const d = p.days[i]?.date;
        if (!d) return null;
        const r = P.dayToShiftRange(d, d);
        return P.snapToShifts(r.from, r.to);
      }}
      onZoom={p.onZoom}
      onBack={p.zoomed ? () => window.history.back() : undefined}
    />
  );
}
