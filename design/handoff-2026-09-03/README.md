# Handoff: SMS visual redesign

**IFL Sack Management System · TP1 · Line 3 · Unit 2**
Design spec, 3 September 2026.

---

## Overview

A visual redesign of an app that is **already built, already coherent, and already
has a written design doctrine**. It is not a rewrite and not a new information
architecture.

No component is renamed. No screen is restructured. No route, API, query or
metric changes. The work is concentrated in one stylesheet plus three small
markup edits, with one screen (Wall) genuinely rebuilt.

The thesis in one line: **the app is a briefing note; this raises it to a
ledger** — a record whose job is to prove a shift's output to the person who
signs for it, and to be legible from the far side of an office.

Three moves do the work:

1. **Instrument Sans + a new display step** so a shift's output outranks the
   sentence describing it.
2. **Full-bleed rules with hanging labels** so the page has an architecture
   instead of reading as one undifferentiated list.
3. **The wall rebuilt as a composed board** rather than the desk screen scaled
   up in viewport units.

One genuinely new element: the **verdict mark**, on Report only.

---

## About the files in this bundle

Read this section carefully — this bundle is **not** the usual "recreate the
HTML in your framework" handoff.

| File | What it is | How to treat it |
| --- | --- | --- |
| `app.css` | **Production code.** A drop-in replacement for `web/src/app.css`. | Copy it over the existing file. Do not re-derive it from the mockups. |
| `SMS Design Spec.dc.html` | Design reference — foundations, parts, 7 screens. | Reference only. Never copy its markup. |
| `SMS Spec - States, Roles & Print.dc.html` | Design reference — sheet, states, widths, print, login, Setup, RBAC, acceptance checks. | Reference only. |
| `OPEN_QUESTIONS.md` | Six decisions that are deliberately unresolved. | **Read before starting.** Discuss; do not guess. |
| `support.js` | Runtime for the two `.dc.html` reference pages. | Only so they open in a browser. Not part of the app. |

The two `.dc.html` files are **design references built in HTML**. They are
inline-styled documents written to show intended appearance and reasoning. Their
markup is not production code and must never be copied into the app — the app is
React + TypeScript with a class-based stylesheet, and `app.css` is the real
artefact. Where a mockup and `app.css` disagree, **`app.css` wins**.

Open the two reference pages in a browser to read them. `support.js` must sit
beside them.

## Fidelity

**High fidelity.** Final typeface, type ramp, colours, spacing, states and copy.
Every hex value and every px value in this document is intended literally.

Two knowing exceptions:

- **The numbers are invented** from the config defaults (4,182 cones, 1,250 g
  target, 45.6 kg sacks, 14 stations, 1.8% rejects). Swap in real figures before
  anyone from IFL sees this.
- **Wall is speced, not built.** The CSS is complete; the JSX is not. See
  `OPEN_QUESTIONS.md` §1.

---

## The doctrine you must not break

From the header comment of the existing `web/src/app.css`. These are constraints
with stated reasons, not preferences. The redesign works *inside* all seven.

1. **One typeface.** Tabular figures on globally, so one family carries every
   number in the app and columns still align. This is what retired the
   Archivo + DM Mono pairing — and that pairing is what made the app read as an
   instrument panel.
2. **One accent, `--acc`, meaning exactly one thing: this needs attention.**
   Green survives only as the health dot. A healthy screen is calm black on
   white. Nothing decorative may ever use the accent — the moment it does, the
   *absence* of it stops meaning "fine", which is the signal the entire design
   depends on.
3. **Rules, not boxes.** A hairline and 28px of space between blocks. No
   borders, cards, shadows or nested panels. Radii stop at 4px.
4. **One column, 1100px.** No sticky rails, no section columns, no sub-tab rows.
   Drill-downs open as a right-hand sheet so the reader never loses their place.
