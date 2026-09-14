/**
 * Formatting for the floor and wall screens. Production timestamps are the
 * plant's wall clock labelled as UTC (see ../format.ts), so every formatter
 * here renders in UTC on purpose — converting to the viewer's zone would
 * apply the plant's offset twice.
 */
import { S } from './strings';

const UTC = 'UTC';

/** "5:53 PM" */
export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: UTC, hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "5:53:36 PM" */
export function fmtClockSec(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: UTC, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

/** "Thu 9 Jul" */
export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: UTC, weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Thursday 9 July 2026" — for a picked day (YYYY-MM-DD). */
export function fmtDayLong(date: string): string {
  // Tolerant of both shapes: shift_date arrives as a bare production day from
  // some endpoints and as a full ISO datetime from others, and concatenating a
  // time onto the latter produced "Invalid Date" on the reading sheet.
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: UTC, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * "14/09/2026, 10:34:12" — an instant THIS SYSTEM wrote (a sync pass, an
 * audit row, the moment a raw row was read), in the viewer's own zone.
 *
 * The one formatter here that does NOT pin UTC, on purpose: these are the
 * app's genuine UTC instants, not the plant's wall clock labelled UTC (the
 * two clocks in CLAUDE.md), and pinning UTC would show a plant-PC viewer a
 * time five hours off their own wall clock. Setup's audit log rendered this
 * inline; named when the reading sheet needed the same thing (roadmap
 * Phase 3, 14 Sep 2026) so the two cannot drift.
 */
export function fmtAppInstant(iso: string): string {
  return new Date(iso).toLocaleString('en-GB');
}

/** "6 min", "3 h 12 min", "2 days" — a length of time. */
export function fmtSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
}

/** "just now", "12 s ago", "6 min ago" — time since. */
export function fmtAgo(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 5) return S.justNow;
  return `${fmtSpan(seconds)} ${S.ago}`;
}

// Number and unit are joined with a no-break space so "47.20 kg" never
// splits across two lines inside a tile.
const NBSP = String.fromCharCode(0xa0);

export function fmtG(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString('en-US')}${NBSP}g`;
}

export function fmtKg(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NBSP}kg`;
}

/**
 * The same measurements split into number and unit.
 *
 * A tile sets the unit several sizes smaller than the numeral, the way the KPI
 * cards already do, so "47.28 kg" fits a quarter-width card. Rendering it as
 * one string at one size is what pushed the unit off the edge of the wall
 * display and off the Now tiles on a narrow window.
 */
export interface Measured {
  value: string;
  unit: string;
}

export function kgParts(n: number | null | undefined): Measured {
  return n == null
    ? { value: '—', unit: '' }
    : { value: n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: 'kg' };
}

export function gParts(n: number | null | undefined): Measured {
  return n == null ? { value: '—', unit: '' } : { value: Math.round(n).toLocaleString('en-US'), unit: 'g' };
}

export function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US');
}

/**
 * A rate, to one decimal: "2.0%", "0.3%", "—".
 *
 * There was no percentage helper here until Sep 2026, and five files had
 * invented three conventions between them: `Math.round(p * 10) / 10` (drops
 * the trailing zero, so the SAME rate read "2%" in the Weight tile and "2.0%"
 * in the station table beside it), a bare `toFixed(1)`, and raw interpolation
 * of whatever the server sent. One decimal everywhere: a reject rate moves in
 * tenths, and dropping the zero makes two identical numbers look different.
 * No space before the sign — "2.0%" is one token, unlike "1,951 g".
 */
export function fmtPct1(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

/** YYYY-MM-DD plus n days (calendar arithmetic in UTC). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Seconds between two ISO timestamps, or from `a` until now-ish. */
export function secondsBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}
