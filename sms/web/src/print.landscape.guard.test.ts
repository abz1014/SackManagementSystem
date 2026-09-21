/**
 * Guard against a silent print regression introduced by UX Phase 9 Brief D
 * (`08398b9`): reports print landscape (`page: report-landscape`, `@page
 * report-landscape { size: A4 landscape }` in `app.css`) via a Report-only
 * DOM hook, because `@page` is a document-level at-rule that cannot be
 * scoped by a normal selector. The hook is
 *
 *   main:has([role="group"][aria-label="Report"]) { page: report-landscape; }
 *
 * and that literal `aria-label` value is not a coincidence of app.css's own
 * choosing — it is rendered by `Report.tsx` from `W.reports.selectorLabel`
 * (`web/src/lib/words.ts`). Edit that one string — say, for the Urdu pass
 * §11 already anticipates, or a future copy tidy-up — and app.css's selector
 * stops matching. Nothing errors: `:has()` silently matches nothing, `page:
 * report-landscape` is silently never applied, and reports silently print
 * portrait again, with the wide tables clipped on the right the way Phase 9
 * exists to prevent. No test currently reads both sides of this coupling.
 *
 * Deliberately dumb, in targets.guard.test.ts's and reliability.guard.test.ts's
 * own idiom: reads app.css, words.ts and Report.tsx straight off disk with
 * node:fs and greps/regexes them — no imports of the real modules, no DOM
 * (vitest.config.ts's `environment: 'node'`). This file does not hardcode a
 * copy of the string on either side; a hardcoded copy would drift out of
 * sync with app.css or words.ts in exactly the way this guard exists to
 * prevent, and would still pass if BOTH real sites drifted together away
 * from the hardcoded value. Instead it resolves the real value from each
 * source file and asserts the two agree.
 *
 * This is a NEW file, not an addition to targets.guard.test.ts: that file's
 * own header says it deliberately scans identifiers naming the CURRENT
 * PRODUCT / fallback-target defect (U1) and instructs not to put a
 * current-product or fallback-target identifier in a new guard sharing that
 * scan — this guard's subject (a print CSS selector keyed to a UI label) is
 * unrelated to that scan and does not belong inside it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_SRC = fileURLToPath(new URL('.', import.meta.url));
const APP_CSS = `${WEB_SRC}app.css`;
const WORDS_TS = `${WEB_SRC}lib/words.ts`;
const REPORT_TSX = `${WEB_SRC}screens/Report.tsx`;

/** The exact selector app.css keys the landscape page assignment off, capturing its aria-label value. */
const CSS_SELECTOR_RE = /main:has\(\[role="group"\]\[aria-label="([^"]+)"\]\)\s*\{\s*page:\s*report-landscape;\s*\}/;

/** `@page report-landscape { size: A4 landscape ... }` — the named page itself must still exist alongside the selector. */
const NAMED_PAGE_RE = /@page\s+report-landscape\s*\{[^}]*size:\s*A4\s+landscape/;

/** `reports: { selectorLabel: '<value>',` inside words.ts — the one place W.reports.selectorLabel is defined. */
const WORDS_SELECTOR_LABEL_RE = /reports:\s*\{\s*selectorLabel:\s*'([^']*)'/;

/** Report.tsx must actually wire that DOM hook to W.reports.selectorLabel, not to some other string or a literal. */
const REPORT_TSX_WIRING_RE = /role="group"\s+aria-label=\{W\.reports\.selectorLabel\}/;

describe('the print-landscape CSS hook and the Report aria-label it keys off stay in agreement', () => {
  const cssSrc = readFileSync(APP_CSS, 'utf8');
  const wordsSrc = readFileSync(WORDS_TS, 'utf8');
  const reportSrc = readFileSync(REPORT_TSX, 'utf8');

  it('sanity: app.css still has the named report-landscape page (canary on the scan itself)', () => {
    expect(NAMED_PAGE_RE.test(cssSrc), 'the @page report-landscape rule is missing from app.css entirely').toBe(true);
  });

  it('sanity: Report.tsx still wires its selector-row aria-label to W.reports.selectorLabel (canary on the scan itself)', () => {
    expect(
      REPORT_TSX_WIRING_RE.test(reportSrc),
      'Report.tsx no longer renders role="group" aria-label={W.reports.selectorLabel} — the CSS hook this guard checks has nothing to key off',
    ).toBe(true);
  });

  it("app.css's main:has([role=\"group\"][aria-label=\"...\"]) selector matches words.ts's actual W.reports.selectorLabel value", () => {
    const cssMatch = CSS_SELECTOR_RE.exec(cssSrc);
    expect(cssMatch, 'app.css no longer has a main:has([role="group"][aria-label="..."]) { page: report-landscape; } rule at all').toBeTruthy();
    const cssLabel = cssMatch![1];

    const wordsMatch = WORDS_SELECTOR_LABEL_RE.exec(wordsSrc);
    expect(wordsMatch, 'words.ts no longer has a reports: { selectorLabel: \'...\' } definition').toBeTruthy();
    const wordsLabel = wordsMatch![1];

    expect(
      cssLabel,
      `app.css's print selector is keyed to aria-label="${cssLabel}", but W.reports.selectorLabel in words.ts is now ` +
        `'${wordsLabel}'. Report.tsx renders that live value onto the DOM (aria-label={W.reports.selectorLabel}), so ` +
        `app.css's hardcoded selector string silently stops matching, main:has(...) matches nothing, "page: ` +
        `report-landscape" is never applied, and reports print portrait again with the wide tables clipped on the ` +
        'right — no error, no failing screen, discovered only by whoever is holding the paper at IFL. Update the ' +
        "selector in app.css's [PHASE 9 PRINT P6] rule to match words.ts's new value.",
    ).toBe(wordsLabel);
  });
});