5. **Light only.** The plant PC is a fixed, known machine read in daylight on a
   bright floor. A dark theme is a second design to maintain and a second
   contrast audit to pass.
6. **Nothing is measured against the browser clock.** Lag, staleness, cadence
   and the displayed clock all come from `/api/live`. The plant PC's clock has
   been wrong before.
7. **Word budgets.** Line 60 · Wall 30 · Report 100 · Readings chrome 40 ·
   Weight and Rejects 120. Every user-visible string lives in
   `web/src/lib/words.ts` so the budget stays countable. Do not put copy
   anywhere else.

**If a change appears to require breaking one of these, stop and ask.** Do not
resolve it in code.

---

## How to apply it

1. **Copy `app.css` over `web/src/app.css`.**
   Search it for `[SPEC` — eleven markers, and they are the entire diff. Every
   original rule and comment is preserved. No colour token changed. No class was
   renamed or removed, which is why almost no `.tsx` needs touching.

2. **Add the font.**
   `web/public/fonts/InstrumentSans-Variable.woff2` — variable, weight 400–700,
   one file, self-hosted.
   **The plant PC has no internet.** A Google Fonts `<link>` will silently fall
   back to Segoe UI on the one machine that matters. The `@font-face` block in
   `app.css` expects the path above; change it only if you vendor the font
   elsewhere.

3. **Three markup changes, and they are the only ones:**
   - `web/src/ui/bits.tsx` › `Block` — one extra wrapper div so the label can
     hang in the left margin. Props unchanged. ~3 lines.
   - `web/src/screens/Line.tsx` — move the figures block **above** Attention.
     A move, not a rewrite.
   - `web/src/screens/Report.tsx` — add the verdict mark beside the coverage
     sentence. Reuses `W.report.printedAt` / `printedBy`. **No new strings.**

4. **Rewrite `web/src/screens/Wall.tsx`'s markup** against the new `.w-*`
   classes. This is the one screen with real work in it. See §Wall below and
   `OPEN_QUESTIONS.md` §1.

5. **Run the 12 acceptance checks** at the end of this document.

---

## Design tokens

Unchanged from the existing stylesheet except where marked. Listed in full
because a spec that omits colour invites someone to add a second accent.

### Ink

| Token | Hex | Contrast on white | Use |
| --- | --- | --- | --- |
| `--ink` | `#16191c` | — | Body text, primary marks, the verdict fill |
| `--graphite` | `#4a5057` | 8.15:1 | Secondary text, second chart series |
| `--muted` | `#5f656c` | 6.61:1 | Labels, captions, axis ticks |
| `--grid` | `#8c9298` | graphics only | Gridlines, chevrons, dimmed values |

### Paper

| Token | Hex | Use |
| --- | --- | --- |
| `--paper` | `#ffffff` | The page |
| `--paper-2` | `#f2f2ef` | Period control track, shaded chart region, station bar fill |
| `--paper-3` | `#f6f6f3` | Header strip, row hover, highlighted row, skeleton |
| `--rule` | `#e7e8e4` | Between blocks and table rows |
| `--rule-2` | `#d3d5d1` | Control borders, table header underline |
| `--track` | `#e4e7e3` | Bar-chart track |

### The one accent — attention, and nothing else

| Token | Hex | Use |
| --- | --- | --- |
| `--acc` | `#a5330f` | Accent **text** and marks. 6.82:1. |
| `--acc-fill` | `#d8451b` | Accent fill behind white, or large marks only |
| `--acc-pale` | `#fbe9e4` | Accent row wash |

### Health dot only

| Token | Hex |
| --- | --- |
| `--ok` | `#1e8757` |
| `--warn` | `#aa730e` |

### Type — one ramp, six steps, max four per screen

Multiplied by `--ui-scale` (Desk `1`, Wall `1.3`). `font-variant-numeric:
tabular-nums` and `font-feature-settings: 'tnum' 1` are set on `body` and apply
everywhere, including SVG text.

