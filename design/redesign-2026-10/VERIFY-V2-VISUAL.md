# VERIFY-V2-VISUAL: full browser check of web-next at HEAD f65b4ab

Date 13 Oct 2026. Task V2a, read-only. Edge via Playwright, real compiled API against `sms_audit` (READ_ONLY), render-token identity at rank 3 (also rank 1 and rank 4 servers for gated views). Own ephemeral ports; :4000/:5173 never contacted; no DB write; no account; Execute never clicked. Servers stopped. Scratch: `SCR/v2a/` (SCR = the session scratchpad directory), PNGs in `SCR/v2a/shots/` and `SCR/v2a/shots/m/`, PDFs in `SCR/v2a/pdf/`.

Not verified: the plant, a real printer, a real person looking, a signed-in viewer/engineer session (render token only), Urdu, touch, Windows high-contrast themes beyond Edge forcedColors. 730 page loads were measured by script; about 70 PNGs were looked at by eye.

## Verdict

**NOT READY for a premium, uniform sign-off.** Functionally clean: 0 console errors, 0 failed requests, 0 page overflow at 320, 1100, 1366 and 1920 on every screen and period. Keyboard and forced-colours basics hold. Visually it is not uniform: Reports and Setup still look like the old app inside the new shell, Changeover, Limits and Login form fields spill out of their cards, charts carry overlapping axis titles, and several phone and Wall layouts break.

Defects: **S1 0, S2 9, S3 17, S4 6 (32)**. M-checks: 30 total, **13 fail** (M-04, 08, 12, 15, 18, 19, 20, 22 plus partial M-21 and others listed below), 4 not measurable here.

## 1. Overflow (scrollWidth minus innerWidth)

Rank-3 screens at 320, 375, 768, 1100, 1366, 1920, periods PD1, PL, PR and DEF (18 report types at PD1 and PL only), Wall and Today also at text size 1.3, plus rank 1 and rank 4 gated views at 1366. Total 730 loads.

| Viewport | Loads | Overflow > 0 | Where |
|---|---|---|---|
| 320 | 129 | 0 | none |
| 375 | 141 | 8 | Wall only (375 and 375@1.3, all periods): header `wl-hdr` ends at 775 to 1267 px |
| 768 | 65 (PD1 and DEF) | 4 | Products Board, Changeover, Catalogue, Limits with the default (empty) period: 25 px, `sh-user-btn` right edge 793. Top bar overflows |
| 1100 | 65 | 0 | none |
| 1366 | 141, plus rank 1 (24), rank 4 (24) | 0 | none |
| 1920 | 141 | 0 | none |
| Login, no cookie | 2 | 1 | 375: 20 px (inputs wider than the card) |

Console errors and failed requests: 0 in every run. Gallery not present (`?gallery=1` shows Login).

## 2. M-01 to M-30

PASS, FAIL (measured), N/M = not measured here (reason given).

