# KPI-DEFINITIONS.md — the figures the SMS reports print

**Status: developer's proposal, 15 September 2026 (roadmap Phase 8). Every row is "IFL approval: awaiting."**
This is the sheet IFL signs for the Phase 8 acceptance ("IFL approves layouts and KPI definitions"). Nothing on it has been approved. When a row is approved, its last column changes and the date and name go in §5.

Every figure any of the nine reports prints (`sms/api/src/services/reports/*.ts`, screens under `sms/web/src/screens/report/`) is defined here by name, one-sentence definition, the exact formula at SQL level (table, filter, population rule), its denominator, the clock it is on, what it excludes, and its approval state. A figure not on this sheet is not on a report.

---

## 1. Conventions every row uses

| Term | Meaning |
|---|---|
| **Period** | An inclusive range of **production days** (`shift_date`), each 06:00–06:00 on the plant clock under the line's shift rule (`sms.shift_rule`; boundaries 06/14/22 confirmed by IFL, Q8). A "day" on every report is a production day, never a calendar date. IFL has not confirmed production day vs calendar date for reporting. |
| **Shift** | `shift_code` as SMS derives it from the weighing time (`ProductionDate`), not the plant's stored `Shift` column (derived from insert time and wrong for ~2 % of rows — the shift check on the Daily and Shift reports states the disagreement). Which governs is IFL's decision (Q7). |
| **Plant clock** | Production timestamps are the plant's wall clock stored with a UTC label (`production_ts_utc`). "Generated at" on every report is this clock. |
| **App clock** | Instants this system wrote (`adjusted_at_utc`, `recorded_at_utc`, sync passes) are genuine UTC. They are converted before they meet a production-day bound (`plantClock.ts`). |
| **Plausible population** | Cone readings with `weight_g BETWEEN cone_lo_g AND cone_hi_g` from the newest `sms.plausibility_rule` for the line (default 1500–2100 g; sacks 40–60 kg). **Every weight statistic** (mean, median, SD, min, max, histogram, per-station means) is over this population and nothing else; the excluded count is printed beside it. The window is the developer's default; IFL has not confirmed it. |
| **The five states** | `shared/src/domain/classification.ts`: `unknown` (no weight, or implausible, or no limits in force at the reading's own time) · `rejected` (the scale's `in_range = 0`) · `low` / `high` / `within` (against the limits in force for the reading's product at the reading's time — never today's). Developer-proposed fixture; awaiting IFL (Phase 4). |
| **Weight basis** | As the scale recorded it (`as_recorded`). Gross vs net (Q4/Q5) is unconfirmed; the sack kilograms follow `sms.weight_rule.basis` (a net basis subtracts `sack_tare_kg` per sack). |
| **Line** | One line per installation (`LINE_ID`); every table below is filtered `line_id = @line`. |

Cone readings are `sms.cone_event`; inspection rejects are `sms.reject_event`; sacks are `sms.sack_event`. All three are SMS's canonical copies of IFL's `rejectWeight1_TP1U2` / `rejectQCS1_TP1U2` / `pack1_TP1U2` / `sack1_TP1U2` rows, reconciled per source generation by `sms verify`.

---

## 2. The KPI rows

The **Key** is the identifier in the management summary's JSON and CSV. **Denominator** is what a rate divides by. **Excludes** lists what the figure leaves out.

| # | Key | Name | Definition (one sentence) | Formula (SQL level) | Denominator | Clock | Excludes | IFL approval |
|---|---|---|---|---|---|---|---|---|
| 1 | `cones_weighed` | Cones weighed | Cone readings in the period. | `COUNT(*) FROM sms.cone_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to [AND shift_code=@shift] [AND source_station=@station] [AND material_id=@product]` | — | Plant (production day) | Nothing; implausible readings are counted (they are readings) | awaiting |
| 2 | `cones_in_range_pct` | Cones in range | Share of cone readings the scale's own bit marked in range. | `100 × SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END) / COUNT(*)` over the rows of #1 | Cones weighed (#1) | Plant | Nothing | awaiting |
| 3 | `cones_rejected_by_scale` | Rejected by the scale | Cone readings the scale marked out of range. | `COUNT(*) FROM sms.cone_event WHERE … AND in_range = 0` (the register's "Rejected cones" listing, same query) | — | Plant | Rows with `in_range` NULL | awaiting |
| 4 | `rejects_at_inspection` | Rejected at inspection | Cones the inspection stations rejected. **Corrected 23 Sep 2026**: this used to say "before they were weighed as cones" — false for 98%+ of them. Matching `reject_event` to `cone_event` by (production instant, hanger) finds a weighed cone (`in_range = 1`, i.e. weighed FINE) for 5,933 of 6,049 September quality rejects and 41 of 41 weight rejects: the inspection station rejects the cone *after* it was already logged as weighed, not before. | `COUNT(*) FROM sms.reject_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to [same optional filters]` | — | Plant | Nothing | awaiting |
| 5 | `inspection_reject_rate_pct` | Inspection reject rate | Inspection rejects as a share of everything inspected. | `100 × #4 / (#1 + unmatched #4)` | Cones + inspection rejects with NO matching cone_event row (a rejected cone was still an inspected unit, but most rejects are already counted once in #1 — see below) | Plant | Nothing | awaiting |

**Row 5's formula was corrected 23 Sep 2026, closing the divergence this row used to flag.** `sms/api/src/services/report.ts` (`toReportLine`) used to compute `weighed = cones + rejected`, double-counting the 98%+ of rejects that are the SAME physical cone as an existing `cone_event` row (weighed fine, then separately rejected) — the identical defect `sms/api/src/services/rejectSpc.ts` (the Rejects screen's own p-chart and headline) was corrected for on the same date. `production.ts` now computes `unmatchedRejects` — rejects with no matching `cone_event` row on `(production_ts_utc_ms, hanger_num)`, via the shared `rejects.ts getUnmatchedRejects` — and `toReportLine` divides by `cones + unmatchedRejects`, the same population `rejectSpc.ts` uses. `rejects.ts getRejectsByDayCode`'s own copy of the same formula (the per-day-per-code breakdown behind the Reject report) was corrected the same way. Re-verified against both real generations (epoch 1 July, epoch 9 September) via `sqlcmd -E` before this fix: 5,933/6,049 September quality rejects and 41/41 weight rejects match an existing cone row; 2,886/2,900 July quality and 244/246 July weight; +7s/+31s offset controls return zero matches on both. `sms/api/src/services/reportRejectRateAgreement.test.ts` (new) drives both real services against one dataset with both matched and unmatched rejects and fails if `toReportLine`'s and `rejectSpc.ts`'s rates ever diverge again for the same period.

**The third copy is now closed too (23 Sep 2026, later the same day).** `sms/api/src/services/weightStations.ts`'s `rejectRatesByStation` — the Weight screen's own per-station and line-wide reject rate, and `reports/station.ts`'s fallback — computed `rejects / (cones + rejects)`, which is why Weight printed a lower figure than Rejects and the management summary for the same period. It now calls the same `getUnmatchedRejects` and divides by `cones + unmatched rejects`. Per-station attribution was measured rather than assumed: an unmatched reject carries its own `source_station`, and across every real generation on the dev copy exactly three unmatched rejects (one per real epoch, all on the 1969-12-31 clock-fault day) carry none — those are excluded from the per-station denominators and included in the line total, the same asymmetry the line totals already had for station-less rows. Measured agreement after the fix, all three services driven against the live sidecar: **2026-08-05 → 2026-08-20 (September generation only) — 3.40 % on Weight, on the reports and on the Rejects p̄ alike; 2026-06-22 → 2026-07-10 (July generation only) — 2.21 % on all three.** `sms/api/src/services/rejectRateThreeWayAgreement.test.ts` (new) drives all three real services against one dataset holding both matched and unmatched rejects and fails if any of them diverges. **One qualification, by design and not a defect:** `rejectSpc.ts` reports p̄ for a single source generation, so on a window spanning the 5 Aug rebuild its figure describes one generation while the reports and Weight describe the whole window. Compare the three only over a single-generation period.
| 6 | `cones_within_limits_pct` | Within product limits | Cones classified `within` the limits in force at their own time, as a share of cones that could be judged. | `100 × states.within / (states.within + states.low + states.high + states.rejected)` where `states` is the five-state CASE (`coneState.ts bindStateCase`) grouped over the rows of #1 | Judged cones (`unknown` excluded) | Plant; limits from `sms.product_limit_version` at the reading's `production_ts_utc_ms` | `unknown` (no weight, implausible, or no limits in force — every July-generation cone) | awaiting |
| 7 | `mean_cone_weight_g` | Mean cone weight | Average recorded cone weight over the plausible population. | `AVG(weight_g) FROM sms.cone_event WHERE … AND weight_g BETWEEN @plausLo AND @plausHi` (`weights.ts`) | Plausible cones | Plant | Implausible and weightless readings | awaiting |
| 8 | `median_cone_weight_g` | Median cone weight | The interpolated median over the same population as #7. | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weight_g) OVER ()` over the rows of #7 (`weights.ts` since Phase 9; the cone-weight report computes the same expression when the service has none) | Plausible cones | Plant | As #7 | awaiting |
| 9 | `cone_weight_sd_g` | Cone weight spread | Sample standard deviation of recorded cone weight over the plausible population. | `STDEV(weight_g)` over the rows of #7 | Plausible cones | Plant | As #7 | awaiting |
| 10 | `implausible_readings` | Implausible readings excluded | Cone readings with a weight outside the plausibility window, excluded from every weight figure. | `COUNT(*) FROM sms.cone_event WHERE … AND weight_g IS NOT NULL AND NOT (weight_g BETWEEN @plausLo AND @plausHi)` | — | Plant | Weightless readings | awaiting |
| 11 | `sacks_weighed` | Sacks weighed | Sack readings in the period. | `COUNT(*) FROM sms.sack_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to [AND shift_code=@shift]` | — | Plant — **the sack's time is the plant's insert time** (the sack scale records no event time, SCHEMA DQ-5) | Nothing; sacks carry no station, so a station filter never applies | awaiting |
| 12 | `sack_weight_kg` | Sack weight | Sum of recorded sack weight under the weight rule's basis. | `SUM(weight_kg)` over the rows of #11, minus `sack_tare_kg × COUNT(*)` when `sms.weight_rule.basis = 'net'` | — | Plant (insert time) | Nothing (implausible sacks are counted; basis unconfirmed, Q4/Q5) | awaiting |
| 13 | `avg_sack_kg` | Average sack | Sack weight divided by sacks weighed. | `#12 / #11` | Sacks weighed | Plant | As #12 | awaiting |
| 14 | `sacks_rejected_by_scale` | Sacks rejected by the scale | Sack readings the scale marked out of range. | `COUNT(*) FROM sms.sack_event WHERE … AND in_range = 0` (the register's sack listing, same query) | — | Plant | `in_range` NULL | awaiting |
| 15 | `sacks_in_range_pct` | Sacks in range | Share of sacks the scale marked in range. | `100 × (#11 − #14) / #11` | Sacks weighed | Plant | Nothing | awaiting |
| 16 | `cones_per_sack` | Cones per sack (approximate) | Cones weighed divided by sacks weighed over the period. | `#1 / #11` | Sacks weighed | Plant | **An approximation, labelled so on every surface**: the plant records no key from a cone to its sack; cones between consecutive sacks range 0–250 in the data | awaiting |
| 17 | `time_lost_seconds` | Time lost | Sum of gaps between consecutive cone readings longer than the stop threshold. | `SUM(gap) FROM (LEAD(production_ts_utc) OVER (ORDER BY production_ts_utc) − production_ts_utc) WHERE gap > 120 s` over the period's cones (`downtime.ts getStoppagePatterns`, threshold `REPORT_STOP_THRESHOLD_SECONDS = 120`) | — | Plant | **Not split by shift** (a gap across a shift boundary belongs to neither); planned breaks and faults cannot be told apart | awaiting |
| 18 | `stoppages` | Stoppages | Count of gaps in #17. | `COUNT(*)` of the gaps in #17 | — | Plant | As #17 | awaiting |
| 19 | `stations_flagged` | Stations flagged for drift | Stations whose daily mean weights failed a pattern test inside a qualifying run against the line mean. | `weightStations.ts`: per station, daily means over the plausible population (`calibration.ts getStationDrift`); the run = consecutive production days on one side of the line mean, restarted at the last logged adjustment; flagged when a Nelson rule fired in the run AND run length ≥ `MIN_DAYS_HELD` (3) AND \|run mean − line mean\| ≥ threshold (10 % of the tolerance width when a product limit is in force, else 0.3 × the SD of station means) | — | Plant for readings; the adjustment instant converted from app UTC | Days before the last logged adjustment; readings without a station | awaiting |
| 20 | `days_with_data` | Days with readings | Production days in the period holding at least one cone reading. | `COUNT(DISTINCT shift_date) FROM sms.cone_event WHERE …` | — | Plant | Nothing | awaiting |
| 21 | `shift_mismatch_pct` | Shift attribution disagreement | Share of cone readings the plant's stored shift files differently from the shift SMS derives from the weighing time. | `100 × SUM(CASE WHEN shift_code_legacy IS NOT NULL AND shift_code_legacy <> shift_code THEN 1 ELSE 0 END) / SUM(CASE WHEN shift_code_legacy IS NOT NULL THEN 1 ELSE 0 END)` (`shiftCheck.ts`) | Readings carrying a plant shift | Plant | Rows with no plant shift | awaiting |

### Per-dimension figures (the same definitions, grouped)

| # | Key | Name | Definition | Formula | Denominator | Notes | IFL approval |
|---|---|---|---|---|---|---|---|
| 22 | `by_shift.*` | By shift | #1–#5, #11–#13, #16 per `shift_code`. | `GROUP BY shift_code` over the same rows (`production.ts groupBy 'shift'`) | Per group | Order morning · evening · night | awaiting |
| 23 | `by_day.*` | By day | The same per production day. | `GROUP BY shift_date` | Per group | | awaiting |
| 24 | `by_product.*` | By product | #1–#5, #7, #9, #10, #11–#13 and the five states per the reading's **own** `material_id`. **The printed NAME is disambiguated server-side** (23 Sep 2026, friction audit F7): PDAS holds six materials all described `205-IL0-SD` (ids 20, 21, 1021–1024) and three `201-IH0-SD`, so where a description collides the differing attributes are appended in order — colour, blend, count, tube type — and the PDAS id (`#20`) last if none separates them (`api/src/services/productNames.ts`; the browser's `web/src/lib/productLabel.ts` is the same rule). The `product_id` / `material_id` column is on every export beside the name, because a readable label that is *usually* unique is not an identifier. | `GROUP BY ISNULL(CAST(material_id AS varchar), 'none')` (`production.ts groupBy 'product'`; weights and states in `reports/product.ts` over the same predicate) | Per group | Readings from before IFL's 2026-08-05 rebuild carry no product and are listed as "No product on the reading", never assigned one; the report states the count | awaiting |
| 25 | `by_station.*` | By station | #1, #2, #4, #5, #7 and the five states per `source_station`, plus the station's bias vs the line mean and vs the target (run mean − line mean; run mean − target), days held, flag (#19 rule), last adjustment. | `GROUP BY source_station` (`production.ts`, `weightStations.ts`, `reports/station.ts`) | Per station; the reject rate divides by that station's cones + its rejects with no matching cone_event row (corrected 23 Sep 2026, see row 5) | "Station" = the numbered weighing station, station N ↔ winder N (Setup default, unconfirmed by IFL — Q3); sacks have no station | awaiting |
| 26 | `reject_pareto.*` | Reject reasons | Inspection rejects per (`reject_type`, `tube_inspect_code`, `material_inspect_code`) with share and cumulative share. | `rejects.ts getRejectPareto`: `COUNT(*) … GROUP BY reject_type, tube_inspect_code, material_inspect_code` joined to `sms.reject_code` for the label | All inspection rejects in the period (#4) | Code **meanings** are IFL's to supply (Q12/Q24); an unnamed code prints as its raw pair | awaiting |
| 27 | `reject_by_day_code.*` | Rejects by day and reason | #26 per production day, with that day's rate. | `rejects.ts getRejectsByDayCode`; rate = `count / (day's cones + day's rejects of every code)` | Cones + all rejects of the day | | awaiting |
| 28 | `reject_trend.*` | Daily reject rate with control band | Per production day: inspected, rejects, rate, and the p-chart limits p̄ ± 3·√(p̄(1−p̄)/n). | `rejectSpc.ts getRejectSpc(bucket 'day', type 'all')`; p̄ pooled over the period, or the newest source generation's when the period spans the 2026-08-05 rebuild | Cones + rejects of the day | A day outside the band is marked; no cause is asserted | awaiting |
| 29 | `histogram.*` | Weight distribution | Count of plausible cone readings per 20 g bucket (sacks per 1 kg). | `FLOOR(weight_g/20)*20, COUNT(*)` over the rows of #7 (`weights.ts`) | — | | awaiting |
| 30 | `adjustments.*` | Calibration adjustments in the period | Rows of `sms.calibration_adjustment` whose `adjusted_at_utc` falls inside the period. | `WHERE line_id=@line AND adjusted_at_utc BETWEEN @fromUtc AND @toUtc [AND (station_id=@station OR station_id IS NULL)]`, the bounds converted from plant midnight / plant end-of-day to UTC | — | Only adjustments logged in SMS from go-live; nothing before it exists | awaiting |
| 31 | `days_flagged` | Days flagged (per station) | Days in the period on which at least one pattern test fired for the station. | `COUNT(days WHERE nelson.length > 0)` from `calibration.ts getStationDrift` | Days with data for the station | | awaiting |
| 32 | `prior_period.*` | Prior period and change | Every management-summary KPI for the period of **equal length** ending the day before the period, and the change. | `prior = [from − N days, from − 1 day]` with `N = days(from, to)` (`reports/common.ts priorPeriod`); `delta.abs = current − prior`, `delta.pct = 100 × (current − prior) / |prior|` (null when the prior is 0; both null when either period has no readings) | — | A calendar month is compared with the same number of days before it, not with "the previous month". **A change is WITHHELD, not printed, under either test in §2.1** | awaiting |

---

## 2.1 When a change is withheld rather than printed

A KPI beside the same KPI for the prior period invites the reader to treat the
difference as a trend. Two conditions make that false, and the management
summary prints **"not comparable"** with the reason instead of a number when
either fires. The delta is still computed; it is not presented.

| Test | Applies to | Fires when | Why |
|---|---|---|---|
| **Coverage** (16 Sep 2026) | KPIs of shape `total` — a raw sum or count (#1, #3, #4, #10, #11, #12, #17, #18) | the two periods differ by more than **20 %** of the period's days in how many days held readings | The record has a real hole (10 Jul – 5 Aug 2026, IFL's table rebuild, not yet sent). A total moves with the number of days behind it; a rate does not. Keyed on SHAPE, never on unit — 'Average sack' is kg like 'Sack weight' and is a mean, not a total. |
| **Attribution** (23 Sep 2026, friction audit F12) | KPIs marked `attributionSensitive` — today only #6 `cones_within_limits_pct` | the share of cone readings carrying a product differs between the periods by more than **20 percentage points** | Before IFL's 2026-08-05 source rebuild no reading carried a `MaterialId`, so nothing could be judged against product limits at all and the figure collapses toward zero. Measured for 2026-08-05 → 2026-09-07 against its own prior (2026-07-02 → 2026-08-04): **100.0 % attributed against 0.0 %**, which the summary reported as **"Within product limits · 99.8 % · 4.5 % · +95.3 (+2,117.8 %)"** — a twenty-one-fold improvement in conformance that did not happen, on the page a GM signs. The coverage test could not catch it: #6 is a *rate*, and rates are coverage-independent by construction. The distinction is not total-versus-rate; it is whether the two periods are comparable at all. |

Both shares travel with the export: `comparable`, `incomparable_reason`,
`product_attribution_current_pct` and `product_attribution_prior_pct` are
columns of the management-summary CSV, so a withheld comparison can be checked
without the app.

---

## 3. What no report prints, and why

- **Sack stock per machine.** `sack1_TP1U2` carries no machine or station column at any layer, and inferring one from timestamps is forbidden by the roadmap (rule 6). Stock is line-level (Phase 7's ledger, `basis: 'line'`) until IFL answers Q28–32.
- **OEE, availability, performance, MTBF/MTTR.** Not in IFL's requirement list; inferred from event timestamps rather than measured. Withdrawn 2 Sep 2026. Time lost (#17) and stoppages (#18) — the measured part — remain.
- **A direction to adjust a scale.** Weighing data cannot tell a heavy scale from heavy cones. Reports state the bias and the flag and stop.
- **Any figure attributed to a product for readings before 5 August 2026.** Those readings carry no product at source; they are listed as such, never back-filled.
- **A target taken from limits first recorded AFTER the period being reported** (23 Sep 2026, friction audit F6). `sms.product_limit_version` is append-only and `ProductCatalogue.versionAt` returns the nearest version marked `effective_is_lower_bound` when none began at or before the instant asked for. Where that nearest version begins after the period's last day, the Cone weight and Product reports state **no target at all**, with the reason printed, rather than publishing its date as "in force at the period end" — which is what they did until this date (`inForceAtUtc: 2026-09-11` for a period ending 2026-09-07). Every row in that table today is a migration-027 bootstrap stamped 2026-09-11 with "true start unknown", so for periods before that date SMS genuinely does not know what limits applied, and says so. A version that IS in force but was only first *seen* at its instant is kept and qualified as **"no later than"** — the instant is a lower bound, not a start.
- **A giveaway figure.** The weight basis (gross/net) is unconfirmed (Q4/Q5); a giveaway against an unconfirmed basis is out by the tube weight. The Weight screen shows it provisionally; no report prints it.

---

## 4. Where each report's figures come from

| Report | Route | Rows on this sheet | Filters accepted |
|---|---|---|---|
| Daily | `GET /api/reports/daily` | 1–5, 10–13, 16–18, 20–23, the five states | shift |
| Shift | `GET /api/reports/shift` | 1–5, 10–13, 16, 20, 21, 23 per shift | shift (one, or all three) |
| Product | `GET /api/reports/product` | 24 | shift, station |
| Machine / station | `GET /api/reports/station` | 25 | — |
| Rejects | `GET /api/reports/reject` | 4, 26–28 | shift, station, product |
| Cone weight | `GET /api/reports/cone-weight` | 1, 7–10, 25 (mean and bias only), 29, the five states | — |
| Sacks | `GET /api/reports/sack` | 11–16, 22–24 (sacks), 29 (sacks); the stock block from Phase 7's `GET /api/sacks/stock` | shift |
| Calibration | `GET /api/reports/calibration` | 19, 25 (bias, days held, flag), 30, 31 | station |
| Management summary | `GET /api/reports/management-summary` (rank 3) | 1–7, 9–13, 16–20, 32 | — |

Every route takes `period` (`day` · `week` · `month` · `quarter` · `custom`) with `anchor` or `from`/`to`, capped at 366 days; every export is `GET /api/reports/<type>/export` (rank 3, audited `export.csv`) — one CSV table followed by a blank line and the attribution rows (report, line, period, filters, generated at plant time, generated by, SMS version, `definitions`, `ifl_approval`). A filter a report does not accept is refused with 400, never ignored.

---

## 5. Approval record

| Row(s) | Approved by | Date | Note |
|---|---|---|---|
| — | — | — | Nothing approved yet. |

Questions this sheet depends on, from `IFL-QUESTIONS-STATUS.md`: Q3 (station ↔ machine), Q4/Q5 (weight basis), Q7 (shift governs), Q12/Q24 (reject code meanings), Q28–32 (sack ↔ machine, stock), Q33–37 (weight states and reconciliation), the plausibility window, and production day vs calendar date for reporting.
