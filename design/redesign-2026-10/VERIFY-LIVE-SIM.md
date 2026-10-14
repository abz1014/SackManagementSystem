# Live simulator check of the new app (14 Oct 2026)

Run in the owner's signed-in admin session (rank 4) in the built-in browser pane, `http://localhost:4000/next/` and the old UI at `/`, against the plant simulator (`DATA_TP1U2_SIM`, `LIVE_ALLOW_SIMULATOR=true`). Times are the dev PC clock, which equals plant time (UTC+5). Nothing that writes was clicked, no export was downloaded, nobody was signed out, the API (PID 30892) was never touched. Working notes: `scratchpad/simtest/pane/` (`phase1-before.txt`, `phase3-notes.txt`, `phase4-notes.txt`, `phase5-notes.txt`).

## Before (14:25, simulator just started)
Today: "Line status unknown: no data since 21:05", newest data 29 Sep 2026 (14 d 17 h old), chip "Data out of date". Old Line: "Cannot tell whether the line is running", 0 cones, newest reading Tue 29 Sept 9:05 PM. Wall: first read was still "Loading" (not captured).

## Phase 3 (catch-up flag at 14:28:22, run 14:29 to 14:57)
| Check | Result | Evidence |
|---|---|---|
| 3a Today Running, figures move, compare | PASS, with a note | "Line 3 is running. No station needs action." Cones 49 / 54 / 58 / 68 / 84 / 88 at 14:30 to 14:36, sacks 8 to 9. `cmp=prev`: "97.8 % so far vs 2,432" cones, "91.8 % so far vs 97" sacks, kg and fail-rate deltas. NOTE: the Today page itself does not state the acquisition lag; only the Wall footer does ("they reach this system about 34 min after weighing"). |
| 3b 14 station tiles update | PASS | Today list and Wall tiles: 14 stations, per-station cones and fail rates change between passes (Station 1: 5 to 6 cones). |
| 3c Products Board materials | PASS | `GET /api/machines/running` at 14:30: stations 1-5 = 21, 6-9 = 20, 10-11 = 1021, 12 = 1022, 13 = 1023, 14 = 1024, all running; Board "14 stations are running 6 products. None are idle." Product change is not testable from the simulator (no change in the stream). |
| 3d Wall 1920x1080 dark | PASS | Running sentence, "this board is showing the plant simulator, not the plant", Updated 14:30 to 14:32, cones 54 to 68, no "Not updating". |
| 3e Register | PASS, partial | Top cone record 1364373 (14:30:49) to 1364387 (14:33:11); newest sack 14:32:57; stock ledger 14 Oct receipts 133 (closing 17,193). Load more works on the 34-day period (100 to 200 of 132,550); the live period had under 100 rows so it could not be shown there. |
| 3f Quality refresh | PASS | Weight 84 to 88 cones in about 64 s (cone mean 1,951.5 to 1,951.7). Rejects and Stations load and update. |
| 3g Replay | PASS, with a finding | `?at=2026-10-13T15:30:00.000Z`: banner "REPLAY - showing the plant as it was at 2026-10-13 15:30:00. This is not live.", "Leave replay" link, 504 cones / 10 sacks, 3 stations to watch; leaving returns live Today with no banner. FINDING: `at` without the trailing Z (`2026-10-13T15:30:00`) gives "Couldn't load plant clock" because the API rejects it (400). |
| 3h Simulated data named | PASS | Banner "live line status comes from the plant simulator, not the plant"; Diagnostics "Practice data on this computer - Made for testing. Never counted in a report."; Reports page "This period's figures come from the plant simulator" and "Data batch: pack1_TP1U2 gen 4 (plant simulator, synthetic data)". |

## Phase 4 pause tests
1. Simulator stopped 14:37:18 (PID 1528 only). API state became `stopped` at 14:46:52 and Wall said "Line 3 has had no readings for 2 min - the line, or the plant's data recorder, may have stopped" at 14:47:07 (Today at 14:47:27), so about 9 min 40 s after the stop. Cause: the measured reading lag was 1,553 s and the stop threshold is lag + 120 s; with the real plant lag (about 19 min) it would be about 2 min earlier. HealthDot stayed "OK: Data current"; Wall never said "Not updating". Not within the "2 to 5 min" in the brief; expected from the code, but recorded.
2. Simulator restarted 14:48:03 (guarded block, new PID 27712). Running again by 14:49:07 (within 64 s, one catch-up of +72 cones).
3. Sync worker stopped 14:49:56 (PID 26612). Health went stale (age 217 s over 183 s): Today 14:52:57 "Line status unknown: no data since 14:31" with chip "Act: Data out of date"; Wall 14:52:37 "Not updating since 14:31" and footer "No new readings since 14:31 - the plant link may be down" (about 2 min 41 s after the stop).
4. Worker restarted 14:53:09 (PID 27408). Today "Line 3 is running / Data current" at 14:53:27; Wall running 14:53:37.