| Token | Desk / Wall | Weight · tracking | Use |
| --- | --- | --- | --- |
| `--fs-tick` | 13 / 17px | 400 · 0 | Axis ticks, station labels, legends |
| `--fs-small` | 15 / 20px | 400–500 · 0 | Captions, chrome, table heads, caveats |
| `--fs-body` | 17 / 22px | 400 · 0 | Body, table cells, attention sentences |
| `--fs-qual` | 22 / 29px | 500 · 0 | A figure's qualifier, product name |
| `--fs-head` | 34 / 44px | 500 · −0.015em | The one headline sentence per screen. **`[SPEC 2]` was 30px.** |
| `--fs-display` | 56 / 73px | 600 · −0.03em | The three headline figures. **`[SPEC 3]` new step.** |

`--fs-fig` is kept as an alias of `--fs-display` so existing markup keeps
working. New markup should use `--fs-display`.

At ≤620px: `--fs-display` → 38px, `--fs-head` → 26px.

### Structure

| Value | Meaning |
| --- | --- |
| 1100px | Content column. Unchanged. |
| 180px | Hanging label margin, with a 40px gutter. **New.** |
| 28px | `--gap-block`, between blocks |
| 4px | `--radius`. Maximum radius anywhere. |
| 1px | Every rule. **There is no 2px rule** except the nav's active underline. |
| 120ms ease | `--t`, every transition |

### Typeface

**Instrument Sans**, variable 400–700, self-hosted.

Why it replaces Archivo: a taller x-height at the same size, so a 13px station
label survives a wall; unambiguous 1/7/9 at four metres; and a genuinely tight
display cut, which is what lets one family carry both a 13px axis tick and a
132px wall figure. Archivo's tracking loosened at display size and its figures
needed DM Mono beside them — the pairing this doctrine already retired.

---

## The eleven changes in `app.css`

Search the file for `[SPEC` to find each one in place.

| # | Where | Change |
| --- | --- | --- |
| 1 | `--font`, `@font-face` | Archivo → Instrument Sans, self-hosted |
| 2 | `--fs-head` | 30px → 34px |
| 3 | `--fs-display` | New step at 56px; `--fs-fig` becomes an alias |
| 4 | `.band` | **New.** Full-bleed rule; `.page` still caps at 1100px inside it |
| 5 | `.block`, `.h2` | Becomes a 180px + 1fr grid so the label hangs left; collapses at 860px and in print |
| 6 | `.figs` | Hairline between figures, no grid gap, display step; wraps correctly at 1080 and 620 |
| 7 | `.strip` | Plant-clock slot and the live pulse dot |
| 8 | `.verdict` | **New.** The one ink fill in the app. Report only. Prints. |
| 9 | `.wall*` | **Rewritten.** Station bars, figures on a shared rule, pinned footer |
| 10 | `.sheet` | Figure takes the display step; verdict line and eyebrow classes |
| 11 | `@media print` | Verdict mark and hanging label survive printing |

---

## Screens

Nine surfaces. Every one keeps its existing route, data and component name.

### 1. Line — the desk home screen

**Purpose.** "Is the line running, what has it made this period, and does
anything need attention?"

**Layout.** Bar (56px) → strip (32px min) → `.page` at 1100px, 34px top padding,
64px bottom. Blocks in order, each `180px + 1fr`:

1. Question line (`--fs-small`, `--muted`) + headline (`--fs-head`)
2. **Figures** — three-up, hairline between, 32px padding. **Moved above
   Attention.** This is `[SPEC]` change 5 in `Line.tsx`.
3. Attention
4. Product recorded in this system
5. Stations — cones this period
6. Last readings
7. "Show the working" disclosure

**The figures.** `--fs-display`, weight 600, `letter-spacing:-.03em`,
`line-height:1`, `white-space:nowrap`. Qualifier ("cones") at `--fs-qual`,
weight 500, `--graphite`, 7px left margin, baseline-aligned. Note below at
`--fs-body`, `--graphite`, 8px top margin.

