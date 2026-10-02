/**
 * Rejected Unknown (Lifter) Report — IFL's report 8 of 8 (their email of
 * 29 Sep 2026), registered 1 Oct 2026 (task W0), built 1 Oct 2026 (W1-R8),
 * definition narrowed 1 Oct 2026 (gate round 1, orchestrator decision).
 *
 * THE DEFINITION IS A DRAFT. IFL has not said what "unknown (lifter)" means.
 * The draft, stated on every surface and in `pendingIfl`: a reject that has no
 * lifter number or no winder number recorded — nothing else. A zero reason code
 * (tube code 0 or material code 0 — a code the plant wrote as "nothing") is NOT
 * an unknown lifter: it is counted in table A and listed in its own, separately
 * titled list, because what a zero code means is not confirmed by IFL.
 * Everything the draft needs is measured: on TP1 the lifter equals the winder
 * on 99.9985% of rows and never differs on a reject, and the only real rejects
 * without a lifter are the zeroed 1970-01-01 records. So the list is empty in a
 * normal period and says so ("Every rejected cone in this period carries a
 * lifter number.") instead of printing a table of zeros.
 *
 *  A. PER LIFTER (1..14 and "No lifter recorded"): cones, inspected (cones plus
 *     rejects with no cone row, `getUnmatchedRejects` grouped by the REJECT's
 *     lifter), quality rejects, of which with a zero reason code, weight
 *     rejects, total, rate.
 *  B. THE REJECTS WITH NO LIFTER OR NO WINDER RECORDED (the draft's "unknown"),
 *     each with why. CSV section `no_lifter`.
 *  B2. THE REJECTS WITH A ZERO REASON CODE, a separate list whose meaning is not
 *     confirmed by IFL. CSV section `zero_code`. Its total agrees with table A's
 *     "of which reason code zero" column by construction (one predicate).
 *  C. THE ZEROED-CLOCK RECORDS: rejects stamped 1970-01-01 (production time
 *     at or before zero). The period picker cannot reach them, so this block is
 *     independent of the period and of every filter, and covers the period's
 *     own source generation only (resolved by the key the period chose).
 *
 * ONE GENERATION. The cones, the rejects and the unmatched-reject count read
 * one source generation, resolved once; block C reads that same generation by
 * its key, never the others'.
 *
 * ZERO-CODE FINDING, REPORTED NOT RESOLVED. Quality rejects carry a PAIR of
 * codes (tube, material) and a zero on one side is a normal "nothing on this
 * side" for many real rejects ((2,0), (9,0), (0,2)); only (0,0) says no reason
 * was recorded at all. The zero-code predicate (either side zero) is the
 * owner-approved draft and is what is built; on the dev copy it lists 12 real,
 * in-period rejects (5 July, 7 September) besides the 3 zeroed-clock ones, of
 * which 5 are (0,0). It is one predicate (`zeroCodeSql`) to narrow once IFL
 * answers.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ShiftCode } from '@sms/shared';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import { bindConeFilters, bindRejectFilters, getUnmatchedRejects, type RejectFilters } from '../rejects.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { csvRowOf, LIST_CAP, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { plantWallClock } from './plantTime.js';

/** Table A, one lifter. `lifter` is null for the "No lifter recorded" bucket. */
export interface LifterRow {
  lifter: number | null;
  cones: number;
  /** cones + rejects with no matching cone row. */
  inspected: number;
  qualityRejects: number;
  /** Of `qualityRejects`, how many carry a zero reason code (tube 0 or material 0). */
  zeroCodeRejects: number;
  weightRejects: number;
  /** qualityRejects + weightRejects. */
  total: number;
  /** total / inspected x 100, 2 dp; null when nothing was inspected. */
  ratePct: number | null;
}

