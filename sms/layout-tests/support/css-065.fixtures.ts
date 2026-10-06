/** CSS-065 fixture: the mock sack stock ledger with every flow scaled up to realistic plant magnitudes (6-digit kg). Synthetic only. */
import { sackStock } from './mocks';

export function bigSackStock(factor = 60) {
  const j = JSON.parse(JSON.stringify(sackStock())) as { data: { days: Array<Record<string, unknown>> } };
  const scale = (f: { sacks: number; kg: number }) => ({ sacks: f.sacks * factor, kg: f.kg * factor });
  for (const d of j.data.days) {
    for (const k of ['opening', 'openingEntries', 'receipts', 'weighed', 'issues', 'consumption', 'adjustments', 'closing']) {
      d[k] = scale(d[k] as { sacks: number; kg: number });
    }
  }
  return j;
}
