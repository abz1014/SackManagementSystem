# mockup-data.json index (sms_audit, read-only, fetched 13 Oct 2026)

Periods: `pd1` = 2026-09-01 (one production day), `pl` = 2026-08-05..2026-09-07, `pr` = 1 Sep evening .. 2 Sep morning (shift range). `refs` = period-free data.
Each period: `<p>.raw.*` = trimmed API responses (prodNone, prodShift, prodStation, prodDay, weightStations, attention, machinesRunning, rejects, rejectsByDayCode, sacksSummary, sacksStock, weights, rejectSpc, calibration, reconciliation, live, mgmtSummary, dataBatch); `<p>.derived.*` = handy figures below.

| Figure (PD1 value) | JSON path |
|---|---|
| Line cones (3,089) | pd1.derived.lineCones |
| Sacks (133) / kg (6,296.7) | pd1.derived.sacks / sackKg |
| Failed inspection n (451) / % (14.57) | pd1.derived.failedInspectionN / failedInspectionPct |
| Failed weight check (0) | pd1.derived.failedWeightCheckN |
| Avg cone g (1954.27), target (1960), SD, giveaway/cone | pd1.derived.avgConeG / targetG / coneSdG / giveawayPerConeG |
| Avg sack kg, sacks passed scale %, cones per sack | pd1.derived.sackAvgKg / sacksPassedScalePct / conesPerSack |
| Per shift cones / failed / sacks / kg | pd1.derived.perShift.{morning,evening,night} |
| Per-station table (14 rows: cones, failed %, mean g, vs target, product+colour, since, state, last reading, last stamped product) | pd1.derived.perStation[] |
| Top reject reasons (Tube 2 Mat 1 = 440, 97.6%) | pd1.derived.topRejectReasons[] |
| Per-winder current product + since | pd1.derived.machinesRunning[] (also perStation[].productAtEnd, runningSince) |
| Management summary KPIs with prior and delta | pd1.derived.managementSummary.<kpi_key> (cones_weighed, inspection_reject_rate_pct, ...) |
| Trailing 14-day line mean / target / target product | pd1.derived.lineMeanG14d / lineTargetG / trailingProductLabel |
| Recent product changes | refs.recentProductChanges (3 entries, all outcome "disabled", audit tests) |
| Product timeline (manual "Current Product" selector) | refs.productTimeline.timeline[] |
| Limits history per product | refs.limitsHistory.products[] |
| Active catalogue (205-IL0-SD variants with colour/tube/count) | refs.productCatalogueActive[] |
| Changeover options | refs.changeoverRefs |
| PDAS write status (disabled) | refs.productWriteStatus |
| Health, range, live (default scope) | refs.health / refs.range / refs.liveDefault |
| Replayed live state at 1 Sep 21:59:59 | pd1.raw.live |

Caveats: `lastReadingUtc` / `lastStamped*` come from the whole snapshot (to 7 Sep), not as of 1 Sep. `machinesRunning` for PD1 is replayed at 2026-09-01T21:59:59Z (2-hour window), so only winders active then show a product. Station-sheet has no dedicated endpoint (see notEndpoints). SPC series omitted (large).
