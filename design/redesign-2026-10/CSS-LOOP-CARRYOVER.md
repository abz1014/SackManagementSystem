# CSS loop carry-over into the redesign (web-next)

Date: 13 Oct 2026. Read-only mapping; no code, database, or server was touched, and nothing was measured in a browser. Every "built-in" below is a reading of source (file cited), not a measurement. Sources: `DEFECTS.md` Part 16 (CSS-001..CSS-080, D-235..D-299) and Part 17 (D-306..D-309); `sms/layout-tests/`; `TRACE.md` (B4-07, B4-08, G-27, G-37, E-8, E-11); `DESIGN-SYSTEM.md`; `sms/web-next/src`.

## How web-next relates to the old app (what decides most statuses)

- **Charts: the old chart base is reused through `bridge/chart.ts`** (`ChartFrame`, `leftGutterFor`, `bandHit`, `fittingTicks`, `useChartSize` from `sms/web/src/ui/`). So the zoom "Back" control, tooltip blur-clear, resize handle and y-gutter sizing carry for free. The kit's own `Axes.tsx` / `BarChart` / `LineChart` / `Pareto` / `Histogram` re-implement ticks and x labels (no `dropCollidingTicks`, no `categoryLabelAnchor`), so tick and label items need a measurement.
- **Reports: the 18 report bodies are the old renderers** (`bridge/report.ts`) styled by `screens/Reports/legacy-report.css` (a generated subset of old `app.css`, scoped under `.rp-doc`) plus `reports.css` and `print.css`. Report-table fixes carry only where that subset kept the rule (checked below).
- **Everything else is new**: sidebar + frosted top bar + phone tab bar (`ui/components/shell.css`), `ui/DataTable.tsx` (own scroll cue and card list under 768), `ui/Sheet.tsx` (body is the scroller, head is outside it), `ui/Segmented`, `ui/Chip`, `Skeleton`, and the Today / Quality / Products / System screens. Fixes tied to the old top bar, Line, `.tw` tables and `sr-only-th` do not carry by code and need an equivalent check.
- **Gaps already visible in source** (readings of code, not measurements):
  (a) `ui/Sheet.tsx` `FOCUSABLE` has no `summary`, and `ui/Disclosure.tsx` is a `<details><summary>` (CSS-074 regression risk, M-21);
  (b) `ui/TopBar.tsx` Escape closes the user menu but does not return focus to the trigger (CSS-039, M-02);
  (c) the user menu has only Account and Sign out, so the Desk/Wall text-size control (CSS-063) has no visible home; `ui/uiScale.ts` reads the saved key but no shell control writes it (M-02);
  (d) no `canGoBack` / Back-from-zoom control exists in `TopBar.tsx` or `App.tsx` (TRACE E-8 says keep both); only the chart-adjacent button from the reused `ChartFrame` exists (M-23);
  (e) the IFL table header fill is `--seq-2` (#bccaf8), not the literal `#ADD8E6` that the CSS-036 owner decision named (`reports.css:115`, `legacy-report.css:154`); needs owner confirmation (M-14).

Status key: **built-in** (source shows the fix or a structural equivalent; file cited) · **must-check** (measure; see M-list) · **not-applicable** (screen or cause gone, or record-only) · **owner-decision-carries** (decision honoured as stated; how).

## Table 1: all 80 CSS items

| ID | Defect / decision (one line) | Old fix | Status in web-next |
|---|---|---|---|
| CSS-001 | Wrapped top-nav links painted under the period strip, unclickable (375-900) | `.nav { height:auto }` (D-235) | **must-check** M-01: nav is now sidebar + phone tab bar (5 fixed items); verify every nav target is hit-testable at 375/600/820/900 |
| CSS-002 | User menu opened up to 107 px off the left edge, Sign out cut | `margin-left:auto` on `.bar-right` (D-237) | **must-check** M-02: `.sh-popover` is `right:0`, min 240 px; left edge >= 0 at 320/375/600 and scale 1.3 |
| CSS-003 | Sacks by-product bars 1 px wide at <=600; labels past chart edge | label gutter = min(label, 55 % chart), ellipsis (D-279) | **must-check** M-03: `charts/BarChart.tsx` uses `leftGutterFor(..., 44, 0)`; long product names at 320-600 must leave a bar >= 40 px |
| CSS-004 | Calibration table: ten % columns narrower than numbers, text overprint | `table-layout:auto` below 860 (D-238) | **built-in** report side: `legacy-report.css` keeps `.calib-tbl`; Quality > Stations uses `DataTable` (`white-space:nowrap`, scroll, auto layout, `DataTable.css`). Residual 5 px header overprint at scale 1.3: M-04 |
| CSS-005 | Print: deviation chart y label "+10.0 g" started outside page, read "-10.0 g" | print `.page` left padding 8 px (D-239) | **must-check** M-05: `print.css` has no equivalent padding; label left edge >= 0 in print |
| CSS-006 | Print: station report footnote across a page break overprinted (`columns:1`) | `columns:auto` (D-240) | **must-check** M-05: `columns:1` is absent from `print.css` and `legacy-report.css` (built-in by omission); confirm 0 overlapping word pairs in the PDF |
| CSS-007 | Long toggle and clipped sr-only spans made the phone page scroll sideways | `.chart-resize z-index:1`, row rules (D-287) | **must-check** M-06: `Segmented`, `TabBar`, `Tabs` on every screen at 320/375; `.chart-resize` has `z-index:1` (`chart.css`), built-in for the handle |
| CSS-008 | Rejects by-day table made the whole page scroll sideways | wrapped in `.tw` (D-246) | **built-in** `HeatMatrix.tsx`: own `qr-heat__scroll` region (`tabIndex 0`, `role region`); residual page overflow checked in M-06 |
| CSS-009 | Product limits grid pushed the page sideways on narrow screens | `minmax(0,1fr)` (D-243) | **must-check** M-07: Products > Limits at 375/500/621 (`limits.css` has `minmax(0` but the screen is new) |
| CSS-010 | Changeover Retire checkbox above its label's first line (320-521) | checkbox `margin-top` calc (D-284) | **must-check** M-08: Changeover retire lists (`ChangeoverScreen.tsx:302,311`) at 320-521 and 600+ |
| CSS-011 | Daily/sack report scrolled the whole page sideways on phones | `.two-col` `minmax(0,1fr)` at <=1100 (D-285) | **built-in** `legacy-report.css:175` |
| CSS-012 | Report headline squeezed beside Print/Export (621-900) | head row stacks at <=900 (D-292) | **must-check** M-09: Reports viewer head (new, `reports.css`, `ReportsScreen.tsx`) at 650/768/900; no `.head-actions` in legacy CSS |
| CSS-013 | IFL table headings 3.86:1 on #ADD8E6 | `th` colour `--ink` (D-252) | **built-in** `reports.css:115`, `legacy-report.css:417`: `--ink-1` on `--seq-2` (high by token math; measured in M-14) |
| CSS-014 | (intended) row chevron `--grid` grey 3.14:1 | none | **built-in** `DataTable.css .ui-dt__chev-col` uses `--ink-3` (5.77:1 on surface); decision moot |
| CSS-015 | Quiet station tile name+count 3.14:1 | **owner B**: `--muted` (D-295) | **owner-decision-carries** M-10: Today `StationTile` quiet state must use the normal secondary ink (`--ink-3`, 5.77:1); keep the dashed edge and the "quiet" word as the cue; measure >= 4.5:1 |
| CSS-016 | (S4, not fixed) station button name "East Conveyor" cut | none | **not-applicable** Line station button gone; tile-name truncation covered by M-10 |
| CSS-017 | Health Data batches table wider than its box, identifier split | table fits box (D-264) | **must-check** M-11: Diagnostics batches (`DiagnosticsScreen.tsx`) at 1366/1100/1920, scales 1 and 1.3 |
| CSS-018 | IFL tables wider than the 816 px report column behind an unmarked overflow | full-width IFL roots (D-291) | **built-in** `legacy-report.css:166-169`; fit measured in M-12 |
| CSS-019 | Matrix scrolls sideways, nothing says machines lie past the edge | **owner A**: `MatrixScrollCue` (D-297) | **owner-decision-carries**: reused `MachineProduct.tsx` keeps `MatrixScrollCue`; M-13: it renders inside `.rp-doc` and is legible (no cue class is styled in the new CSS) |
| CSS-020 | (owner A, no change) resize handle stays 10 px | none | **owner-decision-carries** `chart.css .chart-resize {height:10px}` unchanged; keep (arrow keys also resize) |
| CSS-021 | Line "row median" caption overlapped station tiles (320-460) | closed by CSS-069 (D-278) | **not-applicable** Line gone; Today heat grid covered by M-10 |
| CSS-022 | First figure row taller than its skeleton: 46-130 px jump on load | `.skel-figs-tall` (D-294) | **must-check** M-15: Today KPI row, Weight, Rejects, Register figures; `Skeleton.css`, `.band-skel` |
| CSS-023 | Reason sheet rows about 147 px tall | closed by CSS-051 (D-245) | **must-check** M-16 (with CSS-051) |
| CSS-024 | Reject reason names squeezed to 65 px (<=620) | two tracks `1fr auto` (D-277) | **must-check** M-17: Rejects reason list / Pareto labels at 500/620 |
| CSS-025 | Four Changeover inputs untyped, 21 px tall | `type="text"` (D-247) | **built-in** `ChangeoverScreen.tsx:204` `type="text"` with `wr-input` |
| CSS-026 | Row header sat 9 px above its row text; stray last-row rule | `tbody th` padding (D-274) | **built-in** `DataTable` has no `tbody th`; rows are `td` at 44 px (`DataTable.css`) |
| CSS-027 | (latent) Wall footer wraps at 1920 | none | **not-applicable** latent; Wall rebuilt, footer fit covered by M-24 |
| CSS-028 | Health link past right edge at 901-945 (Wall size) | `.nav` `flex-wrap` (D-236) | **must-check** M-01 (shell at Wall scale) |
| CSS-029 | Report reject trend labelled only 1-4 % gridlines 13.8 px apart | tick steps >= 20 px (D-256) | **built-in** `Axes.tsx` `gridValues(domain, 3)` caps y ticks at about 3-5; spacing confirmed in M-18 |
| CSS-030 | (owner A, no change) printed blocks stay whole | none | **owner-decision-carries**: do not add `break-inside:auto`; page count per type recorded in M-05 |
| CSS-031 | Multi-page printout had no "Page X of Y" | footer in first `@page` (D-276) | **built-in** Reports: `print.css` `@page report-landscape/portrait` with `counter(page)`; Register print uses the reused `RegisterPrintHead`; Register portrait pages in M-19 |
| CSS-032 | First/last category label hung off the bar (calibration chart) | `categoryLabelAnchor` (D-254) | **must-check** M-18: `XLabels` is `text-anchor:middle` (centred) but the last label may exceed the 12 px right margin |
| CSS-033 | Dates split mid-value in IFL table columns | date cells nowrap (D-309) | **must-check** M-12: no nowrap date rule found in `legacy-report.css`; count split date cells at 768/1366 |
| CSS-034 | Printed Rejects page carried "Name it" buttons and link controls | `.no-print` (D-257) | **must-check** M-19: print Register and any printable screen; `Frame.tsx` toggle is `no-print`, `NameIt.tsx` sits in a sheet |
| CSS-035 | IFL cell text 0.5 px from gridlines | 6 px each side (D-286) | **built-in** `legacy-report.css:415-416` |
| CSS-036 | Matrix header plain white | **owner B**: IFL light blue; chevron `--graphite` (D-296, D-308) | **owner-decision-carries**: `legacy-report.css:154,159` blue header + graphite chevron, but the fill is `--seq-2`, not `#ADD8E6`; M-14 chevron >= 4.5:1; ask the owner whether seq-2 satisfies "IFL light blue" |
| CSS-037 | (owner A, no change) 860 px switch-over at 180 px label column | none | **owner-decision-carries**: no breakpoint change; `legacy-report.css:63` keeps the 180 px label column in reports; measured in M-12 at 861-925 |
| CSS-038 | Pinned chart tooltip stayed after Tab moved on | `onBlur` clears (D-255) | **built-in** reused `ChartFrame`; kit charts confirmed in M-23 |
| CSS-039 | Escape in the user menu dropped focus to body | Escape focuses trigger (D-248) | **must-check** M-02: `TopBar.tsx:31` only calls `setOpen(false)`; likely gap |
| CSS-040 | Matrix header focus ring clipped | ring 2 px inside (D-275) | **built-in** `legacy-report.css:160` |
| CSS-041 | Comment claimed wrong `--muted` contrast | comment fix | **not-applicable** comment; token contrasts are recomputed in `DESIGN-SYSTEM.md` section 3 (80 pairs) |
| CSS-042 | Print comment about `footerTemplate` wrong | comment fix | **not-applicable** comment; `print.css` states the `@page` margin-box footer |
| CSS-043 | Comment on machine-product column count wrong | comment fix | **not-applicable** comment |
| CSS-044 | (S4) top bar 196 px tall at 768-1061 | none | **not-applicable** old top bar gone |
| CSS-045 | (refuted) Shift select clip | none | **not-applicable** refuted |
| CSS-046 | (refuted) Rejects tab order | none | **not-applicable** refuted |
| CSS-047 | `sr-only-th` skewed column widths | `width:auto` (D-271) | **built-in** `legacy-report.css:23`; new `DataTable` uses visible `th` |
| CSS-048 | Clickable KPI figures 23 px lower than static | `.fig-link` flex column (D-281) | **built-in** report side `legacy-report.css:110`; Today `KpiCard` linked vs static in M-20 |
| CSS-049 | Weight mixed-target sentence overprinted sparkline/Rejects/status cells | cell `n wrap` (D-249) | **must-check** M-22: Quality > Stations (`StationsTable.tsx`), a station with several materials; `DataTable td` is `nowrap` so a sentence would stretch the row (S3 X-1) |
| CSS-050 | Rejects trend end label ran past chart edge | gutter + tick drop (D-290) | **must-check** M-18: `LineChart` right margin 12 px with a direct end label |
| CSS-051 | Reason sheet six-column table wider than the sheet | four columns (D-244) | **must-check** M-16: `ReasonSheet.tsx` overflow 0 at 375/1366, scale 1.3 |
| CSS-052 | Station sheet explanation column 174 px | inline widths removed (D-260) | **must-check** M-16: `StationSheet.tsx` flagged-days table |
| CSS-053 | After click-zoom the only Back was in the top bar | **owner B**: "Zoomed in - Back" by the chart (D-299, D-306) | **owner-decision-carries**: the chart-adjacent control comes with the reused `ChartFrame`; the top-bar Back is absent (G-27/E-8 say keep both); M-23 on every kit chart |
| CSS-054 | (latent) Change-password inputs at 320 Wall | none | **not-applicable** latent (Account screen is new) |
| CSS-055 | (refuted) Changeover plan table | none | **not-applicable** refuted |
| CSS-056 | Zeroed-clock row 299 px tall | date nowrap, Why min-width (D-263) | **must-check** M-12: not in `legacy-report.css`; unknown-lifter report |
| CSS-057 | (refuted) print "13 rows" caption | none | **not-applicable** refuted |
| CSS-058 | Toggle focus ring clipped by `overflow:hidden` | ring inside (D-253) | **built-in** `Segmented.css` has no `overflow:hidden`; ring `outline-offset:1px` |
| CSS-059 | Forced colours: selected toggle/chip/period looked unselected | `forced-colors` rule (D-283) | **must-check** M-25: only shell nav, chart band and legacy period are covered (`shell.css:74`, `chart.css:77`, `legacy-report.css:189`); `Segmented`, `Tabs`, `TabBar`, `PeriodChip`, `Chip` are not |
| CSS-060 | Sheet Close scrolled away; later the head hid focus | sticky head, `scroll-padding-top` (D-293, D-307) | **built-in** `Sheet.tsx` / `Sheet.css`: the head is a flex sibling outside the scrolling `.ui-sheet__body`, so Close never scrolls away and focus cannot sit under it; Shift+Tab confirmed in M-21 |
| CSS-061 | (owner A, no change) 21-22.5 px selects/links | none | **owner-decision-carries**: superseded by tokens (`--control-h`, `--tap-min`, `ui-chip` 24 px); M-26 looks for any box under 24 px |
| CSS-062 | Focused clickable row ring clipped by `.tw` | `outline-offset:-2px` (D-282) | **built-in** `DataTable.css .ui-dt__row:focus-visible` offset -2; `register.css` has focus-visible |
| CSS-063 | Text-size row wrapped in the 232 px user menu | label no-wrap (D-265) | **must-check** M-02: the menu has no text-size row; owner call where the Desk/Wall control lives (TRACE A3-008) |
| CSS-064 | Sacks stock ledger Day cell wrapped (33 of 34 rows) | `tw-span` (D-261) | **must-check** M-27: `StockLedger.tsx` Day cells at 1366/1920, scale 1.3 |
| CSS-065 | Ledger kg mode 8 px wider than its box at 768 | fit (D-266) | **must-check** M-27 at 768 |
| CSS-066 | Readings listing rows wrapped to two lines at 600-860 | widths from 861 only (D-258) | **built-in** `DataTable` becomes a card list under 768; 768-860 and 375 in M-28 |
| CSS-067 | DQ findings rows tall (median 244 px) | `overflow-wrap:anywhere` (D-262) | **must-check** M-11: `DqFindings.tsx`; `system.css` has `overflow-wrap` |
| CSS-068 | Station table printed columns over each other (phone, Wall) | `table-layout:auto` (D-250) | **built-in** `DataTable.css` auto layout + scroll; 320/Wall in M-22 |
| CSS-069 | Chart legend hung out of the frame over table headers (<=730) | legend footer (D-273) | **built-in** `charts/Frame.tsx`: legend is above the plot in normal flow (`ck-legend` `flex-wrap`) |
| CSS-070 | Adjacent x-axis date labels overprinted/collided | `dropCollidingTicks` (D-289) | **must-check** M-18: `XLabels` thins by an estimated width (`every` rule); measure at 320, 353, 375@1.3 |
| CSS-071 | Weight upper-limit label ran past the chart edge | short form when it does not fit (D-241) | **must-check** M-29: `LimitBand.tsx` label at 320-620 |
| CSS-072 | (latent) reject-sheet provenance list overflow | none | **not-applicable** latent |
| CSS-073 | Wide tables on phones showed no sign that columns lay past the edge | **owner A**: edge fade (D-298) | **owner-decision-carries**: `DataTable` has `ui-dt__fade` + "scroll for more" caption at all widths (`DataTable.tsx:77-213`); legacy report `.tw` tables have no fade; M-12 |
| CSS-074 | Sheet focus trap skipped `summary` | add `summary` (D-242) | **must-check** M-21 HIGH: `Sheet.tsx` `FOCUSABLE` lacks `summary`; `Disclosure.tsx` is `<details><summary>`; fix is one selector |
| CSS-075 | Print/Export buttons touched the verdict box | `margin-bottom:10px` (D-280) | **must-check** M-09 |
| CSS-076 | Weight sparkline ran past its cell | closed by CSS-068 (D-251) | **must-check** M-22 (`charts/Sparkline.tsx` in `StationsTable`) |
| CSS-077 | Y-axis tick labels cut by the left edge | `leftGutterFor` (D-272) | **built-in** all four kit charts call `leftGutterFor` (`BarChart`, `Histogram`, `LineChart`, `Pareto`) |
| CSS-078 | History Outcome column squeezed beside a fixed When | width removed (D-259) | **must-check** M-30: Products > Limits & History (`LimitsScreen.tsx`) at 375/768/1366 |
| CSS-079 | Long filter chip ran its select off the right edge | row rule narrowed (D-288) | **must-check** M-26: filter `Chip` with a long product name at 375 |
| CSS-080 | Focus on the chip clear button invisible on an ink chip | focus ring colour (D-267) | **built-in** `Chip.css .ui-chip__x:focus-visible` blue ring on a tinted chip; pixel change confirmed in M-26 |

Owner decisions of 6 Oct 2026 are CSS-015/019/036/053/073 (fixed, carried) and CSS-020/030/037/061 (no change, honoured). Part 17 follow-ups: D-306 = CSS-053, D-307 = CSS-060, D-308 = CSS-036, D-309 = CSS-033 (all above). Stage 3 owner items (C-005, F-1, F-2, X-1, X-2, X-3) appear in Table 2 as `s3-*` specs: the report ones carry through the reused renderers; F-1 (Products > Board), X-1 (Stations), X-2 (`PeriodPanel`) and X-3 (all period screens) need a new target.

## Table 2: the layout specs (`sms/layout-tests/`)

Spec files present: 66 `css-*.spec.ts` (the loop's 62 plus `036b`, `053b`, `060b` and others) + `a11y.tables`, `charts`, `health-and-bar`, `ifl-reports`, `login-screen`, `machine-product-report`, `p3-p3-04-initial-js`, `print`, six `s3-*`, `table-clipping`, `wall` = 82 files (plus a `support/` folder). All target the old DOM (`TRACE.md` G-37). Cheapest port: keep each spec's measurement, swap URL and selector. Targets use web-next names (`IA-MAP.md`): Today `s=today`, Stations `s=quality&t=stations`, Register `t=register`, Products `s=products`, Reports `s=reports`, System `s=system`.

| Spec | Asserts | Port target in web-next |
|---|---|---|
| css-001-nav-links-covered | every nav link hit-testable when wrapped | shell: sidebar / tab bar at 375/600/820/900 (M-01) |
| css-002-user-menu-offscreen | user menu left edge >= 0 | `.sh-popover` at 375/600/1050, scale 1.3 (M-02) |
| css-003-sacks-byproduct-bars-invisible | by-product bar width >= 40 at <=600 | `BarChart` with long labels (M-03) |
| css-004-calib-table-overprint | no text overlap in the calibration table | Stations `DataTable` + Reports calibration (M-04) |
| css-005-print-axis-label-clipped | print y-label inside page | Reports print, station/calibration (M-05) |
| css-006-print-footnotes-overprint | 0 overlapping word pairs in PDF | Reports print, station report (M-05) |
| css-007-toggle-wider-than-phone | page scrollWidth <= viewport | all screens' `Segmented`/tabs (M-06) |
| css-008-rejects-byday-table-overflow | no page-level sideways scroll | Quality > Rejects `HeatMatrix` (M-06) |
| css-009-product-limits-grid-overflow | overflow 0 | Products > Limits (M-07) |
| css-010-changeover-checkbox-drop | checkbox centred on first line | Changeover retire lists (M-08) |
| css-011-two-col-overflow | report page overflow 0 | Reports daily/sack (keep as guard) |
| css-012-report-headline-squeezed | headline >= 300 px beside actions | Reports viewer head (M-09) |
| css-013-ifl-header-contrast | th contrast >= 4.5 | Reports IFL types (M-14) |
| css-015-quiet-tile-contrast | quiet tile >= 4.5:1 (owner B) | Today `StationTile` quiet (M-10) |
| css-017-health-batches-cut | table fits its box | Diagnostics batches (M-11) |
| css-018-ifl-tables-overflow-column | IFL tables fit the 816 px column | Reports IFL types (M-12) |
| css-019-matrix-scroll-cue | cue shows while scrollable (owner A) | Reports machine-product (M-13) |
| css-021-line-median-caption-overlap | caption does not overlap tiles | not-applicable (Line gone) |
| css-022-skeleton-layout-shift | skeleton vs real height | Today/Weight/Rejects/Register figures (M-15) |
| css-023-reason-sheet-row-height | row <= 70 px | `ReasonSheet` (M-16) |
| css-024-reason-labels-wrap | name not squeezed | Rejects reason list (M-17) |
| css-025-changeover-untyped-inputs | inputs 39.5 px | Changeover (keep as guard) |
| css-026-row-header-offset | header aligned to row text | not-applicable (no `tbody th` in `DataTable`) |
| css-028-health-link-offscreen | no sideways scroll 901-945 | shell at Wall scale (M-01) |
| css-029-reject-yaxis-ticks-crushed | tick gap >= 20 px | Rejects trend / Report reject (M-18) |
| css-031-print-page-numbers | "Page N of M" | Reports print and Register print (M-19) |
| css-032-bar-edge-labels-anchored | edge labels centred on bars | `BarChart` stations (M-18) |
| css-033-ifl-dates-split | 0 split dates | Reports IFL types (M-12) |
| css-034-print-shows-controls | no "Name it" in print | Register / printable screens (M-19) |
| css-035-ifl-text-touches-grid | text >= 4 px from gridline | Reports IFL (keep as guard) |
| css-036-matrix-header-colour | header is IFL blue (owner B) | Reports machine-product (M-14) |
| css-036b-matrix-header-chevron-contrast | chevron >= 4.5:1 | Reports machine-product (M-14) |
| css-038-chart-tip-stays-after-blur | tooltip clears on blur | kit charts (M-23) |
| css-039-usermenu-escape-focus | Escape returns focus to trigger | `TopBar` menu (M-02) |
| css-040-matrix-focus-ring-clipped | ring visible on top edge | Reports machine-product (keep as guard) |
| css-047-sr-only-th-skews-columns | rows <= 50 px | Products Board/Catalogue `DataTable` (rows 44 px) |
| css-048-kpi-figures-stagger | figure tops equal | Today `KpiCard` (M-20) |
| css-049-weight-note-overprint | 0 overlapping pairs | Quality > Stations mixed rows (M-22) |
| css-050-trend-end-label-overflow | end label inside chart | Rejects `LineChart` (M-18) |
| css-051-reason-sheet-table-overflow | overflow 0 | `ReasonSheet` (M-16) |
| css-052-station-sheet-explanation-narrow | column >= 211 px | `StationSheet` (M-16) |
| css-053-zoom-back-visible | Back by chart after zoom (owner B) | kit charts (M-23) |
| css-053b-zoom-back-redrawn-chart | Back when chart redraws | kit charts (M-23) |
| css-056-zeroed-clock-row-tall | row <= 95 px | Reports unknown-lifter (M-12) |
| css-058-toggle-focus-invisible | ring pixels on focus | `Segmented`, `Tabs`, `PeriodChip` (M-25) |
| css-059-forced-colors-selected-state | selected differs in forced colours | same set (M-25) |
| css-060-sheet-close-scrolls-away | Close reachable in a long sheet | `Sheet` (structure built-in; keep) |
| css-060b-sheet-focus-not-under-head | focus not under head | `Sheet` (M-21) |
| css-062-row-focus-ring-clipped | ring not clipped | `DataTable` rows (keep as guard) |
| css-063-usermenu-toggle-clipped | one-line text-size label | not-applicable until a text-size control exists (M-02) |
| css-064-sacks-ledger-day-wraps | Day cell one line | Register `StockLedger` (M-27) |
| css-065-ledger-closing-cut | closing column inside box | Register `StockLedger` kg mode (M-27) |
| css-066-readings-listing-wraps | row <= 45 px | Register listing (M-28) |
| css-067-dq-findings-rows-tall | row height | Diagnostics `DqFindings` (M-11) |
| css-068-weight-stats-overprint | cell text gap >= 0 | Stations `DataTable` (M-22) |
| css-069-chart-legend-overlaps-table | legend inside frame | kit `Frame` legend (keep as guard) |
| css-070-xaxis-end-labels-collide | label gap >= 0 | kit charts (M-18) |
| css-071-weight-limit-label-cut | label inside chart | Weight `LimitBand` (M-29) |
| css-073-table-scroll-cue | fade on scrolling tables | `DataTable` + report `.tw` (M-12) |
| css-074-sheet-summary-unreachable | `summary` reachable by Tab | `Sheet` + `Disclosure` (M-21; expect red first) |
| css-075-report-buttons-flush-verdict | gap >= 10 px | Reports viewer (M-09) |
| css-076-weight-sparkline-overlap | sparkline inside its cell | Stations (M-22) |
| css-077-yaxis-sign-clipped | tick labels inside svg | kit charts (keep as guard) |
| css-078-history-outcome-squeezed | Outcome >= 276 px at 768 | Limits & History (M-30) |
| css-079-rejects-chip-offscreen | chip row fits | filter `Chip` row (M-26) |
| css-080-chip-x-focus-invisible | focus changes pixels | `Chip` (M-26) |
| a11y.tables | headers keep `columnheader` role | every `DataTable` (real `th`, not `.sr-only`); port |
| charts | every chart screen: tooltip, readout, zoom, resize | kit charts per screen; port |
| health-and-bar | Data batches cells; Pick-dates inputs vs top bar | Diagnostics + `PeriodPanel` (needs session); port |
| ifl-reports | eight IFL reports at 1366 and 375, print | Reports screen; port (renderers reused) |
| login-screen | Login layout without a session | `screens/Login.tsx`; port |
| machine-product-report | matrix at 1366, sticky first column | Reports machine-product; port |
| p3-p3-04-initial-js | first-load JS budget | new app bundle (budget to be re-set); port |
| print | PDF text, landscape, footers | Reports print + Register print; port |
| s3-c005-product-station-sacks | winder filter blanks sack figures (owner A) | Reports product (renderer reused); port |
| s3-f1-running-last-product | last product + last cone time per stopped winder | Products > Board; port (screen is new) |
| s3-f2-report-product-changes | "Product changes" block in reports | Reports daily/shift/product; port |
| s3-x1-weight-mixed-row-height | mixed-product row has a short marker | Quality > Stations; port |
| s3-x2-period-seed | custom range starts from the period on screen | `PeriodPanel`; port |
| s3-x3-empty-after-newest | empty period names the newest reading | all period screens; port (machine-product type still open) |
| table-clipping | four tables not clipped | not-applicable as written; replaced by M-12 and M-22 |
| wall | Wall at 1920x1080 | `screens/Wall/Wall.tsx` (M-24); port |

## Summary counts

CSS items (80), one primary status each, per Table 1:

| Status | Count | Items |
|---|---|---|
| built-in | 23 | 004, 008, 011, 013, 014, 018, 025, 026, 029, 031, 035, 038, 040, 047, 048, 058, 060, 062, 066, 068, 069, 077, 080 |
| must-check | 35 | 001, 002, 003, 005, 006, 007, 009, 010, 012, 017, 022, 023, 024, 028, 032, 033, 034, 039, 049, 050, 051, 052, 056, 059, 063, 064, 065, 067, 070, 071, 074, 075, 076, 078, 079 |
| owner-decision-carries | 9 | 015, 019, 020, 030, 036, 037, 053, 061, 073 (all 9 owner decisions have a carrier; 3 need action: 036 colour, 053 top-bar Back, 073 legacy `.tw` fade) |
| not-applicable | 13 | 016, 021, 027, 041, 042, 043, 044, 045, 046, 054, 055, 057, 072 |

Register facts for context: 65 fixed and committed, CSS-033 closed by D-309; 4 owner no-change; 10 recorded not fixed (CSS-014, 016, 027, 044, 045, 046, 054, 055, 057, 072).

Highest-risk carried defects (source suggests they regressed): CSS-074 (`summary` not trapped), CSS-039 (no focus return on Escape), CSS-063 (no text-size control), CSS-053 (no top-bar Back), CSS-059 (selected state in forced colours for new controls), CSS-033 and CSS-056 (no date nowrap / Why min-width in the legacy subset).

Specs: 82 files. **To port: 78** (70 measure-first, 8 keep-as-guard: css-011, 025, 035, 040, 060, 062, 069, 077). Not-applicable: 4 (css-021, css-026, css-063 until a text-size control exists, table-clipping).

## Must-check list (for the verification pass)

Built web-next, read-only data, viewports 320 / 375 / 768 / 1100 / 1366 / 1920 and text scale 1 and 1.3 unless stated. "Page overflow" = `document.scrollingElement.scrollWidth - innerWidth`.

- M-01 Shell nav at 375/600/820/900 and 901-945@Wall: `elementFromPoint` at the centre of every sidebar / tab-bar item returns that item; page overflow 0. (001, 028)
- M-02 User menu at 320/375/600/1050 and 1.3: popover left >= 0; open, press Escape, `activeElement` is `.sh-user-btn` (expected FAIL today); find where Desk/Wall text size lives. (002, 039, 063)
- M-03 `BarChart` with long product names at 320-600: widest bar >= 40 px; no label past the svg. (003)
- M-04 Stations table header and Reports calibration table at 375 and 860, and 1366@1.3: no header word overlap (gap >= 0 px). (004)
- M-05 Print PDF of Station, Calibration, Daily, Shift reports: y-axis label left edge >= 0; 0 overlapping word pairs near page breaks; record page count per type (blocks stay whole). (005, 006, 030)
- M-06 Every screen at 320/375: page overflow 0 (Segmented, TabBar, Tabs; Rejects HeatMatrix at 375/440). (007, 008)
- M-07 `s=products&t=limits` at 375/500/621/1366@1.3: overflow 0. (009)
- M-08 Changeover retire lists at 320-521 and 600+: checkbox centre within 2 px of the first text line centre. (010)
- M-09 Reports viewer head at 650/768/900: headline column >= 300 px; gap between actions and verdict box >= 10 px. (012, 075)
- M-10 Today station tiles in quiet state: name and count contrast >= 4.5:1, dashed edge and "quiet" word present; longest station name truncation. (015, 016, 021)
- M-11 Diagnostics batches table fits its box at 1366/1100/1920 and 1.3; DQ finding row median height (was 199 px). (017, 067)
- M-12 Reports IFL types (summary, weight range, rejected sacks, unknown lifter, hangers, SPS packing, shift production) at 768/1100/1366/1920 and 861-925: table width <= box; count mid-value date splits (target 0); zeroed-clock row <= 95 px; fade or cue present on tables that scroll. (018, 033, 037, 056, 073)
- M-13 Reports machine-product at 1366: `MatrixScrollCue` visible, legible, names first and last hidden machine. (019)
- M-14 IFL header and matrix chevron: ink on header fill >= 4.5:1; chevron >= 4.5:1 (about 5.3 expected on `--seq-2`); owner to confirm `--seq-2` vs `#ADD8E6`. (013, 036)
- M-15 Skeleton vs loaded height of the first figures row on Today, Weight, Rejects, Register at 375/1366 and 1.3: jump <= 4 px. (022)
- M-16 `ReasonSheet` and `StationSheet` at 375/1366/1.3: overflow 0, median reason row <= 70 px, explanation column >= 211 px. (023, 051, 052)
- M-17 Rejects reason list and Pareto labels at 500/620: no name wrapped past 2 lines. (024)
- M-18 Kit chart axes: y tick gap >= 20 px (Rejects, Report reject); x labels gap >= 0 at 320, 353, 375@1.3; first/last category label and trend end label inside the svg. (029, 032, 050, 070)
- M-19 Print Register (portrait) over 3+ pages: "Page N of M" present; no Name-it or link controls in print. (031, 034)
- M-20 Today `KpiCard` linked vs static figure: top spread 0 at 1366 and 1.3. (048)
- M-21 `Sheet` keyboard: Tab from the first control reaches a `Disclosure` summary within 25 Tabs (expected FAIL: `FOCUSABLE` lacks `summary`); Shift+Tab in a long sheet keeps the focused control clear of the head. (060, 074)
- M-22 Quality > Stations at 320/1366/Wall: no overprint in any cell; sparkline inside its cell; multi-material row height <= 70 px (S3 X-1). (049, 068, 076)
- M-23 Click-zoom on every kit chart: chart-adjacent "Zoomed in - Back" present (8 of 8 cells); tooltip pinned by arrow keys clears after Tab; decide the top-bar Back (absent). (038, 053)
- M-24 Wall at 1920x1080@1.3: footer fits one line; nothing clipped. (027)
- M-25 Forced colours (Edge `forcedColors`): selected `Segmented`, `Tabs`, `TabBar`, `PeriodChip`, `Chip` differ from unselected; focus ring visible on each. (058, 059)
- M-26 Filter chip with a long product name at 375: row fits, overflow 0; clear-button focus changes >= 30 px; list any interactive box under 24 px. (061, 079, 080)
- M-27 Register `StockLedger` at 768 and 1366/1920, kg mode: Day cell one line; Closing column inside its box. (064, 065)
- M-28 Register listing at 768-860 and 375: card list under 768; rows <= 45 px at 768-860. (066)
- M-29 Weight `LimitBand` label at 320-620: label inside the chart. (071)
- M-30 Limits & History at 375/768/1366: Outcome column >= 276 px at 768. (078)
