# SMS — what the software does

**Sack Management System, Ibrahim Fibres Limited, TP1 Line 3 / Unit 2.**
Reference document for comparing the delivered software against a requirement
list. Written to be checked: every figure below was measured against the running
system on the supplied data set, and every capability named here exists in code.
Where something is *not* built, it says so in the same words it would use if it
were — see §10, which is the section that matters most for a scope comparison.

Status at time of writing: Phase 1 complete, running against the supplied copy
(19 production days, 2026-06-22 → 2026-07-10), awaiting IFL's answers to five
open questions (§11) and the go-live cutover (§9).

---

## 0. Against IFL's requirement list

The ten lines of IFL's original request, and where each one stands. This is the
section to read first; everything below is detail behind it.

| # | IFL asked for | State |
|---|---|---|
| 1 | Connectivity with PLCs, HMIs, machines and structured/unstructured databases | **Partial.** SQL Server, read-only, in production use. No PLC or HMI path — IFL placed PLC integration out of scope in a later clarification (Q22). Re-openable; see §10.1 |
| 2 | Collect all cone weight data, flag weights outside defined limits | **Done.** Every cone, with the plant's own in-range bit and an app-owned plausibility window |
| 3 | Interactive screens to view and update product details on machines | **Partial.** The running product is viewed and set in the app, versioned and attributed. It is **not written to a machine**, which needs the PLC path above |
| 4 | Complete history logs and trend graphs for all rejected cones | **Done.** Full reject register, Pareto by inspection code, control chart, per-station rate |
| 5 | AI-based analytics recommending calibration adjustments from weight-performance trends | **Partial.** Built as statistics, not AI: per-station drift, Nelson-rule detection and an adjustment ledger. See §10.12 for what is honest to claim |
| 6 | Collection and logging of data for all sacks | **Done.** Every sack, with weight, in-range and shift |
| 7 | Complete tracking and maintenance of sack stock **per machine** | **Not built, and blocked on the source data.** IFL's sack table carries no machine or station column, and nothing anywhere records a sack leaving. See §10.13 |
| 8 | Comprehensive reporting, analytics and graphical dashboards | **Done.** Analytics and dashboards were built first; the reporting half — day, week, month, quarter or a chosen range, printable and exportable — is §3.8 |
| 9 | User-friendly interface with access control and data security | **Done**, and reworked in Sep 2026 after IFL found the first version too complex for floor staff. Four roles enforced server-side; argon2 passwords; audit log |
| 10 | Scalable architecture for more machines and data points | **Partial.** `line_id` runs through every table, query and API response. A second line is configuration plus testing, not a rewrite. Not yet exercised against a real second line |

**Nothing in that list asks for OEE**, availability, performance, quality,
downtime analysis, stoppage clustering, mean time between failures, or
shift-versus-shift comparison. Screens covering those were built and have been
**withdrawn from the product** (§3.10, §3.13). They are not claimed here and are
not part of the delivery.

---

## 1. In one paragraph

The plant's Siemens S7-1500 PLCs weigh every cone and every sack and write the
readings into IFL's SQL Server. SMS copies those readings into its own database
once a minute, never writing to IFL's, and converts them into a clean canonical
form.

It presents that in two tiers. **The floor tier** is what a person at the line
or in the warehouse sees: a live status screen refreshing every ten seconds, the
running register of sacks and of cones, a detail card for any single one, a
production report over any period, and a fullscreen wall display for a
monitor. Plain words, large type, one time selector, no statistics. **The
analysis tier**, for managers and above, adds the production record with its
full provenance, weight process control with per-station bias and calibration
drift, and reject analysis by code, by trend and by station.

It is a read-only reporting system over the plant's own data, plus a small
amount of configuration it owns itself.

---

## 2. How data reaches the screen

Four stages. Each is a separate process or package, so a fault can be located.

```
IFL SQL Server                SMS SQL Server (app-owned)              Browser
──────────────                ──────────────────────────              ───────
DATA_TP1U2                    sms_raw.*          sms.*
  sack1_TP1U2    ──reader──►  cone_raw     ──transform──► cone_event  ──API──►
  pack1_TP1U2                 sack_raw                    sack_event
  rejectQCS1_TP1U2            reject_qcs_raw              reject_event
  rejectWeight1_TP1U2         reject_weight_raw           + reference tables
       (read-only)            (append-only, verbatim)     (canonical, typed)
```

**Reader.** Connects to IFL's server with a read-only login and selects from
the four wide `*_TP1U2` tables. It never issues INSERT, UPDATE, DELETE, CREATE
or ALTER against IFL's database, and adds no index there. This is a hard
client constraint (IFL Q21) and the reason for the sidecar design.

**Raw layer.** Rows land in `sms_raw` exactly as read, append-only, with the
source row id preserved. Nothing is interpreted here, so a disputed figure can
always be traced back to the bytes that produced it.