| M | Result | Numbers |
|---|---|---|
| M-01 | PASS | every sidebar/tab-bar item hit-testable at 375, 600, 820, 900 and 930@1.3; overflow 0 |
| M-02 | PASS | popover left edge 32 at 320, 87 at 375, 312 at 600, 762 at 1050, 1 at 375@1.3 (all >= 0). Escape returns focus to `sh-user-btn`. Desk/Wall text size now lives in the menu. `shots/m/M02_menu_*.png` |
| M-03 | N/M | no BarChart with long product names on any screen; station bars have short labels and stay inside the svg at 320-620 |
| M-04 | FAIL (partial) | Stations header: 2 header cells whose text exceeds the cell at 860 and at 1366@1.3 (the "Pattern check" caption); Reports calibration 0 at 375 and 860, 2 at 1366@1.3 |
| M-05 | PASS with note | print PDFs: no word at negative x; overlapping word pairs 0 for Daily, Management summary, Register, Calibration, Shift-production; 1 pair on the Station report. Blocks stay whole (owner A) |
| M-06 | PASS | overflow 0 on every screen at 320 and 375 except Wall at 375 (section 1) |
| M-07 | PASS | Limits overflow 0 at 320, 375, 500, 621, 768, 1366 |
| M-08 | FAIL | checkbox centre vs first text line: 0.5 px at 521, 600, 1366; **11.5 px at 375, 11.5 to 22.5 px at 320**. The box is centred on the whole wrapped label, not its first line (CSS-010 regression). `shots/m/crop_co375.png` |
| M-09 | N/M | the new Reports page has no head row with Print/Export beside a headline; actions sit in the builder panel and do not touch the verdict box at 650, 768, 900 (`shots/m/M09_768.png`) |
| M-10 | PASS with note | quiet tile name/count contrast 15.8:1, small text 5.1:1; the "No data" word is present; **no dashed edge** (border none), the cue is the word and an open circle |
| M-11 | PASS | batches and sources tables fit their boxes at 1100, 1366, 1920, 1.3. DQ rows are a list, not a table (see defect 18) |
| M-12 | FAIL | At 1366 and 1920 table width <= box (4 px gutter beyond the doc padding only) and 0 date splits (machine-product has a deliberate two-line date and shift cell). **At 768 and 1100 most IFL tables are wider than the box and scroll with no fade or cue** (rejected-unknown-lifter 1112 px in 444 at 768; machine-product 1326 in 444). **Dates split mid-value at 768**: rejected-sacks 628 of 628 date cells, rejected-hangers 500 of 500, daily 48 of 48, reject 243 of 243, shift-production 14 of 114. Zeroed-clock row max 85 px (<= 95). `legacy-report.css` has no edge fade, so CSS-073 does not carry to report tables |
| M-13 | PASS | machine-product shows "Scroll sideways to see machines Winder 9 to Winder 14" at 1366 and "Winder 4 to Winder 14" at 768 |
| M-14 | PASS | IFL table header fill is exactly rgb(173,216,230) = #ADD8E6; ink on it 11.69:1. The owner question about seq-2 versus #ADD8E6 is answered: the fill is #ADD8E6 |
| M-15 | FAIL | first figures row, skeleton versus loaded: Today 180 to 214 px at 1366, Weight 180 to 240, Rejects 162 to 196, Today@1.3 234 to 308, Weight@1.3 235 to 315; whole page 1926 to 3307 px on load (Today 1366) |
| M-16 | PASS | Reason sheet: overflow 0 at 375, 1366, 1.3; rows 45 px (58 at 1.3) <= 70. Station sheet overflow 0 at 375, 1366, 1.3 (flagged-days column not separately measured) |
| M-17 | PASS | reason names on one line at 500 and 620 |
| M-18 | FAIL (visual) | axis titles ("cones", "g", "Cumulative share (%)") overprint the top tick labels on Weight over time ("g" over 2,050.0), the Rejects Pareto and the Today Pareto. x tick collisions 0 at 375, 620, 768 (only 3 x ticks at 375); y tick gap 70 px. `shots/rejects__PD1__v1366__full.png`, `shots/wt_cone_time__PD1__v1366__full.png` |
| M-19 | FAIL | Register print (cones 6 pages, sacks 6 pages, Letter portrait) has **no "Page N of M"**; Reports types have it. Sidebar, top bar, Name-it, Print and Export are absent in print (PASS). Register prints the loaded rows only (about 100) under a header saying 3,089 cones |
| M-20 | FAIL | Today KPI tops 444, 444, 444, 444, 462 at 1366 (18 px stagger on the 5th card); 577.1 x3 then 600.5 x2 at 1.3 (23.4 px), because the label of the last two cards wraps |
| M-21 | PASS (with defect 24) | Tab in a Sheet reaches the `summary` ("How this is calculated") and traps focus; Shift+Tab: 0 of 12 stops under the head. Escape closes the sheet but focus falls to `body`, not the opener |
| M-22 | FAIL (1.3) | Stations: no sparkline outside its cell; max row 58 px at 1366 (<= 70) but **75 px at 1920@1.3**. At 320 it is a card list |
| M-23 | PASS | click-zoom sets `p=range`; top-bar Back and a chart-adjacent "Zoomed in - Back" both present on Weight cone, Weight sack and the Today shift chart (3 of 3 zoomable; the Rejects trend did not zoom on click) |
| M-24 | PASS with note | Wall 1920x1080 at 1.3: footer fits one line; "East Conveyor" is cut at 1.3 (defect 22) |
| M-25 | PASS | forcedColors: selected sidebar item differs in colour, selected tabs have a 4 px underline versus 2 px, selected segmented option has a ring, all focus rings 2 px solid. Selected `Chip` and `PeriodChip` not checked individually |
| M-26 | N/M | no filter chip with a long product name reachable on a screen. Interactive boxes under 24 px: `ui-link` 86x16 and 61x16 (Today "Open the readings" links; owner A on CSS-061) |
| M-27 | PASS | Stock ledger rows 44 to 45 px (one line) at 768 and 1366; at 1920@1.3 rows 57-58, table 1572 in a 1209 box (scrolls) |
| M-28 | PASS | card list at 375 (cards up to 158 px); rows <= 45 px at 768, 800, 860 |
| M-29 | PASS | limit label inside the svg at 375, 620, 768 (ends at 183 of 303 at 375) |
| M-30 | PASS (with defect 23b) | Outcome column 343 px at 768 (>= 276), but it lies past the scroll edge: half the column is visible in the card |

