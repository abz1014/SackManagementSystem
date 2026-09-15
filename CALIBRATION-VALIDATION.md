# CALIBRATION-VALIDATION.md — how the calibration advisory is validated

**Status: AWAITING IFL.** Written 15 Sep 2026 (roadmap Phase 9 item 7). The roadmap's Definition of Done for Phase 9 says the calibration advisory is "validated". This document is the method the project proposes for that word, the result of running part of it against the real data already in hand, and the sign-off line IFL is asked to complete. Nothing here has been approved by IFL; the numbers in §3 are the developer's, computed with read-only queries against the development sidecar on 15 Sep 2026.

Companion documents: `ROADMAP-GAP-ANALYSIS.md` §11 (what Phase 9 asked for and what existed), `PROJECT_STATUS.md` (phase board), `REDESIGN.md` §5.3 (the advisory as designed), `sms/api/src/services/calibration.ts`, `attention.ts`, `weightStations.ts`, `nelson.ts` (the code the method exercises).

---

## 1. What is being validated

The advisory is one sentence per station on the Weight screen and the Line screen's attention list, of the form *"Station 7 has read about 9 g heavier than the line for 4 days — check its scale first"*, and since Phase 9 a second sentence when product limits are in force: *"At the current drift (+0.8 g/day over 4 days) this station reaches the action limit (+40 g from target) in about 12 days, if it continues at that rate."*

The detector behind it (`weightStations.ts`, identical in `attention.ts`) flags a station when **all four** hold over the fixed 14-production-day trailing window:

1. **Run.** The station's daily mean has sat on one side of the line's mean for the most recent D ≥ 3 calendar-consecutive production days (`MIN_DAYS_HELD`). A hole in the calendar or a logged adjustment ends the run.
2. **Offset.** The volume-weighted mean over those D days differs from the line's mean by at least the threshold: a tenth of the product's tolerance band when a product with limits was in force at the window's end (80 g band → 8 g), otherwise three tenths of the spread between station means (`driftThresholdG`).
3. **Pattern.** At least one Nelson rule fired on a day inside the run. The rules run on the station's daily means, measured from a centreline and an I-MR sigma that — since Phase 9 — restart at every logged adjustment (`calibration.ts` header).
4. **Window.** Everything is judged over the 14 days ending at the newest production day, whatever period the screen is set to.

The projection (Phase 9 item 6) is a least-squares straight line through the run's D daily means, in grams per calendar day, extended from the run's last day to the product limit in its direction of travel: `daysToLimit = (limit − lastDailyMean) / slope`. It is offered only for a flagged station with limits in force; it is null when the line is heading back toward the target; it reads "already past" when the last mean is beyond the limit; and the screen prints "would not reach the action limit within 90 days" beyond 90. **The assumption is linear continuation at the run's rate, and it is stated in the sentence itself.** It is a projection from recent readings. It is not a prediction, a forecast or a model, and the words never call it one.

What "validated" can honestly mean for this: (a) the detector catches an injected drift of a known size within a known number of days and clears when the adjustment is logged; (b) over the real history it does not flag things nobody would act on; (c) IFL's process engineers walk through (a) and (b) and agree the sentences are ones they would act on. The three parts follow.

---

## 2. Part (a) — the simulator scenario

`sms/scripts/simulate-plant.mjs` writes synthetic readings to `DATA_TP1U2_SIM` only (never `DATA_TP1U2`; the script refuses any other target). Its `STATION_BIAS` model gives stations 4, 10 and 13 a fixed offset (−2.9, +1.4, −1.1 g) measured from the real data. A fixed bias is exactly what the advisory must **not** flag as a drift, and it is not flagged today (a standing offset with no pattern fails test 3). A drift is a bias that grows.

**The scenario to run (not yet built into the script — it is a two-line addition when IFL agrees the scenario):**

1. Add a time-varying term beside `STATION_BIAS`, e.g. `const STATION_DRIFT_G_PER_DAY = { 7: 1.5 };`, and in `generate()` replace `STATION_BIAS[station] ?? 0` with `(STATION_BIAS[station] ?? 0) + (STATION_DRIFT_G_PER_DAY[station] ?? 0) * daysSince(t, driftStartMs)`. Station 7 then reads 1.5 g heavier every day from the drift start; nothing else changes.
2. Make sure a product with limits is in force (`MACHINE_MATERIAL[7] = 20`, whose PDAS limits are 1960 ± 40 g on the September mirror), so the threshold is the tolerance-based 8 g and the projection has a limit to reach.
3. Run `node scripts/simulate-plant.mjs --days=21` (backfill) with the drift starting on day 7, sync (`sms sync`), and open Weight each simulated day (or use `?at=` replay).