/** One reject listed in B or C. */
export interface UnknownLifterReject {
  /** Production date (shift_date), YYYY-MM-DD; 1969-12-31 for a zeroed-clock record. */
  date: string;
  shift: ShiftCode;
  /** Plant-clock instant of the reject (production time convention, render in UTC). */
  producedAtUtc: string;
  hanger: number | null;
  winder: number | null;
  lifter: number | null;
  rejectType: 'quality' | 'weight';
  tubeCode: number | null;
  materialCode: number | null;
  weightG: number | null;
  /**
   * Why the reject is on its list: the no-lifter list names "No lifter recorded" /
   * "No winder recorded"; the zero-code list names "Reason code is zero"; a
   * zeroed-clock record names every reason that applies plus "Clock zeroed (1970)".
   */
  why: string[];
}

export interface RejectedUnknownLifterReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** A: lifters 1..14 in order, then the "No lifter recorded" bucket when it has anything. */
  lifters: LifterRow[];
  /** A: every lifter together; `lifter` is null. */
  total: LifterRow;
  /** How many rejects in the period have no lifter or no winder recorded (= `list.length` before the cap); 0 prints the empty-state sentence. */
  unknownCount: number;
  /** B: the rejects with no lifter or no winder recorded, chronological, at most `listCap` of them. */
  list: UnknownLifterReject[];
  /** What the period really holds in B; `listTotal > listCap` means the list was cut and every output says so. */
  listTotal: number;
  listCap: number;
  /** B2: the rejects with a zero reason code (meaning not confirmed by IFL), chronological, at most `listCap` of them. */
  zeroCodeList: UnknownLifterReject[];
  /** What the period really holds in B2 (= `total.zeroCodeRejects`); `> listCap` means B2 was cut and every output says so. */
  zeroCodeTotal: number;
  /** Rejects dropped from A and B as clock faults (production time at or before 1970-01-01); they are block C's. */
  excludedClockFault: number;
  /** C: independent of the period; the period's own source generation only. */
  zeroedClock: { generation: string | null; rows: UnknownLifterReject[] };
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const REJECTED_UNKNOWN_LIFTER_EMPTY = 'Every rejected cone in this period carries a lifter number.';

export const REJECTED_UNKNOWN_LIFTER_NOTE =
  'Rejects the draft definition calls "unknown": no lifter number or no winder number recorded. ' +
  'The lifter is the carrier that lifted the cone to the weighing scale; on this line it equals the winder on virtually every ' +
  'record. Inspected cones are the cones that rode a lifter plus rejects with no cone record. Rejects whose tube or material ' +
  'reason code is zero are counted in the table and listed apart: what a zero code means is not confirmed by IFL. Records stamped ' +
  '1 January 1970 (a zeroed clock) cannot be reached by any period and are listed separately, for this data batch, whatever period or filter is chosen.';

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const REJECTED_UNKNOWN_LIFTER_PENDING_IFL: readonly string[] = [
  'IFL has not defined "unknown (lifter)". Draft: a reject with no lifter number or no winder number recorded.',
  'Whether "unknown" also includes a reject with a zero reason code (tube 0 or material 0) is not confirmed by IFL; those rejects are counted and listed separately, not as unknown-lifter rejects.',
];

const EMPTY_TOTAL: LifterRow = {
  lifter: null, cones: 0, inspected: 0, qualityRejects: 0, zeroCodeRejects: 0, weightRejects: 0, total: 0, ratePct: null,
};

/** The lifters this line has: one per winder, numbered 1 to 14. A lifter number seen beyond that is listed too, never dropped. */
export const LIFTERS_ON_LINE = 14;

/** The reasons a reject is listed; frozen wording (the contract, api.ts). */
export const WHY_NO_LIFTER = 'No lifter recorded';
export const WHY_NO_WINDER = 'No winder recorded';
export const WHY_ZERO_CODE = 'Reason code is zero';
export const WHY_CLOCK_ZEROED = 'Clock zeroed (1970)';