## 3. Defects (ranked)

PNG paths are relative to `SCR/v2a/shots/`.

### S2

1. **Changeover form fields spill out of the card.** At 1366 the "Product name" input overlaps the Colour column; the "Sack colour" input and the Reason textarea run 26 px past the card's right edge. At 375 every text input is wider than the card (right edge 365 vs 339). `p_changeover__PD1__v1366__full.png` (y 1050-1150 and 1700-1780), `p_changeover__PD1__v375__full.png`.
2. **Limits & History: Reason textarea wider than its card** at 768 (539 vs 521). `m/M07_limits_768.png`.
3. **Products Board cards touch and overlap.** Running cards have borders, idle cards are filled, there is no vertical gap and borders collide between rows (Station 1/4, 5/8). `p_board__PD1__v1366__full.png` (y 560-1700).
4. **Top bar overflows 25 px at 768 on the four Products pages with the default period** (user menu right edge 793). Open `?s=products&t=board` at 768 with no period. `p_board__DEF__v768.png`.
5. **Login inputs are wider than the Sign in button and the card padding**; 20 px page overflow at 375. `login_1366.png`, `login_375.png`.
6. **Reports preview (legacy renderers) clips and overruns the new card.** The Management summary explanatory paragraph runs off the right edge; the Daily "451 rejected at inspection" block overruns the card; the summary table touches the right edge; blank bands of about 120 px between blocks. `r_landing__PD1__v1366__full.png` (y 1150-1250), `rpt_daily__PD1__v1366__full.png` (y 1200-1280).
7. **Today KPI "Packed 6,296.7 kg": the unit "kg" sits outside the card** at 375. `m/crop_today375.png`.
8. **Axis titles overprint tick labels** on Weight over time, the Rejects Pareto and the Today Pareto (M-18). `wt_cone_time__PD1__v1366__full.png`, `rejects__PD1__v1366__full.png`.
9. **Wall at phone width breaks** (overflow up to 932 px), and at 1366 the status chips on the right-hand tiles are clipped (Station 10, 14). `wall__PD1__v375.png`, `wall__PD1__v1366.png`.

### S3

