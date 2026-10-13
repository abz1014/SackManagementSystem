import { niceDomain } from '../bridge/chart';

/**
 * Y domain for counts and rates. The shared niceDomain pads the lower end below zero even when every value
 * is zero or more, so count charts drew a negative axis with the bars floating above an empty band. A
 * series with no negative value starts at exactly 0; a series that does go negative keeps its own range.
 */
export function zeroBasedDomain(values: number[], opts: { pad?: number } = {}): [number, number] {
  const [lo, hi] = niceDomain(values, { zero: true, pad: opts.pad });
  const finite = values.filter((v) => Number.isFinite(v));
  const hasNegative = finite.some((v) => v < 0);
  return hasNegative ? [lo, hi] : [0, hi];
}