**Transform.** Converts raw to canonical: derives the shift from production
time, normalises station ids, computes a merge key, stamps a transform version.
Runs data-quality checks as it goes (§8). Incremental on its own watermark
(highest raw row already transformed, self-seeding on upgrade): a pass with
nothing new does nothing. Until the Aug 2026 stress audit it re-read and
re-mapped the entire history every pass — measured 2.5 s at 151k rows and
growing linearly forever, which would eventually have blown the 60-second
cadence on live; a no-change pass now completes in ~0.3 s regardless of how
much history has accumulated.

**API and web.** A single Express service reads only the canonical layer and
serves a React application. The browser never talks to IFL's database.

**Cadence.** 60-second incremental passes on a per-table watermark (the highest
source row id already ingested), so a pass reads only what is new and a restart
resumes exactly where it stopped.

---

## 3. The screens

Every screen states a plain-language finding first and puts the statistics
behind it, not the other way round. The floor screens carry no statistics at
all.

**Floor tier, every role:** Now, Sacks, Cones, Report, Wall, plus the record
card and sign-in.
**Analysis tier, manager and above:** Line, Records, Weight, Rejects, plus
Exceptions and Product history.
**Admin only:** Setup. **Every role, no rail item:** Sync.

Two screens described in earlier versions of this document — Output and Shifts —
were **withdrawn from the product** in Sep 2026 because nothing in IFL's
requirement list asked for them. Their entries below say so rather than being
deleted, so a scope comparison against an older copy of this document still
lines up.

### 3.1 Now (`?v=now`) — the floor's home screen

What a person standing at the line needs, and nothing else. Refreshes itself
every ten seconds.

- **Line state in one word** — Running, Stopped, No readings — with how long it
  has been running, or how long it has been stopped, or when the last reading
  arrived. Derived from the gap since the newest cone: under two minutes is
  running, longer is stopped, longer than a whole shift is reported as no
  readings rather than as a stoppage.
- **The shift in progress**, its start and end times, and the plant clock
  ticking in seconds.
- **This shift so far**: cones with the in-range share and a rate per hour,
  sacks with the total weight, rejected cones with the last reject's time and
  station.
- **The last sack and the last cone**, each with its weight, a pass or fail
  mark, its time and how long ago. Either opens its own record card.
- **Recent activity**: cones in the last ten minutes, cones and sacks in the
  last hour.
- **The fourteen winding stations**, cones each has produced this shift, dimmed
  where a station has been quiet for five minutes and marked where one has
  produced nothing at all while the line runs.
- **The running product**, with blend, count, tube type and tolerance. A
  supervisor can change it here, seeing the new product's own tolerance as a
  preview before confirming.

### 3.2 Sacks and Cones (`?v=sacks`, `?v=cones`)

Every reading, newest first, in large type. While the chosen period is still
open the newest page is re-read every fifteen seconds and new rows appear at the
top as they are weighed.

- **One time selector**, the same four scopes on both screens: This shift,
  Today, Yesterday, or a chosen day. The resolved period is stated in words
  above the list, and it is anchored on the plant's clock as reported by the
  server, never the browser's.
- Each row carries the sack number or the cone's station, the weight, a pass or
  fail mark, and the time with its shift.
- Tapping a row opens its record card.

### 3.3 The record card

One sack or one cone in plain words: what it weighed, whether it passed, when,
on which shift, at which station, and its record number. Deliberately free of
merge keys, transform versions and source-system fields, which live in the
analysis tier for the people who need them.

Each card also shows what was weighed around it. For a sack, the cones weighed
between the previous sack and this one. For a cone, the next sack weighed after
it. **Both are labelled as approximate on the card itself**, because the plant
records no link from a cone to a sack: cones falling between two sack
timestamps range from none to over two hundred, so this is a time window, not a
packing list, and the screen says so.

### 3.4 Line (`?v=dashboard`)

The production day at a glance, defaulting to the last complete day.

- **24-hour run/stop ribbon** — the whole day as one band, every detected
  stoppage positioned and sized by its real start and duration, with shift
  boundaries drawn from the actual 06:00/14:00/22:00 times rather than by
  cutting the bar into thirds.
- **Run/stop verdict** — how long the line ran of how long it was observed,
  the stoppage count, and the longest stop with its time.
- **Availability, mean time between stops, mean time to restart.**
- **Four KPI cards** with 7-day sparklines: total cones, rejected cones, total
  sacks, total sack weight, each with a derived sub-figure (in-range
  percentage, reject share, cones per sack, average sack weight).
- **"Needs a look"** — a findings feed synthesised from the weight SPC,
  downtime and reject control charts. Each finding is a button that opens the
  exact sub-tab that explains it, carrying the reason with it. A "See all ·
  change date" link opens the standalone Exceptions view (§3.5) for the same
  day, pre-filtered to nothing — same findings, same synthesis, just a page of
  its own.
- **Cones by shift** with the weakest shift computed and marked.
- **Current product bar** — blend, count, tube type and weight, and tolerance
  (nominal ± offsets) for whichever product is running, plus a PDAS
  active-flag warning if that product is marked inactive there (informational
  only; never enforced). A supervisor changing product sees the same detail as
  a *live preview* of the pending selection before confirming — a changeover
  is a decision made against the new product's own tolerance, not a bare name
  picked from a list. A "View history →" link opens §3.6.

