/**
 * P3-04 (Phase 3 performance, 12 Oct 2026). User impact: Line, the screen everyone opens first, had to download and parse all
 * 642,671 bytes of JavaScript, much of it for Report, Setup, Health and Wall, screens it does not show.
 * Budget is on BYTES (never time): the JS fetched before Line's headline is visible. Derivation: M-BUNDLE's import-graph estimate
 * for a Line first load is 413,789 B (642,671 - 228,882 moved out), plus 42,100 B because Product stays in the main file (its
 * rank test needs it synchronous) = 455,889; x 1.05 = 478,683, rounded to 480,000.
 * It must also be well under (642,671 - 150,000) = 492,671, the PLAN 2.1 threshold. Runs without a session: every /api/* call is
 * mocked (./support/mocks), synthetic data only.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, mockReport } from './support/mocks';

const BUDGET_JS_BYTES = 480_000;

function trackJs(page: Page) {
  const files = new Map<string, number>();
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/assets/') || !u.pathname.endsWith('.js')) return;
    try { files.set(u.pathname, (await res.body()).length); } catch { /* aborted */ }
  });
  return files;
}

async function prime(page: Page, role = 'manager') {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockCatchAll(page);
  await mockAuth(page, role);
  await mockCommon(page);
  await mockLine(page);
}

test('P3-04 Line first load fetches no more JavaScript than the budget', async ({ page }) => {
  const files = trackJs(page);
  await prime(page);
  await page.goto('/?s=line&p=today');
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  const total = [...files.values()].reduce((a, b) => a + b, 0);
  expect(total, `JS bytes fetched to render Line: ${total} in ${files.size} file(s) ${JSON.stringify([...files])}`).toBeLessThanOrEqual(BUDGET_JS_BYTES);
});

test('P3-04 opening Report from Line fetches a further JS file and renders', async ({ page }) => {
  const files = trackJs(page);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await prime(page);
  await mockReport(page, 'daily');
  await page.goto('/?s=line&p=today');
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  const before = files.size;
  await page.locator('.nav-link').nth(6).click(); // SCREENS order: ..., product, report, health
  await page.locator('.nav-link.on').filter({ hasText: /report/i }).waitFor({ timeout: 15_000 });
  await page.locator('.tw table, .figs, h1').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  expect(files.size, `JS files before ${before}, after ${files.size}: ${JSON.stringify([...files.keys()])}`).toBeGreaterThan(before);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('P3-04 Setup (rank 4) and Health load their own JS file', async ({ page }) => {
  // The empty catch-all mock makes Setup's own panels throw inside Setup (its ErrorBoundary fallback), which is not what this
  // test is about: it asserts only that each screen's chunk was fetched on demand and that no chunk-load failure is shown.
  const files = trackJs(page);
  await prime(page, 'admin');
  await page.goto('/?s=line&p=today');
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  const before = files.size;
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('s') === 'setup', undefined, { timeout: 15_000 });
  await expect.poll(() => files.size, { timeout: 15_000 }).toBeGreaterThan(before);
  const afterSetup = files.size;
  await page.locator('.nav-link').nth(7).click(); // health
  await page.locator('.nav-link.on').filter({ hasText: /health/i }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  expect(files.size, 'Health added no further chunk it did not already share with Setup').toBeGreaterThanOrEqual(afterSetup);
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body, 'a chunk-load failure is shown').not.toMatch(/dynamically imported|failed to fetch|loading chunk/);
});
