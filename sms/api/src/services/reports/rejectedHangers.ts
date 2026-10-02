/**
 * Rejected Cone Hangers Report — IFL's report 7 of 8 (their email of
 * 29 Sep 2026), registered 1 Oct 2026, built by task C-R7 the same day.
 *
 * WHAT IT SHOWS. TP1 has ONE hanger loop: hangers 1..299 are shared by all 14
 * winders, so "which hanger" is a question about the carrier, not the machine.
 *  A. PER HANGER: cones weighed, cones INSPECTED (the cones that rode it plus
 *     the rejects with no cone row, so a reject is never counted twice nor
 *     dropped), quality rejects, weight rejects, total, rate, and a flag. The
 *     rows with no hanger number go in one "No hanger recorded" bucket, last.
 *     Only hangers with at least one reject are LISTED (a hanger report is
 *     about the hangers that rejected; 280 rows of zeros would bury the 19 that
 *     did), but every hanger counts: the `total` row, the line rate the flag
 *     is tested against and the number of hangers judged are over ALL of them.
 *  B. EVERY REJECT, one row each: time, hanger, winder, type, reason, weight.
 *
 * WHERE EACH FIGURE COMES FROM, so it cannot drift from the rest of the app.
 *  - Cones: `sms.cone_event` rows (the Line / Weight / Rejects screens' own
 *    population), grouped by hanger.
 *  - Rejects: `sms.reject_event` rows, grouped by hanger and type, both tables
 *    confined to ONE source generation (`resolveGenerationScope`) so a period
 *    that spans IFL's rebuild or the plant simulator never pools two.
 *  - Inspected: cones plus `getUnmatchedRejects` (rejects.ts), the one place
 *    that decides "this reject is the same physical cone as a cone row" (the
 *    shared `coneMatchPredicate`). In real data every weight reject and 98%+ of
 *    quality rejects ARE a cone row, so adding every reject to the cones would
 *    count them twice — the defect rejectSpc.ts, the report services and the
 *    Weight screen were each corrected for on 23 Sep 2026.
 *  - A reject with no hanger number (or hanger 0) and a reject with a zeroed
 *    clock (production time at or before 1970-01-01, IFL's sentinel record:
 *    `excludedClockFault`) are kept apart: the first is the "No hanger recorded"
 *    bucket, the second is dropped from every table and counted.
 *
 * THE FLAG, AND ITS WORDING. A hanger "stands out in this period" when its
 * reject count is high for its inspected cones at the period's own line rate:
 * the exact binomial upper tail P(X >= x | n, p0) (binomial.ts) is below
 * 0.05 / H, where p0 is the line rate over the period and H is the number of
 * hangers with at least 100 inspected cones (a Bonferroni family-wise 5%).
 * Below 100 inspected cones a hanger is "too few cones to judge". If fewer than
 * max(30, half the hangers seen) hangers reach 100, no flag is raised at all
 * (`canFlag` false) and the report says to choose a longer period. The report
 * never calls a hanger bad or faulty: a count says where rejects were, not why.
 *
 * KNOWN LIMIT, stated rather than hidden: the test treats each inspected cone as
 * an independent trial at the line rate, and a hanger's neighbours on the loop
 * share a winder, so cones are not perfectly independent: the flag can be a
 * little more eager than the arithmetic says, never less. Rejects are counted
 * by RECORD, so a cone carrying both a quality and a weight record would count
 * twice among the rejects and once among the cones inspected; measured
 * 1 Oct 2026, there is none in either real generation (0 of 6,089 September
 * and 0 of 3,144 July records), so the note does not mention it.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ShiftCode } from '@sms/shared';
import { noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { bindConeFilters, bindRejectFilters, getUnmatchedRejects, type RejectFilters } from '../rejects.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { logBinomialUpperTail } from './binomial.js';
import { csvRowOf, LIST_CAP, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { plantWallClock } from './plantTime.js';

/** 'stands_out' = statistically high this period; 'too_few' = under 100 inspected cones; null = judged and not flagged (or `canFlag` is false). */
export type RejectedHangerFlag = 'stands_out' | 'too_few' | null;

/** Table A, one hanger. `hanger` is null for the "No hanger recorded" bucket. */
export interface RejectedHangerRow {
  hanger: number | null;
  /** Cones weighed that rode this hanger. */
  cones: number;
  /** cones + rejects with no matching cone row. */
  inspected: number;
  qualityRejects: number;
  weightRejects: number;
  /** qualityRejects + weightRejects. */
  total: number;
  /** total / inspected x 100, 2 dp; null when nothing was inspected. */
  ratePct: number | null;
  flag: RejectedHangerFlag;
}