### 3.5 Exceptions (`?v=exceptions`)

The standalone version of "Needs a look" above — same finding synthesis
(there is exactly one implementation; both call it), but for any day, not only
the last complete one, with severity and screen filters. No new table: a past
day's exceptions are recomputed live from the same permanent event data
Overview already reads, rather than cached or persisted. Reachable via the
link on Overview; no rail icon, same as Sync below.

### 3.6 Product history (`?v=timeline`)

Every changeover ever recorded, newest first, each with the same blend/tube/
tolerance detail line as the current-product bar and who set it and why.
`product_timeline` has been append-only since Phase 1 shipped, but nothing
before this had ever read more than its single latest row — the "since …"
line on Overview was the only trace a change had happened. No date filter:
on this plant's changeover rate the whole table is a handful of screens, not
a windowed report. Reachable via the link on the current-product bar; no rail
icon, same as Exceptions and Sync.

### 3.7 Records (`?v=register&sub=cone|sack|reject`)

Every individual reading, filterable and exportable.

- **Filter chips** — active filters shown as removable chips: date range,
  shift, station, in-range status, reject type, weight range, and a
  time-window filter. A "+ filter" panel adds them on demand.
- **Table** — production time, shift, station (or sack number), weight,
  status. Sortable by time or weight, paged, 25 rows a page.
- **Sticky detail rail** — selecting a row shows everything recorded about it
  with no further request: production time, corrected shift, shift as stored
  by the plant, station, weight, difference from the current setpoint, hanger,
  product, merge-key uniqueness, source row. Values are marked where they
  disagree with the plant's own record.
- **Full record page** (`?v=register&dtype=&did=`) — a permalinkable page
  adding the reading's SPC subgroup, its station's behaviour that day, its
  time-neighbours, and its provenance (source system, transform version,
  ingest time).
- **CSV export** of the current filter (manager and above).

### 3.8 Report (`?v=report&sub=day|week|month|quarter|custom`) — the period summary

The reporting half of requirement 8. Pick a period and read what the line made.
No statistics on this screen at all.

- **One period control**, the same words and the same place as everywhere else:
  Day, Week (Monday to Sunday), Month, Quarter, or a range you choose. Week,
  month and quarter are calendar periods, not trailing windows, and one date
  picker selects whichever period contains it.
- **Coverage is stated before any figure.** A period says how many of its days
  actually hold production data and which days those are. On the supplied copy
  "this quarter" is 19 days of 92, and a total printed without that sentence
  reads as a quarter's output. A period with nothing in it names the most
  recent day that does have data, which distinguishes a quiet Sunday from a
  sync that stopped weeks ago.
- **Totals:** cones with in-range share, sacks with cones per sack, sack weight
  with average sack, rejected cones with reject rate.
- **Time lost and stop count** for the period, with the caveat that a planned
  break is counted the same as a fault, because nothing in the data separates
  them.
- **One chart**, cones per day, with a labelled vertical axis and a readout
  that names the day and its figures when you point at a bar.
- **By shift and by day tables**, printable, with a CSV export of all three
  levels.

### 3.9 Wall (`?v=wall`) — a monitor in the warehouse or beside the line

Fullscreen, no navigation, no scrolling, sized in viewport units so it reads
from across a room on any screen from 1024x768 upward. Line state as the
headline, the shift and plant clock, cones, sacks, rejects and the last sack,
and the fourteen stations. Refreshes every ten seconds and states when it last
succeeded; a network drop leaves the last good figures on screen with a warning
rather than blanking.

Sessions renew while they are in use, so a display left on this page does not
return itself to the login screen. Escape, or a small button in the corner,
returns to Now. Setting one up is documented in `DEPLOY.md`.

### 3.10 Output (`?v=performance`) — **WITHDRAWN FROM THE PRODUCT, Sep 2026**

Inferred OEE and its three factors, stoppage timeline, throughput curve, and
hour-of-day stoppage clustering. Built, tested and working. **Not part of the
delivery**: no entry in the navigation, not shown in demonstrations, and not
offered as a capability. Nothing in IFL's requirement list asks for equipment
effectiveness, and the OEE figure is inferred from event timestamps rather than
measured, so it is not a number this project is willing to defend to a plant
manager who never requested it. The route still resolves for internal use and
the code is retained; restoring it is a one-line change if IFL ever asks.

### 3.11 Weight (`?v=weight&sub=spread|stability|calibration`)

A verdict banner above Spread and Stability: mean, spread, capability, and the
share of subgroups outside control, with the sentence stating how far the line
sits from the setpoint and which setpoint that is.

**Spread.** Weight distribution histogram with the tolerance window and mean
marked and out-of-tolerance bars flagged; per-station deviation chart against
the line average with the action threshold drawn; and the material-giveaway
figure in kg/day and tonnes/year, with its provisional caveat attached.

