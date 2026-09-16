/**
 * Product — "What is each machine running, what are its limits, and how do
 * I change it?" (IA-PROPOSAL.md §3.2). The 7th nav item (UX Phase 6 Brief 1,
 * 16 Sep 2026), absorbing the old product sheet component, which used to be the only place
 * this question was answered and was reachable only from Line's "Change"
 * and "History" buttons — a dead end with no address of its own, no tab
 * strip, and no room for the Changeover workflow or a real history screen.
 *
 * FOUR TABS, ONE SHELL. `pt` in the URL: running (default, omitted) |
 * changeover | catalogue | history. Running and Catalogue are built here;
 * Changeover and History are one-line stubs that Briefs 2 and 3 replace —
 * see their own files for why they are not built yet.
 *
 * ONE AUDIENCE (CLAUDE.md): every tab is open to every signed-in account.
 * Only the WRITE actions inside a tab — setting the running product,
 * changing PDAS limits, creating/retiring a product — are rank-gated, and
 * gated server-side; this screen is never tiered by role itself.
 *
 * THE DUPLICATION THIS SCREEN MUST NOT CREATE (IA-PROPOSAL.md's own defect,
 * corrected here): §3.1 lists "machines running" as a Line capability and
 * §3.2 lists it again under Product › Running. Building both as the same
 * table would violate CLAUDE.md:305 ("no two screens may answer the same
 * question"). Line's MachinesBlock is untouched and keeps answering "is the
 * line running, station by station". Running.tsx pivots the SAME
 * `/api/machines/running` payload BY PRODUCT — "which products are in
 * force right now, on which machines, with what limits, since when" — a
 * different axis, not a second copy.
 */
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Toggle } from '../ui/bits';
import type { ProductTab } from '../ui/Bar';
import { RunningTab } from './product/Running';
import { CatalogueTab } from './product/Catalogue';
import { ChangeoverTab } from './product/Changeover';
import { HistoryTab } from './product/History';

export function ProductScreen({
  period,
  tab,
  onTabChange,
  productId,
  onProductIdChange,
  canWrite,
  onOpenStation,
  onSeeStationReadings,
}: {
  period: Period;
  tab: ProductTab;
  onTabChange: (t: ProductTab) => void;
  /** SHARED `pr` key (App.tsx's Route note) — deep-links one product into
   *  the Catalogue tab. Ignored by Running, Changeover and History. */
  productId: number | null;
  onProductIdChange: (v: number | null) => void;
  /** Rank >= 2 — setting the running product (POST /api/current-product).
   *  PDAS writes (Catalogue) and the Changeover workflow ask the server for
   *  their OWN write status independently; this prop only gates the local
   *  "change the running product" form Running.tsx owns. */
  canWrite: boolean;
  onOpenStation: (station: number) => void;
  onSeeStationReadings: (station: number) => void;
}) {
  return (
    <>
      <div className="page">
        <p className="q">{W.question.product}</p>
        <h1 className="wide">{W.nav.product}</h1>
      </div>

      <Block first>
        <Toggle
          label={W.nav.product}
          value={tab}
          onChange={onTabChange}
          options={[
            { key: 'running', label: W.product.tabs.running },
            { key: 'changeover', label: W.product.tabs.changeover },
            { key: 'catalogue', label: W.product.tabs.catalogue },
            { key: 'history', label: W.product.tabs.history },
          ]}
        />
      </Block>

      {tab === 'running' && (
        <RunningTab
          period={period}
          canWrite={canWrite}
          onOpenStation={onOpenStation}
          onSeeStationReadings={onSeeStationReadings}
        />
      )}
      {/* Same rank>=2 boolean Running's "Change" form gates — it matches
          PDAS_WRITE_RANK (routes/changeover.ts) exactly, so Execute's own
          client-side gate (writesEnabled && no blockers && this) agrees
          with the server without needing a second rank number threaded
          through. Brief 2, 16 Sep 2026. */}
      {tab === 'changeover' && <ChangeoverTab canWrite={canWrite} />}
      {tab === 'catalogue' && <CatalogueTab productId={productId} onProductIdChange={onProductIdChange} />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}
