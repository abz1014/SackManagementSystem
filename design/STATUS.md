# UI rework — complete

Every screen in `sms/web` is now built against the handoff in this folder.
`README.md` is the spec; `SMS Rework.dc.html` is the reference prototype.
Directions B and C are rejected alternatives, kept for context only.

## Screens

| Screen | Route | Signature |
|---|---|---|
| Login | pre-auth | two panes, plant plate on ink |
| Overview | `?v=dashboard` | 24-hour run/stop ribbon |
| Records | `?v=register&sub=cone\|sack\|reject` | table + sticky detail rail |
| Record detail | `?v=register&dtype=&did=` | the rail's overflow, same field order |
| Output | `?v=performance&sub=oee\|stops\|patterns` | dark OEE block |
| Weight | `?v=weight&sub=spread\|stability` | verdict banner, 6px alarm edge |
| Rejects | `?v=rejects&sub=reasons\|trend\|station` | fix-this-first card |
| Shifts | `?v=shift&sub=week\|all` | three shift cards |
| Setup | `?v=admin&sub=people\|stations\|rules\|sync` | four panels |
| Sync | `?v=operations` | same component as Setup > Sync, reachable at operator rank |

The legacy compatibility layer is gone: 24 colour aliases and 7 font aliases
retired across 413 call sites, and the dark-bezel panel rule deleted along with
the `.panel.light` modifier that existed only to escape it.

## The rule this rework runs on

**Every verdict sentence is computed, never transcribed.** The prototype's copy
quotes fixed numbers, and on this plant most of them are false. Each was
replaced by a derived value, and in every case the opposite outcome is
reachable in the code.

| Prototype says | This plant |
|---|---|
| "Night runs 15% behind the other two" | night is the STRONGEST shift; morning is weakest |
| "Night has trailed for 18 days straight" | morning trailed 12 of 20 days, 5 in a row |
| "stored shift wrong on 31% of rows" | 4.45% (6,340 of 142,510) |
| "Station 5 is both 24 g light and rejecting 1.9x" | no station is flagged on both; station 5 is the *least* deviant on weight |
| "flagged stations (5, 10)" | 10 and 13 |
| "Two inspection codes cause 3 in 4 rejects" | two codes cause 79% |
| "One stop cost more than the other six together" | longest stop is 16% of the day's downtime |
| "Stops cluster at 02:00 and 14:00" | 14:00 and 06:00 — two shift changeovers |
| "Cpk 0.57" | 1.409 under the current product — the process is capable |
| "±12 g action threshold" | 2.34 g with no tolerance, 8.00 g with one |
| "Sync healthy — 1,214 runs, no failures" | 65 runs, 1 failure, last completed 26 days ago |
| "4 accounts" | 2 |
| 14 named stations | 13 of 14 are NULL |

## Deliberate deviations from the design

1. **Login shows plant facts, not production volumes.** The design's
   "142,511 cones on record / 5,462 sacks packed" would require an
   unauthenticated endpoint, on a page that gets tunnelled publicly for demos.
   Live link state comes from `/api/health`, which discloses nothing.
2. **Setup > Rules has three cards, not four toggles.** Only the weight basis
   and shift basis are persisted rules. The design's other two are constants in
   the API; they are stated as read-only facts. A pill that flips and changes
   nothing is worse than a label.
3. **Weight basis stays a three-way control.** The live value is `as_recorded`,
   which a binary toggle cannot represent, and `gross` is numerically identical
   to it — only `net` moves any number, and only for sacks.
4. **Setup > Sync keeps the schema-drift and data-quality panels.** The design
   has no block for either; dropping them would hide the open ERROR findings.
5. **The Weight verdict banner carries four stats, not three.** Cpk is null
   until a tolerance is picked, so the fourth keeps a live figure on screen.
6. **OEE inputs are kept behind a toggle.** An inferred number whose
   assumptions cannot be inspected is one a plant engineer should distrust.

## Resolved since

- The phantom `2026-06-21` production day is fixed. `/api/range` now returns the
  window of days holding a real production run, reports what it held back, and
  the transform raises a `stale_timestamp` finding naming the station clock
  behind it. Two station-7 readings were 27 h and 7.5 h behind their neighbours.