**What the detector must report, and when.** The offset test is on the RUN'S MEAN, not on the latest day: with a drift of r g/day that began on day 1 and a window holding days max(1, N−13)..N, the run mean on day N is r·(max(1, N−13) + N)/2. At 1.5 g/day it clears the 8 g threshold on **day 10** (1.5 × 5.5 = 8.25 g; day 9 gives 7.5 g). Rule 3 (six in a row trending) fires by day 6; rules 5 and 6 typically earlier, once the daily mean is 1–2 σ_day above the centreline. The run test needs three days. So the station must appear on the Weight table and in the attention list **on day 10 of the drift, and not before day 9** — earlier would mean the threshold is wrong, later that a rule failed to fire. On the day it appears the projection must read approximately *+1.5 g/day over 10 days* and *about 17 days* to the +40 g limit (the latest daily mean is ~15 g over, 25 g of the band left at 1.5 g/day), and the sheet must list the days rules 3, 5 or 6 fired, by name. (At the gentler 0.8 g/day the same arithmetic gives day 17 — the run mean of a slow drift takes a while to clear a threshold sized as a tenth of the tolerance. That lag is a property of the method IFL should see, which is why the scenario states it.)

Then **log an adjustment** for station 7 through the sheet (rank 2), dated the same plant day. On the next sync the flag must clear (the run restarts at the adjustment), the sheet must draw the pre-adjustment days grey with the "adjusted" tick on the correct production day — the two-clocks check: an adjustment logged at 02:00 plant time must land on that day, not the previous one — and the Details block must show the centreline restarted on that day. If the simulated drift continues past the adjustment, the flag must reappear about ten days later, judged against the new centreline only.

A second scenario, for the false-alarm side: leave `STATION_BIAS` as it is and run 21 days with **no** drift. No station may be flagged on any day. Station 4's −2.9 g standing offset must show in the table's *vs line* column and nowhere else.

Neither scenario has been run yet: the simulator addition is described, not made, so that IFL can agree the drift size and the day-count before the run becomes the acceptance record.

---

## 3. Part (b) — false-positive count over the 53 real production days

