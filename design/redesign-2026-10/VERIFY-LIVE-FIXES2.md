# Live re-check of station product names on incoming data (14 Oct 2026)

Dev PC only. API restarted by the owner's approval; browser pane signed in as admin; no write control clicked, no export.

## Gate and deploy
- `npm run typecheck`: clean. `npx vitest run`: 475 files passed / 1 skipped, 5,067 tests passed / 4 skipped, 0 failed.
- `npm run build`: exit 0, BUT the API dist was stale: `tsc -b` skipped `api` (tsbuildinfo newer than the sources, `api/dist/services/weightStations.js` still dated 16:09, no `distinctLabel`). After the first restart `/api/station-status` still returned the plain "205-IL0-SD" for all 14 stations. Fixed with `npx tsc -b api --force` (also re-emitted shared and sync-worker dist, same content) and a second restart. Anyone building on this tree should expect the same skip.
- API: PID 16948 -> 28812 (first restart, stale dist) -> 26448 (final, :4000). `/api/health`, `/`, `/next/` 200. Start log `db=sms`, error log empty.
- Simulator PID 27712 and sync worker PID 27408 alive before and after, never touched.

## Incoming data: NOT demonstrated
The simulator process is alive but wrote nothing after insert time 16:28:33 (DATA_TP1U2_SIM max `Date`, count 376,091 constant from 16:41 to 16:49 local; its CPU time did not move). Newest cone stayed 16:10:39 throughout, so the screens (correctly) said "no readings for 11, then 19 min". Every check below therefore ran on the data already ingested; "tiles follow a change" and "figures rise across polls" could not be observed. The owner needs to restart the simulator (not done: told not to stop it).

## Station product names: SQL vs API vs screens (epoch 13, 14 Oct)
Expected label per material (from `sms.product` + PDAS Blends/Counts/TubeTypes, read-only): 21 = `205-IL0-SD · Blue · PVSD8020 · 36`; 20 = `… · Star Green · … · 18`; 1021 = `… · ORANGE · … · 30`; 1022 = `205-IL0-SD · PVSD8020 · 50` (no colour); 1023 = `… · ORANGE · … · 20 Slub`; 1024 = `… · YELLOW · … · 36 Slub`.

| Station | Latest material (SQL, passes 1/2/3 at 16:41, 16:45, 16:49 local: identical) | Today tile short | Tile tooltip | Stations table | Wall | Board |
|---|---|---|---|---|---|---|
| 1-5 | 21 | 205-IL0-SD · Blue | full label, match | match | match | match |
| 6-9 | 20 | 205-IL0-SD · Star Green | match | match | match | match |
| 10-11 | 1021 | 205-IL0-SD · ORANGE | match | match | match | match |
| 12 | 1022 | 205-IL0-SD · PVSD8020 | match | match | match | match |
| 13 | 1023 | 205-IL0-SD · ORANGE | match (20 Slub) | match | match | match |
| 14 | 1024 | 205-IL0-SD · YELLOW | match (36 Slub) | match | match | match |

- Pass 1 11:44Z Today tiles (14/14 API, tooltip, SQL material). Pass 2 11:45Z Quality > Stations (14/14 short and tooltip). Pass 3 ~11:46Z Wall at 1920x1080 (14/14). Station sheet (station 12): "Judged against 205-IL0-SD · PVSD8020 · 50" = Board. PASS. No "201-IH0-SD" anywhere. API `/api/machines/running` material ids equal the SQL ones for all 14.
- Observation (not a mismatch): short labels of stations 10, 11 and 13 are all "205-IL0-SD · ORANGE"; only the tooltip/Board tell 30 from 20 Slub. Station 12's short label shows the blend because it has no colour.
- PD1 2026-09-01 (epoch 9): API 1-2 Star Green 18, 8-10 Blue 36, 13-14 `205-IL0-SD · PVSD8020 · 50`; others null (no cones). Matches SQL materials (20, 21, 1022). vsTarget matches SQL mean minus 1960 for all 7 stations (e.g. st 1 -4.7, st 10 -7.8). PASS.

## vsTarget spot-check: FAIL (new finding)
Today is `shift=evening`. Tile "cones" is the evening count (st 1: 43), but `vsTargetG` is the whole production day:

| Station | Shown | SQL evening mean - 1960 | SQL morning+evening (day) |
|---|---|---|---|
| 1 | -9.8 | -9.32 | -9.79 |
| 6 | -8.2 | -10.42 | -8.19 |
| 12 | -8.6 | -7.60 | -8.57 |

`/api/station-status?...&shift=evening` and the same call without `shift` return identical vsTargetG but 43 vs 223 cones. So a tile with an evening count carries a whole-day deviation from its own target (target product itself is right). `stationStatus.ts` passes `shift` to `getWeightStations`; that function apparently does not narrow the station means by shift. Not fixed here.

## Earlier fixes, live
| Check | Result |
|---|---|
| Today lag sentence | PASS: "Readings to 16:10 · they reach this system about 17 min after weighing." |
| Figures rise across polls | NOT TESTABLE (simulator stalled) |
| Replay `?at=2026-10-14T12:30:00` (no Z) | PASS: loads, "Leave replay" shown, readings to 12:29; Leave replay returns `?s=today`, live 16:10, 563 cones |
| Wall, no "Not available" | PASS over 47 s observed (timers throttled in the hidden pane) |
| /api/live rate | PASS: 5 calls in 47.5 s = about 3.3 per 31 s |
| Station 5 naming in pickers | PASS: "Station 5 · East Conveyor" in the Weight picker |
| No "data batch" | PASS on Weight, Rejects, Reason sheet (`sheet=reason:2026-10-14|quality|10|1`), Reports |
| Reports preview October | PASS: banner "come from the plant simulator" and "These figures are test data, not readings from IFL's plant." |
| Console errors | 6 logged this session: 3 connection-refused during the API restarts, 2 HTTP 400 and 1 404 from my own malformed probes (station-status without from/to, an unknown route); at least one 400 not individually attributed. No new errors on reload of Reports. |

Minor observations, not investigated: the Reason sheet's cone list names the plain "205-IL0-SD" per cone (not the distinct label); its header says 47 cones for code 10/1 while its day table says 8.

## Not verified
Live incoming data (simulator stalled), tiles following a real product change, plant PC, signed-in non-admin sessions, a person looking at the Wall.
