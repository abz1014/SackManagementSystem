# SMS redesign brief

**Status: BUILT, 3 Sep 2026.** Option A was signed off and all seven screens
are live: Line, Readings, Weight, Rejects, Report, Wall and Setup. The old
interface has been deleted rather than unrouted. Option B was not built.

What is NOT yet done, and is the next work: the role rename of §7
(viewer / engineer / manager / admin), the product-details overlay and
*Product limits* rule of §8 lines 2 and 3, the per-day-per-code reason sheet
of §5.4, the station sheet of §6, and the sack-stock fallback of §8 line 7.
The questions in §11 are still unsent.
Source of truth for the next UI. Supersedes the screen descriptions in
`CAPABILITIES.md` §3 once built; until then §3 describes what exists.

How this was produced: a three-agent audit (usability inventory of every screen,
an exact map of the code against IFL's ten requirement lines, and a redesign
proposal), then two adversarial critics of the proposal, one arguing as IFL's
representative and one as a process engineer who uses the software every shift.
Both critics refused to sign the first proposal and both said they would sign a
corrected one. Their corrections are folded in below and marked where they
changed the design.

---

## 1. Why a redesign and not more fixes

IFL's words: *"overflow of useless information and a solution not implemented
smartly will be highly discouraged."* The owner's, after a day of point fixes:
*"the current GUI and UI/UX is unusable."*

The measurements agree. Visible words per screen at 1440px: Weight/Spread 409,
Records 297 (with 219 numbers on arrival), Rejects 294, Day 279, Now 251. A
readable dashboard carries 60–120. Roughly 30% of the web source (≈2,500 lines)
renders things no requirement asked for, and the screens that do map to a
requirement carry unrequested payload inside them: Cpk, S-charts, ANOM
significance columns, merge keys, transform versions, a giveaway figure the app
itself marks "not for quoting".

The same question is answered by two or three screens in five places: current
state (Now, Day, Report tiles), a single reading (record card, detail rail, full
record page), the register (Sacks, Cones, Records), findings (Day panel,
Exceptions page), the product (Now bar, Day bar, column footer).

Point fixes cannot cure duplication and density. A redesign can.

## 2. Who it is for

One group, confirmed by IFL's representative: **the GM, managers and engineers
of the process department.** Technical, busy, intolerant of clutter. Everyone
reads everything. Roles govern only writes.

## 3. Principles

1. **One question per screen, answered in the first viewport** by one plain
   sentence with the number in it. Everything else is below the fold or behind
   a labelled *Details* disclosure.
2. **Seven elements above the fold, at most.** One chart visible per screen
   without the reader asking for a second.
3. **One period control, set once in the header, obeyed by every screen.**
   No per-screen date pickers, no period sub-tabs.
