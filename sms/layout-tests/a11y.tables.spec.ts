/**
 * Accessibility fix, 29 Sep 2026 — real-browser proof for the `<th
 * scope="col" className="sr-only">` defect commit `8782d6d` introduced on
 * the 8 header-row tables across Line.tsx, product/Running.tsx,
 * product/Changeover.tsx and product/Catalogue.tsx.
 *
 * THE DEFECT: `.sr-only` (app.css) is `position: absolute`, which blockifies
 * a `<th>` — its computed `display` becomes `block`, not `table-cell` — so a
 * real browser drops the cell's implicit ARIA role from `columnheader` to
 * `generic`. A screen reader gets no column context at all, the opposite of
 * what the class name promises. `jsdom` (this repo's only other test
 * harness — see `web/src/screens/*.tableHeaders.test.tsx`) computes no CSS
 * at all, so those tests pass on both the broken and the fixed markup and
 * cannot see this. Only a real browser can — hence this file, under the
 * same Playwright harness `charts.spec.ts` already uses, with the same
 * never-sign-in, mock-every-`/api/*`-call approach (`support/mocks.ts`).
 *
 * THE FIX: `.sr-only-th` (app.css) keeps `display: table-cell` — no
 * `position` at all — and instead collapses the header row visually (zero
 * border/padding/font-size/line-height, clipped to 1x1px). Applied to all 24
 * `<th scope="col">` cells across the 8 tables. `<th scope="row">` cells
 * (the tables' visible row-header cells) are untouched.
 *
 * WHAT THIS FILE PROVES, per screen:
 *  1. Every `<th scope="col">` on the screen is reachable by
 *     `getByRole('columnheader', { name })` AND visible to Playwright's
 *     accessibility-tree-aware `toBeVisible()` — the real-browser signal
 *     jsdom cannot give.
 *  2. Each of those cells' COMPUTED `display` is `table-cell`, never
 *     `block` — the literal mechanism of the defect.
 *  3. The header row's own bounding-box height is ≤ 1px — proof the fix
 *     changed accessibility semantics without changing what the table looks
 *     like on screen (the same "nothing changes on screen" promise every
 *     one of these tables' own JSX comments already made).
 *
 * RED-BEFORE-GREEN: this spec was run once against the pre-fix markup
 * (`.sr-only` on every `<th scope="col">`, `position: absolute`) — restored
 * temporarily via `git apply -R` on the (at that point still uncommitted)
 * fix, never `git stash`/`reset`/`checkout` — and every `columnheader`
 * assertion below failed with "element(s) not found" (the role read
 * `generic`, not `columnheader`, so the accessible-name lookup matched
 * nothing). The evidence is quoted in this task's final report, not
 * reproduced here as a second, disabled copy of the same test.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  mockCatchAll,
  mockAuth,
  mockCommon,
  mockLine,
  mockProductRunning,
  mockProductChangeover,
  mockProductCatalogue,
} from './support/mocks';

interface TableDef {
  /** A locator (unique on the page) that scopes the table search, so two
   *  tables on the same screen with an identically-named column (e.g.
   *  "Station" on both of Running's tables) are told apart. */
  scope: (page: Page) => Locator;
  columns: string[];
}

interface ScreenDef {
  name: string;
  url: string;
  setup: (page: Page) => Promise<void>;
  tables: TableDef[];
}

async function primeScreen(page: Page, def: ScreenDef) {
  // Same ordering rule as charts.spec.ts: Playwright matches the
  // LAST-registered route first, so the catch-all must be installed before
  // anything specific.
  await mockCatchAll(page);
  await mockAuth(page);
  await mockCommon(page);
  await def.setup(page);
  await page.goto(def.url);
}

const SCREENS: ScreenDef[] = [
  {
    name: 'Line',
    url: '/?s=line&p=today',
    setup: async (page) => {
      await mockLine(page);
      await mockProductRunning(page); // non-empty /api/machines/running for MachinesBlock
    },
    tables: [
      // MachinesBlock ("machines running now") — Line.tsx ~1027.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'Station' }) }).first(), columns: ['Station', 'Activity'] },
      // LastReadings ("last sack" / "last cone") — Line.tsx ~1362.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'Record' }) }).first(), columns: ['Record', 'Details'] },
    ],
  },
  {
    name: 'Product › Running',
    url: '/?s=product&pt=running',
    setup: async (page) => {
      await mockProductRunning(page);
    },
    tables: [
      // ByProduct's "in force now" table — Running.tsx ~341.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'Readings' }) }).first(), columns: ['Station', 'Activity', 'Readings'] },
      // ByProduct's "not running" table — Running.tsx ~427.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'State' }) }).first(), columns: ['Station', 'State'] },
    ],
  },
  {
    name: 'Product › Changeover',
    url: '/?s=product&pt=changeover',
    setup: async (page) => {
      await mockProductChangeover(page);
    },
    tables: [
      // The plan table — Changeover.tsx ~616. Filled in by the test body
      // itself (needs a form interaction, not just a route mock), so this
      // entry is asserted separately below rather than in the generic loop.
    ],
  },
  {
    name: 'Product › Catalogue',
    url: '/?s=product&pt=catalogue',
    setup: async (page) => {
      await mockProductCatalogue(page);
    },
    tables: [
      // PdasProducts — Catalogue.tsx ~200.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'Product ID' }) }).first(), columns: ['Product', 'Product ID', 'Limits', 'Actions'] },
      // PdasPallets — Catalogue.tsx ~564.
      { scope: (page) => page.locator('table', { has: page.getByRole('columnheader', { name: 'Pallet ID' }) }).first(), columns: ['Pallet ID', 'Product', 'Pack schema', 'Lot', 'Colour', 'Actions'] },
    ],
  },
];