10. **Reports and Setup are visibly the old app**: dark navy VERDICT box, tinted-blue bordered tables, underlined tiny "yes / Edit / Rename" links, full-width outline "Add a machine / Add a station" buttons, a different row height and type scale from DataTable. `rpt_daily__PD1__v1366__full.png`, `sys_setup__PD1__v1366__r4__full.png`, `m/crop_setup.png`.
11. **IFL tables scroll sideways at 768 to 1100 with no cue, and dates split mid-value at 768** (M-12). `rpt_rejected-sacks__PL__v768.png`.
12. **Skeleton much shorter than the loaded content**: 34 to 80 px jump in the KPI row and a page about 1,400 px taller after load (M-15).
13. **Today KPI cards uneven** (5th card 18 px lower at 1366, 23 px at 1.3) and the phone row ends with an orphan full-width card (M-20). `today__PD1__v1366.png`, `m/crop_today375.png`.
14. **Station tiles on Today**: at 1920 names wrap ("Station / 8") in 10 columns with 4 orphans on the second row; at 375 the state glyph forces "Station / 3". No-data tiles say "No data / No cones / No data" (three times). `today__PD1__v1920.png`.
15. **Mixed date formats**: "1 Sep 2026", "06/05/2026, 21:33:02", "29/09/2026, 21:22:50", "05-08-2026 to 07-09-2026", "1 Sept" (heat map header), "01-09-2026". `wt_cone_time__PD1__v1366__full.png`, `sys_diag__PD1__v1366__full.png`, `rejects__PD1__v1366__full.png`.
16. **Quality tabs open with different heading patterns**: Weight (sentence only), Rejects (sentence as h1 plus a duplicate "Failed inspection by reason" heading above a card with the same title), Stations (h1 "Stations" plus sentence), Register (tabs plus sub-tabs plus sentence). Today repeats "Today" in the top bar, the hero label and the sidebar. `rejects__PD1__v1366__full.png`, `stations__PD1__v1366__full.png`.
17. **Stations table: the "Pattern check" caption is a bordered box that pokes above the header row and casts a shadow over the table** (M-04). `stations__PD1__v1366__full.png` (x 945-1260, y 388-530).
18. **Diagnostics is an 8,600 px page**: a 40-row "Data checks" list in a narrow right column beside a 3-row "Data sources" card leaves a 6,000 px empty left column. "See the first reading it counts" is centred while other links are left aligned; "1 rows"; two cards both titled "Older IFL database"; "13 d 19 h since the last check" wraps "check" onto a second line. `sys_diag__PD1__v1366__full.png`, `m/crop_diag_mid.png`.
19. **Changeover Review shows raw procedure text** in a plain-language flow: "CreateMaterial, setpointG: 1960, offsetMinusG: 50, ... ppColour", "CreatePallet, packSchemaId". `m/CO_review.png`.
20. **Register print has no "Page N of M" and prints about 100 rows under a "3,089 cones" header** (M-19). `pdf/register_cones.pdf`.
21. **Changeover retire-list checkbox is centred on the wrapped label, not the first line, at 320 to 375** (M-08).
22. **Wall at 1.3: "East Conveyor" cut**; text size 1.3 barely enlarges the Wall. `wall__PD1__v1920@1.3.png`.
23. **Catalogue Products table is clipped at the right at 1366**: the Retire buttons and the last columns are cut by the scroll edge although the card has 28 px of free padding; the search placeholder "Code, colour, count, tube c" is cut. (23b: the Limits & History Outcome column at 768 is half visible.) `p_catalogue__PD1__v1366__full.png`, `m/M07_limits_768.png`.
24. **Sheet: Escape drops focus to `body`** instead of the control that opened it.
25. **Stations rows reach 75 px at 1920@1.3 (> 70)**; "Pattern check" header text is wider than its cell at 860 (M-04, M-22).
26. **Quality Weight headline is a 3-line sentence** that contains "(retired in PDAS)", a raw timestamp and "(weight basis not yet confirmed)" in one run; hard to scan. `wt_cone_time__PD1__v1366__full.png`.

### S4

27. Quiet station tiles have no dashed edge (the owner decision CSS-015 kept it); only the "No data" word and an open circle mark them.
28. Today "Open the readings behind these figures" links are 16 px tall (below 24 px).
29. The Today hero is about 240 px tall at 1366 with only a label, a headline and three grey sentences: dead space next to the KPIs.
30. Rejects KPI row: three cards of unequal height (196, 196, 170 px), the third card's note sits outside it. `rejects__PD1__v1366__full.png`.
31. Reports landing: the "Production by day and shift" card has about 150 px of empty space between its list and its buttons. `r_landing__PD1__v1366__full.png`.
32. Preview captions duplicate: "Management summary, Management summary" and "Production by day and shift, Daily production" above the document. `r_landing__PD1__v1366__full.png`.

