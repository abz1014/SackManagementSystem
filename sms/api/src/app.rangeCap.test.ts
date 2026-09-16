/**
 * Defect 2 (16 Sep 2026): MAX_RANGE_DAYS used to be defined separately in
 * five places. This pins that app.ts's `validateRange` — the shared range
 * guard used by /api/attention, /api/weight-stations, /api/report,
 * /api/spc, /api/reject-spc and /api/calibration — enforces exactly
 * config.ts's exported `MAX_RANGE_DAYS`, not a local literal that could
 * silently drift from it.
 *
 * The four route-module files (routes/cone.ts, routes/rejects.ts,
 * routes/reports.ts, routes/sacks.ts) each still define their own local
 * `MAX_RANGE_DAYS = 366` / range-check function — out of this task's
 * touchable scope (owned by another worker) and therefore not changed or
 * tested here. All five agreed at 366 before this fix (see config.ts's
 * comment on MAX_RANGE_DAYS); config.test.ts pins the single exported value.
 */
import { describe, expect, it } from 'vitest';
import { validateRange } from './app.js';
import { MAX_RANGE_DAYS } from './config.js';

describe('validateRange — enforces config.ts MAX_RANGE_DAYS, not a private copy', () => {
  it('accepts a range of exactly MAX_RANGE_DAYS days', () => {
    const to = '2027-01-01';
    const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - (MAX_RANGE_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(validateRange(from, to)).toBeNull();
  });

  it('refuses MAX_RANGE_DAYS + 1 days, naming the configured limit in the message', () => {
    const to = '2027-01-01';
    const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - MAX_RANGE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const err = validateRange(from, to);
    expect(err).not.toBeNull();
    expect(err).toContain(`max ${MAX_RANGE_DAYS} days`);
  });

  it('refuses from > to regardless of range size', () => {
    expect(validateRange('2026-09-10', '2026-09-01')).toBe('from must be <= to');
  });
});
