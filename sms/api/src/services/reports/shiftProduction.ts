/**
 * Shift-wise CTS Loop Production Report (IFL's report 1 of 8) — styled after
 * IFL's own SSRS shift report (30 Sep 2026); titled in IFL's words 1 Oct 2026;
 * counting corrected (D1) 1 Oct 2026.
 *
 * Per shift, per production date and per winder (winder = station, 1..14):
 * weighed, pass, weight rejects, total, efficiency = pass / total, and the
 * weighed kilograms. Subtotals per shift and per day, per-winder totals over
 * the period, a per-shift summary and a grand total. Everything is grouped
 * under the line (LINE_NAME). IFL's "CTS loop" is the line's one hanger loop
 * (hangers 1..299 shared by all 14 winders), so there is a single loop and the
 * report states how many hangers the period saw (`loop.hangersSeen`, computed),
 * assumed until IFL confirms (`pendingIfl`).
 *
 * D1 — EACH PHYSICAL CONE IS COUNTED ONCE. A weight-rejected cone is ALSO a
 * cone row: every real weight reject has one (244 of 245 July, 31 of 31
 * September), same production instant and hanger (rejects.ts
 * `coneMatchPredicate`, the one predicate every "was this reject already a
 * cone" check in the app uses). The 30 Sep logic printed pass = every cone row
 * and then added the weight rejects to it, so each such cone was in Total
 * twice. Now:
 *   weighed        = cone rows
 *   weight rejects = reject_type = 'weight' records (a null weight_g is still a
 *                    reject: the cone WAS rejected, only its weight is unknown)
 *   pass           = weighed minus the cones that carry a weight-reject record
 *   total          = pass + weight rejects  (= weighed + the rejects with no cone row)
 * The matched cones are counted from the reject side (a reject joined to its
 * cone, COUNT(DISTINCT cone), grouped by the CONE's own date/shift/winder)
 * because SQL Server cannot put EXISTS inside SUM(CASE ...); pass in each cell
 * is then weighed minus matched. Both sides are epoch-scoped, so a reject from
 * one generation can never "match" a cone of another (the plant simulator
 * replays the real timing, so this is not hypothetical on the dev copy).
 *
 * WHAT "REJECT" MEANS HERE. Only WEIGHT rejects count, as in IFL's own sheet.
 * Quality (inspection) rejects are NOT part of this efficiency and `note` says
 * so. The scale's own in-range bit (cone_event.in_range) is a SEPARATE record:
 * it disagrees with the weight-reject table on a few cones (September: 49 versus
 * 41), so it is reported beside it (`scaleRejectedCones`) and never merged.
 *
 * WEIGHED KG. The sum of the PLAUSIBLE cone weights (the one population rule,
 * coneState.ts `plausibleWhere`), under the weight rule's basis as of the
 * period end (ruleAsOf.ts, RT24-04) — as_recorded and gross subtract nothing,
 * net subtracts the cone tube weight, exactly as weights.ts does. `kgBasis` says
 * which and how many cones the plausibility window left out. An unknown weight
 * is null, never 0.
 *
 * One source generation, scoped once and applied to every table, so a period
 * spanning IFL's rebuild (or the plant simulator) cannot pool two populations.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_CODES, type ShiftCode } from '@sms/shared';
import { plausibleWhere } from '../coneState.js';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import { coneMatchPredicate } from '../rejects.js';
import { getPlausibilityRuleAsOf, getWeightRuleAsOf, plantDayEndMs, plantDayStartMs, type WeightRule } from '../ruleAsOf.js';
import { csvRowOf, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { shiftRangeClause, type ShiftRange } from '../../shiftRange.js';

export interface ShiftProductionFigures {
  /** Cones weighed: every cone row, whatever its result. */
  weighed: number;
  /**
   * Cones that passed: weighed minus the cones that carry a weight-reject
   * record (D1 — a weight-rejected cone is also a cone row, and is counted
   * once, as a reject). Never negative.
   */
  pass: number;
  /** Weight rejects (reject_type = 'weight' records, whether or not they carry a weight). */
  weightRejects: number;
  /** pass + weightRejects. */
  total: number;
  /** pass / total x 100 to 2 dp; null when total is 0. */
  efficiencyPct: number | null;
  /**
   * Sum of the PLAUSIBLE cone weights of the cones weighed, in kg, under the
   * weight rule's basis as of the period end (`kgBasis` names it). null when
   * no plausible cone was weighed — an unknown weight is not a zero weight.
   */
  weighedKg: number | null;
}

