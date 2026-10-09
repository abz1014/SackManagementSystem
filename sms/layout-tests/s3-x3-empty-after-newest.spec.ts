/**
 * S3 X-3 (Stage 3, 9 Oct 2026). User impact: when the chosen period lies after the newest reading on record (the data
 * ends earlier than "this shift"), the six period screens said only that nothing was weighed, rejected or recorded,
 * which reads as "the line made nothing". They now say "No readings in this period - the newest reading is ...".
 * A period that is not after the newest reading keeps the old sentence.
 * Runs without a session: every /api/* call is mocked (mockAuth + the shared fixtures, then empty overrides below),
 * synthetic data only. The plant clock is 8 Oct 2026 10:00, the newest reading 7 Sep 2026 16:41.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  mockCatchAll, mockAuth, mockCommon, mockLine, mockWeight, mockRejects, mockSacks, mockReport,
  LIVE, META, spc, reportEnvelope,
} from './support/mocks';

const QUALIFIED = /No readings in this period\s+.\s+the newest reading is 4:41 PM, 7 Sep\./;

function liveOct() {
  const line = (LIVE as { data: { lines: Array<Record<string, unknown>> } }).data.lines[0]!;
  return {
    ...(LIVE as object),
    data: {
      lines: [{
        ...line,
        plantNowUtc: '2026-10-08T10:00:00Z',
        shift: { code: 'morning', shiftDate: '2026-10-08', startUtc: '2026-10-08T06:00:00Z', endUtc: '2026-10-08T14:00:00Z', elapsedSeconds: 14_400, remainingSeconds: 14_400 },
        dataAsOfUtc: '2026-09-07T16:41:00Z',
        ingestLagSeconds: null,
      }],
    },
  };
}

const ZERO_ROW = { group: 'total', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null };
const env = <T,>(data: T) => ({ data, metadata: META });

async function prime(page: Page, screen: 'line' | 'weight' | 'readings' | 'rejects' | 'sacks' | 'report') {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await page.route('**/api/live**', (route) => route.fulfill({ json: liveOct() }));
  if (screen === 'line') {
    await mockLine(page);
    await page.route('**/api/production**', (route) => {
      const groupBy = new URL(route.request().url()).searchParams.get('groupBy') ?? 'none';
      return route.fulfill({ json: env({ groupBy, rows: groupBy === 'none' ? [ZERO_ROW] : [], unattributed: null, states: null, implausible: null }) });
    });
  }
  if (screen === 'weight') {
    await mockWeight(page);
    await page.route('**/api/spc**', (route) => {
      const j = spc('cone') as { data: Record<string, unknown> };
      return route.fulfill({ json: { ...j, data: { ...j.data, count: 0, mean: 0, median: null, subgroups: [], histogram: [] } } });
    });
    await page.route('**/api/production**', (route) => route.fulfill({ json: env({ groupBy: 'none', rows: [ZERO_ROW], unattributed: null, states: null, implausible: null }) }));
  }
  if (screen === 'readings') {
    await page.route('**/api/events**', (route) => route.fulfill({ json: env({ rows: [], total: 0, page: 1, pageSize: 100 }) }));
  }
  if (screen === 'rejects') {
    await mockRejects(page);
    await page.route('**/api/reject-spc**', (route) => {
      const kind = new URL(route.request().url()).searchParams.get('rejectType') ?? 'all';
      return route.fulfill({ json: env({ bucketSize: 'day', rejectTypeFilter: kind, totalProduced: 0, totalRejects: 0, pBar: null, spansGenerations: false, generations: [], outOfControlCount: 0, buckets: [], episodes: [] }) });
    });
    await page.route('**/api/rejects**', (route) => {
      if (route.request().url().includes('by-day-code')) return route.fulfill({ json: env({ rows: [] }) });
      return route.fulfill({ json: env({ total: 0, reasons: [] }) });
    });
  }
  if (screen === 'sacks') {
    await mockSacks(page);
    await page.route('**/api/sacks/summary**', (route) => {
      const zero = { sacks: 0, kg: 0, avgKg: null, inRangePct: null, inRange: 0, noFlag: 0, implausible: 0 };
      return route.fulfill({ json: env({
        from: '2026-10-08', to: '2026-10-08', shift: null, product: null, totals: { ...zero, cones: 0, conesPerSack: null },
        byShift: [], byProduct: [], unattributed: { rows: 0, of: 0 }, weightBasis: 'gross', tareKg: 0,
        plausibility: { loKg: 40, hiKg: 60 }, sackTimeIsInsertTime: true, conesPerSackApproximate: true,
        machineLevel: { enabled: false, reason: 'not available' },
      }) });
    });
  }
  if (screen === 'report') {
    await mockReport(page, 'daily');
    await page.route('**/api/reports/daily**', (route) => {
      const j = reportEnvelope('daily') as { data: { header: unknown; report: Record<string, unknown> }; metadata: unknown };
      const report = { ...j.data.report, coverage: { daysInPeriod: 1, daysWithData: 0, firstDayWithData: null, lastDayWithData: null, complete: false } };
      return route.fulfill({ json: { ...j, data: { ...j.data, report } } });
    });
  }
}

const SCREENS = ['line', 'weight', 'readings', 'rejects', 'sacks', 'report'] as const;
const OLD: Record<(typeof SCREENS)[number], RegExp> = {
  line: /Nothing recorded in this period\./,
  weight: /No cones were weighed in this period\./,
  readings: /Nothing was weighed in this period\./,
  rejects: /No cones were rejected in this period\./,
  sacks: /no sacks weighed\./,
  report: /no production data\./,
};
const url = (s: (typeof SCREENS)[number], q: string) => `/?s=${s}${s === 'report' ? '&rt=daily' : ''}${q}`;

for (const s of SCREENS) {
  test(`X-3 ${s}: this shift, after the newest reading, names the newest reading`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prime(page, s);
    await page.goto(url(s, ''));
    await expect(page.locator('main').getByText(QUALIFIED).first()).toBeVisible({ timeout: 15_000 });
  });

  test(`X-3 ${s}: a period before the newest reading keeps the old sentence`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prime(page, s);
    await page.goto(url(s, '&p=pick&from=2026-09-01&to=2026-09-07'));
    await expect(page.locator('main').getByText(OLD[s]).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main').getByText(QUALIFIED)).toHaveCount(0);
  });
}