**Method.** The real detector (`getWeightStations`, the function the Weight screen and the attention list call — not a reimplementation) was run once for every production day D in the sidecar, over the window [D − 13, D], i.e. exactly what the screen would have shown on that day. 53 windows: 19 for the July generation (22 Jun – 10 Jul 2026) and 34 for the September generation (5 Aug – 7 Sep 2026); the three stray dates carrying one or two clock-fault rows each (1969-12-31, 2026-06-21, 2026-07-12) were not used as window ends. A station flagged on consecutive windows is one **episode**. Read-only: `getWeightStations` issues SELECT statements only; the sweep script (`validate-calibration.mjs`, kept outside the repository) opened the sidecar with the app login and rewrote nothing. (Migration 034 was not yet applied on the sidecar when the sweep ran, so the ledger statement's four new columns were read as NULL for the sweep — the one ledger row still reached the detector.)

Each episode is then read against a stated criterion, because "false positive" has to mean something checkable:

- **adjustment in window** — the ledger records an adjustment for that station (or line-wide) inside the episode's window. The ledger holds ONE row: station 7, 3 Sep 2026 16:56 plant time, "verification test — reference weight checked", no amount. IFL keeps no calibration records of its own (Q49/50), so this is the only record there is.
- **visible step** — the run's mean differs from the mean of the three production days before the run by at least the threshold the detector used. Something measurably changed at that station when the run began.
- **no visible step** — neither; a candidate false positive.

The last column asks a different question: would the episode have fired at the **8 g** threshold a recorded 80 g tolerance gives, rather than at the threshold that was actually in force?

### 3.1 Every episode the detector produced (53 windows, 14 stations)

| # | Station | Flagged on (windows ending) | Days flagged | Run start | Days held (first→last) | vs line, g (first→last) | Threshold, g | Rules that fired in the run | Mean of 3 prior days, g | Run mean, g | Step, g | Adjustment in window | Would fire at the 8 g threshold | Reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6 | 2026-06-27 → 2026-06-30 | 4 | 2026-06-25 | 3→6 | +0.94→+0.78 | 0.56 | 5,6,8 | 1944.68 | 1951.35 | +6.67 | none | no | visible step |
| 2 | 11 | 2026-06-29 → 2026-06-29 | 1 | 2026-06-27 | 3→3 | +2.55→+2.55 | 0.52 | 1 | 1948.25 | 1952.85 | +4.59 | none | no | visible step |
| 3 | 12 | 2026-06-29 → 2026-07-08 | 10 | 2026-06-27 | 3→10 | +2.75→+3.90 | 0.52 | 1,5,6 | 1947.94 | 1953.06 | +5.12 | none | no | visible step |
| 4 | 2 | 2026-07-04 → 2026-07-04 | 1 | 2026-07-02 | 3→3 | −2.80→−2.80 | 0.59 | 3 | 1957.72 | 1947.14 | −10.58 | none | no | visible step |
| 5 | 5 | 2026-07-05 → 2026-07-05 | 1 | 2026-07-02 | 4→4 | +3.07→+3.07 | 0.63 | 6 | 1946.88 | 1953.09 | +6.21 | none | no | visible step |
| 6 | 10 | 2026-07-05 → 2026-07-10 | 6 | 2026-07-03 | 3→7 | +3.26→+7.54 | 0.63 | 1,3,5,6 | 1946.42 | 1953.28 | +6.86 | none | no | visible step |
| 7 | 6 | 2026-07-08 → 2026-07-08 | 1 | 2026-07-06 | 3→3 | +5.05→+5.05 | 0.61 | 5 | 1949.37 | 1956.31 | +6.94 | none | no | visible step |
| 8 | 8 | 2026-07-08 → 2026-07-10 | 3 | 2026-07-06 | 3→5 | +4.95→+4.61 | 0.61 | 5,6 | 1947.23 | 1956.21 | +8.98 | none | no | visible step |
| 9 | 9 | 2026-07-08 → 2026-07-08 | 1 | 2026-07-06 | 3→3 | +4.81→+4.81 | 0.61 | 6 | 1945.72 | 1956.07 | +10.35 | none | no | visible step |
| 10 | 1 | 2026-07-10 → 2026-07-10 | 1 | 2026-07-06 | 5→5 | +2.69→+2.69 | 0.63 | 6 | 1950.03 | 1953.90 | +3.86 | none | no | visible step |
| 11 | 3 | 2026-07-10 → 2026-07-10 | 1 | 2026-07-04 | 7→7 | +3.04→+3.04 | 0.63 | 4 | 1950.41 | 1954.25 | +3.84 | none | no | visible step |
| 12 | 3 | 2026-08-19 → 2026-08-20 | 2 | 2026-08-17 | 3→4 | +10.12→+9.42 | 8 | 1,5,6 | 1951.88 | 1960.98 | +9.10 | none | **yes** | visible step |

*Reading the columns:* "vs line" is the run mean against the line mean, the figure the sentence prints; "Step" is the run mean against the three days before the run; "Threshold" is what test 2 used on that window. Projection at the last flagged window of episode 12: −0.23 g/day over 4 days toward the lower limit, 168 days away — the station was 9 g heavier than the **line** but 1 g under the **target** (the whole line runs about 11 g below target), and its daily mean was falling slightly. The screen prints that as "would not reach the action limit (−40 g from target) within 90 days, if it continues at that rate". It is also the case that fixed the projection's direction rule: the line is extended only when the station is moving AWAY from the target; a station heading back toward it gets "moving back toward the target" and no day count (`calibration.ts`, `daysToLimit` note).

### 3.2 Summary

| | July generation (19 days) | September generation (34 days) | Both |
|---|---|---|---|
| Windows swept | 19 | 34 | 53 |
| Station-days flagged | 30 | 2 | 32 |
| Episodes | 11 | 1 | 12 |
| Episodes coinciding with a logged adjustment | 0 | 0 | **0 of 12** |
| Episodes with a visible step (≥ threshold) at the run's start | 11 | 1 | 12 of 12 |
| Episodes with no visible step | 0 | 0 | 0 |
| Threshold in force | 0.52–0.63 g (fallback: no product limits before 5 Aug) | 8 g (tolerance 1960 ± 40 g) | — |
| Episodes that would fire at the 8 g threshold | **0 of 11** | 1 of 1 | 1 of 12 |
| Largest offset flagged | 7.5 g (station 10, 10 Jul) | 10.1 g (station 3, 19 Aug) | — |

**What the count says, in the developer's reading (IFL's is the one that matters):**

