# Decisions pending — SMS

**As of 3 September 2026.** Everything below is built and working; each item is
a judgement call that is **not mine to make**, recorded so it is not lost.

Nothing here blocks a demo. Items 5–9 block **go-live with IFL**.

---

## 1. Two strings were added to `words.ts` — designer to confirm

**Status:** done, and it contradicts one line of the handoff.

The handoff's file table says `web/src/lib/words.ts` — **"No change. No new
strings anywhere."** But two pieces of copy are specified in the same bundle:

| String | Where the bundle asks for it |
|---|---|
| `plantClock` — "plant clock" | §Line: *"Left: 8px dot + 'TP1 · Line 3 · Unit 2 · plant clock 11:26:04'"* |
| `report.verdict` — "Verdict" | The verdict mark's own label in the design reference |

Doctrine rule 7 says every user-visible string lives in `words.ts`, so putting
them there is the compliant way to render specified copy.

**Decide:** keep both (current state), or drop the labels and render a bare
clock and an unlabelled ink block. I recommend keeping them — an unlabelled
second time beside "Readings to 16:39" reads as the same clock, and an
unlabelled ink block does not say what it is.

## 2. Acceptance check 1 cannot pass — designer to restate

**Status:** measured, not fixable in code.

> *"No screen shows more than four of the six type steps."*

Line, Weight, Rejects and Report each measure **six**. Every one is mandated by
the spec's own screen descriptions: a headline (`head`), the three figures
(`display`), their qualifier (`qual`), body sentences (`body`), captions and
block labels (`small`), and axis ticks or station labels (`tick`).

The only avoidable size — a 30px inline on Weight — is gone, replaced by the
`.fig-val.small` class the bundle ships for that case.