/** Table B, one reject. */
export interface RejectedHangerReject {
  date: string;
  shift: ShiftCode;
  /** Plant-clock instant of the reject (production time convention, render in UTC). */
  producedAtUtc: string;
  hanger: number | null;
  winder: number | null;
  rejectType: 'quality' | 'weight';
  /** The reason as a label, or the raw tube / material codes when no label exists; null for a weight reject. */
  reason: string | null;
  weightG: number | null;
}

export interface RejectedHangersReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** A: sorted by total rejects descending, the "No hanger recorded" bucket last. Hangers with no reject are not listed (see the file header). */
  hangers: RejectedHangerRow[];
  /** A: every hanger together (cones, inspected, rejects, rate); `hanger` is null. */
  total: RejectedHangerRow;
  /** How the flag was decided, so the screen and the print can state it. */
  flagging: {
    /** False when too few hangers had enough cones for a flag to mean anything; `reason` says why. */
    canFlag: boolean;
    /** Plain-words reason when `canFlag` is false ("too few cones per hanger in this period — choose a longer period"). */
    reason: string | null;
    /** p0: the line's reject rate over the period, %, 2 dp; null with no inspected cones. */
    lineRatePct: number | null;
    /** H: hangers with at least `minInspected` inspected cones. */
    hangersJudged: number;
    /** Distinct hanger numbers seen in the period. */
    hangersSeen: number;
    /** 100. */
    minInspected: number;
    /** The family-wise level the per-hanger threshold is derived from (0.05). */
    alpha: number;
  };
  /** B: chronological, at most `listCap` of them. */
  list: RejectedHangerReject[];
  /** What the period really holds; `listTotal > listCap` means the list was cut and every output says so. */
  listTotal: number;
  listCap: number;
  /** Rejects dropped as clock faults (production time at or before 1970-01-01). */
  excludedClockFault: number;
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const REJECTED_HANGERS_NOTE =
  'Rejects per hanger. The line has one hanger loop shared by every winder. Only hangers with at least one reject are listed; ' +
  'the total row counts every hanger. A hanger "stands out in this period" when its reject count is high for the cones it ' +
  'carried, tested at the period’s own reject rate; a count says where rejects were, never why. Inspected cones are the cones ' +
  'that rode a hanger plus rejects with no cone record. Winder is the weighing station.';

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const REJECTED_HANGERS_PENDING_IFL: readonly string[] = [
  'Quality (inspection) and weight rejects are both counted; IFL has not said whether one kind is meant.',
  'A hanger is flagged by an exact binomial test (5% across all hangers with at least 100 inspected cones); IFL has not defined its own criterion.',
];

/** A hanger needs at least this many inspected cones before it can be judged. */
export const HANGER_MIN_INSPECTED = 100;
/** The family-wise level of the flag (Bonferroni across the hangers judged). */
export const HANGER_ALPHA = 0.05;
/** No flag is raised unless at least this many hangers (and half those seen) reach `HANGER_MIN_INSPECTED`. */
export const HANGER_MIN_JUDGED = 30;
/** The plain-words reason printed when no flag can be raised. */
export const CANNOT_FLAG_REASON = 'too few cones per hanger in this period — choose a longer period';

/** What the SQL hands the pure judging step, per hanger (`hanger` null = the "No hanger recorded" bucket). */
export interface HangerCounts {
  hanger: number | null;
  cones: number;
  /** Rejects (any type) with no matching cone row: the only ones that add to the cones inspected. */
  unmatched: number;
  qualityRejects: number;
  weightRejects: number;
}

const rowOf = (c: HangerCounts, flag: RejectedHangerFlag = null): RejectedHangerRow => {
  const inspected = c.cones + c.unmatched;
  const total = c.qualityRejects + c.weightRejects;
  return {
    hanger: c.hanger, cones: c.cones, inspected, qualityRejects: c.qualityRejects, weightRejects: c.weightRejects, total,
    ratePct: inspected > 0 ? round((total / inspected) * 100, 2) : null, flag,
  };
};

/**
 * Table A and the flag, from per-hanger counts. Pure: the SQL only counts, and
 * everything that decides what a count MEANS is here where it can be tested.
 */
