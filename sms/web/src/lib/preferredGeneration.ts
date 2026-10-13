import type { RejectGeneration, RejectSpcData } from '../api';

/**
 * The ONE generation entry that `d.totalProduced`/`d.totalRejects` already describe (28 Sep 2026 fix).
 * `rejectSpc.ts` derives those two top-level fields from a SINGLE preferred generation (real over
 * simulator, then newest ordinal), while `d.generations[]` lists EVERY generation the query touched.
 * Exactly one entry has totals equal to the top-level pair, so matching on both finds it without
 * re-implementing the server's preference rule. With one generation (the only case at IFL) it is that one.
 */
export function preferredGeneration(d: RejectSpcData | null): RejectGeneration | null {
  if (!d) return null;
  if (d.generations.length <= 1) return d.generations[0] ?? null;
  return d.generations.find((g) => g.totalProduced === d.totalProduced && g.totalRejects === d.totalRejects) ?? null;
}
