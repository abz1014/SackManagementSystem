import type { ReactNode } from 'react';
import type { PeriodParams } from '../bridge/chart';

export type ChartStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface ChartReserve {
  legend?: boolean;
  captionLines?: number;
}

/** State and chrome props every chart in the kit shares. */
export interface ChartCommonProps {
  /** Stable id: keeps the dragged height and keys the zoom origin. */
  chartId: string;
  title: string;
  /** Unit of the y axis ("g", "cones", "%"). Always shown beside the axis. */
  unit: string;
  caption?: ReactNode;
  status?: ChartStatus;
  /** Names the failed part: "the reject chart" -> "Couldn't load the reject chart." */
  errorPart?: string;
  onRetry?: () => void;
  /** Empty-state sentence; defaults to "Nothing in this period." */
  emptyMessage?: string;
  /** Empty-state action, e.g. "Show newest data". */
  emptyAction?: { label: string; onClick: () => void };
  defaultH?: number;
  /**
   * What the loaded chart will add around the plot, so the loading card is the same height (fix-wave M-15):
   * a legend row, and how many caption lines (the caption shows once above the plot as the readout and once below it).
   */
  reserve?: ChartReserve;
  /** Click-to-zoom: a mark's period (null = nothing to zoom to) and what to do with it. */
  periodFor?: (i: number) => PeriodParams | null;
  onZoom?: (p: PeriodParams) => void;
  onBack?: () => void;
  formatValue?: (v: number) => string;
}

export interface LimitSpec {
  lower: number;
  upper: number;
  /** Already formatted, e.g. "1,910 g". */
  lowerText: string;
  upperText: string;
}

export interface Margins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Top margin of a plot. The axis titles (unit, "Cumulative share (%)") sit in a reserved band above the
 * top tick, so a title can never overprint a tick label (fix-wave D8 / M-18). Scales with the text size.
 */
export const chartTop = (fontPx: number): number => Math.ceil(fontPx * 2) + 4;

/** Categorical slot -> css variable. Slots 1, 2 and 5 are the all-pairs-safe set. */
export function catVar(slot: number): string {
  return slot >= 1 && slot <= 5 ? `var(--cat-${slot})` : 'var(--cat-other)';
}

export const defaultFormat = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
