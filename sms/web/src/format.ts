export const fmtInt = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US');

export const fmtKg = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function ageLabel(seconds: number | null): string {
  if (seconds == null) return 'no sync yet';
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function freshnessLevel(seconds: number | null): 'ok' | 'warn' | 'crit' {
  if (seconds == null) return 'crit';
  if (seconds < 300) return 'ok';
  if (seconds < 3600) return 'warn';
  return 'crit';
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hrs = Math.floor(totalMins / 60);
  const rem = totalMins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/**
 * Production-data timestamps (cone/sack/reject production time, IFL insert
 * time) are stored as the PLANT's wall clock, labelled with a UTC 'Z' suffix
 * by convention (sync-worker useUTC:true — see ARCHITECTURE §3). They must be
 * displayed in UTC, NOT converted to the viewer's local timezone, or the
 * plant's own offset gets applied twice. Genuinely server-generated
 * timestamps (sync freshness, session times, "current product since") are
 * real UTC and should keep using plain toLocaleString().
 */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

export function fmtHourLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', hour12: true })
    .replace(' ', '');
}
