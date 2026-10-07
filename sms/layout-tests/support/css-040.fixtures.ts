/** CSS-040 fixture: a machine-product report (14 machines, 12 production days x 3 shifts) behind mocked /api. Synthetic only. */
import type { Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport, reportEnvelope } from './mocks';

const SHIFTS = ['morning', 'evening', 'night'] as const;

export function machineProductEnvelope() {
  const j = JSON.parse(JSON.stringify(reportEnvelope('daily'))) as { data: { header: Record<string, unknown>; report: unknown } };
  j.data.header.reportType = 'machine-product';
  j.data.header.title = 'Machine-wise product';
  const columns: Array<{ day: string; shift: (typeof SHIFTS)[number]; cones: number }> = [];
  for (let d = 0; d < 12; d++) {
    const day = new Date(Date.UTC(2026, 7, 5) + d * 86_400_000).toISOString().slice(0, 10);
    for (const shift of SHIFTS) columns.push({ day, shift, cones: 70 });
  }
  const rows = Array.from({ length: 14 }, (_, i) => {
    const station = i + 1;
    const cells = columns.map((c) => ({
      station, stationName: null, machineName: `M${station}`, day: c.day, shift: c.shift,
      materials: [{ materialId: 100 + station, productName: `Product ${station}`, cones: 5, firstUtc: '2026-08-05T00:00:00Z', lastUtc: '2026-08-05T00:00:00Z' }],
      dominantMaterialId: 100 + station, cones: 5, changedDuringShift: false,
    }));
    return { station, stationName: null, machineName: `M${station}`, cells, cones: cells.length * 5, materials: 1 };
  });
  j.data.report = {
    period: { period: 'custom', from: '2026-08-05', to: '2026-08-16' },
    filters: {}, columns, rows, changes: [],
    products: Array.from({ length: 3 }, (_, i) => ({ materialId: 101 + i, label: `Product ${i + 1}`, cones: 400, machines: 1, cells: 36, firstUtc: '2026-08-05T00:00:00Z', lastUtc: '2026-08-16T00:00:00Z' })),
    labels: {}, conesWithoutStation: 0, machinesWeighing: 14, note: 'Synthetic fixture.',
  };
  return j;
}

export async function primeMachineProduct(page: Page, width: number, height: number, scale = 1) {
  await page.setViewportSize({ width, height });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* storage may be blocked */ } }, scale);
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, 'daily');
  await page.route('**/api/reports/machine-product**', (route) => route.fulfill({ json: machineProductEnvelope() }));
  await page.goto('/?s=report&rt=machine-product&p=pick&from=2026-08-05&to=2026-08-16');
  await page.locator('.mp-scroll thead th.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
}
