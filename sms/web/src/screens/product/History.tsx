/**
 * Product › History — STUB (UX Phase 6 Brief 1, 16 Sep 2026).
 *
 * "What changed, when, by whom — and what did the plant database say about
 * it?" (IA-PROPOSAL.md §3.2): SMS's own product timeline
 * (`GET /api/product-timeline`) plus PDAS's own `product_change` audit
 * trail — one row per write ATTEMPT, including rows recorded while
 * `PDAS_WRITE_ENABLED` was off, which never reached PDAS at all. That merge
 * is a real screen, not a table move, and building it is Brief 3's job —
 * this file is one honest line so the tab is addressable
 * (`?s=product&pt=history`) in the meantime.
 *
 * the old product sheet component's own `History()` component (a plain read of
 * `getProductTimeline()`) is DELETED along with the rest of that file, not
 * moved here — Brief 3 supersedes it with the richer merge above rather
 * than this brief building a smaller version twice.
 *
 * The strings Brief 3 needs are already in `lib/words.ts` under
 * `W.product.historyTrail` (written up front so Brief 3 never has to open
 * that file — named `historyTrail` rather than `history` because
 * `product.history` is already the old sheet's "History" button label):
 * column labels and the three outcomes, including `disabled` — the honest
 * reading of an attempt that was recorded but never reached PDAS.
 */
import { W } from '../../lib/words';
import { Block } from '../../ui/bits';

export function HistoryTab() {
  return (
    <Block label={W.product.tabs.history}>
      <p className="mut">{W.product.historyTrail.none}</p>
    </Block>
  );
}
