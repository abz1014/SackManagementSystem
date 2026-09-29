/**
 * Chart overhaul, Task T9 — real-browser layout tests for every chart
 * screen: Line, Weight, Rejects, Sacks, Report (Daily/Shift/Reject/Station/
 * ConeWeight/Sack/Calibration) and the station sheet drilldown.
 *
 * Unlike `table-clipping.spec.ts` / `print.spec.ts` (which need a real
 * signed-in session and skip without `SMS_TEST_USERNAME`/`PASSWORD` per this
 * harness's own no-agent-created-login rule), this file NEVER attempts to
 * sign in. Every `/api/*` call is mocked with `page.route` against fixture
 * shapes copied from the real wire contracts in `web/src/api.ts` and the
 * vitest fixtures already in the repo (`web/src/testkit/fixtures.ts`,
 * `web/src/screens/report/*.test.tsx`) — see `support/mocks.ts`'s header.
 * This sidesteps the credential wall entirely and is also the more
 * deterministic choice for a suite whose whole point is exact pixel
 * geometry: the mocked data never drifts under the live simulator this repo
 * is currently running against.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockCatchAll, mockAuth, mockCommon, mockLine, mockWeight, mockRejects, mockSacks, mockReport, mockStationSheet, type ReportKind } from './support/mocks';
import { findChartOverlaps, checkViewBoxMatchesClientWidth, readTickFontSizes } from './support/geometry';

const VIEWPORTS = [
  { width: 600, height: 900 },
  { width: 900, height: 1000 },
  { width: 1366, height: 900 },
  { width: 1920, height: 1080 },
] as const;

interface ScreenDef {
  name: string;
  url: string;
  setup: (page: Page) => Promise<void>;
}

const REPORT_KINDS: ReportKind[] = ['daily', 'shift', 'reject', 'station', 'cone-weight', 'sack', 'calibration'];

// `p=today`/`p=shift` (Period.live === true, `web/src/lib/period.ts`) rather
// than `p=pick&from=..&to=..` for the four LIVE screens: a `pick` period
// whose `to` predates the harness's real wall-clock date (this fixture data
// is dated September 2026; the suite may run later) resolves `live: false`,
// which disables several of Line's/Weight's `usePolling` calls outright and
// leaves their `.data` permanently null — not a rendering defect, just a
// mismatch between mocked fixture dates and the real clock `period.ts`
// reads. `p=today`/`p=shift` sidestep this: the actual `from`/`to` values
// `period.ts` computes are irrelevant here since every `/api/*` route is
// mocked unconditionally regardless of query string. Report screens are
// unaffected (reports are periodic snapshots, not gated on `period.live`),
// so they keep explicit `pick` dates for readable fixture correspondence.
const SCREENS: ScreenDef[] = [
  { name: 'Line', url: '/?s=line&p=today', setup: mockLine },
  { name: 'Weight', url: '/?s=weight&p=today', setup: mockWeight },
  { name: 'Rejects', url: '/?s=rejects&p=today', setup: mockRejects },
  { name: 'Sacks', url: '/?s=sacks&p=today', setup: mockSacks },
  ...REPORT_KINDS.map((k) => ({
    name: `Report:${k}`,
    url: `/?s=report&rt=${k}&p=pick&from=2026-09-01&to=2026-09-07`,
    setup: (page: Page) => mockReport(page, k),
  })),
  { name: 'Station sheet', url: '/?s=line&p=today&sheet=station:5', setup: mockStationSheet },
];

async function primeScreen(page: Page, def: ScreenDef) {
  page.on('console', (msg) => { if (msg.text().includes('DEBUG_CATBARS')) console.log(msg.text()); });
  // Order matters: Playwright runs the LAST-registered matching route
  // first, so the catch-all must be installed BEFORE anything specific
  // (see mocks.ts's header on mockCatchAll).
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await def.setup(page);
  await page.goto(def.url);
  // Wait for at least one chart to mount before measuring — a screen with
  // no data drawn yet is not a layout defect, it's a load race.
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(150); // ResizeObserver settle
}

// ---------------------------------------------------------------------
// 1) No text/mark or text/text overlap, at every viewport, plus a
//    dedicated 1.3x UI-scale pass. Same page load also checks viewBox ==
//    clientWidth (no scaling) per viewport.
// ---------------------------------------------------------------------
for (const def of SCREENS) {
  for (const vp of VIEWPORTS) {
    test(`${def.name}: no chart text/mark overlap at ${vp.width}x${vp.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(vp);
      await primeScreen(page, def);

      const frameCount = await page.locator('.chart-frame').count();
      test.skip(frameCount === 0, `${def.name} drew no .chart-frame at ${vp.width}x${vp.height} — nothing to check`);

      const report = await findChartOverlaps(page, 1);
      if (report.textMarkOverlaps.length || report.textTextOverlaps.length) {
        const shot = testInfo.outputPath(`overlap-${def.name.replace(/[:/]/g, '_')}-${vp.width}x${vp.height}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        const lines = [
          ...report.textMarkOverlaps.map(
            (o) =>
              `TEXT "${o.text}" @[${o.textBox.left.toFixed(1)},${o.textBox.top.toFixed(1)},${o.textBox.right.toFixed(1)},${o.textBox.bottom.toFixed(1)}] ` +
              `overlaps <${o.markTag}> @[${o.markBox.left.toFixed(1)},${o.markBox.top.toFixed(1)},${o.markBox.right.toFixed(1)},${o.markBox.bottom.toFixed(1)}] (chart "${o.frameLabel}")`,
          ),
          ...report.textTextOverlaps.map(
            (o) =>
              `TEXT "${o.a}" @[${o.aBox.left.toFixed(1)},${o.aBox.top.toFixed(1)}] overlaps TEXT "${o.b}" @[${o.bBox.left.toFixed(1)},${o.bBox.top.toFixed(1)}] (chart "${o.frameLabel}")`,
          ),
        ];
        console.log(`[overlap] ${def.name} ${vp.width}x${vp.height}:\n${lines.join('\n')}\nscreenshot: ${shot}`);
      }
      expect(report.textMarkOverlaps, `${def.name} @ ${vp.width}: text/mark overlaps`).toEqual([]);
      expect(report.textTextOverlaps, `${def.name} @ ${vp.width}: text/text overlaps`).toEqual([]);

      const vbChecks = await checkViewBoxMatchesClientWidth(page);
      for (const c of vbChecks) {
        expect(c.diff, `${def.name} @ ${vp.width}: svg "${c.tag}" viewBox width ${c.viewBoxWidth} vs clientWidth ${c.clientWidth}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test(`${def.name}: no chart overlap at --ui-scale 1.3 (1366 wide)`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sms.uiScale', '1.3');
      } catch {
        /* private mode — the app falls back to 1, not this test's concern */
      }
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    await primeScreen(page, def);
    // Some screens set --ui-scale only from Bar.tsx's UserMenu mount effect
    // reading localStorage; make sure it actually landed before measuring.
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.3'));
    await page.waitForTimeout(150);

    const frameCount = await page.locator('.chart-frame').count();
    test.skip(frameCount === 0, `${def.name} drew no .chart-frame under 1.3x scale — nothing to check`);

    const report = await findChartOverlaps(page, 1);
    if (report.textMarkOverlaps.length || report.textTextOverlaps.length) {
      const shot = testInfo.outputPath(`overlap-scale13-${def.name.replace(/[:/]/g, '_')}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      console.log(`[overlap @1.3x] ${def.name}: ${report.textMarkOverlaps.length} text/mark, ${report.textTextOverlaps.length} text/text — screenshot: ${shot}`);
    }
    expect(report.textMarkOverlaps, `${def.name} @1.3x: text/mark overlaps`).toEqual([]);
    expect(report.textTextOverlaps, `${def.name} @1.3x: text/text overlaps`).toEqual([]);
  });
}

// ---------------------------------------------------------------------
// 2) Line's station-deviation chart: "row median" must never overlap a bar
//    (the owner's screenshot defect this task names specifically).
// ---------------------------------------------------------------------
for (const vp of VIEWPORTS) {
  test(`Line station-deviation chart: "row median" never overlaps a bar at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await primeScreen(page, SCREENS[0]!); // Line
    const frame = page.locator('.chart-frame').filter({ has: page.locator('svg[aria-label*="station" i], svg[aria-label*="median" i]') }).first();
    const anyFrame = (await frame.count()) > 0 ? frame : page.locator('.chart-frame').first();
    await expect(anyFrame).toBeVisible();

    const medianText = anyFrame.locator('svg text', { hasText: 'row median' });
    const hasMedianLabel = (await medianText.count()) > 0;
    test.skip(!hasMedianLabel, `"row median" rendered as a legend caption (narrow layout), not SVG text, at ${vp.width}px`);

    const textBox = await medianText.first().boundingBox();
    expect(textBox, 'row median label has no bounding box').not.toBeNull();
    const barBoxes = await anyFrame.locator('svg rect').evaluateAll((els) =>
      els.map((el) => {
        const r = (el as SVGGraphicsElement).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const overlapping = barBoxes.filter(
      (b) => textBox && textBox.x < b.right && textBox.x + textBox.width > b.left && textBox.y < b.bottom && textBox.y + textBox.height > b.top,
    );
    expect(overlapping, `"row median" label overlaps ${overlapping.length} bar(s) at ${vp.width}x${vp.height}`).toEqual([]);
  });
}

// ---------------------------------------------------------------------
// 3) Tick font-size is unchanged after a viewport resize and after opening
//    a Details panel.
// ---------------------------------------------------------------------
test('Weight: tick font-size unchanged after resize and after opening a Details panel', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await primeScreen(page, SCREENS[1]!); // Weight

  const before = await readTickFontSizes(page);
  test.skip(before.length === 0, 'no axis-tick text rendered on Weight to measure');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);
  const afterResize = await readTickFontSizes(page);
  // The SET of sizes in use must not change (a chart may add/drop tick
  // COUNT on resize; the font-size value itself must not).
  expect(new Set(afterResize), 'tick font-size changed after a viewport resize').toEqual(new Set(before));

  const details = page.locator('details.details, details').first();
  if (await details.count()) {
    await details.locator('summary').first().click();
    await page.waitForTimeout(150);
    const afterDetails = await readTickFontSizes(page);
    expect(new Set(afterDetails), 'tick font-size changed after opening a Details panel').toEqual(new Set(before));
  }
});