- `source_station = 0` is handled. It was never a fifteenth position — all three
  station-0 rows are the epoch-clock faults. The transform normalises 0 to null
  and a `no_station` finding counts unattributable readings. Fixing it also
  corrected the Rejects screen, which had been counting unbounded (3,146) while
  its own nav counted bounded (3,144).
- Sync lifetime figures are exposed. `/api/operations` now returns passes,
  table-runs, failures, first/last run and duration percentiles, and the Sync
  screen shows them alongside the last failure and whether it is still open.
- The current-product bar showed only description/lot/setpoint, though PDAS
  already holds blend, count, tube type, tolerance and an active-flag for
  every product. `listProducts()` now joins that in; a shared detail line
  renders it both as a live preview of a pending selection and against the
  confirmed current product. A new `GET /api/product-timeline` plus a
  `?v=timeline` screen (link-reachable, no rail slot, same as Sync/Exceptions)
  expose the full changeover history that `product_timeline` has held since
  Phase 1 but nothing had ever read past the latest row. Also fixed: the
  section column's "Running now" footer has rendered conditionally since this
  rework but was always fed `productLabel={null}`, so it never once showed
  real data.
- Stability's X̄ chart only ever flagged a single point past 3σ. It now also
  runs Nelson rules 2-8 (non-random patterns — 9 in a row on one side, 6
  trending, and so on) through the same marked-point/tooltip mechanism, and
  Weight gains a third tab, Calibration, doing the same per station on daily
  means. That per-station version needed its own sigma, not the line-wide
  chart's σ/√n: with ~650 cones/station/day that sampling error shrinks to a
  fraction of a gram and an early version of this flagged all 14 of 14
  stations as drifting — caught on inspection against real day-to-day swings
  (1-8g) before shipping, and fixed to an I-MR sigma (mean moving range
  between daily means ÷ 1.128), the standard estimator for a sequence of
  individual aggregated points. Same "verify against real numbers, not just
  against the code being internally consistent" discipline as everywhere else
  in this rework — this is the one place in it where that step caught a
  wrong statistical design, not a wrong figure.

- The 19 Aug 2026 stress audit found and fixed seven bugs across the stack —
  the three that mattered most were invisible in dev and would only have
  surfaced after live cutover: the transform re-read the ENTIRE raw history
  every 60s pass (2.5s at 151k rows, growing linearly forever — now
  watermarked, a no-change pass is ~0.3s at any volume); the future-timestamp
  DQ check compared plant wall-clock stamps against real UTC, which on this
  UTC+5 plant would have flagged every fresh reading as an ERROR from the
  first minute of live operation; and the finding log grew by 8 duplicate
  rows per pass forever (verify reported 26 ERRORs where the real standing
  faults were 2 — deduped by migration 016, batch-scoped from now on). The
  other four: the calibration form's default timestamp was UTC in a
  local-time input (untouched, it recorded adjustments 5h early — proven
  live); a changeover to a nonexistent product id was accepted and became the
  line's "current product" (proven live with id 4242); a rename of a
  nonexistent station returned ok and wrote a phantom audit entry; and a
  duplicate username surfaced as a raw 500 instead of a 409. Everything else
  held: reconciliation exact, SPC/OEE/downtime/p-chart figures matched
  independent SQL recomputation to the last decimal, shift boundaries exact,
  all injection/fuzz probes rejected, all 23 routes console-clean.

## Known, unresolved

- Bulk CSV export was tightened to manager+ during the Records rework. Reversible.

## Verification standard

Each screen was checked against the live database, not just compiled. The
browser pass covers 21 routes at 900px, 1440×900 and 1920×1080, asserting WCAG
AA contrast on every text/background pair (1,465 at last run), no horizontal
overflow, and no console errors. Setup's write paths were exercised end to end
and reverted.

One caution for anyone continuing this work in a cloud session: it will have the
code but not the plant database, so it cannot run this verification. Most of the
defects found during the rework — a false gross/net warning, a 1960 kg sack
setpoint, an empty station cross-reference, backwards shift verdicts, a
white-on-white export button — were invisible in the source and only appeared
against the 142k rows.
