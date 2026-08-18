# Handoff: SMS interface rework (IFL Sack Management System)

## Overview

A complete UI/UX rework of the SMS web app — the reporting front end for the TP1 Line 3 / Unit 2 yarn cone line at Ibrahim Fibres Limited. The existing app (`sms/web/src/App.tsx` + `styles.css`) keeps all of its data logic; what changes is the shell, the visual language, and how findings are surfaced.

Four goals drove the rework:

1. **Every page should look different.** The old app rendered seven pages through one panel component, so Overview, Weight and Rejects were visually indistinguishable. Each screen now has a signature element and its own layout.
2. **Lighter chrome.** The heavy green bezel/instrument-rack theme is gone. Surfaces are light steel and white; a single safety orange carries alarm and emphasis.
3. **Far less prose.** Explanatory paragraphs are replaced with one-sentence verdicts that state the finding in plain language ("Station 5 is 24 g light. Station 10 is 19 g heavy.").
4. **Statistics on demand.** SPC rigour is retained but sits behind a *Show the maths* toggle instead of leading the page.

Readability was an explicit requirement: the interface is read at a desk **and** on a wall-mounted screen on the floor, by engineers of a wide age range. Nothing sits below 12 px, body text is 16 px, and every figure is set in a mono face at 24–46 px.

## About the design files

`SMS Rework.dc.html` in this bundle is a **design reference written in HTML** — a prototype of the intended look and behaviour, not production code to lift. The task is to **recreate it inside the existing `sms/web` React + TypeScript + Vite app**, using that app's established patterns: the `api.ts` client, the existing state hooks, the existing chart-drawing approach (hand-rolled SVG, no chart library), and the existing routing via `URLSearchParams` + History API.

Do not port the prototype's inline styles verbatim. Rebuild the token set in `styles.css` (the file already centralises colour/type/spacing as CSS variables — replace the values, keep the mechanism) and re-express the layouts as React components.

Two supporting files are included for reference: `Direction B - Night Deck.dc.html` and `Direction C - Paper and Petrol.dc.html` are **rejected** alternative directions, kept only so the chosen palette's reasoning is legible. Build against `SMS Rework.dc.html` only.

## Fidelity

**High-fidelity.** Colours, type sizes, weights, spacing, borders and copy are final and should be matched. Chart geometry (bar widths, band positions, axis labels) is also final; the numbers plotted are representative sample data drawn from real profiling figures and must be replaced by live API data.

## Design tokens

Replace the token block at the top of `styles.css` with these values. Names below are suggestions; the existing file's naming convention (`--ink`, `--paper`, `--card`, …) can be kept.

