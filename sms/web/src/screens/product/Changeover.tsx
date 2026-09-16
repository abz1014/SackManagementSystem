/**
 * Product › Changeover — STUB (UX Phase 6 Brief 1, 16 Sep 2026).
 *
 * "Put machine N onto product X for this shift — what would that take, and
 * what would it not do?" (IA-PROPOSAL.md §3.2). The dry-run plan
 * (`routes/changeover.ts:121,150,161` — refs, blockers, warnings) works
 * today with `PDAS_WRITE_ENABLED` off; only Execute waits on IFL's written
 * authority. Building that screen is Brief 2's job, not this one's — this
 * file is one honest line so the tab is addressable (`?s=product&pt=changeover`)
 * without pretending the workflow exists yet.
 *
 * The strings Brief 2 needs are already in `lib/words.ts` under
 * `W.product.changeover` (this brief wrote them up front so Brief 2 never
 * has to open that file): the execution-disabled statement, plan step
 * labels, blockers/warnings headings, the no-rollback statement, and the
 * operator note.
 */
import { W } from '../../lib/words';
import { Block } from '../../ui/bits';

export function ChangeoverTab() {
  return (
    <Block label={W.product.tabs.changeover}>
      <p className="mut">{W.product.changeover.noneYet}</p>
    </Block>
  );
}