## 4. Print (emulated print, Edge `page.pdf`, preferCSSPageSize), period PL (5 Aug to 7 Sep) unless stated

| Document | Pages | Page size | Sidebar, top bar, tab bar | Page numbers | Overlapping word pairs |
|---|---|---|---|---|---|
| Daily | 5 | A4 landscape | absent | "Page 1 of 5" | 0 |
| Shift-production | 36 | A4 portrait | absent | "Page 1 of 36" | 0 |
| Management summary | 3 | A4 landscape | absent | "Page 1 of 3" | 0 |
| Register cones (PD1) | 6 | Letter portrait | absent | none | 0 |
| Register sacks | 6 | Letter portrait | absent | none | 0 |
| Station report | 3 | A4 landscape | absent | "Page 1 of 3" | 1 |
| Calibration | 3 | A4 landscape | absent | "Page 1 of 3" | 0 |

PDFs are in `SCR/v2a/pdf/`. Text extraction shows the middle-dot separator as U+FFFD ("TP1 ? Line 3"); this was not checked as rendered pixels, so whether the PDF font lacks the glyph is unknown.

## 5. Keyboard and forced colours

- Shell tab order (1366): Skip to content, six sidebar items, collapse, period chip, health button, account menu, then page content. Every focus is a 2 px solid outline. PASS.
- Period panel: opens with first focus on the Today preset; Tab walks six presets, From and To inputs with time selects, the compare Off/On toggle, Cancel; Escape closes and returns focus to the period chip. PASS.
- Sheet: Tab loops inside the sheet (Show as table, chart regions, summary, four links, Log an adjustment, Close) and reaches the `summary`; Shift+Tab never lands under the head. Escape closes but focus goes to `body`. PARTIAL (defect 24).
- Changeover wizard: Tab order top bar, tab strip, "Use existing" toggles, selects, text inputs, all with a 2 px outline. The plan was filled and "Check the plan" clicked, which reached Review; nothing was executed and Execute was never clicked. PASS.
- forcedColors active on Today, Products and Quality: selected sidebar item, selected tab (4 px versus 2 px underline), selected segmented option and period chip are distinguishable; focus rings present. `m/FC_today.png`, `m/FC_products.png`, `m/FC_quality.png`. PASS.

## 6. Style C conformance (visual review)

Consistent: shell (sidebar, frosted top bar, phone tab bar), KPI tiles, DataTable on Quality, Products and Today, sheets, Account, Wall, Login look, buttons, chips, tabs, type ramp, soft shadows, light-blue and ink palette.

Not consistent with Style C: Reports documents and Setup (defect 10), Diagnostics layout (18), card-inside-card chart frames on Today and Quality (a white card with its own shadow inside a white section card, narrower than its parent; `today__PD1__v1366__full.png` y 800-1050), per-screen heading patterns (16), date formats (15), raw jargon strings (19). Several screens look empty on real data: Today with 7 of 14 stations "No data", a Rejects heat map with one column, a Daily bar chart with one bar.

## 7. Not measured

M-03, M-09 (no equivalent head row), and the chip part of M-26. A real printer, rank 1 or rank 2 sessions beyond the render token, and Urdu were not covered. Rank 1 (viewer) and rank 4 were loaded at 1366 for Today, Stations, Products x3 and Setup: 0 overflow, 0 console errors, 0 failed requests. By eye: Today (375, 1366, 1920), Wall (1366, 1920, 1920@1.3), Weight, Rejects, Stations, Register, Board, Changeover (plan and review), Catalogue, Limits (768), Reports landing, Daily and Management summary previews, Diagnostics, Setup, Account, Login, Reason sheet at 375, Reports at 375 and 768. The other roughly 650 captures were checked by script only (overflow, console, failed requests, clipped text), not by eye.
