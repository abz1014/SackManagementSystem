/**
 * The four tables the "table-clipping fixes" section of CLAUDE.md (UX Phase
 * 9) names as verified only by viewport resize + an injected stylesheet —
 * never a real render. Each is a `.tw`-wrapped table (`web/src/app.css`'s
 * `.tw { overflow-x: auto }` — scrolls on screen, but the print-CSS fix this
 * checks is that it widens to the full page in print; this spec checks the
 * ON-SCREEN behaviour only, at 1366 and 1920, since print is covered
 * separately by `print.spec.ts`).
 *
 * Needs a session — see `support/auth.ts`.
 */
import { test, expect } from '@playwright/test';
import { signedInPage } from './support/auth';
import { measureHorizontalOverflow } from './support/overflow';

const TARGETS = [
  { name: 'Weight station table', url: '/?s=weight' },
  { name: 'Health epoch register', url: '/?s=health', wrapper: '.tw:has(table.epoch-tbl)' },
  { name: 'Calibration report station table', url: '/?s=report&rt=calibration' },
  { name: 'Daily report by-shift table', url: '/?s=report&rt=daily' },
  { name: 'Sack report by-shift table', url: '/?s=report&rt=sack' },
] as const;

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

for (const target of TARGETS) {
  for (const vp of VIEWPORTS) {
    test(`${target.name}: no horizontal overflow at ${vp.width}x${vp.height}`, async ({ browser, baseURL }) => {
      const s = await signedInPage(browser, baseURL!);
      test.skip(s.page === null, (s as { reason: string }).reason ?? 'no session');
      if (s.page === null) return;
      const { page, context } = s;

      try {
        await page.setViewportSize(vp);
        await page.goto(target.url);

        const wrapper = page.locator('wrapper' in target ? target.wrapper : '.tw').first();
        await expect(wrapper).toBeVisible({ timeout: 15_000 });

        // The wrapper (`.tw { overflow-x: auto }`) is EXPECTED to be able to
        // scroll internally — that's the mechanism, not the defect. What
        // must not happen is the PAGE itself gaining horizontal scroll,
        // which is what silently clips content past the viewport edge with
        // no visual cue (the defect CLAUDE.md's Phase 9 section describes).
        const pageOverflow = await measureHorizontalOverflow(page.locator('html'));
        console.log(
          `[${target.name} ${vp.width}x${vp.height}] page scrollWidth=${pageOverflow.scrollWidth} ` +
            `clientWidth=${pageOverflow.clientWidth} overflowPx=${pageOverflow.overflowPx}`,
        );
        expect(
          pageOverflow.overflows,
          `${target.name} at ${vp.width}x${vp.height}: page scrolls horizontally by ${pageOverflow.overflowPx}px`,
        ).toBe(false);
      } finally {
        await context.close();
      }
    });
  }
}
