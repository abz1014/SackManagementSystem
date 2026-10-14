# Live re-check of shift targets, station labels and the reason sheet (14 Oct 2026)

Run on the dev PC only: owner's API on :4000 restarted on the new build, simulator restarted on the watchdog code, `sms` dev database, live simulator epoch 13 (`DATA_TP1U2_SIM`). Edge-class browser pane, signed in as admin, no write control clicked. Plant clock about 17:00-17:06 (readings lag about 17-18 min). Not the plant, not a printer, not a real LAN.

## Setup

| Item | Result |
|---|---|
| Gate (HEAD ef2bee1) | vitest 477 files passed / 1 skipped, 5,088 tests passed / 4 skipped, 0 failed; typecheck clean |
| Build | `npm run build` clean; api/dist mtimes 17:16:07; `narrowPopulation` present in api/dist/services/stationStatus.js |
| API | old PID 26448 stopped, new PID 32308; /api/health, / and /next/ all 200; log `db=sms`; stderr empty |
| Simulator | old PID 12140 stopped, new PID 5172 (`--live`, appends logs\sim.log); log "live mode: appending every 15 s"; DATA_TP1U2_SIM MAX(Date) 17:16:23 -> 17:23:17 over 7 min; production up to 17:00:24 -> 17:05:51 |
| Sync worker | PID 27408 untouched, passes every ~61 s (17:21:37, 17:22:38, 17:23:38 seen) |

## Checks

| Check | Result | Evidence |
|---|---|---|
| 5a station product names agree across Today, Quality > Stations, Wall (1920x1080), station sheet, Products Board | PASS | See table below. Stations 1-5 on material 21 (Blue), 6-9 on 20 (Star Green), 10-11 on 1021 (ORANGE .. 30), 12 on 1022 (PVSD8020), 13 on 1023 (ORANGE .. 20 Slub), 14 on 1024 (YELLOW). All five surfaces show the same label per station. |
| 5a short labels unique; full label in tooltip; no 201-IH0-SD in station names | PASS | No two different products share a short label on any screen (Blue / Star Green / PVSD8020 / ORANGE .. 30 / ORANGE .. 20 Slub / YELLOW). Stations table `title` attributes carry the full label (e.g. `205-IL0-SD · Blue · PVSD8020 · 36`). No station shows 201-IH0-SD. |
| 5b vsTarget follows the shift | PASS | Table below. Tile/row value = SQL evening-shift mean minus own setpoint within rounding and +1-3 cones of live drift. Switching to Today (`p=today`) changed it to the whole-day figure: Station 1 -7.9 -> -9.5 (SQL -9.46), Station 13 -9.9 -> -9.8 (SQL -9.76), Station 8 -7.3 -> -8.5 (SQL -8.52). |
| 5c reason sheet, live period (Code 10/1, 14 Oct evening) | PASS | Header "11 cones failed inspection" = 11 table rows; note "limited to 14 Oct, evening shift" shown; products named with the distinct labels in use. |
| 5c reason sheet, PD1 1 Sep 2026 evening (Code 2/1) | PASS | Header 161 = 161 rows, times 15:33 to 21:50 (inside the evening shift), note "limited to 1 Sep, evening shift", labels Blue / Star Green / PVSD8020. |
| 5d figures rise across polls on Today | PASS | Cones 820 (17:18) -> 827 (17:20) -> 844 (17:22) -> 845 (17:23); sacks 30 -> 31; "Readings to" 17:00 -> 17:05. |
| 5d HealthDot and lag sentence | PASS | "OK: Data current"; "Readings to 17:05 · they reach this system about 17 min after weighing." |
| 5e replay `?at=2026-09-01T18:00:00` (no Z) | PASS | Replay banner, 1 Sep evening shift; request sent as `asOf=...Z`, all 200. |
| 5e Wall, no "Not available" over ~63 s | PASS | 12 samples, none. Cones 827 throughout; Updated stamp advanced 17:19 -> 17:20. |
| 5e /api/live request rate | PASS | 6 requests in 63 s on the Wall (about 3 per 31 s). |
| 5e Station 5 naming in pickers | PASS | Weight and Rejects station pickers read "Station 5 · East Conveyor". Board card shows "East Conveyor" only (existing naming). |
| 5e no "data batch" text on Weight, Reason sheet, Reports | PASS | Text search false on all three. |
| 5f app console errors | PASS (qualified) | Zero new errors over the whole run after a fresh load; the pane's buffer holds 7 older errors (4 ERR_CONNECTION_REFUSED, matching the API restart window, plus one 404 and two 400s not attributable); the count did not change across any later navigation, including a deliberately malformed `p=` probe. |