export interface ShiftProductionSummaryRow extends ShiftProductionFigures {
  shift: ShiftCode;
}

export interface ShiftProductionRow extends ShiftProductionFigures {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** Winder = station, 1..14. */
  winder: number;
}

export interface ShiftProductionShiftTotal extends ShiftProductionFigures {
  date: string;
  shift: ShiftCode;
}

/** One production day, every shift and winder together (the per-day subtotal). */
export interface ShiftProductionDayTotal extends ShiftProductionFigures {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
}

/** One winder over the whole period, every day and shift together. */
export interface ShiftProductionWinderTotal extends ShiftProductionFigures {
  /** Winder = station, 1..14. */
  winder: number;
}

export interface ShiftProductionReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  /** The report is for this line only. */
  lineId: number;
  /** One entry per shift present in the period, in shift order (morning, evening, night). */
  summary: ShiftProductionSummaryRow[];
  grandTotal: ShiftProductionFigures;
  /** Per production date, shift and winder, sorted by date, shift order, winder. */
  rows: ShiftProductionRow[];
  /** Per production date and shift, sorted by date then shift order. */
  shiftTotals: ShiftProductionShiftTotal[];
  /** Cones and weight rejects with no winder recorded: in summary/grandTotal/shiftTotals, absent from rows. */
  withoutWinder: { pass: number; weightRejects: number };
  /** Per production date (all shifts, all winders), sorted by date. */
  dayTotals: ShiftProductionDayTotal[];
  /** Per winder over the period (all days, all shifts), sorted by winder. */
  winderTotals: ShiftProductionWinderTotal[];
  /**
   * "CTS loop" is IFL's word for the line's hanger loop. TP1 has ONE loop
   * (hangers 1..299 shared by all 14 winders); the report states how many
   * distinct hanger numbers the period actually saw — computed, never
   * hard-coded — and says the grouping is assumed (`pendingIfl`).
   */
  loop: { hangersSeen: number };
  /**
   * Cone rows the SCALE's own in-range bit marked out of range. A separate
   * fact from the weight-reject records (they disagree on a few cones —
   * September: 49 versus 41) and never merged into them; the report prints
   * both and says so.
   */
  scaleRejectedCones: number;
  /** What `weighedKg` was computed under; null until computed. */
  kgBasis: { basis: 'as_recorded' | 'gross' | 'net'; label: string; implausible: number } | null;
  note: string;
  /** "Assumed until IFL confirms" lines: each a plain sentence naming a default this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const SHIFT_PRODUCTION_NOTE =
  'Each cone is counted once. Weighed is every cone the scale weighed; weight rejects are the cones the scale rejected on weight ' +
  '(the weight-reject records); pass is the cones weighed that carry no weight-reject record; total is pass plus weight rejects, so a ' +
  'cone that was weighed and then rejected on weight counts once, as a reject. Efficiency is pass divided by total. Quality (inspection) ' +
  'rejects are not part of this efficiency, as in IFL’s own shift report. Winder is the weighing station.';

/** Appended to `note` when the plausibility window or the weight basis changed inside the period (RT24-04). */
const RULE_CHANGED_NOTE =
  ' The plausibility window or the weight basis was changed during this period; weighed kg uses the one in force at its end.';

