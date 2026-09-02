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
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: UTC, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
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
