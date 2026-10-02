/**
 * The report's own printable notes — IFL reports, D6 (1 Oct 2026).
 *
 * A figure on a report is only as honest as the caveats that travel with it,
 * and the caveats used to travel on ONE surface: the screen. The CSV, the
 * workbook and the printed page each said whatever its own code remembered to
 * say, so the same report could carry three different sets of assumptions. This
 * module composes them ONCE, from the report DATA (never from the screen), as
 * plain sentences; `buildHeader` puts them on `ReportHeader.reportNotes` and
 * every surface reads that one list:
 *
 *   - the CSV's trailing attribution rows, as `report_note` rows (csv.ts);
 *   - the workbook's header sheet, which is built from those same rows (xlsx.ts);
 *   - the printed closing notes (web PrintDoc.tsx `PrintNotes`);
 *   - the screen's own "Assumed until IFL confirms" block reads `pendingIfl`
 *     from the same data, so all four agree by construction.
 *
 * WHAT IT COMPOSES, IN ORDER, for each of IFL's eight reports:
 *   1. the report's own method note (`note`);
 *   2. the caveats computed from THIS period's figures — how many cones the
 *      scale's own bit marked beside the weight-reject records, which weight
 *      basis the kilograms are on, how many readings the plausibility window
 *      left out, what was dropped as a clock fault, what a cut list left out;
 *   3. every default the report applied because IFL has not answered
 *      (`pendingIfl`), each under the heading "Assumed until IFL confirms" — the
 *      same heading the screen prints, so the printed page can recognise a line
 *      it already carries and not state it twice.
 *
 * PURE: no clock, no database, no I/O, the input is never mutated. A type that
 * is not one of IFL's eight returns `[]`: the earlier ten reports already print
 * their own notes beside their figures (PrintDoc's `summarise`), and giving them
 * a second copy here would print every caveat twice. A payload with a field
 * missing (an older server, a fixture) yields the notes it CAN state rather than
 * throwing: notes are decoration over figures the report states anyway.
 */
import type { ReportType } from './common.js';
import { shiftProductionCaveats, type ShiftProductionReportData } from './shiftProduction.js';

/** The heading over every "assumed until IFL confirms" line. The screen prints the same words (web `W.iflReports.pendingHeading`). */
export const PENDING_IFL_HEADING = 'Assumed until IFL confirms';

/** The reports that carry notes: IFL's eight, by report type. */
export const IFL_NOTE_TYPES: readonly ReportType[] = [
  'shift-production',
  'rejected-sacks',
  'sps-packing',
  'sack-weight-range',
  'sack-weight-summary',
  'rejected-cones',
  'rejected-hangers',
  'rejected-unknown-lifter',
];

