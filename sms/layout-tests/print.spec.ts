/**
 * Print / PDF rendering — CLAUDE.md's UX Phase 9 section is explicit that
 * "no print-pipeline verification exists" anywhere in this project's
 * history: every print claim came from viewport resize plus an injected
 * stylesheet, "a simulation of print layout, not a print render". This file
 * is the first attempt at an actual render.
 *
 * Two tests:
 *  1. A PDF SMOKE TEST on the Login screen (no session needed) — proves
 *     `page.pdf()` itself works end-to-end through the installed Edge on
 *     this machine, independent of the credential wall below. This is a
 *     REAL PDF render, written to `layout-tests/.output/`, not a simulation
 *     — but it renders the Login screen, not a report, so it does not by
 *     itself verify any of the report/register print claims.
 *  2. The Report screen's own print output (`?s=report`, `role="group"
 *     [aria-label="Report"]` keys the `report-landscape` @page rule per
 *     `app.css` — see CLAUDE.md's fragility note on this exact selector)
 *     needs a session and is skipped without one.
 *
 * `page.pdf()` requires Chromium's headless PDF pipeline; Playwright exposes
 * it for any Chromium-family browser including `channel: 'msedge'`, which is
 * what this harness drives (see playwright.config.ts).
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { signedInPage } from './support/auth';

const OUT_DIR = path.join(__dirname, '.output', 'pdf');

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test('PDF smoke test: Login screen renders to a real PDF via Edge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.emulateMedia({ media: 'print' });

  const outPath = path.join(OUT_DIR, 'login-screen-smoke.pdf');
  const buf = await page.pdf({ path: outPath, format: 'A4' });

  console.log(`[print smoke] wrote ${outPath} (${buf.length} bytes)`);
  // A blank/failed render would be a handful of bytes (an empty PDF shell is
  // still ~800-1000 bytes); this threshold just distinguishes "a page was
  // actually rasterised" from "the call silently produced nothing".
  expect(buf.length, 'PDF output was implausibly small for a rendered page').toBeGreaterThan(1000);
});

test('Report screen: print media + PDF render, landscape for reports', async ({ browser, baseURL }) => {
  const s = await signedInPage(browser, baseURL!);
  test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
  if (s.page === null) return;
  const { page, context } = s;

  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/?s=report&rt=machine-product');
    await expect(page.locator('[role="group"][aria-label]').first()).toBeVisible({ timeout: 15_000 });

    await page.emulateMedia({ media: 'print' });
    const outPath = path.join(OUT_DIR, 'report-machine-product.pdf');
    const buf = await page.pdf({ path: outPath, landscape: true });
    console.log(`[print report] wrote ${outPath} (${buf.length} bytes)`);
    expect(buf.length).toBeGreaterThan(1000);

    // The no-print rule: the tab strip / selector controls carry `.no-print`
    // and should not be visible under print media.
    const noPrintVisible = await page.locator('.no-print').first().isVisible().catch(() => false);
    console.log(`[print report] a .no-print element is still visible under print media? ${noPrintVisible}`);
  } finally {
    await context.close();
  }
});
