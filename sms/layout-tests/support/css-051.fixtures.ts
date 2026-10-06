/**
 * Synthetic reason-sheet payload for CSS-051 / CSS-023 (2 Oct 2026 CSS loop).
 * Invented rows only; the wire shape is RejectReasonData (web/src/api.ts).
 */
import type { Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockRejects, META } from './mocks';

export function reasonSheetPayload(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    eventId: 9000 + i,
    productionTsUtc: `2026-09-03T${String(6 + Math.floor(i / 60) % 16).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:41Z`,
    shiftCode: 'morning',
    station: 1 + (i % 14),
    materialId: 12,
    productLabel: '205-IL0-SD',
    weightG: i % 3 === 0 ? null : 2032 + i,
    sourceRowId: 5148 + i,
    epochLabel: 'pack1_TP1U2 gen 3',
    epochOrdinal: 3,
    epochSimulator: false,
    attributionMethod: 'source_column',
  }));
  return {
    data: {
      day: '2026-09-03', dayBasis: 'production_day',
      code: { rejectType: 'quality', tubeCode: 3, materialCode: 5 },
      rejectCodeId: 1, label: 'Bad tube', displayLabel: 'Bad tube', isPass: false,
      total: n, page: 1, pageSize: 200, rows,
    },
    metadata: META,
  };
}

export const REASON_URL =
  '/?s=rejects&p=pick&from=2026-09-01&to=2026-09-07&sheet=reason:2026-09-03%7Cquality%7C3%7C5';

export async function primeReasonSheet(page: Page, n: number) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockRejects(page);
  await page.route('**/api/rejects/reason**', (route) => route.fulfill({ json: reasonSheetPayload(n) }));
  await page.goto(REASON_URL);
  await page.locator('.sheet table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
}