/** The defaults this report applies until IFL answers; printed on every surface as "Assumed until IFL confirms". */
export const SHIFT_PRODUCTION_PENDING_IFL: readonly string[] = [
  'The line has one hanger loop shared by all 14 winders, so "CTS loop" is taken to mean the whole line; IFL has not confirmed what its loop grouping means.',
  'Every cone is counted once: a cone that was weighed and then rejected on weight is in the total as a reject, not also as a pass. IFL has not confirmed how its own shift sheet counts such a cone.',
  'The weight rejects are the weight-reject records; the scale’s own in-range bit is shown beside them and is not merged into them. IFL has not confirmed which of the two it means by a weight rejection.',
  'Weighed kg is the sum of plausible cone weights under the weight basis set in Setup; IFL has not confirmed whether recorded weights are gross or net.',
];

const SHIFT_ORD: Record<string, number> = { morning: 1, evening: 2, night: 3 };
const ord = (s: string): number => SHIFT_ORD[s] ?? 9;

export function figures(pass: number, weightRejects: number, weighed: number = pass, weighedKg: number | null = null): ShiftProductionFigures {
  const total = pass + weightRejects;
  return { weighed, pass, weightRejects, total, efficiencyPct: total > 0 ? round((pass / total) * 100, 2) : null, weighedKg };
}

/** The cone tube weight weights.ts's `loadWeightRule` falls back to when a rule row carries none. */
const DEFAULT_TUBE_G = 70;

/**
 * The basis `weighedKg` is stated under, from the weight rule as of the period
 * end (null = no rule on file, i.e. IFL has not confirmed gross or net: the
 * readings are used as the scale recorded them). `tubeG` is what a NET basis
 * subtracts from every cone, in grams; 0 under the other two, exactly as
 * weights.ts (`coneAdj`) does, so this report and the Weight screen cannot
 * disagree about the same cones' kilograms.
 */
export function kgBasisOf(rule: WeightRule | null): { basis: 'as_recorded' | 'gross' | 'net'; label: string; tubeG: number } {
  const raw = rule?.basis;
  if (raw === 'net') {
    const tubeG = rule?.coneTubeWeightG ?? DEFAULT_TUBE_G;
    return { basis: 'net', label: `net of the ${tubeG} g cone tube set in Setup`, tubeG };
  }
  if (raw === 'gross') return { basis: 'gross', label: 'gross, as the scale recorded them', tubeG: 0 };
  return { basis: 'as_recorded', label: 'as the scale recorded them', tubeG: 0 };
}

const n0 = (n: number): string => n.toLocaleString('en-US');

/**
 * The three computed sentences this report prints besides `note`: the loop
 * line, the scale-bit-versus-reject-records line and the kg basis line. The
 * screen renders the same words from lib/words.ts (W.iflReports.shiftProduction,
 * which holds the same templates); this is the plain-string form for the
 * surfaces with no access to the web words (CSV/XLSX attribution rows, the
 * closing notes) — see `reportNotesOf` (notes.ts).
 */
export function shiftProductionCaveats(
  d: Pick<ShiftProductionReportData, 'loop' | 'scaleRejectedCones' | 'grandTotal' | 'kgBasis'>,
): string[] {
  const h = d.loop.hangersSeen;
  const out = [
    `CTS loop: the line’s one hanger loop — ${n0(h)} ${h === 1 ? 'hanger number' : 'hanger numbers'} seen in this period.`,
    `The scale’s own in-range bit marked ${n0(d.scaleRejectedCones)} ${d.scaleRejectedCones === 1 ? 'cone' : 'cones'}; ` +
      `the weight-reject records hold ${n0(d.grandTotal.weightRejects)}; they are separate records and are not merged.`,
  ];
  if (d.kgBasis) {
    const i = d.kgBasis.implausible;
    out.push(
      `Weighed kg is the sum of the plausible cone weights, ${d.kgBasis.label}. ${n0(i)} ${i === 1 ? 'reading' : 'readings'} ` +
        `outside the plausibility window ${i === 1 ? 'is' : 'are'} not in it.`,
    );
  }
  return out;
}

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** One cell of cones: weighed, how many of them had a plausible weight, those weights' sum (g, basis applied), the scale's own rejects. */
interface ConeCountRow { d: unknown; sc: string; st: number | null; n: number; pn: number; g: number | null; sr: number }
interface CountRow { d: unknown; sc: string; st: number | null; n: number }

