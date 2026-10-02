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
import { PrintHead, RegisterPrintHead, generatedLine, mastheadPeriod, mastheadPlace } from './PrintHead';

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

describe('IFL house-style masthead', () => {
  it('renders the logo, the centred company line, the underlined title and DD-MM-YYYY dates', async () => {
    const { PrintHead } = await import('./PrintHead');
    const { container } = renderWithLive(<PrintHead header={{ ...HEADER, filters: { shift: 'morning' } }} />);
    const img = container.querySelector('img.ph-logo')!;
    expect(img.getAttribute('src')).toBe('/ifl-logo.jpg');
    expect(img.getAttribute('alt')).toBe('IFL');
    // D-48: the company line is the company, and the place under it comes from
    // the header's own plant/unit/line — never a plant name typed into the app.
    expect(container.querySelector('.ph-company')?.textContent).toBe('Ibrahim Fibres Limited');
    expect(container.querySelector('.ph-place')?.textContent).toBe('TP1 Line 3 · Unit 2');
    expect(container.querySelector('.print-head')?.textContent).not.toContain('Textile Plant 4');
    expect(container.querySelector('.ph-title')?.textContent).toBe('Readings · Cones');
    const meta = container.querySelector('.ph-meta')!.textContent!;
    expect(meta).toContain('10-09-2026 to 12-09-2026');
    expect(meta).toContain('21-09-2026 09:15');
    expect(meta).toContain('06:00–14:00');
  });

  it('keeps disclosures out of the head unless inlineNotes, and out of the header entirely otherwise', async () => {
    const { PrintHead } = await import('./PrintHead');
    const h = { ...HEADER, shiftNote: 'SHIFT NOTE X' };
    const a = renderWithLive(<PrintHead header={h} />);
    expect(a.queryByText('SHIFT NOTE X')).toBeNull();
    expect(a.queryByText(W.reports.definitionsNote)).toBeNull();
    a.unmount();
    const b = renderWithLive(<PrintHead header={h} inlineNotes />);
    expect(b.queryByText('SHIFT NOTE X')).not.toBeNull();
  });
});

describe('masthead place line (D-48: no hard-coded plant)', () => {
  it('prints the header’s plant, unit and line, dropping a part another part already contains', () => {
    expect(mastheadPlace({ plantName: 'TP1', unitName: 'Unit 2', lineName: 'TP1 · Line 3 · Unit 2' })).toBe('TP1 · Line 3 · Unit 2');
    expect(mastheadPlace({ plantName: 'TP2', unitName: 'Unit 9', lineName: 'Line 4' })).toBe('TP2 · Unit 9 · Line 4');
    expect(mastheadPlace({ plantName: null, unitName: null, lineName: 'TP1 Line 3 · Unit 2' })).toBe('TP1 Line 3 · Unit 2');
  });
  it('is blank when the header names nothing, and never invents a plant', () => {
    expect(mastheadPlace({ plantName: null, unitName: null, lineName: '' })).toBe('');
    expect(mastheadPlace(null)).toBe('');
    expect(mastheadPlace({ plantName: '  ', unitName: '', lineName: 'Line 3' })).toBe('Line 3');
  });
  it('a header from another plant prints that plant, not Textile Plant 4', async () => {
    const { PrintHead } = await import('./PrintHead');
    const h = { ...HEADER, plantName: 'TP7', unitName: 'Unit 1', lineName: 'Line 9' };
    const { container } = renderWithLive(<PrintHead header={h} />);
    expect(container.querySelector('.ph-company')?.textContent).toBe('Ibrahim Fibres Limited');
    expect(container.querySelector('.ph-place')?.textContent).toBe('TP7 · Unit 1 · Line 9');
  });
  it('the degraded register header still names the company and no plant', async () => {
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/reports/header': () => { throw new Error('down'); } });
    const { findByText, container } = renderWithLive(<RegisterPrintHead from="2026-09-10" to="2026-09-12" at={null} title="Readings · Cones" />);
    await findByText(W.reports.generatedUnavailable);
    expect(container.querySelector('.ph-company')?.textContent).toBe('Ibrahim Fibres Limited');
    expect(container.querySelector('.ph-place')).toBeNull();
  });
});

describe('mastheadPeriod — a shift-bounded report names its shifts, not just the days (IFL reports, H-exports)', () => {
  const plain = { period: { period: 'custom', from: '2026-09-02', to: '2026-09-03', days: 2 }, periodLabel: '2026-09-02 to 2026-09-03' };
  const ranged = { period: plain.period, periodLabel: '2 Sep morning shift – 3 Sep night shift' };

  it('a plain period prints the days only (the plain label the server sends adds nothing)', () => {
    expect(mastheadPeriod(plain)).toBe('02-09-2026 to 03-09-2026');
    expect(mastheadPeriod({ period: plain.period })).toBe('02-09-2026 to 03-09-2026');
    expect(mastheadPeriod({ period: { ...plain.period, to: '2026-09-02' }, periodLabel: '2026-09-02 to 2026-09-02' })).toBe('02-09-2026');
  });

  it('a shift range is printed after the days, in the words the CSV period row uses', () => {
    expect(mastheadPeriod(ranged)).toBe('02-09-2026 to 03-09-2026 (2 Sep morning shift – 3 Sep night shift)');
  });

  it('the printed masthead carries it (and a blank label is ignored)', () => {
    const header = { ...HEADER, period: plain.period, periodLabel: ranged.periodLabel };
    const { container } = renderWithLive(<PrintHead header={header} />);
    const row = [...container.querySelectorAll('.ph-meta > div')].find((d) => d.querySelector('dt')?.textContent === W.printDoc.period);
    expect(row?.querySelector('dd')?.textContent).toBe('02-09-2026 to 03-09-2026 (2 Sep morning shift – 3 Sep night shift)');
    expect(mastheadPeriod({ period: plain.period, periodLabel: '   ' })).toBe('02-09-2026 to 03-09-2026');
  });
});