## Station SQL vs screen (final pass 17:23:58; SQL = latest cone per station in epoch 13; tile = Today)

| St | SQL material | SQL last cone | Today tile | Stations table | Wall | Board |
|---|---|---|---|---|---|---|
| 1 | 21 Blue | 17:04:27 | Blue | Blue | Blue | Blue · PVSD8020 · 36 |
| 2 | 21 | 16:58:59 | Blue | Blue | Blue | same |
| 3 | 21 | 17:05:50 | Blue | Blue | Blue | same |
| 4 | 21 | 17:03:00 | Blue | Blue | Blue | same |
| 5 | 21 | 17:02:29 | Blue | Blue | Blue | same ("East Conveyor") |
| 6 | 20 Star Green | 17:04:13 | Star Green | Star Green | Star Green | Star Green · PVSD8020 · 18 |
| 7 | 20 | 17:01:15 | Star Green | Star Green | Star Green | same |
| 8 | 20 | 17:04:57 | Star Green | Star Green | Star Green | same |
| 9 | 20 | 17:02:03 | Star Green | Star Green | Star Green | same |
| 10 | 1021 | 17:04:38 | ORANGE · PVSD8020 · 30 | same | same | same |
| 11 | 1021 | 17:03:04 | ORANGE · PVSD8020 · 30 | same | same | same |
| 12 | 1022 | 17:04:17 | PVSD8020 | PVSD8020 | PVSD8020 | PVSD8020 · 50 |
| 13 | 1023 | 16:59:38 | ORANGE · PVSD8020 · 20 Slub | same | same | same |
| 14 | 1024 | 17:04:30 | YELLOW | YELLOW | YELLOW | YELLOW · PVSD8020 · 36 Slub |

(Earlier pass at 17:18 matched identically; the products did not change during the run.)

## vsTarget, evening shift 14:00-22:00, 14 Oct (final pass; all setpoints 1,960 g)

| St | Cones SQL | SQL mean - setpoint | Today tile (17:23:58) | Quality > Stations (17:2x, shift) |
|---|---|---|---|---|
| 1 | 63 | -7.92 | -7.9 | -8.2 (17:20, 62 cones) |
| 2 | 58 | -8.97 | -9.0 | -9.0 |
| 3 | 67 | -8.16 | -8.2 | -8.4 (earlier, 64 cones) |
| 4 | 48 | -10.44 | -10.4 | -10.4 |
| 5 | 79 | -9.37 | -9.4 | -9.4 |
| 6 | 51 | -9.38 | -9.4 | -9.9 (earlier, 49 cones) |
| 7 | 57 | -8.26 | -8.3 | -8.3 |
| 8 | 53 | -7.21 | -7.2 | -7.3 |
| 9 | 69 | -8.13 | -8.1 | -8.1 |
| 10 | 60 | -7.69 | -7.7 | -7.8 |
| 11 | 60 | -9.35 | -9.3 | -9.4 |
| 12 | 51 | -7.65 | -7.6 | -7.6 |
| 13 | 62 | -9.91 | -9.9 | -9.9 |
| 14 | 67 | -8.79 | -8.8 | -8.8 |

Differences in the right-hand column are cones that arrived between reads (simulator adds a few cones per minute); the Today tiles were read within the same minute as the SQL.

## Observations (not failures of the fixes under test)

1. Quality > Stations opened on the evening shift prints "14 Oct 2026, 1 production day (06:00 to 06:00 plant time)" under its heading while the figures (820 cones, 62 for Station 1) are the evening shift's only. The whole day has about 3,460 cones. The period control above reads "14 Oct, evening shift", so the figures are right and this sub-line is the wrong label. Worth a follow-up.
2. The station sheet's "Running now: 205-IL0-SD, since 30 Sep 2026 17:08" uses the bare description, so it does not tell Station 13's product apart from Station 10's. The "Judged against" line above it carries the distinct label.
3. Weight's headline target reads "201-IH0-SD (retired in PDAS) · in force since 6 May 2026" and its SPC request uses productId 12 while the stations run materials 20, 21 and 1021-1024: that is the line default product, not a station product. Unchanged behaviour, noted only.
4. Not exercised: Setup, any write control, exports, a below-admin session, a physical TV.

## Not verified

Everything above ran on the dev PC against simulator data (synthetic) and the 1 Sep PD1 copy. The plant, real running data, printing and any person looking at the screen were not part of it.
