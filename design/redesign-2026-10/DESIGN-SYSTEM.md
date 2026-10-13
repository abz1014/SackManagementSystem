# SMS design system (redesign, Oct 2026) - Style C, Soft premium

**Owner decision 13 Oct 2026: Style C ("Soft premium", Stripe and Apple feel) chosen.** It replaces the first draft (dark slate sidebar, 6px radius, hairline-ring cards). Styles A and B were not chosen. The Claude Design System artifact "IFL SMS Design System" and `tokens.css` carry the same values.

Status: Phase A design contract. Tokens live in `tokens.css` (same folder); every value below is a token name from that file. Mockups and later code read tokens, never raw hex.

Why: the UX survey found no shared components, so every screen invented its own cards, tables and caveats. The fix is not a prettier skin but a small kit used everywhere. Direction (owner): modern industrial dashboard in the Style C soft-premium look: floating white sidebar, frosted top bar, one gradient status band, KPI cards with soft icon chips, station heat grid as hero, real charts, control-room feel but calm.

## 1. Character

- The one memorable thing: the **Station heat grid** (14 tiles, worst first, each tile a state). Everything else is quiet and soft: white cards that float on a cool-tinted floor (`--bg` #f3f5fb), a white floating sidebar card, one blue for interaction, one soft gradient band that states the situation in a sentence.
- State colour is the only loud colour in the app. If a screen has no Watch/Act, it is visibly calm. That is the point of a control room. KPI icon chips use soft blue, violet, teal, indigo and slate, never a state hue.
- Voice: plain sentence-case words, no all-caps labels, no decorative eyebrows. Numbers are tabular and large; units are small and grey.
- Font: **Manrope** (OFL, variable 400-800). It replaces Instrument Sans in this style. Tabular figures are available: Manrope carries the `tnum` feature (checked 13 Oct 2026 by rendering "1111" and "0000" in the Google Fonts build: with `font-feature-settings: "tnum"` both measure the same width at weights 400 and 700; without it they differ). `font-variant-numeric: tabular-nums` stays on everywhere. Fallback Segoe UI. **Production must self-host a Manrope variable woff2** (a font file under `web/public/fonts/` plus an @font-face, not an npm dependency): the plant PC has no internet, so the Google Fonts reference used by the design-system previews and the Style C canvas must not ship. The current production font file remains Instrument Sans until the owner answers OQ-3.

## 2. Colour roles

| Role | Tokens | Use |
|---|---|---|
| Sidebar | `--side-bg` (white card), `--side-bg-hover`, `--side-active-bg`, `--side-line`, `--side-fg`, `--side-fg-dim`, `--side-fg-strong`, `--side-active-fg`, `--side-focus` | Navigation only. A floating white card (`--radius-side` 22, `--elev-1`). Active item = `--side-active-bg` fill + accent text at weight 700 + accent icon; no edge bar. |
| Work area | `--bg` floor, `--surface` cards, `--surface-sunk` table heads / inputs-at-rest / disclosure body / delta pill, `--line` hairlines, `--line-strong` control borders and limit lines | Never use `--line` as the only boundary of a control (1.3:1). |
| Ink | `--ink-1` headings and values, `--ink-2` body, `--ink-3` captions/units/axis | Three steps only; all >= 4.5:1 on `--bg`, `--surface`, `--surface-sunk`. |
| Accent | `--accent`, `--accent-hover`, `--accent-tint`, `--on-accent`, `--focus-ring` | Links, primary buttons, selection, focus, and the page title inside the status band. **Never encodes a state.** Blue accent is not a state colour, so a blue thing is always clickable. |
| Band and chips | `--band-1..3`, `--topbar-bg`, `--chip-1..5-bg`, `--chip-1..5-fg` | The status band gradient (the only gradient besides single-series bars), the frosted top bar fill, and the KPI icon chip hues. Section 3c. |
| State | `--ok-*`, `--watch-*`, `--act-*`, `--nodata-*` (fg, tint, edge, glyph, word) | Section 3. |
| Categorical | `--cat-1..5`, `--cat-other` | Identity in charts (products, shifts, machines compared). Section 3b. |
| Sequential and bars | `--seq-1..5`, `--bar-from`, `--bar-to` | Magnitude in one hue (histogram density, volume); the single-series bar gradient. |

Dark mode: not in v1. Everything is light, sidebar included (plant PCs, TV in a bright hall). `color-scheme: light` is set. Adding a dark work area later means a second token block, no component change.

## 3. Contrast (computed, WCAG 2.x relative luminance, not estimated)

Text needs 4.5:1; borders, state edges, glyphs, icons and chart marks need 3:1 against what they sit on. Every figure below was produced by a script from the token values (13 Oct 2026): 80 pairs, **0 failures**. Lowest ratios by group: text 5.00, state text 4.85, state edges 3.02, controls and focus 3.15, icon chips 4.18, chart marks 3.16.

**Text**

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| ink-1 on bg | #12162b on #f3f5fb | 16.39 | 4.5:1 pass |
| ink-1 on surface | #12162b on #ffffff | 17.87 | 4.5:1 pass |
| ink-1 on surface-sunk | #12162b on #eef1f8 | 15.80 | 4.5:1 pass |
| ink-2 on bg | #3d4560 on #f3f5fb | 8.68 | 4.5:1 pass |
| ink-2 on surface | #3d4560 on #ffffff | 9.47 | 4.5:1 pass |
| ink-2 on surface-sunk | #3d4560 on #eef1f8 | 8.37 | 4.5:1 pass |
| ink-3 on bg | #5d6580 on #f3f5fb | 5.29 | 4.5:1 pass |
| ink-3 on surface | #5d6580 on #ffffff | 5.77 | 4.5:1 pass |
| ink-3 on surface-sunk | #5d6580 on #eef1f8 | 5.10 | 4.5:1 pass |
| ink-1 on band-1 | #12162b on #e9efff | 15.53 | 4.5:1 pass |
| ink-1 on band-2 | #12162b on #f0ebff | 15.34 | 4.5:1 pass |
| ink-1 on band-3 | #12162b on #e6f5fb | 16.01 | 4.5:1 pass |
| ink-2 on band-1 | #3d4560 on #e9efff | 8.23 | 4.5:1 pass |
| ink-2 on band-2 | #3d4560 on #f0ebff | 8.13 | 4.5:1 pass |
| ink-2 on band-3 | #3d4560 on #e6f5fb | 8.48 | 4.5:1 pass |
| accent on surface | #2b59e0 on #ffffff | 5.82 | 4.5:1 pass |
| accent on bg | #2b59e0 on #f3f5fb | 5.34 | 4.5:1 pass |
| accent on accent-tint | #2b59e0 on #e9efff | 5.06 | 4.5:1 pass |
| accent on band-1 | #2b59e0 on #e9efff | 5.06 | 4.5:1 pass |
| accent on band-2 | #2b59e0 on #f0ebff | 5.00 | 4.5:1 pass |
| accent on band-3 | #2b59e0 on #e6f5fb | 5.22 | 4.5:1 pass |
| accent on side-active-bg | #2b59e0 on #eaf0ff | 5.10 | 4.5:1 pass |
| on-accent on accent | #ffffff on #2b59e0 | 5.82 | 4.5:1 pass |
| on-accent on accent-hover | #ffffff on #1f46bd | 7.87 | 4.5:1 pass |
| side-fg on side-bg | #3d4560 on #ffffff | 9.47 | 4.5:1 pass |
| side-fg on side-bg-hover | #3d4560 on #f3f5fb | 8.68 | 4.5:1 pass |
| side-fg-dim on side-bg | #5d6580 on #ffffff | 5.77 | 4.5:1 pass |
| side-fg-dim on side-bg-hover | #5d6580 on #f3f5fb | 5.29 | 4.5:1 pass |
| side-fg-dim on side-active-bg | #5d6580 on #eaf0ff | 5.06 | 4.5:1 pass |
| side-fg-strong on side-bg | #12162b on #ffffff | 17.87 | 4.5:1 pass |
| side-fg-strong on side-bg-hover | #12162b on #f3f5fb | 16.39 | 4.5:1 pass |
| side-active-fg on side-active-bg | #2b59e0 on #eaf0ff | 5.10 | 4.5:1 pass |

**State text** (text and glyph in the state colour; the word always accompanies it)

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| ok-fg on ok-tint | #087a4a on #e5f7ee | 4.85 | 4.5:1 pass |
| ok-fg on surface | #087a4a on #ffffff | 5.39 | 4.5:1 pass |
| ok-fg on bg | #087a4a on #f3f5fb | 4.95 | 4.5:1 pass |
| watch-fg on watch-tint | #8f5c00 on #fff4dc | 5.20 | 4.5:1 pass |
| watch-fg on surface | #8f5c00 on #ffffff | 5.68 | 4.5:1 pass |
| watch-fg on bg | #8f5c00 on #f3f5fb | 5.21 | 4.5:1 pass |
| act-fg on act-tint | #c0293a on #ffe9ec | 5.01 | 4.5:1 pass |
| act-fg on surface | #c0293a on #ffffff | 5.80 | 4.5:1 pass |
| act-fg on bg | #c0293a on #f3f5fb | 5.32 | 4.5:1 pass |
| nodata-fg on nodata-tint | #566079 on #eef1f8 | 5.55 | 4.5:1 pass |
| nodata-fg on surface | #566079 on #ffffff | 6.28 | 4.5:1 pass |
| nodata-fg on bg | #566079 on #f3f5fb | 5.76 | 4.5:1 pass |
| act-fg on band-1 | #c0293a on #e9efff | 5.04 | 4.5:1 pass |
| watch-fg on band-3 | #8f5c00 on #e6f5fb | 5.09 | 4.5:1 pass |

**State edges** (rings on state KPI cards, glyph colour, chart rings)

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| ok-edge on surface | #2a9c6c on #ffffff | 3.46 | 3:1 pass |
| ok-edge on ok-tint | #2a9c6c on #e5f7ee | 3.11 | 3:1 pass |
| ok-edge on bg | #2a9c6c on #f3f5fb | 3.17 | 3:1 pass |
| watch-edge on surface | #b58315 on #ffffff | 3.38 | 3:1 pass |
| watch-edge on watch-tint | #b58315 on #fff4dc | 3.09 | 3:1 pass |
| watch-edge on bg | #b58315 on #f3f5fb | 3.10 | 3:1 pass |
| act-edge on surface | #ea5566 on #ffffff | 3.51 | 3:1 pass |
| act-edge on act-tint | #ea5566 on #ffe9ec | 3.02 | 3:1 pass |
| act-edge on bg | #ea5566 on #f3f5fb | 3.22 | 3:1 pass |
| nodata-edge on surface | #7f8aa4 on #ffffff | 3.46 | 3:1 pass |
| nodata-edge on nodata-tint | #7f8aa4 on #eef1f8 | 3.06 | 3:1 pass |
| nodata-edge on bg | #7f8aa4 on #f3f5fb | 3.17 | 3:1 pass |

**Controls and focus**

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| line-strong on surface (control border) | #7d88a0 on #ffffff | 3.56 | 3:1 pass |
| line-strong on bg (control border) | #7d88a0 on #f3f5fb | 3.26 | 3:1 pass |
| line-strong on surface-sunk (control border) | #7d88a0 on #eef1f8 | 3.15 | 3:1 pass |
| focus-ring on surface | #2b59e0 on #ffffff | 5.82 | 3:1 pass |
| focus-ring on bg | #2b59e0 on #f3f5fb | 5.34 | 3:1 pass |
| focus-ring on side-active-bg | #2b59e0 on #eaf0ff | 5.10 | 3:1 pass |
| focus-ring on accent-tint | #2b59e0 on #e9efff | 5.06 | 3:1 pass |

**KPI icon chips** (icon against its chip)

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| chip-1-fg on chip-1-bg | #2b59e0 on #e6eeff | 5.00 | 3:1 pass |
| chip-2-fg on chip-2-bg | #6a46d9 on #efe9ff | 5.09 | 3:1 pass |
| chip-3-fg on chip-3-bg | #0b7f92 on #e2f5f8 | 4.18 | 3:1 pass |
| chip-4-fg on chip-4-bg | #3b46c4 on #e8ebfb | 6.19 | 3:1 pass |
| chip-5-fg on chip-5-bg | #475069 on #edf0f6 | 7.02 | 3:1 pass |

**Chart marks and labels** (white surface)

| Pair | Colours | Ratio | Needs |
|---|---|---|---|
| cat-1 on surface | #2b59e0 on #ffffff | 5.82 | 3:1 pass |
| cat-2 on surface | #e0457b on #ffffff | 3.96 | 3:1 pass |
| cat-3 on surface | #7c5ce6 on #ffffff | 4.64 | 3:1 pass |
| cat-4 on surface | #0f9fb5 on #ffffff | 3.16 | 3:1 pass |
| cat-5 on surface | #b8791b on #ffffff | 3.63 | 3:1 pass |
| cat-other on surface | #7f8aa4 on #ffffff | 3.46 | 3:1 pass |
| bar-from on surface | #2b59e0 on #ffffff | 5.82 | 3:1 pass |
| on-accent label on bar-from (Pareto label) | #ffffff on #2b59e0 | 5.82 | 4.5:1 pass |
| ink-1 label on bar-to (label inside a short bar) | #12162b on #8aa5f2 | 7.44 | 4.5:1 pass |
| ink-3 tick on surface | #5d6580 on #ffffff | 5.77 | 4.5:1 pass |

Decorative, exempt by design (a value or label always carries the information): `--line` on `--surface` 1.2:1 (row separators), `--chart-grid` 1.2:1, `--chart-axis` 1.4:1. The status band and the frosted top bar (white at 72%) are backgrounds only; text on them is `--ink-1`, `--ink-2` or `--accent`, all in the Text table.

**Where the first Style C draft missed the floor and was changed** (the draft values in brackets): `--ok-edge` (#2fae78, 2.82 on white) to #2a9c6c; `--watch-edge` (#e0a21a, 2.25) to #b58315; `--nodata-edge` (#8f99b0, 2.86) to #7f8aa4; `--cat-other` (#8f99b0) to #7f8aa4; `--side-fg-dim` (#66708b, 4.33 on the active fill) to #5d6580. `--act-edge` (#ea5566) was kept (3.51 on white, 3.02 on its tint). The soft Watch and Act tile glows (`--tile-watch`, `--tile-act`) are decoration over a tint that already carries the word and glyph; their hue rings are not the only signal.

### 3a. States

Four states, each = fg + tint + edge + **glyph + word**. Colour is never alone, so greyscale print and Windows forced-colours stay correct.

| State | Glyph | Word | Meaning in SMS |
|---|---|---|---|
| OK | ● | OK | Within limits, nothing to do |
| Watch | ▲ | Watch | Drifting or near limit; look soon |
| Act | ■ | Act | Out of limit or failed; do something now |
| No data | ○ | No data | Not measured / sync lag / station silent. Never shown as OK or as zero |

Glyph shapes differ in silhouette (circle, triangle, square, hollow circle) for colour-blind readers. A state card has no left stripe: it takes the state tint and a 1px `--*-edge` ring, and a pill that prints the word. Station tiles: OK is quiet white with a hairline ring, Watch and Act glow softly, No data is flat grey. A state is always rendered by one component, `StatusPill`, or by a state-bearing parent (KpiCard edge, StationTile) that also prints the word. Thresholds that map numbers to states come from the server and Setup, not from the UI.

### 3b. Chart palette

`--cat-1..5` in fixed order (blue #2b59e0, magenta #e0457b, violet #7c5ce6, teal #0f9fb5, bronze #b8791b), assigned to an entity and kept (colour follows the entity, never its rank). A sixth series folds into `--cat-other` (#7f8aa4) or becomes small multiples. No green, amber or red hue appears in the categorical set, so a series can never be mistaken for a state. Validation with `validate_palette.js` (dataviz skill; light mode, #ffffff, 13 Oct 2026), five slots, adjacent pairs: lightness band PASS, chroma floor PASS, CVD separation PASS (worst adjacent #0f9fb5 vs #7c5ce6: deutan dE 14.8, tritan 12.7; target 8), normal-vision floor PASS (worst 21.6; floor 15), contrast vs surface PASS (all >= 3:1). **All-pairs fails for five slots** (blue #2b59e0 vs violet #7c5ce6: protan dE 2.6, normal 10.6), exactly as in the previous palette, so for scatter or any all-pairs form use slots 1, 2 and 5 only (all-pairs PASS: CVD 9.4 deutan / 10.8 tritan, normal 18.6, contrast >= 3). Blue and violet must not appear together there. `--cat-4` (3.16) and `--cat-5` (3.63) are under 4.5, and `--cat-2` is 3.96: they are marks, never text, and a teal or bronze series **must** carry a direct label or table view (the relief rule). Sequential `--seq-1..5` is one blue hue, lightness 0.82, 0.60, 0.39, 0.13, 0.06 (strictly decreasing). The in-limit band on charts is `--chart-limit-band` (OK-green at 10 %) plus dashed `--chart-limit-edge` lines; the band is labelled "In limits" so it is not a series.

**Bars.** A single-series bar chart fills bars with a vertical gradient, `--bar-from` #2b59e0 at the data end to `--bar-to` #8aa5f2 at the baseline, with 6 px rounded data ends. The gradient encodes nothing (the bar's height is the value), so it adds no information that colour alone must carry. Multi-series bars and stacked bars stay flat `--cat-n`. Gridlines are solid 1 px `--chart-grid`.

### 3c. Band, top bar and KPI icon chips

- **Status band**: `linear-gradient(120deg, --band-1 0%, --band-2 58%, --band-3 100%)`, `--radius-band` 24, padding 30 34 28, an inset 1 px white ring. It is the only gradient in the product apart from single-series bars. Contents: page title (`--fs-5`, `--accent`, bold), status sentence (`--fs-sent` 30, bold, `--ink-1`, at most 30 characters a line, plain words, e.g. "Four stations need attention."), one caption in `--ink-2`.
- **Top bar**: sticky, `--topbar-bg` (white at 72 %) with `backdrop-filter: blur(16px) saturate(1.6)`, `--radius-bar` 18, `--elev-topbar`. Content that scrolls under it is light, so text on it stays above 8:1.
- **KPI icon chips**: 38 x 38, `--radius-ctl`, icon 20 px in `--chip-n-fg` on `--chip-n-bg` (1 blue, 2 violet, 3 teal, 4 indigo, 5 slate). Assigned by metric, in a fixed order per screen, **never a state hue and never changed to signal status**.

## 4. Typography

| Step | Token | Size / line | Use |
|---|---|---|---|
| 1 | `--fs-1` | 12 / 16 | Captions, axis ticks, units, table header |
| 2 | `--fs-2` | 13 / 18 | Table body, pill, helper text, delta |
| 3 | `--fs-3` | 15 / 22 | Body, fields, nav |
| 4 | `--fs-4` | 18 / 26 | Card title, section heading |
| 5 | `--fs-5` | 24 / 30 | Page title (one per page, accent, bold, in the band) |
| Sentence | `--fs-sent` | 30 / 38 | Status sentence in the band, bold |
| KPI | `--fs-kpi` | 38 / 46 | KpiCard value, bold, `tnum` |
| 6 | `--fs-6` | 44 / 50 | Hero figure (the single headline number of a screen), weight 800 |

Weights (`--fw-*`): 400 body, 500 labels and nav, 600 card titles and pills, 700 page title, status sentence, KPI values, active nav item and selected segment, 800 hero figure and the wordmark only. Line length <= 72 characters in prose. Wall: add class `wall` to the root; every step and the three mid spacings multiply by `--wall-scale` (1.6), so 12 px becomes 19 px and a KPI becomes 61 px, readable at 3-4 m on 1920. Wall is a layout of the same components, not a different design.

## 5. Spacing, layout, elevation, motion

- Spacing: 4 px base, `--space-1..8` (4, 8, 12, 16, 24, 32, 48, 64). Card padding `--card-pad` 28; KPI padding `--kpi-pad-y` 22 / `--kpi-pad-x` 24; inside-card gaps `--space-3`/`--space-4`; page gaps `--gutter` (24); shell padding and the gap between sidebar card and main column `--shell-pad` 12.
- Grid: 12 columns, `--gutter` 24, max `--page-max` 1600, centred. Page padding 20 (16 under 768). One left edge: band, KPI row and cards all start at the same x.
- Breakpoints (`--bp-*`): 375 phone, 768 tablet, 1024 laptop, 1366 plant PC (primary design size), 1920 TV. Phone: sidebar becomes bottom tab bar (`--tabbar-h` 56, 5 items + "More"); tablet 768-1023: sidebar card collapsed to 72 (icons) ; 1024+: full 232. Collapsed state is user-toggled above 1024 and remembered per viewer.
- 1366x768 budget: shell padding 12 + topbar 56 + gap 12 leaves 676 px; the status band (about 130 incl. caption) plus the KPI row (about 150 with the icon chip) is taller than the first draft, so on 1366 the hero starts near the fold and must be compact (tiles 2 rows of 7 at 112). Rule: the hero never exceeds 50 % viewport height. Measure this in the build; if the hero does not fit, shorten the band caption first, then drop the KPI row to 4 cards.
- Radius: `--radius-card` 16 (cards, KPI cards, chart frames, empty/error states, sheets, dialogs), `--radius-tile` 14 (station tiles, sidebar items), `--radius-ctl` 12 (buttons, fields, table header ends, chips on KPI cards), `--radius-bar` 18 (top bar), `--radius-side` 22 (sidebar card), `--radius-band` 24 (status band), `--radius-pill` (pills, chips, segmented track and thumb, period chip). No other radii.
- Elevation: `--elev-0` flat (inside cards), `--elev-1` cards, KPI cards and the sidebar card (soft two-layer shadow, no border), `--elev-1-hover` on a card that is a link, `--elev-2` sheet, popover, dialog, `--elev-topbar` the frosted bar, `--elev-accent` the primary button, `--elev-seg` the selected segmented thumb, `--tile-*` the station tile rings and glows. Nothing else has a shadow.
- Motion: 120 ms (hover, press), 160 ms (expand, tab), 200 ms (sheet, drawer). `--ease`. Motion answers an action; nothing animates on load except skeleton shimmer. `prefers-reduced-motion` removes all of it. No count-up numbers; hover on a card that is a link deepens the shadow (`--elev-1-hover`), it does not move.

## 6. Component inventory

Notation: states = default / hover / focus / loading / empty / error / disabled. "Disabled-by-rank" is never shown as disabled: below the required rank a control is **absent**. "Disabled" in the table means disabled by a reason the user can fix (writes switched off by the server, form invalid).

Global rules: focus ring `:focus-visible` 2 px `--focus-ring`, offset 2 (sidebar uses `--side-focus`); hit target >= 44 px on touch (`--tap-min`), >= 36 (`--control-h`) on desktop; every icon-only control has a text tooltip and `aria-label`.

### 6.1 AppShell
Grid: floating sidebar card column + (frosted topbar over the page), padded and gapped by `--shell-pad`. Slot for page content. Loading: shell renders immediately, page area shows page skeleton. Error: shell stays; page area shows ErrorState (a failing screen never blanks the sidebar). Do: one shell for every screen incl. Setup. Don't: nested scrollbars; only the page area scrolls (sidebar fixed, topbar sticky). Wall: shell without sidebar/topbar, header strip only.

### 6.2 Sidebar
232 wide white card, `--side-bg`, `--radius-side` 22, `--elev-1`. Top: wordmark "SMS" (weight 800, `--side-fg-strong`) + plant name "Ibrahim Fibres, TP1 Line 3" (`--side-fg-dim`). Items (icon 20 + label), grouped (approved IA, 13 Oct 2026): **Monitor** (Today, Quality), **Operate** (Products & PDAS), **Analyse** (Reports), **System** (Diagnostics, Setup, Account). The eight current screens map into these groups per IA-MAP.md. Items are 40 high, `--radius-tile`. Active = `--side-active-bg` fill + accent text (weight 700) + accent icon. Rank-gated items (Setup) are absent below rank. Bottom: health dot summary and collapse chevron. States: default, hover (`--side-bg-hover`), active, focus (accent ring), collapsed (icon only, tooltip with label). Don't: badges in colour other than a state glyph; more than 9 items.

### 6.3 TopBar
56 high, sticky, frosted (`--topbar-bg` + blur 16 + saturate 1.6), `--radius-bar` 18, `--elev-topbar`. Left: page title (`--fs-5`) may live in the page instead; topbar holds breadcrumb only when there is a drill-down. Right-to-left: user menu (name, rank, Sign out), **health dot** (StatusPill compact: glyph + "Data 2 min old" / "Data stale" / "No data"; opens a popover with the sync verdict and a link to Health), **PeriodChip**. Phone: title + PeriodChip + menu. States: health dot has all four states; popover loading/error as Section 6.17/6.18.

### 6.4 PeriodChip and PeriodPanel
Chip: pill button showing the resolved period in words ("Today, 6 Sep 2026", "Week 36, 31 Aug - 6 Sep", "Shifts A-B, 6 Sep") and a compare tag when on ("vs previous"). One chip app-wide, in the same place on every screen; screens do not have their own period controls.
Panel (popover, phone: bottom sheet): left list of presets **This shift, Today, Yesterday, This week, Last week, This month, Last month**, then "Custom range". Custom editor: From date + shift, To date + shift (shift select: whole day / 1st / 2nd / 3rd, 06-14-22), live resolved sentence below ("6 Sep 06:00 to 7 Sep 06:00, 3 shifts"). Nothing changes until **Apply** (primary) or **Cancel**; presets apply immediately on click. **Compare** switch: off / vs previous period / vs same period last week. When the plant clock's newest reading is older than the chosen period, the panel shows a one-line note "Newest data: 7 Sep 2026" with [Go to newest]. States: default, hover, focus, open, invalid range (Apply disabled with reason text: "End is before start"), loading none (local). Don't: auto-apply typing, per-screen duplicates, "Compare" hidden in a different place.

### 6.5 KpiCard
Anatomy (top to bottom): 38 px icon chip (`--chip-n-bg` / `--chip-n-fg`, `--radius-ctl`, never a state hue); label (`--fs-2`, `--ink-3`, medium) with a definition "i" button; value (`--fs-kpi` 38, bold, tabular) + unit (`--fs-2`, `--ink-3`); delta pill (`--surface-sunk`, `▲ 0.4 pt vs previous` in `--ink-2`; delta arrows are direction not state, and use ink, never green/red); StatusPill (optional) and one-line sparkline (optional, 96x24). State: `--*-tint` fill + 1 px `--*-edge` ring + pill text (no left stripe); neutral cards (no judgement, e.g. cones produced) are plain `--surface`, no pill. Definition tooltip: popover on "i" (click/focus; hover on desktop) with plain definition, formula, the limit used, and "Last updated". Caveats and assumptions go in Disclosure only, never in the card headline. Sizes: standard (min 200 x 96), compact in Wall hero strip. States: default, hover (cursor + underline label if it is a link to detail), focus, loading (skeleton at exact size, label visible, value block grey; never "0"), empty ("No data" pill + "-" value), error (value "-" + "Couldn't load" + Try again), disabled n/a. Do: max 5 per row at 1366, always same order across screens. Don't: more than one number in the value, gradients, an icon anywhere but the chip, a state hue on a chip.

### 6.6 StatusPill
Inline pill: glyph + word (+ optional short noun: "Act: 3 stations"). Height 24, `--fs-2`, semibold, `--*-tint` fill, no ring. 4 states from Section 3a. Compact variant: glyph only with text tooltip, only where a word sits adjacent (table cell with a word column). Never used as a button.

### 6.7 StationHeatGrid and StationTile (hero of Overview)
Grid: CSS grid, `repeat(auto-fill, minmax(168px, 1fr))`, gap `--space-3`; 14 stations at 1366 render in 2 rows of 7 without scroll. Sorted **worst first** (Act, Watch, No data, OK; tie by % failed inspection descending), with sort toggle "By station number". Tile (168 x 112): "Station 7" (`--fs-3` semibold); big number = **% failed inspection** (`--fs-4`); small lines: cones in period, weight offset ("-3 g vs target"), product code; StatusPill in the corner. `--radius-tile` 14. OK is quiet white with a hairline ring (`--tile-quiet`); Watch and Act use `--*-tint` with a soft glow (`--tile-watch`, `--tile-act`); No data is flat `--surface-sunk`. Click opens a station Sheet (6.11) with trend and last cones. Keyboard: arrow keys move across tiles, Enter opens. States: default, hover (ring deepens to 1.5 px), focus, selected (accent outline), loading (14 skeleton tiles, same size), empty ("No stations reporting" EmptyState), error (ErrorState replacing grid), no-data tile (hollow glyph, "No data", last seen time). Tiles with no product in force show "No product". Don't: show the number without the word; reorder while the user hovers (re-sort only on data refresh, and freeze while hovered).

### 6.8 AttentionList
Right-hand or below-hero list of up to 5 items needing action, each: StatusPill, sentence ("Station 7 is 9 g below target for 3 shifts"), time, chevron. Sorted by state then recency. Empty = a calm line "Nothing needs attention." with OK glyph. Each row is a link to the drill-down. Don't: invent causes; statements are only what the data shows.

### 6.9 Chart kit
Shared frame (`ChartFrame`): title row (h2 + unit), optional legend, plot, caption row. Anatomy: y-axis with unit and 3-5 ticks (`--chart-grid` gridlines, `--ink-3` ticks, zero baseline for bars), x-axis time or category, legend always present for >= 2 series (swatch + words, never colour only) plus direct labels for <= 4 series, tooltip on hover/focus (value, unit, time, state if any), table-view toggle ("Show as table") for accessibility. 2 px surface gap between adjacent fills; lines 2 px; markers >= 8 px; 6 px rounded data-ends on bars anchored to the baseline; solid grid lines. Click-to-zoom on time charts sets the page period (existing behaviour) with a visible "Zoomed in - Back" control by the chart.
- **Bar** (stations, shifts, reject codes): horizontal when labels are long; sorted worst-first or by value; one series uses the `--bar-from` to `--bar-to` gradient with 6 px rounded data ends; state is not used for bar colour except the bar of a station in Act with the glyph in the label.
- **Line/Area** (weight over time, reject rate): `--cat-n` lines; shaded in-limit band (`--chart-limit-band`) with dashed limit lines labelled "Upper limit 1,990 g"; points outside the limits get a state-edge ring plus glyph. Area only for a single series.
- **Pareto** (reject reasons): bars descending in the bar gradient, cumulative line in `--ink-2` with 100 % axis on the right (the only dual-scale allowed because the second axis is a cumulative share of the same quantity, labelled), top-3 labelled.
- **Sparkline**: 96x24, `--cat-1` or `--ink-3` line, last point dot; no axes; always paired with a number; tooltip on hover.
- **Histogram** (cone weight distribution): `--seq-4` bars with 2 px gap, target and limit lines overlaid, in-limit band; bin width stated.
States: default, hover (crosshair/ bar highlight + tooltip), focus (keyboard moves through marks), loading (skeleton at the plot's exact size, axes absent), empty ("No readings in this period" with newest-data action), error (ErrorState inside frame). Don't: dual axes, rainbow, pie/donut, 3D, data labels on every point, grid darker than `--chart-grid`, colour as the only distinguisher.

### 6.10 DataTable
One table style, set inside a card: `--fs-2` body, 44 px rows (comfortable 48 on touch), header `--surface-sunk`/`--ink-3` `--fs-1` semibold with `--radius-ctl` rounded ends, sticky header, numerals right-aligned tabular, text left, 1 px `--line` row separators, zebra none, hover row `--accent-tint`. Sortable headers show ▲▼ with aria-sort. Wide tables scroll horizontally with a **scroll cue** (right-edge fade 24 px + "Scroll for more" caption while unscrolled). Under 768 the table becomes a **card list** (first column = title, other columns as label/value pairs, max 6, "Show all" disclosure). Pagination: keyset "Load more" or page controls, always showing "Showing 1-50 of 1,204". Row action: whole row click opens Sheet; no per-row icon buttons except a chevron. States: default, hover, focus (row outline), selected, loading (skeleton rows, same count/height), empty (EmptyState in the body), error (ErrorState; keeps header), disabled n/a. Don't: more than 8 columns without grouping, truncating numbers, horizontal scrolling of the whole page.

### 6.11 Sheet / Drawer
Right-side drawer 480 wide (640 for reading-sheet detail), phone: full-height bottom sheet. `--elev-2`, scrim `--scrim`, close button top right, Esc closes, focus trapped and returned to the trigger. Header: title (`--fs-4`), StatusPill, close. Sticky header; body scrolls; footer for actions. 200 ms slide. Used for station detail, reading detail, DQ finding, reject code. URL carries sheet id so back button closes it.

### 6.12 Tabs and Segmented
**Tabs**: page-level sub-views (e.g. Product: Running, Changeover, Catalogue, History). Underline style: 2 px `--accent` under active, text `--ink-1`; inactive `--ink-3`; sticky under the page title; on phone scroll horizontally with edge fade. Rank-gated tab absent. **Segmented**: 2-4 mutually exclusive options that change the view of the same data (By station / By hour; Count / Percent). Pill track `--surface-sunk`, thumb `--surface` with `--elev-seg`, selected text `--ink-1` bold. States: default, hover, focus, selected, disabled (reason tooltip). Don't: tabs for filters, segmented with more than 4.

### 6.13 EmptyState
Centered in the container, icon (24, `--ink-3`), one sentence saying why, one action. Canonical: **"Nothing in this period. Newest data: 7 Sep 2026. [Show it]"**. Variants: no data yet ("No readings yet. The line may be stopped or data is delayed."), nothing needs attention (calm OK), filter returns none ([Clear filters]). Never uses a state colour except No data glyph. Not for errors.

### 6.14 ErrorState
Names the failed part in plain words: **"Couldn't load the reject chart."** Second line: cause in user terms ("The server did not answer"), third: **[Try again]**. Appears at the scale of the failed part (a card, a table, a tile) so the rest of the page stays alive (partial-failure rule). `Act` glyph and `--act-fg`. Never shows "0" or an empty chart for a failed fetch. After repeated failure adds "Check Health". Errors are plain and do not apologise.

### 6.15 Skeleton
Same box as the content it replaces (measured: KPI value block, chart plot, tile, table row), `--surface-sunk` shimmer 1.4 s (static under reduced motion), no numbers, no "0". The page title and labels render immediately (they are not data). Do not show a skeleton for longer than 10 s; then ErrorState "Taking too long".

### 6.16 Wizard / Stepper (Changeover: plan -> review -> execute)
Horizontal numbered stepper (real sequence, numbering is legit), 3 steps: **Plan**, **Review**, **Execute**; done = check, current = accent ring, upcoming = grey. Phone: "Step 2 of 3 - Review" bar. Each step: form or read-only summary in a card; footer with Back (quiet) and primary Next/Run. Review lists exactly what will be written ("Retire pallet 1023. Create material 12 with blend 2, count 3, tube 4") with blockers as Act pills; Execute requires ConfirmDialog. Execute button follows WriteGate. States: step invalid (Next disabled with reason), loading (button spinner label "Planning"), error (ErrorState with server message verbatim), success (Done summary with "View history").

### 6.17 Form fields
Label above (`--fs-2` medium `--ink-1`), field 36 high (44 touch), `--radius-ctl`, border `--line-strong`, focus ring, helper text below (`--fs-1` `--ink-3`), error text below with Act glyph and `--act-fg`, border `--act-edge`. **Number + unit**: input with unit suffix inside right (`--ink-3`), numeric keyboard, step and min/max shown as helper ("20 to 500 g"). **Select**: native `<select>` styled with chevron. **Reason textarea**: min 3 rows, counter "10 characters minimum" (matches server rule), required star as word "(required)". Disabled: `--surface-sunk`, text `--ink-3`, reason in helper text. Inline validation on blur, never on every keystroke.

### 6.18 ConfirmDialog
Centered modal 440 wide (phone: bottom sheet), `--elev-2`. Title is the action ("Run changeover?"), body states exactly what changes and that it writes to PDAS/the plant database, buttons: [Cancel] (quiet, default focus) and [Run changeover] (primary; Act-edge variant for destructive: "Retire"). Esc = cancel. Result becomes a toast and a line in History using the same verb ("Changeover ran").

### 6.19 Disclosure ("How this is calculated")
Native `<details>`: summary row `--fs-2` `--accent` with chevron, body on `--surface-sunk`, `--fs-2`, contains definitions, formula, assumptions ("Assumed until IFL confirms ..."), data caveats. The only place for caveats. Collapsed by default; open state remembered per section per viewer. One at the foot of each card or page section, same wording pattern.

### 6.20 Chip
Removable filter/selection tag: pill, `--accent-tint` fill, `--accent` text, x button (44 hit target on touch). Read-only info chip: `--surface-sunk` + `--ink-2` (product code, winder number). Chips never use state colours; for state use StatusPill.

### 6.21 WriteGate
Wrapper for any control that writes. Below the required rank: renders **nothing** (absent, not disabled). At rank but server says writes are off: control rendered disabled with the server's `disabledReason` shown **verbatim** underneath in `--ink-3` with a lock icon, plus aria-describedby. Rank is never inferred client-side beyond the existing `EXPORT_RANK`-style constants checked against server by the existing cross-check test. Applies to Export, Setup edits, Changeover, Calibration, Product set.

### 6.22 Icon set
Hand-drawn inline SVG, 20x20 grid, 1.75 stroke, round caps, `currentColor`, no new dependency. 22 icons: overview, stations, rejects, sacks, weight, product, reports, health, setup, calendar, compare, chevron-down, chevron-right, close, info, lock, download, print, refresh, search, check, menu. State glyphs (● ▲ ■ ○) are text/SVG shapes, not part of this set. Each icon has a name in a single `Icon` component; decorative icons `aria-hidden`, standalone ones labelled.

### 6.23 Toast
Bottom-left, `--elev-2`, 5 s (persist if it has Undo or an error), one line with the same verb as the button. Not used for errors that block work (use ErrorState).

## 7. Uniformity rules (enforced by review and a lint/test in Phase C)

1. **Page template, always in this order:** (1) status band (h1 in accent + one status sentence + a caption of what the screen answers; page actions on the right; period lives in TopBar), (2) KPI row (3-5 KpiCards), (3) **hero** (one: heat grid, or the main chart), (4) detail (secondary charts, tables, Disclosures). A screen may omit rows, never reorder them.
2. **One left edge.** Title, KPI row, cards and tables share x = page padding. Cards fill 12-col spans of 3/4/6/8/12; no free widths.
3. **One card style:** `--surface`, `--radius-card`, `--elev-1`, no border, padding `--card-pad`, title `--fs-4`. No nested cards: inside a card use headings and `--line` dividers.
4. **One table style** (DataTable) and **one chart frame** (ChartFrame); no screen ships its own.
5. **One state vocabulary:** only OK/Watch/Act/No data, only via StatusPill, KpiCard edge or StationTile. No other green/amber/red anywhere (no green "Save" buttons, no red text for plain negatives). Direction of change uses ink arrows, not state colour.
6. **Caveats live in Disclosure only.** Never in a headline, tile, tooltip title or chart title. A figure that is uncertain is shown as No data or with "(estimated)" word plus Disclosure, never silently.
7. **Period is global.** Only PeriodChip changes it; every figure on screen names its period in the chart caption or table caption.
8. **Loading never shows a false zero;** failure is named by part; empty always offers the next action.
9. **Writes:** WriteGate everywhere; confirmations via ConfirmDialog; verbs identical in button, toast and History.
10. **Copy:** sentence case, no all-caps, no ellipsis, no "Assumed" text in headlines, units always shown beside numbers, dates "7 Sep 2026", times 24 h plant clock with "plant time" named once in TopBar tooltip.
11. **Spacing only from `--space-*` and the named layout tokens; radii only from `--radius-*`; colour only from tokens; font sizes only from `--fs-*`.** No raw hex or px sizes outside tokens.css.
12. **Max six type sizes per screen** (of the eight steps) and **max one hero** per screen.
13. **One gradient:** the status band. Single-series bars may use the bar gradient. No other gradient, no left-stripe accents, no icon chip in a state hue.

## 8. Responsive behaviour

| Width | Shell | Grid | Notes |
|---|---|---|---|
| 375 | Bottom tab bar (Today, Quality, Products, Reports, More), no sidebar, TopBar compact | 1 col, KPI 2 per row, tiles 2 per row | Tables become cards, Sheets are bottom sheets, PeriodPanel is a bottom sheet |
| 768 | Sidebar collapsed 64 | 8-col feel, KPI 3 per row | |
| 1024 | Sidebar 232 | 12 col | |
| 1366 | Sidebar 232 | 12 col, design size | Hero + KPI row above fold |
| 1920 | Sidebar 232 | max 1600 centred | Wall mode (`.wall`) for TV |

## 9. Accessibility

AA text everywhere (Section 3). The frosted top bar and the soft tile glows never carry meaning alone. Focus always visible. State = colour + glyph + word. Charts have a table view and keyboard traversal. `prefers-reduced-motion` honoured; `forced-colors` rules in tokens.css give pills and cards system borders and keep the active nav bar. All interactive targets >= 44 px on touch. Language attribute and a place for Urdu strings stay in `words.ts` (no change).

## 10. Air-gap and dependencies

Self-hosted Manrope variable woff2 only (a font file, not an npm dependency; the Google Fonts link in the Style C canvas and the design-system previews is for design review only and must not ship); hand-drawn SVG icons; no icon fonts, no CDN, no new npm dependency. Charts stay on the existing `chart.tsx`/`ChartFrame.tsx` base, extended; nothing like a chart library is proposed.

## 11. Migration notes for Phase B/C

Old `app.css` tokens `--ok`, `--warn`, `--acc` map to `--ok-edge`, `--watch-edge`, `--accent`; `--radius` (6px) is gone, use the `--radius-*` family; `--side-active-edge` is gone (active nav is a fill, not a bar); `--elev-1` no longer includes a ring; old uses of green/red for plain text are removed. The 8 screens map onto sidebar groups in 6.2. Existing behaviours that stay: click-to-zoom with Back, polling opt-in, plant clock, rank gating, report types.

## 12. Component state matrix (summary)

| Component | default | hover | focus | loading | empty | error | disabled |
|---|---|---|---|---|---|---|---|
| Sidebar item | yes | yes | yes | n/a | n/a | n/a | absent below rank |
| PeriodChip/Panel | yes | yes | yes | n/a | newest-data note | n/a | Apply disabled when invalid |
| KpiCard | yes | link only | yes | skeleton | No data | Try again | n/a |
| StatusPill | yes | tooltip | n/a | n/a | n/a | n/a | n/a |
| StationTile | yes | yes | yes | skeleton | No data tile | grid ErrorState | n/a |
| AttentionList | yes | row | row | skeleton | calm OK line | ErrorState | n/a |
| Chart | yes | tooltip | yes | skeleton | EmptyState | ErrorState | n/a |
| DataTable | yes | row | row | skeleton rows | EmptyState | ErrorState | n/a |
| Sheet | open | n/a | trapped | skeleton | n/a | ErrorState | n/a |
| Tabs/Segmented | yes | yes | yes | n/a | n/a | n/a | with reason / absent below rank |
| Wizard | step | n/a | yes | spinner | n/a | server message | Next disabled with reason |
| Field | yes | border | ring | n/a | placeholder | message | with reason |
| ConfirmDialog | open | n/a | trapped | button spinner | n/a | message | n/a |
| Disclosure | closed | yes | yes | n/a | n/a | n/a | n/a |
| WriteGate | control | n/a | n/a | n/a | n/a | n/a | absent / disabled + verbatim reason |

## 13. Owner questions (for mockup review)

OQ-1. Sidebar groups and the 8 to 9 item set in 6.2: approve or reorder.
OQ-2. Accent blue and the 5-colour categorical set include a bronze; confirm bronze is acceptable (it sits near Watch amber in hue family but fails no CVD or normal-vision check; if it feels confusable, a swap to slate-grey-blue costs one chart slot).
OQ-3. RESOLVED 13 Oct 2026: Manrope approved; self-host file pending owner (stack falls back to Instrument Sans until then). Original question: Font (decide before Phase B): Style C is drawn in **Manrope** (OFL, variable 400-800, supports tabular figures). The app currently self-hosts Instrument Sans. Switching means adding one Manrope variable woff2 (a font file, not an npm dependency) and an @font-face, removing the Instrument Sans file, and re-checking the 1366 layout because Manrope has different glyph widths from Instrument Sans (not yet measured against the real screens). Switch to Manrope, or keep Instrument Sans and accept a small drift from the Style C look?
OQ-4. RESOLVED 13 Oct 2026: Wall: dark Style C, token block `.wall.dark` (approved 13 Oct 2026; sms/web-next/src/styles/wall-dark.css).
OQ-5. Threshold ownership: which numbers map to Watch vs Act (e.g. % failed inspection, weight offset) come from the server/Setup; confirm IFL values or keep the assumed defaults printed in Disclosure.
OQ-6. Phone bottom tab: which 4 items besides "More".
OQ-7. The status sentence in the band ("Four stations need attention.") is server-derived plain text from the same thresholds as the states; confirm that one sentence per screen is wanted on every screen, or only on Overview.

## 14. Non-goals in v1
No dark theme for desk and phone (the sidebar is light too); the only dark surface is the TV wall: dark Style C, token block `.wall.dark` (approved 13 Oct 2026), no user-themed colours, no animation beyond Section 5, no new dependencies, no change to data, API or rank rules.