export function assessHangers(counts: readonly HangerCounts[]): Pick<RejectedHangersReportData, 'hangers' | 'total' | 'flagging'> {
  const numbered = counts.filter((c) => c.hanger != null);
  const all = counts.reduce(
    (a, c) => ({
      hanger: null, cones: a.cones + c.cones, unmatched: a.unmatched + c.unmatched,
      qualityRejects: a.qualityRejects + c.qualityRejects, weightRejects: a.weightRejects + c.weightRejects,
    }),
    { hanger: null, cones: 0, unmatched: 0, qualityRejects: 0, weightRejects: 0 } as HangerCounts,
  );
  const total = rowOf(all);

  const hangersSeen = numbered.filter((c) => c.cones + c.unmatched + c.qualityRejects + c.weightRejects > 0).length;
  const hangersJudged = numbered.filter((c) => c.cones + c.unmatched >= HANGER_MIN_INSPECTED).length;
  const canFlag = total.inspected > 0 && hangersJudged >= Math.max(HANGER_MIN_JUDGED, hangersSeen / 2);

  // p0 stays UNROUNDED for the test; the 2 dp figure is only what is printed.
  const p0 = total.inspected > 0 ? total.total / total.inspected : 0;
  const lnThreshold = hangersJudged > 0 ? Math.log(HANGER_ALPHA / hangersJudged) : -Infinity;
  const flagOf = (c: HangerCounts): RejectedHangerFlag => {
    if (!canFlag || c.hanger == null) return null;
    const inspected = c.cones + c.unmatched;
    if (inspected < HANGER_MIN_INSPECTED) return 'too_few';
    const x = c.qualityRejects + c.weightRejects;
    if (x === 0) return null;
    // More rejects than inspected cones (a cone carrying both records) cannot be judged beyond "all of them".
    return logBinomialUpperTail(Math.min(x, inspected), inspected, p0) < lnThreshold ? 'stands_out' : null;
  };

  const hangers = counts
    .filter((c) => c.qualityRejects + c.weightRejects > 0)
    .map((c) => rowOf(c, flagOf(c)))
    // Most rejects first, then the higher rate, then the lower hanger number; the "no hanger" bucket is always last.
    .sort((a, b) => {
      if ((a.hanger == null) !== (b.hanger == null)) return a.hanger == null ? 1 : -1;
      return b.total - a.total || (b.ratePct ?? 0) - (a.ratePct ?? 0) || (a.hanger ?? 0) - (b.hanger ?? 0);
    });

  return {
    hangers,
    total,
    flagging: {
      canFlag,
      reason: canFlag ? null : CANNOT_FLAG_REASON,
      lineRatePct: total.ratePct,
      hangersJudged,
      hangersSeen,
      minInspected: HANGER_MIN_INSPECTED,
      alpha: HANGER_ALPHA,
    },
  };
}

/** The report note, with a sentence for each filter that changes what a count means. */
function noteFor(filters: ReportFilters): string {
  const extra: string[] = [];
  if (filters.station != null) {
    extra.push(`Narrowed to winder ${filters.station}: the counts, and the line rate each hanger is tested against, are that winder’s own.`);
  }
  if (filters.product != null) {
    extra.push('Narrowed to one product: readings with no product on record, such as July’s, are not included.');
  }
  return [REJECTED_HANGERS_NOTE, ...extra].join(' ');
}

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** The grouping key every query uses: the hanger number, or 'none' for no hanger (NULL or 0). */
const hangerKey = (alias: string): string =>
  `CASE WHEN ${alias}hanger_num IS NULL OR ${alias}hanger_num = 0 THEN 'none' ELSE CAST(${alias}hanger_num AS varchar(12)) END`;
/** The same, on the reject side, with a zeroed-clock record split off first so it can be dropped and counted. */
const REJECT_KEY = `CASE WHEN re.production_ts_utc_ms <= 0 THEN 'fault' ELSE ${hangerKey('re.')} END`;

const hangerOf = (k: string): number | null => (k === 'none' ? null : Number(k));