Children 2 and 3 take `border-left: 1px solid var(--rule)` and 32px horizontal
padding; child 1 has no left padding, child 3 no right padding. **Grid gap is
zero** — the rule does the separating. Without it the middle figure's note reads
as a caption for the left figure.

A figure never takes the accent. A count is not a problem, and colouring it
would spend the one signal on a number that is merely large.

**Attention.** At most three sentences, each ending in a link to the screen that
explains it. 8px `--acc-fill` dot at `top:.62em`, 18px left padding, sentence in
`--acc`, then the link in body colour. Overflow becomes "and 2 more — see
Weight" at `--fs-small`, `--graphite`.

Resting state: one grey sentence, "Nothing needs attention." No tick, no green
panel, no "All systems normal". A calm screen should cost the reader nothing.

**Stations.** `repeat(var(--st-count, 14), minmax(0,1fr))`, 8px gap. Count comes
from Setup › Stations — never hardcode 14. Each cell: 1px `--rule` border, 4px
radius, centred, 10px/4px/9px padding.

- Label `--fs-tick` `--muted`, ellipsised
- Value 18px × `--ui-scale`, weight 500
- Tag line `--fs-tick` `--grid`, `min-height:1.4em` **always reserved**, so the
  row never reflows as a station goes quiet

States: `.quiet` → dashed border, value and label `--grid`, tag reads "quiet"
(no cone for 20 min, measured from the newest reading, not from `Date.now()`).
`.flag` → `--acc` border plus `inset 0 0 0 1px var(--acc)`, value `--acc`.

**The strip.** Left: 8px dot + "TP1 · Line 3 · Unit 2 · plant clock 11:26:04".
Right: the lag sentence. Three states:

| State | Background | Text | Dot | Pulse |
| --- | --- | --- | --- | --- |
| OK | `--paper-3` | `--graphite` | `--ok` | animating |
| Late | `--acc-pale` | `--acc` | `--warn` | stopped |
| Stale | `--acc-pale` | `--acc` | `--acc-fill` | stopped |

### 2. Wall — its own design

**Purpose.** A glance from a doorway, four metres away. 1920×1080, 16:9. No
hover, no click, no logout. Esc returns to Line.

Today's wall is the Line screen with the chrome removed and the type in viewport
units. That is a scale trick, not a design: it inherits a reading order built
for a mouse at 60cm, and its fourteen bordered station boxes with numbers inside
them are illegible from a doorway.

**Three rules the desk screen does not follow:**

- **One thing is biggest, and it is the state sentence.** `4.1vw` = 79px on a
  1920 panel. It is the only thing readable from outside the room, and that is
  deliberate.
- **Stations encode their count as bar height,** with the number below a rule.
  A quiet station becomes a visible gap in the row — the fastest read on the
  board, and it needs no colour at all.
- **The footer is pinned and never leaves.** A display left on for a week must
  always be able to say how fresh it is.

**Layout** (`.wall`, `height:100vh`, `overflow:hidden`, `cursor:none`, flex
column):

1. `.w-head` — 3.4vh/3.6vw padding. Left: `.w-line` (1.15vw, 500, `.1em`
   tracking, uppercase, `--muted`) then `.w-state` (4.1vw, 600, −.03em).
   Right: `.w-clock b` (2.1vw, 500) + `span` (1.15vw, `--muted`).
2. `.w-figs` — three-up on a shared `1px solid var(--ink)` top rule, 2.2vh
   padding-top. Figures `7.4vw`, 600, −.04em, `line-height:.92`. Notes 1.35vw
   `--graphite`.
