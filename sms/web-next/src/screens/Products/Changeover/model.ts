/**
 * Changeover form state and the request it builds. Pure: no fetch, no React.
 * Business rules (plausible range, duplicate triple, wildcard collisions) are the SERVER's;
 * this file only decides whether there is enough on the form to ASK the server for a plan.
 */
import { C, FRAGMENTS, withFragments } from '../../../copy';
import type { ChangeoverRequestBody, ChangeoverRefChoice, ChangeoverTubeChoice } from '../../../bridge/api';
const CO = withFragments(C.changeover, FRAGMENTS.changeover);

/** The server's minimum reason length (pdasWrite.ts MIN_REASON_CHARS, changeover.ts). */
export const REASON_MIN = 10;

export interface RefForm { mode: 'existing' | 'new'; id: string; name: string }
export interface TubeForm extends RefForm { weight: string; form: '1' | '2' }
export interface ChangeoverForm {
  blend: RefForm;
  count: RefForm;
  tube: TubeForm;
  setpoint: string;
  below: string;
  above: string;
  productName: string;
  colour: string;
  sackColour: string;
  retireProducts: number[];
  retirePallets: number[];
  reason: string;
}

export const emptyRef = (): RefForm => ({ mode: 'existing', id: '', name: '' });
export const emptyForm = (): ChangeoverForm => ({
  blend: emptyRef(),
  count: emptyRef(),
  tube: { ...emptyRef(), weight: '', form: '2' },
  setpoint: '',
  below: '',
  above: '',
  productName: '',
  colour: '',
  sackColour: '',
  retireProducts: [],
  retirePallets: [],
  reason: '',
});

const num = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function refChoice(r: RefForm): ChangeoverRefChoice | null {
  if (r.mode === 'existing') {
    const id = /^\d+$/.test(r.id) ? Number(r.id) : null;
    return id !== null && id > 0 ? { id } : null;
  }
  const name = r.name.trim();
  return name === '' ? null : { name };
}

export function tubeChoice(t: TubeForm): ChangeoverTubeChoice | null {
  if (t.mode === 'existing') return refChoice(t) as ChangeoverTubeChoice | null;
  const name = t.name.trim();
  const w = num(t.weight);
  if (name === '' || w === null || w <= 0) return null;
  return { name, tubeWeightG: w, tubeForm: t.form === '1' ? 1 : 2 };
}

/** Why the plan cannot be asked for yet; null when the form is complete. First missing thing only. */
export function missingFor(f: ChangeoverForm): string | null {
  if (!refChoice(f.blend)) return CO.needsBlend;
  if (!refChoice(f.count)) return CO.needsCount;
  if (!tubeChoice(f.tube)) return CO.needsTube;
  const sp = num(f.setpoint), lo = num(f.below), hi = num(f.above);
  if (sp === null || sp <= 0 || lo === null || lo < 0 || hi === null || hi < 0) return CO.needsLimits;
  if (f.productName.trim() === '') return CO.needsName;
  if (f.reason.trim().length < REASON_MIN) return CO.needsReason(REASON_MIN);
  return null;
}

/** The request body, or null while the form is incomplete. `packSchemaId` is the SOP's default (always 1 unless the mirror says otherwise). */
export function buildBody(f: ChangeoverForm, packSchemaId: number): ChangeoverRequestBody | null {
  if (missingFor(f) !== null) return null;
  const blend = refChoice(f.blend)!;
  const count = refChoice(f.count)!;
  const tubeType = tubeChoice(f.tube)!;
  return {
    blend,
    count,
    tubeType,
    material: {
      setpointG: Number(f.setpoint),
      offsetMinusG: Number(f.below),
      offsetPlusG: Number(f.above),
      lot: f.productName.trim(),
      ppColour: f.colour.trim() || null,
    },
    pallet: { packSchemaId, lot: null, sackColour: f.sackColour.trim() || null },
    retire: { productIds: [...f.retireProducts], palletIds: [...f.retirePallets] },
    reason: f.reason.trim(),
  };
}

/**
 * The product a duplicate-triple blocker points at, read from the server's own sentence
 * ("... or change the limits on product 21 instead."). Null for every other blocker.
 * The sentence itself is still printed verbatim; this only finds the link target.
 */
export function limitsTargetOf(blocker: string): number | null {
  const m = /change the limits on product (\d+) instead/i.exec(blocker);
  return m ? Number(m[1]) : null;
}

/** Plan step detail: flat record of primitives, printed generically so a new server field shows up unchanged. */
export function detailLine(detail: Record<string, string | number | boolean | null>): string {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${k}: ${v === true ? 'yes' : String(v)}`)
    .join(', ');
}

/** The step-words table of copy.ts (FRAGMENTS.changeover.stepWords), by shape, so this file needs no copy import. */
export interface StepWordTable {
  step: Record<string, string | ((label: string, id: number) => string) | null>;
  detail: Record<string, string>;
}

export interface StepReading {
  /** The word for the kind of step ("Blend", "Product name"), or null when none exists (pallet, retire). */
  kind: string | null;
  /** Detail values the screen has an existing label for, in the server's order. Values only: nothing invented. */
  pairs: { label: string; value: string }[];
  /** The vendor procedure and every detail key with no label. Shown only inside the technical-detail disclosure. */
  technical: string[];
}

const shown = (v: string | number | boolean | null): string | null =>
  v === null || v === '' || v === false ? null : v === true ? 'yes' : String(v);

/** Structured form of detailLine: labelled values for the Review step, raw keys kept for the disclosure. */
export function readStep(
  s: { step: string; proc: string | null; detail: Record<string, string | number | boolean | null> },
  words: StepWordTable,
): StepReading {
  const k = words.step[s.step];
  const pairs: StepReading['pairs'] = [];
  const rest: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(s.detail)) {
    const label = words.detail[key];
    const value = shown(raw);
    if (value === null) continue;
    if (label) pairs.push({ label, value });
    else rest[key] = raw;
  }
  const technical: string[] = [];
  if (s.proc) technical.push(s.proc);
  const tail = detailLine(rest);
  if (tail) technical.push(tail);
  return { kind: typeof k === 'string' ? k : null, pairs, technical };
}