**Stability.** X̄ chart of subgroup means with per-subgroup control limits, and
a *Show the maths* toggle revealing Cp, Cpk, σ-within, σ-overall, groups out of
control, and the S chart. Also the PLC-versus-product-tolerance comparison
(§4.6), which stays visible because it is a finding rather than a statistic.
Points are now also checked against Nelson rules 2-8 (§4.9) — a non-random
pattern with no single point ever crossing the 3σ band — shown as an
additional marked-point category on the same chart, with the specific rule(s)
in the hover tooltip.

**Calibration** (Phase 5 — roadmap table). Cone-only (sacks carry no station
column). Each of the 14 stations' own daily mean, tested against its own
history for a Nelson-rule pattern using an I-MR sigma estimated from how much
that station's daily mean normally moves day to day — not the sampling error
of one day's ~650 readings, which would flag ordinary noise as an extreme
pattern (§4.9 has the worked example). Sorted worst-first by days flagged, so
a station with a sustained 6-8-day pattern is visually distinct from one with
a single unusual day. A sparkline per station, and an adjustment log
(supervisor+ to write) recording every scale correction made through the app —
station, when, by whom, why — so a flagged station can be checked against
what was actually done about it.

### 3.12 Rejects (`?v=rejects&sub=reasons|trend|station`)

**Reasons.** Quality and weight reject counts, a Pareto of reject codes with
the concentration computed, and inline code labelling (manager and above) that
applies retroactively to every matching reject.

**Trend.** A p-chart of reject rate over time with per-bucket control limits,
episode detection distinguishing a sustained burst from an isolated spike, and
a verdict naming which occurred.

**By station.** A "fix this first" card cross-referencing reject rate against
weight bias, and reject rate by station against the line baseline.

### 3.13 Shifts (`?v=shift`) — **WITHDRAWN FROM THE PRODUCT, Sep 2026**

Shift-versus-shift comparison across six measures with a day-by-day trend
chart. Built and working, and withdrawn for the same reason as Output: not in
IFL's requirement list. Shift-wise figures remain available where they were
asked for — the Report screen (§3.8) breaks every period down by shift, in
plain counts and weights. The route still resolves; the code is retained.

### 3.14 Setup (`?v=admin&sub=people|stations|rules|sync|audit`) — admin only

**People** — accounts, roles, enable/disable, creation.
**Stations** — naming the 14 winding positions, with the currently flagged
positions marked.
**Rules** — three versioned rules (weight basis, shift basis, plausibility
window — see §7) plus the one threshold still fixed in code (stoppage
detection, adjustable per-view on Output instead), stated as a read-only fact
rather than a control that would do nothing.
**Audit log** — every account, station, rule and product-changeover write
made through the app, one place, newest first: who, when, what, and for the
writes that overwrite rather than version (user role/active, station names,
reject-code labels) the old value alongside the new. Independent of the
versioned rule tables' own `changed_by`/`changed_at`, which already answer
"what is the history of this one setting" — this answers "what has this
person done," which nothing else on Setup could (§8).
**Sync** — as §3.15.

### 3.15 Sync (`?v=operations`) — reachable by every role

Pipeline health: a verdict with a live indicator, tables succeeded on the last
pass, time since the oldest table ran, rows written, blocking data-quality
findings; per-table ingestion detail with watermarks; the schema-drift guard;
and the data-quality findings list by severity. Reachable at operator rank
deliberately — the wall-screen user is the one who notices the numbers stopped
moving.

### 3.16 Login

Two-pane sign-in with a live plant-link indicator.

---

## 4. What is computed, and how

Formulas as implemented, not as generally defined.

### 4.1 Shift derivation

Boundaries 06:00 / 14:00 / 22:00, confirmed by IFL. A night shift after
midnight belongs to the day it started. Derived from **production time**, not
from the insert time the plant's own `Shift` column uses.

### 4.2 Stoppage detection

No PLC status feed exists, so a stoppage is inferred from the gap between
consecutive cone weighings. A gap at or beyond the threshold (default 120 s,
adjustable per view) is a stoppage. Availability = run time ÷ observed span.
MTBF = run time ÷ stoppage count. MTTR = total downtime ÷ stoppage count.

*Limitation:* this cannot distinguish a scheduled break or changeover from an
unplanned fault, because nothing in the data says which it was.

### 4.3 OEE (inferred)

```
Availability = run seconds ÷ planned seconds
Performance  = (ideal cycle seconds × produced) ÷ run seconds
Quality      = produced ÷ (produced + rejected)
OEE          = Availability × Performance × Quality
```

Ideal cycle time is **inferred** from the best observed hourly throughput (95th
percentile) unless overridden, because no cycle-time specification exists.
Planned time defaults to 24 h/day and is capped to the observed data span so a
partial day is not counted as downtime. Every input is shown on screen.

*Limitation:* this is an estimate derived from event timestamps, not a
certified OEE. The screen says so.

### 4.4 Weight SPC

Readings are grouped into time-based rational subgroups (bucket size chosen
from the range and row count; 30-minute buckets on a typical single day).

