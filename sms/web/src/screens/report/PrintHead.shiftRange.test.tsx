/**
 * C-174 (D-81): the Readings print masthead stated whole days for a
 * shift-bounded register. RegisterPrintHead must forward the period's shift /
 * shift range to /api/reports/header, and the masthead must name that range.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../../testkit/fetchRouter';
import { renderWithLive } from '../../testkit/render';
import { LIVE_FIXTURE } from '../../testkit/fixtures';
import type { ReportHeader } from '../../api';
import { RegisterPrintHead } from './PrintHead';

afterEach(() => {
  vi.unstubAllGlobals();
});

const HEADER: ReportHeader = {
  reportType: 'register',
  title: 'Register',
  lineName: 'TP1 Line 3 · Unit 2',
  plantName: null,
  unitName: null,
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-02', days: 2 },
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

/** Behaves like the real route: a shift range in the query becomes the period label. */
function headerRoute(seen: URLSearchParams[]) {
  return (req: RouteRequest) => {
    seen.push(req.search);
    const f = req.search.get('fromShift');
    const t = req.search.get('toShift');
    const label = f && t && f !== t
      ? '1 Sep evening shift – 2 Sep morning shift'
      : f && t
        ? '2 Sep night shift'
        : '2026-09-01 to 2026-09-02';
    return { header: { ...HEADER, periodLabel: label } };
  };
}

describe('RegisterPrintHead - shift-bounded periods', () => {
  it('a shift range is forwarded as fromShift/toShift and the masthead names it', async () => {
    const seen: URLSearchParams[] = [];
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/reports/header': headerRoute(seen) });
    const { findByText } = renderWithLive(
      <RegisterPrintHead
        from="2026-09-01" to="2026-09-02" at={null} title="Readings"
        fromShift="2026-09-01.evening" toShift="2026-09-02.morning"
      />,
    );
    await findByText(/1 Sep evening shift – 2 Sep morning shift/);
    expect(seen[0]!.get('fromShift')).toBe('2026-09-01.evening');
    expect(seen[0]!.get('toShift')).toBe('2026-09-02.morning');
  });

  it('a single shift period is forwarded as one shift (same fromShift and toShift)', async () => {
    const seen: URLSearchParams[] = [];
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/reports/header': headerRoute(seen) });
    const { findByText } = renderWithLive(
      <RegisterPrintHead from="2026-09-02" to="2026-09-02" at={null} title="Readings" shift="night" />,
    );
    await findByText(/2 Sep night shift/);
    expect(seen[0]!.get('fromShift')).toBe('2026-09-02.night');
    expect(seen[0]!.get('toShift')).toBe('2026-09-02.night');
  });

  it('a whole-day period sends no shift parameters', async () => {
    const seen: URLSearchParams[] = [];
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/reports/header': headerRoute(seen) });
    renderWithLive(<RegisterPrintHead from="2026-09-01" to="2026-09-02" at={null} title="Readings" />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]!.has('fromShift')).toBe(false);
    expect(seen[0]!.has('toShift')).toBe(false);
  });
});
