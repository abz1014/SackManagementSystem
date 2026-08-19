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

## 1. In one paragraph

The plant's Siemens S7-1500 PLCs weigh every cone and every sack and write the
readings into IFL's SQL Server. SMS copies those readings into its own database
once a minute, never writing to IFL's, converts them into a clean canonical
form, and presents it as twelve screens: sign-in, line status, production
records, a full record page, equipment effectiveness, weight process control,
reject analysis, shift comparison, a standalone findings view, a product
changeover history, configuration, and pipeline health. It computes availability,
throughput, OEE, statistical process control on cone weight, per-station bias,
reject Pareto and control charts, and shift-versus-shift performance. It is a
read-only reporting system over the plant's own data, plus a small amount of
configuration it owns itself.

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
Runs data-quality checks as it goes (§8).

**API and web.** A single Express service reads only the canonical layer and
serves a React application. The browser never talks to IFL's database.

**Cadence.** 60-second incremental passes on a per-table watermark (the highest
source row id already ingested), so a pass reads only what is new and a restart
resumes exactly where it stopped.

---

## 3. The screens

Twelve routes. Every screen states a plain-language finding first and puts the
statistics behind it, not the other way round.

### 3.1 Line (`?v=dashboard`)

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
  change date" link opens the standalone Exceptions view (§3.2) for the same
  day, pre-filtered to nothing — same findings, same synthesis, just a page of
  its own.
- **Cones by shift** with the weakest shift computed and marked.
- **Current product bar** — blend, count, tube type and weight, and tolerance
  (nominal ± offsets) for whichever product is running, plus a PDAS
  active-flag warning if that product is marked inactive there (informational
  only; never enforced). A supervisor changing product sees the same detail as
  a *live preview* of the pending selection before confirming — a changeover
  is a decision made against the new product's own tolerance, not a bare name
  picked from a list. A "View history →" link opens §3.3.

### 3.2 Exceptions (`?v=exceptions`)

The standalone version of "Needs a look" above — same finding synthesis
(there is exactly one implementation; both call it), but for any day, not only
the last complete one, with severity and screen filters. No new table: a past
day's exceptions are recomputed live from the same permanent event data
Overview already reads, rather than cached or persisted. Reachable via the
link on Overview; no rail icon, same as Sync below.

### 3.3 Product history (`?v=timeline`)

Every changeover ever recorded, newest first, each with the same blend/tube/
tolerance detail line as the current-product bar and who set it and why.
`product_timeline` has been append-only since Phase 1 shipped, but nothing
before this had ever read more than its single latest row — the "since …"
line on Overview was the only trace a change had happened. No date filter:
on this plant's changeover rate the whole table is a handful of screens, not
a windowed report. Reachable via the link on the current-product bar; no rail
icon, same as Exceptions and Sync.

### 3.4 Records (`?v=register&sub=cone|sack|reject`)

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

### 3.5 Output (`?v=performance&sub=oee|stops|patterns`)

**Effectiveness.** Inferred OEE with its three factors, each with a
plain-language note naming what produced it; a 7-day OEE strip against an 85%
reference line; and the three loss buckets (time stopped, time slow, cones
rejected). The inputs that shape the estimate — stoppage threshold, planned
hours per day, ideal cycle time override — are inspectable and editable.

**Stops.** A computed verdict on the day's downtime shape, the stoppage
timeline with shift bands, a throughput curve in cones per hour, and a stops
table with each stop's share of the day's downtime.

**Patterns.** Whether stoppages cluster at particular hours of the clock,
tested rather than asserted: an hour counts as a cluster only if it recurs on
more days than the median hour. Duration distribution, hour-of-day
distribution, and three summary figures.

### 3.6 Weight (`?v=weight&sub=spread|stability`)

A verdict banner above both tabs: mean, spread, capability, and the share of
subgroups outside control, with the sentence stating how far the line sits from
the setpoint and which setpoint that is.

**Spread.** Weight distribution histogram with the tolerance window and mean
marked and out-of-tolerance bars flagged; per-station deviation chart against
the line average with the action threshold drawn; and the material-giveaway
figure in kg/day and tonnes/year, with its provisional caveat attached.

**Stability.** X̄ chart of subgroup means with per-subgroup control limits, and
a *Show the maths* toggle revealing Cp, Cpk, σ-within, σ-overall, groups out of
control, and the S chart. Also the PLC-versus-product-tolerance comparison
(§4.6), which stays visible because it is a finding rather than a statistic.

### 3.7 Rejects (`?v=rejects&sub=reasons|trend|station`)

**Reasons.** Quality and weight reject counts, a Pareto of reject codes with
the concentration computed, and inline code labelling (manager and above) that
applies retroactively to every matching reject.

**Trend.** A p-chart of reject rate over time with per-bucket control limits,
episode detection distinguishing a sustained burst from an isolated spike, and
a verdict naming which occurred.

**By station.** A "fix this first" card cross-referencing reject rate against
weight bias, and reject rate by station against the line baseline.

### 3.8 Shifts (`?v=shift&sub=week|all`)

Three cards, one per shift, each with hours, a computed verdict, and five
measures (cones, reject rate, availability, stoppages, weight consistency, OEE)
with poor values marked. Below, a three-series day-by-day trend chart, and a
data note stating how far the plant's stored shift value disagrees with the
recomputed one.