3. `.w-stwrap` — `margin-top:auto` pins everything below to the bottom, so the
   composition does not shift as a figure gains a digit. `.w-sub` row: label
   left, accent note right, 1.2vw. Bars: `align-items:end`, 0.55vw gap. Each
   station is a `.bar` (height = count ÷ max × 92px, `--paper-2` fill, 2px
   `--ink` top border, 2px top radius) over a `.cap` (1px `--ink` top rule,
   0.5vw padding-top, centred: value 1.55vw/500, label 1.05vw `--muted`).
4. `.w-foot` — `--paper-3`, 1.5vh/3.6vw. Left: dot + lag sentence. Right: last
   sack and last cone. Washes `--acc-pale` + `--acc` when stale.

Sized in `vw`, not `vh`, so the composition holds if it is ever driven at 2560
or 3840.

Station states: `.quiet` → `--paper-3` bar, `--rule-2` top border, `--grid`
text. `.flag` → `--acc-pale` bar, `--acc` top border, `--acc` value.

### 3. Weight

**Purpose.** "Are the cones at the right weight, and does any station's scale
need attention?"

Four corrections that are already in the code and must survive the restyle:

- **The time chart is primary.** A distribution tells you the spread; it cannot
  tell you that weight stepped up at 09:40 after a doff, which is what an
  engineer fixes during a shift. Distribution is the second position on a
  toggle, and the control chart is not in a disclosure.
- **The headline does not state a difference until the weight basis is
  confirmed.** Stated on opposite bases the comparison is out by a whole tube.
  Until Setup says which, the mean and the target are two facts side by side.
- **The station table shows both biases** — against the line *and* against the
  target. A line running 12 g heavy everywhere reads "fine" on all fourteen
  rows if you only show vs-line.
- **No "reduce by 9 g".** Weighing data cannot tell a heavy scale from heavy
  cones, and the two need opposite actions. The row states the observation and
  stops at "check its scale first".
- **The drift window is fixed** at 14 production days whatever the period says,
  and the table's label says so.

**Chart reference labels — a correction.** `Weight.tsx` currently draws limit
and target labels in-SVG at `y={T + 11}` while a bar may reach `y={T}`, so
whether a label is readable depends on the day's bin heights. Give the plot a
22px top inset and hang the three labels off it in their own band: lower limit
right-aligned to its rule, target and upper limit left-aligned. The same fix
applies to the Over-time chart's `RefLine` labels.

The hover readout is a line of text above the chart, right-aligned — never a
floating tooltip. A tooltip covers the marks it describes, cannot be read from a
wall display, and does not exist for a keyboard.

Distribution bins beyond a limit take `--acc-fill`; everything inside is
`--graphite`; hover turns one bin `--ink`.

**Adjustment log** lives in the station sheet. Supervisor and above. It exists so
the station table can say "adjusted 6 days ago by M. Iqbal, steady since"
instead of flagging a station somebody already dealt with.

### 4. Rejects

Headline states the count, the share, the split by kind, and — only when true —
the rising trend in `--acc`. Left column: 30-day rate chart, current period
shaded `--paper-2`. Right column: reasons as horizontal bars.

**Bars are `--graphite` and `--grid`, never accent.** A count is not an alarm.
Only the rising trend earns the accent, and it earns it once, in the headline.

Unnamed reject codes read "Code 4 / 12 — not yet named" in `--muted`, with a
"Name it" link for manager and above. Naming applies to history.

### 5. Readings

Every cone and sack weighed, rejected ones flagged. Filter chips, then the
table: Time · Record · Weight (right, tabular) · Status, with a `--grid`
chevron. 100 a page, newest first.

Row states: hover and selected both `--paper-3`. A rejected row takes
`tr.rej` — `--acc-pale` wash and `--acc` text, never a red left border, which
would read as a card.

Footer: pulse dot + "new readings appear every 15 seconds" on the left, count on
the right. Under lag, the left sentence becomes the lag sentence.

### 6. Report — the page that gets signed

The only screen carrying the verdict mark, because it is the only one whose
output leaves the building.

