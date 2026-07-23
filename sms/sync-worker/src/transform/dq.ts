/**
 * Data-quality checks over canonical rows (ARCHITECTURE §8). Pure computation
 * → summary findings (one per check with a count), so the Operations roll-up
 * isn't flooded. Raw offending rows stay queryable in canonical regardless.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface Finding {
  check_name: string;
  severity: Severity;
  subject_table: string;
  count: number;
  detail: string;
}

interface Weighted {
  production_ts_utc_ms: number;
  merge_key_is_unique?: boolean;
}

export function computeFindings<T extends Weighted>(
  rows: T[],
  kind: 'cone' | 'sack' | 'reject',
  table: string,
  weightOf: (r: T) => number | null,
): Finding[] {
  const nowMs = Date.now();
  let future = 0;
  let nonPositive = 0;
  let outlier = 0;
  let collision = 0;
  const outlierThreshold = kind === 'sack' ? 40 : 1500; // kg for sacks, g for cones

  for (const r of rows) {
    if (r.production_ts_utc_ms > nowMs) future++;
    if (r.merge_key_is_unique === false) collision++;
    const w = weightOf(r);
    if (w != null) {
      if (w <= 0) nonPositive++;
      else if (w < outlierThreshold) outlier++;
    }
  }

  const findings: Finding[] = [];
  const add = (check: string, sev: Severity, count: number, detail: string) => {
    if (count > 0) findings.push({ check_name: check, severity: sev, subject_table: table, count, detail });
  };
  add('future_timestamp', 'ERROR', future, `${future} rows with production time in the future`);
  add('nonpositive_weight', 'ERROR', nonPositive, `${nonPositive} rows with weight <= 0`);
  add('outlier_weight', 'WARNING', outlier, `${outlier} rows below ${outlierThreshold}${kind === 'sack' ? 'kg' : 'g'}`);
  add('merge_key_collision', 'INFO', collision, `${collision} rows share a non-unique merge key (DQ-2)`);
  return findings;
}

export async function persistFindings(
  pool: ConnectionPool,
  runId: string,
  findings: Finding[],
): Promise<void> {
  for (const f of findings) {
    await pool
      .request()
      .input('run', mssql.UniqueIdentifier, runId)
      .input('check', mssql.VarChar(64), f.check_name)
      .input('sev', mssql.VarChar(10), f.severity)
      .input('tbl', mssql.VarChar(40), f.subject_table)
      .input('detail', mssql.NVarChar(500), f.detail)
      .query(
        `INSERT INTO sms.dq_finding (run_id, check_name, severity, subject_table, detail)
         VALUES (@run, @check, @sev, @tbl, @detail)`,
      );
  }
}
