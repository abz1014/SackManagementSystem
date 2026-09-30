# LIMITATIONS.md — known limitations, re-verified against current code and the defect registers

Read against `DEFECTS.md` (Parts 1–12, latest dated 29 Sep 2026), `COMMISSIONING-GAPS.md`
(corrected through 29 Sep 2026 inline), `handover/FAILURE-ANALYSIS-2026-09-29.md` and `PROJECT_STATUS.md`. Refreshed 30 Sep 2026 against the frozen source. Each item below was re-checked in
the current tree, not copied from the illustrated-guide plan without verification. Items the
plan proposed that are now fixed are dropped (see "Dropped" at the end); items found during
this pass that were not in the plan are added (see "Added").

## 1. No PLC integration
The line's `.env.example` carries a PLC block that is present but disabled: `PLC_READER_ENABLED=false`
(`sms/.env.example:203`), `PLC_HOST=10.1.1.11`, `PLC_RACK=0`, `PLC_SLOT=1` (`:204-206`). No PLC
library appears in any of the five package manifests — a reviewed convention, not a test
(`sms/DEPLOY.md:710`). Component B (direct S7-1500 PLC reader) is indefinitely deferred per
IFL's own answer (Q22); nothing reads or writes a PLC. `cone_id`/`cone_id_source` columns exist
and are nullable, a dormant re-entry point only.

## 2. Sack stock per machine is not computable
The plant's sack table carries no machine/station column, only sack number, weight, in-range
flag and insert time. The app states this on screen: "Sack stock per machine is not shown: the
plant's sack records carry no machine and no record of a sack leaving." (`sms/web/src/lib/words.ts:931`).
The Sacks screen's ledger is explicitly "line stock, not per machine" (`sms/web/src/lib/words.ts:1856`).

## 3. PDAS writes are off in production; the plant writer login is not provisioned
`PDAS_WRITE_ENABLED=false` is the real plant state (`sms/DEPLOY.md:688` area — writer login not
provisioned at the plant). Locally, all nine PDAS write rights have now been proven end to end
through the app's own code against the local `PDAS_TP1U2_SEP07` copy only (`PDAS-EXECUTION-2026-09-24.md`,
commits `58a705c`/`c21dfa9`; `sms/.env` locally reads `PDAS_WRITE_ENABLED=true` pointed at that
local copy only). The plant itself has never had a PDAS procedure executed against it. A newer
finding, RT24-05, means the write path's own post-commit verification cannot detect a real
mismatch under the plant's anticipated EXECUTE-only role and must be fixed before
`PDAS_WRITE_ENABLED` is ever set true there (`DEFECTS.md` Part 6/Part 7, `COMMISSIONING-GAPS.md` §4).
Since 29 Sep 2026 a limits edit that moves a target by more than 3 % or a limit by more than 20 g
is refused unless the engineer ticks a confirmation box and writes a reason of 20+ characters, and
the edit is a two-step review. Those two numbers are the developer's own, not IFL's
(`PDAS_LIMIT_MAX_*` in `sms/.env.example`). Still open: who at IFL may write, whether that needs a
higher permission than the engineer role (F-20), and how a changed limit reaches the machine (F-31).

## 4. A changeover does not select the product on a machine
`POST /api/changeover/execute` only makes a product selectable in PDAS; it never writes to a
machine. Every response carries `reachesMachine: false` and an operator sentence saying so
(`sms/api/src/routes/changeover.ts:18-30`, comment block above `executeChangeover`'s disabled
branch). Whether the PLC reads limits live at all is still an open question for IFL.

## 5. The ~18-minute acquisition lag
IFL's acquisition layer writes a cone's row about 18 minutes after the cone is weighed (909 s
min, 1090 s mean, measured over 142,509 rows) — `sms/DEPLOY.md:144`. The app judges "now" as
`now − measured lag`, not the wall clock, and states the lag on screen; a healthy line's newest
reading is still always some minutes old.

## 6. Two separate clocks
Production timestamps are the plant's own wall clock labelled UTC; app-written instants (product
timeline, rules, adjustments, sync runs) are genuine UTC — about five hours apart on this plant.
`sms/api/src/services/plantClock.ts` names and separates them; never compare the two unconverted.

## 7. Planned breaks and faults cannot be told apart
The app states this directly: `W.report.timeLostCaveat = "planned breaks and faults cannot be
told apart in the data"` (`sms/web/src/lib/words.ts:922`). Time-lost/stop-count figures on the
Report screen carry this caveat; no downtime reason code exists in the source data.