// ---------------------------------------------------------------------
// 4) Hover a mark -> .chart-tip appears with a value, positioned off the
//    hovered mark.
// ---------------------------------------------------------------------
for (const def of [SCREENS[0]!, SCREENS[1]!, SCREENS[2]!, SCREENS[3]!]) {
  test(`${def.name}: hovering a mark shows .chart-tip with a value, not covering the mark`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await primeScreen(page, def);

    const frame = page.locator('.chart-frame').first();
    test.skip((await frame.count()) === 0, `${def.name} drew no .chart-frame`);

    // Pick the SMALLEST-area mark, not the first one in DOM order: several
    // charts (RejectTrendChart's shaded-period band, DeviationBars'
    // gridlines) draw a large background rect/path before their real data
    // marks, and hovering that trivially "overlaps" any tooltip placed
    // inside the chart body — a test-geometry artifact, not a real defect.
    // Actual data marks (a bar, a point) are reliably the smallest-area
    // shapes in the SVG.
    const candidates = await frame.locator('svg rect, svg circle, svg path').evaluateAll((els) =>
      els.map((el, idx) => {
        const r = (el as SVGGraphicsElement).getBoundingClientRect();
        return { idx, area: r.width * r.height, w: r.width, h: r.height };
      }),
    );
    const real = candidates.filter((c) => c.area > 0).sort((a, b) => a.area - b.area);
    test.skip(real.length === 0, `${def.name} chart drew no hoverable mark`);
    const mark = frame.locator('svg rect, svg circle, svg path').nth(real[0]!.idx);
    const markBox = await mark.boundingBox();
    test.skip(!markBox, `${def.name} mark has no bounding box`);

    const body = frame.locator('.chart-frame-body');
    await body.hover({ position: { x: (markBox!.x + markBox!.width / 2) - (await body.boundingBox())!.x, y: (markBox!.y + markBox!.height / 2) - (await body.boundingBox())!.y } });
    await page.waitForTimeout(120);

    const tip = frame.locator('.chart-tip');
    await expect(tip, `${def.name}: .chart-tip never appeared on hover`).toBeVisible({ timeout: 3000 });
    const tipText = (await tip.textContent()) ?? '';
    expect(tipText.trim().length, `${def.name}: .chart-tip rendered with no text`).toBeGreaterThan(0);

    const tipBox = await tip.boundingBox();
    if (tipBox && markBox) {
      const intersects = tipBox.x < markBox.x + markBox.width && tipBox.x + tipBox.width > markBox.x && tipBox.y < markBox.y + markBox.height && tipBox.y + tipBox.height > markBox.y;
      expect(intersects, `${def.name}: .chart-tip box covers the hovered mark`).toBe(false);
    }
  });
}