/** A counting bucket. Every level of the report (cell, shift, day, winder, grand) is a sum of CELLS, so the levels always add up. */
interface Acc { weighed: number; pass: number; rej: number; grams: number; plausible: number; scaleRej: number }
const zeroAcc = (): Acc => ({ weighed: 0, pass: 0, rej: 0, grams: 0, plausible: 0, scaleRej: 0 });
function addTo(to: Acc, c: Acc): void {
  to.weighed += c.weighed;
  to.pass += c.pass;
  to.rej += c.rej;
  to.grams += c.grams;
  to.plausible += c.plausible;
  to.scaleRej += c.scaleRej;
}
function into<K>(m: Map<K, Acc>, k: K, c: Acc): void {
  let a = m.get(k);
  if (!a) { a = zeroAcc(); m.set(k, a); }
  addTo(a, c);
}
const figuresOf = (a: Acc): ShiftProductionFigures =>
  figures(a.pass, a.rej, a.weighed, a.plausible > 0 ? round(a.grams / 1000, 3) : null);

/** A request stand-in for building a second copy of a clause whose parameters are already bound. */
const ALREADY_BOUND = { input: () => undefined };

export async function getShiftProductionReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<ShiftProductionReportData> {
  const { from, to } = resolved;
  const endMs = plantDayEndMs(to);
  const startMs = plantDayStartMs(from);
  // The rules AS OF the period end (RT24-04), not whatever Setup holds today.
  const [scope, plausR, weightR] = await Promise.all([
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']),
    getPlausibilityRuleAsOf(pool, lineId, endMs, startMs),
    getWeightRuleAsOf(pool, lineId, endMs, startMs),
  ]);
  const window = { loG: plausR.rule.coneLoG, hiG: plausR.rule.coneHiG };
  const basis = kgBasisOf(weightR.rule);

  /**
   * The WHERE for one table: line, period, shift filter, shift range, and the
   * one generation. `bindShared` false builds the same text for a second table
   * on a request whose shared parameters are already bound (mssql refuses a
   * parameter declared twice); the per-table epoch parameters are distinct
   * names (`ger0` for rejects, `gec0` for cones), so they bind either way.
   */
  const where = (req: mssql.Request, table: 'cone_event' | 'reject_event', alias: string, bindShared = true): string => {
    const c = (name: string) => `${alias}${name}`;
    if (bindShared) {
      req.input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
      if (filters.shift) req.input('shift', mssql.VarChar(10), filters.shift);
    }
    let w = `${c('line_id')} = @line AND ${c('shift_date')} BETWEEN @from AND @to`;
    if (filters.shift) w += ` AND ${c('shift_code')} = @shift`;
    if (shiftRange) w += ` AND ${shiftRangeClause(shiftRange, { date: c('shift_date'), code: c('shift_code') }, bindShared ? req : ALREADY_BOUND)}`;
    return andEpoch(w, req, scope, table, { alias });
  };

  const queryCones = async (): Promise<ConeCountRow[]> => {
    const req = pool.request();
    const w = where(req, 'cone_event', '');
    const plaus = plausibleWhere(req, 'weight_g', window);
    req.input('coneAdj', mssql.Float, basis.tubeG);
    const r = await req.query<ConeCountRow>(
      `SELECT shift_date AS d, shift_code AS sc, source_station AS st, COUNT(*) AS n,
              SUM(CASE WHEN ${plaus} THEN 1 ELSE 0 END) AS pn,
              SUM(CASE WHEN ${plaus} THEN weight_g - @coneAdj ELSE 0 END) AS g,
              SUM(CASE WHEN in_range = 0 THEN 1 ELSE 0 END) AS sr
         FROM sms.cone_event
        WHERE ${w}
        GROUP BY shift_date, shift_code, source_station`,
    );
    return r.recordset;
  };

  // Every weight reject, whether or not it carries a weight and whether or not
  // it has a cone row: the cone WAS rejected on weight.
  const queryRejects = async (): Promise<CountRow[]> => {
    const req = pool.request();
    const w = where(req, 'reject_event', '');
    const r = await req.query<CountRow>(
      `SELECT shift_date AS d, shift_code AS sc, source_station AS st, COUNT(*) AS n
         FROM sms.reject_event
        WHERE ${w} AND reject_type = 'weight'
        GROUP BY shift_date, shift_code, source_station`,
    );
    return r.recordset;
  };

  // The cones that carry a weight-reject record, counted once each, in THEIR
  // own cell. Driven from the reject side because SQL Server cannot put EXISTS
  // inside SUM(CASE ...); the cone side carries the same filters and the same
  // generation, so matched(cell) is always a subset of weighed(cell). (Two
  // weight-reject records on ONE cone would count that cone once here and twice
  // in the rejects; the data holds none: 0 duplicate weight-reject keys in any
  // generation, checked 1 Oct 2026.)
  const queryMatched = async (): Promise<CountRow[]> => {
    const req = pool.request();
    const reWhere = where(req, 'reject_event', 're.');
    const ceWhere = where(req, 'cone_event', 'ce.', false);
    const r = await req.query<CountRow>(
      `SELECT ce.shift_date AS d, ce.shift_code AS sc, ce.source_station AS st, COUNT(DISTINCT ce.cone_event_id) AS n
         FROM sms.reject_event re
         JOIN sms.cone_event ce ON ${coneMatchPredicate('re', 'ce')}
        WHERE ${reWhere} AND re.reject_type = 'weight' AND ${ceWhere}
        GROUP BY ce.shift_date, ce.shift_code, ce.source_station`,
    );
    return r.recordset;
  };

  // How many distinct hanger numbers the cones of the period rode (0 = none recorded).
  const queryHangers = async (): Promise<number> => {
    const req = pool.request();
    const w = where(req, 'cone_event', '');
    const r = await req.query<{ h: number | null }>(
      `SELECT COUNT(DISTINCT hanger_num) AS h FROM sms.cone_event WHERE ${w} AND hanger_num > 0`,
    );
    return Number(r.recordset[0]?.h ?? 0);
  };

  const [cones, rejects, matched, hangersSeen] = await Promise.all([queryCones(), queryRejects(), queryMatched(), queryHangers()]);

  // ---- one cell per production date x shift x winder (a null winder is its own cell)
  type Cell = Acc & { date: string; shift: ShiftCode; winder: number | null; matched: number };
  const cells = new Map<string, Cell>();
  const cellOf = (r: CountRow): Cell => {
    const date = dayOf(r.d);
    const shift = r.sc as ShiftCode;
    const winder = r.st == null ? null : Number(r.st);
    const key = `${date}|${shift}|${winder ?? 'none'}`;
    let c = cells.get(key);
    if (!c) { c = { ...zeroAcc(), date, shift, winder, matched: 0 }; cells.set(key, c); }
    return c;
  };
  for (const r of cones) {
    const c = cellOf(r);
    c.weighed += Number(r.n);
    c.plausible += Number(r.pn);
    c.grams += Number(r.g ?? 0);
    c.scaleRej += Number(r.sr);
  }
  for (const r of rejects) cellOf(r).rej += Number(r.n);
  for (const r of matched) cellOf(r).matched += Number(r.n);

  // ---- every level is a sum of cells, so the levels always add up
  const dayShift = new Map<string, Acc & { date: string; shift: ShiftCode }>();
  const byDay = new Map<string, Acc>();
  const byWinder = new Map<number, Acc>();
  const byShift = new Map<ShiftCode, Acc>();
  const grand = zeroAcc();
  const without = { pass: 0, weightRejects: 0 };
  const cellRows: (Acc & { date: string; shift: ShiftCode; winder: number })[] = [];
  for (const c of cells.values()) {
    // Pass = weighed minus the cones that carry a weight-reject record; a cell can never go below zero.
    c.pass = Math.max(0, c.weighed - c.matched);
    const ds = dayShift.get(`${c.date}|${c.shift}`) ?? { ...zeroAcc(), date: c.date, shift: c.shift };
    addTo(ds, c);
    dayShift.set(`${c.date}|${c.shift}`, ds);
    into(byDay, c.date, c);
    into(byShift, c.shift, c);
    addTo(grand, c);
    if (c.winder == null) {
      without.pass += c.pass;
      without.weightRejects += c.rej;
    } else {
      into(byWinder, c.winder, c);
      cellRows.push({ ...c, winder: c.winder });
    }
  }

  const rows: ShiftProductionRow[] = cellRows
    .sort((a, b) => a.date.localeCompare(b.date) || ord(a.shift) - ord(b.shift) || a.winder - b.winder)
    .map((c) => ({ date: c.date, shift: c.shift, winder: c.winder, ...figuresOf(c) }));
  const shiftTotals: ShiftProductionShiftTotal[] = [...dayShift.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || ord(a.shift) - ord(b.shift))
    .map((c) => ({ date: c.date, shift: c.shift, ...figuresOf(c) }));
  const dayTotals: ShiftProductionDayTotal[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, a]) => ({ date, ...figuresOf(a) }));
  const winderTotals: ShiftProductionWinderTotal[] = [...byWinder.entries()]
    .sort(([a], [b]) => a - b)
    .map(([winder, a]) => ({ winder, ...figuresOf(a) }));
  const summary: ShiftProductionSummaryRow[] = SHIFT_CODES.filter((s) => byShift.has(s)).map((s) => ({ shift: s, ...figuresOf(byShift.get(s)!) }));

  return {
    period: resolved,
    filters,
    lineId,
    summary,
    grandTotal: figuresOf(grand),
    rows,
    shiftTotals,
    withoutWinder: without,
    dayTotals,
    winderTotals,
    loop: { hangersSeen },
    scaleRejectedCones: grand.scaleRej,
    kgBasis: { basis: basis.basis, label: basis.label, implausible: grand.weighed - grand.plausible },
    note: SHIFT_PRODUCTION_NOTE + (plausR.ruleChangedInPeriod || weightR.ruleChangedInPeriod ? RULE_CHANGED_NOTE : ''),
    pendingIfl: [...SHIFT_PRODUCTION_PENDING_IFL],
    generationNote: noteOf(scope),
  };
}

