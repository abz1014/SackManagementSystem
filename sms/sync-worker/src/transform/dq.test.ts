import { describe, it, expect } from 'vitest';
import { plantNowMs } from '@sms/shared';
import { computeFindings, stationRosterFindings, CHECK_NAMES, PER_SUBJECT_CHECKS } from './dq.js';

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

describe('future_timestamp measures against the plant WALL clock, not real UTC (Aug 2026 audit)', () => {
  // production_ts_utc_ms is the plant's wall clock labelled as UTC. On a UTC+5
  // plant, a cone produced RIGHT NOW carries a ms value 5h ahead of Date.now()
  // — the old real-UTC comparison flagged every live reading as "future",
  // an error invisible in dev against weeks-old data. Uses the same
  // plantNowMs() the production code calls (finding L2, Sep 2026 audit) —
  // asserting against an independently hand-rolled copy would only prove the
  // two copies still agreed today, not that the behavior is correct.
  const wallNow = plantNowMs;

  it('does not flag a reading stamped at the current wall clock', () => {
    const rows = [{ production_ts_utc_ms: wallNow(), merge_key_is_unique: true, weight_g: 1950, source_station: 7 }];
    expect(computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g).find((f) => f.check_name === 'future_timestamp')).toBeUndefined();
  });

  it('does not flag ordinary source-clock skew (30 minutes ahead)', () => {
    const rows = [{ production_ts_utc_ms: wallNow() + 30 * 60_000, merge_key_is_unique: true, weight_g: 1950, source_station: 7 }];
    expect(computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g).find((f) => f.check_name === 'future_timestamp')).toBeUndefined();
  });

  it('still flags a reading stamped two days ahead', () => {
    const rows = [{ production_ts_utc_ms: wallNow() + 2 * 86_400_000, merge_key_is_unique: true, weight_g: 1950, source_station: 7 }];
    const f = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g).find((x) => x.check_name === 'future_timestamp');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('ERROR');
  });
});

describe('stale_timestamp across an incremental batch boundary (initialMaxMs)', () => {
  it('catches a lagging row at the START of a batch when seeded with canonical history', () => {
    // one row, 27h behind the newest row already in canonical — with no seed
    // it has nothing to lag behind and would pass silently
    const rows = [cone('2026-06-21T08:06:54')];
    const seeded = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g, ms('2026-06-22T11:10:38'));
    expect(seeded.find((f) => f.check_name === 'stale_timestamp')).toBeDefined();
    const unseeded = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g);
    expect(unseeded.find((f) => f.check_name === 'stale_timestamp')).toBeUndefined();
  });
});

/**
 * `station_not_in_roster` (roadmap Phase 1, 14 Sep 2026): a machine number
 * the line has no station row for. One finding per (machine, source table,
 * generation) — every one of those facts is in the detail, which is what
 * persistFindings dedups on — so a standing fault is recorded once and a
 * fifteenth winder shows up as one line on Setup, not one per pass.
 */
describe('station_not_in_roster (machines the line has no station for)', () => {
  const roster = { lineId: 1, stations: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) };
  const row = (station: number | null, epoch = 9) => ({
    production_ts_utc_ms: ms('2026-09-01T11:00:00'),
    source_station: station,
    source_epoch: epoch,
  });

  it('raises one WARNING for an unknown machine number, naming table, generation and line', () => {
    const f = stationRosterFindings([row(7), row(15), row(15)], roster, 'cone_raw', 'pack1_TP1U2');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ check_name: 'station_not_in_roster', severity: 'WARNING', subject_table: 'cone_raw', count: 2 });
    expect(f[0]!.detail).toBe(
      'machine number 15 observed in pack1_TP1U2 (generation 9) is not a station on line 1 — add it in Setup › Machines',
    );
  });

  it('raises nothing for a known machine number', () => {
    expect(stationRosterFindings([row(1), row(14)], roster, 'cone_raw', 'pack1_TP1U2')).toEqual([]);
  });

  it('ignores rows with no station at all — that is no_station, a different fault', () => {
    expect(stationRosterFindings([row(null)], roster, 'cone_raw', 'pack1_TP1U2')).toEqual([]);
  });

  it('is one finding per (machine, generation), ordered, so the same fault under a new generation is a new line', () => {
    const f = stationRosterFindings([row(16, 9), row(15, 10), row(15, 9)], roster, 'reject_qcs_raw', 'rejectQCS1_TP1U2');
    expect(f.map((x) => x.detail)).toEqual([
      'machine number 15 observed in rejectQCS1_TP1U2 (generation 9) is not a station on line 1 — add it in Setup › Machines',
      'machine number 16 observed in rejectQCS1_TP1U2 (generation 9) is not a station on line 1 — add it in Setup › Machines',
      'machine number 15 observed in rejectQCS1_TP1U2 (generation 10) is not a station on line 1 — add it in Setup › Machines',
    ]);
  });

  it('is registered as a check name and as a per-subject check', () => {
    expect(CHECK_NAMES).toContain('station_not_in_roster');
    expect(PER_SUBJECT_CHECKS.has('station_not_in_roster')).toBe(true);
    // the count-style checks computeFindings raises are all registered too
    for (const f of computeFindings([cone('2026-06-22T11:00:00', 0, null)], 'cone', 'cone_event', (r) => r.weight_g)) {
      expect(CHECK_NAMES).toContain(f.check_name);
    }
  });
});