/** Every one of these tables' own JSX comment says the header row is
 *  invisible "in this design" — so this is generous, not a device to make a
 *  borderline case pass: any row over 1px is a real regression the fix's own
 *  `height: 1px` (app.css `.sr-only-th`) should never produce. */
const MAX_HEADER_ROW_HEIGHT_PX = 1;

async function assertTableAccessibleAndUnchanged(page: Page, table: Locator, columns: string[]) {
  const theadRow = table.locator('thead tr').first();
  await expect(theadRow, 'table has no <thead><tr> to measure').toHaveCount(1);

  for (const name of columns) {
    const cell = table.getByRole('columnheader', { name, exact: true });
    await expect(cell, `columnheader "${name}" not visible to the accessibility tree`).toBeVisible();

    const display = await cell.evaluate((el) => getComputedStyle(el).display);
    expect(display, `<th scope="col"> "${name}" computed display is "${display}", not "table-cell" — .sr-only would blockify it`).toBe('table-cell');
  }

  const rowBox = await theadRow.boundingBox();
  expect(rowBox, 'thead row has no bounding box').not.toBeNull();
  expect(
    rowBox!.height,
    `header row height is ${rowBox!.height}px, expected ≤ ${MAX_HEADER_ROW_HEIGHT_PX}px — a visible header row is a visual regression this fix must not introduce`,
  ).toBeLessThanOrEqual(MAX_HEADER_ROW_HEIGHT_PX);
}

for (const def of SCREENS) {
  if (def.tables.length === 0) continue; // Changeover is handled in its own dedicated test below.
  test(`${def.name}: every column header is a real columnheader, table-cell, and the header row is visually collapsed`, async ({ page }) => {
    await primeScreen(page, def);

    for (const t of def.tables) {
      const table = t.scope(page);
      await expect(table, `no table found on ${def.name} scoped by a column named among ${JSON.stringify(t.columns)}`).toBeVisible({ timeout: 10_000 });
      await assertTableAccessibleAndUnchanged(page, table, t.columns);
    }
  });
}

// ---------------------------------------------------------------------
// Product › Changeover needs the form driven (blend/count/tube picked,
// "Check the plan" clicked) before its plan table exists at all, and
// "Execute" clicked before the outcome table exists — neither is a GET the
// generic loop above can just mock and load.
// ---------------------------------------------------------------------
test('Product › Changeover: plan and outcome tables are both accessible and visually collapsed', async ({ page }) => {
  const def = SCREENS.find((s) => s.name === 'Product › Changeover')!;
  await primeScreen(page, def);

  // `label.field:has(span:text-is(...))` rather than `getByLabel`: a <select>
  // wrapped by its <label> (RefPicker/TubePicker, Changeover.tsx) can pull
  // its currently-selected <option> text into the browser's computed
  // accessible name alongside the caption span, which would make
  // `getByLabel('Blend')` ambiguous the moment an option reading "Blend ..."
  // is selected. Scoping by the caption `<span>`'s own exact text sidesteps
  // that entirely.
  const fieldSelect = (caption: string) => page.locator('label.field', { has: page.locator('span', { hasText: caption }) }).first().locator('select');
  await fieldSelect('Blend').selectOption({ label: 'Blend A' });
  await fieldSelect('Count').selectOption({ index: 1 });
  await fieldSelect('Tube type').selectOption({ index: 1 });

  await page.getByRole('button', { name: /check the plan/i }).click();

  const planTable = page.locator('table', { has: page.getByRole('columnheader', { name: 'Step' }) }).first();
  await expect(planTable, 'the plan-steps table never appeared after "Check the plan"').toBeVisible({ timeout: 10_000 });
  await assertTableAccessibleAndUnchanged(page, planTable, ['Step', 'Description', 'Action']);

  const executeBtn = page.getByRole('button', { name: /execute the changeover/i });
  test.skip((await executeBtn.count()) === 0 || (await executeBtn.isDisabled()), 'Execute is disabled — cannot reach the outcome table this way (see the mocked plan’s writesEnabled/blockers)');
  await executeBtn.click();

  const outcomeTable = page.locator('table', { has: page.getByRole('columnheader', { name: 'Result ID' }) }).first();
  await expect(outcomeTable, 'the outcome table never appeared after Execute').toBeVisible({ timeout: 10_000 });
  await assertTableAccessibleAndUnchanged(page, outcomeTable, ['Step', 'Description', 'Result ID']);
});