### Colour

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#16191C` | Primary text, dark rail, dark panels, primary data marks |
| `--ink-2` | `#2C3034` | Hover state for dark surfaces, rail hairline |
| `--graphite` | `#4A5057` | Secondary text (16 px and below), table secondary cells |
| `--muted` | `#6B7178` | Labels, captions, axis ticks |
| `--muted-2` | `#8C9298` | SVG axis band labels, chart hairline text |
| `--disabled` | `#9AA0A6` | Chevrons, inactive glyphs |
| `--paper` | `#EFEFEC` | Page background |
| `--paper-2` | `#F2F2EF` | Table headers, chart shift bands, selected row |
| `--paper-3` | `#F6F6F3` | Row hover, stat tiles |
| `--card` | `#FFFFFF` | Panels, cards, inputs |
| `--rail-bg` | `#16191C` | Icon rail |
| `--column-bg` | `#E5E6E1` | Section column |
| `--hairline` | `#D3D5D1` | Panel borders, column divider |
| `--hairline-2` | `#E7E8E4` | Row dividers inside panels |
| `--field-border` | `#C6C9C4` | Input and button borders |
| `--track` | `#E4E7E3` | Bar-chart track |
| `--neutral-mark` | `#B9BEB8` | Non-flagged bars in SVG charts |
| `--steel-mark` | `#6E7B85` | Secondary series line, dashed series |
| `--slate-mark` | `#3F4956` | Histogram in-spec bars |
| `--alarm` | `#D8451B` | Safety orange — flagged data, alarm rules, active nav marker, primary CTA on login |
| `--alarm-ink` | `#A5330F` | Alarm text on light backgrounds (AA on `--card` and `#FBE9E4`) |
| `--alarm-pale` | `#FBE9E4` | Alarm chip / band fill |
| `--alarm-border` | `#E9A895` | Alarm chip border |
| `--alarm-soft` | `#E4A38F` | Secondary alarm bars (short stops, minor Pareto rows) |
| `--alarm-bright` | `#FF7A4D` | Alarm on the dark `--ink` surface only |
| `--warn` | `#C98A12` | Amber — warnings, "waiting on IFL", pending rules |
| `--warn-ink` | `#8A5E0C` | Amber text on light |
| `--warn-pale` | `#FBF3E1` | Amber band fill |
| `--warn-border` | `#E3C88A` | Amber band border |
| `--ok` | `#157F4F` | Target lines, healthy state |
| `--ok-ink` | `#14663F` | "in range" pill text |
| `--ok-pale` | `#E8F2EB` | "in range" pill fill |
| `--ok-dot` | `#2FA36A` | Live sync indicator |
| `--ok-bright` | `#4FBF87` | Quality bar on the dark OEE panel |

**Colour rules.** Orange means *a number needs attention* or *this is the active view* — never decoration. Amber means *not confirmed / watch it*. Green appears only as a target line, a healthy status dot, or an "in range" pill. Plain data marks are `--neutral-mark` / `--slate-mark` / `--ink`.

### Typography

- **Sans:** `Archivo` (Google Fonts, weights 400 / 500 / 600 / 700), fallback `system-ui, sans-serif`. Chosen for large apertures and an unambiguous `1 / l / I`.
- **Mono:** `DM Mono` (weights 400 / 500), fallback `ui-monospace, monospace`. **Every numeral in the app** — KPI values, table cells, axis labels, timestamps, eyebrow labels — is set in DM Mono. Prose is never mono.

| Role | Size / weight / tracking |
|---|---|
| Login headline | 58 px / 600 / −0.03em |
| Page headline (day, verdict) | 34 px / 600 / −0.03em |
| Screen verdict sentence | 28–30 px / 600 / −0.025em |
| Section column title | 28 px / 600 / −0.03em |
| Panel sub-verdict | 22 px / 600 / −0.02em |
| Panel title | 19 px / 600 / −0.01em |
| Finding row title | 17.5 px / 600 |
| Card title (shift name) | 24 px / 600 / −0.02em |
| Body / list text | 16 px / 400 |
| Secondary body | 15 px / 400 |
| Caption | 14–14.5 px / 400 |
| Eyebrow label (mono, uppercase) | 12 px / 400 / 0.16–0.18em |
| Rail label | 12.5 px / 600 / 0.04em |
| KPI value (mono) | 42 px / −0.035em |
| Reject headline number (mono) | 46 px / −0.04em |
| OEE hero (mono) | 76 px / −0.05em |
| Stat value (mono) | 26–30 px |
| Table cell (mono) | 15 px |
| SVG axis tick (mono) | 11.5–12.5 px |

Line height: 1.45 body, 1.1–1.15 headlines.

### Geometry

- **Radius:** `4px` on panels, cards, buttons, inputs, pills; `3px` on inner chips and bar tracks; `999px` on toggle switches only. No large radii — the language is squared-off.
- **Borders:** 1 px `--hairline` on panels. Emphasis rules: 5 px left border (`--alarm`) on the Weight verdict banner; 5 px top border on shift cards; 4 px left marker on active nav items.
- **Shadows:** none anywhere. Depth comes from surface value and hairlines.
- **Spacing scale:** 4 / 8 / 12 / 14 / 16 / 18 / 22 / 24 / 28 / 34 / 44 px. Panel padding 22–28 px; grid gaps 14 px; main content padding `28px 34px 44px`.