## 8. The July–August 2026 data gap is real and not yet supplied
`DATA_TP1U2.pack1_TP1U2` (July sample) ends 2026-07-10 11:23:10; `DATA_TP1U2_SEP07.pack1_TP1U2`
(September sample) starts 2026-08-05 — a 26-day gap that exists only at IFL, confirmed by direct
query of both attached copies (`CLAUDE.md`, "AddTubeType's parameter signature confirmed" section,
21 Sep 2026). Asking IFL for it (Q56) remains open; nothing in this codebase substitutes for it.
A tool to load the gap once it arrives now exists (`sms epoch:backfill`, 29 Sep 2026); it was proven
only on scratch database copies, never on IFL's real archive, which has not been sent
(`handover/R17-SCRATCH-RUN-2026-09-29.md`). A new read-only DQ check, `isolated_production_day`, now flags a shift_date that could plausibly
sit inside this kind of gap as a WARNING rather than silently counting it as ordinary data
(`sms/sync-worker/src/transform/isolatedDay.ts`, `DEFECTS.md`, `COMMISSIONING-GAPS.md` §2) —
flagged rows are still counted, not excluded.

## 9. One line served per API process today
`sms/DEPLOY.md:393` area: "The API serves one line per process today (`LINE_ID`); serving several
lines from one API is Phase 1 follow-on work that waits on IFL's answer" (Q14, single vs
multi-line, still pending).

## 10 GB SQL Server Express cap
The app database and its sidecar copies run on SQL Server Express, which caps a single database
file at 10 GB. Health reports the current size against this cap and raises a `database_size`
WARNING past 80% (`sms/DEPLOY.md:582` area). How long readings are retained against this cap is
still IFL's decision to make (`sms/DEPLOY.md:614` area) — readings and `sms.audit_log`/
`sms.product_change` are never pruned by the `retention` command; only `sms.sync_run` (default
90 days, newest row per line/table always kept) and non-CRITICAL `sms.dq_finding` rows (default
365 days) are.

## 11. Nelson rules 2–8 are deliberately withheld
Rule 1 (the I-MR band) and the station-vs-line-and-target table are the calibration signal the
app shows. Rules 2–8 were evaluated (real X̄ control limits, then an EWMA drift signal at two
granularities) and both were rejected by measurement, not by oversight: EWMA flagged 27.9–68.2%
of 15-minute subgroups and still missed an injected drift at daily/per-station granularity,
because the weight level is autocorrelated (lag-1 0.713 July / 0.517 September) — `DEFECTS.md`
RT-019 resolution, 25 Sep 2026 (owner-delegated decision). `W.weight.patternsWithheld` states
this on screen.

## 12. Weight basis and the shift rule are not confirmed by IFL
`WEIGHT_BASIS=as_recorded` (`sms/.env.example:195`), `CONE_TUBE_WEIGHT_G=70` (`:196`,
a developer placeholder), `SACK_TARE_KG=0.5` (`:197`), `SHIFT_MODE=corrected` (`:199`),
`SHIFT_NIGHT_BELONGS_TO=start_day` (`:200`). A single `basis` setting on `sms.weight_rule`
(`as_recorded|gross|net`) governs both cone and sack weights, but IFL's 15 Sep answer (Q24) was
about sacks only; at `gross` the conversion is the identity for cones (tube weight only
subtracted under `net`), so no number is wrong today, but a future `net` selection would apply
an unconfirmed placeholder tube/tare weight to every cone figure (`DEFECTS.md` D-13, LOW, open).
The app states "Weight basis is unconfirmed (Q4/Q5)" wherever this matters.

## 13. No email alerting on an air-gapped host
The plant PC has no internet; email alerting is not possible. `/api/health` is meant to be
polled by whatever monitoring tool the plant already runs (a scheduled `curl`, a PRTG/Zabbix
HTTP sensor) — `sms/DEPLOY.md:582` area.

## 14. Retention of raw and canonical readings is undecided
Same citation as item 10: `sms/DEPLOY.md:614` area states this is explicitly IFL's decision,
not yet made; at the measured accumulation rate (~1 GB/year) it is not urgent but remains open.

## 15. Reports "with graphics" — requirement gap
Tracked as a requirement gap in `PROJECT_STATUS.md`, not a code defect (`DEFECTS.md` D-6):
what exists is PDF/CSV/Excel export with tables and charts server-rendered into the PDF; IFL's
Q30/Q36 answer ("Excel + PDF reports with graphics") governs the acceptance bar for this, tracked
there rather than duplicated here.

## 16. Rank/route cross-check coverage is partial
The mechanical client/server rank cross-check (`web/src/rank.crosscheck.test.ts`) covers only
about 6 of roughly 25–32 elevated-rank routes; the rest are verified by reading, not by an
automated guard (`DEFECTS.md` RT-026, open).

## 17. No off-machine backup of IFL's data
Both client data samples and every copy of this deliverable live on a single laptop (one
building, one machine, second physical disk counts as no off-site copy) —
`COMMISSIONING-GAPS.md` §1, `ROADMAP-GAP-ANALYSIS.md` §14. This is an operational risk for IFL
to accept or remedy before go-live, not a code defect.