4. **Detectors do not use the period.** *(Critics' correction.)* Station drift,
   the attention list and reject-episode detection run over a fixed trailing
   window — the last 14 production days, or the whole record until 14 exist —
   and say so in one clause where they appear. The period governs counts,
   averages, the register, the distribution and the report. When the selected
   period is shorter than a screen can judge, the headline says so and the
   screen shows its minimum, rather than printing "Fine" over nothing.
5. **The data lag is one sentence in the header, in three states, measured
   never hard-coded.** *(Critics' correction.)* Healthy: "Newest reading 14:22,
   weighed about 18 min before it reached this system." Sync stale: "No new
   readings since 13:05 — the plant link may be down," in the accent colour,
   and no screen asserts Running or Stopped. Lag beyond the credible ceiling:
   "Readings are arriving 2 h 10 min late — the line state below may be out of
   date." All three from `/api/live`.
6. **One status vocabulary, named wherever it is used.** *(Critics'
   correction.)* The scale's own verdict is *the* flag: **Passed** / **Rejected
   by the scale**. Product limits appear only when a product was in force at
   that reading's time, as a second labelled fact: "also outside product
   limits, 1,960 ± 40 g." A reading weighed before any product was recorded
   says "no product recorded at this time." No delta is ever computed against a
   product that was not in force. Reject rate is rejects ÷ everything weighed,
   with the denominator stated once in Details.
7. **Plain words on primary surfaces.** Sigma, Cpk, subgroup, Nelson, p-chart,
   control band, merge key, transform version, question numbers (Q1, Q10,
   DQ-2) appear nowhere a reader lands. Statistics live behind *Show the
   working*. A plain word never replaces a definition: "95 of every 100 cones
   fall between 1,812 and 1,872 g," not "most cones."
8. **No two screens answer the same question, and every screen names its
   requirement line.** A screen that cannot is deleted, not hidden.
9. **Writes are few, visible and attributed.** Five writes: set the recorded
   product, log a scale adjustment, export readings, name a reject code,
   change a rule. Each shows who and when, where it was done.
10. **Sentences before figures, figures before charts.** Charts are inline SVG,
    one series unless two are directly labelled, labels on the marks, no
    legends, three light gridlines at most, limits as thin labelled lines.

## 4. Navigation

A single slim top bar replaces the icon rail, the section column and every
sub-tab row.

- **Left:** *SMS* and five words in a fixed order — **Line · Readings · Weight
  · Rejects · Report**. Each screen carries a one-line subtitle under its
  headline stating the question it answers *(critic: on the page, not on
  hover — hover does not exist on a wall or a touch screen)*.
- **Centre:** the period control — This shift · Today · Yesterday · This week ·
  This month · Pick dates. Default *This shift*.
- **Right:** the lag sentence (the whole sentence is the link, ending in the
  word *details*), a **Wall** button, and a gear for **Setup** that only admins
  see.

Below the bar: one scrolling column of at most 1100px. No cards inside cards,
no sticky side rails. Every screen is headline → up to three figures → one
visual or list → *Details*. Drill-downs (a reading, a station, a reject reason)
open as a right-hand sheet over the current screen and close with Escape, so
nobody loses their place. Clickable rows and boxes carry a chevron. Export and
Print sit at the top of any list or table, labelled.

## 5. Screens

### 5.1 Line — requirement lines 2, 3, 6, 8, 9
*Is the line running, what has it made this period, does anything need attention?*
Home after login.

1. **Headline:** Running / Stopped for N min / No readings since HH:MM, judged
   net of the measured lag; the current shift and its hours. Under the stale
   and ceiling states of the header sentence this reads "Cannot tell whether
   the line is running."
2. **Three figures** for the period: cones made with the share passed by the
   scale; sacks made with total kg; cones rejected by the scale with the rate.
3. **Attention:** zero to three sentences, each from exactly one of three
   sources and each naming its requirement in Details *(IFL critic)*: the share
   of cones rejected by the scale this period (line 2); a station the drift
   test has flagged, with its recommendation (line 5); a sustained rise in
   reject rate (line 4). Each ends in a link. When more than three fire: "and
   2 more — see Weight." When none: "Nothing needs attention." No "quiet
   station" alerts — the dimmed box below already says that. Trigger rules
   written in Details and run against a week of simulator data to count false
   positives before this ships.
4. **Product recorded in this system** *(IFL critic: retitled, and never
   "on the machine")*: blend, count, tube, target weight and limits, since
   when, by whom. One sentence: "Recorded here for weight limits and reports.
   It is not sent to the machine." *Change* for engineer rank and above, with
   the new product's limits previewed. *History* unfolds inline. *Edit
   details* (manager) once the product-details overlay exists (§8, line 3).
5. **Stations:** one row of labelled boxes, count driven by Setup → Stations
   *(critic: not a hard-coded 14)*; cones this period each; dimmed when quiet
   measured against the newest reading; outlined when silent while the line
   runs. Click → station sheet (§6).
6. **Last sack, last cone:** one line each → reading sheet.
7. **Details:** how the state is derived, the measured lag, the shift rule,
   the three attention triggers.

### 5.2 Readings — lines 2, 4, 6
*Every cone and every sack weighed, the rejected ones flagged, any one of them
openable.* The single register. Replaces Sacks, Cones, Records and the full
record page.

1. Toggle **Cones · Sacks · Rejected cones**; the resolved period in words.
2. Count line: readings; rejected by the scale as a number and a share.
3. Three chips — Station, Rejected only, Shift — plus *More filters* (weight
   range, reject reason). Active chips removable.
4. The list: time, station or sack number, weight, status word. Where the
   scale and the product disagree the row shows both words. 25 a page, newest
   first, new rows slide in every 15 s while the period is open.
5. **Reading sheet:** weight, the scale's verdict, product limits and the
   difference *only if a product was in force then* (else "no product
   recorded at this time"), time, shift, station, record number. On a **sack**
   sheet, one line: "about N cones were weighed between the previous sack and
   this one (approximate; the plant records no link between a cone and its
   sack)." Nothing of the kind on a **cone** sheet *(critic)*. A *Provenance*
   disclosure holds source row, ingest time, plant-stored shift, transform
   version.
6. Export CSV and Print, top right, labelled. Export: engineer and above.

### 5.3 Weight — lines 2, 5
*Are the cones at the right weight, and does any station's scale need
attention?* The calibration advisory and the weight analysis as one screen.
Replaces Spread, Stability and Calibration.

1. **Headline** *(engineer critic: the basis is unconfirmed until Q4/Q5)*.
   Until the weight-basis rule is confirmed in Setup: "Average recorded weight
   1,842 g; product target 1,830 g (basis unconfirmed)." After confirmation,
   automatically: "Average cone weight 1,842 g, 12 g above the 1,830 g target.
   Two stations need a look."
2. **Three figures:** average vs target; share rejected by the scale; "95 of
   every 100 cones fall between X and Y g."
3. **One chart with a two-way toggle, default *Over time*** *(engineer critic:
   the time chart is the daily instrument, not the working)*: subgroup means
   with target and limits as labelled lines, pattern points marked and named in
   plain words on hover ("rising for 6 groups"). *Distribution* shows the
   period's histogram with limits and target as two labelled lines.
4. **The station table — the only station table in the application** *(IFL
   critic)*, sorted by distance from target then days. Per station: name,
   average, vs line, vs target *(both — a line that is 12 g heavy everywhere
   must not read "Fine" fourteen times)*, days the pattern has held over the
   trailing window, reject rate, and a recommendation that states what the data
   shows and stops: "has read about 9 g heavier than the line for 4 days —
   check its scale first." **No "reduce by 9 g"** — weighing data cannot tell a
   heavy scale from heavy cones. A slope and days-to-limit are **new work**,
   shown only after validation on history, and only labelled "if it continues
   at this rate." *Log an adjustment* per flagged row (engineer+): station,
   signed grams, time, why. **A logged adjustment restarts that station's
   pattern baseline** *(engineer critic)*: days-drifting counts from the
   adjustment; the row reads "adjusted 2 days ago by X, steady since"; the
   sheet greys the pre-adjustment days. The log unfolds beneath the table.
5. **One sentence, on the surface, whenever non-zero:** "N cones this period
   were passed by the scale but sit outside the product's limits."
6. **Details (*Show the working*):** Cp, Cpk, sigma within and overall, the
   PLC-versus-product comparison table, the drift-test rules. **The S-chart
   and the material-giveaway figure are deleted, not hidden** *(IFL critic: an
   unrequested figure the app says cannot be quoted will be quoted if it can be
   found)*.

### 5.4 Rejects — line 4
*How many cones are rejected, why, is it getting worse, where?* Replaces
Reasons, Trend and By station.

1. **Headline** *(engineer critic: the split matters — weight rejects send you
   to scales, quality codes to tubes)*: "318 cones rejected this period — 201
   for weight, 117 for quality — steady," or "… a sustained rise in quality
   rejects since Tuesday 22:00."
2. **Two figures:** rejected with rate; the top reason with its share. An
   unnamed code reads "Code 3/12 — not yet named," never as a reason.
3. **One chart:** reject rate over the trailing window with the selected
   period shaded, **two directly-labelled lines, weight and quality**, the
   usual range shaded lightly (labelled "usual range," never "3σ"), any
   sustained episode marked with a start label per type.
4. **Reasons:** every code present *(few exist)* as bars with count and share.
   Click → reason sheet: that code's count per day over the trailing window,
   and *See these cones* into Readings. *Name it* inline for managers; names
   apply to history. One line under the list until every code is named:
   "Reason names are awaiting IFL."
5. **By station** is a link that opens the Weight station table sorted by
   reject rate, with the "check this station first" cross-reference there
   *(IFL critic: one station ranking, not three)*.
6. **Details:** how episodes are detected, per-bucket limits, the code table.

### 5.5 Report — lines 6, 8
*What did the line make over this period, on paper.*

1. Coverage sentence first. An empty period names the newest day with data.
2. Four totals: cones with share passed; sacks with cones per sack; sack
   weight with average sack; rejected with rate.
3. One chart: cones per day, labelled axis, hover readout.
4. Time lost and stop count, one line, with the single caveat that planned
   breaks and faults cannot be told apart.
5. **Under the sack totals, one sentence** *(IFL critic: requirement 7 must
   have a visible home)*: "Sack stock per machine is not shown: the plant's
   sack records carry no machine and no record of a sack leaving. IFL has been
   asked how sacks are linked to machines and how they leave stock."
6. By-shift and by-day tables.
7. Print and Export CSV at the top. **Print carries a header block** *(critic)*:
   line, period, coverage sentence, newest reading time, printed at, printed by.

### 5.6 Wall — lines 6, 8
The Line screen for a monitor: fullscreen, no bar, viewport-unit type, ten-second
refresh, last good figures kept on a network drop with **"Not updating since
HH:MM" in the accent colour** *(critic)*. State sentence with shift and plant
clock; cones, sacks, rejected this shift; last sack; the station row; the lag
sentence once. Not a destination — a button on the bar.

### 5.7 Setup — lines 9, 10 (admin)
- **People:** accounts and roles.
- **Stations:** names and the count, per line. Drives the station row.
- **Rules:** weight basis, shift boundaries, plausibility window, and
  **Product limits** *(IFL critic: "defined limits" in line 2 needs a place to
  define them)*, each versioned.
- **Sync health:** one sentence, tables in the last pass, oldest table age,
  blocking findings, and the source stated plainly: "IFL SQL Server, read-only;
  no PLC connection (by IFL's Q22)." Per-table detail behind a disclosure.
  Also reachable by everyone from the header sentence.
- **Audit log:** every write, newest first, who, when, what, old and new.

## 6. The station sheet *(engineer critic: the evidence must be one tap away)*

Opens from Line's station row, the Weight table and the Rejects link. Top to
bottom: bias vs target and vs line for the period; the station's daily mean
over the trailing window as one line with target and line mean drawn, flagged
days marked and named in words ("6 days rising in a row"); each logged
adjustment as a tick with amount and who; reject rate vs line; *Log an
adjustment*.

## 7. Roles and writes *(both critics: the code's roles do not fit the people)*

Rename in one place: **viewer · engineer · manager · admin** (migration renames
`operator` → viewer, `supervisor` → engineer; ranks unchanged). Write matrix:

| Write | Minimum role |
|---|---|
| Set the recorded product | engineer |
| Log a scale adjustment | engineer |
| Export readings | engineer |
| Name a reject code | manager |
| Change a rule, edit product details | manager |
| Accounts | admin |

IFL's engineers are created as engineer, managers and the GM as manager, one
admin.

## 8. Requirements: status, gap, plan

| # | Requirement | Status | Gap | Plan |
|---|---|---|---|---|
| 1 | PLC/HMI/machine/database connectivity | **Blocked** | SQL Server only; no PLC, no HMI. Ingestion is hardwired to one SQL adapter. | State "SQL only, by your Q22" in the product (Setup → Sync). If IFL reopens PLC access — the sack-stock question may force it — refactor to an adapter interface first, then an S7 reader as a separate worker. Never describe today as "PLC-ready." |
| 2 | Cone weights, flag outside defined limits | **Partial** | "Limits" means the scale's bit in one place and the product's ± in another; they disagree on ~1,000 cones; no place for IFL to define limits; history has no product. | The status vocabulary in §3.6; a product-at-timestamp resolver in `/api/events` and `/api/live` (never `/api/current-product` for history); *Product limits* in Setup → Rules; the disagreement sentence on Weight. |
| 3 | View and update product details on machines | **Partial** | Selection is app-only, never sent to a machine; product details cannot be edited; one product per line. | "Product recorded in this system" wording (§5.1). App-owned product-details overlay on PDAS rows (name, target, ± limits, tube; versioned; manager write) — makes "update" true without touching IFL's DB. Per-machine product pending IFL's answer on PLC or manual entry. |
| 4 | Reject history and trend graphs | **Done**, presentation wrong | Control-limit theory and ANOM columns on the surface; codes unnamed (Q10); no trend by reason. | §5.4. Per-day-per-code grouping in `/api/rejects` for the reason sheet. Re-ask Q10. |
| 5 | AI-based calibration recommendations | **Partial** | No recommendation is produced; statistics, not AI; Q24 open. | §5.3 wording that states what the data shows. Bias vs target added to `/api/calibration`. Slope/days-to-limit as new, validated work labelled "if it continues." Adjustment resets the baseline. Describe as trend-based analytics; put "AI" to IFL via Q24, not in the UI. |
| 6 | Log all sacks | **Done** | Three registers for one thing. | One Readings screen. |
| 7 | Sack stock per machine | **Blocked** | Not built; not buildable from supplied data (no machine column, no stock-out event). | **Send `IFL_SACK_STOCK_QUESTION.md` now.** Visible sentence on Report (§5.5). Fallback build if IFL answers "line level": `sms.sack_stock_movement` (+1 per sack, manual out-entries with reason/quantity/destination) and a stock figure on Report. 1–2 weeks after the answer. |
| 8 | Reporting, analytics, dashboards | **Partial** | Report is new and unreviewed; dashboards diluted by unrequested OEE material. | Report as the reporting centre (§5.5) with print header; Line as the dashboard (§5.1); everything unrequested deleted (§9). |
| 9 | User-friendly, access control, security | **Partial** | Access control and security done; the interface is the complaint. | This document. Walkthrough with IFL's representative on the plant simulator before any demo. |
| 10 | Scalable to more machines | **Partial** | Single line; `LINE_ID` env var; station count hard-coded; second line never exercised; Q14 open. | `sms.line` table; sync worker iterates lines; line selector only when >1 exists; station count from Setup; exercise a second `_SIM` line end to end before claiming it. |

## 9. Removed — deleted from the bundle, not unrouted

Everything below serves no requirement line or duplicates a screen that does.
"Delete" means the view, its route, its endpoint and its service leave the
repository (history keeps them).

| What | Action |
|---|---|
| Output: OEE, downtime view, stoppage patterns (≈1,100 lines) and `/api/oee`, `/api/stoppage-patterns` | Delete. Keep `/api/downtime` only for time lost, stop count and the running/stopped split. |
| Shifts: six-measure shift comparison, `/api/shift-analysis` | Delete. Per-shift counts live on Report. |
| Day: availability, MTBF, MTTR, run/stop band, longest-stops list, KPI cards, cones-by-shift verdict | Delete with the Day screen; time lost survives on Report as one line. |
| Exceptions page and the `computeExceptions` feed | Delete. The three-source attention list on Line replaces it. |
| Product history page | Delete. History unfolds inline under the product block. |
| Sacks and Cones list screens, Records detail rail, full record page | Delete. One Readings screen with one sheet. |
| Material giveaway (kg/day, t/year) | Delete from the interface. Keep the per-cone delta in the API for calibration. |
| S-chart; Cp/Cpk in any headline; ANOM significance columns; "statistically distinguishable" | Delete S-chart. Cp/Cpk and sigma move to *Show the working*. Significance columns move to the CSV export. |
| PLC-versus-product comparison table | Becomes the one sentence on Weight and a table in Details. |
| Sync as an every-role screen; duplicate Setup → Sync tab; lifetime pass statistics, p95 timings, watermarks, fingerprint hashes | One Sync health section under Setup; header sentence for everyone. |
| Two-pane login with plant-link indicator | Single centred sign-in. |
| Icon rail, section column, sub-tab rows, uppercase mono eyebrows, DM Mono numerals, verdict/caveat pattern, "Light Steel" tokens | Replaced by §4 and §10. |
| Text-size control | Reduced to Desk / Wall, in the user menu. |
| Every Q-number and DQ-id in the interface | Removed. Plain state instead ("Code names not yet supplied"). |

## 10. Visual direction

A briefing note, not a cockpit. One typeface throughout — **Archivo**, already
shipped self-hosted via `@fontsource` in the bundle — set with tabular figures;
DM Mono removed. Body 17px, figure qualifiers 22px, the three headline figures
40px, the one headline sentence 30px. White page, near-black text, a warm light
grey for rules and table lines, and **one accent, a deep amber-red, meaning one
thing: this needs attention.** Green almost absent: a healthy screen is calm
black text on white. Density low: seven elements above the fold, 32px between
blocks, rules instead of borders, no shadows, radii ≤ 4px, no nesting. Charts
in the same type, direct labels, three gridlines. Tone: a competent colleague
reporting to the GM — full sentences, present tense, no hedging beyond the
header sentence and the two load-bearing caveats (sack–cone window; breaks
versus faults).

## 11. Questions to send IFL together, now

1. **Sack stock (Q23):** `IFL_SACK_STOCK_QUESTION.md` — drafted, unsent, and the
   longest lead item.
2. **Reject code meanings (Q10):** re-ask in the same message.
3. **"AI" (Q24):** is it contractual, or is trend-based analytics acceptable?
4. **Device (Q25):** wall monitor, shared PC, phones; and whether Urdu labels
   are wanted.
5. **Weight basis (Q4/Q5):** gross or net, and units — until answered the
   Weight headline cannot state a difference from target as a finding.

## 12. Build order

0. Send §11.
1. **Delete** everything in §9 that is dead today: Output, Shifts, Exceptions,
   Product history route, Sacks/Cones lists, giveaway, the three orphaned
   endpoints and their services. Rename roles by migration. Re-run the suite.
2. **API:** product-at-timestamp resolver; `shift` parameter on
   `/api/calibration`, `/api/rejects`, `/api/reject-spc`; per-day-per-code
   rejects; bias vs target and adjustment-reset in `/api/calibration`; the
   three header states in `/api/live`; *Product limits* rule; product-details
   overlay; station count from Setup.
3. **Shell:** top bar, period control, header sentence, sheet component,
   Archivo-only tokens.
4. **Screens**, each verified before the next: Line → Readings → Report →
   Weight → Rejects → Wall → Setup.
5. **Gates before any demo:** word budget per screen (Line ≤ 60, Wall ≤ 30,
   Report ≤ 100, Readings chrome ≤ 40, Weight and Rejects ≤ 120 on the default
   view); label-collision audit at 900, 1280 and 1600px; hover on every chart;
   one week of simulator data with the attention triggers counted for false
   positives; a walkthrough with IFL's representative on the simulator.