## App shell

Three columns, full viewport height, `overflow: hidden` on the shell; only the main column scrolls.

```
┌───────┬──────────────┬────────────────────────────────┐
│ 92px  │    250px     │              1fr               │
│ icon  │   section    │            content             │
│ rail  │   column     │                                │
└───────┴──────────────┴────────────────────────────────┘
```

**Icon rail** (`--rail-bg`, `#16191C`): wordmark "SMS" 20 px/700 white, 1 px `--ink-2` divider beneath. Seven nav buttons, each a 21 px stroked SVG glyph (`stroke-width: 1.8`, `currentColor`) above a 12.5 px/600 label: **Line, Records, Output, Weight, Rejects, Shifts, Setup**. Idle `#A5ABB0`, hover `#FFFFFF`. Active state: `#22262A` fill inset `2px 8px`, radius 4, plus a 4 px `--alarm` bar flush to the left edge. A **Out** (sign-out) button is pinned to the bottom in `#767C81`.

Nav labels are deliberately shorter and plainer than the old app's ("Output" not "Performance", "Records" not "Register", "Setup" not "Admin").

**Section column** (`--column-bg`, right border `--hairline`):
- Header: mono eyebrow 12 px/0.18em uppercase in `--alarm`, then the section title 28 px/600.
- Sub-tab list: one button per sub-view, 16.5 px/600 label + 14 px `--muted` note. Active tab = white fill, 1 px `#CFD2CD` border, 4 px `--alarm` left bar. Hover `#DBDCD7`.
- Footer, pinned bottom, divided by a hairline: **Running now** (product `PVT8020 · 30 · Khaki-2`, `lot 204-ILT-BR · setpoint 1 960 g`), a pulsing green dot + `synced 42 s ago`, and the user chip (34 px square `--ink` initials tile, name, mono uppercase role).

The old app's `DisplayScale` (A/A/A text-size control) and top-bar freshness badge are removed from the header; freshness moves into the section-column footer. If the wall-display use case still needs a scale control, re-add it as a Setup preference rather than persistent chrome.

### Section column contents per screen

