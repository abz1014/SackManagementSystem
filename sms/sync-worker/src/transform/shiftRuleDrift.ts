/**
 * `shift_rule_drift` — RT24-04's read-only DQ check. Only meaningful when
 * more than one `sms.shift_rule` version exists for the line: with a single
 * version there is nothing to drift against, and this is a deliberate no-op
 * (logged, not a finding — see CHECK_NAMES' comment in dq.ts for why a
 * standing "everything's fine" finding is not raised for a condition that
 * cannot occur).
 *
 * WHAT IT CATCHES. `runTransform.ts` used to resolve `resolveShiftRule` once
 * per pass and stamp every row — old and new alike — with whichever rule was
 * newest when the pass ran. A rebuild after an admin edits the rule in Setup
 * therefore silently restamps old rows' `shift_code`/`shift_date` under a
 * rule that was never in force when they were produced. This check recomputes
 * both from each sampled row's OWN production time, using the as-of rule
 * (ruleHistory.ts), and compares against what is actually stored.
 *
 * SCOPE. Bounded to SAMPLE_LIMIT rows (newest first) rather than a full
 * table scan every pass — this is a periodic health check, not the transform
 * itself, and the dev copy's whole history fits well inside the limit anyway.
 * A mismatch anywhere in the sample is a real defect regardless of how much
 * of the table was covered, so the finding says how many rows were sampled
 * and reports the count and date range of what it found, not "table clean".
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { wallClockOf, shiftCodeOf, shiftDateOf } from './wallClock.js';
import { resolveShiftRuleAt, type ShiftRuleVersion } from './ruleHistory.js';
import type { Finding } from './dq.js';

export const SAMPLE_LIMIT = 20_000;

/** Plant wall clock (labelled UTC) as "YYYY-MM-DD HH:MM:SS", for a detail sentence. */
const plantTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

interface SampledRow {
  raw_id: number | null;
  /** mssql returns BIGINT columns as JS strings — accept both, and convert at the boundary below. */
  production_ts_utc_ms: number | string;
  shift_code: string | null;
  shift_date: Date | null;
}

/** Pure: compares each row's stored shift_code/shift_date against the as-of rule. Exported for the test. */
export function shiftRuleDriftFindingsFor(rows: SampledRow[], history: readonly ShiftRuleVersion[], sampleSize: number): Finding[] {
  let mismatches = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;
  let firstRawId: number | null = null;
  let unreadable = 0;
  let firstUnreadableRawId: number | null = null;
  for (const row of rows) {
    const ms = Number(row.production_ts_utc_ms);
    if (!Number.isFinite(ms)) {
      // A row whose time we cannot even parse is never drift — it is a separate,
      // honestly-named defect (bad data), not a shift-rule mismatch.
      unreadable++;
      if (firstUnreadableRawId == null) firstUnreadableRawId = row.raw_id;
      continue;
    }
    const rule = resolveShiftRuleAt(history, ms);
    const wc = wallClockOf(new Date(ms));
    const expectedCode = shiftCodeOf(wc, rule.boundaries);
    const expectedDate = shiftDateOf(wc, rule.nightBelongsTo, rule.boundaries);
    const storedDateMs = row.shift_date == null ? null : new Date(row.shift_date).getTime();
    if (row.shift_code !== expectedCode || storedDateMs !== expectedDate.getTime()) {
      mismatches++;
      minMs = Math.min(minMs, ms);
      maxMs = Math.max(maxMs, ms);
      if (firstRawId == null) firstRawId = row.raw_id;
    }
  }
  const findings: Finding[] = [];
  if (mismatches > 0) {
    findings.push({
      check_name: 'shift_rule_drift',
      severity: 'WARNING',
      subject_table: 'cone_event',
      count: mismatches,
      detail:
        `${mismatches} of ${sampleSize} sampled rows' stored shift_code/shift_date do not match the shift rule in ` +
        `force at their OWN production time (${history.length} sms.shift_rule versions on file) — affected rows ` +
        `span ${plantTime(minMs)} to ${plantTime(maxMs)} plant time; rebuild canonical to restamp them`,
      subject_ref: firstRawId,
    });
  }
  if (unreadable > 0) {
    findings.push({
      check_name: 'shift_rule_drift_unreadable_time',
      severity: 'WARNING',
      subject_table: 'cone_event',
      count: unreadable,
      detail:
        `${unreadable} of ${sampleSize} sampled rows had a production_ts_utc_ms that could not be parsed as a ` +
        `number — these rows were skipped, not counted as shift-rule drift`,
      subject_ref: firstUnreadableRawId,
    });
  }
  return findings;
}

/**
 * DB-facing wrapper: samples the newest SAMPLE_LIMIT cone_event rows for the
 * line and runs shiftRuleDriftFindingsFor. No-op (one log line, empty array)
 * when only one shift_rule version exists — that is not a defect, it is the
 * normal case, and the check has nothing to compare.
 */
export async function checkShiftRuleDrift(
  pool: ConnectionPool,
  lineId: number,
  history: readonly ShiftRuleVersion[],
): Promise<Finding[]> {
  if (history.length <= 1) {
    // eslint-disable-next-line no-console
    console.log(
      `[dq] shift_rule_drift: line ${lineId} has a single sms.shift_rule version on file — no-op, nothing to drift against.`,
    );
    return [];
  }
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ raw_id: number | null; production_ts_utc_ms: number | string; shift_code: string | null; shift_date: Date | null }>(
      `SELECT TOP (${SAMPLE_LIMIT}) raw_id, production_ts_utc_ms, shift_code, shift_date
         FROM sms.cone_event WHERE line_id = @line ORDER BY production_ts_utc_ms DESC`,
    );
  return shiftRuleDriftFindingsFor(r.recordset, history, r.recordset.length);
}
