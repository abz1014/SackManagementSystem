/**
 * Shift attribution validation — roadmap Phase 4 item 5 (14 Sep 2026).
 *
 * The plant's own `Shift` column is derived, in a trigger, from the INSERT
 * time (`Date`), which trails the weighing time by hours (SCHEMA.md DQ-4); a
 * cone weighed at 13:50 and written at 14:20 is filed under the evening
 * shift by the plant. SMS re-derives the shift from the weighing time
 * (`ProductionDate`) and keeps the plant's value beside it
 * (`shift_code_legacy`, normalised to the same three words), so the two can
 * be compared on every row. This is that comparison: per production day,
 * how many cones the two attributions disagree on, and at which hours of the
 * day — which is always the hour before each boundary, if the explanation
 * above is right, and something else if it is not.
 *
 * The legacy-vs-corrected statistic existed until `/api/shift-analysis` was
 * deleted at f4b941a; this is its replacement, with the hours added so the
 * figure can be checked against its own explanation.
 *
 * Whether SMS's derived shift should REPLACE the plant's or sit beside it is
 * IFL's decision (Q7, open). Setup › Rules holds a `mode` for it that the
 * transform applies; this endpoint shows what changing it would change.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { epochFragment, noteOf, resolveGenerationScope, type GenerationNote } from './generation.js';

export interface ShiftCheckDay {
  day: string;
  cones: number;
  mismatched: number;
  mismatchPct: number;
}

export interface ShiftCheckHour {
  /** Hour of the day, 0-23, on the plant's clock. */
  hour: number;
  mismatched: number;
}

export interface ShiftCheckData {
  from: string;
  to: string;
  cones: number;
  mismatched: number;
  mismatchPct: number;
  /** Rows carrying no plant shift at all — neither agreeing nor disagreeing. */
  noLegacyShift: number;
  byDay: ShiftCheckDay[];
  /** The three hours of day with the most disagreements, most first. */
  topHours: ShiftCheckHour[];
  note: string;
  /** Which source generation was compared, and what was left out. */
  generationNote?: GenerationNote;
}

const pct = (part: number, of: number): number => (of > 0 ? Math.round((1000 * part) / of) / 10 : 0);

export async function getShiftCheck(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
): Promise<ShiftCheckData> {
  // SOURCE GENERATIONS (generation.ts, 23 Sep 2026). `shift_code_legacy` is
  // the SOURCE table's own Shift column, and each generation is a different
  // physical table: pooling them compares two plants' filing against one
  // recomputed answer and reports the disagreement as a single percentage.
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']);
  const gen0 = epochFragment(scope, 'cone_event');
  const genAnd = gen0.sql ? ' AND ' + gen0.sql : '';
  const bind = () => {
    const r = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
    for (const q of gen0.params) r.input(q.name, mssql.Int, q.id);
    return r;
  };

  // Per production day: cones, and how many the plant filed differently.
  // A NULL legacy shift is neither a match nor a mismatch; it is counted
  // apart so the percentage is over rows that could be compared.
  const days = await bind().query<{ day: string; n: number; mm: number; nolegacy: number }>(
    `SELECT CONVERT(varchar(10), shift_date, 120) AS day,
            COUNT(*) AS n,
            SUM(CASE WHEN shift_code_legacy IS NOT NULL AND shift_code_legacy <> shift_code THEN 1 ELSE 0 END) AS mm,
            SUM(CASE WHEN shift_code_legacy IS NULL THEN 1 ELSE 0 END) AS nolegacy
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to${genAnd}
      GROUP BY shift_date
      ORDER BY shift_date`,
  );

  // The hour of the WEIGHING time, on the plant's clock as it is stored
  // (production_ts_utc is the wall clock labelled UTC — DATEPART reads it
  // back as the plant's hour without any conversion).
  const hours = await bind().query<{ h: number; mm: number }>(
    `SELECT DATEPART(HOUR, production_ts_utc) AS h, COUNT(*) AS mm
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to${genAnd}
        AND shift_code_legacy IS NOT NULL AND shift_code_legacy <> shift_code
      GROUP BY DATEPART(HOUR, production_ts_utc)
      ORDER BY COUNT(*) DESC, DATEPART(HOUR, production_ts_utc)`,
  );

  const byDay: ShiftCheckDay[] = days.recordset.map((d) => {
    const n = Number(d.n);
    const mm = Number(d.mm);
    const comparable = n - Number(d.nolegacy);
    return { day: d.day, cones: n, mismatched: mm, mismatchPct: pct(mm, comparable) };
  });
  const cones = byDay.reduce((a, d) => a + d.cones, 0);
  const mismatched = byDay.reduce((a, d) => a + d.mismatched, 0);
  const noLegacyShift = days.recordset.reduce((a, d) => a + Number(d.nolegacy), 0);

  return {
    from,
    to,
    cones,
    mismatched,
    mismatchPct: pct(mismatched, cones - noLegacyShift),
    noLegacyShift,
    byDay,
    topHours: hours.recordset.slice(0, 3).map((h) => ({ hour: Number(h.h), mismatched: Number(h.mm) })),
    note:
      "SMS derives the shift from the weighing time; the plant's own column is derived from the time the row was written, " +
      'which trails the weighing by hours. Whether the derived shift replaces or sits beside the plant\'s is not yet confirmed by IFL.',
  };
}