## 18. PDF/print layout has a real harness now but has not observed a signed-in session
A real browser/layout harness exists (`sms/playwright.config.ts`, `layout-tests/`), but every
case needing a signed-in session is currently skipped for want of owner-supplied credentials —
reachable, not yet proven end to end (`COMMISSIONING-GAPS.md` §4).

## 19. The viewer (rank 1) role has never signed in on a live instance
Rendering at rank 1 is proven by `web/src/rank.matrix.test.tsx` against a faked `/api/auth/me`;
nobody has actually authenticated as a viewer against a running instance. Needs Q65-70 and an
IFL-created account.

---

## Dropped from the plan's draft list (fixed since it was written)
- **"No confidence interval on the days-to-limit projection"** — fixed 25 Sep 2026, `b182297`
  (RT-020); the figure now carries a 90% interval and says "not established" when the interval
  spans zero. Not a current limitation.
- **"MachineProduct report clips on screen"** — fixed 25 Sep 2026, `fb9fd9d` (RT-017); the table
  now transposes and scrolls inside its own box with sticky header/column. Print-only clipping
  was separately handled by suppressing the on-screen table in print (UX Phase 9); this pass
  found no remaining clipping defect.
- **"A retired product renders as the live target with no marker"** — fixed 25 Sep 2026, `c52a34d`
  (RT-018); `(retired in PDAS)` now appears wherever a retired product is shown as target or
  running.
- **"Health/Bar/Wall can show a false all-clear"** — fixed 25 Sep 2026, `5b2b56a` (D-30); the
  health-kind switch is now exhaustive, and an unrecognised kind reads "could not be read".
- **"A calendar-invalid date crashes the DB driver"** — fixed 28 Sep 2026, across query-string
  timestamps (`5d42cf5`), query-string dates (`11ce30b`), and the sack-stock movement form's
  `occurredAtPlant` field (`sms/api/src/services/sackStock.ts::parsePlantLocal`, `60d397f`) —
  RT-016, `DEFECTS.md` Part 9.
- **"No server-side response-size/row-count cap"** — fixed 24 Sep 2026, `855045f`
  (`sms/api/src/middleware/responseCap.ts`, wired at `app.ts:135`) — RT-014.

- **"/api/production and /api/weights have no range cap" (RT-028)** — fixed 29 Sep 2026,
  `a6afbae`; a range over 366 days is refused.
- **"/api/health can say degraded with no reason" (RT24-12)** — fixed, `45bdba8`.
- **"A stopped line and a stopped recorder read the same" (F-04)** — the wording now says the line,
  or the plant's data recorder, may have stopped (`4435e0e`).

## Added (found during this pass, not in the plan's draft list)
- Items 4, 9, 13, 14, 16, 17, 18, 19 above were not in the plan's draft list and are added with
  their own evidence.
- **RT-025** — `shift_code` is baked in at ingest time and never recomputed; a brief
  mixed-shift-rule regime was confirmed real and is not corrected retroactively (`DEFECTS.md`
  line 723, open).
- **RT-027** — a generic "Login failed" message on sign-in masks three distinct causes of a
  database-connection failure, so a plant network outage looks identical to a wrong password
  (`DEFECTS.md` line 725, open).
- **RT-031 / RT-022** — the weight and plausibility rules are still read as "whatever is current", not
  "whatever was in force". Shift-rule history was fixed for range edges on 29 Sep 2026 (`d71735a`);
  rows transformed earlier keep their old shift (RT24-04 backfill not run).
- **F-15 — backups are proven, not yet unattended.** The backup script now checks each backup and
  writes a marker so Health can say "proven restorable". It has been run by hand once. No
  unattended run has happened, the schedule is not installed, and no copy leaves this one PC.
- **F-07 — SMS shifts can differ from IFL's own screen.** SMS works shifts out from production
  time; IFL's vendor screen derives its Shift column from insert time. Reports now carry a footnote
  saying so. Which one is "right" for IFL is an open question.
- **F-38 — no refusal on a wrong time zone.** If the PC's time zone does not match
  `PLANT_UTC_OFFSET_MINUTES`, SMS warns in its log but still starts.
- **F-20 — PDAS writes use the ordinary engineer permission.** There is no separate, higher
  permission for changing product limits. IFL has not said who may.
- **A recorded weight of exactly 0.** Two real IFL rows are zero. What a zero means (scale fault
  or sentinel) is an open question for IFL, and they hold Health at "degraded" until an engineer
  acknowledges them (`IFL-OPEN-QUESTIONS.md` #16).
- **Health does not clear itself.** A known data finding stays open until an engineer (rank 2 or
  above) presses Acknowledge with a reason. Findings about the system's own state cannot be
  acknowledged.
- **Live-run gate not proven at the plant.** The go-live conditions G1–G8 and W1–W6 in
  `handover/FAILURE-ANALYSIS-2026-09-29.md` §7 are all still open; the software is ready for a
  supervised pilot, not unattended production.