### 3.9 Setup (`?v=admin&sub=people|stations|rules|sync`) — admin only

**People** — accounts, roles, enable/disable, creation.
**Stations** — naming the 14 winding positions, with the currently flagged
positions marked.
**Rules** — three versioned rules (weight basis, shift basis, plausibility
window — see §7) plus the one threshold still fixed in code (stoppage
detection, adjustable per-view on Output instead), stated as a read-only fact
rather than a control that would do nothing.
**Sync** — as §3.10.

### 3.10 Sync (`?v=operations`) — reachable by every role

Pipeline health: a verdict with a live indicator, tables succeeded on the last
pass, time since the oldest table ran, rows written, blocking data-quality
findings; per-table ingestion detail with watermarks; the schema-drift guard;
and the data-quality findings list by severity. Reachable at operator rank
deliberately — the wall-screen user is the one who notices the numbers stopped
moving.

### 3.11 Login

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

---

## 5. Data model

**Sources read (IFL, read-only).** `sack1_TP1U2` (cones), `pack1_TP1U2`
(sacks), `rejectQCS1_TP1U2` (quality rejects), `rejectWeight1_TP1U2` (weight
rejects). The wide tables only — never the EAV originals, which carry six times
the rows and no extra information.

**Raw layer (`sms_raw`).** `cone_raw`, `sack_raw`, `reject_qcs_raw`,
`reject_weight_raw`. Append-only, verbatim.

**Canonical layer (`sms`).** 21 tables. The event tables are `cone_event`,
`sack_event`, `reject_event`. Reference data: `station`, `product`,
`product_timeline`, `reject_code`, `blend`, `yarn_count`, `tube_type`, `unit`.
Configuration and audit: `app_user`, `role`, `session`, `app_config`,
`weight_rule`, `shift_rule`, `plausibility_rule`, `sync_run`, `dq_finding`,
`rebuild_audit`.

**Volumes on the supplied copy.** 142,511 cone readings, 5,462 sacks, 3,146
rejects (2,900 quality, 246 weight), 14 winding stations. 19 production days,
2026-06-22 → 2026-07-10. Three of those readings — one cone and two rejects —
carry an epoch timestamp and no station, so reporting bounded to the production
window counts 3,144 rejects rather than 3,146; the difference is those rows.

---

## 6. Access control

Four roles, enforced server-side on every request; the interface hides what a
role cannot open rather than showing it and failing.

| Capability | operator | supervisor | manager | admin |
|---|:--:|:--:|:--:|:--:|
| Line, Records, Shifts, Sync, Product history | ✓ | ✓ | ✓ | ✓ |
| Output, Weight, Rejects | | ✓ | ✓ | ✓ |
| Set the running product | | ✓ | ✓ | ✓ |
| CSV export, name reject codes | | | ✓ | ✓ |
| Setup (people, stations, rules) | | | | ✓ |

Passwords are argon2-hashed. Sessions are server-side cookies, not JWTs.
IFL's own `Users` table — three accounts whose passwords equal their usernames,
stored in plain text — is never read.

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

**Data-quality checks**, run by the transform and surfaced with severity:

| Check | Severity | What it catches |
|---|---|---|
| `future_timestamp` | ERROR | readings dated ahead of now |
| `nonpositive_weight` | ERROR | weight ≤ 0 |
| `outlier_weight` | WARNING | below the plausibility floor |
| `stale_timestamp` | WARNING | station clock faults — a reading stamped hours behind the readings around it |
| `no_station` | WARNING | readings with no usable station id |
| `merge_key_collision` | INFO | rows sharing a non-unique merge key |

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

6. **It does not do live/real-time monitoring.** The floor is 60 seconds — the
   sync cadence. It is a reporting system, not a SCADA screen.

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

10. **It does not do sack-side SPC, predictive maintenance, energy monitoring,
    order or scheduling integration, or mobile-native applications.**

11. **It has not been tested against live plant data.** Everything stated here
    was verified against the supplied 19-day copy.

---

## 11. Open questions with IFL

| | Question | Effect while unanswered |
|---|---|---|
| Q4 / Q5 | Are recorded weights gross or net, and in what unit? | Absolute weights and the giveaway figure carry a provisional caveat. The toggle is built and versioned; answering it is one admin action. |
| Q7 | Should the plant's stored shift value be corrected, or reproduced as-is? | Both modes are built. Default is corrected; the stored value disagrees on 4.45% of rows. |
| Q10 | What do the reject inspection codes mean? | Codes shown raw; labelling is built and retroactive. |
| Q14 | Single line or multiple? | Built single-line with `line_id` throughout. |
| Q20 | Hosting arrangement? | Assumes a plant PC on the intranet. |

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
exercised end to end and reverted. 27 automated tests cover shift derivation,
merge keys, configuration parsing, schema fingerprinting and the data-quality
checks.

Figures printed on screen are computed from the data, never transcribed from a
design or a specification. This was not merely a principle: the interface
design supplied for this rework quoted thirteen specific figures, and on this
plant most of them were false — including which shift performs worst, which
stations are off-target, and the process capability. Each was replaced by a
derived value, and in every case the opposite outcome is reachable in the code.

---

*Prepared from the running system. Volumes, percentages and formulas above were
measured or read directly from source at the time of writing.*