`.verdict`: `--ink` fill, white text, 22px/24px padding, 4px radius. Label
`--fs-tick`, 500, `.08em`, uppercase, 62% opacity. Value 26px × `--ui-scale`,
500, −.02em. Attribution `--fs-small` above a `rgba(255,255,255,.22)` rule, 80%
opacity.

**It appears at most once per screen and only here.** It is not a button style
and not a badge. If a second one appears anywhere, the fill has stopped meaning
anything and the rule should be deleted rather than reused.

**In print it becomes a rule plus ink text.** Browsers drop background graphics
by default and the person printing does not know that setting exists. Same
content, same authority, no dependency on a checkbox. If you change `.verdict`,
change both.

Report also carries the **stated absences** — sack stock per machine is not
shown because the plant's sack records carry no machine and no record of a sack
leaving. A GM who looks for stock finds the reason, not a blank. Same for time
lost: planned breaks and faults cannot be told apart in the data, and the
sentence says so.

### 7. Setup — one page, five blocks

**Not tabs.** In this order, and the order matters:

1. **Sync health** — first, because it is the only thing here that everybody,
   not just an admin, has a reason to reach: the strip's lag sentence links
   straight to it. States the source in plain words, so the real status of
   requirement 1 (SQL only, no PLC) is visible in the product rather than only
   in a document.
2. **Stations** — the names every screen uses. Renaming applies to history.
3. **Rules** — the three values IFL has not confirmed. Interpreted at read time,
   never baked into stored data, so confirming one is a settings change and not
   a re-sync. That is why the screen can afford to say "not confirmed" out loud.
4. **People** — this system keeps its own accounts and never touches IFL's
   `Users` table.
5. **Audit log** — every change made *through this application*. Reads and
   exports are not logged; only changes.

### 8. Login

One centred form, `min(360px, 100%)`, 16px gap. Four states: resting, wrong,
working, locked out.

- **Never names the field.** "That username and password did not match." Saying
  which one was wrong turns the form into a way to confirm an account exists.
- **Lockout states a number.** Eight failures in fifteen minutes locks that
  client out for fifteen; the server returns seconds remaining, so the form says
  "Try again in 14 minutes" rather than "try again later".
- **The wall must never see this screen.** Sessions renew once past half their
  seven-day life, so a display that polls all week never expires. If the wall
  ever shows a login form, that is a bug in session renewal, not a state to
  design for.

### 9. The right-hand sheet

`min(460px, 100vw)`, from the right, over whatever opened it. 1px `--rule-2`
left border, 26px/32px/48px padding, 160ms slide. Scrim
`rgba(22,25,28,.18)`. Every drill-down in the app is this one surface.

Weight at `--fs-display` (`[SPEC 10]` — at 40px it tied with the h2 above it).
Then the scale's verdict, then the product comparison, then a `.kv` list, then a
provenance disclosure.

**May say:**
- The scale's verdict, always, named as the scale's.
- The product's limits **only** when a product was in force at this reading's
  time.
- On a sack, one line about cones weighed since the previous sack, with the
  caveat in the same sentence.
- Provenance, behind a disclosure.

**May not say:**
- Today's tolerance applied to a reading from weeks ago. The old app printed
  that difference and it meant nothing.
- A cone count on a *cone* sheet — it would read as a packing list. The plant
  records no cone-to-sack link, and the count between two sacks has been
  measured anywhere from 0 to 254.
- Merge keys, transform versions, source system names, collision ids.

Behaviour: Esc closes, the scrim closes, focus moves to the sheet on open and
returns to the row on close. `display:none` in print — a printed report must not
carry whichever row happened to be open.

---

## Interactions & behaviour

### The pulse — easy to get wrong

The strip's dot animates while data is arriving and **stops** when the link goes
stale. It does not turn red. Motion ceasing is read faster than a colour change,
and it is the only animation in the app besides the skeleton.

