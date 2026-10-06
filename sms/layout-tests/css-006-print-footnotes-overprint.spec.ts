/**
 * CSS-006 (Phase 2 CSS defect loop, 5 Oct 2026) - printed footnotes overprint when the list crosses a page break.
 *
 * USER IMPACT: the closing footnote list is laid out as a one-column multicol box; when its first (long) footnote wraps
 * across a page break, Chromium prints the continuation lines on top of other lines, so the notes (method, caveats,
 * "awaiting IFL" assumptions) become unreadable on paper. It depends on where the page break falls, so the spec sweeps
 * the vertical position of the list across one page.
 *
 * Runs WITHOUT a session: every /api/* call is mocked (support/mocks.ts, station report fixture with a synthetic long
 * first footnote), the page is printed with page.pdf (same options as api/src/services/reports/pdf.ts), and the words'
 * boxes are read with PyMuPDF (the host's pdftotext is xpdf 4.00, which has no -bbox).
 */
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { mockCatchAll, mockAuth, mockCommon, mockReport, reportEnvelope } from './support/mocks';

// Word boxes come from PyMuPDF (`fitz`): the pdftotext on this plant PC is xpdf 4.00, which has no -bbox. Override the interpreter with $PYTHON.
const PYTHON = process.env.PYTHON ?? 'python';
const WORDS_PY = [
  'import sys,json,fitz',
  'd=fitz.open(sys.argv[1])',
  'print(json.dumps([[i,w[0],w[1],w[2],w[3],w[4]] for i,p in enumerate(d) for w in p.get_text("words")]))',
].join('\n');

const LONG_FIRST = 'Method note (synthetic fixture). ' + 'Each station is compared with the line mean over the same period, using the weighed cones inside the plausibility window only; a station is only called out when its difference holds on more than one production day. '.repeat(4);
const NOTES = [
  LONG_FIRST,
  'Assumed until IFL confirms: a rejected cone is a cone with a weight-reject record, counted once.',
  'Figure definitions are awaiting IFL approval.',
  'Production timestamps are the plant wall clock; app-written instants are UTC.',
  'Source: the plant weighing tables as synchronised by SMS; the figures on this page are read-only copies.',
];

async function prime(page: Page) {
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await mockReport(page, 'station');
  await page.route('**/api/reports/station**', (route) => {
    const env = reportEnvelope('station') as { data: { header: Record<string, unknown> } };
    env.data.header = { ...env.data.header, reportNotes: NOTES };
    return route.fulfill({ json: env });
  });
  await page.goto('/?s=report&rt=station&p=today');
  await page.locator('section.pd-notes').waitFor({ state: 'attached', timeout: 15_000 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

interface Word { page: number; x0: number; y0: number; x1: number; y1: number; t: string }

function readWords(pdfPath: string): Word[] {
  const rows = JSON.parse(execFileSync(PYTHON, ['-c', WORDS_PY, pdfPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as [number, number, number, number, number, string][];
  return rows.map(([pg, x0, y0, x1, y1, t]) => ({ page: pg, x0, y0, x1, y1, t }));
}

function overlappingPairs(words: Word[]): number {
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i]; const b = words[j];
      if (a.page !== b.page) continue;
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
      if (w > 1 && h > 0.3 * minH) n++;
    }
  }
  return n;
}

test('CSS-006 footnote words never overprint, wherever the page break falls in the list', async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await page.setViewportSize({ width: 1123, height: 794 });
  await prime(page);
  // The list is moved to a fresh page and pushed down by (one page height - X) so that its first footnote starts X px above the
  // page end: sweeping X walks the page break through the first footnote's lines. 100vh in print is the page's content height.
  const results: string[] = [];
  let worst = 0;
  for (let x = 0; x <= 80; x += 2) {
    await page.evaluate((px) => {
      document.querySelectorAll('.css006-spacer').forEach((e) => e.remove());
      const notes = document.querySelector('section.pd-notes')!;
      const mk = (css: string) => { const d = document.createElement('div'); d.className = 'css006-spacer'; d.style.cssText = css; notes.parentElement!.insertBefore(d, notes); };
      mk('break-before: page; height: 0;');
      mk(`height: calc(100vh - ${px}px);`);
    }, x);
    const pdfPath = path.join(testInfo.outputPath(`css006-${x}.pdf`));
    writeFileSync(pdfPath, await page.pdf({ printBackground: true, preferCSSPageSize: true }));
    const pairs = overlappingPairs(readWords(pdfPath));
    results.push(`${x}:${pairs}`);
    worst = Math.max(worst, pairs);
  }
  expect(worst, `overlapping word pairs per list position (px above page end : pairs) = ${results.join(', ')}`).toBe(0);
});
