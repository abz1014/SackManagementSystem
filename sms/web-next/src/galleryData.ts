/*
 * Figures for the gallery, taken from design/redesign-2026-10/mockup-data.json (read-only copy sms_audit,
 * production day 1 Sep 2026). The states below are ILLUSTRATIVE: in the product the server decides them
 * (api/src/services/stationStatus.ts); the gallery only needs one of each to show every look.
 */
import type { StationItem } from './ui/StationTile';
import type { HistogramBin, ParetoRow } from './charts';

export const GALLERY_STATIONS: StationItem[] = [
  { station: 1, name: null, cones: 801, failedPct: 0.87, state: 'ok', reasons: [], vsTargetG: -5.9, product: '201-IH0-SD' },
  { station: 2, name: null, cones: 789, failedPct: 1.01, state: 'ok', reasons: [], vsTargetG: -8.1, product: '201-IH0-SD' },
  { station: 3, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 4, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 5, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 6, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 7, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 8, name: null, cones: 412, failedPct: 53.86, state: 'act', reasons: [], vsTargetG: -4.6, product: '201-IH0-SD' },
  { station: 9, name: null, cones: 357, failedPct: 23.12, state: 'act', reasons: [], vsTargetG: -6.8, product: '201-IH0-SD' },
  { station: 10, name: null, cones: 397, failedPct: 20.6, state: 'act', reasons: [], vsTargetG: -8.5, product: '201-IH0-SD' },
  { station: 11, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 12, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null },
  { station: 13, name: null, cones: 82, failedPct: 3.66, state: 'watch', reasons: [], vsTargetG: -9.0, product: '201-IH0-SD' },
  { station: 14, name: null, cones: 251, failedPct: 17.93, state: 'watch', reasons: [], vsTargetG: -3.9, product: '201-IH0-SD' },
];

export const GALLERY_PARETO: ParetoRow[] = [
  { label: "Tube 2 - Mat 1", count: 440, cumulativePct: 97.6 },
  { label: "Tube 1 - Mat 2", count: 5, cumulativePct: 98.7 },
  { label: "Tube 1 - Mat 1", count: 4, cumulativePct: 99.6 },
  { label: "Tube 10 - Mat 1", count: 1, cumulativePct: 99.8 },
  { label: "Tube 2 - Mat 2", count: 1, cumulativePct: 100 },
];

export const GALLERY_HISTOGRAM: HistogramBin[] = [
  { from: 1920, to: 1922, count: 1 },
  { from: 1922, to: 1924, count: 1 },
  { from: 1926, to: 1928, count: 1 },
  { from: 1928, to: 1930, count: 3 },
  { from: 1930, to: 1932, count: 8 },
  { from: 1932, to: 1934, count: 10 },
  { from: 1934, to: 1936, count: 15 },
  { from: 1936, to: 1938, count: 16 },
  { from: 1938, to: 1940, count: 23 },
  { from: 1940, to: 1942, count: 50 },
  { from: 1942, to: 1944, count: 87 },
  { from: 1944, to: 1946, count: 102 },
  { from: 1946, to: 1948, count: 184 },
  { from: 1948, to: 1950, count: 231 },
  { from: 1950, to: 1952, count: 265 },
  { from: 1952, to: 1954, count: 324 },
  { from: 1954, to: 1956, count: 368 },
  { from: 1956, to: 1958, count: 372 },
  { from: 1958, to: 1960, count: 303 },
  { from: 1960, to: 1962, count: 279 },
  { from: 1962, to: 1964, count: 189 },
  { from: 1964, to: 1966, count: 132 },
  { from: 1966, to: 1968, count: 71 },
  { from: 1968, to: 1970, count: 32 },
  { from: 1970, to: 1972, count: 9 },
  { from: 1972, to: 1974, count: 9 },
  { from: 1974, to: 1976, count: 2 },
  { from: 1976, to: 1978, count: 2 },
];

export const GALLERY_HOURS: string[] = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00'];
export const GALLERY_HOURLY_FAILED_PCT: number[] = [1.4, 26.1, 3.1, 6.4, 13.0, 30.1, 22.6, 8.1, 0, 16.9, 19.6, 24.0, 4.2, 19.0, 13.8, 16.2, 4.4, 17.8, 10.7, 0, 14.5, 13.3, 14.1];
export const GALLERY_LIMITS = { lower: 1920, upper: 2000, lowerText: '1,920 g', upperText: '2,000 g' };