export const SHIFT_PRODUCTION_CSV_HEADERS = [
  'section', 'date', 'shift', 'winder', 'weighed', 'pass', 'weight_rejects', 'total', 'efficiency_pct', 'weighed_kg',
] as const;

export function shiftProductionCsv(d: ShiftProductionReportData): CsvTable {
  const H = SHIFT_PRODUCTION_CSV_HEADERS;
  const line = (section: string, date: string | null, shift: string | null, winder: number | null, f: ShiftProductionFigures): CsvRow =>
    csvRowOf(H, {
      section, date, shift, winder, weighed: f.weighed, pass: f.pass, weight_rejects: f.weightRejects, total: f.total,
      efficiency_pct: f.efficiencyPct, weighed_kg: f.weighedKg,
    });
  const rows: CsvRow[] = [
    ...d.summary.map((s) => line('summary', null, s.shift, null, s)),
    line('grand_total', null, null, null, d.grandTotal),
    ...d.rows.map((r) => line('winder', r.date, r.shift, r.winder, r)),
    ...d.shiftTotals.map((r) => line('shift_total', r.date, r.shift, null, r)),
    ...d.dayTotals.map((r) => line('day_total', r.date, null, null, r)),
    ...d.winderTotals.map((r) => line('winder_total', null, null, r.winder, r)),
  ];
  return { headers: H, rows };
}