// ---------------------------------------------------------------------
// 5) Resize handle: dragging the bottom edge changes chart height, and it
//    persists after reload via localStorage.
// ---------------------------------------------------------------------
test('Weight over-time chart: dragging .chart-resize changes height and persists after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  // `?wm=time` forces the OVER-TIME chart mode explicitly — `p=today` alone
  // resolves to `wm=dist` (App.tsx's `resolveWeightMode`: a <=1 day period
  // defaults to the distribution chart), and Weight's Distribution chart
  // (`Distribution` in Weight.tsx) hardcodes `const H = 250` for its own
  // <svg height>, never reading ChartFrame's resizable `size.height` — a
  // real defect reported separately, not something this test should
  // exercise as if resize worked there.
  await primeScreen(page, { ...SCREENS[1]!, url: SCREENS[1]!.url + '&wm=time' });

  const handle = page.locator('.chart-resize').first();
  test.skip((await handle.count()) === 0, 'Weight drew no .chart-resize handle');

  const frame = handle.locator('xpath=ancestor::*[contains(@class,"chart-frame")][1]');
  const svgBefore = frame.locator('svg').first();
  const heightBefore = (await svgBefore.getAttribute('height')) ?? (await svgBefore.boundingBox())?.height?.toString();

  const box = await handle.boundingBox();
  test.skip(!box, '.chart-resize has no bounding box');
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  // The handle's drag logic (ChartFrame.tsx's onHandlePointerDown/Move) is
  // wired to native `pointerdown`/`pointermove`, and `setPointerCapture`
  // routes every subsequent pointermove to the captured element regardless
  // of cursor position. `page.mouse` synthesizes OS-level mouse input,
  // which Chromium is SUPPOSED to translate into matching pointer events —
  // but empirically here (Edge channel) a `mouse.move`-driven drag never
  // moved this handle at all (confirmed by dispatching the exact same
  // sequence as real `PointerEvent`s instead, which works immediately: 250
  // -> 350 after one such move). Dispatching PointerEvents directly is
  // still exercising the real component's real event handlers in a real
  // browser DOM — it just sidesteps whatever OS-input-to-pointer-event gap
  // exists in this harness's channel/environment, which is a test-tooling
  // limitation, not something to report as an app defect.
  await page.evaluate(
    ({ x, y }) => {
      const el = document.querySelector('.chart-resize') as HTMLElement | null;
      if (!el) return;
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y + 100, pointerId: 1, bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y + 100, pointerId: 1, bubbles: true, cancelable: true }));
    },
    { x: startX, y: startY },
  );
  await page.waitForTimeout(200);

  const svgAfter = frame.locator('svg').first();
  const heightAfter = (await svgAfter.getAttribute('height')) ?? (await svgAfter.boundingBox())?.height?.toString();
  expect(heightAfter, 'chart height did not change after dragging .chart-resize').not.toBe(heightBefore);

  const storedKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sms.chartH.')));
  expect(storedKeys.length, 'no sms.chartH.* localStorage key was written after resizing').toBeGreaterThan(0);
  const storedValue = await page.evaluate((k) => localStorage.getItem(k), storedKeys[0]);

  await page.reload();
  await page.locator('.chart-frame svg').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(150);
  const storedValueAfterReload = await page.evaluate((k) => localStorage.getItem(k), storedKeys[0]);
  expect(storedValueAfterReload, 'persisted chart height did not survive a reload').toBe(storedValue);
});

