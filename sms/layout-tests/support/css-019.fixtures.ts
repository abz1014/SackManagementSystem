/** CSS-019 fixture: the CSS-040 machine-product report trimmed to `machines` machines. Synthetic only. */
import type { Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockReport } from './mocks';
import { machineProductEnvelope } from './css-040.fixtures';

export async function primeMachineProductN(page: Page, width: number, height: number, machines: number, scale = 1) {
  await page.setViewportSize({ width, height });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* storage may be blocked */ } }, scale);
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, 'daily');
  const env = machineProductEnvelope() as unknown as { data: { report: { rows: unknown[]; machinesWeighing: number } } };
  env.data.report.rows = env.data.report.rows.slice(0, machines);
  env.data.report.machinesWeighing = machines;
  await page.route('**/api/reports/machine-product**', (route) => route.fulfill({ json: env }));
  await page.goto('/?s=report&rt=machine-product&p=pick&from=2026-08-05&to=2026-08-16');
  await page.locator('.mp-scroll thead th.click').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);
}
