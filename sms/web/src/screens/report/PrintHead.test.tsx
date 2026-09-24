/**
 * UX Phase 9 Brief B: `RegisterPrintHead` used to drop the print
 * attribution block whole when `/api/reports/header` failed
 * (`reliability.guard.test.ts`'s `PrintHead.tsx:h` entry, allow-listed
 * "deferred to Phase 9" — now deleted from that list, in the same commit as
 * this test, because the guard itself would go stale otherwise).
 *
 * Readings' Print button (`Readings.tsx:253`) carries no `disabled` gate,
 * unlike Report's (`Report.tsx:138`, `disabled={!data}`) — so a reader can
 * click Print exactly when the header poll has failed, and the printed page
 * must still say something about where it came from.
 *
 * Two-sided in the Phase 8 idiom: the healthy case still renders full
 * attribution, and the failure case is checked both for what it DOES print
 * (line, title, period) and for the ABSENCE of the healthy "Generated ..."
 * sentence — a test that only checks the degraded sentence appears would
 * pass equally against a screen that prints both, which is not this fix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { renderWithLive } from '../../testkit/render';
import { LIVE_FIXTURE } from '../../testkit/fixtures';
import { W } from '../../lib/words';
import type { ReportHeader } from '../../api';
import { RegisterPrintHead, generatedLine } from './PrintHead';

// `fetchRouter.ts`'s own contract: "a test that installs its own router must
// restore it itself ... or rely on Vitest's own vi.unstubAllGlobals() in a
// project-wide afterEach, which this repo does not configure." This file
// calls installFakeFetch() fresh inside every `it()` without ever restoring
// it (found during the D-7 flake hunt, DEFECTS.md — not itself the D-7
// mechanism, but a real violation of the same contract). Harmless today
// because each `it()` reinstalls a full route set before rendering, but a
// stacked, never-restored fake fetch is exactly the kind of latent
// cross-test contamination that race was hard to diagnose because of.
afterEach(() => {
  vi.unstubAllGlobals();
});

const HEADER: ReportHeader = {
  reportType: 'register',
  title: 'Readings · Cones',
  lineName: 'TP1 Line 3 · Unit 2',
  plantName: null,
  unitName: null,
  period: { period: 'pick', from: '2026-09-10', to: '2026-09-12', days: 3 },
  filters: {},
  generatedAtPlantUtc: '2026-09-21T09:15:00Z',
  generatedBy: 'wasif',
  smsVersion: '1.9.0',
  definitions: 'KPI-DEFINITIONS.md',
  approval: 'awaiting',
  spansGenerations: false,
  sourceGeneration: null,
  otherGenerationExcluded: null,
};

// `fmtPlantInstant` (PrintHead.tsx:20-24) renders `generatedAtPlantUtc` pinned
// to the UTC timezone regardless of the machine running the test — it is not
// the viewer's local clock, so asserting on its formatted output is safe.
// (`fmtAppInstant`, lib/fmt.ts:50, is the one that follows the viewer's own
// timezone and must never be asserted on here.)
const HEALTHY_LINE = generatedLine(HEADER);

describe('RegisterPrintHead — header present', () => {
  it('renders full attribution: line, title, period and the generated/by/version line', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/reports/header': { header: HEADER },
    });

    const { findByText } = renderWithLive(
      <RegisterPrintHead from="2026-09-10" to="2026-09-12" at={null} title="Readings · Cones" />,
    );

    await findByText(HEALTHY_LINE);
    await findByText(W.reports.definitionsNote);
  });
});

describe('RegisterPrintHead — /api/reports/header fails', () => {
  it('REJECTS: the block still prints, names the line/title/period, and states the three missing facts', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/reports/header': () => {
        throw new Error('network down');
      },
    });

    const { findByText, queryByText, container } = renderWithLive(
      <RegisterPrintHead from="2026-09-10" to="2026-09-12" at={null} title="Readings · Cones" />,
    );

    // Never silence: a print-head block is present at all.
    await findByText(W.reports.generatedUnavailable);
    expect(container.querySelector('.print-head')).not.toBeNull();

    // What it still knows without the server: the live line, the title the
    // caller already held, and the period the caller already held.
    expect(container.querySelector('.print-head b')?.textContent).toContain(LIVE_FIXTURE.data.lines[0]!.lineName);
    expect(container.querySelector('.print-head b')?.textContent).toContain('Readings · Cones');
    expect(container.querySelector('.print-head b')?.textContent).toContain('2026-09-10');
    expect(container.querySelector('.print-head b')?.textContent).toContain('2026-09-12');

    // The second named fact, and the two-sided check: the healthy sentence
    // this degraded block replaces must be ABSENT, not merely unchecked —
    // printing both would silently carry a stale/wrong attribution alongside
    // the honest admission.
    await findByText(W.reports.printedSelectionNote);
    expect(queryByText(HEALTHY_LINE)).toBeNull();
    expect(queryByText(W.reports.definitionsNote)).toBeNull();
  });

  it('RESOLVES two-sided: a genuinely present header must NOT read as the degraded sentence', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/reports/header': { header: HEADER },
    });

    const { findByText, queryByText } = renderWithLive(
      <RegisterPrintHead from="2026-09-10" to="2026-09-12" at={null} title="Readings · Cones" />,
    );

    await findByText(HEALTHY_LINE);
    expect(queryByText(W.reports.generatedUnavailable)).toBeNull();
    expect(queryByText(W.reports.printedSelectionNote)).toBeNull();
  });
});