| Screen | Eyebrow | Title | Sub-tabs (note) |
|---|---|---|---|
| Overview | Live picture | The line | Today (9 July · all shifts) · Yesterday (8 July) · This week (3 – 9 July) |
| Records | Every reading | Records | Cones (142,511 rows) · Sacks (5,462 rows) |
| Output | How the line ran | Output | Effectiveness (OEE and its three parts) · Stops (one day's downtime) · Patterns (when stops repeat) |
| Weight | Grams per cone | Weight | Spread (distribution and stations) · Stability (control through the day) |
| Rejects | 3,146 in 18 days | Rejects | Reasons (inspection codes) · Trend (bursts vs noise) · By station (where they happen) |
| Shifts | Morning · evening · night | Shifts | This week (3 – 9 July) · Whole record (22 Jun – 10 Jul) |
| Setup | Configuration | Setup | People (4 accounts) · Stations (14 positions) · Rules (weight and shift) · Sync (plant connection) |

## Screens

### 1. Login

Two panes, `1.1fr / 1fr`.

Left pane on `--ink`: wordmark + mono `TP1 · Line 3 · Unit 2`; headline "Sack Management System" 58 px/600 clamped to ~17ch; one-line description 19 px `#B6BBBE`; three mono figures (142,511 cones on record / 5,462 sacks packed / 14 stations); bottom row pulsing green dot + `plant link online · synced 42 s ago`.

Right pane on `--paper`: mono eyebrow "Sign in" in `--alarm`, heading "Plant account" 38 px/600, then Username and Password fields (14 px/600 uppercase labels, white inputs, 1 px `--field-border`, 14/16 px padding, mono 17 px value, focus border `--ink`), a full-width `--alarm` submit button (18 px/600, white text, hover `#B03714`), and a hairline-divided note on role capability.

Wire to `login()` / `getMe()`; keep the existing error surface (15 px text in `--alarm-ink` on `--alarm-pale`).

### 2. Overview — signature: the 24-hour run/stop ribbon

- **Header:** mono eyebrow `Production day · last complete`, headline "Thursday 9 July" 34 px, and a shift segmented control on the right (white, 1 px border, 4 px padding; active segment `--ink` fill, white text, 15 px/600). Header sits on a 2 px `--ink` bottom rule — the one heavy rule in the app, and the Overview's own marker.
- **Line ribbon panel:** verdict line "Line ran 21 h 32 m of 24 h" 29 px/600 with "7 stops · longest 1 h 14 m at 02:10" beneath; three mono stats right-aligned (Availability 89.7 % in `--alarm`, between-stops 3 h 05, to-restart 21 m). Below, a 52 px `#DDE3DE` track spanning 06:00 → 06:00; each stoppage is an absolutely positioned `--alarm` block at `left = (hoursFromShiftStart / 24) × 100%`, `width = max(0.45%, duration/24 × 100%)`, `title` = duration. Two 1 px `rgba(22,25,28,0.3)` shift dividers at 33.33 % and 66.66 %. Mono axis row beneath: `06:00 MORNING · 14:00 EVENING · 22:00 NIGHT · 06:00`.
- **KPI row:** four equal cards. Mono uppercase label 12 px, mono value 42 px, 14.5 px foot, then a 7-day sparkline (`viewBox="0 0 92 26"`, `preserveAspectRatio="none"`, 1.5 px stroke, baseline hairline at y=25). Cones/Sacks/Sack weight strokes are `--ink`; Rejected cones is `--alarm`.
  - Total Cones → `7,842` / 99.7 % in weight range
  - Rejected Cones → `176` / 2.19 % of all weighed
  - Total Sacks → `318` / 24.7 cones per sack
  - Sack Weight → `15,015 kg` / 47.2 kg average · gross
- **Needs a look** (`1.35fr`): panel header with "3 open" count; one row per finding — 5 px full-height severity bar (`--alarm` fault, `--warn` warn), 17.5 px/600 title, mono 13.5 px detail, 22 px chevron. Row hover `--paper-3`. Footer line: "Each one opens the page that explains it."
- **Cones by shift** (`1fr`): three `82px / 1fr / 72px` rows — mono uppercase name, 14 px bar (track `--track`, fill `--ink`, `--alarm` for the trailing shift), mono 16 px value. Closing sentence: "Night runs 15 % behind the other two — same pattern every day this week."

### 3. Records — signature: full-height table with a sticky detail rail

- **Filter row:** active filters as removable chips (white with `--field-border`; the out-of-range chip uses `--alarm-pale` / `--alarm-border` / `--alarm-ink`), a dashed `+ filter` button, a mono row count, and an `--ink` **Export CSV** button. This replaces the old nine-field filter grid: filters become chips, added on demand.
- **Table** (`1fr`): header row on `--paper-2`, mono 12 px/0.14em uppercase, columns `1.6fr 0.9fr 0.6fr 1fr 1.1fr` — Production time ↓ / Shift / Stn / Weight (right) / Status (right). Rows are buttons: mono 15 px, 13/22 px padding, `--hairline-2` divider, hover `--paper-3`, selected `--paper-2`. Status pill: 3 px radius, 13 px, `--ok-pale`/`--ok-ink` or `--alarm-pale`/`--alarm-ink`. Pager row beneath: mono "rows 1–10 of 412" and prev/next.
- **Detail rail** (`356px`, `position: sticky; top: 0`): `--ink` header with mono eyebrow "Selected cone" and `#142511`; then key/value rows (14.5 px `--muted` key, mono 15 px value, hairline divider) — Production time, Shift (corrected), Shift as stored (`--warn-ink` when it disagrees), Station, Weight (`--alarm-ink` when out of range), Against setpoint, Hanger, Product, Merge key (`--ok-ink` when unique), Source. Two actions: **See its station** (`--ink` fill) and **Readings around it** (outline).

Selecting a row updates the rail in place; keep the existing `?v=register&dtype=&did=` permalink route for the full detail page.

### 4. Output — signature: dark OEE block

- **Effectiveness:** left `340px` panel on `--ink` — mono eyebrow, hero `76.5 %` at 76 px in `--alarm-bright`, one plain sentence ("Typical for a line like this. 85 % is world-class."), then three factor rows (name + mono value, 10 px bar on `#2C3034` track: Availability `--alarm-bright`, Performance `#B6BBBE`, Quality `--ok-bright`, 14 px note). Right column: **Last 7 days** OEE column chart (`viewBox="0 0 620 190"`, 54 px bars, `--neutral-mark`, latest day `--alarm`, mono value above each bar, dashed `--ok` line at 85 with "85 target" label) and **Where the missing 23.5 % went** — three mono figures (2 h 28 stopped `--alarm`, 1 h 51 slow `--warn`, 176 rejected).
- **Stops:** verdict "One stop cost more than the other six together" 28 px, then a stoppage timeline (`viewBox="0 0 900 210"`) with three shift bands (`--paper-2` / `#E9EAE5` / `--paper-2`) labelled MORNING / EVENING / NIGHT, bar height ∝ duration (`--alarm` over 45 min, `--alarm-soft` below), mono duration label above each. Below, a stops table (Start / End / Down / Share of the day's downtime) where share is a 12 px `--alarm` bar plus mono percentage.
- **Patterns:** verdict "Stops cluster at 02:00 and 14:00", 24-hour histogram (28 px bars, `--alarm` where count ≥ 8, morning band shaded), then three mono summary figures (96 stops in 18 days / 68 % under ten minutes / 4 over an hour).

### 5. Weight — signature: verdict banner with a 6 px alarm edge

- **Verdict banner:** white panel, 6 px `--alarm` left border. Mono eyebrow "Verdict", sentence "Cones run 8.5 g light of the 1 960 g setpoint" 30 px/600, one supporting line, and three mono stats right-aligned (mean 1 951.5 g, spread σ 18.4 g, Cpk 0.57 in `--alarm`). Shown above both sub-tabs.
- **Spread:** histogram (`viewBox="0 0 900 250"`, 12 bins of 10 g from 1900 g) — in-spec bars `--slate-mark`, out-of-spec `--alarm`; spec window shaded `#EDF3EE`; dashed `--ok` setpoint line labelled "setpoint 1 960"; solid 1.8 px `--alarm` mean line labelled "mean 1 951.5"; mono bin labels; axis title "GRAMS PER CONE". Then the per-station deviation chart: zero line `--muted-2`, dashed ±12 g threshold lines, 38 px columns diverging from centre (`--alarm` when past threshold, else `--neutral-mark`), signed mono value at the bar tip, station number below in `--alarm-ink` when flagged. Panel title is the finding itself: "Station 5 is 24 g light. Station 10 is 19 g heavy." with "The other twelve sit inside the band — leave them alone."
- **Stability:** "The mean held steady all day" + one line, and a **Show the maths** toggle (outline button, hover inverts to `--ink`). X̄ chart: control band `#F0F2EF`, dashed centre line, 1.8 px `--steel-mark` series, 3.4 px `--ink` points, 5 px `--alarm` points for violations. With the toggle on, a hairline-divided strip appears: mono eyebrow "Capability · hourly subgroups of ~330 cones" and five stats — Cp 0.72, Cpk 0.57, σ within 18.4 g, Groups out 2 / 24, Out of range 0.29 % — each with a 14 px plain-language note.

### 6. Rejects — signature: fix-this-first card

- **Reasons:** left column, two stacked count cards (Quality 2,900 at 46 px with a 92 % `--alarm` bar; Weight 246 with an 8 % `--warn` bar). Right, the Pareto panel: verdict "Two inspection codes cause 3 in 4 rejects", five rows of `210px / 1fr / 150px` (mono code + 14 px hint, 24 px bar, mono count + `--muted` percentage), bars `--alarm` for the top two, `--alarm-soft`, then `--neutral-mark`. Closing amber band: "Waiting on IFL — Name these five codes and this page becomes an action list." Keep the existing inline label-editing affordance for manager+ (`setRejectLabel`).
- **Trend:** verdict "A 3-day burst, not a bad day". p-chart (`viewBox="0 0 900 230"`): burst window shaded `--alarm-pale`, dashed centre line labelled 2.19, dashed UCL, 2 px `--steel-mark` series, `--alarm` points above the limit, mono day labels. Two episode cards beneath — the burst in `--alarm-pale`/`--alarm-border`, the single-day spike in `--paper-2`/`--hairline`.
- **By station:** the fix-this-first card on `--ink` — mono eyebrow "The one to fix first" in `--alarm-bright`, "Station 5 is both 24 g light and rejecting 1.9× the line" 30 px/600, then one sentence on why the cross-reference matters. Below, reject rate by station (38 px bars, dashed baseline at 2.19 %, `--alarm` past the practical threshold, mono `%` label above each bar).

### 7. Shifts — signature: three cards, one per shift

Three equal cards, each with a 5 px top border (`--ink` morning, `--steel-mark` evening, `--alarm` night). Card head: shift name 24 px/600, mono hours, and a verdict line ("Steady, on the line average" / "Best output of the three" / "15 % behind, every day" — the last in `--alarm-ink`). Card body: five key/value rows (Cones, Reject rate, Mean weight, Uptime, Stops); the trailing shift's poor values print in `--alarm-ink`.

Below, the trend panel: "Night has trailed for 18 days straight" 22 px + one line, then a three-series line chart on a shared day axis (`viewBox="0 0 900 240"`, gridlines with mono right-edge labels; morning solid `--ink`, evening dashed `--steel-mark`, night dotted `--alarm` — dash pattern is a redundant channel so the chart survives greyscale and colour-vision deficiency). Legend uses matching rule styles. Footer: mono "Data note" in `--warn-ink` + "Shift is recomputed from production time. The plant's stored value is wrong on 31 % of rows."

### 8. Setup

- **People:** panel with an `--ink` "Add person" button; header row on `--paper-2`; rows of Name / Username (mono) / Role / Status pill / Edit outline button. Footer sentence describes role capability in plain words.
- **Stations:** two-column list of 14 rows, mono index right-aligned in a 44 px cell, then an editable name field (`#FBFBF9`, 1 px `--field-border`, 15.5 px). Flagged stations (5, 10) print in `--alarm-ink`.
- **Rules:** four cards, each with an 18 px/600 title, a plain-language note, a pill toggle (`--ink` on / `--field-border` off, 22 px white knob), and the rule's current value in mono. Rules: recompute shift from production time; flag cones outside ±12 g; drop sacks under 40 kg; treat sack weight as gross (**off / pending IFL confirmation** — this is the Q4/Q5 open question made visible).
- **Sync:** pulsing green dot + "Sync is healthy — 1 214 runs, no failures" 28 px, one line ("Reads IFL's server every 60 s. Never writes to it."), four stat tiles (runs since install / since last run / failures / median query), then three mono chips: source server, watermark, read-only login.

## Screen → API mapping

Everything below already exists in `sms/web/src/api.ts`. No new endpoints are required for the rework.

| Screen / element | Call |
|---|---|
| Session, sign-in, sign-out | `getMe()`, `login()`, `logout()`, `setUnauthorizedHandler()` |
| Available date range (all date pickers) | `getRange()` |
| Overview KPI row | `getProduction({ from, to, shift, groupBy: 'none' })` |
| Overview KPI sparklines | `getProduction({ from: date-6, to: date, groupBy: 'day' })` |
| Overview cones-by-shift | `getProduction({ from, to, groupBy: 'shift' })` |
| Overview line ribbon, availability, MTBF/MTTR | `getDowntime(date, 120)` |
| Overview availability baseline | `getOee({ from: date-6, to: date-1 })` |
| Overview findings feed | derived client-side from `getSpc({ type:'cone', from, to })`, `getDowntime()`, `getOee()`, `getRejectSpc(from, to, 'all', 'day')` — same synthesis the current `exceptions` memo performs |
| Records table | `getEvents({ type, from, to, shift, station, inRange, wMin, wMax, sort, dir, page, pageSize })` |
| Records detail rail | `getEventDetail(type, id)` |
| Records "Readings around it" | two `getEvents()` calls with `tsTo` / `tsFrom` around the row's timestamp |
| Export CSV | `eventsExportUrl(query)` |
| Output → Effectiveness | `getOee({ from, to, thresholdSeconds })`; 7-day bars = one call per day or a day-grouped range call |
| Output → Stops | `getDowntime(date, thresholdSeconds)` |
| Output → Patterns | `getStoppagePatterns(from, to, thresholdSeconds)` |
| Weight verdict banner, station deviation, X̄ chart, capability | `getSpc({ type:'cone', from, to, productId })` |
| Weight histogram | `getWeights(basis, from, to)` |
| Rejects → Reasons | `getRejects(from, to)`; label editing `setRejectLabel(id, label)` |
| Rejects → Trend | `getRejectSpc(from, to, rejectType, bucket)` |
| Rejects → By station | `getProduction({ from, to, groupBy:'station' })` + `getSpc({ type:'cone', from, to })` for the weight cross-reference |
| Shifts cards + trend | `getShiftAnalysis(from, to)`, `getProduction({ groupBy:'shift' })` per day |
| Section-column "Running now" | `getCurrentProduct()`; picker `getProducts()`, `setCurrentProduct(productId, reason)` |
| Setup → People | `adminListUsers()`, `adminCreateUser()`, `adminUpdateUser(id, patch)` |
| Setup → Stations | `adminListStations()`, `adminSetStation(id, s)` |
| Setup → Rules | `adminGetRules()`, `adminSetWeightRule()`, `adminSetShiftRule()` |
| Setup → Sync | `metadata` envelope on any call (`lastSyncUtc`, `sourceAgeSeconds`, `weightBasis`) |

Freshness: every envelope carries `metadata`; feed it to the section-column sync indicator exactly as the current `onMeta` prop chain does. Dot colour follows `freshnessLevel(sourceAgeSeconds)` — `--ok-dot` / `--warn` / `--alarm`.

## Interactions & behaviour

- **Navigation.** Rail switches screen; section column switches sub-view. Keep the existing URL scheme (`?v=<view>`) and add the sub-view as a second param (e.g. `?v=weight&sub=spc`) so a finding can deep-link to the exact tab. Preserve `popstate` handling.
- **Findings drill-down.** Clicking a finding navigates to `{view, sub}` and carries the reason string. In the prototype the arrival banner is not drawn; keep the existing `NavContext` banner, restyled: `--ink` background, white 15.5 px title, `#B6BBBE` detail, outline back button, 4 px radius, no gradient.
- **Row selection.** Records rows are `<button>` elements (keyboard-activated by Enter/Space via the existing `activatable()` helper); selection updates the sticky rail without a fetch of the list.
- **Show the maths.** Local boolean on the Weight → Stability view, default off. Persist per browser in `localStorage` under a new key (`sms.showMaths`) if the user wants it sticky; do not reuse `sms.uiScale`.
- **Toggles in Setup** are optimistic with a revert on failure, as today.
- **Transitions.** 120–160 ms on hover colour/border only. Bars and sparklines may animate width/height once per data load, 650 ms `cubic-bezier(0.16, 1, 0.3, 1)`. Respect `prefers-reduced-motion: reduce` by disabling all of it (the existing global rule already does this). The only continuous animation is the 2.4 s sync-dot pulse.
- **Loading.** Skeleton blocks matching the target panel's height, `--card` → `--paper-2` shimmer, 1 px `--hairline` border. Never a spinner.
- **Empty.** One sentence in `--muted`, 15 px, inside a dashed `--field-border` box — e.g. "No production recorded this day."
- **Error.** Panel with 1 px `--alarm-border`, `--alarm-pale` fill, bold `--ink` lead ("Couldn't load production data.") and the message in `--alarm-ink`.
- **Role gating.** `ROLE_RANK` unchanged: operator 1, supervisor 2, manager 3, admin 4. Rail shows Line / Records / Shifts to operators; Output, Weight, Rejects from supervisor up; Export CSV from manager up; Setup admin only. The "Running now" footer is read-only below supervisor. Hide rail items the role cannot open rather than disabling them.
- **Responsive.** Desk-first at 1440 × 900. Below ~1200 px the KPI row goes to two columns and the Records detail rail drops beneath the table; below ~900 px the section column collapses into a horizontal sub-tab strip under the rail. The rail stays visible at all widths.
- **Wall display.** The layout is legible at 1920 × 1080 as-is. If a dedicated wall mode is wanted later, scale the root font size — do not redesign the pages.

## State

Per screen, local component state as today; no store is needed.

- Shell: `screen`, `sub` (per screen), `range {min, max}`, `freshness: Meta`, `navContext`, `user`.
- Overview: `date` (defaults to the last *complete* day — keep the existing "day before `range.max`" rule), `shift`, and one state slot per fetch.
- Records: filter chips (`type`, `from`, `to`, `shift`, `station`, `inRange`, `wMin`, `wMax`, `tsFrom`, `tsTo`), `sort`, `dir`, `page`, `selectedRowId`.
- Weight: `basis`, `productId | manual setpoint`, `showMaths`.
- Output: `thresholdSeconds` (default 120), `date` / `from`–`to`.
- Rejects: `rejectType`, `bucket`, `from`–`to`.
- Setup: per-panel edit buffers.

All fetches keep the existing cancellation pattern (`let cancelled = false` in the effect, guard every setter).

## Assets

None. Every glyph in the rail is an inline SVG path in the prototype (stroked, 24×24 viewBox, `currentColor`) — copy them from `SMS Rework.dc.html` or substitute equivalents from whatever icon set the codebase already carries. Fonts load from Google Fonts in the prototype; **for the plant PC, self-host Archivo and DM Mono** (the app must run with no internet dependency) and keep the `system-ui` / `ui-monospace` fallbacks.

## Files in this bundle

| File | What it is |
|---|---|
| `SMS Rework.dc.html` | The design. All seven screens plus login; the rail and section column are live, so every screen and sub-tab can be inspected by clicking. |
| `Direction B - Night Deck.dc.html` | Rejected alternative (charcoal + amber, Sora / JetBrains Mono). Reference only. |
| `Direction C - Paper and Petrol.dc.html` | Rejected alternative (cream + petrol teal, Space Grotesk / IBM Plex Mono). Reference only. |
| `README.md` | This document. |

The prototype files are Design Components: open them directly in a browser. Each loads a sibling `support.js` runtime from the design project; if you open them outside that project the markup still describes the layout, but for interactive review use the versions in the project.

## What the design deliberately does not solve

- **Reject code labels** (Q10) stay unlabelled; the Reasons page shows raw code pairs and an amber "waiting on IFL" band. When labels arrive, they replace the mono code strings — no layout change.
- **Product attribution** (Q1) remains null for history. The Records detail rail prints "not attributed" and the Weight setpoint comes from the manually-set current product.
- **Gross vs net sack weight** (Q4/Q5) is surfaced as an explicit Setup rule that is currently off, rather than hidden in a footnote.
- **Sack-side SPC** is out of the rework's scope; the Weight screen is cone-first. `getSpc({type:'sack'})` exists if it is wanted later.