1. **Every episode began with a measurable change at that station** (a step of 3.8–10.6 g in the daily mean against the three days before), so by the stated criterion none of the twelve is a false positive in the sense of "nothing happened". Whether a 4–7 g change on a 1,950 g cone is worth walking to a machine is not a question the data answers; it is the question IFL is asked in §4.
2. **The threshold decided almost everything.** In July no product limits were recorded (they exist only from 5 Aug, when IFL's rebuilt tables began carrying `MaterialId`), so the detector fell back to three tenths of the spread between station means — 0.5 to 0.6 g on a line whose stations sit within a few grams of each other. At that threshold eleven episodes fired in nineteen days; at the 8 g threshold a recorded tolerance gives, **none of the eleven** would have. In September, with the tolerance in force, one episode fired in thirty-four days. The fallback is therefore the part of the method most in need of IFL's judgement: a floor on it (say 5 g, or a fixed fraction of the product setpoint) would have removed all eleven July episodes, and since 5 Aug every reading carries a product, so the fallback should rarely apply again. **Recommendation, not made in code: put a floor on the fallback threshold, value to be set by IFL.**
3. **The ledger cannot yet confirm or refute anything.** It holds one verification row for station 7, which was never flagged. Until IFL's engineers log the adjustments they make (the sheet's form, rank 2, now captures when, why, amount, before/after reference readings and the product in force), "coincides with a real adjustment" has no data to work with. This is the same prerequisite Phase 10 lists.
4. **Rule 4 fired once** (station 3, 10 Jul, on a full 14-day window). On the 14-day window rule 4 (14 in a row alternating) can fire only when every one of the 14 days holds data, and rule 7 (15 in a row within 1σ) can never fire — the Details block on Weight and on each station sheet now says so for the series it actually has, rather than leaving the reader to infer it.
5. **The pattern rules alone fire often** (table below: 98 of 604 station-days carry at least one rule); the run and threshold tests are what turn that into twelve episodes. The rules are the sensitive part; the threshold is the specific part.

### 3.3 Pattern-rule firings per station over the full history

One window per generation (22 Jun – 10 Jul; 5 Aug – 7 Sep), no adjustment restart in effect except station 7's 3 Sep row.

| Station | Production days with readings | Days on which any rule fired | Rules seen |
|---|---|---|---|
| 1 | 53 | 3 | 1,6 |
| 2 | 53 | 1 | 3 |
| 3 | 46 | 7 | 1,3,4,5,6 |
| 4 | 45 | 6 | 1,3,5,6 |
| 5 | 41 | 2 | 6 |
| 6 | 35 | 10 | 1,3,5 |
| 7 | 35 | 2 | 5,6 |
| 8 | 37 | 6 | 1,5,6 |
| 9 | 36 | 3 | 1,6 |
| 10 | 42 | 11 | 1,3,5,6 |
| 11 | 42 | 6 | 1,5,6 |
| 12 | 42 | 12 | 1,5,6 |
| 13 | 48 | 14 | 1,3,5,6,8 |
| 14 | 49 | 15 | 1,3,5,6,8 |

Rules 2 (nine on one side) and 7 (fifteen within 1σ) fired on no station-day in 53 days; rule 4 on one.

---

## 4. Part (c) — the IFL walkthrough and sign-off

To be done with IFL's process engineers, on the plant PC, against live data, after go-live. Proposed agenda, one sitting:

1. Open Weight. Read the station table's *vs line* and *vs target* columns together and confirm the two are both wanted (the line runs ~11 g below target on the September data, so "heavier than the line" and "under the target" can be true of one station at once — episode 12 above).
2. Open one flagged station's sheet (if none is flagged, use `?at=2026-08-20T12:00:00Z` replay on the sidecar for station 3). Read the daily means, the days the pattern fired with the rule names, the projection and its assumption. Say whether the sentence is one an engineer would act on, and what action.
3. Log a real adjustment through the sheet's form when one is next made, with the before/after reference readings. Confirm the next day that the flag cleared and the grey-out and tick sit on the right production day.
4. Decide the three settings this method leaves to IFL: the threshold when no product limits are recorded (§3.2 point 2); which of the eight Nelson rules apply to daily means (all eight are on; rules 2, 4 and 7 have fired on 0, 1 and 0 station-days respectively); and the minimum run (3 days).
5. Run the simulator scenario of §2 with the agreed drift size, and record the day the flag appeared and the projection it printed.

**Sign-off** (roadmap Phase 9 Definition of Done, "calibration advisory is validated"):

| Item | IFL decision / value | Name | Date |
|---|---|---|---|
| The observation sentence is one an engineer would act on | awaiting IFL | | |
| The projection sentence, with its assumption, is acceptable and correctly named | awaiting IFL | | |
| Threshold when no product limits are recorded (§3.2, point 2) | awaiting IFL | | |
| Nelson rules to apply (all eight / a subset) | awaiting IFL | | |
| Minimum run of days (currently 3) | awaiting IFL | | |
| Simulator scenario run and recorded (§2) | awaiting IFL | | |
| False-positive table (§3) reviewed | awaiting IFL | | |

Until every row is filled, the advisory's status in `PROJECT_STATUS.md` stays "built, awaiting IFL validation", and nothing in the application describes it as validated.
