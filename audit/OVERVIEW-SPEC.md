# The Overview screen — specification

**Phase 3 of the UX programme. Specification only.** No file under `sms/` was written,
edited or deleted in producing this. No application code, no visual design, no colours, no
pixel values, no component library. A separate worker builds from this document.

Repo: `C:/Users/ABDULLAH SAJID/Desktop/sag database`. Branch `floor-first-rework`,
HEAD `3a86039`.

Inputs read in full: `sms/web/src/screens/Line.tsx` (622 lines — **this is the Overview
screen today**), `audit/IA-PROPOSAL.md` §6, `audit/EXPOSURE-MATRIX.md`,
`sms/api/src/services/live.ts`, `sms/api/src/services/attention.ts`,
`sms/api/src/services/production.ts`, `sms/api/src/services/coneState.ts`,
`sms/api/src/services/productAt.ts`, `sms/web/src/App.tsx`, `sms/web/src/ui/Bar.tsx`,
`sms/web/src/lib/period.ts`, `sms/web/src/lib/health.ts`, `sms/web/src/lib/live.tsx`,
`sms/web/src/lib/words.ts`, `sms/web/src/api.ts`, `CLAUDE.md`, `REDESIGN.md` §12.

Every figure below cites the endpoint and field that supplies it. Every claim about what
exists today cites `path:line`.

> **Line numbers are against HEAD `3a86039`.** One file has moved since: a parallel worker
> landed the shared URL vocabulary in `sms/web/src/App.tsx` **during this pass**, uncommitted
> (`git status` → `M sms/web/src/App.tsx`, +156 / −11). Every `App.tsx:NNN` citation below is
> therefore the committed line, not the working-tree line; the *behaviour* cited is
> unchanged in the working tree, and §6 records exactly what that worker added and what it
> has not yet wired. Nothing else under `sms/` differs from HEAD.

---

## Contents

