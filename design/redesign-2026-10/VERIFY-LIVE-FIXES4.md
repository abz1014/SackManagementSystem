# Live re-check of period sub-lines, station sheet product and Weight target (15 Oct 2026)

Status: fixes committed, built and re-checked live in the browser (single-product Weight case not observable).

## State found on resume
The 14 Oct session was interrupted and the machine restarted. Found: no node process at all (API, simulator and sync worker all down); `DATA_TP1U2_SIM` MAX(Date) was 14 Oct 17:43, about 18 hours behind. Of the three fixes, 1 and 2 were in the working tree uncommitted, 3 was not started.

Restarted with the guarded DEPLOY.md blocks (no --days, no --reset): simulator PID 14328, sync worker PID 2632 (both 12:02:42 on 15 Oct). The simulator caught up in one batch (+5,732 cones, +283 sacks); SIM MAX(Date) 12:10:56 against a clock of 12:12:15. The worker wrote the gap in its first pass and then ran normal passes (10 and 13 rows).

## Fixes (commits)
| # | Commit | What |
|---|---|---|
| 1 | `aa584bf` | Quality > Stations sub-line and Rejects period line use the PeriodChip wording through a shared `lib/periodWords` ("14 Oct, evening shift (plant time)"); whole days keep "n production days (06:00 to 06:00 plant time)". Register and Today already did. Weight has no period sub-line; its headline names none. |
| 2 | `dde0cea` | Station sheet "Running now" / "Last product it stamped" uses the distinct label from the product list (the Board's `distinctProductLabels`), short form grown until unique among the machines on screen, full label in the tooltip; falls back to the bare description if the list cannot be read. |
| 3 | `32f1c68` | Weight target. `/api/weight-stations` rows gain `targetProductId`, `targetG`, `targetEffectiveFromUtc` (additive, no schema change). New `targetScope`: line (no station ran its own product: line default, as before), one (every station ran the same product: that product's target, label and in-force time, and its id in the cone request), several (no target stated, "Each station is judged against its own product's limits, so no single target is stated.", no band, no productId in the request, the line default is not shown). Reserved weight-basis sentence unchanged. |

## Gate (HEAD `32f1c68`)
`npm run typecheck` clean. `npx vitest run` twice, identical: 477 files passed / 1 skipped, 5,095 tests passed / 4 skipped, 0 failed. Targets guard green. One mid-way failure (the reliability guard wanting the new product-list fetch's status read) was fixed before the commits.

## Build and restart
`npm run build` clean; `api/dist/index.js` 12:11:16, `api/dist/services/weightStations.js` 12:11:15, `web-next/dist/index.html` 12:11:45 (all re-emitted). No API was listening, so nothing was stopped; started `node api\dist\index.js` hidden, PID 24868 (12:11:57), logs `S/api-restart/api5.*.log`, startup line `db=sms`. `/api/health`, `/`, `/next/` all 200.

## Live re-check (15 Oct 2026, 12:17 to 12:35 plant clock; 07:17-07:35Z)
Owner signed in (admin) in the Browser pane. Look only: no write control clicked, no export. Sync passes observed in `logs/sync-worker.log` at 07:22:54, 07:23:55, 07:24:55, 07:25:56, 07:26:56 (5 passes, 60 s apart, 0 to 12 rows each). No process died, nothing restarted. Console errors: 0.

| Check | Result | Evidence |
|---|---|---|
| Fix 1 Stations, current shift | PASS | "15 Oct, morning shift (plant time)" |
| Fix 1 Stations, Today preset | PASS | "15 Oct 2026, 1 production day (06:00 to 06:00 plant time)" |
| Fix 1 Stations, PD1 | PASS | "1 Sep, evening shift (plant time)" |
| Fix 1 Stations, PL (5 Aug morning to 7 Sep night) | PASS | "5 Aug - 7 Sep, 34 production days (06:00 to 06:00 plant time)"; line rate 4.59 % |
| Fix 1 Rejects, PD1 | PASS | "1 Sep, evening shift" on the page line and the Pareto caption |
| Fix 2 sheet, station 10 | PASS | "205-IL0-SD · ORANGE · PVSD8020 · 30", same string as the Products Board |
| Fix 2 sheet, station 13 | PASS | "205-IL0-SD · ORANGE · PVSD8020 · 20 Slub", same string as the Board |
| Fix 3 Weight, live shift | PASS | "...Each station is judged against its own product's limits, so no single target is stated."; Target card says the same; cone request `/api/spc?type=cone&from=2026-10-15&to=2026-10-15&shift=morning` has no productId; no "201-IH0-SD" anywhere |
| Fix 3 Weight, PD1 | PASS | same wording; request has no productId; no 201-IH0-SD |
| Fix 3 Weight, PL | PASS | same wording; request has no productId; no 201-IH0-SD |
| Fix 3 no-product case (July 3) | PASS | "No product target is recorded for this period."; no productId |
| Fix 3 single-product case | NOT OBSERVED LIVE | every real window probed (5 Aug shifts, 6 Sep to 7 Sep) has at least two products on stations. Covered by the jsdom test only |
| Station tile vs SQL, station 13 and 11, morning shift | PASS | Today: 13 = 129 cones, 11 = 153 cones; `sms.cone_event` 129 and 153; means 1,951.43 and 1,951.78 g, minus 1,960 g target = -8.6 and -8.2 g, as the tiles |
| Reason sheet header vs table | PASS | Code 2/1, 1 Sep evening: sheet "161 cones", table rate 16.1 % of 1,001, day row 161 |
| Today figures rising | PASS | cones 2,045 (07:26:02Z) to 2,056 (07:27:35Z); readings to 12:08 then 12:09 |
| Lag sentence | PASS | "they reach this system about 18 min after weighing" |
| Replay `?at=2026-09-01T20:00` (no Z) | PASS | banner "as it was at 2026-09-01 20:00:00"; request `asOf=2026-09-01T20:00:00Z`; no "data batch" text on Today |
| Console errors | PASS | 0 |

Minor, not touched: "1 cones" / "2 cones" (plural) on the Stations failed-weight sub-lines.

## Not verified
The single-product Weight case on live data; touch input; a non-admin session; the plant.
