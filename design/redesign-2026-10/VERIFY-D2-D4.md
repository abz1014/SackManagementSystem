# Read-only check of station status and run start (D2b, 13 Oct 2026)

Method: the login-free harness (`withApp`, rank 1, `liveAllowSimulator:false`, `cacheTtl:0`) over the compiled `sms/api/dist`
(refreshed by `npm run typecheck`), database `sms_audit` (READ_ONLY, real data to 7 Sep 2026). Served in-process on an ephemeral
port, stopped on exit; :4000 and :5173 never contacted; no write (guard on). Scripts: scratchpad `d2b/run.mjs`, `run2.mjs`,
`sql/s14.sql`. First run of the new SQL on a real database (before: fake pools only).

## /api/station-status

| Request | Result | Expected | Verdict |
|---|---|---|---|
| 1 Sep, day | 200, 733 ms, 14 stations, line 14.57 %, thresholds `{1.5, 2, minCones 50, assumed}` | 14 stations, line 14.57 % | PASS |
| 1 Sep station 8 | 412 cones, 53.86 %, act | about 53.9 % act | PASS |
| 1 Sep station 9 | 357 cones, 23.12 %, watch | about 23.1 % watch | PASS |
| 1 Sep others | st 10 20.60 % ok, 14 17.93 % ok, 13 3.66 % ok, 1-2 about 1 % ok; 3-7, 11, 12 zero cones -> nodata | | consistent |
| 5 Aug - 7 Sep | 200, 2,495 ms, 14 stations, line 4.59 % (the September reject-rate figure in CLAUDE.md); act: 8 (14.53 %), 10 (11.22 %), 14 (11.69 %) | | PASS |
| 1 Sep + shift=evening | station 13: 7 cones, 0 %, `ok`, "Too few cones to judge (under 50)" | small-n not escalated | PASS (floor seen on real data) |
| 1 Sep + shift morning / night | all stations at or above 75 cones, floor not triggered; judged normally | | n/a |
| `tsTo` supplied | 200, ignored | route does not accept it | as designed |

Over the 34-day range, stations 3-7 and 11-14 have `vsTargetG: null` (several materials in the period, no single target); the period
rows are as `weightStations` defines them. Product label on every row is the line product "201-IH0-SD".

## /api/machines/running (runStartUtc / lastChange, a1de873)

| Case | Result |
|---|---|
| Live scope, asOf 7 Sep 12:00:28 | 200. Winders 4, 5, 11, 12, 13 report a `lastChange` with a time, previous material and name; 13 changed 1022 -> 20 at 10:37:10 (the first cone of its window, `runStartIsLookbackLimit:false`). Winders 1, 2, 6 have no change in the lookback: `runStartUtc` is the first cone in the lookback and `runStartIsLookbackLimit:true`. Silent/stale/quiet winders: `runStartUtc: null`. |
| Replay `at=2026-09-01T23:00:00Z` | The server clamped asOf to the newest cone before it (21:53:27). Station 14: material 1022, `sinceUtc` 20:56:41, `runStartUtc` 2026-08-19T02:33:56 with `runStartIsLookbackLimit:true`, `lastChange: null`. |

Independent check of station 14 (SQL, real epoch 9, `sms_audit`): material 1022 is stamped on every cone from 2026-08-19 02:33:56
through 1 Sep with no material change. So `lastChange: null` is CORRECT and the expectation "station 14 change at about 20:56 on 1 Sep"
does not hold for the data: 20:56:41 is the first cone of the current stretch inside the 2-hour window (`sinceUtc`), not a product
change. Treat `sinceUtc` (window-based) and `runStartUtc` (product-run based) as different facts on screen.

## Findings and cautions

1. Station 14 expectation above was wrong, not the code (verified by SQL).
2. Epoch 13 (simulator) mixes into any query that does not scope the generation; raw SQL on `sms.cone_event` without `source_epoch`
   shows stations flipping between 1022 and 1024. The API's `bindCone` scoping is correct (the figures above are real-generation only).
3. `runStartIsLookbackLimit:true` is common (winders 1, 2, 6 live; 1, 2, 8, 9, 10, 14 in the replay): the screen must word it as
   "since at least ...", never as a start time.
4. Replay clamps asOf to the newest cone at or before the instant (21:27:13 for a 21:30 request).
5. Not verified: live running data (snapshot ends 7 Sep), plant, any screen.