```
σ within  = √( Σ(nᵢ−1)·sᵢ² ÷ Σ(nᵢ−1) )      pooled within-subgroup
σ overall = sample standard deviation of all readings
X̄ chart   = grand mean ± 3σ_within ÷ √nᵢ     per-subgroup limits
S chart   = centred on σ_within, limits ±3 ÷ √(2n)
Cp  = (USL − LSL) ÷ 6σ_within
Cpk = min(USL − mean, mean − LSL) ÷ 3σ_within
Pp  = (USL − LSL) ÷ 6σ_overall
Ppk = min(USL − mean, mean − LSL) ÷ 3σ_overall
```

Capability is **null unless a real tolerance is selected** — it is never
computed against a guessed specification.

**Population.** Every physically plausible reading (cone 1500–2100 g, sack
40–60 kg), in tolerance or not. Filtering to in-range readings would remove a
drifting station's worst output from the evidence used to judge that station.
Only scale faults are excluded.

### 4.5 Per-station bias (ANOM)

Each station's mean against the line mean. A station is *statistically
distinguishable* when |Δ| > 3σ_within/√n, and *actionable* only when it also
passes a practical threshold — 10% of the tolerance width when a tolerance is
set, otherwise 0.3σ. Both tests must pass, so the flagged set is the few worth
a maintenance visit rather than everything measurable.

### 4.6 PLC-versus-tolerance comparison

Two independent verdicts exist on every cone: the PLC's own in-range bit, and
the product tolerance held in PDAS. Nothing had ever compared them. SMS does,
and reports the disagreement in each direction.

The size of the disagreement depends on which product's tolerance is applied,
which is itself part of the finding. Measured over the 19 production days:

| Product tolerance | PLC passed, outside tolerance | PLC rejected, inside tolerance |
|---|---:|---:|
| 1960 ± 30 g (products 14, 15, 16) | 1,007 | 1 |
| 1960 ± 40 g (products 12, 13 — currently selected) | 127 | 107 |
| 1960 ± 50 g (products 17, 18) | 0 | 133 |
| 1950 ± 40 g (product 11) | 23 | 132 |

Read the first row: on a ±30 g product, 1,007 cones were passed as good by the
line while sitting outside that product's own tolerance. Read the last: on a
±50 g product, 133 cones were rejected while inside it. Both numbers are IFL's
own — one from the controller, one from the product master — so only IFL can
say which governs. SMS states the disagreement and does not pick a side.

### 4.7 Reject analysis

Pareto by code with cumulative share. A p-chart of reject rate with per-bucket
control limits scaled to that bucket's production, so a quiet hour and a busy
hour are judged fairly. Limits are only drawn where n·p̄ ≥ 5, below which a
3σ limit on a proportion is not valid. Episodes are runs of consecutive
out-of-control buckets, distinguishing a burst from a spike.

### 4.8 Material giveaway

Per-cone difference from the current product's setpoint, extrapolated using the
**median** daily cone count rather than total ÷ calendar days, so a partly
finished day cannot drag the figure. Presented as kg/day and tonnes/year,
labelled straight-line extrapolation, and carrying a provisional caveat until
Q4/Q5 is settled.

### 4.9 Nelson rules and calibration drift

The eight classic control-chart pattern tests (Nelson, 1984), computed by one
shared, unit-tested engine (`api/src/services/nelson.ts`) and applied at two
different grains:

- **Line-wide (Weight → Stability).** Applied to the same subgroups the X̄
  chart already shows. Rule 1 (a point beyond 3σ) is exactly what the chart's
  existing `xViolates` already meant; rules 2-8 catch a non-random pattern
  that never crosses that band — 9 in a row on one side, 6 trending, 2-of-3
  beyond 2σ, and so on.
- **Per-station (Weight → Calibration).** Applied to each station's own
  sequence of DAILY means, not individual cones. The sigma used for the
  Nelson zones here is deliberately **not** the within-day sampling error
  (σ/√n) — with ~650 cones/station/day that shrinks to a fraction of a gram
  and flags ordinary day-to-day noise as an extreme pattern (measured: it
  flagged all 14 of 14 stations, which cannot be right). Instead it is an
  **I-MR sigma** — mean moving range between consecutive daily means ÷ 1.128
  — the standard estimator for a sequence of individual aggregated points.
  Verified on the supplied data: station 1's day-to-day swings are 1-8g;
  σ/√n would have called anything past ~0.8g extreme, while the I-MR sigma
  (≈2.7g) does not. With this fix, 9 of 14 stations show at least one flagged
  day over the full 18-19 day history, clearly differentiated by count — three
  stations with 6-8 flagged days (a real sustained pattern) versus six with
  just 1-3 (an isolated day, far less concerning).

At the 18-19 production days this app has ever had, rules needing 14 or 15
points in a row (4, 7) are close to the length of the entire available
history and can realistically never fire yet at the per-station grain; the
Calibration screen says this rather than implying every rule is equally live.

The adjustment ledger (`sms.calibration_adjustment`) is the one piece of this
that needed storage — append-only, same convention as every other config
table here — recording who corrected a station's scale, when, and why, so a
flagged pattern can be checked against what was actually done about it.

