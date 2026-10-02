/**
 * IFL reports, D6 (1 Oct 2026): `reportNotesOf(type, data)` — the report's own
 * printable notes, composed once from the report DATA so the CSV, the workbook
 * and the printed page carry the same caveats.
 *
 * What is pinned: the order (method note, then caveats from the period's own
 * figures, then every "Assumed until IFL confirms" line), that nothing is
 * stated twice, that only IFL's eight reports carry notes (the earlier ten
 * already print theirs beside their figures), that the function is pure and
 * tolerates a payload with a field missing, and that the two sentences it
 * shares with the screen are word-for-word the screen's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPORT_TYPES, type ReportType } from './common.js';
import { IFL_NOTE_TYPES, LIMITS_LOWER_BOUND_NOTE, PENDING_IFL_HEADING, reportNotesOf } from './notes.js';
import { SHIFT_PRODUCTION_NOTE, SHIFT_PRODUCTION_PENDING_IFL, shiftProductionCaveats } from './shiftProduction.js';
import { REJECTED_CONES_NOTE, REJECTED_CONES_PENDING_IFL } from './rejectedCones.js';
import { REJECTED_SACKS_NOTE, REJECTED_SACKS_PENDING_IFL } from './rejectedSacks.js';
import { SPS_PACKING_NOTE, SPS_PACKING_PENDING_IFL } from './spsPacking.js';
import { SACK_WEIGHT_RANGE_NOTE, SACK_WEIGHT_RANGE_PENDING_IFL } from './sackWeightRange.js';
import { SACK_WEIGHT_SUMMARY_NOTE, sackWeightSummaryPendingIfl } from './sackWeightSummary.js';
import { REJECTED_HANGERS_NOTE, REJECTED_HANGERS_PENDING_IFL } from './rejectedHangers.js';
import { REJECTED_UNKNOWN_LIFTER_NOTE, REJECTED_UNKNOWN_LIFTER_PENDING_IFL } from './rejectedUnknownLifter.js';

const pend = (lines: readonly string[]): string[] => lines.map((l) => `${PENDING_IFL_HEADING}: ${l}`);

/** Only the sentences notes.ts computed from the figures: the notes without the report's own note and its assumptions. */
const caveatsOnly = (type: ReportType, d: any): string[] => {
  const all = reportNotesOf(type, d);
  return all.slice(d.note ? 1 : 0, all.length - (d.pendingIfl?.length ?? 0));
};