**Decide:** relax the check to five or six, or restate it (perhaps "at most
four per *block*", which the app does satisfy).

## 3. Label-less blocks span the full width — designer to confirm

**Status:** as the bundle's own CSS specifies.

`.block.wide` exists with the comment *"A block with no label spans both
columns rather than leaving a 180px hole"* — so the figures row starts at the
page edge while labelled content starts 220px in. That is **two** content left
edges, where acceptance check 4 asks for one.

Forcing the figures into the 830px content column would overflow them: four
totals at `--fs-display` need about 290px each.

**Decide:** keep (current), or accept narrower figures.

## 4. Reject reason names are long because IFL has not named the codes

**Status:** this is open question §6, now answered with real data.

The spec assumed two dominant named reasons. The **real distribution is a
nine-code tail** — top two at 55% and 25% — and because the codes are unnamed
every label reads *"Code 10/1 — not yet named"*, 26 characters, which wraps to
three lines in the half-width reasons column.

It resolves itself the moment IFL supplies the names (item 6). If they never
do, the reasons block wants a different treatment than horizontal bars.

**Decide:** leave as is until IFL answers, or design a narrow-column variant.

---

## 5–9. The five questions for IFL — **not yet sent**

Drafted in `REDESIGN.md` §11. These have long turnarounds and block real
functionality. Send them together.

| # | Question | What it blocks |
|---|---|---|
| 5 | **Sack stock per machine** (`IFL_SACK_STOCK_QUESTION.md`) | Requirement 7 entirely. Their sack table carries no machine and no record of a sack leaving, so it is not computable by anyone. The largest missing module. |
| 6 | **Reject code meanings** | The Rejects screen names codes instead of reasons (item 4 above). |
| 7 | **Is "AI" contractual?** | Whether the calibration advisory needs re-framing. They are non-technical here and simply expect AI in the product. |
| 8 | **Which device, and Urdu?** | The wall is built for 1920×1080. Urdu is a substantial piece of work — Instrument Sans has no Arabic script, so it needs a second family, a type-ramp audit and a decision on RTL. It deserves its own spec. |
| 9 | **Weight basis, gross or net** | The Weight headline **cannot state its most useful finding** until this is answered. Today it states the average and the target as two facts, because on opposite bases the comparison is out by a whole tube. |

**Who at IFL owns item 9, and is anyone chasing it?**

---

## 10. Two open questions I resolved as recommended

Recorded so the decisions are visible, not to reopen them.

- **§1 Wall bar scale** — bar height is `count ÷ period max × 92px`, floored at
  4px so "produced something" and "produced nothing" stay distinct, and zero is
  the only genuine gap. Period max, not a fixed ceiling: the board answers "is
  anything out of line right now", not "how does today compare with Tuesday".
- **§4 CSV attribution** — the filename carries who exported it, and trailing
  rows after a blank line carry the line, period, coverage and exporter. Never
  a comment header: Excel shows that as a mangled first row.
  **Still unanswered: who receives these CSVs, and do they open them in Excel
  or feed them to something?**

## 11. Also outstanding, from the structural redesign

Listed in `REDESIGN.md`. Not part of the visual handoff.

- The role rename to viewer / engineer / manager / admin.
- The app-owned product-details overlay, and a *Product limits* rule in Setup —
  requirement 2 says "defined limits" and there is currently nowhere for IFL to
  define them.
- The per-day-per-code reject reason sheet.
- The station sheet. The spec says *"the adjustment log lives in the station
  sheet"*; that sheet does not exist yet, so the log has no home.
- The line-level sack ledger, once IFL answers item 5.

---

## 12. Two pieces of MY test data are in the app database — your call

**Status:** created during acceptance testing on 3 September 2026, still there.

Both are in the **app-owned** database (`sms`), never IFL's. Neither is a
defect; both are residue I made proving the app works, and deleting rows from
an audit trail is not a call I should make alone.

| What | Where it shows | Why it was created |
|---|---|---|
| A calibration adjustment on **station 7**, reason *"verification test — reference weight checked"* | Weight's station table now reads "Adjusted today, steady since." for station 7, and that station's drift detection has been reset from that moment | To prove the Log-an-adjustment round trip writes, attributes and displays correctly |
| A test account **`floor`** at operator rank | Setup's user list | To prove that roles gate writes only, and that a low rank never meets a 403 |

**Decide:** remove both before the next IFL demo, or keep them. If you want
them gone I can do it — say so and I will; I have not touched them because a
logged calibration adjustment is exactly the kind of record that should not
disappear without the owner saying it may.

## 13. Verification found six defects, all now fixed — nothing pending

Recorded only so the fixes are not mistaken for taste and undone later.

1. **Line's figures ignored the global period** — every period printed the
   current shift's three numbers on the one screen whose question is "what has
   it made this period".
2. **The reject reason labels rendered at ZERO width** between 861 and 1040px,
   painting each reason over its own bar. `.two-col` collapsed at the page's
   860px breakpoint, but its half column stops fitting a reasons row about
   180px earlier. A breakpoint belongs to the narrowest content in the column,
   not to the page.
3. **Neither register could be opened from a keyboard.** Readings and Weight
   build rows as `<tr onClick>` with no tabindex and an aria-hidden chevron, so
   the sheet — the whole drill-down mechanism — was mouse-only. Line was
   already correct, which is how the inconsistency surfaced.
4. **"Adjusted 0 days ago by , steady since."** The string asked for a name the
   row type does not carry, so the comma had nothing before it and never could
   have; and "0 days ago" is how it read for every adjustment logged that day.
5. **The wall's bars were the one dimension not sized in vw**, so on the 2560
   and 3840 panels the stylesheet is explicitly written for, the type doubled
   and the bars did not.
6. **The wall's station row hung from the bottom**, so the one station whose
   name wraps to two lines lifted its own bar 31px above its neighbours' — a
   crooked baseline on the screen read from four metres.

---

## 14. Data-trust audit, 2 Oct 2026 — decisions for the owner

**As of 2 October 2026.** A read-only audit of every figure SMS stores, calculates, prints and exports, followed by a fix stage, left a list of questions that are **not mine to answer**. Each one is below in plain words first, then the options with the measured numbers, then what I recommend, then who decides. **Nothing here has been changed in the code unless it says "fixed".** Register: `DEFECTS.md` Part 15; the audit's own ids (C-nnn) are in every heading.

**How to read the evidence.** Every number was measured on this dev PC only: the read-only copy `sms_audit` (a restore of the 29 Sep backup), July generation = epochs 1-4, September generation = epochs 9-12, real data to 7 Sep 2026, simulator excluded. Nothing was measured on the plant, and the 10 Jul - 5 Aug month was never sent by IFL. Nobody has looked at a printed page or opened a workbook in Excel.

**Two parts.** Sections 14.1 to 14.6 are for **you** (the owner). Section 14.7 lists the questions for **IFL**: they are drafted as `IFL-OPEN-QUESTIONS.md` items 30-41, marked "not sent", and no agent sends anything. Where an owner decision also needs an IFL answer, it says so.

### 14.1 A. Statistical method — what the control charts and flags should and should not claim

**14.1.1 The reject control band flags far too many days** (C-012; `DEFECTS.md` D-184)

- **In plain words.** The reject chart draws a band around the usual daily reject rate and marks any day outside it. The band is calculated as if every cone were an independent coin toss. Real daily rates wander much more than that (about 100 times more), so a normal day often looks like a problem: 22 of 34 September days and 16 of 19 July days fall outside the band.
- **Measured.** 22/34 Sept, 16/19 July days outside; phi about 113.
- **Options the audit named.** Laney p-prime; I-MR on rates; caveat sentence.
- **Recommended.** Keep the numbers, replace the band with one that allows for day-to-day wander (Laney p-prime, or an individuals chart on the daily rate), and until then print one sentence saying the band is too tight.
- **Who decides.** Owner (statistical method).

**14.1.2 The Home sentence "reject rate rising" fires on 43 % of days** (C-013; `DEFECTS.md` D-185)

- **In plain words.** The Home screen says the reject rate is rising whenever the last day sits outside the band above. Because the band is too tight, that is 23 of 53 days.
- **Measured.** 23 of 53 days.
- **Options the audit named.** Require 2+ buckets; method change with C-012.
- **Recommended.** Require two or more consecutive buckets before saying "rising", and settle it together with C-012 so the two cannot disagree.
- **Who decides.** Owner (statistical method), together with C-012.

**14.1.3 Per-station drift flags still use all eight pattern rules (RT-019 says closed)** (C-014; `DEFECTS.md` D-186)

- **In plain words.** RT-019 was closed on 25 Sep as "rules 2-8 stay withheld". That is true of the average-weight chart. The per-station flag on the Calibration screen and report still applies all eight rules to daily station means, which move slowly from one day to the next, so it flags 11 of 14 stations.
- **Measured.** 11/14 stations on /api/calibration; closure text says no pattern alarms.
- **Options the audit named.** Withhold rules 2-8 on station series; or correct RT-019 wording.
- **Recommended.** Withhold rules 2-8 on the station series as on the chart, or at least correct the closure wording so nobody reads "closed" as "no pattern alarms anywhere" (this pass already corrected the wording in `DEFECTS.md` Part 15).
- **Who decides.** Owner.

**14.1.4 The individuals-and-moving-range band flags small groups** (C-045; `DEFECTS.md` D-198)

- **In plain words.** A group of 5 cones is judged with the same band as a group of 500, so small groups are marked far more often (15.7 % of small groups against 2.9 % of large ones).
- **Measured.** 15.7 pct vs 2.9 pct.
- **Options the audit named.** Min-n marking; n-scaled limits.
- **Recommended.** Do not mark a point on a group smaller than a minimum size, or scale the limits with the group size.
- **Who decides.** Owner (statistical method).

**14.1.5 The days-to-limit confidence range ignores day-to-day correlation** (C-053; `DEFECTS.md` D-199)

- **In plain words.** The "days until a station reaches its limit" range treats each day as independent. Station means are correlated from day to day (lag-1 0.38 to 0.50), so the range is too narrow: a no-trend simulation produces false trends in 22 % to 34 % of runs.
- **Measured.** lag-1 0.38-0.50; null 22-34 pct false trends.
- **Options the audit named.** Inflate variance or state assumption.
- **Recommended.** Widen the range for the correlation, or print the independence assumption beside the figure.
- **Who decides.** Owner (statistical method).

**14.1.6 When a product has no limits the drift threshold falls back to a made-up number** (C-054; `DEFECTS.md` D-200)

- **In plain words.** Without limits the drift flag uses 0.3 times the spread of station means (0.52 g on July) instead of a tolerance-based rule, so a flag can appear for a product that has no tolerance at all.
- **Measured.** 0.52 g July.
- **Options the audit named.** No flag without limits.
- **Recommended.** Do not flag a station when no limits are in force; say so instead.
- **Who decides.** Owner.

**14.1.7 A day with two cones becomes a point on a station's chart** (C-055; `DEFECTS.md` D-156)

- **In plain words.** A station that weighed only two cones in a day still contributes that day to its series, which can move the spread by about 28 %.
- **Measured.** sigma +28 pct.
- **Options the audit named.** Min cones per station-day.
- **Recommended.** Set a minimum number of cones for a station-day to count (for example 30).
- **Who decides.** Owner.

**14.1.8 At an epoch restart the first day is cut at midnight** (C-057; `DEFECTS.md` D-201)

- **In plain words.** Where a source generation restarts, the series is cut at a calendar-day end rather than at the restart instant; the audit measured 48.6 % of the readings on the affected day as pre-adjustment readings (finder A22).
- **Measured.** 48.6 pct pre-adjustment readings.
- **Options the audit named.** Mixed-day rule.
- **Recommended.** Add a rule for a day that straddles an adjustment (split it, or exclude it from the series).
- **Who decides.** Owner.

**14.1.9 The alternation rule flags a level drift** (C-058; `DEFECTS.md` D-202)

- **In plain words.** Station 3 is flagged by rule 4 (alternating up and down) alone, although the weights are drifting in level, not alternating.
- **Measured.** station 3 rule 4 only.
- **Options the audit named.** Restrict rules.
- **Recommended.** Restrict the rules a station can be flagged by (ties in with C-014).
- **Who decides.** Owner.

**14.1.10 Station against line includes the station itself** (C-059; `DEFECTS.md` D-203)

- **In plain words.** A station's bias against the line mean uses a line mean that contains that station, so the bias is understated by at most 1.1 g.
- **Measured.** max 1.1 g understated.
- **Options the audit named.** Leave-one-out.
- **Recommended.** Compare against the line mean of the other 13 stations (leave-one-out).
- **Who decides.** Owner.

**14.1.11 Sigma uses moving ranges that cross gaps** (C-062; `DEFECTS.md` D-204)

- **In plain words.** The spread estimate uses differences between consecutive series values even where days are missing: 10 of 312 pairs (9 %) span a gap.
- **Measured.** 10 of 312 pairs, 9 pct.
- **Options the audit named.** Consecutive pairs only.
- **Recommended.** Use consecutive-day pairs only.
- **Who decides.** Owner.

**14.1.12 Whole-line capability blends materials** (C-044; `DEFECTS.md` D-197)

- **In plain words.** The capability figure for the line mixes products with different limits. Per material the Ppk is 1.45 to 2.12, the blended line 1.58.
- **Measured.** per-material Ppk 1.45-2.12 vs 1.58.
- **Options the audit named.** Label whole line or split.
- **Recommended.** Label the figure "whole line, mixed products", or split it per product.
- **Who decides.** Owner.

**14.1.13 The Weight screen's Cp/Cpk uses the hand-entered current product** (C-006; `DEFECTS.md` D-182)

- **In plain words.** The screen takes its limits and target from the product somebody selected, not from the product each cone actually ran. September Cpk is 1.297 on the selected product against 1.705 on the cones' own limits (24 % lower).
- **Measured.** Cpk 1.297 vs 1.705 (-24 pct) Sept.
- **Options the audit named.** Derive limits from ran materials; withhold when limits differ.
- **Recommended.** Derive the limits from the materials that ran in the period and withhold the index where they differ.
- **Who decides.** Owner.

**14.1.14 Mechanics of the pattern-rule engine** (C-048; `DEFECTS.md` D-157)

- **In plain words.** Four small behaviours of the rule engine (a zero standard error, rules 5 and 6, ties, the rule 8 variant) are recorded in `DEFECTS.md`; they are the same class as C-014 and RT-019.
- **Recommended.** Leave as is until C-014 is decided.
- **Who decides.** Owner.

### 14.2 B. Shift views and filters — what a report should do when the selection cannot be honoured

**14.2.1 Station, cone-weight and calibration figures are whole days under a shift range** (C-004; `DEFECTS.md` D-180)

- **In plain words.** Pick "1 Sep evening to 2 Sep morning" and the rejects, sacks and the summary follow it, but the station table, cone-weight report and calibration report still describe whole production days (September n 6,362 against 3,098; station 13 is 5.3 g off). The new fixes did not change this.
- **Measured.** Sept n 6,362 vs 3,098; station 13 5.3 g off.
- **Options the audit named.** Disclose; narrow; refuse range (400).
- **Recommended.** Narrow them to the range (the data supports it), or refuse with a clear message; at the very least print one sentence saying the figures are whole days.
- **Who decides.** Owner.

**14.2.2 Product report: a station filter leaves sack figures line-wide** (C-005; `DEFECTS.md` D-181)

- **In plain words.** A sack carries no station. With station 1 selected the Product report still prints all 5,435 sacks, so cones per sack falls from 24.4 to 12.3.
- **Measured.** station=1 prints 5,435 sacks; cones/sack 12.3 vs 24.4.
- **Options the audit named.** Blank sack columns with sentence; or remove station filter for Product.
- **Recommended.** Blank the sack columns when a station is chosen and say why, or remove the station filter from the Product report.
- **Who decides.** Owner.

**14.2.3 "This shift" silently becomes a whole day on four reports** (C-129; `DEFECTS.md` D-221)

- **In plain words.** Four report types ignore the "This shift" chip and print the whole day (morning 10.01 % against 4.69 %).
- **Measured.** morning 10.01 vs 4.69 pct.
- **Options the audit named.** Sentence or disable chip.
- **Recommended.** Print a sentence, or disable the chip on those reports.
- **Who decides.** Owner.

**14.2.4 Should the sacks ledger be shift-bounded? (follow-up to the C-170 fix)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** The Sacks screen's stock ledger is kept per whole production day. The 2 Oct fix says so under a shift headline but does not shift-bound it (night: 51 sacks against a ledger day of 148).
- **Recommended.** Keep it whole-day: a stock balance is a whole-day concept; the sentence is enough.
- **Who decides.** Owner.

**14.2.5 Station-flag count under a shift range (follow-up to the C-128 fix)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** The 2 Oct fix prints "not stated" for periods under 3 days. For a shift range that sits inside 3 or more days the count is still a whole-day count.
- **Recommended.** Decide with C-004.
- **Who decides.** Owner.

### 14.3 C. Time, stops and the live verdict

**14.3.1 The live "line stopped" sentence uses one lag for all winders** (C-008; `DEFECTS.md` D-183)

- **In plain words.** Every winder's cones reach the database a different, steady time after they are weighed (September 6.0 to 11.2 minutes, July 15.4 to 20.4 minutes). The app judges the newest cone against one median lag, so an emulation says "stopped" about 10 % of the time the line is running (September 10.4 %, July 4.7 %). This is an emulation, not an observation of the plant.
- **Measured.** emulation 10.4 pct false stopped Sept, 4.7 July.
- **Options the audit named.** Per-winder lag; high-percentile lag; keep with wording.
- **Recommended.** Use a per-winder lag, or a high-percentile lag; failing that keep the sentence but add the wording that it can be wrong for up to a few minutes.
- **Who decides.** Owner.

**14.3.2 A stop that crosses 06:00 is dropped** (C-064; `DEFECTS.md` D-205)

- **In plain words.** Time lost is measured inside one production day, so a stop that begins before 06:00 and ends after it is counted in neither day: July 20.2 % of lost time (a 9.7 h stop), September 1.83 %.
- **Measured.** July 20.2 pct of lost time (9.7 h stop); Sept 1.83 pct.
- **Options the audit named.** Day of start; split; disclose.
- **Recommended.** Count it on the day it started, split it at 06:00, or print a disclosure; they differ by whether daily totals add up.
- **Who decides.** Owner, with the IFL stop definition (draft item 33).

**14.3.3 5 Aug, a partial first day, overstates downtime** (C-065; `DEFECTS.md` D-206)

- **In plain words.** The first day after IFL's rebuild starts mid-day; its downtime is 29,681 s against about 7,400 s once the hours with no data are not counted as stopped.
- **Measured.** 29,681 s vs about 7,400 s.
- **Options the audit named.** Clip to first frontier; coverage flag.
- **Recommended.** Clip to the first frontier or print a coverage flag.
- **Who decides.** Owner.

**14.3.4 Stops are clipped at shift edges** (C-166; `DEFECTS.md` D-225)

- **In plain words.** Shift reports clip a stop at the shift boundary, which contradicts KPI row 17 and makes the summary and the daily report disagree (P09 +3.6 %, evening shift +13.4 %).
- **Measured.** P09 +3.6 pct, evening +13.4.
- **Options the audit named.** Clip, belong-to-neither, in-range only.
- **Recommended.** Choose one: clip, "belongs to neither", or in-range stops only; then make every report follow it.
- **Who decides.** Owner.

**14.3.5 Is 120 seconds the right stop threshold?** (C-067; `DEFECTS.md` D-207)

- **In plain words.** The 120 s threshold has no source. Moving it changes September's stop count by +17 % at 90 s and -27 % at 150 s.
- **Measured.** Sept stops +17 pct at 90 s, -27 pct at 150 s.
- **Options the audit named.** Sensitivity note; IFL definition.
- **Recommended.** Print a sensitivity note until IFL supplies a definition.
- **Who decides.** Owner, then IFL (draft item 33).

**14.3.6 The machines grid is anchored on the newest data, not on now** (C-068; `DEFECTS.md` D-208)

- **In plain words.** By design the grid shows the newest data and does not say how old it is.
- **Measured.** design, F-22.
- **Options the audit named.** Show tip age.
- **Recommended.** Print the age of the newest reading on the grid.
- **Who decides.** Owner.

**14.3.7 The withdrawn "availability" is still served by the API** (C-071; `DEFECTS.md` D-209)

- **In plain words.** OEE was withdrawn from the product on 2 Sep but an availability figure is still served (55.8 % against 90.9 % depending on the denominator).
- **Measured.** 55.8 vs 90.9 pct.
- **Options the audit named.** Decide denominator before reviving.
- **Recommended.** Decide the denominator before reviving it; until then keep it unserved by any screen.
- **Who decides.** Owner.

**14.3.8 A closed shift's figures keep changing for a while** (C-104; `DEFECTS.md` D-219)

- **In plain words.** Because rows arrive up to 20 minutes late, a shift that has ended can still gain readings (4.5 % of July rows, 2.0 % of September rows arrive after the shift ended).
- **Measured.** 4.5 pct July, 2.0 pct Sept late.
- **Options the audit named.** Complete-as-of line.
- **Recommended.** Print a "complete as of" line on shift reports.
- **Who decides.** Owner.

**14.3.9 App-written instants show in the viewer's time zone** (C-145; `DEFECTS.md` D-223)

- **In plain words.** Times the application itself wrote (adjustments, sync passes) are shown in the viewer's browser zone beside plant-clock times, which are never converted.
- **Measured.** F-38.
- **Options the audit named.** Pin plant zone.
- **Recommended.** Pin them to the plant zone.
- **Who decides.** Owner.

**14.3.10 Which shift rule defines the edge of the day for a rule lookup?** (C-037; `DEFECTS.md` D-116)

- **In plain words.** Rule-as-of lookups use a calendar-day end, while the production day starts at 06:00 under the shift rule that was in force. No real reading sits in an affected window today, so nothing is wrong yet; the fix spans nine files.
- **Recommended.** Decide the definition first (the rule version in force at the day's own start), then fix once.
- **Who decides.** Owner.

**14.3.11 Live sack kilograms ignore a net weight basis** (C-072; `DEFECTS.md` D-115)

- **In plain words.** If IFL ever configures a net basis, the live sack total would still show gross (net 1,910.32 against 1,889.82 kg). IFL said "gross" for sacks on 15 Sep, so nothing is wrong today.
- **Recommended.** Revisit only with C-019.
- **Who decides.** Owner, after IFL (draft item 32).

### 14.4 D. Data validity, generations and history

**14.4.1 Real history was never scanned by the data-quality checks** (C-002; `DEFECTS.md` D-179)

- **In plain words.** The checks run forward from go-live, so two real events were never evaluated: a 17.4-hour sack gap on 27 Jun (117 sacks, 66.2 cones per sack) and 220 over-weight cones.
- **Measured.** 117 sacks 27 Jun, 66.2 cones/sack; checks forward-only.
- **Options the audit named.** One-off read-only rescan; sack gap note on reports.
- **Recommended.** One read-only rescan of the real history and a note on reports that cross the gap.
- **Who decides.** Owner (it needs a backfill, so not an agent).

**14.4.2 A raw row with no dates would stop the transform** (C-031; `DEFECTS.md` D-190)

- **In plain words.** One raw row with both dates NULL would wedge the transform. There are 0 such rows in the real data.
- **Measured.** 0 NULL rows real.
- **Options the audit named.** Quarantine path.
- **Recommended.** Add a quarantine path before go-live.
- **Who decides.** Owner.

**14.4.3 The standing data-quality list mixes simulator and real findings** (C-096; `DEFECTS.md` D-216)

- **In plain words.** 21 of 33 findings on the dev database are simulator rows, with no label saying which generation they belong to.
- **Measured.** 21 of 33 simulator.
- **Options the audit named.** Add epoch to dq_finding.
- **Recommended.** Add the epoch to each finding. Irrelevant at IFL (no simulator).
- **Who decides.** Owner.

**14.4.4 Health reads OK when the data-quality table cannot be read** (C-101; `DEFECTS.md` D-217)

- **In plain words.** If the DQ table cannot be queried Health still says OK (a test pins this).
- **Measured.** test pins it.
- **Options the audit named.** Flag not consulted.
- **Recommended.** Show "not consulted" instead of OK.
- **Who decides.** Owner.

**14.4.5 An empty window pools generations in the opening stock** (C-171; `DEFECTS.md` D-226)

- **In plain words.** When a window holds no sacks, the opening stock is taken across both generations (10,897 against 5,435).
- **Measured.** 10,897 vs 5,435.
- **Options the audit named.** Use preceding generation.
- **Recommended.** Use the preceding generation only.
- **Who decides.** Owner.

**14.4.6 One misdated cone is counted as a production day** (C-172; `DEFECTS.md` D-227)

- **In plain words.** A September-generation cone dated 12 Jul 2026 (1 of 132,552) makes 12 Jul a production day.
- **Measured.** 1 of 132,552.
- **Options the audit named.** Exclude from figures.
- **Recommended.** Exclude it from figures and say so (the plant clock may have been wrong).
- **Who decides.** Owner.

**14.4.7 The summary prints "within limits 0.0 %" for July** (C-165; `DEFECTS.md` D-224)

- **In plain words.** July cones carry no product, so nothing can be judged against limits. The summary prints 0.0 % instead of "not judged".
- **Measured.** P01 prints 0.
- **Options the audit named.** Null when unattributed.
- **Recommended.** Print a dash when the share of unattributed cones is 100 %.
- **Who decides.** Owner.

**14.4.8 Per-station against target is withheld when all targets are equal** (C-041; `DEFECTS.md` D-196)

- **In plain words.** 9 of 14 stations show no "against target" figure because every product's target is 1,960 g and the screen treats equal targets as "no single target".
- **Measured.** 9 of 14 blank, all 1960.
- **Options the audit named.** Allow when setpoints equal.
- **Recommended.** Allow the figure when the setpoints are equal.
- **Who decides.** Owner.

**14.4.9 What counts as a limits "change" on the cone-weight report?** (C-040; `DEFECTS.md` D-195)

- **In plain words.** The cone-weight report prints a hard-coded 0 for limits changed, and the Product report counted the creation version until the 2 Oct fix (D-86).
- **Measured.** creation vs edit definition.
- **Options the audit named.** Define change, wire one count.
- **Recommended.** Define a change as a new version with a different value from its predecessor, and wire one count to every report.
- **Who decides.** Owner.

**14.4.10 KPI rows 51 and 55 say recorded weight where the figure is adjusted weight** (C-083; `DEFECTS.md` D-213)

- **In plain words.** The sheet's wording and the code differ on whether a calibration adjustment is applied; 0 rows fall in the edge bands, so no figure moves.
- **Measured.** 0 rows in edge bands.
- **Options the audit named.** Fix text.
- **Recommended.** Fix the sheet's text.
- **Who decides.** Owner.

**14.4.11 The weight-only hourly reject chart cannot flag a bad hour** (C-105; `DEFECTS.md` D-220)

- **In plain words.** A 64-reject hour has no control limits on the weight-only series.
- **Measured.** 64-reject hour no limits.
- **Options the audit named.** Exact binomial or sentence.
- **Recommended.** Use an exact binomial test, or a plain sentence.
- **Who decides.** Owner.

**14.4.12 July hanger flags come from the first 4.7 days** (C-033; `DEFECTS.md` D-192)

- **In plain words.** July's flagged hangers stop being flagged from 27 Jun, when the limits changed, so the flags describe the first 4.7 days.
- **Measured.** flags vanish from 27 Jun.
- **Options the audit named.** Disclosure of limit change.
- **Recommended.** Print a disclosure of the limit change on the hangers report.
- **Who decides.** Owner.

**14.4.13 The clock-fault day 2026-06-21 is reported as a 19.7-hour stoppage** (C-069; `DEFECTS.md` D-155)

- **In plain words.** Two stray readings on 2026-06-21 bracket a 19.7 h "stoppage" before the first real day.
- **Recommended.** Exclude the clock-fault days from stoppages as they are from other figures (July only).
- **Who decides.** Owner.

**14.4.14 Should the two real generations be pooled or shown side by side?** (C-178; `DEFECTS.md` D-228)

- **In plain words.** Sequential real generations are pooled in period figures that span the 5 Aug rebuild (the D-11 decision).
- **Measured.** D-11 decision.
- **Options the audit named.** Show both side by side.
- **Recommended.** Show both side by side where a period spans them.
- **Who decides.** Owner.

### 14.5 E. Wording that only the owner may change

**14.5.1 "About 3.8 hours" insert lag in CLAUDE.md, SCHEMA.md and QUESTIONS.md Q7** (C-079; `DEFECTS.md` D-212)

- **In plain words.** The 3.8-hour figure is an artefact of the 1970 sentinel rows. The true lag is a steady 6 to 11 minutes (September) and 15 to 20 minutes (July), per winder.
- **Measured.** 1970 sentinel artefact.
- **Options the audit named.** Correct SCHEMA, CLAUDE, QUESTIONS Q7 wording.
- **Recommended.** Correct the CLAUDE.md query rule and QUESTIONS.md Q7 wording. SCHEMA.md now carries a dated note (this pass).
- **Who decides.** Owner.

**14.5.2 CLAUDE.md and `.env` comment about the PDAS write path** (C-182; `DEFECTS.md` D-229)

- **In plain words.** CLAUDE.md said no PDAS procedure had ever been executed and `.env` carries a comment "ENABLED 22 Sep" above `PDAS_WRITE_ENABLED=false`. Both are stale: the flag has been true locally since 22 Sep and all nine write rights were proven through our code on 28 Sep (19 of 19 harness cases); the plant is off.
- **Measured.** .env line 58 present; 19/19 harness.
- **Options the audit named.** Dated note; owner corrects .env comment.
- **Recommended.** This pass corrected CLAUDE.md. The `.env` comment is the owner's alone to edit.
- **Who decides.** Owner.

### 14.6 F. New questions raised by the fix stage

**14.6.1 Should every export state how old its data is?** (C-115; `DEFECTS.md` D-112)

- **In plain words.** No export says when the newest reading was written. This is a missing feature, not a wrong figure.
- **Recommended.** Add a data-current-to row to the CSV, workbook and print header.
- **Who decides.** Owner.

**14.6.2 Response caches are not cleared on a write (up to 5 s)** (C-148; `DEFECTS.md` D-114)

- **In plain words.** After a configuration edit a cached answer can survive up to `CACHE_TTL_SECONDS` (5 s). The false sentence "applies immediately" was corrected; the delay itself was left.
- **Recommended.** Accept 5 s; or clear the response caches after configuration writes (one function).
- **Who decides.** Owner.

**14.6.3 Excel shows 0.09 for a stored 0.089** (C-123; `DEFECTS.md` D-113)

- **In plain words.** The workbook stores the exact value; the number style shows two decimals for three-decimal columns.
- **Recommended.** Per-column decimals if anyone complains.
- **Who decides.** Owner.

**14.6.4 Tied Pareto rows have no defined order** (C-109; `DEFECTS.md` D-111)

- **In plain words.** Rows with identical counts can swap order between runs.
- **Recommended.** Add reject type, tube and material to the sort.
- **Who decides.** Owner.

**14.6.5 Averages derived from kilograms rounded to 0.1** (C-074; `DEFECTS.md` D-109)

- **In plain words.** The average sack kg is derived from 0.1-kg-rounded kilograms, so it can be 0.01 kg off (4 of 152 groups).
- **Recommended.** Carry unrounded kilograms in `/api/production` (a payload change) or accept 0.01 kg.
- **Who decides.** Owner.

**14.6.6 The shift-rule drift check samples the newest 20,000 rows of any generation** (C-099; `DEFECTS.md` D-110)

- **In plain words.** On the dev box those rows are all simulator; at IFL they are the current generation.
- **Recommended.** Leave; revisit only if a simulator ever runs beside real data.
- **Who decides.** Owner.

**14.6.7 How should a rebuild treat acknowledged findings? (follow-up to C-011)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** The 2 Oct fix makes `sms rebuild --all-generations` refuse when an acknowledged finding is in scope, rather than empty canonical. The question left is what an operator should be able to do next.
- **Recommended.** Refuse and tell the operator to un-acknowledge (the safe default now); do not add a carry-over until a real need appears.
- **Who decides.** Owner.

**14.6.8 Should an acknowledgement expire? (follow-up to C-022)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** The 2 Oct fix keeps acknowledged findings out of the retention prune, so they accumulate. An acknowledgement is an engineer's judgement and may go stale.
- **Recommended.** Expire acknowledgements after a fixed period (for example 365 days) and then let retention prune them.
- **Who decides.** Owner.

**14.6.9 Should `sms verify --from/--to` use production days? (follow-up to C-028)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** The window is a calendar day (3 Jul: 7,861 cones against 7,923 for the production day). The 2 Oct fix only relabels it.
- **Recommended.** Switch to production days (06:00-06:00) so verify agrees with every report.
- **Who decides.** Owner.

**14.6.10 What rate should the hangers flag compare against under a filter? (follow-up to C-134)** (follow-up; `DEFECTS.md` D-108)

- **In plain words.** With a station or product filter the hangers report tests each hanger against the filtered population's own rate (station 14: 11.69 % against the line's 4.59 %), which hides a hanger that is bad for the line.
- **Recommended.** Test against the unfiltered line rate and show the filtered rate beside it.
- **Who decides.** Owner (statistical method).

### 14.7 Questions for IFL (drafted, not sent; cross-reference)

These are IFL's to answer. They are drafted in plain language in `IFL-OPEN-QUESTIONS.md` items 30-41, each headed "Draft, 2 Oct 2026 — not sent". An owner decision follows from each answer.

| Audit id | Draft item | Topic |
|---|---|---|
| C-001 | 30 | Quality inspection silent 14-18 Aug |
| C-017 | 31 | Average sack definition |
| C-019 | 32 | Weight basis |
| C-020 | 33 | Stop-time rule |
| C-032 and C-131 | 34 | Weight-reject definition and wording |
| C-034 | 35 | Sack scale window |
| C-035 | 36 | Implausible scale rejects |
| C-076 | 37 | Sack standard deviation window |
| C-084 | 38 | Cone records missing from the wide table |
| C-095 | 39 | Cause of stale_timestamp |
| C-102 | 40 | Outlier rule on weight rejects |
| C-075 | 41 | Sack time is insert time |

Not an IFL question but waiting on the **owner**: nothing in this list may be sent by an agent. Items that wait on both (C-008 and C-064 on the stop definition; C-072 on the weight basis) say so above.

### Fixed by the audit stage; shown here so they are not mistaken for taste and undone

The fix stage changed 44 report, screen, export and operator-tool behaviours that no longer need a decision (`DEFECTS.md` D-57 to D-105; sections "fixed" in Part 15). **Not committed yet** (fix written in the working tree, or not fixed): C-133 (D-83), C-134 (D-93), C-015 (D-79), C-138 (D-80), C-174 (D-81), C-117 (D-98). The owner's action on those is simply to commit them (after re-running the gate) or tell the next agent to; they are not judgement calls.