`@keyframes beat { 50% { opacity: 0.28; } }`, 2.4s, `ease-in-out`, infinite.
`.strip.alarm .dot.live { animation: none; }`

**It must be driven by the health payload, never by a local timer** — otherwise
a frozen screen keeps pulsing happily, which is the exact failure the pulse
exists to expose.

### Transitions

Everything is `120ms ease` (`--t`), on `color`, `background` and `border-color`
only. No transforms except the sheet's 160ms slide and the scrim's fade.
`@media (prefers-reduced-motion: reduce)` reduces every duration to 0.001ms.

### States

Each block polls independently, so a screen is routinely in two states at once.
The rule that follows is the important one: **a block waiting on its own request
keeps its own height,** so the page never jumps as panels land.

| State | Treatment |
| --- | --- |
| **Loading** | `.skel` — `--paper-3`, 4px radius, `pulse 1.4s` at 55% opacity. Named heights: `.fig` = `--fs-display + --fs-body + 8px`, `.line` = 1.5em, `.chart` = 250px, `.st` = 62px. **No spinners.** A figure skeleton must match the real line box or the page jumps 16px when the first panel lands. |
| **Failed** | `.state.err` in `--acc`, one plain sentence, plus "Try again" which refetches **only that block**. The raw error goes to the console, never to the page. One failed block never blanks the screen. |
| **Empty** | One sentence and a way out. Never an illustration, never "No data available". An empty period is a normal fact on a plant that runs six days. On Line, figures show **zeros, not dashes** — zero is a measurement. |
| **Stale / late** | `.strip.alarm`. Headline stops asserting a state, pulse stops. Cadence and the stale threshold come from `/api/live` — measured from sync history, not hardcoded. |
| **Replay** | `.replay` — `--ink` band, full width, above the bar. The only element allowed above the app's own chrome, because it changes the meaning of every number below it. Pulse does not run. Gated by `liveAllowAsOf` in config; when off, unreachable. |

Wall differs deliberately: no skeletons (motion at that size is a distraction —
the state line reads "Waiting for the first reading"), and it **never blanks** on
failure, because a blank wall screen looks like a dead PC. The footer carries
the error.

Report differs too: **Print and Export are disabled while loading.** A
half-loaded report must not be printable. With no production days the verdict
mark is absent — there is nothing to sign for.

### Responsive

Not a phone app. The breakpoints exist because the plant PC runs at 1366, the
office monitor at 2560, and a supervisor occasionally opens it on a tablet.

| Width | Behaviour |
| --- | --- |
| **1440–2560** | Bands run to the bezels, content at 1100px. Hanging labels at 180px. Figures three-up with hairlines. All 14 stations in one row. |
| **≤1080** | Bar wraps, 20px page padding. Figures two-up; children 3 and 4 gain a top rule so they do not hang off nothing. Stations 7 × 2 — the point at which a bare number stops fitting its box. |
| **≤860** | **The one breakpoint the redesign adds.** The hanging label collapses and `.h2` goes back on top — that is where 180px + 40px + content stops leaving a readable measure. Same rule applies in print. |
| **≤620** | `--fs-display` 38px, `--fs-head` 26px. Figures stack with rules between. Sheet full width. A courtesy, not a target. |

### Print

`@media print` drops the bar, strip, replay band, sheet, scrim, wall,
skeletons, station bars and every `.no-print`. Body 11pt. `.page` loses its
max-width. Blocks and table rows carry `break-inside: avoid`, so a shift never
splits across two sheets. The hanging label collapses — it would waste 180px of
A4.

`.print-head` appears and carries what the chrome would otherwise take away:
line, period, shift, coverage, newest reading, who printed it and when. Without
it a printed report is undated and unattributed, and therefore worthless as a
record.

---

## Roles — derived, not invented

Read off `api/src/auth.ts` and the route table in `api/src/app.rbac.test.ts`.
Ranks are numeric and gates are `>=`, so each role inherits everything below it.

