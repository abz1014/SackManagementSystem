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

## Known, unresolved

- `sms.cone_event.source_station` contains a `0`, but `sms.station` holds only
  1–14, so that row has no configurable label.
- Sync totals (runs, failures, median duration) exist in `sms.sync_run` but
  `/api/operations` returns only the latest run per table.
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
