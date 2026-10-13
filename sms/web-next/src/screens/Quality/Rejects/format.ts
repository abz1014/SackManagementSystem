/** Number and reason-name formatting for Quality > Rejects (wording lives in copy.ts C.qualityRejects). */
import { fmt } from '../../../bridge/lib';


/** The number of a rate: two decimals under 1 % so a non-zero rate never reads 0.0 (C-110, D-89); one decimal otherwise. */
export function rateNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return n > 0 && n < 1 ? n.toFixed(2) : n.toFixed(1);
}
export const fmtRate = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '–' : `${rateNum(n)} %`);
export const fmtCount = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '–' : fmt.fmtInt(n));

/** Reason name by the glossary: the engineer's label, else "Code 2/1 (not named yet)". */
export function reasonName(r: { label: string | null; tubeCode: number | null; materialCode: number | null }): string {
  if (r.label) return r.label;
  if (r.tubeCode == null && r.materialCode == null) return 'No reason code';
  return `Code ${r.tubeCode ?? '–'}/${r.materialCode ?? '–'} (not named yet)`;
}
/** The short form for a chart axis. */
export function reasonShort(r: { label: string | null; tubeCode: number | null; materialCode: number | null }): string {
  if (r.label) return r.label;
  if (r.tubeCode == null && r.materialCode == null) return 'No code';
  return `Code ${r.tubeCode ?? '–'}/${r.materialCode ?? '–'}`;
}
