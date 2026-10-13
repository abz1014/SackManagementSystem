/**
 * Chart-kit strings. Existing wording is re-used from the old app's `W.chart`
 * (via the bridge) and from the copy table `C`; the few words only the kit
 * needs live here until the glossary owner moves them into copy.ts
 * (TODO: fold into copy.ts, which another worker is editing at the time of writing).
 */
import { C } from '../copy';
import { W } from '../bridge/words';

export const CHART_COPY = {
  showAsTable: 'Show as table',
  showAsChart: 'Show as chart',
  inLimits: 'In limits',
  upperLimit: (v: string) => `Upper limit ${v}`,
  lowerLimit: (v: string) => `Lower limit ${v}`,
  cumulative: 'Cumulative share',
  cumulativeAxis: 'Cumulative share (%)',
  eightyLine: '80 %',
  vitalFew: (k: number, total: number) =>
    k === 1 ? `1 of ${total} reasons makes up most of the rejects.` : `${k} of ${total} reasons make up most of the rejects.`,
  binWidth: (w: string, unit: string) => `Each bar is ${w}${unit ? ` ${unit}` : ''} wide.`,
  loading: 'Loading',
  tableCaption: (title: string) => `${title}, as a table`,
  noValue: 'No value',
  outside: 'Outside limits',
  zoomedBack: W.chart.zoomedBack,
  couldntLoad: C.couldntLoad,
  tryAgain: C.tryAgain,
  nothingInPeriod: C.nothingInPeriodNoNewest,
} as const;
