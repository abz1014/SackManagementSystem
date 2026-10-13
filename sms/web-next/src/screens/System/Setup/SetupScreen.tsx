/**
 * System > Setup (task E12; no mockup, decision E-8). Rank 4 only: the tab is left out below it, and a typed URL gets
 * the "only available to an administrator" sentence instead of any control.
 *
 * The eight sections are the old Setup's, with their write logic reused through bridge/system.ts (what is sent, what the
 * server answers, no optimistic UI, the server's own error text). Each sits behind a WriteGate at rank 4, so no write
 * control renders below it. Restyling is Setup/legacy.css. Differences from the old page, per IA-MAP: the sync-health
 * block lives only on Diagnostics, and product limits live only on Products & PDAS (a link stands here).
 * The data-source tables name IFL's tables, so that section is drawn inside a "Technical detail" disclosure.
 */
import { C, withFragments, FRAGMENTS } from '../../../copy';
import type { ReactNode } from 'react';
import { hrefFor, routeFor } from '../../../ui/nav';
import { Disclosure } from '../../../ui/Disclosure';
import { WriteGate } from '../../../ui/WriteGate';
import { ADMIN_RANK } from '../../../ranks';
import { AuditLog, LineBlock, MachinesBlock, People, RejectCodesBlock, RulesBlock, SourcesBlock, StationsBlock } from '../../../bridge/system';
import type { ScreenProps } from '../../registry';
import { SystemTabs } from '../SystemTabs';
import '../system.css';
import './legacy.css';
const SY = withFragments(C.system, FRAGMENTS.systemParts);

const S = SY.setup;

/** `own`: the section draws its own visible title; otherwise the legacy block's label is the visible one and this heading is for screen readers. */
function Section({ id, title, rank, own, children }: { id: string; title: string; rank: number; own?: boolean; children: ReactNode }) {
  return (
    <WriteGate rank={rank} minRank={ADMIN_RANK}>
      <section className="card sy-card sy-legacy" aria-labelledby={id} data-section={id}>
        <h2 id={id} className={own ? 'sy-card__title' : 'sy-sr'}>{title}</h2>
        {children}
      </section>
    </WriteGate>
  );
}

export function SetupScreen({ route, rank, user, go }: ScreenProps) {
  const limitsHref = hrefFor(routeFor(route, { s: 'products', t: 'limits' }));
  return (
    <div className="sy-page">
      <SystemTabs route={route} rank={rank} go={go} />
      <header className="sy-head">
        <h1 className="sy-title">{S.title}</h1>
        <p className="sy-sentence">{rank >= ADMIN_RANK ? S.sentence : S.notAllowed}</p>
      </header>
      <Section id="setup-line" title={S.sections.line} rank={rank}><LineBlock /></Section>
      <Section id="setup-machines" title={S.sections.machines} rank={rank}><MachinesBlock /></Section>
      <Section id="setup-stations" title={S.sections.stations} rank={rank}><StationsBlock /></Section>
      <Section id="setup-rules" title={S.sections.rules} rank={rank}>
        <RulesBlock withProductLimits={false} />
        <p className="sy-note">
          {S.limitsMoved} <a className="ui-link" href={limitsHref}>{S.limitsLink}</a>
        </p>
      </Section>
      <Section id="setup-codes" title={S.sections.rejectCodes} rank={rank}><RejectCodesBlock /></Section>
      <Section id="setup-sources" title={S.sections.sources} rank={rank} own>
        <p className="sy-note">{S.sourcesIntro}</p>
        <Disclosure id="setup-sources-detail" label={S.sourcesDetail}>
          <SourcesBlock />
        </Disclosure>
      </Section>
      <Section id="setup-people" title={S.sections.people} rank={rank}><People currentUsername={user.username} /></Section>
      <Section id="setup-audit" title={S.sections.audit} rank={rank}><AuditLog /></Section>
    </div>
  );
}
