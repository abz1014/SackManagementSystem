/**
 * `isolated_production_day` — RT24-09's read-only DQ check (24 Sep 2026,
 * `ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md`).
 *
 * WHAT IT CATCHES. `api/src/services/generation.ts::resolveGenerationScope`
 * keys a window on `shift_date` alone, with no check that a row is
 * temporally plausible for its own source generation. A well-formed 2026
 * row can carry a `shift_date` that lands inside a documented "no data" gap
 * for its generation (the observed case: `DATA_TP1U2_SEP07.pack1_TP1U2`
 * id=4130, `ProductionDate` 2026-07-12, `source_epoch` 9 — squarely inside
 * the 10 Jul -> 5 Aug gap that generation otherwise has zero rows in). The
 * existing clock-fault filter (`CLOCK_FAULT_BEFORE_MS` in dq.ts) is a Y2K
 * floor and cannot catch a plausible date in the wrong week.
 *
 * THE RULE. For each `source_epoch`, a `shift_date` with fewer than
 * MIN_DENSE_ROWS rows is flagged WARNING when either:
 *   - none of the NEIGHBOR_WINDOW_DAYS days on either side (same generation)
 *     have any row at all, or
 *   - the date falls outside the generation's own "dense" coverage range —
 *     the span from its first to its last day carrying >= MIN_DENSE_ROWS
 *     rows.
 * Nothing is deleted and no API changes here — the row stays exactly as
 * ingested; this only raises a finding an operator can act on.
 *
 * KNOWN CLOCK FAULTS. 1969-12-31 and 2026-06-21 are already-documented
 * sentinel/outlier dates (CLAUDE.md, `CLOCK_FAULT_BEFORE_MS` in dq.ts,
 * `sackBlackoutFindings`) and are excluded here rather than re-flagged.
 *
 * SCOPE. `cone_event` only, mirroring `shiftRuleDrift.ts`'s scope — RT24-09
 * itself was found on `pack1_TP1U2` (cones). Read-only: one GROUP BY query
 * per pass, no table scan of raw rows.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { Finding } from './dq.js';

/** Below this many rows on a shift_date, the day is a candidate for isolation. */
export const MIN_DENSE_ROWS = 5;

/** How many days either side to look for ANY neighbouring row, same generation. */
export const NEIGHBOR_WINDOW_DAYS = 3;

/** Already-documented clock-fault/outlier dates, handled elsewhere — never re-flagged here. */
const KNOWN_CLOCK_FAULT_DATES: ReadonlySet<string> = new Set(['1969-12-31', '2026-06-21']);

const DAY_MS = 86_400_000;

export interface DayCount {
  source_epoch: number;
  /** 'YYYY-MM-DD' */
  shift_date: string;
  n: number;
  first_raw_id: number | null;
}

/** Pure: groups per generation, flags isolated days. Exported for the test. */
export function isolatedDayFindingsFor(counts: readonly DayCount[]): Finding[] {
  const byEpoch = new Map<number, DayCount[]>();
  for (const c of counts) {
    if (KNOWN_CLOCK_FAULT_DATES.has(c.shift_date)) continue;
    const arr = byEpoch.get(c.source_epoch) ?? [];
    arr.push(c);
    byEpoch.set(c.source_epoch, arr);
  }

  const findings: Finding[] = [];
  for (const [epoch, days] of [...byEpoch.entries()].sort((a, b) => a[0] - b[0])) {
    const byDate = new Map(days.map((d) => [d.shift_date, d] as const));
    const sorted = [...days].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    const denseDates = sorted.filter((d) => d.n >= MIN_DENSE_ROWS).map((d) => d.shift_date);
    const minDense = denseDates[0] ?? null;
    const maxDense = denseDates[denseDates.length - 1] ?? null;
    // The "recorded coverage range" is the dense span, widened by the same
    // neighbour window so a legitimate ramp-up/down day sitting right next to
    // the dense block (already covered by hasNeighborWithinWindow) isn't
    // double-counted as "outside coverage" too.
    const coverageLo = minDense == null ? null : addDays(minDense, -NEIGHBOR_WINDOW_DAYS);
    const coverageHi = maxDense == null ? null : addDays(maxDense, NEIGHBOR_WINDOW_DAYS);

    for (const d of sorted) {
      if (d.n >= MIN_DENSE_ROWS) continue;
      const hasNeighbor = hasNeighborWithinWindow(byDate, d.shift_date);
      const outsideCoverage = coverageLo != null && coverageHi != null && (d.shift_date < coverageLo || d.shift_date > coverageHi);
      if (hasNeighbor && !outsideCoverage) continue;
      findings.push({
        check_name: 'isolated_production_day',
        severity: 'WARNING',
        subject_table: 'cone_event',
        count: d.n,
        detail:
          `shift_date ${d.shift_date} (generation ${epoch}) carries ${d.n} row(s) with no data in the ` +
          `surrounding ${NEIGHBOR_WINDOW_DAYS} days of the same source generation` +
          (outsideCoverage ? ` and falls outside that generation's own coverage range (${minDense ?? '?'} to ${maxDense ?? '?'})` : '') +
          ` — likely a misdated row rather than real production; first raw_id ${d.first_raw_id ?? 'unknown'}`,
        subject_ref: d.first_raw_id,
      });
    }
  }
  return findings;
}

function addDays(dateStr: string, deltaDays: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

function hasNeighborWithinWindow(byDate: ReadonlyMap<string, DayCount>, dateStr: string): boolean {
  const base = Date.parse(`${dateStr}T00:00:00Z`);
  for (let i = -NEIGHBOR_WINDOW_DAYS; i <= NEIGHBOR_WINDOW_DAYS; i++) {
    if (i === 0) continue;
    const neighborDate = new Date(base + i * DAY_MS).toISOString().slice(0, 10);
    if (byDate.has(neighborDate)) return true;
  }
  return false;
}

/**
 * DB-facing wrapper: one GROUP BY over `sms.cone_event` for the line, then
 * `isolatedDayFindingsFor`. Read-only — no rows are touched or deleted.
 */
export async function checkIsolatedProductionDay(pool: ConnectionPool, lineId: number): Promise<Finding[]> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ source_epoch: number; shift_date: Date; n: number; first_raw_id: number | null }>(
      `SELECT source_epoch, shift_date, COUNT(*) AS n, MIN(raw_id) AS first_raw_id
         FROM sms.cone_event
        WHERE line_id = @line
        GROUP BY source_epoch, shift_date`,
    );
  const counts: DayCount[] = r.recordset.map((row) => ({
    source_epoch: Number(row.source_epoch),
    shift_date: new Date(row.shift_date).toISOString().slice(0, 10),
    n: Number(row.n),
    first_raw_id: row.first_raw_id == null ? null : Number(row.first_raw_id),
  }));
  return isolatedDayFindingsFor(counts);
}