---

## 5. Data model

**Sources read (IFL, read-only).** `sack1_TP1U2` (cones), `pack1_TP1U2`
(sacks), `rejectQCS1_TP1U2` (quality rejects), `rejectWeight1_TP1U2` (weight
rejects). The wide tables only — never the EAV originals, which carry six times
the rows and no extra information.

**Raw layer (`sms_raw`).** `cone_raw`, `sack_raw`, `reject_qcs_raw`,
`reject_weight_raw`. Append-only, verbatim.

**Canonical layer (`sms`).** 23 tables. The event tables are `cone_event`,
`sack_event`, `reject_event`. Reference data: `station`, `product`,
`product_timeline`, `reject_code`, `blend`, `yarn_count`, `tube_type`, `unit`.
Configuration and audit: `app_user`, `role`, `session`, `app_config`,
`weight_rule`, `shift_rule`, `plausibility_rule`, `sync_run`, `dq_finding`,
`rebuild_audit`, `audit_log`, `calibration_adjustment`.

**Volumes on the supplied copy.** 142,511 cone readings, 5,462 sacks, 3,146
rejects (2,900 quality, 246 weight), 14 winding stations. 19 production days,
2026-06-22 → 2026-07-10. Three of those readings — one cone and two rejects —
carry an epoch timestamp and no station, so reporting bounded to the production
window counts 3,144 rejects rather than 3,146; the difference is those rows.

---

## 6. Access control

Four roles, enforced server-side on every request; the interface hides what a
role cannot open rather than showing it and failing.

**Reading the data is not restricted.** The software is used by one group —
IFL's GM, managers and process-department engineers — so every screen is open
to every signed-in account. Roles govern what a person can *change*, which is
what requirement 9 asks for.

| Capability | operator | supervisor | manager | admin |
|---|:--:|:--:|:--:|:--:|
| **Every screen** — Now, Day, Records, Report, Weight, Rejects, Wall, Sync, Product history, Exceptions | ✓ | ✓ | ✓ | ✓ |
| Set the running product, log a calibration adjustment | | ✓ | ✓ | ✓ |
| CSV export of the raw register, name reject codes | | | ✓ | ✓ |
| Setup (people, stations, rules, audit log) | | | | ✓ |

**Create IFL's own accounts at manager rank.** Every user named by IFL needs to
set the running product and to export, so anything below manager only gets in
their way. `admin` is for whoever administers the installation. The lower two
roles exist for a future in which floor operators are given accounts; nothing
today requires them.

Passwords are argon2-hashed. Sessions are server-side cookies, not JWTs.
IFL's own `Users` table — three accounts whose passwords equal their usernames,
stored in plain text — is never read.

Every response carries a same-origin CSP, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a scoped
`Permissions-Policy`; `Strict-Transport-Security` is added automatically once
a request actually arrives over TLS (never sent over plain HTTP, where it
would do harm rather than good — see `api/src/security.ts`).

Login is rate-limited per IP **and** per username, so rotating either does not
bypass it.

---

## 7. Configuration the software owns

Because IFL's database is read-only to us, everything SMS needs to record lives
in its own database:

- **Current product** — set by a supervisor, timestamped and versioned, used as
  the weight setpoint.
- **Station names** — the 14 positions, so station-wise reporting reads in
  plant language.
- **Reject code labels** — applied retroactively to every matching reject, past
  and future, while the raw codes are always kept underneath.
- **Weight basis rule** — as-recorded / gross / net, versioned.
- **Shift basis rule** — recomputed or as-stored, versioned.
- **Plausibility window** — the cone/sack bounds below (and, for cones, above)
  which a reading is a scale fault rather than a real measurement. Was a code
  constant; now versioned and editable, read fresh by both the weight SPC and
  the giveaway calculation on every request.
- **Accounts and roles.**

---

## 8. Operations and data quality

**Sync health.** Every pass records outcome, watermark, rows read, rows
written and duration in `sync_run`, one row per source table per pass. The
screen reports both lifetime and last-pass figures: passes since install,
table-runs and how many failed, duration median and 95th percentile, time since
the oldest table last ran, and the most recent failure with its table, time,
error and whether that table has succeeded since.

**Schema-drift guard.** A fingerprint of each source table's shape is stored
and compared, so a column added or retyped on IFL's side is detected rather
than silently changing a number.

**Data-quality checks**, run by the transform on newly ingested rows and
surfaced with severity. Each finding is recorded once, at ingest; the
Operations screen and `verify` show the full standing set. (Until the Aug
2026 stress audit the checks re-ran over the entire dataset every pass and
re-recorded the same standing faults each time — the finding log grew by 8
rows per pass forever and `verify` reported 26 ERRORs where the real standing
faults were 2.)