/** Recursively freeze, so a function that mutates its input throws instead of passing silently. */
function deepFreeze<T>(v: T): T {
  if (v != null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

const grandTotal = { weighed: 7923, pass: 7922, weightRejects: 1, total: 7923, efficiencyPct: 99.99, weighedKg: 15000 };
const SHIFT_PRODUCTION: any = {
  note: SHIFT_PRODUCTION_NOTE, pendingIfl: [...SHIFT_PRODUCTION_PENDING_IFL],
  grandTotal, loop: { hangersSeen: 299 }, scaleRejectedCones: 49,
  kgBasis: { basis: 'net', label: 'net of the 70 g cone tube set in Setup', implausible: 3 },
};
const REJECTED_CONES: any = {
  note: REJECTED_CONES_NOTE, pendingIfl: [...REJECTED_CONES_PENDING_IFL], filters: {},
  list: [{ limits: { label: '1,960 +/- 40 g', targetG: 1960, loG: 1920, hiG: 2000, lowerBound: false } }],
  weightRange: { plausibility: { loG: 1500, hiG: 2100 }, excludedImplausible: 4 }, excludedClockFault: 0, listTotal: 1, listCap: 5000,
};
const REJECTED_SACKS: any = {
  note: REJECTED_SACKS_NOTE, pendingIfl: [...REJECTED_SACKS_PENDING_IFL], weightBasis: 'gross', plausibility: { loKg: 40, hiKg: 60 },
  total: { sacks: 5435, rejected: 594, rejectedPct: 10.93, noFlag: 0 }, excludedClockFault: 0, listTotal: 594, listCap: 5000,
};
const SPS_PACKING: any = { note: SPS_PACKING_NOTE, pendingIfl: [...SPS_PACKING_PENDING_IFL], weightBasis: 'as_recorded', implausibleSacks: 0 };
const SACK_WEIGHT_RANGE: any = {
  note: SACK_WEIGHT_RANGE_NOTE, pendingIfl: [...SACK_WEIGHT_RANGE_PENDING_IFL], weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 },
  bandKg: 0.1, passedRange: { minKg: 47, maxKg: 47.6 }, implausibleSacks: 4,
};
const SACK_WEIGHT_SUMMARY: any = {
  note: SACK_WEIGHT_SUMMARY_NOTE, pendingIfl: sackWeightSummaryPendingIfl('gross', 0, 40, 60), total: { implausible: 4 },
};
const REJECTED_HANGERS: any = {
  note: REJECTED_HANGERS_NOTE, pendingIfl: [...REJECTED_HANGERS_PENDING_IFL], excludedClockFault: 0, listTotal: 6089, listCap: 5000,
  flagging: { canFlag: true, reason: null, lineRatePct: 3.4, hangersJudged: 299, hangersSeen: 299, minInspected: 100, alpha: 0.05 },
};
const REJECTED_UNKNOWN_LIFTER: any = {
  note: REJECTED_UNKNOWN_LIFTER_NOTE, pendingIfl: [...REJECTED_UNKNOWN_LIFTER_PENDING_IFL], excludedClockFault: 0, zeroCodeTotal: 0,
  total: { zeroCodeRejects: 0 }, zeroedClock: { generation: null, rows: [] },
};

const FIXTURES: Record<string, any> = {
  'shift-production': SHIFT_PRODUCTION,
  'rejected-cones': REJECTED_CONES,
  'rejected-sacks': REJECTED_SACKS,
  'sps-packing': SPS_PACKING,
  'sack-weight-range': SACK_WEIGHT_RANGE,
  'sack-weight-summary': SACK_WEIGHT_SUMMARY,
  'rejected-hangers': REJECTED_HANGERS,
  'rejected-unknown-lifter': REJECTED_UNKNOWN_LIFTER,
};

describe('which reports carry notes', () => {
  it('exactly IFL\'s eight, and every other type returns nothing (their notes print beside their figures)', () => {
    expect([...IFL_NOTE_TYPES].sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const t of REPORT_TYPES) {
      if ((IFL_NOTE_TYPES as readonly string[]).includes(t)) continue;
      expect(reportNotesOf(t, { note: 'x', pendingIfl: ['y'] }), t).toEqual([]);
    }
  });

  it('nothing to say about no data, a non-object or an empty object', () => {
    for (const t of IFL_NOTE_TYPES) {
      for (const bad of [null, undefined, 'x', 7, [], {}]) expect(reportNotesOf(t, bad), `${t} ${String(bad)}`).toEqual([]);
    }
  });
});

describe.each(Object.keys(FIXTURES) as ReportType[])('%s: the note, then the caveats, then every assumption', (type) => {
  const d = FIXTURES[type];

  it('opens with the report\'s own note and ends with every pendingIfl line under the shared heading, in order', () => {
    const notes = reportNotesOf(type, d);
    expect(notes[0]).toBe(d.note);
    const pending = pend(d.pendingIfl);
    expect(pending.length).toBeGreaterThan(0);
    expect(notes.slice(notes.length - pending.length)).toEqual(pending);
  });

  it('states nothing twice, and every line is a real sentence', () => {
    const notes = reportNotesOf(type, d);
    expect(new Set(notes).size).toBe(notes.length);
    for (const n of notes) {
      expect(n).toMatch(/\S/);
      expect(n).toBe(n.trim());
      expect(n).not.toMatch(/undefined|NaN|null/);
    }
  });

  it('is pure: a frozen input is read, never changed, and the result is a new array', () => {
    const frozen = deepFreeze(structuredClone(d));
    const a = reportNotesOf(type, frozen);
    const b = reportNotesOf(type, frozen);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(frozen).toEqual(d);
  });

  it('survives a payload with the figure fields stripped and still states its note and assumptions', () => {
    const notes = reportNotesOf(type, { note: d.note, pendingIfl: d.pendingIfl });
    expect(notes[0]).toBe(d.note);
    expect(notes.slice(-d.pendingIfl.length)).toEqual(pend(d.pendingIfl));
  });
});

describe('report 1, shift-wise CTS loop production', () => {
  it('puts the three computed sentences (loop, scale bit beside the weight-reject records, kg basis) between the note and the assumptions', () => {
    const notes = reportNotesOf('shift-production', SHIFT_PRODUCTION);
    const caveats = shiftProductionCaveats(SHIFT_PRODUCTION);
    expect(caveats).toHaveLength(3);
    expect(notes.slice(1, 1 + caveats.length)).toEqual(caveats);
    expect(notes[1]).toBe('CTS loop: the line’s one hanger loop — 299 hanger numbers seen in this period.');
    expect(notes[2]).toContain('The scale’s own in-range bit marked 49 cones; the weight-reject records hold 1; they are separate records and are not merged.');
    expect(notes[3]).toContain('net of the 70 g cone tube set in Setup. 3 readings outside the plausibility window are not in it.');
  });

  it('a payload that predates any of the three figures states the note and assumptions, not a half sentence and never a throw', () => {
    const { loop: _l, ...noLoop } = SHIFT_PRODUCTION;
    const { scaleRejectedCones: _s, ...noScale } = SHIFT_PRODUCTION;
    const { grandTotal: _g, ...noTotal } = SHIFT_PRODUCTION;
    for (const partial of [noLoop, noScale, noTotal, { note: 'N', pendingIfl: ['P'], grandTotal }]) {
      expect(() => reportNotesOf('shift-production', partial)).not.toThrow();
      const notes = reportNotesOf('shift-production', { ...partial, note: 'N', pendingIfl: ['P'] });
      expect(notes).toEqual(['N', `${PENDING_IFL_HEADING}: P`]);
    }
  });

  it('without a kg basis the loop and scale-bit sentences still print, and the kg sentence does not', () => {
    const notes = reportNotesOf('shift-production', { ...SHIFT_PRODUCTION, kgBasis: null });
    expect(notes.some((n) => n.startsWith('CTS loop:'))).toBe(true);
    expect(notes.some((n) => n.includes('in-range bit'))).toBe(true);
    expect(notes.some((n) => n.startsWith('Weighed kg is the sum'))).toBe(false);
  });
});

describe('report 6, rejected cones against weight', () => {
  it('states the plausibility window with the number of readings it left out', () => {
    const notes = reportNotesOf('rejected-cones', REJECTED_CONES);
    expect(notes).toContain('Plausibility window: cone weights outside 1,500–2,100 g are treated as faults and left out of the averages and ranges. 4 readings in this period are left out.');
  });

  it('says nothing was left out when nothing was, and singular for one', () => {
    const none = reportNotesOf('rejected-cones', { ...REJECTED_CONES, weightRange: { plausibility: { loG: 1500, hiG: 2100 }, excludedImplausible: 0 } });
    expect(none.join('\n')).toContain('No reading in this period was left out.');
    const one = reportNotesOf('rejected-cones', { ...REJECTED_CONES, weightRange: { plausibility: { loG: 1500, hiG: 2100 }, excludedImplausible: 1 } });
    expect(one.join('\n')).toContain('1 reading in this period is left out.');
  });

  it('counts the zeroed-clock records left out of the list, singular and plural', () => {
    expect(reportNotesOf('rejected-cones', { ...REJECTED_CONES, excludedClockFault: 1 }).join('\n'))
      .toContain('1 rejected cone record stamped 1 January 1970 (a zeroed clock) can be placed in no period and is left out of the list.');
    expect(reportNotesOf('rejected-cones', { ...REJECTED_CONES, excludedClockFault: 3 }).join('\n'))
      .toContain('3 rejected cone records stamped 1 January 1970 (a zeroed clock) can be placed in no period and are left out of the list.');
    expect(reportNotesOf('rejected-cones', REJECTED_CONES).join('\n')).not.toContain('1 January 1970');
  });

  it('a station filter says the range is that winder\'s own and no whole-line range is given', () => {
    const notes = reportNotesOf('rejected-cones', { ...REJECTED_CONES, filters: { station: 13 } });
    expect(notes).toContain('Narrowed to winder 13: the weight range is that winder’s own and no whole-line range is given.');
    expect(reportNotesOf('rejected-cones', REJECTED_CONES).join('\n')).not.toContain('Narrowed to winder');
  });

  it('limits qualified "no later than" carry the explanation, once, only when a row has them', () => {
    const lb = { limits: { label: 'x', targetG: 1, loG: 0, hiG: 2, lowerBound: true } };
    const withLb = reportNotesOf('rejected-cones', { ...REJECTED_CONES, list: [lb, lb] });
    expect(withLb.filter((n) => n === LIMITS_LOWER_BOUND_NOTE)).toHaveLength(1);
    expect(reportNotesOf('rejected-cones', REJECTED_CONES)).not.toContain(LIMITS_LOWER_BOUND_NOTE);
  });

  it('a row with no limits says why its "outside limits by" is blank', () => {
    const notes = reportNotesOf('rejected-cones', { ...REJECTED_CONES, list: [{ limits: null }] });
    expect(notes.join('\n')).toContain('A row with no limits stated has no product, or no limits on record');
    expect(reportNotesOf('rejected-cones', REJECTED_CONES).join('\n')).not.toContain('no limits stated');
  });
});

describe('the sack reports', () => {
  it('rejected sacks: the weight basis in words, the window, never a tolerance', () => {
    const notes = reportNotesOf('rejected-sacks', REJECTED_SACKS);
    expect(notes).toContain('Sack weights are gross, as the scale recorded them.');
    expect(notes).toContain('Plausibility window: sack weights outside 40–60 kg are treated as faults and left out of the range of sacks the scale passed.');
    // the sentences computed here never call a sack under- or overweight (the report's own note says why none is)
    expect(caveatsOnly('rejected-sacks', REJECTED_SACKS).join('\n')).not.toMatch(/underweight|overweight|within tolerance/i);
  });

  it('rejected sacks: a sack with no scale verdict is counted apart, and a cut list says so once', () => {
    const noFlag = reportNotesOf('rejected-sacks', { ...REJECTED_SACKS, total: { ...REJECTED_SACKS.total, noFlag: 2 }, listTotal: 6000 }).join('\n');
    expect(noFlag).toContain('2 sacks carry no scale verdict; they are counted apart and never as passes.');
    expect(noFlag).toContain('Only the first 5,000 of 6,000 rejected sacks are listed in this report; the tables above count all of them.');
    const one = reportNotesOf('rejected-sacks', { ...REJECTED_SACKS, total: { ...REJECTED_SACKS.total, noFlag: 1 } }).join('\n');
    expect(one).toContain('1 sack carries no scale verdict; it is counted apart and never as passes.');
    // the report's own note already said the list was cut: not repeated
    const already = reportNotesOf('rejected-sacks', { ...REJECTED_SACKS, listTotal: 6000, note: 'Only the first 5,000 of 6,000 rejected sacks are listed.' }).join('\n');
    expect(already.match(/Only the first/g)).toHaveLength(1);
  });

  it('every basis code reads in words; an unknown one is left out, never printed raw', () => {
    expect(reportNotesOf('sps-packing', { ...SPS_PACKING, weightBasis: 'as_recorded' })).toContain('Sack weights are as the scale recorded them; nothing is subtracted.');
    expect(reportNotesOf('sps-packing', { ...SPS_PACKING, weightBasis: 'net' })).toContain('Sack weights are net of the sack tare set in Setup.');
    const odd = reportNotesOf('sps-packing', { ...SPS_PACKING, weightBasis: 'mystery' }).join('\n');
    expect(odd).not.toContain('mystery');
    expect(reportNotesOf('sps-packing', { ...SPS_PACKING, weightBasis: 'gross' }).join('\n')).not.toContain('as_recorded');
  });

  it('sps packing: implausible sacks are counted in sacks and kilograms and left out of every average', () => {
    expect(reportNotesOf('sps-packing', { ...SPS_PACKING, implausibleSacks: 1 }))
      .toContain('1 sack with an implausible weight is counted in sacks and kilograms and left out of every average.');
    expect(reportNotesOf('sps-packing', { ...SPS_PACKING, implausibleSacks: 4 }).join('\n')).toContain('4 sacks with an implausible weight are counted');
    expect(reportNotesOf('sps-packing', SPS_PACKING).join('\n')).not.toContain('implausible weight are');
  });

  it('sack weight range: the band width, the recorded pass range (a fact, not a tolerance) and the window', () => {
    const notes = reportNotesOf('sack-weight-range', SACK_WEIGHT_RANGE);
    expect(notes).toContain('Bands are 0.1 kg wide; passed and rejected are the scale’s own verdict.');
    expect(notes).toContain('The scale passed sacks from 47 to 47.6 kg in this period; that is a recorded fact, not a tolerance.');
    expect(notes).toContain('Plausibility window: sack weights outside 40–60 kg are treated as faults and left out of the averages and ranges. 4 sacks in this period are left out.');
    // no sack passed: no pass-range sentence
    expect(reportNotesOf('sack-weight-range', { ...SACK_WEIGHT_RANGE, passedRange: null }).join('\n')).not.toContain('The scale passed sacks from');
  });

  it('sack weight summary: the period\'s own implausible count, not a second copy of the window the assumptions already state', () => {
    const notes = reportNotesOf('sack-weight-summary', SACK_WEIGHT_SUMMARY);
    expect(notes).toContain('4 sacks with an implausible weight are left out of the average, lightest, heaviest and standard deviation.');
    expect(notes.filter((n) => /plausible window|Plausibility window/i.test(n))).toHaveLength(1); // the assumptions' own sentence
    expect(caveatsOnly('sack-weight-summary', { ...SACK_WEIGHT_SUMMARY, total: { implausible: 0 } })).toEqual([]);
  });
});

describe('report 7, rejected cone hangers', () => {
  it('states how a hanger is judged, with the period\'s own rate and count, and never a verdict on the hanger', () => {
    const notes = reportNotesOf('rejected-hangers', REJECTED_HANGERS);
    const flag = notes.find((n) => n.startsWith('A hanger “stands out in this period”'))!;
    expect(flag).toContain('line rate of 3.4%');
    expect(flag).toContain('across the 299 hangers with at least 100 inspected cones');
    expect(flag).toContain('describes this period’s counts, not the hanger');
    expect(notes.join('\n')).not.toMatch(/\b(bad|faulty|defective)\b/i);
  });

  it('when no hanger can be judged the notes say so with the report\'s own reason, and describe no test', () => {
    const notes = reportNotesOf('rejected-hangers', {
      ...REJECTED_HANGERS,
      flagging: { canFlag: false, reason: 'too few cones per hanger in this period — choose a longer period', lineRatePct: 1, hangersJudged: 3, hangersSeen: 100, minInspected: 100, alpha: 0.05 },
    });
    expect(notes).toContain('No hanger is marked: too few cones per hanger in this period — choose a longer period.');
    expect(notes.join('\n')).not.toContain('stands out in this period”');
  });

  it('a list cut at its cap says how many were left out', () => {
    expect(reportNotesOf('rejected-hangers', REJECTED_HANGERS)).toContain('Only the first 5,000 of 6,089 rejects are listed in this report; the tables above count all of them.');
    expect(reportNotesOf('rejected-hangers', { ...REJECTED_HANGERS, listTotal: 12 }).join('\n')).not.toContain('Only the first');
  });
});

describe('report 8, rejected unknown (lifter)', () => {
  it('a zero reason code is counted and listed apart, never called an unknown lifter', () => {
    const notes = reportNotesOf('rejected-unknown-lifter', { ...REJECTED_UNKNOWN_LIFTER, zeroCodeTotal: 5, total: { zeroCodeRejects: 5 } });
    expect(notes).toContain('5 rejected cones carry a zero tube or material reason code; they are counted in the table and listed apart, not as unknown-lifter rejects.');
    expect(reportNotesOf('rejected-unknown-lifter', { ...REJECTED_UNKNOWN_LIFTER, zeroCodeTotal: 1 }).join('\n')).toContain('1 rejected cone carries a zero tube or material reason code; it is counted in the table');
    expect(reportNotesOf('rejected-unknown-lifter', REJECTED_UNKNOWN_LIFTER).join('\n')).not.toContain('zero tube or material');
  });

  it('falls back to the table\'s own zero-code count when the list total is absent', () => {
    const { zeroCodeTotal: _drop, ...older } = REJECTED_UNKNOWN_LIFTER;
    expect(reportNotesOf('rejected-unknown-lifter', { ...older, total: { zeroCodeRejects: 2 } }).join('\n')).toContain('2 rejected cones carry a zero tube or material reason code');
  });

  it('the zeroed-clock records are stated with their data batch, whatever period was chosen', () => {
    const rows = [{}, {}];
    const notes = reportNotesOf('rejected-unknown-lifter', { ...REJECTED_UNKNOWN_LIFTER, zeroedClock: { generation: 'DATA_TP1U2 batch 1', rows } });
    expect(notes).toContain('2 records with a zeroed clock (1 January 1970) exist in this data batch (DATA_TP1U2 batch 1); no period reaches them, so they are listed apart, whatever period was chosen.');
    const one = reportNotesOf('rejected-unknown-lifter', { ...REJECTED_UNKNOWN_LIFTER, zeroedClock: { generation: null, rows: [{}] } }).join('\n');
    expect(one).toContain('1 record with a zeroed clock (1 January 1970) exists in this data batch; no period reaches it, so it is listed apart');
  });

  it('rejects dropped as clock faults from the period are counted', () => {
    expect(reportNotesOf('rejected-unknown-lifter', { ...REJECTED_UNKNOWN_LIFTER, excludedClockFault: 2 }).join('\n'))
      .toContain('2 reject records stamped 1 January 1970 (a zeroed clock) can be placed in no period and are left out of the list.');
  });
});

describe('the wording shared with the screen is the screen\'s own', () => {
  const words = readFileSync(fileURLToPath(new URL('../../../../web/src/lib/words.ts', import.meta.url)), 'utf8');
  const grab = (key: string): string => {
    const m = new RegExp(`${key}:\\s*'([^']*)'`).exec(words);
    expect(m, `${key} in words.ts`).not.toBeNull();
    return m![1]!;
  };

  it('the "Assumed until IFL confirms" heading', () => {
    expect(PENDING_IFL_HEADING).toBe(grab('pendingHeading'));
  });

  it('the "no later than" limits explanation', () => {
    expect(LIMITS_LOWER_BOUND_NOTE).toBe(grab('lowerBoundNote'));
  });
});
