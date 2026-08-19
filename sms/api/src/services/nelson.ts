/**
 * Nelson rules (Phase 5 — calibration advisory) — the eight classic tests for
 * a non-random pattern in a control chart, beyond "one point outside 3σ."
 * A single point past 3σ (rule 1) is the only thing the existing X-bar chart
 * ever flagged; rules 2-8 catch a process that is drifting or has shifted
 * WITHOUT any single point ever crossing that band — which is exactly the
 * shape a slowly-going-out-of-calibration scale produces.
 *
 * Zones are defined relative to each point's OWN standard error, not a fixed
 * width — this chart's subgroups vary in size (n), so σ/√n varies subgroup to
 * subgroup, same as the existing xUcl/xLcl. Zone C = centerline ± 1se,
 * Zone B = ±1se to ±2se, Zone A = ±2se to ±3se, beyond = past ±3se.
 *
 * Deliberately generic: this same engine drives both the line-wide X-bar
 * chart (spc.ts, ~20-170 subgroups depending on range) and the per-station
 * daily-drift view (calibration.ts, ~19-20 points — the whole supplied
 * history). At that history length, rules needing 14 or 15 points in a row
 * (4, 7) can never fire and rule 2's 9-in-a-row is close to the entire
 * series — that is a fact about the data, not a bug in the engine, and the
 * UI says so rather than hiding which rules are realistically live.
 */

export type NelsonRuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const NELSON_RULE_LABEL: Record<NelsonRuleId, string> = {
  1: 'Point beyond 3σ',
  2: '9 in a row on one side',
  3: '6 in a row trending',
  4: '14 in a row alternating',
  5: '2 of 3 beyond 2σ, one side',
  6: '4 of 5 beyond 1σ, one side',
  7: '15 in a row within 1σ',
  8: '8 in a row beyond 1σ, both sides',
};

export interface NelsonPoint {
  value: number;
  /** Standard error for this point's own zone widths (0 if undefined — the point is then treated as sitting exactly on the centerline, never triggering a distance-based rule, since there is no valid scale to measure a distance against). */
  se: number;
}

function side(p: NelsonPoint, centerline: number): 1 | -1 | 0 {
  if (p.value > centerline) return 1;
  if (p.value < centerline) return -1;
  return 0;
}

/** Distance from centerline in units of the point's own sigma (0 if se is not usable). */
function sigmaDistance(p: NelsonPoint, centerline: number): number {
  return p.se > 0 ? Math.abs(p.value - centerline) / p.se : 0;
}

/**
 * Violations at every index, evaluated using only points up to and including
 * that index — so a rule "fires" at the point that completes its pattern,
 * matching how a monitoring system raises a new flag as data arrives rather
 * than retroactively marking an entire historical run.
 */
export function nelsonViolations(points: NelsonPoint[], centerline: number): NelsonRuleId[][] {
  const n = points.length;
  const out: NelsonRuleId[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    // Rule 1 — one point beyond 3σ.
    if (sigmaDistance(points[i]!, centerline) > 3) out[i]!.push(1);

    // Rule 2 — 9 in a row on the same side of the centerline.
    if (i >= 8) {
      const s = side(points[i]!, centerline);
      if (s !== 0 && window(i, 9).every((j) => side(points[j]!, centerline) === s)) out[i]!.push(2);
    }

    // Rule 3 — 6 in a row steadily increasing or steadily decreasing.
    // A repeated (equal) value breaks the run — it is neither an increase nor a decrease.
    if (i >= 5) {
      const idxs = window(i, 6);
      const up = idxs.every((j, k) => k === 0 || points[j]!.value > points[idxs[k - 1]!]!.value);
      const down = idxs.every((j, k) => k === 0 || points[j]!.value < points[idxs[k - 1]!]!.value);
      if (up || down) out[i]!.push(3);
    }

    // Rule 4 — 14 in a row alternating direction (zigzag). An equal value
    // (zero difference) breaks the alternation, same reasoning as rule 3.
    if (i >= 13) {
      const idxs = window(i, 14);
      let alternating = true;
      let lastSign: 1 | -1 | null = null;
      for (let k = 1; k < idxs.length && alternating; k++) {
        const diff = points[idxs[k]!]!.value - points[idxs[k - 1]!]!.value;
        if (diff === 0) { alternating = false; break; }
        const sign: 1 | -1 = diff > 0 ? 1 : -1;
        if (lastSign !== null && sign === lastSign) alternating = false;
        lastSign = sign;
      }
      if (alternating) out[i]!.push(4);
    }

    // Rule 5 — 2 of the last 3 points beyond 2σ, on the same side.
    if (i >= 2) {
      const idxs = window(i, 3);
      if ((([1, -1] as const).some((s) => idxs.filter((j) => side(points[j]!, centerline) === s && sigmaDistance(points[j]!, centerline) >= 2).length >= 2))) {
        out[i]!.push(5);
      }
    }

    // Rule 6 — 4 of the last 5 points beyond 1σ, on the same side.
    if (i >= 4) {
      const idxs = window(i, 5);
      if ((([1, -1] as const).some((s) => idxs.filter((j) => side(points[j]!, centerline) === s && sigmaDistance(points[j]!, centerline) >= 1).length >= 4))) {
        out[i]!.push(6);
      }
    }

    // Rule 7 — 15 in a row within 1σ of the centerline (stratification —
    // suspiciously LOW variation, often a sign subgroups aren't independent).
    if (i >= 14) {
      const idxs = window(i, 15);
      if (idxs.every((j) => sigmaDistance(points[j]!, centerline) < 1)) out[i]!.push(7);
    }

    // Rule 8 — 8 in a row beyond 1σ with both sides represented (mixture —
    // nothing near the centerline, bouncing between two off-target states).
    if (i >= 7) {
      const idxs = window(i, 8);
      const allBeyond = idxs.every((j) => sigmaDistance(points[j]!, centerline) >= 1);
      const hasPos = idxs.some((j) => side(points[j]!, centerline) === 1);
      const hasNeg = idxs.some((j) => side(points[j]!, centerline) === -1);
      if (allBeyond && hasPos && hasNeg) out[i]!.push(8);
    }
  }

  return out;
}

function window(endInclusive: number, length: number): number[] {
  return Array.from({ length }, (_, k) => endInclusive - length + 1 + k);
}