/**
 * THE ZERO-CODE PREDICATE, in ONE place (SQL and JS agree because both read this
 * comment's rule): a quality reject whose tube code OR material code is zero —
 * a code the plant wrote as "nothing". A weight reject carries no code, so it
 * is never zero-coded. It is NOT the unknown-lifter definition (orchestrator
 * decision, 1 Oct 2026): it feeds table A's zero-code column and its own list.
 * If IFL defines it as BOTH codes zero, this is the one predicate to narrow
 * (`OR` to `AND`): it is `pendingIfl`, not a finding.
 */
const zeroCodeSql = (alias = ''): string =>
  `(${alias}reject_type = 'quality' AND (${alias}tube_inspect_code = 0 OR ${alias}material_inspect_code = 0))`;

/**
 * THE UNKNOWN-LIFTER DRAFT, in ONE place: a reject with no lifter number or no
 * winder number recorded, and nothing else. The transform maps lifter/station 0
 * to NULL; `<= 0` is the same rule held defensively (`positive()` below).
 */
const noLifterSql = (alias = ''): string =>
  `(${alias}lifter_station IS NULL OR ${alias}lifter_station <= 0 OR ${alias}source_station IS NULL OR ${alias}source_station <= 0)`;

interface WhyInput {
  lifter: number | null; winder: number | null; rejectType: string; tubeCode: number | null; materialCode: number | null; zeroedClock?: boolean;
}

/** Why a reject is on the no-lifter list: the lifter and/or winder it lacks (pure; exported for the tests). */
export function whyNoLifter(r: Pick<WhyInput, 'lifter' | 'winder'>): string[] {
  const why: string[] = [];
  if (r.lifter == null || r.lifter <= 0) why.push(WHY_NO_LIFTER);
  if (r.winder == null || r.winder <= 0) why.push(WHY_NO_WINDER);
  return why;
}

/** Why a reject is on the zero-code list (pure; the same rule as `zeroCodeSql`). */
export function whyZeroCode(r: Pick<WhyInput, 'rejectType' | 'tubeCode' | 'materialCode'>): string[] {
  return r.rejectType === 'quality' && (r.tubeCode === 0 || r.materialCode === 0) ? [WHY_ZERO_CODE] : [];
}

/** Every reason that applies to one reject (the zeroed-clock block uses this; pure; exported for the tests). */
export function whyUnknown(r: WhyInput): string[] {
  return [...whyNoLifter(r), ...whyZeroCode(r), ...(r.zeroedClock ? [WHY_CLOCK_ZEROED] : [])];
}

/** Which list a fetched reject belongs to; decides which reasons its `why` names. */
type ListKind = 'no_lifter' | 'zero_code' | 'zeroed_clock';

/** The sentence added to `note` when a list was cut at its cap. */
const cutNote = (what: string, shown: number, total: number): string =>
  `Only the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${what} are listed in this report.`;

interface RejectDetailRow {
  d: unknown;
  sc: string;
  ts: unknown;
  hg: number | null;
  st: number | null;
  li: number | null;
  rt: string;
  tc: number | null;
  mc: number | null;
  w: number | string | null;
}

const positive = (v: number | null | undefined): number | null => (v == null || Number(v) <= 0 ? null : Number(v));

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function toReject(r: RejectDetailRow, kind: ListKind): UnknownLifterReject {
  const lifter = positive(r.li);
  const winder = positive(r.st);
  const tubeCode = r.tc == null ? null : Number(r.tc);
  const materialCode = r.mc == null ? null : Number(r.mc);
  const rejectType = r.rt === 'weight' ? 'weight' : 'quality';
  return {
    date: dayOf(r.d),
    shift: r.sc as ShiftCode,
    producedAtUtc: isoOf(r.ts),
    // Hanger 0 is the plant's "no hanger" (the July weight sentinel carries it); like R7, print it as none, never as hanger 0.
    hanger: positive(r.hg),
    winder,
    lifter,
    rejectType,
    tubeCode,
    materialCode,
    weightG: r.w == null ? null : Number(r.w),
    why:
      kind === 'no_lifter' ? whyNoLifter({ lifter, winder })
      : kind === 'zero_code' ? whyZeroCode({ rejectType, tubeCode, materialCode })
      : whyUnknown({ lifter, winder, rejectType, tubeCode, materialCode, zeroedClock: true }),
  };
}

