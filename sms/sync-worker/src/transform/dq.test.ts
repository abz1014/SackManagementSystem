import { describe, it, expect } from 'vitest';
import { computeFindings } from './dq.js';

const ms = (iso: string) => new Date(iso + 'Z').getTime();

/** A cone as the transform hands it to the DQ pass: source-id order, wall clock stamped as UTC. */
const cone = (iso: string, weight: number | null = 1950, source_station: number | null = 7) => ({
  production_ts_utc_ms: ms(iso),
  merge_key_is_unique: true,
  weight_g: weight,
  source_station,
});
const run = (rows: ReturnType<typeof cone>[]) =>
  computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g);
const find = (rows: ReturnType<typeof cone>[], check: string) =>
  run(rows).find((f) => f.check_name === check);

describe('stale_timestamp (station clock faults)', () => {
  it('ignores the ordinary backwards jitter of stations buffering at different rates', () => {
    // measured on the 142,511-row copy: median 1 min behind, p99 5 min, p99.99 33 min
    const rows = [
      cone('2026-06-22T11:14:12'),
      cone('2026-06-22T11:09:56'), // 4m behind
      cone('2026-06-22T10:45:27'), // 29m behind
      cone('2026-06-22T11:10:17'),
    ];
    expect(find(rows, 'stale_timestamp')).toBeUndefined();
  });

  it('flags a reading stamped a day before the readings around it', () => {
    // the real fault: cone_event_id 12278, 27h behind its neighbours, which put
    // a phantom 2-row production day in front of every date picker in the app
    const rows = [
      cone('2026-06-22T11:10:17'),
      cone('2026-06-22T11:10:38'),
      cone('2026-06-21T08:06:54'), // 27h behind
      cone('2026-06-22T10:45:27'),
    ];
    const f = find(rows, 'stale_timestamp');
    expect(f).toBeDefined();
    expect(f!.count).toBe(1);
    expect(f!.severity).toBe('WARNING');
    expect(f!.detail).toMatch(/27h/);
  });

  it('flags a same-day fault that still lands on the previous shift_date', () => {
    // cone_event_id 12323: 03:46 is a real date but 7.5h behind its neighbours,
    // and 03:46 derives to the PREVIOUS day's night shift — a wrong timestamp
    // producing a correctly-derived but phantom shift_date
    const rows = [
      cone('2026-06-22T11:18:56'),
      cone('2026-06-22T11:19:17'),
      cone('2026-06-22T03:46:40'), // 7.5h behind
    ];
    expect(find(rows, 'stale_timestamp')!.count).toBe(1);
  });

  it('measures lag against the running maximum, not the previous row', () => {
    // one late arrival must not re-baseline the clock and mask the next fault
    const rows = [
      cone('2026-06-22T12:00:00'),
      cone('2026-06-22T02:00:00'), // 10h behind -> fault
      cone('2026-06-22T02:00:30'), // 10h behind the MAX, only 30s after its predecessor
    ];
    expect(find(rows, 'stale_timestamp')!.count).toBe(2);
  });

  it('says nothing when the stream is clean', () => {
    const rows = [
      cone('2026-06-22T11:00:00'),
      cone('2026-06-22T11:00:20'),
      cone('2026-06-22T11:00:41'),
    ];
    expect(run(rows).map((f) => f.check_name)).not.toContain('stale_timestamp');
  });
});

describe('no_station (unattributable readings)', () => {
  it('counts rows the transform could not attribute to a position', () => {
    // the source sends 0 for "no station"; the transform normalises it to null,
    // and all three such rows in the copy are the epoch-clock faults
    const rows = [
      cone('2026-06-22T11:00:00', 1950, 7),
      cone('2026-06-22T11:00:20', 1950, null),
      cone('2026-06-22T11:00:40', 1950, 14),
    ];
    const f = find(rows, 'no_station');
    expect(f).toBeDefined();
    expect(f!.count).toBe(1);
    expect(f!.severity).toBe('WARNING');
  });

  it('stays silent when every reading has a position', () => {
    const rows = [cone('2026-06-22T11:00:00', 1950, 1), cone('2026-06-22T11:00:20', 1950, 14)];
    expect(find(rows, 'no_station')).toBeUndefined();
  });
});

describe('existing checks still hold', () => {
  it('separates non-positive weights from sub-floor outliers', () => {
    const rows = [cone('2026-06-22T11:00:00', 0), cone('2026-06-22T11:00:20', 900), cone('2026-06-22T11:00:40', 1950)];
    expect(find(rows, 'nonpositive_weight')!.count).toBe(1);
    expect(find(rows, 'outlier_weight')!.count).toBe(1);
  });

  it('does not raise a finding with a zero count', () => {
    expect(run([cone('2026-06-22T11:00:00')]).every((f) => f.count > 0)).toBe(true);
  });
});