| Role | Rank | Adds |
| --- | --- | --- |
| operator | 1 | Every read route. Sees every screen and every figure. |
| supervisor | 2 | `POST /api/current-product`, `POST /api/calibration/adjustments` |
| manager | 3 | `GET /api/events/export`, `PUT /api/reject-codes/:id` |
| admin | 4 | All `/api/admin/*` — users, stations, rules, audit |

Public and never gated: `/api/health`, `/api/auth/login`, `/api/auth/logout`,
and `/api/auth/me` — which returns `{ user: null }` rather than 401.

**Three design rules follow:**

1. **Roles gate writes and two exports, never visibility.** Every role sees
   every screen and every number. An operator who cannot see the reject rate
   cannot act on it.
2. **A control a role can never use is absent, not greyed.** A disabled button
   is a promise the app will not keep. The one exception is the period control,
   where disabled means "no data for that range" — a fact about the data, not
   about the reader.
3. **A 403 is a bug, not a state.** If the UI hides what a role cannot do, a 403
   can only mean client and server disagree. It gets the generic failed state
   and a console error — never a designed "you don't have permission" screen,
   which would only ever be seen because of a mistake.

The gear is the only nav difference: Setup is admin-only. Sync health, the one
block in Setup everybody needs, is reachable from the strip's lag sentence
regardless of role.

---

## Assets

- **Instrument Sans**, variable woff2, weights 400–700, one file. SIL Open Font
  License. Must be self-hosted — the plant PC has no internet.
  → `web/public/fonts/InstrumentSans-Variable.woff2`
- **No images, no icons, no illustrations.** The only glyphs are the chevron
  (`›`), the close mark (`✕`) and the gear, all text. The design uses no raster
  or vector assets at all, which is deliberate: nothing to version, nothing to
  fail to load on a machine with no internet.

---

## Acceptance checks

Twelve checks, each observable in a browser without reading the source. If all
twelve pass, the redesign shipped.

1. No screen shows more than four of the six type steps.
2. On a healthy screen there is no accent anywhere.
3. A block's hairline reaches both bezels on a 2560px monitor; its text still
   stops at 1100px.
4. Every block label sits in the left margin, and the content column has one
   left edge from top to bottom.
5. The ink fill appears exactly once in the whole application, on Report.
6. Pull the network: within one poll the pulse stops, the strip washes accent,
   and the headline stops claiming the line is running.
7. On the wall at 1920, the state sentence measures about 79px and is legible
   from four metres.
8. A quiet station on the wall is a visible gap in the bar row, with no colour
   involved.
9. Reload with a cold cache: no block changes height as it lands.
10. Print the Report: the verdict mark, the print header and the day table all
    survive with background graphics **off**.
11. Sign in as an operator: no Change button, no Name it link, no Export CSV, no
    gear. None of them greyed — all absent.
12. Open a cone from a period with no product: the sheet states that and
    computes no difference.

---

## Files in the target repo

| Path | Change |
| --- | --- |
| `web/src/app.css` | Replaced by `app.css` in this bundle |
| `web/public/fonts/InstrumentSans-Variable.woff2` | New |
| `web/src/ui/bits.tsx` | `Block` gains one wrapper div (~3 lines) |
| `web/src/screens/Line.tsx` | Figures block moves above Attention |
| `web/src/screens/Report.tsx` | Verdict mark added (~14 lines) |
| `web/src/screens/Wall.tsx` | Markup rewritten against the new `.w-*` classes |
| `web/src/screens/Weight.tsx` | Chart reference labels moved out of the plot |
| `web/src/lib/words.ts` | **No change.** No new strings anywhere. |

Everything else is untouched.

---

**Before you start: read `OPEN_QUESTIONS.md`.** Six decisions are deliberately
unresolved, and three of them will change code you would otherwise write twice.