/** The sentence for limits qualified "no later than" — the same words the screen prints (web `W.iflReports.rejectedConesList.lowerBoundNote`). */
export const LIMITS_LOWER_BOUND_NOTE =
  'Limits marked “oldest on record” are the earliest version known; the reading is older than that record, so the limits in force at the time may have differed (they are “no later than” this version).';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => v != null && typeof v === 'object' && !Array.isArray(v);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const n0 = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`): string => `${n0(n)} ${n === 1 ? one : many}`;
const isAre = (n: number): string => (n === 1 ? 'is' : 'are');
/** "carries" for one, "carry" for more: `carry${n === 1 ? 's' : ''}` spells "carrys". */
const carries = (n: number): string => (n === 1 ? 'carries' : 'carry');

/** How a weight basis code reads in a sentence. An unknown code is left out rather than guessed at. */
function basisSentence(code: unknown): string | null {
  switch (code) {
    case 'as_recorded': return 'Sack weights are as the scale recorded them; nothing is subtracted.';
    case 'gross': return 'Sack weights are gross, as the scale recorded them.';
    case 'net': return 'Sack weights are net of the sack tare set in Setup.';
    default: return null;
  }
}

/**
 * The plausibility window as one sentence, for sacks (kg) or cones (g), saying what a reading outside it is left out of
 * (`leftOutOf`). Null when the window is absent or malformed.
 */
function windowSentence(kind: 'sack' | 'cone', lo: unknown, hi: unknown, left: number | null, leftOutOf = 'the averages and ranges'): string | null {
  const l = num(lo);
  const h = num(hi);
  if (l == null || h == null) return null;
  const unit = kind === 'sack' ? 'kg' : 'g';
  const what = kind === 'sack' ? 'sack weights' : 'cone weights';
  const tail =
    left == null
      ? ''
      : left === 0
        ? ' No reading in this period was left out.'
        : ` ${plural(left, kind === 'sack' ? 'sack' : 'reading')} in this period ${isAre(left)} left out.`;
  return `Plausibility window: ${what} outside ${n0(l)}–${n0(h)} ${unit} are treated as faults and left out of ${leftOutOf}.${tail}`;
}

/** Records stamped 1 January 1970 (a zeroed clock) that no period can reach, dropped from the list and counted. */
function clockFaultSentence(n: unknown, what: string): string | null {
  const c = num(n);
  if (c == null || c <= 0) return null;
  return `${plural(c, what)} stamped 1 January 1970 (a zeroed clock) can be placed in no period and ${isAre(c)} left out of the list.`;
}

/** A list cut at its cap says so, unless the report's own note already did. */
function cutSentence(d: Rec, what: string): string | null {
  const total = num(d.listTotal);
  const cap = num(d.listCap);
  if (total == null || cap == null || total <= cap) return null;
  if ((str(d.note) ?? '').includes('Only the first')) return null;
  return `Only the first ${n0(cap)} of ${n0(total)} ${what} are listed in this report; the tables above count all of them.`;
}

function pendingLines(d: Rec): string[] {
  return arr(d.pendingIfl)
    .map(str)
    .filter((l): l is string => l != null)
    .map((l) => `${PENDING_IFL_HEADING}: ${l}`);
}

/** The caveats computed from one report's own figures, per type. Each returns only sentences it can truthfully state from the data it was given. */
function caveatsOf(type: ReportType, d: Rec): (string | null)[] {
  switch (type) {
    case 'shift-production': {
      // The three computed sentences (loop, scale bit beside the weight-reject records, kg basis) live beside the report. They need
      // three figures; a payload that predates any of them states none of the sentences rather than half of one.
      const hangersSeen = num(rec(d.loop).hangersSeen);
      const scaleRejected = num(d.scaleRejectedCones);
      if (hangersSeen == null || scaleRejected == null || num(rec(d.grandTotal).weightRejects) == null) return [];
      const kg = rec(d.kgBasis);
      return shiftProductionCaveats({
        loop: { hangersSeen },
        scaleRejectedCones: scaleRejected,
        grandTotal: d.grandTotal as unknown as ShiftProductionReportData['grandTotal'],
        kgBasis: str(kg.label) != null && num(kg.implausible) != null ? (d.kgBasis as unknown as ShiftProductionReportData['kgBasis']) : null,
      });
    }

    case 'rejected-cones': {
      const range = rec(d.weightRange);
      const plaus = rec(range.plausibility);
      const list = arr(d.list).map(rec);
      const station = num(rec(d.filters).station);
      return [
        windowSentence('cone', plaus.loG, plaus.hiG, num(range.excludedImplausible)),
        clockFaultSentence(d.excludedClockFault, 'rejected cone record'),
        station != null ? `Narrowed to winder ${station}: the weight range is that winder’s own and no whole-line range is given.` : null,
        list.some((r) => isRec(r.limits) && rec(r.limits).lowerBound === true) ? LIMITS_LOWER_BOUND_NOTE : null,
        list.some((r) => r.limits == null)
          ? 'A row with no limits stated has no product, or no limits on record, for the time it was weighed; its “outside limits by” is left blank.'
          : null,
      ];
    }

    case 'rejected-sacks': {
      const plaus = rec(d.plausibility);
      const total = rec(d.total);
      const noFlag = num(total.noFlag) ?? 0;
      return [
        basisSentence(d.weightBasis),
        windowSentence('sack', plaus.loKg, plaus.hiKg, null, 'the range of sacks the scale passed'),
        noFlag > 0 ? `${plural(noFlag, 'sack')} ${carries(noFlag)} no scale verdict; ${noFlag === 1 ? 'it is' : 'they are'} counted apart and never as passes.` : null,
        clockFaultSentence(d.excludedClockFault, 'sack record'),
        cutSentence(d, 'rejected sacks'),
      ];
    }

    case 'sps-packing': {
      const implausible = num(d.implausibleSacks) ?? 0;
      return [
        basisSentence(d.weightBasis),
        implausible > 0
          ? `${plural(implausible, 'sack')} with an implausible weight ${isAre(implausible)} counted in sacks and kilograms and left out of every average.`
          : null,
      ];
    }

    case 'sack-weight-range': {
      const plaus = rec(d.plausibility);
      const implausible = num(d.implausibleSacks);
      const passed = isRec(d.passedRange) ? d.passedRange : null;
      const lo = passed ? num(passed.minKg) : null;
      const hi = passed ? num(passed.maxKg) : null;
      const band = num(d.bandKg);
      return [
        basisSentence(d.weightBasis),
        windowSentence('sack', plaus.loKg, plaus.hiKg, implausible),
        band != null ? `Bands are ${band} kg wide; passed and rejected are the scale’s own verdict.` : null,
        lo != null && hi != null ? `The scale passed sacks from ${lo} to ${hi} kg in this period; that is a recorded fact, not a tolerance.` : null,
      ];
    }

    case 'sack-weight-summary': {
      // The basis and the window are already in the report's own note and its pendingIfl; only the period's own count is added here.
      const implausible = num(rec(d.total).implausible) ?? 0;
      return [
        implausible > 0
          ? `${plural(implausible, 'sack')} with an implausible weight ${isAre(implausible)} left out of the average, lightest, heaviest and standard deviation.`
          : null,
      ];
    }

    case 'rejected-hangers': {
      const f = rec(d.flagging);
      const canFlag = f.canFlag === true;
      const rate = num(f.lineRatePct);
      const judged = num(f.hangersJudged);
      const minInspected = num(f.minInspected);
      return [
        canFlag && rate != null && judged != null && minInspected != null
          ? `A hanger “stands out in this period” only when its reject count is unlikely at the period’s own line rate of ${rate}% (an exact binomial test at 5% across the ${n0(judged)} hangers with at least ${n0(minInspected)} inspected cones). It describes this period’s counts, not the hanger.`
          : null,
        f.canFlag === false ? `No hanger is marked: ${str(f.reason) ?? 'too few cones per hanger in this period'}.` : null,
        clockFaultSentence(d.excludedClockFault, 'reject record'),
        cutSentence(d, 'rejects'),
      ];
    }

    case 'rejected-unknown-lifter': {
      const zeroCoded = num(d.zeroCodeTotal) ?? num(rec(d.total).zeroCodeRejects) ?? 0;
      const zeroed = rec(d.zeroedClock);
      const zeroedRows = arr(zeroed.rows).length;
      return [
        zeroCoded > 0
          ? `${plural(zeroCoded, 'rejected cone')} ${carries(zeroCoded)} a zero tube or material reason code; ${zeroCoded === 1 ? 'it is' : 'they are'} counted in the table and listed apart, not as unknown-lifter rejects.`
          : null,
        zeroedRows > 0
          ? `${plural(zeroedRows, 'record')} with a zeroed clock (1 January 1970) ${zeroedRows === 1 ? 'exists' : 'exist'} in this data batch${str(zeroed.generation) ? ` (${str(zeroed.generation)})` : ''}; no period reaches ${zeroedRows === 1 ? 'it' : 'them'}, so ${zeroedRows === 1 ? 'it is' : 'they are'} listed apart, whatever period was chosen.`
          : null,
        clockFaultSentence(d.excludedClockFault, 'reject record'),
      ];
    }

    default:
      return [];
  }
}

/**
 * The printable notes of one report, as plain sentences in a fixed order: the
 * method note, then the caveats computed from the figures, then every
 * "Assumed until IFL confirms" line. Repeated sentences are printed once.
 */
export function reportNotesOf(type: ReportType, data: unknown): string[] {
  if (!IFL_NOTE_TYPES.includes(type) || !isRec(data)) return [];
  const out: string[] = [];
  const add = (s: string | null | undefined): void => {
    const t = s?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(str(data.note));
  for (const c of caveatsOf(type, data)) add(c);
  for (const p of pendingLines(data)) add(p);
  return out;
}
