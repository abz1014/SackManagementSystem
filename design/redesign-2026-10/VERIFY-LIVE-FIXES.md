# Live re-check of the station-product and live-screen fixes (14 Oct 2026)

Environment: owner's dev API rebuilt and restarted on :4000 (old PID 30892, new PID 16948, `db=sms`, no errors),
owner's signed-in browser pane, look-only (no write control clicked). Simulator (27712) and sync worker (27408) kept running.
Plant time of checks about 16:00-16:20 (UTC 11:10-11:20). Dev PC and simulator only; not the plant.

| Item | Result | Evidence |
|---|---|---|
| a) Today lag sentence | PASS | `today-lag`: "Readings to 15:54 · they reach this system about 17 min after weighing." (feed healthy) |
| b) Each station's own product and target | PARTIAL / FAIL on the label | API returns `productBasis: own` for every station that has cones and vsTarget differs per station (live -8.0 to -10.5 g; PD1 1 Sep: S1 -4.7, S2 -7.0, S8 -3.6, S9 -5.4, S10 -7.8, S13 -7.3, S14 -5.3; stations with no cones show "No data"). BUT every label reads "205-IL0-SD": in the `sms` dev database materials 20, 21, 1021-1024 all share the description 205-IL0-SD and differ only by tube/colour (Star Green, Blue, ORANGE, CIR_RED, ...). So the tiles cannot show "Star Green / Blue / CIR_RED" with the current label source (product description). 201-IH0-SD does not appear. Also the live simulator now stamps material 21 on all 14 winders (`/api/machines/running`), not the 1-5/6-9/... split in the brief; the 1-5/6-9 split appears only in `/api/machines/running` for a historical `at`. Same on Today, Quality > Stations, Wall. |
| c) Replay | PASS | `?at=2026-10-13T15:30:00.000`: banner "REPLAY - showing the plant as it was at 2026-10-13 15:30:00", figures (504 cones, 10 sacks), no "Couldn't load plant clock". `?at=garbage`: named banner "The replay time "garbage" could not be read, so the live picture is shown...". Leave replay link returns to live (`?s=today`), no banner. |
| d) Wall 1920x1080, 70 s | PASS | 36 samples every 2 s: text length constant 879 after first paint, "Not available" never appeared, 14 tiles kept figures. |
| e) /api/live requests per 31 s | PASS | live period 3; historical period (Last month) 3. One poller at about 10 s. |
| f) Pickers "Station 5 · East Conveyor" | PASS on Weight, Rejects, Register. Reports: not checked | The Reports screen showed no station picker for the Management summary type; other report types not opened. |
| g) No "data batch" on Weight and Reason sheet | PASS | none on Weight, Rejects, Reason sheet (`reason:2026-10-13\|quality\|1\|2`). Note: the Reports screen prints its own "Data batch: pack1_TP1U2 gen 4 (plant simulator...)" provenance line. |
| h) Console errors | One 400 | One "400 Bad Request" resource error in the console. It matches my own probe `GET /api/production?groupBy=product` (invalid enum), made from the page; not seen as a screen fault. No app exceptions. |

Gate before restart: typecheck clean (shared, sync-worker, cli, api, web, web-next); vitest 472 files passed / 1 skipped, 5058 tests passed / 4 skipped, 0 failed; `npm run build` ok.