const DETAIL_COLUMNS = `shift_date AS d, shift_code AS sc, production_ts_utc AS ts, hanger_num AS hg, source_station AS st,
              lifter_station AS li, reject_type AS rt, tube_inspect_code AS tc, material_inspect_code AS mc, weight_g AS w`;

export async function getRejectedUnknownLifterReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<RejectedUnknownLifterReportData> {
  const { from, to } = resolved;
  // One source generation for the cones AND the rejects, resolved once.
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']);
  const f: RejectFilters = { from, to, shift: filters.shift, product: filters.product, shiftRange, scope };

  const coneReq = pool.request();
  const coneWhere = bindConeFilters(coneReq, lineId, f);
  const rejReq = pool.request();
  const rejWhere = bindRejectFilters(rejReq, lineId, f, '', false);

  const [cones, rejects, unmatched] = await Promise.all([
    coneReq.query<{ li: number | null; n: number }>(
      `SELECT lifter_station AS li, COUNT(*) AS n FROM sms.cone_event WHERE ${coneWhere} GROUP BY lifter_station`,
    ),
    // Rejects per lifter, counted in one pass. A zeroed-clock record is counted
    // apart (`fault`), never in A, B or B2: it is block C's.
    rejReq.query<{ li: number | null; q: number | null; zq: number | null; w: number | null; nl: number | null; fault: number | null }>(
      `SELECT lifter_station AS li,
              SUM(CASE WHEN production_ts_utc_ms > 0 AND reject_type = 'quality' THEN 1 ELSE 0 END) AS q,
              SUM(CASE WHEN production_ts_utc_ms > 0 AND ${zeroCodeSql()} THEN 1 ELSE 0 END) AS zq,
              SUM(CASE WHEN production_ts_utc_ms > 0 AND reject_type = 'weight' THEN 1 ELSE 0 END) AS w,
              SUM(CASE WHEN production_ts_utc_ms > 0 AND ${noLifterSql()} THEN 1 ELSE 0 END) AS nl,
              SUM(CASE WHEN production_ts_utc_ms <= 0 THEN 1 ELSE 0 END) AS fault
         FROM sms.reject_event
        WHERE ${rejWhere}
        GROUP BY lifter_station`,
    ),
    // Rejects with no cone row: the only ones that add to the inspected count
    // beside the cones (rejects.ts coneMatchPredicate). EXISTS cannot sit
    // inside SUM(CASE ...), so this is the shared grouped query, with the
    // zeroed-clock records parked under their own key.
    getUnmatchedRejects(
      pool,
      lineId,
      f,
      `CASE WHEN re.production_ts_utc_ms <= 0 THEN 'fault'
            WHEN re.lifter_station IS NULL OR re.lifter_station <= 0 THEN 'none'
            ELSE CAST(re.lifter_station AS varchar(10)) END`,
    ),
  ]);

  interface Acc { cones: number; unmatched: number; quality: number; zero: number; weight: number }
  const acc = new Map<number | null, Acc>();
  const at = (k: number | null): Acc => {
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { cones: 0, unmatched: 0, quality: 0, zero: 0, weight: 0 }));
    return a;
  };
  let unknownCount = 0;
  let zeroCodeTotal = 0;
  let excludedClockFault = 0;
  for (const r of cones.recordset) at(positive(r.li)).cones += Number(r.n ?? 0);
  for (const r of rejects.recordset) {
    const a = at(positive(r.li));
    a.quality += Number(r.q ?? 0);
    a.zero += Number(r.zq ?? 0);
    a.weight += Number(r.w ?? 0);
    unknownCount += Number(r.nl ?? 0);
    zeroCodeTotal += Number(r.zq ?? 0);
    excludedClockFault += Number(r.fault ?? 0);
  }
  for (const [k, n] of unmatched) {
    if (k === 'fault') continue;
    at(k === 'none' ? null : Number(k)).unmatched += n;
  }

  const rowOf = (lifter: number | null, a: Acc): LifterRow => {
    const inspected = a.cones + a.unmatched;
    const total = a.quality + a.weight;
    return {
      lifter, cones: a.cones, inspected, qualityRejects: a.quality, zeroCodeRejects: a.zero, weightRejects: a.weight, total,
      ratePct: inspected > 0 ? round((total / inspected) * 100, 2) : null,
    };
  };
  const anything = [...acc.values()].some((a) => a.cones + a.unmatched + a.quality + a.weight > 0);
  const lifters: LifterRow[] = [];
  const sum: Acc = { cones: 0, unmatched: 0, quality: 0, zero: 0, weight: 0 };
  if (anything) {
    const numbers = new Set<number>();
    for (let n = 1; n <= LIFTERS_ON_LINE; n++) numbers.add(n);
    for (const k of acc.keys()) if (k != null) numbers.add(k);
    const keys: (number | null)[] = [...numbers].sort((a, b) => a - b);
    const none = acc.get(null);
    if (none && none.cones + none.unmatched + none.quality + none.weight > 0) keys.push(null);
    for (const k of keys) {
      const a = acc.get(k) ?? { cones: 0, unmatched: 0, quality: 0, zero: 0, weight: 0 };
      lifters.push(rowOf(k, a));
      sum.cones += a.cones; sum.unmatched += a.unmatched; sum.quality += a.quality; sum.zero += a.zero; sum.weight += a.weight;
    }
  }

  // B: the rejects with no lifter or no winder recorded (the draft's "unknown"),
  // and B2: the rejects with a zero reason code, a separate list. Each runs only
  // when its aggregate count says it has a row, in the same one generation.
  const fetchList = async (predicate: string, kind: ListKind): Promise<UnknownLifterReject[]> => {
    const req = pool.request();
    const where = bindRejectFilters(req, lineId, f, '', false);
    req.input('cap', mssql.Int, LIST_CAP);
    const r = await req.query<RejectDetailRow>(
      `SELECT TOP (@cap) ${DETAIL_COLUMNS}
         FROM sms.reject_event
        WHERE ${where} AND production_ts_utc_ms > 0 AND ${predicate}
        ORDER BY production_ts_utc_ms, reject_event_id`,
    );
    return r.recordset.map((x) => toReject(x, kind));
  };
  const [list, zeroCodeList] = await Promise.all([
    unknownCount > 0 ? fetchList(noLifterSql(), 'no_lifter') : Promise.resolve<UnknownLifterReject[]>([]),
    zeroCodeTotal > 0 ? fetchList(zeroCodeSql(), 'zero_code') : Promise.resolve<UnknownLifterReject[]>([]),
  ]);

  // C: the zeroed-clock records of THE PERIOD'S OWN generation, whatever period
  // or filter was chosen (no period reaches shift date 1969-12-31). Resolved by
  // the generation key the period already chose, so it can never read another
  // generation's records.
  const gen = scope.generation;
  const zeroedRows: UnknownLifterReject[] = [];
  let zeroedCut = false;
  if (gen) {
    const zScope = await resolveGenerationScope(pool, lineId, {}, ['reject_event'], { key: gen.key });
    const req = pool.request().input('line', mssql.Int, lineId).input('cap', mssql.Int, LIST_CAP);
    const where = andEpoch('line_id = @line AND production_ts_utc_ms <= 0', req, zScope, 'reject_event');
    const r = await req.query<RejectDetailRow>(
      `SELECT TOP (@cap) ${DETAIL_COLUMNS}
         FROM sms.reject_event
        WHERE ${where}
        ORDER BY production_ts_utc_ms, reject_event_id`,
    );
    for (const x of r.recordset) zeroedRows.push(toReject(x, 'zeroed_clock'));
    zeroedCut = r.recordset.length >= LIST_CAP;
  }
  const genLabel = gen
    ? gen.simulator
      ? `${gen.label ?? gen.sourceDb ?? 'unknown'} (plant simulator, synthetic data)`
      : (gen.label ?? gen.sourceDb ?? gen.key)
    : null;

  const notes = [REJECTED_UNKNOWN_LIFTER_NOTE];
  if (unknownCount > list.length) notes.push(cutNote('rejects with no lifter or winder recorded', list.length, unknownCount));
  if (zeroCodeTotal > zeroCodeList.length) notes.push(cutNote('rejects with a zero reason code', zeroCodeList.length, zeroCodeTotal));
  if (zeroedCut) notes.push(`The block of zeroed-clock records holds at least ${zeroedRows.length.toLocaleString('en-US')} records; only the first ${zeroedRows.length.toLocaleString('en-US')} are listed.`);

  return {
    period: resolved,
    filters,
    lineId,
    lifters,
    total: anything ? rowOf(null, sum) : { ...EMPTY_TOTAL },
    unknownCount,
    list,
    listTotal: unknownCount,
    listCap: LIST_CAP,
    zeroCodeList,
    zeroCodeTotal,
    excludedClockFault,
    zeroedClock: { generation: genLabel, rows: zeroedRows },
    note: notes.join(' '),
    pendingIfl: [...REJECTED_UNKNOWN_LIFTER_PENDING_IFL],
    generationNote: noteOf(scope),
  };
}