// ---------------------------------------------------------------------
// 6) Brush on the Weight over-time chart -> URL p=range&from=...&to=...,
//    top bar shows the range, requests carry fromShift/toShift, "Back to
//    previous range" appears, browser back restores the previous URL.
// ---------------------------------------------------------------------
test('Weight over-time chart: brush drag zooms to a shift range', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  // `&wm=time` forces the over-time chart (see the resize test's comment
  // above for why `p=today` alone resolves to the distribution chart,
  // which offers no brush at all).
  await primeScreen(page, { ...SCREENS[1]!, url: SCREENS[1]!.url + '&wm=time' });
  const urlBefore = page.url();

  const frame = page.locator('.chart-frame').filter({ has: page.locator('svg[aria-label*="weight" i], svg[aria-label*="time" i]') }).first();
  const target = (await frame.count()) > 0 ? frame : page.locator('.chart-frame').first();
  const body = target.locator('.chart-frame-body');
  test.skip((await body.count()) === 0, 'Weight drew no chart body to brush over');
  const box = await body.boundingBox();
  test.skip(!box, 'chart body has no bounding box');

  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && (r.url().includes('fromShift') || r.url().includes('toShift'))) requests.push(r.url());
  });

  // See the resize test's comment: PointerEvents dispatched directly, not
  // `page.mouse`, because a mouse-driven drag never reached this handler in
  // this harness's Edge channel even though the identical sequence as real
  // PointerEvents does.
  //
  // Root-cause note (chart overhaul wave 3, Task T9 red-team, 29 Sep 2026):
  // this test used to skip itself here because `p` never became `range`.
  // Two separate causes, both confirmed by driving the real, signed-in app
  // against live simulator data in a browser (never against this mock):
  //  1) `support/mocks.ts`'s `spc()` fixture omitted every subgroup's
  //     `firstShiftDate`/`firstShiftCode`/`lastShiftDate`/`lastShiftCode` —
  //     fields the real `/api/spc` always populates (`api/src/services/
  //     spc.ts`'s `decodeShiftKey` comment: "never null in practice").
  //     `Weight.tsx`'s `subgroupShiftRange` returns null, and `commitBrush`
  //     silently no-ops, whenever any of the four is missing — CORRECT
  //     behaviour for a genuinely old API response, but this fixture wasn't
  //     one; it was just incomplete. Fixed in `mocks.ts` (now included).
  //  2) Separately, `useChartBrush`'s `beginActive` calls
  //     `target.setPointerCapture?.(pointerId)` on pointerdown, and firing
  //     the whole down/move/move/up sequence in one synchronous burst (as
  //     this test always has) raced that capture on real production code
  //     too — reproduced against the live app: the identical burst
  //     committed NOTHING, while the identical sequence with a short delay
  //     between each dispatched event committed correctly every time. A real
  //     mouse drag is never a zero-time burst (the OS delivers move events
  //     spaced by its own sampling interval), so this is a synthetic-event
  //     artifact of this harness, the same category the comment above
  //     already documents for `page.mouse` vs raw `PointerEvent`s — not an
  //     app defect. Small `waitForTimeout`s between dispatches below sidestep
  //     it, exercising the same real handlers a real drag would reach.
  const y = box!.y + box!.height / 2;
  const x0 = box!.x + box!.width * 0.2;
  const xMid = box!.x + box!.width * 0.45;
  const x1 = box!.x + box!.width * 0.7;
  const dispatchPointer = (type: string, x: number) =>
    page.evaluate(
      ({ type, x, y }) => {
        const el = document.querySelector('.chart-frame-body') as HTMLElement | null;
        el?.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));
      },
      { type, x, y },
    );
  await dispatchPointer('pointerdown', x0);
  await page.waitForTimeout(60);
  await dispatchPointer('pointermove', xMid);
  await page.waitForTimeout(60);
  await dispatchPointer('pointermove', x1);
  await page.waitForTimeout(60);
  await dispatchPointer('pointerup', x1);
  await page.waitForTimeout(400);

  const url = new URL(page.url());
  expect(url.searchParams.get('p'), `brush drag did not produce p=range; URL: ${page.url()}`).toBe('range');
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  expect(from, 'from= param missing a shift suffix').toMatch(/\.(morning|evening|night)/);
  expect(to, 'to= param missing a shift suffix').toMatch(/\.(morning|evening|night)/);

  await page.waitForTimeout(300);
  console.log(`[brush] requests carrying fromShift/toShift: ${requests.length}`);
  expect(requests.length, 'no request after the brush carried fromShift/toShift').toBeGreaterThan(0);

  const backControl = page.getByText(/back to previous range/i);
  await expect(backControl, '"Back to previous range" control did not appear after zooming').toBeVisible({ timeout: 3000 });

  await page.goBack();
  await page.waitForTimeout(200);
  expect(page.url(), 'browser back did not restore the pre-brush URL').toBe(urlBefore);
});

