# Live re-check of period sub-lines, station sheet product and Weight target (15 Oct 2026)

Status: fixes committed and built; the live browser re-check was NOT done (see "Not verified").

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

## Live re-check
NOT DONE. The Browser pane opened on the sign-in page (the signed-in session did not survive the restart). Per the brief, I did not sign in. Not exercised live: Fix 1 on current shift, Today and PD1; Fix 2 on stations 10 and 13; Fix 3 on live, PD1 and PL; the regression spot checks (tile labels against SQL, reason sheet, lag sentence, replay, console). Nothing above counts as verified in a browser. The behaviour is covered by jsdom tests only (Stations sub-line for a shift and for whole days; sheet label with the full label in the tooltip and the fallback; Weight for several products, one product, none; the API row fields).

## Not verified
Live browser behaviour of all three fixes, 3 sync passes with a person looking, the plant, a signed-in non-admin session.