export const REJECTED_UNKNOWN_LIFTER_CSV_HEADERS = [
  'section', 'lifter', 'cones', 'inspected', 'quality_rejects', 'zero_code_rejects', 'weight_rejects', 'total_rejects', 'rate_pct',
  'date', 'produced_at_plant_time', 'shift', 'hanger', 'winder', 'reject_type', 'tube_code', 'material_code', 'weight_g', 'why',
] as const;

/**
 * Sections: `lifter` (table A, the "No lifter recorded" bucket with an empty
 * `lifter`), `total`, `no_lifter` (table B: no lifter or no winder recorded),
 * `zero_code` (B2: a zero reason code, meaning not confirmed by IFL) and
 * `zeroed_clock` (table C). A reject that is on both lists appears once in each,
 * its `why` naming that list's reason. `why` joins the reasons with "; ".
 */
export function rejectedUnknownLifterCsv(d: RejectedUnknownLifterReportData): CsvTable {
  const H = REJECTED_UNKNOWN_LIFTER_CSV_HEADERS;
  const lifterRow = (section: string, r: LifterRow): CsvRow =>
    csvRowOf(H, {
      section, lifter: r.lifter, cones: r.cones, inspected: r.inspected, quality_rejects: r.qualityRejects, zero_code_rejects: r.zeroCodeRejects,
      weight_rejects: r.weightRejects, total_rejects: r.total, rate_pct: r.ratePct,
    });
  const rejectRow = (section: string, r: UnknownLifterReject): CsvRow =>
    csvRowOf(H, {
      section,
      lifter: r.lifter,
      date: r.date,
      produced_at_plant_time: plantWallClock(r.producedAtUtc),
      shift: r.shift,
      hanger: r.hanger,
      winder: r.winder,
      reject_type: r.rejectType,
      tube_code: r.tubeCode,
      material_code: r.materialCode,
      weight_g: r.weightG,
      why: r.why.join('; '),
    });
  const rows: CsvRow[] = [
    ...d.lifters.map((r) => lifterRow('lifter', r)),
    lifterRow('total', d.total),
    ...d.list.map((r) => rejectRow('no_lifter', r)),
    ...(d.zeroCodeList ?? []).map((r) => rejectRow('zero_code', r)),
    ...d.zeroedClock.rows.map((r) => rejectRow('zeroed_clock', r)),
  ];
  return { headers: H, rows };
}