export async function getRejectedHangersReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<RejectedHangersReportData> {
  const { from, to } = resolved;
  // ONE generation for both tables, applied to every query below (and to the cone side of the unmatched-reject check).
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']);
  const f: RejectFilters = { from, to, shift: filters.shift, station: filters.station, product: filters.product, shiftRange, scope };

  const conesReq = pool.request();
  const conesWhere = bindConeFilters(conesReq, lineId, f);
  const rejectsReq = pool.request();
  const rejectsWhere = bindRejectFilters(rejectsReq, lineId, f, 're.', false);
  const listReq = pool.request();
  const listWhere = bindRejectFilters(listReq, lineId, f, 're.', false);
  listReq.input('cap', mssql.Int, LIST_CAP);

  const [cones, rejects, unmatched, list] = await Promise.all([
    conesReq.query<{ hk: string; n: number }>(
      `SELECT ${hangerKey('')} AS hk, COUNT(*) AS n
         FROM sms.cone_event
        WHERE ${conesWhere} AND production_ts_utc_ms > 0
        GROUP BY ${hangerKey('')}`,
    ),
    rejectsReq.query<{ hk: string; rt: string; n: number }>(
      `SELECT ${REJECT_KEY} AS hk, re.reject_type AS rt, COUNT(*) AS n
         FROM sms.reject_event re
        WHERE ${rejectsWhere}
        GROUP BY ${REJECT_KEY}, re.reject_type`,
    ),
    getUnmatchedRejects(pool, lineId, f, REJECT_KEY),
    // The label join is rejects.ts's own CODE_JOIN (unique per line, type and code pair, so it never multiplies a row).
    listReq.query<{
      d: unknown; sc: string; ts: unknown; h: number | null; st: number | null; rt: string;
      tube: number | null; mat: number | null; w: number | null; label: string | null;
    }>(
      `SELECT TOP (@cap) re.shift_date AS d, re.shift_code AS sc, re.production_ts_utc AS ts, re.hanger_num AS h,
              re.source_station AS st, re.reject_type AS rt, re.tube_inspect_code AS tube, re.material_inspect_code AS mat,
              re.weight_g AS w, rc.label AS label
         FROM sms.reject_event re
         LEFT JOIN sms.reject_code rc
           ON rc.line_id = re.line_id
          AND rc.reject_type = re.reject_type
          AND ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)
          AND ISNULL(rc.material_code, -999) = ISNULL(re.material_inspect_code, -999)
        WHERE ${listWhere} AND re.production_ts_utc_ms > 0
        ORDER BY re.production_ts_utc_ms, re.reject_event_id`,
    ),
  ]);

  const byKey = new Map<string, HangerCounts>();
  const entry = (k: string): HangerCounts => {
    let e = byKey.get(k);
    if (!e) {
      e = { hanger: hangerOf(k), cones: 0, unmatched: 0, qualityRejects: 0, weightRejects: 0 };
      byKey.set(k, e);
    }
    return e;
  };
  for (const r of cones.recordset) entry(String(r.hk)).cones += Number(r.n);
  let excludedClockFault = 0;
  let listTotal = 0;
  for (const r of rejects.recordset) {
    const n = Number(r.n);
    if (r.hk === 'fault') {
      excludedClockFault += n;
      continue;
    }
    listTotal += n;
    const e = entry(String(r.hk));
    if (r.rt === 'weight') e.weightRejects += n;
    else e.qualityRejects += n;
  }
  for (const [k, n] of unmatched) {
    if (k !== 'fault') entry(k).unmatched += n;
  }

  const rows: RejectedHangerReject[] = list.recordset.map((r) => {
    const weight = r.rt === 'weight';
    return {
      date: dayOf(r.d),
      shift: r.sc as ShiftCode,
      producedAtUtc: isoOf(r.ts),
      hanger: r.h == null || Number(r.h) === 0 ? null : Number(r.h),
      winder: r.st == null ? null : Number(r.st),
      rejectType: weight ? 'weight' : 'quality',
      reason: weight ? null : (r.label ?? `Tube ${r.tube ?? '—'} · Mat ${r.mat ?? '—'}`),
      weightG: r.w == null ? null : Number(r.w),
    };
  });

  return {
    period: resolved,
    filters,
    lineId,
    ...assessHangers([...byKey.values()]),
    list: rows,
    listTotal,
    listCap: LIST_CAP,
    excludedClockFault,
    note: noteFor(filters),
    pendingIfl: [...REJECTED_HANGERS_PENDING_IFL],
    generationNote: noteOf(scope),
  };
}

export const REJECTED_HANGERS_CSV_HEADERS = [
  'section', 'hanger', 'cones', 'inspected', 'quality_rejects', 'weight_rejects', 'total_rejects', 'rate_pct', 'flag', 'date',
  'produced_at_plant_time', 'shift', 'winder', 'reject_type', 'reason', 'weight_g',
] as const;

/**
 * Sections: `hanger` (one per hanger, the "No hanger recorded" bucket with an
 * empty `hanger`), `total` and `reject` (one per reject, `hanger` empty when
 * it has none). `flag` is 'stands_out' / 'too_few', empty otherwise.
 */
export function rejectedHangersCsv(d: RejectedHangersReportData): CsvTable {
  const H = REJECTED_HANGERS_CSV_HEADERS;
  const hangerRow = (section: string, r: RejectedHangerRow): CsvRow =>
    csvRowOf(H, {
      section, hanger: r.hanger, cones: r.cones, inspected: r.inspected, quality_rejects: r.qualityRejects, weight_rejects: r.weightRejects,
      total_rejects: r.total, rate_pct: r.ratePct, flag: r.flag,
    });
  const rows: CsvRow[] = [
    ...d.hangers.map((r) => hangerRow('hanger', r)),
    hangerRow('total', d.total),
    ...d.list.map((r) =>
      csvRowOf(H, {
        section: 'reject',
        hanger: r.hanger,
        date: r.date,
        produced_at_plant_time: plantWallClock(r.producedAtUtc),
        shift: r.shift,
        winder: r.winder,
        reject_type: r.rejectType,
        reason: r.reason,
        weight_g: r.weightG,
      })),
  ];
  return { headers: H, rows };
}