/**
 * subject_ref (roadmap Phase 3 item 3): a finding about rows names the raw_id
 * of the FIRST offending row, so the reading is one query away; the count
 * stays in count.
 */
describe('subject_ref points at the first offending row', () => {
  const withRaw = (iso: string, raw_id: number, weight: number | null = 1950, station: number | null = 7) => ({
    ...cone(iso, weight, station),
    raw_id,
  });

  it('stale_timestamp carries the first stale row, not the last, and the count of all of them', () => {
    const rows = [
      withRaw('2026-06-22T12:00:00', 100),
      withRaw('2026-06-22T02:00:00', 101), // 10h behind
      withRaw('2026-06-22T02:00:30', 102), // also behind the max
    ];
    const f = run(rows).find((x) => x.check_name === 'stale_timestamp')!;
    expect(f.count).toBe(2);
    expect(f.subject_ref).toBe(101);
  });

  it('nonpositive_weight, outlier_weight, no_station and future_timestamp each name their first row', () => {
    const rows = [
      withRaw('2026-06-22T11:00:00', 1, 0), // impossible
      withRaw('2026-06-22T11:00:10', 2, -5),
      withRaw('2026-06-22T11:00:20', 3, 900), // outlier
      withRaw('2026-06-22T11:00:30', 4, 1950, null), // no station
      withRaw('2099-01-01T00:00:00', 5), // future
    ];
    const by = Object.fromEntries(run(rows).map((f) => [f.check_name, f]));
    expect(by.nonpositive_weight!.subject_ref).toBe(1);
    expect(by.nonpositive_weight!.count).toBe(2);
    expect(by.outlier_weight!.subject_ref).toBe(3);
    expect(by.no_station!.subject_ref).toBe(4);
    expect(by.future_timestamp!.subject_ref).toBe(5);
  });

  it('station_not_in_roster names the first row seen from that machine', () => {
    const roster = { lineId: 1, stations: new Set([1, 2, 3]) };
    const rows = [
      { production_ts_utc_ms: ms('2026-09-01T11:00:00'), source_station: 15, source_epoch: 9, raw_id: 501 },
      { production_ts_utc_ms: ms('2026-09-01T11:00:05'), source_station: 15, source_epoch: 9, raw_id: 502 },
    ];
    const f = stationRosterFindings(rows, roster, 'cone_raw', 'pack1_TP1U2');
    expect(f[0]!.subject_ref).toBe(501);
    expect(f[0]!.count).toBe(2);
  });

  it('is null, not undefined, when the rows carry no raw_id (a pure computation over plain rows)', () => {
    const f = run([cone('2026-06-22T11:00:00', 0)]).find((x) => x.check_name === 'nonpositive_weight')!;
    expect(f.subject_ref).toBeNull();
  });
});

describe('outlier_weight reads the plausibility rule (roadmap Phase 4)', () => {
  it('flags a reading above the ceiling as well as below the floor — the 2200-2354 g fault population', () => {
    const rows = [cone('2026-06-22T11:00:00', 2300), cone('2026-06-22T11:00:20', 900), cone('2026-06-22T11:00:40', 1950)];
    const f = find(rows, 'outlier_weight');
    expect(f!.count).toBe(2);
    expect(f!.detail).toMatch(/1500-2100g/);
    expect(f!.detail).toMatch(/not yet confirmed by IFL/);
  });

  it('applies the bounds it is given, not the historical constants', () => {
    const rows = [cone('2026-06-22T11:00:00', 1450), cone('2026-06-22T11:00:20', 2150)];
    const wide = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g, -Infinity, { coneLoG: 1400, coneHiG: 2200, sackLoKg: 40, sackHiKg: 60 });
    expect(wide.find((f) => f.check_name === 'outlier_weight')).toBeUndefined();
    const narrow = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g, -Infinity, { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
    expect(narrow.find((f) => f.check_name === 'outlier_weight')!.count).toBe(2);
  });

  it('uses the sack bounds for sacks', () => {
    const sacks = [{ production_ts_utc_ms: 1, merge_key_is_unique: true, weight_kg: 39 }, { production_ts_utc_ms: 2, merge_key_is_unique: true, weight_kg: 61 }];
    const f = computeFindings(sacks, 'sack', 'sack_event', (r) => r.weight_kg).find((x) => x.check_name === 'outlier_weight');
    expect(f!.count).toBe(2);
    expect(f!.detail).toMatch(/40-60kg/);
  });
});
