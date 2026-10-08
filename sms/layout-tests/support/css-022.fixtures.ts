import { sackSummary, weightStations } from './mocks';

/** The Sacks summary with every sack carrying a scale flag (noFlag 0), as the real September data does, so the
 *  in-range note is one sentence rather than the shared fixture's three-line "... 3 carry no value" variant. */
export function sackSummaryAllFlagged(): unknown {
  const s = sackSummary() as { data: { totals: Record<string, unknown> } };
  s.data.totals.noFlag = 0;
  return s;
}

/** The Weight stations payload with the target's product retired in PDAS, as on the real September data: the target note
 *  then carries " · (retired in PDAS)" and wraps to one more line at the Wall text size. Synthetic only. */
export function weightStationsRetiredTarget(): unknown {
  const j = JSON.parse(JSON.stringify(weightStations())) as { data: { productActive: boolean } };
  j.data.productActive = false;
  return j;
}