- [0. What this screen is, and the shape of the change](#0-what-this-screen-is-and-the-shape-of-the-change)
- [1. The screen contract — nine rules that bind every block](#1-the-screen-contract--nine-rules-that-bind-every-block)
- [2. The period control on this screen](#2-the-period-control-on-this-screen)
- [3. The blocks, in reading order](#3-the-blocks-in-reading-order)
  - [3.0 Headline](#30-headline)
  - [3.1 Output and quality — the KPI row](#31-output-and-quality--the-kpi-row)
  - [3.2 Attention](#32-attention)
  - [3.3 Stations](#33-stations)
  - [3.4 What is being made](#34-what-is-being-made)
  - [3.5 Last readings](#35-last-readings)
  - [3.6 Details](#36-details)
- [4. The ten-second test](#4-the-ten-second-test)
- [5. The drilldown register](#5-the-drilldown-register)
- [6. Context vocabulary this screen needs](#6-context-vocabulary-this-screen-needs)
- [7. What is removed or demoted](#7-what-is-removed-or-demoted)
- [8. What I deliberately did NOT add](#8-what-i-deliberately-did-not-add)
- [9. Figures I wanted that the API cannot supply](#9-figures-i-wanted-that-the-api-cannot-supply)
- [10. Defects found while specifying](#10-defects-found-while-specifying)
- [11. The word budget ledger](#11-the-word-budget-ledger)
- [12. What this spec does not settle](#12-what-this-spec-does-not-settle)

---

## 0. What this screen is, and the shape of the change

`sms/web/src/screens/Line.tsx` **is** the Overview. It is the default route
(`App.tsx:83` — an unrecognised `?s=` falls back to `line`), the first word in the bar
(`ui/Bar.tsx:31`), and the screen every session opens on. This document specifies its
improvement. **No new screen, no new route, no renaming of `?s=line`.**

Today it has seven regions: a headline, three figures, the attention list, the product
block, the machines block, the station grid, the last-readings pair, and a Details
disclosure (`Line.tsx:116-233`). All of the data is real, all of it is already served, and
**none of the figures is a link**. That is the defect. The owner's pattern is
*KPI → exception → drilldown*, and this screen supplies the KPI and the exception and then
stops: `IA-PROPOSAL.md` §6.1 records *"Line · 'cones rejected, N%' figure → Rejects, same
period: ✗ The figure is not a link"*, and the same for sacks.

**The shape of the change, in one sentence:** every number on this screen becomes a door,
one block that answered a question twice is merged into the block that answers it once, and
one genuinely missing quality fact — already computed by the API on every request and
thrown away by the client — is given a figure.

**What does not change:** the route, the endpoints called, the polling cadences, the
headline's refusal to assert a line state when health is not `ok`, the fixed 14-day
detector window, the acquisition-lag anchoring, the station-grid geometry, and the
Details text.

**Net block count: 7 → 6.** Net figures: 3 → 4. Net endpoints: **unchanged** — the six
calls at `Line.tsx:74-111` are the same six.

---

## 1. The screen contract — nine rules that bind every block

These are not style notes. Each one is a defect this project has already shipped and fixed,
and a builder who breaks one re-ships it.

1. **Nothing is measured against the browser's clock.** IFL's acquisition layer writes a
   cone's row about eighteen minutes after the cone is weighed (`live.ts:27-31`, measured
   over 142,509 rows: 909 s minimum, 1090 s mean). Every relative time on this screen is
   anchored on `dataAsOfUtc` — the newest reading on record — never on `Date.now()`.
   `Line.tsx:500-503` is the one helper that does this; nothing else may compute an age.

2. **When the pipeline is in doubt the words change, not just a dot.** `assessHealth`
   (`lib/health.ts:44`) reads the server's own verdict from `/api/live`
   (`live.ts:222`, `classifyHealth` at `live.ts:301`). When `stateIsKnowable` is false
   (`lib/health.ts:40`), the headline says it cannot tell and **the figures stay** — they
   are still the last true counts (`Line.tsx:245-250`).

3. **One status vocabulary, with its basis named every time.** The scale's own in-range bit
   ("Passed" / "Rejected by the scale") and the product's tolerance ("outside the product's
   limits") are two separately-named facts. A screen that says "outside limits" without
   saying which one is a defect (`words.ts:117-121`). The fourth KPI in §3.1 exists
   precisely to name the second fact; it may never be merged into the first.

4. **The detectors ignore the period.** Station drift and reject rise run over a fixed
   trailing window of production days (`attention.ts:19-25`, `lib/period.ts:156-182`),
   because the pattern tests need consecutive *days* and one shift is one point. Only the
   outside-limits rule honours the period (`attention.ts:303-311`). The screen states which
   is which — it does today (`Line.tsx:140`, `Line.tsx:224-229`) and must keep doing so.

5. **No over-claiming.** No "reduce station 7 by 9 g": weighing data cannot tell a heavy
   scale from heavy cones (`Line.tsx:383-386`). No product limits without a product. No
   figure stated more precisely than it was measured.

6. **A failure is never a zero.** `Line.tsx:126-135` and `:142-148` record the two worst
   instances already fixed here: a failed totals fetch rendering an endless skeleton, and a
   failed attention check rendering *"Nothing needs attention"* — the calm state — because
   an empty array looks the same whether the check ran or never ran. **Every block below
   carries an explicit error branch, and a third state — held data from a previous period —
   is addressed in §10 D1.**

7. **A zero is a zero.** An empty period is a normal fact on a plant that runs six days, and
   zero is a measurement (`Line.tsx:298-300`). The figures print `0`, not `—`. The
   distinction between "the line made nothing", "we have no readings" and "the source has
   not caught up" is carried in the *note* and the *headline*, not by blanking the value.

8. **Nothing changes height as it lands.** Every block reserves its own box:
   `SkelFigures`, `SkelLines`, `SkelStations` (`ui/bits.tsx:136,150,172`), and the station
   tag line is always rendered even when empty (`Line.tsx:565-569`). A fourth figure means
   `SkelFigures n={4}`.

9. **Line's word budget is 60 visible words** (`REDESIGN.md:380`). IFL's recorded objection
   was *"overflow of useless information"*. §11 is the ledger: every word added is paid for.

---

## 2. The period control on this screen

There is **one** period control, in the bar (`ui/Bar.tsx`, resolved `App.tsx:200-206`,
defined `lib/period.ts`). No block on this screen may carry a date picker
(`IA-PROPOSAL.md` §9 item 13).

The single most confusing thing about this screen is that **four different time windows are
on it at once**, and a reader who does not know which is which cannot trust any of them.
This table is the contract. It must be legible on screen, not only in this document.

| Block | Obeys the period? | The window it actually uses | Where it is stated on screen |
|---|---|---|---|
| Headline (§3.0) | **No** | Live: the current shift, judged against `dataAsOfUtc − lag`. Capped at the replay instant when `?at=` is set. | The sentence names the shift and its bounds (`Line.tsx:248`) |
| KPI row (§3.1) | **Yes** — `from`, `to`, `shift`, `tsTo` | Exactly the selected period (`Line.tsx:89-93`) | The bar's period control is the label |
| Attention (§3.2) | **Split** — drift and reject-rise use the fixed trailing window; outside-limits uses the period | `attention.data.window.days` production days for the first two (`attention.ts:19-25`); the period for the third | Block note: `W.judgedOver(days)` (`Line.tsx:140`, `words.ts:76`) — **which is wrong for the third finding and is fixed in §3.2** |
| Stations — counts (§3.3) | **Yes** | The selected period, grouped by station (`Line.tsx:94-98`) | Block label: `W.stationsNote` = "cones this period" (`Line.tsx:188`) |
| Stations — quiet tag (§3.3) | **No** | Twenty minutes back from `dataAsOfUtc` (`Line.tsx:55`, `:500-503`) | Block note (§3.3 makes the anchor explicit) |
| What is being made (§3.4) | **No**, except the replay cap | Two hours of plant time back from the newest reading (`machinesRunning`, `GET /api/machines/running`), capped at `period.tsTo` (`Line.tsx:111`) | Footer: `W.cone.machinesWindow` (`Line.tsx:492`) |
| Last readings (§3.5) | **No** | The newest sack and cone on record, from `/api/live` | The row prints the reading's own time |

**`tsTo` is not optional.** `period.tsTo` is always set and is always the plant clock
(`lib/period.ts:59-65`). It is what makes a replay honest: `/api/live` caps its counts at
the replay instant, and before `tsTo` was plumbed into `/api/production` the Overview
counted the whole shift while Wall counted to the replayed moment — mid-shift, Line read
roughly double Wall for the same shift (`Line.tsx:83-87`, `production.ts:30-40`). Any new
call added to this screen passes `tsTo`.

**The shift is a period property, not a separate control.** `period.shift` is set only when
the period *is* exactly one shift (`lib/period.ts:68`). Every call on this screen that takes
`shift` passes `period.shift` and nothing else.

---

## 3. The blocks, in reading order

Reading order: **Headline → KPI row → Attention → Stations → What is being made → Last
readings → Details.**

The one order change from today is that **Stations moves above What-is-being-made**
(today `Line.tsx:174` then `:187`). The reason is adjacency: the attention list names
stations ("Station 7 has read 9 g heavier than the line for 4 days"), and the station grid
is the surface a reader scans to find Station 7. Putting three lines of product text between
the claim and the thing it names costs a second of the ten.

Common to every block: it is a `Block` (`ui/bits.tsx:23`) with a label, an optional note,
and a body. It renders exactly one of: **Failed**, **Skeleton**, **Empty**, or **Content**.

---

### 3.0 Headline

**1. Purpose.** *Is the line running right now, and can I trust that answer?*

**2. Required information.**

| Figure | Endpoint · field | Available today |
|---|---|---|
| Question line ("Is the line running, what has it made this period, and does anything need attention?") | Static — `words.ts:54` `W.question.line` | ✓ rendered `Line.tsx:119` |
| Line short name | `GET /api/live` (`app.ts:354`) · `lines[0].lineShortName` (`live.ts` `LiveLine`) | ✓ `Line.tsx:292-294` |
| State — running / stopped / idle | `/api/live` · `state.status` (`live.ts:211`) | ✓ `Line.tsx:254-278` |
| How long stopped, net of the lag | `/api/live` · `state.behindSeconds` (`live.ts` `LineState`) | ✓ |
| Shift code, bounds, elapsed | `/api/live` · `shift.{code,startUtc,endUtc,elapsedSeconds}` | ✓ |
| Whether the state may be asserted | `/api/live` · `health.kind` → `assessHealth` → `stateIsKnowable` (`lib/health.ts:40,44`) | ✓ |

**No new data. This block is specified as unchanged.** It is the one part of the screen that
already does the hard thing correctly, and the temptation to "improve" it is the temptation
to reintroduce the permanent-"Stopped 17 min" defect (`CLAUDE.md`, live rehearsal, 2 Sep
2026).

**3. Filters.** None. The period does not touch it. `?at=` moves the instant it describes,
and the replay banner above it says so (`App.tsx:245-252`).

**4. Actions.** None. Rank 1 (read) — `app.use('/api', requireRole(1))` at `app.ts:293` is
the floor for the whole API.

**5. Drilldowns.** None from the headline itself. The health answer lives one row up, in the
strip, whose whole sentence is the link to `?s=health` (`Bar.tsx:254-260` →
`App.tsx:233`). **Do not add a second entry to health from the headline** — that is the
duplication rule, and `IA-PROPOSAL.md` §3.3 already proposes naming the destination in the
bar, which is where that fix belongs.

**6. Empty state.** `line == null` is handled above the screen, in the shell
(`App.tsx:190-196`): `W.lag.noData` = *"Nothing has been received from the plant yet."*
Within the screen, `dataAsOfUtc == null` resolves to `health.kind === 'none'` →
`stateIsKnowable` false → the "cannot tell" sentence plus the true shift. Unchanged.

**7. Error state.** A failed `/api/live` renders the shell's error paragraph
(`App.tsx:194`), not a headline. The screen never renders a headline from partial live
data. Unchanged.

**8. Stale / trust state.** Three cases, all already correct:
- `stale` (the sync missed three measured cadences — `live.ts:301-309`): headline says
  *"Cannot tell whether the line is running"* and still names the shift (`Line.tsx:245-250`).
- `late` (lag above `MAX_CREDIBLE_LAG_SECONDS`, `live.ts:69`): same.
- `ok`: the state is asserted, and the Details disclosure states the lag in the plant's own
  measured terms (`Line.tsx:218-222`).

**9. Acceptance test.** With the sync worker stopped for four minutes on the simulator and
the period set to This shift, the headline reads *"Cannot tell whether the line is
running. Morning shift, 06:00 to 14:00."*, the strip reads *"No new readings since HH:MM —
the plant link may be down."*, **and the KPI row below still shows its last counts rather
than dashes or zeros.**

---

### 3.1 Output and quality — the KPI row

**1. Purpose.** *What did the line produce over the selected period, and what is the quality
situation?* This is the block the ten-second test rests on, and it is the block the
owner's whole KPI → exception → drilldown pattern starts from.

**2. Required information.** Four figures. All four come from **one call already made**:
`getProduction({ from, to, shift, tsTo, groupBy: 'none' })` — `Line.tsx:89-93` →
`GET /api/production` (`app.ts:713`, rank 1).

| # | Value | Unit label | Note | Endpoint · field | Available today |
|---|---|---|---|---|---|
| 1 | Cones weighed | `W.fig.cones` "cones" | `W.withinLimits(pct)` — "98.7% within the scale's limits" | `/api/production` · `data.rows[0].cones`, `.conesInRangePct` | ✓ rendered `Line.tsx:308-313` |
| 2 | Sacks | `W.fig.sacks` "sacks" | `"{kg} kg"`, rounded to the kilogram | `/api/production` · `.sacks`, `.sackWeightKg` | ✓ `Line.tsx:317` |
| 3 | Rejected by the scale | `W.fig.rejected` "rejected" | `W.ofEverything(rate)` — rate over `cones + rejected` | `/api/production` · `.rejectedCones` | ✓ `Line.tsx:318` |
| 4 | **Outside the product's limits** ⭐ NEW | *(new string)* "outside the product's limits" | *(new string)* "{n} could not be judged" | `/api/production` · `data.states.low + data.states.high`; note from `data.states.unknown` | **Served today and discarded by the client.** `app.ts:734` sets `withStates: true` on *every* request; `production.ts:211-230` computes it; `web/src/api.ts:1450-1454` types it; `Line.tsx` never reads it. |

**Why figure 4 is the right fourth figure, and why this exact source.**

- It is the second half of ONE STATUS VOCABULARY (rule 3). Figures 1–3 are all the scale's
  own bit. The product's tolerance — the thing requirement 2 actually asks for, and the
  thing time-versioned limits exist to make honest — has no figure on the landing screen at
  all today. A reader must open Weight to learn it.
- `states` is produced by `coneState.ts`'s CASE expression, which is the application's
  single declared classification rule: *"There is deliberately no third place that knows the
  rule"* (`coneState.ts:9`). `low`/`high` mean **passed the scale, outside the limits in
  force at that reading's own time**; `unknown` means no weight, an implausible weight, or
  no limits in force (`coneState.ts:84-90`).
- **Its drilldown is exact by construction.** `GET /api/events?outsideProductLimits=true`
  resolves to states `['low','high']` — `app.ts:882` — the same CASE. The number on the
  Overview and the row count the reader lands on cannot disagree.
- It costs **zero new requests**.

**The note is what makes it honest.** When no product was in force for a period (all of
July — `CLAUDE.md`, attribution), `low + high` is 0 and `unknown` is the whole population.
The figure then reads `0` with the note *"142,511 could not be judged"* — which says
plainly that the zero is an absence of limits, not an absence of problems. This is rule 5
(no over-claiming) applied to a KPI.

**Every figure is a link.** Today none is (`Line.tsx:132` renders `Figures`, a passive
component). This is the single change in this document that most improves the ten-second
test, and it requires **no new API, no new URL key and no new handler**:
`LineScreen` already receives `onNavigate: (s: Screen, filter?: ReadingsFilter) => void`
(`Line.tsx:68`), wired at `App.tsx:261` to `go({ view: s, readingsFilter: filter ?? null })`,
and `go()` merges into the existing route so the period rides along (`App.tsx:137-142`).

**3. Filters.** The whole period: `from`, `to`, `shift`, `tsTo`. Nothing else. No product
filter on this screen — `/api/production` accepts `product=` (`production.ts:29`) but a
product-narrowed Overview would silently drop every pre-`MaterialId` reading and need the
`unattributed` caveat with it (`production.ts:138-162`). That belongs on Report, not here.

**4. Actions.** None. Rank 1 read. The figures are navigation, not writes.

**5. Drilldowns.** Four, and this is the heart of the block.

| Figure | Lands on | Context that travels | Exists today |
|---|---|---|---|
| Cones | Readings, cones listing, unfiltered | Period (via `go()` merge). Explicitly `readingsFilter: null` so a filter left over from an earlier hop is cleared. | **Build — wiring only.** `onNavigate('readings')` already exists. |
| Sacks | Sacks screen | Period | **Build — wiring only.** `'sacks'` is a valid `Screen` (`Bar.tsx:31`). |
| Rejected by the scale | Rejects screen | Period | **Build — wiring only.** |
| Outside the product's limits | Readings, narrowed to `rf=outsideLimits` | Period **and** the filter, both in the URL (`App.tsx:92-95,105`) | **Build — wiring only.** The identical hop already exists from Weight (`App.tsx:285`) and from the attention list (`Line.tsx:360`). |

Each hop is one `onNavigate` call. None needs a new parameter, a new route, or a backend
change. **This is four of the twelve missing hops in `IA-PROPOSAL.md` §6 closed for the
price of four onClick handlers, with no dependency on the URL work in §6.**

**6. Empty state.** Three distinct cases, three distinct sentences. The figures **always
render as numbers** (rule 7); the distinction is carried by the block note, which is absent
in the normal case and therefore adds no words to the budget when things are fine.

| Case | How it is detected | The note |
|---|---|---|
| The line made nothing in this period | `rows[0]` exists (or is absent) and `cones + sacks + rejectedCones === 0`, and health is `ok` | `W.nothingHere` — *"Nothing recorded in this period."* Figures read `0`. |
| We have no readings at all | `line.dataAsOfUtc == null` | The headline already says it (`W.lag.noData`). The KPI note repeats nothing. Figures read `0`. |
| The source has not caught up | `period.live === true` **and** the period's end is within `line.ingestLagSeconds` of `line.plantNowUtc` | *(new string)* *"Cones weighed in the last {lag} have not reached this system yet."* — with `{lag}` from `line.ingestLagSeconds`, formatted by `fmtSpan`, never a literal "18 minutes" (`words.ts:80-83` records why). |

The third case is the one the 2 Sep 2026 live rehearsal exists to teach: on a healthy line,
"This shift" is **structurally short** by one acquisition lag, every time. A manager reading
a shift total at 13:55 is reading a total that is eighteen minutes behind and has no way to
know it. Saying so is the difference between a low number meaning "the line slowed" and a
low number meaning "the rows have not arrived".

**7. Error state.** `totals.error` → the block renders `Failed` with the error text and a
Retry that calls `totals.refresh` (`ui/bits.tsx:194`). **It must never fall through to
`periodFigures(null)`**, which returns four zeros — that is the exact defect H14
(`Line.tsx:126-128`), fixed once, and the guard at `Line.tsx:129` is `totals.error &&
!totals.data`, which **is not sufficient** when data from a previous period is held. See
§10 D1; the acceptance test below depends on that fix.

**8. Stale / trust state.**
- Health not `ok`: the figures stay (rule 2 — they are the last true counts). The strip and
  the headline carry the doubt. The KPI block adds nothing; a second warning here is
  duplication.
- Replay (`line.replay === true`): the banner above the screen states it
  (`App.tsx:245-252`) and `tsTo` caps the counts. No per-block treatment.
- `data.implausible > 0` (`production.ts:227`): readings the population rule excluded as
  scale faults. **Not shown on the Overview** — it belongs in Details (§3.6), because it is
  a statement about the measuring apparatus, not about the shift. It is one line there.

**9. Acceptance test.**
> With the period set to **7 September 2026**, the KPI row shows four figures. Clicking the
> rejected figure lands on Rejects **with 7 September still selected in the bar's period
> control and `from=2026-09-07&to=2026-09-07` still in the address bar**, and the reject
> total on that screen equals the figure that was clicked. Clicking the fourth figure lands
> on Readings with the "outside the product's limits" chip applied and the same day, and the
> register's header count equals the figure that was clicked.

A second, cheaper test for the error rule:
> With the API stopped, reload the Overview on any period: the KPI block shows a failure
> message and a Retry control. It does **not** show four zeros, and it does not show an
> endless skeleton.

---

### 3.2 Attention

**1. Purpose.** *Does anything need attention, and where do I go to see the evidence?*

**2. Required information.** One call, already made: `getAttention({ from, to, shift })` —
`Line.tsx:102-106` → `GET /api/attention` (`app.ts:434`, rank 1).

| Figure | Endpoint · field | Available today |
|---|---|---|
| Up to three findings, worst first | `/api/attention` · `data.findings[]` (capped server-side at `MAX_SHOWN = 3`, `attention.ts:45,315`) | ✓ `Line.tsx:149-155` |
| Total before the cap | `data.totalFindings` | ✓ `Line.tsx:371-375` |
| The detector window in days | `data.window.days` | ✓ block note, `Line.tsx:140` |
| Drift threshold and minimum days held | `data.thresholds.{driftG,minDaysHeld}` | ✓ Details, `Line.tsx:226-228` |
| Per finding: kind, requirement, screen | `findings[].{kind,requirement,screen}` (`attention.ts:57-62`) | ✓ |
| Station drift: station, `deltaG`, `days`, `projection` | `findings[].{station,deltaG,days,projection}` | ✓ `Line.tsx:388-399` |
| Reject rise: `rejectKind`, `sinceUtc`, `ratePct`, `usualPct` | `findings[].{…}` | ✓ `Line.tsx:400-404` |
| Outside limits: `count` | `findings[].count` | ✓ `Line.tsx:405-406` — **and removed from the sentence, see below** |

**Three changes, all small, all closing recorded gaps.**

**(a) A station-drift finding opens that station, not the Weight screen.**
`IA-PROPOSAL.md` §6.1 records this as the screen's worst context drop: *"A station-drift
finding lands on Weight with fourteen unsorted rows and no indication which one it meant."*
The finding carries `f.station` (`attention.ts:63`), and this screen already has
`onOpenStation` (`Line.tsx:70`, wired `App.tsx:262` to `?sheet=station:N`), and
`StationSheet` already takes `periodTo` so it is judged against the selected period's own
limits (`StationSheet.tsx:57-61`). **Specification: when `f.kind === 'station_drift'` and
`f.station != null`, the row's control opens that station's sheet; the link word is the
station's own label from `stationLabel(stations.get(f.station), f.station)`
(`api.ts:1088`), not the word "Weight".** Everything needed exists; nothing new is fetched.

This is the hop `IA-PROPOSAL.md` §6 names as the single most valuable one to build — *"the
hop from a claim to the evidence for it"* — and the station sheet is the evidence
(`StationSheet.tsx:7-12`).

**(b) The outside-limits finding loses its own number.** The sentence today is
`W.disagreement(f.count)` — *"N cones in this period were passed by the scale but sit
outside the product's limits"* (`words.ts:132-135`, `Line.tsx:406`). With §3.1's fourth
figure directly above it, that is a second number for one fact **from a different SQL
population** (see §10 D2 — `productDisagreement` at `productAt.ts:463-471` does not apply
the plausibility rule and treats `in_range IS NULL` differently from `coneState`). Two
numbers for one fact, differing by a handful, on the landing screen, is worse than either.

**Specification:** the row reads a new countless string — *"Cones passed by the scale sit
outside the product's limits in this period."* — and its control is `W.seeThem` ("See
them", `words.ts:136`, already in the file) opening Readings with `rf=outsideLimits`, which
is the behaviour today (`Line.tsx:360`). `W.disagreement(n)` stays in `words.ts` for
Weight's banner (`Weight.tsx:190`), which is out of scope here.

**The finding is NOT suppressed.** Suppressing it would let a period with five hundred
outside-limit cones render *"Nothing needs attention"* beside a KPI of 500. It stays, and
`totalFindings` arithmetic is untouched.

**(c) The block note stops describing all three findings with one window.** The note today
is `W.judgedOver(window.days)` — *"judged over the last 14 production days"* — which is
true of drift and reject-rise and **false of the outside-limits finding, which honours the
period** (`attention.ts:24-25`, `:303-311`). Specification: the note keeps
`W.judgedOver(days)`, and the outside-limits row's own sentence carries *"in this period"*
(it already does, and the new countless string keeps those three words). No new words; the
one ambiguous claim is resolved by the sentence that sits inside it.

**3. Filters.** `from`, `to`, `shift` are sent (`Line.tsx:103`) and only rule 3 uses them.
**`tsTo` is not sent and cannot be** — `/api/attention` does not accept it. Under replay the
outside-limits finding therefore counts the whole selected period while the KPI above it
counts to the replay instant. This is a known, narrow divergence (§10 D3); it is invisible
outside replay, and removing the count from the sentence (change (b)) removes the only way
a reader could see it.

**4. Actions.** None. Rank 1. Each row's control is navigation.

**5. Drilldowns.**

| Finding kind | Lands on | Context that travels | Exists today |
|---|---|---|---|
| `station_drift` | That station's sheet, `?sheet=station:N` | Station id, `periodTo` | **Build — wiring only** (change (a)). Today: Weight, unsorted, unfiltered (`Line.tsx:360`) — ◐ drops context |
| `reject_rise` | Rejects screen | Period. **Not the reject kind** (`quality` / `weight`) — Rejects' own filters are component state (`Rejects.tsx:95-97`), so nothing can hand it off | ◐ **exists, drops context.** Carrying `rejectKind` needs the URL vocabulary of §6; out of scope for this screen alone |
| `outside_product_limits` | Readings, `rf=outsideLimits` | Period + filter, both in the URL | ✓ **exists and carries what it needs** (`Line.tsx:360`, `App.tsx:92-95`) |
| Overflow line "and N more" | The screen of the last rendered finding (`Line.tsx:371-375`) | Period | ✓ exists |

**6. Empty state.** `findings.length === 0` and the call succeeded → `W.nothingNeedsAttention`
*"Nothing needs attention."* in the calm styling (`Line.tsx:341-346`). This sentence is only
ever rendered on a **successful** response — that constraint is the fix for the worst H14
instance and must not be relaxed.

A second empty case the screen does not distinguish today and should: when the record holds
**fewer than `minDaysHeld` production days** inside the trailing window, the drift rule
*cannot* fire, so "Nothing needs attention" is a statement about the record, not the line.
`attention.data.window.days` is the number of days the detector actually had
(`attention.ts:317`, from `cal.days`). **Specification:** when `window.days < thresholds.
minDaysHeld` (`= 3`, `attention.ts:51`), the calm sentence is followed by *(new string)*
*"— only {n} production days in the window, too few to judge a station's drift."*
This is rule 5 applied to silence.

**7. Error state.** `attention.error && !attention.data` → `Failed` with Retry
(`Line.tsx:147-148`). **Never the calm sentence.** Reinforced: the builder must not
"simplify" the guard into `findings.length === 0`.

**8. Stale / trust state.** The detectors read canonical rows that are already in the
sidecar; a stale sync does not invalidate them, it only means no *new* ones will appear.
**Specification: no additional warning on this block when health is not `ok`.** The block
note already states the window, and the strip states the doubt. Adding a third warning here
is the density failure IFL named.

**9. Acceptance test.**
> On the September sample with the period set to 1–7 September 2026, the Attention block
> lists at most three sentences and its note reads "judged over the last 14 production days".
> Clicking a station-drift sentence opens that station's sheet — **the same station named in
> the sentence** — over the Overview, with Escape returning to it and the period control
> unchanged. Clicking the outside-limits sentence lands on Readings with the outside-limits
> chip applied and the same period.

---

### 3.3 Stations

**1. Purpose.** *Which machine should I look at?* — answered by scanning, in one pass,
without reading a table.

**2. Required information.** Two calls, both already made:
`getStations()` (`Line.tsx:77` → `GET /api/stations`, `app.ts:391`, rank 1) for the roster
and names, and `getProduction({…, groupBy: 'station' })` (`Line.tsx:94-98`) for the counts.
Live per-station activity rides on `/api/live` · `lines[0].stations[]` (`live.ts` `LiveLine`).

| Figure | Endpoint · field | Available today |
|---|---|---|
| The station roster (never a hardcoded fourteen) | `/api/stations` · `stations[].stationId` unioned with `/api/live` · `stations[].station` | ✓ `Line.tsx:529-533` |
| Station name, when the plant gave one | `/api/stations` · `stations[].name` | ✓ `Line.tsx:563` |
| Cones this period, per station | `/api/production?groupBy=station` · `rows[].cones`, keyed by `Number(rows[].group)` | ✓ `Line.tsx:543` |
| **Rejects this period, per station** ⭐ NEW | `/api/production?groupBy=station` · `rows[].rejectedCones` — **fetched today and discarded** (`Line.tsx:543` maps `r.cones` only) | **Served today and discarded by the client.** `production.ts:235-238` groups `sms.reject_event` by `source_station`. |
| Quiet, and for how long | `/api/live` · `stations[].lastTs`, against `dataAsOfUtc` (`Line.tsx:500-503`) | ✓ |

**The one change: the tag line earns its keep.** Every box already renders a tag line
unconditionally — `.st-tag` reserves 1.4em precisely so the grid does not reflow when a
station goes quiet (`Line.tsx:565-569`), and today that line is `W.quiet` or a space.

**Specification:** the tag line renders, in this precedence order:
1. `W.quiet` — when the station has produced nothing in the twenty minutes before
   `dataAsOfUtc` (`QUIET_AFTER_SECONDS`, `Line.tsx:55` — twenty minutes because five
   minutes fired on four of fourteen stations on a perfectly healthy line, `Line.tsx:44-54`).
   **Quiet always wins:** a machine that stopped is the bigger fact than a machine that
   rejected three cones.
2. *(new string)* `"{n} rejected"` — when not quiet and `rejectedCones > 0`.
3. A blank, as today.

This adds a quality signal at station granularity — the "where should I investigate"
answer — for **no new request, no new row, and no reflow**.

**Group keys that are not stations.** `groupBy=station` on `sms.reject_event` groups by
`source_station` (`production.ts:60`), which is `NULL` for rejects that carry no station
(the QCS path — `CLAUDE.md` Q2 redirects cone traceability to
`rejectWeight1_TP1U2.[Source]`, a station, which the *weight* reject path has and the
quality path may not). **Specification:** a row whose `group` does not parse to a station id
present in the grid's roster is excluded from the boxes, and its rejects are summed into the
block note as *(new string)* *"{n} rejects not attributed to a station"* — rendered only
when that sum is above zero, in the label row where `quietNote` already lives
(`Line.tsx:189`). Silently dropping them would make the boxes' rejects disagree with KPI
figure 3, and a reader who adds them up will notice.

**3. Filters.** The counts obey the full period including `tsTo`. The quiet tag does not and
must not — it is a live fact anchored on the newest reading.

**4. Actions.** None on the grid. Rank 1.

**5. Drilldowns.**

| Element | Lands on | Context that travels | Exists today |
|---|---|---|---|
| Any station box | That station's sheet, `?sheet=station:N` | Station id, `periodTo` (so the sheet is judged against the selected period's own product limits — `StationSheet.tsx:57-61`) | ✓ **exists** (`Line.tsx:553-557` → `App.tsx:262`) |
| A station box → that station's readings | Readings, filtered to station N, same period | Station id + period | ✗ **needs building and needs the shared `st=` URL key** (§6). Readings' station filter is component state (`Readings.tsx:112`), so nothing can hand it off. `IA-PROPOSAL.md` §6.6 names this the single most valuable missing hop in the product. **`GET /api/events` already accepts `station`** (`api.ts:503`) — this is a URL-vocabulary problem, not a backend one. |

**Specification on the second hop:** it is **not** offered from the grid box, which already
has one destination and must not grow a menu. It is offered **inside the station sheet**,
which is where a reader who wants the underlying cones already is. Naming it here because
this block is where the journey starts, and because the builder must not "solve" it by
adding a second control to a 14-box grid.

**6. Empty state.**
- Roster empty (`ids.length === 0`): `SkelStations n={14}` holds the full width and height
  while names arrive (`Line.tsx:537`). Unchanged.
- Counts loaded, all zero: every box reads `0`. That is a measurement, not an absence.
- `counts == null` (still loading): boxes read `—`, not `0` (`Line.tsx:550,564`). **This
  distinction is correct and must be preserved:** `—` means "not yet known", `0` means
  "none were made". They are different facts and the screen already tells them apart.

**7. Error state.** Either call failing with no data → one `Failed` for the whole block,
with a Retry that refreshes **both** (`Line.tsx:194-201`). The half-fixed version of this —
guarding on `stations` only — left every box in a permanent `—` when the counts call failed,
which is the endless-skeleton half of H14 in the same block as the fixed half
(`Line.tsx:191-193`). Do not re-split the guard.

**8. Stale / trust state.** Under `stale` or `late` health the quiet tags are still true —
they are measured to `dataAsOfUtc`, not to the clock — but a reader will read "quiet" as
"quiet now". **Specification:** when `health.kind !== 'ok'`, the block note is prefixed with
*(new string)* *"measured to the newest reading, {HH:MM}"*, using `fmtClock(line.dataAsOfUtc)`.
Under `ok` health the note is unchanged (`quietNote`, `Line.tsx:505-512`), so this costs no
words in the normal case.

**9. Acceptance test.**
> With the period set to 7 September 2026, the station grid shows one box per configured
> station, each with that station's cone count for that day; the counts sum to KPI figure 1.
> A station that rejected cones that day shows "{n} rejected" on its tag line; a station
> with no reading in the twenty minutes before the newest reading shows "quiet" instead,
> **even when it also has rejects.** Clicking any box opens that station's sheet and Escape
> returns to the Overview with 7 September still selected.

---

### 3.4 What is being made

**This block is the merge of today's two blocks: "Product recorded in this system"
(`Line.tsx:159-172`) and "What each machine is running" (`Line.tsx:174-185`).**

**1. Purpose.** *What is each machine running, and what does this system have on record for
the line?*

**Why they merge.** They answer one question twice, which the duplication rule forbids
across screens and should not be tolerated within one. Since IFL's 2026-08-05 source
rebuild every cone carries its own `MaterialId`, up to six materials run concurrently on
different machines, and **the line-wide "Current Product" is now only the fallback for
pre-`MaterialId` rows** (`CLAUDE.md`, September 2026 section). The per-machine list is the
truth; the line-wide record is a footnote to it. Rendering the footnote as a full block
*above* the truth is the layout inverting the data model.

**2. Required information.** Two calls, both already made: `getMachinesRunning(period.tsTo)`
(`Line.tsx:111` → `GET /api/machines/running`, `routes/cone.ts:131`, rank 1) and
`getProductAt(period.tsTo)` (`Line.tsx:101` → `GET /api/product-at`, `app.ts:513`, rank 1).

| Figure | Endpoint · field | Available today |
|---|---|---|
| One row per station: label, product, since, cones in window, quiet | `/api/machines/running` · `data.machines[].{station,stationName,productName,materialId,sinceUtc,sinceIsWindowStart,conesOnMaterial,quiet}` (`api.ts:1496-1507`) | ✓ `Line.tsx:466-491` |
| How many products are running | `/api/machines/running` · `data.materialsRunning` | ✓ block note, `Line.tsx:176` |
| The window the block describes | `/api/machines/running` · `data.windowMs`, `data.windowStartUtc`; printed as `W.cone.machinesWindow` | ✓ footer, `Line.tsx:492` |
| Product recorded for the line, at `tsTo` | `/api/product-at` · `product.label` | ✓ `Line.tsx:425` |
| Its target and limits | `/api/product-at` · `limits.targetG`, `limits.label` (pre-formatted, e.g. "1,960 ± 40 g") | ✓ `Line.tsx:429` |
| Whether a product has ever been recorded | `/api/product-at` · `neverRecorded` | ✓ typed, **not currently rendered distinctly** — `Line.tsx:422` renders `W.product.none` for both "never recorded" and "none in force at this instant" |
| That nothing here reaches a machine | Static — `W.product.notSentToMachine` (`words.ts:151`) | ✓ `Line.tsx:434` |

**3. Structure.** One block, label *(new string)* **"What is being made"**, note
`W.cone.machinesNote(materialsRunning)` ("3 products running").

- **Body:** the machine rows, exactly as today (`Line.tsx:467-491`). Unchanged, including
  the quiet row saying `W.cone.quiet2h` rather than vanishing — a machine that stopped is
  information too.
- **Footer line 1:** the machines window caveat, `W.cone.machinesWindow` (`Line.tsx:492`).
  Unchanged.
- **Footer line 2:** the line-wide record — product label, `W.product.target` + target,
  `W.product.limits` + limits label — followed by `W.product.notSentToMachine`, and the
  two controls.

**4. Actions.**

| Control | What it does | Rank | Enforcement |
|---|---|---|---|
| `W.product.change` "Change" | Opens the product sheet's change form | **2** (engineer) | Server: `POST /api/current-product` is `requireRole(2)` — `app.ts:1248`. Client: `canWrite = rank >= 2` (`App.tsx:265`). A control a role cannot use is absent, not disabled (`App.tsx:64-71`). |
| `W.product.history` "History" | Opens the same sheet, showing the changeover timeline | **1** — every reader | `GET /api/product-timeline` is rank 1 (`app.ts:1239`). It is rendered as a block *note* today (`Line.tsx:165`); in the merged block it is a control on footer line 2, beside Change, where a reader looking at products will find it. |

**5. Drilldowns.**

| Element | Lands on | Context that travels | Exists today |
|---|---|---|---|
| Any machine row | That station's sheet, `?sheet=station:N` | Station id, `periodTo` | ✓ **exists** (`Line.tsx:470`) |
| "Change" | Product sheet, `?sheet=product:current` | None | ✓ **exists** (`Line.tsx:437` → `App.tsx:264`) |
| "History" | The same sheet | None | ✓ **exists** (`Line.tsx:165`) — both controls already share one destination, which is correct and stays |
| A machine row → how that machine ran by shift | `?s=report&t=machine-product` narrowed to that station | Station + period | ✗ **needs building**, and it depends on the report-type URL work (`IA-PROPOSAL.md` §5) plus the `st=` key (§6). This is IFL's named top requirement — per-machine changeover per shift — and `report/MachineProduct.tsx` renders it today as the tenth of ten undifferentiated chips (matrix §1.8). **Named here, not built here.** |

**Forward compatibility.** If `IA-PROPOSAL.md` §3.2's Product screen is approved, "Change"
and "History" repoint from `?sheet=product:current` to `?s=product` and **nothing else in
this block changes**. The builder should keep both controls calling one handler so that
repoint is a one-line change.

**6. Empty state.** Four distinct cases, four distinct sentences:

| Case | Detection | What it says |
|---|---|---|
| No machine has produced in the window | `data.asOfUtc == null \|\| data.machines.length === 0` | `W.nothingHere` (`Line.tsx:463`). Unchanged. |
| A machine produced but its cones carry no material | `machines[].materialId == null` | `W.cone.noMaterial` (`Line.tsx:477`). Unchanged. |
| A material id with no name in the product master | `materialId != null && productName == null` | `W.cone.noProductName(materialId)` (`Line.tsx:477`). Unchanged. |
| **No product has ever been recorded for the line** | `/api/product-at` · `neverRecorded === true` | `W.product.none` today for *both* this and "none in force at this instant". **Specification: split them.** `neverRecorded` keeps `W.product.none`; `product == null && !neverRecorded` gets *(new string)* *"No product was recorded for the line at this time."* The difference matters under replay and on July-generation periods, where the second is the normal case. |

**7. Error state.** Two independent calls, two independent guards. `machines.error &&
!machines.data` → `Failed` for the machine rows (`Line.tsx:178-179`); `product.error &&
!product.data` → `Failed` for footer line 2 only (`Line.tsx:167-168`). **The block does not
fail whole when only one of the two fails** — the machine rows are the block's primary
content and must survive a product-lookup failure. Neither failure renders `W.product.none`
or an empty machine list.

**8. Stale / trust state.**
- The machines window is two hours of **plant time anchored on the newest reading**, never
  on the clock, and capped at `period.tsTo` (`Line.tsx:108-111`). The footer says so. Under
  a stale sync every row is correspondingly older; **no additional warning** — the strip
  carries it.
- `sinceIsWindowStart === true` means the machine was already running that product when the
  window opened, so the "since" time is a lower bound. Rendered as `W.cone.sinceAtLeast`
  today (`Line.tsx:480`). Unchanged, and this is exactly the "a figure is approximate and
  says so" case the brief asks about.
- `limitsAreLowerBound` on `/api/product-at` (`api.ts:1137`) means the limits shown are the
  oldest version known and the instant predates it. **Not rendered today, and not added
  here** — on the Overview the limits are context, not a judgement; the place it matters is
  the reading sheet, which already has it. Noted so the builder does not assume it was
  forgotten.

**9. Acceptance test.**
> With the period set to This shift on the simulator, the block lists one row per station
> that produced in the last two hours of plant time, each naming the product from that
> machine's own newest cones, and its note reads "{n} products running" matching the number
> of distinct products in the rows. Footer line 2 names the product recorded for the line
> with its target and limits, states that it is not sent to the machine, and offers
> "History" to every account and "Change" only at engineer rank or above — verified by
> signing in as a viewer and confirming the Change control is **absent**, not greyed.

---

### 3.5 Last readings

**1. Purpose.** *Is data actually arriving, and what did the most recent one say?* It is the
only place on the Overview where a reader sees an individual reading, and it is the concrete
counterpart to the strip's abstract "Readings to 13:49".

**2. Required information.** No call of its own — it reads the `/api/live` payload the
screen already holds.

| Figure | Endpoint · field | Available today |
|---|---|---|
| Last sack: weight, scale verdict, time | `/api/live` · `lastSack.{weightKg,inRange,ts}` | ✓ `Line.tsx:587-596` |
| Last cone: weight, scale verdict, station, time | `/api/live` · `lastCone.{weightG,inRange,station,ts}` | ✓ `Line.tsx:597-604` |
| The permalink target | `/api/live` · `lastSack.eventId` / `lastCone.eventId` — the **canonical PK**, never `sourceRowId`, which IFL reset on 2026-08-05 and which now names two different sacks (`Line.tsx:590-592`) | ✓ |

**Specified as unchanged.** Two rows, two facts each, one click each.

**3. Filters.** None. It is the newest reading on record, capped at the replay instant by
`/api/live` itself.

**4. Actions.** None. Rank 1.

**5. Drilldowns.** One per row → the reading sheet, `?sheet=sack:<eventId>` /
`?sheet=cone:<eventId>` (`Line.tsx:610` → `App.tsx:263`). ✓ **exists.** The reading sheet
carries provenance — source table, generation, insert versus production time, transform
version, attribution method (matrix §1.2) — which is the deepest trust answer in the
application and is one click from the landing page. That is worth keeping.

**6. Empty state.** No sack and no cone on record → `W.nothingHere` (`Line.tsx:605`).
Unchanged.

**7. Error state.** No independent fetch, therefore no independent failure: if `/api/live`
fails the shell renders its error and this screen does not mount (`App.tsx:190-196`). State
this explicitly in the code comment so nobody adds a spurious guard.

**8. Stale / trust state.** The row prints the reading's own time, so under a stale sync the
staleness is self-evident from the clock beside it. **No additional warning.**

**9. Acceptance test.**
> On the simulator with data arriving, the block shows two rows whose times advance as the
> screen polls, and clicking the cone row opens a reading sheet whose weight, station and
> scale verdict match the row exactly. With `?at=` set to a past instant, both rows show
> readings from at or before that instant.

---

### 3.6 Details

**1. Purpose.** *How were these numbers arrived at?* — for the reader who asks, without
costing the reader who does not. A collapsed `<details>` (`ui/bits.tsx:116`): only the
summary word counts against the word budget.

**2. Required information.** Two paragraphs today (`Line.tsx:218-229`):
- the lag and the stop threshold: `line.ingestLagSeconds`, `line.state.stopThresholdSeconds`;
- the attention window and thresholds: `attention.data.window.days`,
  `thresholds.driftG`, `thresholds.minDaysHeld`.

**One addition:** a third short paragraph naming the population rule, using the value
already on the wire — `/api/production` · `data.implausible` (`production.ts:227`,
`api.ts:1453`) — *(new string)* *"{n} readings in this period were outside the plausible
range for a cone and are excluded from every figure above."* Rendered only when
`implausible > 0`. This is the honest home for a fact that would be noise in a KPI note and
a lie by omission if dropped entirely.

**3. Filters.** Inherits the block each sentence describes. **4. Actions.** None.
**5. Drilldowns.** None — Details is prose, and a link inside a collapsed disclosure is
navigation nobody finds. **6/7. Empty and error.** A sentence whose input is null renders
`—` (as today, `Line.tsx:227-228`); the disclosure never fails as a unit.
**8. Stale.** Not applicable.

**9. Acceptance test.**
> Opening Details on a period containing implausible readings shows three paragraphs, the
> third naming a non-zero count; on a period with none it shows two.

---

## 4. The ten-second test

Five questions, where each is answered, and in what reading order. The claim being made is
that a reader's eye travels **top to bottom once**, and each stop answers exactly one
question and offers exactly one way onward.

| # | The question | Where it is answered | Reading position | Onward |
|---|---|---|---|---|
| 1 | **Is the data current?** | The strip, above the screen: the dot, the plant clock, and the lag sentence (`Bar.tsx:226-261`) — *"Readings to 13:49 · they reach this system about 18 min after weighing · details"* | **Before the screen.** It is on every screen and it is the first row under the bar. | The whole sentence is a link to `?s=health` (`Bar.tsx:254-260`) |
| 2 | **Is the line running?** | The headline (§3.0), one sentence, in display type — or *"Cannot tell whether the line is running"* when question 1's answer is not `ok` | First thing inside the screen | Nothing. This is a statement, not a door. |
| 3 | **What was produced?** | KPI figures 1–3 (§3.1): cones, sacks + kg, rejected + rate | Second — the figure row, immediately under the headline | Each figure is a link to the screen that explains it |
| 4 | **What is the quality situation?** | KPI figures 1, 3 and 4 read together: *"{n} within the scale's limits"*, *"{n} rejected"*, *"{n} outside the product's limits · {m} could not be judged"* — the two vocabularies, named | Same row as question 3, right-hand end | Figure 4 → Readings, outside-limits filter, same period |
| 5 | **Is anything requiring attention, and where do I investigate?** | The Attention block (§3.2) names it in a sentence; the Station grid (§3.3) shows where, by count, quiet state and reject tag | Third and fourth | Every attention row opens the station or screen it names; every station box opens its sheet |

**Why this order and not another.** It is the order of the reader's dependency: a number is
worthless until you know the data is current, the line state frames what the numbers mean,
the numbers frame whether the exceptions matter, and the exceptions frame where to go. Any
other order asks the reader to hold something in mind while they scroll for the thing that
qualifies it.

**The measurable claim:** questions 1–4 are answered without scrolling on a 1440×900
display, and question 5's first sentence is on that same screen. Question 3 or 4's answer
reaches its explaining screen in **one click, with the period intact** — which is the
owner's stated test and is the thing that is false in every case today.

---

## 5. The drilldown register

Every hop that starts on this screen. **Legend:** ✓ exists and carries what it needs ·
◐ exists but drops context · ✗ does not exist.

| # | From | To | Context carried | Today | Work needed |
|---|---|---|---|---|---|
| 1 | KPI · cones | Readings, cones listing | period; `rf` explicitly cleared | ✗ | Client wiring only (`onNavigate('readings')`) |
| 2 | KPI · sacks | Sacks | period | ✗ | Client wiring only |
| 3 | KPI · rejected | Rejects | period | ✗ | Client wiring only |
| 4 | KPI · outside limits | Readings, `rf=outsideLimits` | period + filter | ✗ | Client wiring only — the identical hop exists from Weight (`App.tsx:285`) |
| 5 | Attention · station drift | That station's sheet | station, `periodTo` | ◐ lands on Weight, unsorted, station dropped (`Line.tsx:360`) | Client wiring only — `onOpenStation` already exists (`Line.tsx:70`) |
| 6 | Attention · reject rise | Rejects | period; **reject kind dropped** | ◐ | Needs the `§6` URL vocabulary; Rejects' filters are component state (`Rejects.tsx:95-97`) |
| 7 | Attention · outside limits | Readings, `rf=outsideLimits` | period + filter | ✓ | None |
| 8 | Attention · "and N more" | The screen of the last rendered finding | period | ✓ | None |
| 9 | Station box | That station's sheet | station, `periodTo` | ✓ | None |
| 10 | Machine row | That station's sheet | station, `periodTo` | ✓ | None |
| 11 | "Change" | Product sheet | — | ✓ | None (repoint to `?s=product` if §3.2 of the IA proposal is approved) |
| 12 | "History" | Product sheet | — | ✓ | None |
| 13 | Last sack row | Sack reading sheet | canonical `eventId` | ✓ | None |
| 14 | Last cone row | Cone reading sheet | canonical `eventId` | ✓ | None |
| 15 | Strip lag sentence | `?s=health` | — | ✓ | None (naming it in the bar is `IA-PROPOSAL.md` §3.3, not this screen) |
| 16 | Station sheet → that station's readings | Readings, station N, same period | station + period | ✗ | **`st` is parsed in the working tree (§6) but Readings does not read it.** `GET /api/events` already accepts `station` (`api.ts:503`). Named here because the journey starts on this screen; built in the sheet |
| 17 | Machine row → that machine by shift | `?s=report&rt=machine-product&st=N` | station + period | ✗ | **`rt` and `st` are parsed in the working tree (§6); `ReportScreen` does not read either yet.** Backend complete (`reports/machineProduct.ts`, rank 1) |

**Tally: 17 hops.**

- **9 exist and carry what they need** — hops 7, 8, 9, 10, 11, 12, 13, 14, 15.
- **2 exist but drop the context that would make them useful** — hop 5 (station-drift
  finding loses the station) and hop 6 (reject-rise finding loses the reject kind).
- **6 do not exist at all** — hops 1, 2, 3, 4, 16, 17.

**8 hops therefore need work (the 6 absent plus the 2 context drops), and 5 of them —
hops 1, 2, 3, 4 and 5 — are client wiring on this screen with no new API, no new URL key
and no new handler signature.** They are buildable in a single pass and they are the five
that carry the owner's KPI → exception → drilldown chain. The remaining 3 (6, 16, 17) all
wait on one thing: the screens consuming the shared URL vocabulary of §6.

---

## 6. Context vocabulary this screen needs

This screen needs **one** URL key beyond what it already uses, and it must be the same key
the rest of the application adopts.

> **Working-tree note, verified 16 September 2026 during this pass.** A parallel worker
> landed the shared URL vocabulary in `sms/web/src/App.tsx` **while this document was being
> written** — uncommitted, `git status` shows `M sms/web/src/App.tsx` against HEAD
> `3a86039`. `parseRoute` now reads `st` (station) and `pr` (product) as *shared* keys,
> plus `rt`/`rsh` (report type and its shift), `rl`/`rcs`/`rp` (Readings), `wm` (Weight),
> `su`/`sp` (Sacks) and `jc` (Rejects), each omitted from the URL when it equals the
> screen's default (`App.tsx` `parseRoute`, `routeSearch`, `DEFAULT_ROUTE`). The file
> header states the same reasoning as `IA-PROPOSAL.md` §7 and names it.
>
> **The screens are not wired to it yet.** `ReadingsScreen` still receives only
> `initialFilter`; `ReportScreen` still receives only `period` and `user`; `WeightScreen`
> still receives neither `station` nor `mode` (`App.tsx`, the `<main>` block). So the key
> exists in the route and no screen consumes it. Hops 16 and 17 are therefore **unblocked at
> the URL layer and still blocked at the screen layer** — and the builder of this
> specification must not assume either half is done without re-reading that file.

| Key | Meaning | Status |
|---|---|---|
| `s` | The screen | Exists |
| `p` / `from` / `to` | The period | Exists (`lib/period.ts:214-233`) — **the one thing the redesign got structurally right**; every hop above inherits it for free through `go()`'s merge |
| `at` | The replay instant | Exists |
| `sheet` | The open drill-down | Exists |
| `rf` | Readings' narrowing | Exists |
| **`st`** | **One station, shared by Readings, Weight, Rejects and Report** | **Parsed and serialised in the working tree; no screen reads it.** Until the screens do, it is three component-state variables for one idea: `Readings.tsx:112` `station`, `Weight.tsx:58` `chartStation`, `Report.tsx:54`'s station filter |

**`st` is the only key this screen requires.** This specification **adopts that name
exactly**, matching both `IA-PROPOSAL.md` §7 and the working-tree implementation, so the
three cannot diverge. `pr` and the per-screen keys are not needed by the Overview and are
not specified here.

**One rule the builder must not break:** a transition keeps every context value unless the
destination cannot use it. `go()` already does this for `p` and `at`; `st` rides the same
path. Hop 1 is the single exception in this document — it explicitly passes
`readingsFilter: null`, because a reader clicking "cones" wants the register, not whatever
narrowing a previous hop left behind.

---

## 7. What is removed or demoted

The screen is finite and the budget is 60 words (`REDESIGN.md:380`). Four removals pay for
three additions.

| # | What | From → To | Why |
|---|---|---|---|
| 1 | **The "Product recorded in this system" block** | A top-level block at position 3 (`Line.tsx:159-172`) → two footer lines of the merged "What is being made" block (§3.4) | It answers the same question as the block immediately below it, and since 2026-08-05 it is the *fallback* answer, not the primary one — up to six materials run concurrently on different machines (`CLAUDE.md`). A block header and a rule are removed; every fact, both controls and the "not sent to the machine" statement survive verbatim. |
| 2 | **The number inside the outside-limits attention sentence** | `W.disagreement(f.count)` → a countless sentence (§3.2 change (b)) | With KPI figure 4 directly above it, it is a second number for one fact, from a **different SQL population** (§10 D2). One number, one source, no contradiction. |
| 3 | **The word "Weight" as the destination of a station-drift finding** | → the station's own label | The link named the wrong destination: it landed on a fourteen-row table with no indication which row the sentence meant (`IA-PROPOSAL.md` §6.1). Same word count, correct destination. |
| 4 | **Nothing else.** | | Explicitly: the station grid keeps all fourteen boxes, the machine rows keep their "since" and window caveat, Last readings keeps both rows, and the Details text is extended rather than trimmed. |

**Blocks: 7 → 6. Top-level rules on the page: 6 → 5.**

**What was considered for removal and kept, with the reason:**

- **Last readings.** It is two rows, it is the only individual reading on the screen, and it
  is the one-click path to full provenance. It is the cheapest block on the page per fact
  delivered. Kept.
- **The station grid's fourteen boxes.** Reducing to "the five worst" would be a ranking,
  and a ranking here would be the third station ranking in the application — `CLAUDE.md`
  rule 6 allows one, on Weight, *because the previous build had three and they disagreed.*
  The grid is a scan, not a ranking, which is exactly why it is allowed to exist. Kept, and
  it must not acquire a sort.
- **The question line** (`W.question.line`, 15 words of the 60). It is printed rather than
  hovered because *"hover does not exist on a wall display or a touch screen"*
  (`words.ts:52-53`). Kept unchanged — including the fact that it does not mention quality
  or data currency, because lengthening it to cover five questions would spend the budget
  the KPI row needs.

---

## 8. What I deliberately did NOT add

Each of these was considered and rejected on evidence, not overlooked.

1. **No time lost, stop count, availability, MTBF or MTTR.** No line of IFL's requirement
   list asks for OEE (`CLAUDE.md`, requirement mapping); Output and Shifts were deleted
   outright in `f4b941a`; the measured part survives on Report via `reports/daily.ts:98-99`.
   `GET /api/downtime` (`app.ts:745`) would serve it and takes a single `date`, not a
   period, so it could not follow the period control anyway.

2. **No period-over-period comparison or trend arrow on the KPIs.** It would need a second
   `/api/production` call over a shifted range, and "is it getting worse" is already
   answered — properly, with a control chart and burst detection — by the `reject_rise`
   finding (`attention.ts`, `rejectSpc.ts`). A green-up-arrow beside a KPI is a second,
   weaker answer to a question the attention list answers well.

3. **No sparkline, no chart of any kind on the Overview.** Weight has the control chart,
   Rejects has the p-chart. A chart here would be a fourth surface for a question two
   screens already own, and charts are what IFL called unreadable.

4. **No product filter and no per-product KPI row.** `/api/production` accepts `product=`
   and `groupBy=product` (`production.ts:20,29`; note the client's `GroupBy` type omits
   `'product'` at `api.ts:40` — a one-word type change, not backend work). But a
   product-narrowed Overview silently drops every pre-`MaterialId` reading and must carry
   the `unattributed` caveat with it (`production.ts:138-162`). That belongs on Report.

5. **No sack stock per machine, in any form.** Not computable by anyone from IFL's data —
   `sack1_TP1U2` has no machine column, and every response says so in the server's own words
   (`sackStock.ts:124`). IFL's 15 September 2026 answer redefines "stock" as production per
   shift, which the `machine-product` report delivers (hop 17).

6. **No second entry point to health from the screen body.** The strip's sentence is the
   entry (`Bar.tsx:254-260`). Naming the destination in the bar is `IA-PROPOSAL.md` §3.3's
   business and belongs to the chrome, not to this screen.

7. **No replay control.** `LIVE_ALLOW_AS_OF` is false in production and the route answers
   400 when it is off (`app.ts:362`). A control that can only fail on the machine that
   matters is a bug (`IA-PROPOSAL.md` §9 item 8).

8. **No naming of the lagging source table in the stale sentence.** `/api/live` ·
   `health.oldestTable` is on the wire (`api.ts:960`) and would let the strip say *which*
   feed is behind — but it is a raw table name (`pack1_TP1U2`), which is jargon to the GM,
   and translating it needs the source labels from `/api/config`. Worth doing; it belongs
   to the strip and to `?s=health`, not to the Overview.

9. **No "quiet station" alert in the Attention list.** No requirement mentions one, the
   dimmed box in the station grid already says it, and false alarms on the GM's home screen
   cost more trust than the list earns (`attention.ts:14-17`). The tag line in §3.3 is a
   statement in a box the reader is already scanning, not an alert.

10. **No role tiering.** Every block above is open to every signed-in account. Only the
    "Change" control is rank-gated, and only because `POST /api/current-product` is
    `requireRole(2)` server-side (`app.ts:1248`). `CLAUDE.md`'s one-audience rule is not
    negotiable.

---

## 9. Figures I wanted that the API cannot supply

| # | The figure | Why I wanted it | Why it cannot be served today | What it would take |
|---|---|---|---|---|
| 1 | **Cones outside the product's limits, per station** | It is the per-station version of KPI figure 4 and would make the station grid answer the quality question as well as the output one — the single best "where should I investigate" signal available from weighing data | `/api/production` computes `states` **once for the whole range, whatever the grouping**: *"one row per state for the whole range — the screens ask for the totals"* (`production.ts:210-211`). There is no per-group state breakdown on any route. | Backend: add `withStates` per group — the `GROUP BY ${stateCase}` at `production.ts:219-224` would take the grouping expression as a second key. Small, but it is a change to the most-cached endpoint in the app and needs its own decision. **Reported, not assumed.** |
| 2 | **Cones that could not be judged, per station** | Same block, same reason: a station whose readings are all `unknown` is a station whose product attribution is broken, and the line-wide `unknown` count hides which one | Same cause as (1) | Same fix as (1) |
| 3 | **The acquisition lag per source table** | So "the reading has not arrived yet" could name *which* feed is behind, rather than stating one median | `/api/live` measures one lag, the median of `src_Date − src_ProductionDate` over recent raw rows, line-wide (`live.ts:37-44`). `health.oldestTable` names the slowest *sync*, which is a different thing from the slowest *acquisition*. | Backend: per-table lag in the `/api/live` payload. Low value for the cost; listed for completeness |

**Everything else in this document is served by an endpoint that exists today, at rank 1,
and by a call this screen already makes.** The two additions of substance — KPI figure 4 and
the station reject tag — are both fields already on the wire and discarded by the client
(`data.states` at `Line.tsx:132`; `rows[].rejectedCones` at `Line.tsx:543`).

---

## 10. Defects found while specifying

These are not part of the redesign. They are existing faults that the acceptance tests above
will fail on, so the builder needs them.

**D1 — `usePolling` holds the previous period's data across a period change, so a failed
refetch renders the old period's numbers under the new period's label.**
`lib/live.tsx:35-84`: `key` is in the effect's dependency list (`:81`), so changing the
period re-runs the effect — but `data` is `useState` in the same hook instance and is
**never cleared** when `key` changes. Consequence on the Overview: select a new period; if
the refetch fails, `totals.error && !totals.data` at `Line.tsx:129` is **false**, so
`<Figures>` renders the *previous* period's counts. Even on success there is a flash of the
old period's numbers under the new label. This is rule 6 — a failure presented as data, and
worse than a zero because it is plausible.
**Fix:** `usePolling` returns the key its held `data` was fetched under, and a block renders
`data` only when that key matches the current one — otherwise skeleton, or `Failed` when
`error` is set. It is a shared lib used by every screen, so this is a separate, small change
that the Overview's error-state acceptance test depends on.

**D2 — `productDisagreement` uses a different population from the classification rule, so
`/api/attention`'s outside-limits count and `/api/weight-stations`' `passedButOutside` can
both disagree with the register they link to.**
`productAt.ts:463-471` counts `in_range = 1 AND outside window`, with no plausibility
predicate and no `tsTo`. `coneState.ts:84-90` sends implausible weights to `unknown` first,
and treats `in_range IS NULL` as judgeable. `GET /api/events?outsideProductLimits=true`
resolves to states `['low','high']` (`app.ts:882`) — the classification rule. So the number
in the sentence and the number of rows the reader lands on are computed two different ways.
`coneState.ts:9` states the intent plainly: *"There is deliberately no third place that
knows the rule."* `productDisagreement` is that third place.
**This document's mitigation** is to drop the count from the Overview's sentence (§3.2
change (b)) and source the figure from `states`. **The underlying fix** — applying
`plausibleWhere` and the same `in_range` handling inside `productDisagreement` — is a
separate change, and it also affects Weight's banner (`Weight.tsx:190`), which is out of
scope here.

**D3 — `/api/attention` does not accept `tsTo`, so under replay its outside-limits rule
counts the whole selected period while every other figure on the screen is capped at the
replay instant.** `Line.tsx:102-106` sends only `from`, `to`, `shift`, and the route
(`app.ts:434`) takes no instant bound. Invisible outside replay. Mitigated to invisibility
by change (b); recorded so it is not rediscovered.

**D4 — `W.product.none` is rendered for two different facts.** `Line.tsx:422` shows *"No
product has been recorded for this line yet."* whenever `product == null`, which is also
true when a product exists but none was in force at the queried instant — the normal case
on any July-generation period and under replay. `/api/product-at` distinguishes them with
`neverRecorded` (`api.ts:1112`), which the client types and never reads. Fixed in §3.4
empty states.

---

## 11. The word budget ledger

Line's cap is **60 visible words** (`REDESIGN.md:380`). Collapsed `<details>` content does
not count; its summary word does.

| Change | Words |
|---|---|
| KPI figure 4 — unit label "outside the product's limits" | **+5** |
| KPI figure 4 — note "{n} could not be judged" | **+4** |
| Station tag "{n} rejected" (replaces a blank line already reserved) | **+1** |
| Block label "What is being made" (replaces "What each machine is running", 5 words) | **−1** |
| Removed block label "Product recorded in this system" | **−5** |
| Outside-limits sentence loses its count (one numeral) | **−1** |
| Station-drift link word: "Weight" → the station's label (typically "Station 7") | **+1** |
| **Net, in the normal (healthy, non-empty) state** | **+4** |

Conditional strings, present only in the state they describe and therefore not part of the
steady-state budget: the three KPI empty-state notes (§3.1 case 6), the "too few production
days" qualifier (§3.2 case 6), the unattributed-rejects note (§3.3), the stale anchor
prefix (§3.3 case 8), the "no product at this time" sentence (§3.4), and the implausible
sentence inside Details (§3.6).

**Instruction to the builder: count the words at 1440px before and after, and if the healthy
state exceeds 60, the qualifier that goes is the second Details paragraph's duplication of
the attention block note — not a KPI.**

Every new string goes in `web/src/lib/words.ts` and nowhere else, so an Urdu set remains one
object rather than a pass over every screen (`words.ts:4-6`).

---

## 12. What this spec does not settle

1. **Nobody has watched a user.** The ten-second claim in §4 is a reading-order argument, not
   an observation. `REDESIGN.md` §12 gate 5 — a walkthrough with IFL's representative on the
   simulator — is what would settle it.
2. **The `st` key's screen-side adoption.** The key itself is settled — the parallel URL
   worker landed it under exactly this name in the working tree during this pass (§6) — but
   no screen consumes it yet, so hops 16 and 17 remain unbuildable until Readings, Weight
   and Report read it. That is that worker's remaining half, not this specification's.
3. **Whether the Product screen of `IA-PROPOSAL.md` §3.2 is approved.** §3.4 is written to be
   correct either way, and the repoint is one line.
4. **The two per-station quality figures of §9** need a backend decision on
   `/api/production`'s state grouping. Until then the station grid answers output and
   activity, not product conformance.
5. **This is structure, content, hierarchy and behaviour.** No layout, no wireframe, no
   colour, no spacing and no component choice is proposed, and none should be inferred from
   the order of anything above.

---

*Phase 3 specifies. It does not build. No file under `sms/` was modified in producing this
document, and nothing here has been committed or pushed.*