All four PASS. Observation: one screenshot at 14:47:52 caught the Wall tiles showing "Not available" for Cones, Sacks and Packed while stopped; a text read a moment later showed 91 / 9 / 425 kg and the API's `thisShift` was intact, so it was transient (refetch flicker), not reproduced.

End state (15:13): simulator PID 27712 (wrapper 18876), sync worker PID 27408 (wrapper 35396), API PID 30892 untouched; Today shows "Line 3 is running", "Data current".

## Phase 5 old vs new (closed day 13 Oct 2026, `p=pick&from=to=2026-10-13`)
Old Line and new Today agree on 7,464 cones, 301 sacks, 14,225 kg, 165 rejected (2.2 %), 19 scale rejects (0.3 %) and all 14 per-station cone counts (579, 532, 526, 521, 523, 565, 550, 472, 511, 514, 530, 539, 564, 538). Weight: mean 1,951 / 1,951.3, median 1,951, 0.3 % scale rejects, 7,464 readings with 1 excluded. Rejects: 165 = 149 quality + 16 weight, 93 cones on code 10/1 in both; the top-reason share differs by design (old 56 % of 165, new 62.4 % of the 149 inspection fails, and the new screen says "Together 165 of 7,629"). Sacks: 301, 14,225 kg, 47.26 kg, 98.3 %, 296 of 301, 24.8 cones per sack. Daily, shift and management-summary reports: figures, by-shift and by-day tables, notes and products-run table identical (only "Generated" differs). Live, at the same `dataAsOfUtc` 14:38:32Z: old Line "running, 57 min into the evening shift, 196 cones, 14 sacks, 661 kg", new Today "running", 196 / 14 / 661.1 kg. PASS.

## Phase 6 walk (T1-C), admin rank, default period and PL (2026-08-05 to 2026-09-07)
New app: Today, Quality (Weight, Rejects, Stations, Register x5 listings including stock), Products (Board, Changeover, Catalogue, Limits and History), System (Diagnostics, Setup, Account), Wall, sheets (station, cone, sack, reject, stock), all 18 report types on default and on PL (36 pages), PL on Today, Weight, Rejects, Stations, Register (cones and stock) and Board. Old UI: all 9 screens on default, plus Line, Weight, Rejects, Sacks, Readings and the daily report on PL. About 100 page loads. Failed requests (resource timing status 400 or more): 0 on every page. Console errors in the walking tab: 11 in total, all caused by this check's own probes (6 x HTTP 400 from `/api/live?at=` typed without Z, 4 x frame-ancestors from an iframe probe the app's CSP blocks, 1 x 404 from a wrong sack id `sack:448`; the sheet takes the record id, `sack:75352` loaded). No error from the app itself. Not exercised: the reason sheet (needs a day and a code in the link; `reason:10/1` gave "does not name a reason and a day"), Setup edits and every write control.

## Findings
1. `at` without Z on `/next/` shows "Couldn't load plant clock" (typed or old-style links only).
2. The Today page does not state the acquisition lag (Wall does); the lag shown on the Wall moved 34 to 26 to 18 min as the catch-up proceeded.
3. The station product label on Today, Stations and Wall shows 201-IH0-SD with "vs target" against it, while Board, Register and Products say 205-IL0-SD per MaterialId (the line default is used where stations ran different products); the Weight screen does say each product is judged against its own limits.
4. Stop detection takes lag + 2 min (here 9 min 40 s), by design.
5. Transient "Not available" on Wall tiles during a refetch (one screenshot).

## Not verified
Real plant data and clock, a TV, signed-in lower ranks, any write control, printing and downloads, product change (the simulator cannot make one), Urdu, a person looking at the screens (text and a few small screenshots in a 373 px pane; the 1920 view was emulated). Screenshots are kept by the harness, not copied into the repo.