| Check | Severity | What it catches |
|---|---|---|
| `future_timestamp` | ERROR | readings dated more than an hour ahead of the plant wall clock. Until the audit this compared the plant's wall-clock timestamps against real UTC — on this UTC+5 plant, every fresh live reading would have been flagged from the first minute after cutover, invisible in dev against weeks-old data |
| `nonpositive_weight` | ERROR | weight ≤ 0 |
| `outlier_weight` | WARNING | below the plausibility floor |
| `stale_timestamp` | WARNING | station clock faults — a reading stamped hours behind the readings around it, checked across ingest batches, not just within one |
| `no_station` | WARNING | readings with no usable station id |
| `merge_key_collision` | INFO | rows sharing a non-unique merge key, checked against already-ingested history as well as within the batch |

**Verification tool.** A CLI (`sync`, `verify`, `summary`, `rebuild`,
`user:create`) that re-checks canonical against raw independently of the API.

**Known data faults found in the supplied copy**, all now detected and
reported rather than silently absorbed: three readings with an epoch timestamp
and no station; two readings from one station stamped 27 h and 7.5 h behind
their neighbours; three sacks below the plausibility floor; two rows with
non-positive weight; and a stored shift value that disagrees with production
time on 4.45% of rows.

---

## 9. Deployment

Plant intranet, no cloud dependency. SQL Server Express on the plant PC. The
sync worker runs as a Windows service so it starts with the machine and
restarts on failure. Fonts are self-hosted; nothing loads from the internet at
runtime.

Go-live is a connection-string change: the sync worker is repointed from the
supplied copy to IFL's live server. The API and interface are unchanged,
because they only ever read the app's own database.

Plain HTTP is the documented default for the intranet deployment (§ below);
TLS is optional, not required, and two forms of it are built and rehearsed —
the API can terminate TLS itself (a Windows-native PFX or a PEM pair, no
extra software required for the PFX form) or sit behind a reverse proxy that
does. See `DEPLOY.md`'s TLS section for both, including a dated rehearsal log.

Tested at 1440×900, 1920×1080 (wall display) and down to 900px. A text-size
control (Desk / Floor / Wall) scales the whole interface including chart
labels, for reading at distance on the floor.

---

## 10. What this software does **not** do

The section to read first when comparing against a requirement list.

1. **It does not talk to the PLCs.** There is no PLC integration, no OPC UA, no
   S7 connection, and no PLC library in any of the five package manifests. All
   data arrives through IFL's SQL Server. IFL placed PLC integration out of
   scope (Q22). Adding it is a separate phase.

2. **It does not do product-wise or lot-wise historical reporting.** The
   weighing data carries no product or lot key, and the two source databases
   cannot be joined — there is no shared key. Historical readings are therefore
   unattributed. The app records the *currently running* product going forward,
   and uses it as the weight setpoint, but it cannot tell you what product a
   cone from three weeks ago belonged to. IFL confirmed product-wise history is
   not required (Q1).

3. **It does not cover dispatch.** No dispatch data exists anywhere in the
   supplied databases. Confirmed out of scope (Q12).

4. **It does not track individual cone identity.** The PLC's `P1_ConeID` is not
   available through the SQL path. The column exists and is nullable, with a
   provenance field beside it, but it is empty and its PLC path is dormant.

5. **It does not write to IFL's database.** No schema change, no index, no
   stored procedure, no data. Read-only, by client instruction.

6. **It is near-live, not real-time.** The floor and wall screens refresh
   themselves every ten seconds and show how long ago they last succeeded, but
   the data behind them is only as fresh as the sync, which runs once a minute.
   So a reading appears on the wall within about a minute of being weighed, not
   within a second. It is not a SCADA screen and does not control anything.

7. **It does not certify OEE.** Availability, performance and quality are
   inferred from event timestamps because no machine-status feed and no
   planned-downtime schedule exist. Every input is shown so the estimate can be
   corrected, but it is an estimate.

8. **It does not distinguish planned from unplanned downtime.** Nothing in the
   data records the difference.

9. **It does not name the reject codes.** The line records two numeric
   inspection codes per quality reject and their meaning is not in the
   database. Counts and Pareto are correct; the labels are blank until IFL
   supplies them, at which point they apply retroactively (Q10).

10. **It does not do sack-side SPC, energy monitoring, order or scheduling
    integration, or mobile-native applications.** It does now do a narrower
    thing adjacent to predictive maintenance — statistical drift detection
    per station plus a manual adjustment ledger (§3.11, §4.9) — but that is
    pattern detection on existing weight data, not failure forecasting,
    remaining-useful-life estimation, or automated maintenance scheduling.

11. **It has not been tested against live plant data.** Everything stated here
    was verified against the supplied 19-day copy.

12. **It does not use AI, and the calibration advice is statistical.** IFL's
    requirement asks for AI-based analytics recommending calibration
    adjustments. What exists is per-station drift measurement, Nelson-rule
    detection on the weight control chart, and a ledger of adjustments a
    supervisor has logged. That is a defensible answer to the underlying
    question and it is arithmetic, not a model. Note also that the plant is
    air-gapped by IFL's own hosting constraint, so nothing cloud-hosted is
    available to it. Any future claim here should be a prediction the software
    can actually justify from the data — for instance the number of days until
    a station reaches its action limit at the current drift — and should be
    described that way rather than as AI.

