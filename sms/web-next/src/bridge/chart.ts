/**
 * Bridge to the existing chart base (decision E-3: reuse, restyle through classes).
 * web-next code imports chart machinery from here and from nowhere else.
 */
export { ChartFrame, zoomHint } from '../../../web/src/ui/ChartFrame';
export type {
  ChartFrameProps,
  ChartFrameSize,
  ChartFrameState,
  ChartFrameZoom,
  ChartTip,
  ChartTipRow,
} from '../../../web/src/ui/ChartFrame';
export { linear, niceDomain, gridValues, linePath, fittingTicks, tickIndices, NoChartData } from '../../../web/src/ui/chart';
export type { Scale } from '../../../web/src/ui/chart';
export { bandHit, nearestIndex, leftGutterFor, textPx } from '../../../web/src/ui/chartLayout';
export type { Rect } from '../../../web/src/ui/chartLayout';
export { useChartSize } from '../../../web/src/ui/useChartSize';
export type { PeriodParams } from '../../../web/src/lib/period';
