/** Limits & History: pure helpers. The server re-checks every one of these; they only decide what the form offers. */
import type { LimitHistoryVersion, ProductChangeEntry, ProductFields, ProductOption } from '../../../bridge/api';
import { fmt } from '../../../bridge/lib';

/** pdasWrite.ts: the ordinary reason minimum and the longer one a large change needs. */
export const REASON_MIN = 10;
export const LARGE_REASON_MIN = 20;
/** The guard thresholds the server enforces (developer defaults, PDAS_LIMIT_MAX_*). Mirrored only to decide what the form shows. */
export const GUARD_PCT = 3;
export const GUARD_OFFSET_G = 20;

export function fieldsOf(p: ProductOption | undefined | null): ProductFields | null {
  if (!p || p.setpointG == null || p.weightOffsetMinusG == null || p.weightOffsetPlusG == null) return null;
  return {
    setpointG: p.setpointG,
    offsetMinusG: Math.abs(p.weightOffsetMinusG),
    offsetPlusG: Math.abs(p.weightOffsetPlusG),
    desc1: p.description,
    desc2: p.color,
    active: p.activeFlag ?? false,
  };
}

const g = (n: number): string => fmt.fmtG(n);
const plain = (n: number): string => Math.round(n).toLocaleString('en-US');

/** "1,960 ± 50 g", or "1,960 g, minus 50, plus 40" when the two offsets differ. */
export function limitsLabel(setpoint: number, minus: number, plus: number): string {
  const lo = Math.abs(minus);
  const hi = Math.abs(plus);
  return lo === hi ? `${plain(setpoint)} ± ${plain(lo)} g` : `${plain(setpoint)} g, minus ${plain(lo)}, plus ${plain(hi)}`;
}
export const rangeOf = (setpoint: number, minus: number, plus: number): { lo: string; hi: string } => ({
  lo: g(setpoint - Math.abs(minus)),
  hi: g(setpoint + Math.abs(plus)),
});

export function versionLabel(v: LimitHistoryVersion): string {
  if (v.label) return v.label;
  if (v.setpointG != null && v.offsetMinusG != null && v.offsetPlusG != null) return limitsLabel(v.setpointG, v.offsetMinusG, v.offsetPlusG);
  return v.setpointG != null ? g(v.setpointG) : '—';
}

export interface Guard {
  changed: boolean;
  large: boolean;
  pct: number;
  maxOffsetG: number;
}
/** Mirrors PdasWriter.limitChangeBound: more than 3 % on the target, or more than 20 g on either offset. */
export function guardOf(before: ProductFields, after: { setpointG: number; offsetMinusG: number; offsetPlusG: number }): Guard {
  const pct = before.setpointG !== 0 ? (Math.abs(after.setpointG - before.setpointG) / before.setpointG) * 100 : 100;
  const maxOffsetG = Math.max(Math.abs(after.offsetMinusG - before.offsetMinusG), Math.abs(after.offsetPlusG - before.offsetPlusG));
  const changed = after.setpointG !== before.setpointG || after.offsetMinusG !== before.offsetMinusG || after.offsetPlusG !== before.offsetPlusG;
  return { changed, large: pct > GUARD_PCT || maxOffsetG > GUARD_OFFSET_G, pct, maxOffsetG };
}

export type OutcomeKind = 'done' | 'refused' | 'notSent';
/** 'ok' reached PDAS and worked; 'disabled' never reached PDAS; everything else reached PDAS (or its checks) and was refused. */
export function outcomeKind(c: Pick<ProductChangeEntry, 'outcome'>): OutcomeKind {
  return c.outcome === 'ok' ? 'done' : c.outcome === 'disabled' ? 'notSent' : 'refused';
}