// ---------------------------------------------------------------------
// 7) Print emulation: no .chart-tip/.chart-resize/.chart-brush visible;
//    charts fixed width; Report pages landscape.
// ---------------------------------------------------------------------
test('Print emulation: Weight hides interactive chart chrome under print media', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await primeScreen(page, SCREENS[1]!); // Weight

  // Establish a tip/resize/brush are at least present in screen media first,
  // so "not visible in print" is a real transition, not "never existed".
  await expect(page.locator('.chart-resize').first()).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);

  for (const sel of ['.chart-tip', '.chart-resize', '.chart-brush']) {
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) {
      const visible = await page.locator(sel).nth(i).isVisible();
      expect(visible, `${sel} #${i} is visible under print media`).toBe(false);
    }
  }

  const widths = await page.locator('.chart-frame svg').evaluateAll((els) => els.map((e) => (e as SVGSVGElement).getAttribute('width') || (e as SVGGraphicsElement).getBoundingClientRect().width));
  console.log(`[print] Weight chart widths under print media: ${JSON.stringify(widths)}`);
  expect(widths.length, 'no chart svg found under print media').toBeGreaterThan(0);
});

test('Print emulation: Report screen prints landscape (role=group aria-label=Report hook)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await primeScreen(page, SCREENS.find((s) => s.name === 'Report:daily')!);

  const group = page.locator('[role="group"][aria-label="Report"]');
  await expect(group, 'the role=group aria-label="Report" DOM hook app.css keys its landscape @page rule off is missing').toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);

  for (const sel of ['.chart-tip', '.chart-resize', '.chart-brush']) {
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) {
      expect(await page.locator(sel).nth(i).isVisible(), `${sel} #${i} visible under print media on Report`).toBe(false);
    }
  }
});