13. **It does not track sack stock per machine, and cannot yet.** IFL's sack
    table records the sack number, weight, in-range flag and time. It carries
    **no machine or station column**, unlike the cone table, so a sack cannot
    be attributed to a machine from the data supplied. Separately, nothing in
    any supplied database records a sack *leaving*, so a stock figure built
    from this data alone would only ever rise. Both points are questions for
    IFL rather than work that can be started; see `IFL_SACK_STOCK_QUESTION.md`.

---

## 11. Open questions with IFL

| | Question | Effect while unanswered |
|---|---|---|
| Q4 / Q5 | Are recorded weights gross or net, and in what unit? | Absolute weights and the giveaway figure carry a provisional caveat. The toggle is built and versioned; answering it is one admin action. |
| Q7 | Should the plant's stored shift value be corrected, or reproduced as-is? | Both modes are built. Default is corrected; the stored value disagrees on 4.45% of rows. |
| Q10 | What do the reject inspection codes mean? | Codes shown raw; labelling is built and retroactive. |
| Q14 | Single line or multiple? | Built single-line with `line_id` throughout. |
| Q20 | Hosting arrangement? | Assumes a plant PC on the intranet. |
| Q23 | How is a sack linked to a machine, and what removes a sack from stock? | **Blocks sack stock entirely** (requirement 7). Not answerable from the supplied data — see §10.13 and `IFL_SACK_STOCK_QUESTION.md`. |
| Q24 | Is "AI" a contractual expectation, or is defensible statistics acceptable? | Confirmed open on IFL's side (2 Sep 2026). Shapes what §10.12 can claim. |
| Q25 | Which device will floor staff use — wall monitor, shared PC, or phone? | The screens are built and verified from 420px upward; below 520px one older panel still overflows. Also decides whether Urdu labels are needed. |

Resolved and reflected in the build: Q1 (no product history), Q8 (shift
boundaries 06/14/22), Q12 (no dispatch), Q19/Q21 (sidecar, read-only, no DB
modification), Q22 (no PLC integration).

---

## 12. How this was verified

Not a claim of correctness, a description of method, so it can be judged.

Every screen was checked against the live database rather than only compiled.
The browser pass covers 21 routes at three viewport widths, asserting WCAG AA
contrast on every text/background pair (1,465 at the last full run), no
horizontal overflow, and no console errors. Configuration write paths were
exercised end to end and reverted. 123 automated tests cover shift derivation,
merge keys, configuration parsing, schema fingerprinting, the data-quality
checks, all eight Nelson rules (positive and negative cases for each), the
I-MR sigma estimator behind the Calibration screen, and — against the real
Express app, not a reimplementation of its routing — every RBAC boundary in
the API: every `requireRole`-gated route checked at every rank tier,
confirmed to actually catch a regression (a deliberately broken gate was
shown to fail the suite, then reverted) rather than trivially passing
regardless of what the code does.

The Calibration screen's per-station sigma choice is itself a caught mistake,
not a first-try design: the initial version used the within-day sampling
error and flagged all 14 of 14 stations as drifting, which was obviously
wrong on inspection against real numbers (§4.9) — fixed to an I-MR sigma
before this was ever shown as a capability, the same "verify against the
live database, not just against the code being internally consistent"
standard applied everywhere else in this document.

The backup/restore procedure was rehearsed against this exact database, not
merely documented: a real backup, a real restore into a scratch database, and
an exact row-count and content match against the source (`DEPLOY.md`, dated).
The rehearsal found and fixed three defects the script had carried since it
was written — including an option unsupported on the SQL Server edition this
project is built on, which would have made every backup fail, silently,
every night, on the real deployment target.

A full-system stress audit (19 Aug 2026) re-verified the whole stack against
the live database: source⇄raw⇄canonical reconciliation exact on all four
streams; sync idempotency proven by repeated live passes (zero duplicate
rows); every SPC, downtime, OEE and p-chart figure recomputed independently
in SQL and matched to the API's output to the last decimal; shift derivation
checked at all four boundaries including night-across-midnight; API fuzzing
(invalid dates, inverted ranges, oversized ranges, SQL-injection probes,
nonexistent references, duplicate keys); and a console-clean sweep of all 23
routes. It found and fixed seven bugs, three of which would only have
surfaced after live cutover: the transform re-reading the entire history
every pass, the future-timestamp check flagging every live reading on a UTC+5
plant, and the finding log growing without bound. Each fix was then verified
live — including a watermark-rewind test and a full `rebuild` rehearsal — and
regression-tested.

Figures printed on screen are computed from the data, never transcribed from a
design or a specification. This was not merely a principle: the interface
design supplied for this rework quoted thirteen specific figures, and on this
plant most of them were false — including which shift performs worst, which
stations are off-target, and the process capability. Each was replaced by a
derived value, and in every case the opposite outcome is reachable in the code.

---

*Prepared from the running system. Volumes, percentages and formulas above were
measured or read directly from source at the time of writing.*
