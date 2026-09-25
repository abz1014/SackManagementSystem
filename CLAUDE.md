# CLAUDE.md — IFL Sack Management System (SMS)

## Project purpose

Build a **Sack Management System** web application for **Ibrahim Fibres Limited (IFL)**, reporting on sack and cone production from the TP1 Line 3 / Unit 2 yarn spinning line. Styled and architected to match our existing **Energy Management System (EMS)** app.

The plant runs Siemens S7-1500 PLCs that weigh every cone and every sack; readings land in SQL Server via a tag-acquisition layer. SMS surfaces that data as dashboards, reports, and (pending scope confirmation) CRUD screens.

**Primary source of truth for the data model: [`SCHEMA.md`](SCHEMA.md).** Read it before writing any query.

**Client-facing questionnaire: [`QUESTIONS.md`](../QUESTIONS.md)** — the 22 questions sent to IFL, written in plain language. *(Currently located at `Desktop/QUESTIONS.md`, one level above the project root.)* `SCHEMA.md` §4 holds the same items as technical open questions (OQ-1 … OQ-15); `QUESTIONS.md` is the shareable version. Keep the two in sync as answers arrive.

**Phase 1 scope and design: [`SPEC.md`](SPEC.md).**

**Phase 2 architecture — [`ARCHITECTURE.md`](ARCHITECTURE.md) — FROZEN BUILD CONTRACT (23 Jul 2026).** Raw→canonical layers, transform versioning, time-versioned attribution, reference-data tables, CDC-safe watermark (overlap window + schema fingerprint), DQ+Operations with severity, generalized+metadata API, CLI verify tool, retention/backup policy. Further architecture changes come from running-code evidence only. Build order: Models→Reader→Transform→CLI→Operations→API→**Dashboard (demo, step 7)**→analyses→Auth→Admin→Hardening.

**Living defect register: [`DEFECTS.md`](DEFECTS.md)** — started 22 Sep 2026, the severity-graded register `ROADMAP-GAP-ANALYSIS.md` §14 named as missing. Check it before claiming "no critical/high unresolved defects."

## Current phase

### Red-team follow-through: every remaining item closed, decided, or kitted (25 Sep 2026)

Six commits `b182297`…`39c2c37`; full record in `DEFECTS.md` Part 8. **Fixed:** RT-020
(days-to-limit now has a 90% range and says "not established" when the interval includes zero;
the old code gave 437–1,986-day figures for four real stations that the data cannot support),
RT-017 (machine-product report transposed on screen, nothing clipped), RT-018 (retired
products marked "(retired in PDAS)" everywhere they appear as target or running; live, the Sept
cone-weight report's target, product 12, is retired), and D-30 (Health's sync verdict, Bar,
Wall and `assessHealth` fell through to "OK" for `lag_unknown`/`no_data`/missing health: a
false all-clear, now exhaustive). **Decided by evidence (owner delegated):** RT-019. Nelson
rules 2–8 stay withheld; EWMA failed at 15-min (27.9–68.2% flagged) and daily per-station
granularity, because the weight level is autocorrelated (lag-1 0.71/0.52). **Closed without
code:** D-29 (1970 rows are a vendor sentinel no screen can reach). **Proven:** PDF export end
to end. **Owner must run:** `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` and
`handover/REHEARSAL-RBAC-BELOW-RANK.md`, because agents may not create logins. Suite 2,137
passed / 4 skipped, typecheck clean. Verified on the local dev copy only.

### PDAS write authority recorded; D-12 resolved (24 Sep 2026)

Hassan sb of IFL gave the SMS project owner a written grant by WhatsApp on 19 September 2026 ("complete autonomy and permission to enable and work on the PDAS changing the DB"), by the project owner's statement covering all nine write rights, for both the local copy and the plant. The message itself is held by the project owner, not in this repo. See `DEFECTS.md` D-12 and `handover/PDAS-WRITE-GRANT-2026-09-19.md`. This does not turn the plant path on: `PDAS_WRITE_ENABLED=false` in `sms/.env`, and the gate is now the local end-to-end proof (all nine rights through our code against `PDAS_TP1U2_SEP07`, with backups, failure paths, and an EXECUTE-only "ibrahim"-shaped login rehearsal), not IFL's authority. See Phase 1 hard constraint 3 below for the full detail.

### Retire-and-recreate resolved by execution; PDAS error-code attribution corrected (23 Sep 2026, WS-PDAS2)

Second authorised PDAS execution pass, same protocol and same boundary as the first
(`PDAS-EXECUTION-2026-09-23.md`, commit `f5ac691`, appended to by this pass): **only
`PDAS_TP1U2_SEP07` on `.\SQLEXPRESS`**, never the plant, never `.env`, never
`PDAS_WRITE_ENABLED` (stays `false`), no login created. A fresh backup was taken and its
restorability proven into a scratch database (row counts matched exactly) before any write;
the live copy was restored from that same backup afterward and re-verified to match the
pre-execution counts exactly (Materials 24/max 1024, Blends 10, Counts 14, TubeTypes 27,
Pallets 25, nhs_events 3631/max 23445, before and after).

**The last unanswered question from the first pass is now answered: retire-and-recreate does
NOT work, confirmed by execution, not just by reading the proc body.** Sequence run:
`CreateMaterial(Blend=2,Count=3,Tube=4)` → success, `MaterialId=1025`. `SetMaterialStatusActive
1025, 0` (retire) → success. `CreateMaterial`, same `(Blend=2,Count=3,Tube=4)` triple again →
**refused, `@error=-7001`, `@errorMsg='Material already exist'`, no row inserted** — identical
refusal to a non-retired duplicate. `SetMaterialStatusActive 1025, 1` (reactivate) → success.
This matches `CreateMaterial`'s own body exactly (`IF NOT EXISTS (... WHERE BlendId=@b AND
CountId=@c AND TubeTypeId=@t)` — no `MaterialActive` term anywhere in the check) and matches
what IFL's engineer hit on 18 Aug 2026. **Consequence for Changeover:** the screen must never
offer "retire then create the same blend/count/tube again" as a way to change a setpoint —
it cannot work, by the vendor's own design, active or not. The only path for a genuine setpoint
change is the guarded single-row `UPDATE dbo.Materials` this codebase already uses for
"change limits" (`pdasWrite.ts`), not a retire+recreate round trip. **IFL needs to be told this
directly**: their engineers' own instinct (retire, then recreate with a new number) is exactly
the operation this proc refuses, and the working alternative is "edit the existing material's
limits", not "make a new one."

**Error-code attribution, restated plainly (the first pass already established this; repeating
it here because two places in this file still say something that reads as a live conflict when
it is not one):** `-5001`/`-5002`/`-5003` belong to `AddTubeType` (duplicate name+form / invalid
form / invalid weight). `-7001` belongs to `CreateMaterial`'s duplicate-triple refusal — the
same code `SetMaterialStatusActive` also happens to reuse for "no such MaterialId". These were
never in conflict; they are different procedures' own codes, both correct, both now observed
firing by direct execution (this pass and the first PDAS-execution pass together).

**Finding H6, closed.** The 15 Sep 2026 audit's "unverified" verdict on the 18 Aug 2026 incident
was right about the screenshots (ten SSMS screenshots at `Desktop/SPS unzip/SPS/*.jpg` show no
error — `@error`/`@errorMsg` = `NULL`/`NULL` on every call they capture) and wrong to conclude
from that alone that the incident itself was unverified: the errors went to `nhs_events`, not
the grid the screenshots show. `nhs_events` EventIds 23204/23206/23207/23208 (in the archive
already on disk, `PDAS_TP1U2_SEP07`) record four `CreateMaterial` `-7001` refusals at
2026-08-18 10:35–10:41, bracketed by `SetMaterialStatusActive` calls retiring MaterialId 1022
at 10:39:01 and reactivating it at 10:43:17 — i.e. IFL's engineer tried exactly the
retire-then-recreate sequence this pass just reproduced, and it failed the same way. Say both
halves when citing this: the screenshot-based verdict was correct about what the screenshots
show; the incident itself is now fully verified, by both the event log and by reproducing it.

**A vendor logging bug, confirmed independently by both PDAS-execution passes:**
`CreateMaterial`'s own `nhs_events` info row reads `'Create new MaterialId: ' +
CAST(@blendId AS NVARCHAR)` — it logs `@blendId`, not the real `MaterialId` (the `SCOPE_IDENTITY()`
value returned via `@materialId` OUTPUT and `RETURN`). In this pass's Test A, `MaterialId=1025`
was created with `@blendId=2`, and the log line reads `'Create new MaterialId: 2'`. Anyone
auditing PDAS activity via `nhs_events` text alone, rather than the real OUTPUT/return value,
will misattribute created rows whenever `BlendId != MaterialId` — true for effectively every row.

**Corrected here, and now no longer true anywhere else in this file that repeats it:** the
statement **"no PDAS procedure has ever been executed against any database, local or plant"**
is **false as of 23 Sep 2026** and must not be repeated as current fact. Two authorised passes
this date executed `AddTubeType`, `CreateMaterial` and `SetMaterialStatusActive` — always
against `PDAS_TP1U2_SEP07` on `.\SQLEXPRESS` only, always from a proven-restorable backup, always
restored to the exact pre-execution state afterward, always by hand via `sqlcmd -E` under the
current Windows identity — **never** through `sms_pdas_writer`, `pdasWrite.ts`'s own connection
path, `PDAS_WRITE_ENABLED` (still `false`), or against the plant. Below, wherever this file still
reads "no PDAS procedure has ever been executed", read it as describing the state before 23 Sep
2026's two execution passes, not the state today.

**What `sms/api/src/services/pdasWrite.ts` still needs, reported but not edited this pass**
(it is production code; this was a documentation pass): its file header (~line 85) and the
`PROC_PARAMS` comment (~line 162) both still say "no PDAS procedure has ever been executed
against any database" — both need the same correction as above, citing this section and
`PDAS-EXECUTION-2026-09-23.md`. Everything else in that file's error-code attribution
(`-7001` → `CreateMaterial`, `-5001`/`-5002`/`-5003` → `AddTubeType`) was already correct before
this pass and needs no change.

**What still requires the plant, unchanged by this pass:** concurrent/production-load behaviour;
whether the live PDAS's current `MAX(id)`s or schema have drifted since the 7 Sep 2026 export;
whether `sms_pdas_writer` (not yet created) or `pdasWrite.ts`'s own connection path would behave
identically to this pass's `sqlcmd -E` calls; whether IFL's own operational process depends on
`nhs_events`' mislabelled MaterialId text. `PDAS_WRITE_ENABLED` remains `false`; none of this
pass's findings change the fact that all nine write rights still await IFL's written authority.
**(Superseded 24 Sep 2026: written grant 19 Sep, see D-12.)**

### Red-team audit and its 15-commit remediation wave (23 Sep 2026, later the same day than the entry below)

`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md` (commit `d2cba5e`, 13 workers) found **8 CRITICAL
findings (RT-001…RT-008)** plus 28 more HIGH/MEDIUM/LOW, against the tree the entry
immediately below this one had already produced — with the suite green (1660/4/0) and
typecheck clean through every one of them. A fifteen-commit fix wave followed
(`016a047`…`cf1c363`). Full disposition of every RT- finding, and nine further defects found
*during* the fix wave that are not in the audit itself, are in `DEFECTS.md` Part 4 — this
entry states only what changed and what did not.

**What changed.** Almost every canonical-table query across production, weight, reject,
register and report services now resolves one source generation and states what it excluded,
closing most of the root cause behind RT-001–013/029/032 (Line/Rejects/Report disagreeing on
the same period's reject rate; a station-report row with more within-tolerance cones than
cones produced; a daily report inflated ~29× by pooling the local dev sidecar's plant-simulator
generation with IFL's real one). A field silently stripped from an otherwise-200 response can
no longer render as a confident zero anywhere it was checked — Line, Weight, Rejects, Wall,
Sacks, Calibration (RT-005/012/013/033). The false "stopped" state from a zero-lag sample and a
1970 clock-fault sentinel hijacking three anchor queries — one more than the audit's own text
named — are both closed (RT-006/021). Line's own provenance banner can no longer call
simulator figures real (RT-007).

**What did not change, named rather than implied.** RT-014 (no server-side
response-size/row-count cap independent of SQL) is untouched by any of the fifteen commits —
this is the one finding that kept Phase 11 (Security & operations) from returning to COMPLETE
in `PROJECT_STATUS.md`; see that file's phase board. RT-016 (an invalid calendar date crashes
the DB driver), RT-017 (MachineProduct's on-screen column clipping — distinct from this file's
own Phase 9 entry below, which suppressed it only in *print*), RT-018 (a retired product shown
as the live target with no marker), RT-020 (no confidence interval on the days-to-limit
projection), RT-022/RT-025/RT-026/RT-027/RT-028/RT-031/RT-034 are each confirmed still open by
reading the code, not assumed from a missing commit message. RT-019 (Nelson rules 2–8 flagging
37.6–54.8% of station-groups on real generations) stays a pending owner decision, unchanged
from `DEFECTS.md` D-10 — four options already put to the owner, none chosen. RT-024's own
finding is still true today: `sms/.env`'s comment reads "PDAS writes: ENABLED 22 Sep 2026 ...
IFL granted permission" directly above a line reading `PDAS_WRITE_ENABLED=false`, and no
document in the repository records who at IFL granted it or which of the nine write rights it
covers (`DEFECTS.md` D-12) — this is a documentation contradiction, not a live write path: **no
PDAS procedure had been executed against any database, local or plant, at the time this
red-team wave was written**, and that remained true through this wave. **Superseded later the
same day (23 Sep 2026):** see the WS-PDAS2 section above this one — two authorised passes
executed PDAS procedures against the local `PDAS_TP1U2_SEP07` copy only, then restored it; the
plant and `PDAS_WRITE_ENABLED` (still `false`) are unaffected. **(Superseded 24 Sep 2026: written
grant 19 Sep, see D-12.)**

**Suite and typecheck, measured directly this pass:** `npx vitest run` from `sms/` — **177
files passed / 1 skipped, 1745 tests passed / 4 skipped**, no red files, one run, HEAD
`cf1c363`. `npm run typecheck` (all five workspaces) — clean. The ~1-in-74 flake documented in
`DEFECTS.md` D-7 was fixed 22 Sep; today's one clean run is not proof it cannot recur.

**Verified against the local `_SEP07` + `_SIM` dev sidecar only, as every entry in this file
must now say explicitly rather than let a reader assume otherwise.** At IFL, source
generations are sequential and do not overlap in time, so most of this wave's fixes are no-ops
there by construction — several of the commits say so themselves. Below-rank RBAC remains
untested live; only an admin session exists and agents may not create logins. The branch is
**179 commits ahead of `origin/main`** and **114 ahead of `origin/floor-first-rework`**
(measured this pass with `git rev-list --count`; that remote branch was last pushed 16 Sep
2026) — both numbers superseding any earlier count in this file below.

### Rejects screen and the management summary printed different reject rates for the same period — closed (23 Sep 2026)

`api/src/services/report.ts`'s `toReportLine` (`weighed = cones + rejected`) had the same
double-counting defect `rejectSpc.ts` was corrected for earlier the same day (see
`KPI-DEFINITIONS.md` row 5's history) — a separate code path with the identical bug, flagged
but explicitly left unfixed by that earlier pass. A THIRD copy was found in `rejects.ts`'s
`getRejectsByDayCode` (the per-day-per-code breakdown behind the Reject report). Both are
fixed the same way, sharing rather than re-deriving the rule: `production.ts` now computes
`ProductionRow.unmatchedRejects` — rejects with no matching `cone_event` row on
`(production_ts_utc_ms, hanger_num)` — via a new shared `rejects.ts` function,
`getUnmatchedRejects` (built on `coneMatchPredicate`, the same merge-key check
`rejectSpc.ts` already used). `toReportLine` and `getRejectsByDayCode` both divide by
`cones + unmatchedRejects`, matching `rejectSpc.ts`'s p̄ for the same period. This closes the
divergence behind daily/product/sack reports and the management summary KPI, all of which are
built on `toReportLine`.

Re-verified against BOTH real generations via `sqlcmd -E` (read-only) before changing
anything, independent of the numbers `rejectSpc.ts`'s own header already carried: July —
2,886/2,900 quality and 244/246 weight rejects match an existing `pack1_TP1U2` row; September
— 5,933/6,049 quality and 41/41 weight. The +7 s/+31 s offset controls returned zero matches
on both generations, confirming the match is exact. `SCHEMA.md`'s `rejectWeight1_TP1U2`
section, which claimed the reject and accept streams are disjoint, is corrected in place
(dated, old claim kept, not deleted) — that claim is false by this same measurement.

**The third copy was closed later the same day (23 Sep 2026).**
`api/src/services/weightStations.ts`'s `rejectRatesByStation` — the Weight screen's own
per-station and line-wide reject rate, and `reports/station.ts`'s fallback — computed
`rejects / (cones + rejects)`, which is why Weight printed a lower figure than Rejects and
the management summary for the same period. It now calls the same `getUnmatchedRejects`.
**Per-station attribution was measured, not assumed:** an unmatched reject carries its own
`source_station`, and across every real generation on the dev copy exactly three unmatched
rejects (one per real epoch, all on the 1969-12-31 clock-fault day) carry none — excluded
from the per-station denominators, included in the line total, the same asymmetry the line
totals already had for station-less rows. Measured agreement, all three services driven
against the live sidecar: **2026-08-05 → 2026-08-20 (September generation only) — 3.40 % on
all three; 2026-06-22 → 2026-07-10 (July generation only) — 2.21 % on all three.**
`api/src/services/rejectRateThreeWayAgreement.test.ts` fails if any of the three diverges,
and was proven to fail against a deliberately reverted `weightStations.ts`.
**One qualification, by design:** `rejectSpc.ts` reports p̄ for a SINGLE source generation,
so over a window spanning the 5 Aug rebuild its figure describes one generation while the
reports and Weight describe the whole window (measured: 2.23 % vs 3.39 % over
2026-08-05 → 2026-09-07 on the dev copy, whose sidecar also holds simulator rows). Compare
the three only over a single-generation period.

A new test, `api/src/services/reportRejectRateAgreement.test.ts`, drives both `toReportLine`
and `rejectSpc.ts` against one dataset with both matched and unmatched rejects (a dataset
where every reject is unmatched, as the existing `rejectsAgreement.test.ts` uses, cannot tell
the old and new formulas apart) and fails if the two ever diverge again. Verified it actually
catches the regression by temporarily reverting the fix and confirming the test fails, then
restoring it.

`npx vitest run`: every test file this pass touched passes (151 tests across the rejects/
production/report/reportRejectRateAgreement/weightStations/reports suites); a full-repo run
was not taken because other workers were concurrently editing screens this pass does not own
(`Sacks.tsx`, `Line.tsx`, `app.css`, `spc.ts`) and one of those files was mid-edit with an
unrelated `ReferenceError` at the time — not touched, not this pass's to fix. `npm run
typecheck` (all five workspaces) clean.

**Resuming after a break? Start with [`HANDOVER-2026-09-15.md`](HANDOVER-2026-09-15.md)** — repo state, the dirty working tree, phase board, IFL's 15 Sep answers, and what to do next, verified against the running repo.

### `AddTubeType`'s parameter signature confirmed; the tube-type picker restriction lifted (21 Sep 2026)

The 16 Sep 2026 PDAS introspection task (see the file header of `sms/api/src/services/pdasWrite.ts` and its `PROC_PARAMS` comment) could not confirm `AddTubeType`'s OUTPUT parameter name because `IFL_DB_USER` — the login that script used — holds only `db_datareader` on `PDAS_TP1U2_SEP07`, which carries no `EXECUTE`/`VIEW DEFINITION` on any procedure. That gap is now closed, by a different route than the one the 16 Sep task proposed:

Querying `sys.procedures` joined to `sys.parameters` and `sys.types` on `PDAS_TP1U2_SEP07` (`.\SQLEXPRESS`) with **Windows authentication** (`sqlcmd -E`, read-only, `SELECT` only) reads the system catalogue directly and needs no `db_datareader`-level grant at all — the metadata-only grant proposed at `db/bootstrap/11_pdas_procedure_metadata.template.sql` was never the only way to get this, and that template's purpose narrows to whatever it may still do for the plant's own `sms_readonly` login; it has not been removed, and removing it is not this pass's call to make. Result, in `parameter_id` order:

```
proc_name    parameter_id  param_name   type_name  max_length  is_output
AddTubeType  1             @error       int        4           1
AddTubeType  2             @errorMsg    nvarchar   510         1
AddTubeType  3             @typeTypeId  int        4           1
AddTubeType  4             @tubeType    nvarchar   510         0
AddTubeType  5             @tubeForm    int        4           0
AddTubeType  6             @tubeWeight  float      8           0
```

This is an **exact match**, in both name and parameter order, to `PROC_PARAMS.AddTubeType` in `pdasWrite.ts` (`['error', 'errorMsg', 'typeTypeId', 'tubeType', 'tubeForm', 'tubeWeight']`). The presumed `typeTypeId` output name — guessed by analogy with the vendor's other `Add*` procedures' own typo — was correct. **What this verifies, and no more:** the procedure's *signature* — its parameter names, order, types and OUTPUT flags. At the time this section was written (21 Sep 2026) the procedure's *runtime behaviour* was still unobserved. **Superseded 23 Sep 2026:** two authorised execution passes (`PDAS-EXECUTION-2026-09-23.md`, and the WS-PDAS2 section above "Current phase") have since executed `AddTubeType`, `CreateMaterial` and `SetMaterialStatusActive` against the local `PDAS_TP1U2_SEP07` copy only — the duplicate-refusal codes are now observed firing (`AddTubeType` → `-5001`; `CreateMaterial` → `-7001`), not merely read from the proc body. The plant was never touched and `PDAS_WRITE_ENABLED` stays `false`; all nine write rights still await IFL's written authority — nothing about that changes. Reproduce this yourself with the same query before relying on it further. **(Superseded 24 Sep 2026: written grant 19 Sep, see D-12.)**

Two other points established the same day, by direct measurement rather than by inference:

- **The 10 Jul – 5 Aug data gap is real**, confirmed by querying both attached copies directly rather than by trusting the previously documented row counts: `DATA_TP1U2.pack1_TP1U2` holds 142,511 cones ending `2026-07-10 11:23:10`, `DATA_TP1U2.sack1_TP1U2` holds 5,462 sacks from `2026-06-22` to `2026-07-10`; `DATA_TP1U2_SEP07.pack1_TP1U2` holds 132,552 cones from `2026-08-05` to `2026-09-07 12:00:28`, `DATA_TP1U2_SEP07.sack1_TP1U2` holds 5,435 sacks from `2026-08-05` to `2026-09-07`. All four counts match the figures already carried elsewhere in this file exactly. The July sample's *files* on `D:\google download\` carry an 18 Jul modification date, which was worth checking in case the archive held later data than its documented contents — but the *data inside it* still stops at 10 Jul. The 26-day gap between the two samples exists only at IFL; asking for it (Q56) is not optional and nothing found today substitutes for it.
- **A related but separate document, `ROADMAP-GAP-ANALYSIS.md` §14** (its CRITICAL "Off-machine safeguarding and continuity" row), states that "the `SPS.rar` archive is no longer on disk" — that clause is corrected there today, since two original client archives (`SPS Database TP1 Line3.rar`, the July sample, and `SPS (2).rar`, the September sample with the ten SSMS screenshots) were found on `D:\google download\` on this machine. The CRITICAL risk that row exists to flag is **not** softened by that correction: `D:` is the second physical disk of the same single laptop, so every copy of IFL's data and of this deliverable is still in one building, on one machine, with no off-machine or off-site copy — see that file for the full item.

The tube-type picker on Product › Changeover (`web/src/screens/product/Changeover.tsx`) restricted the form to existing tube types only, and its explanatory string (`W.product.changeover`, formerly keyed `tubeExistingOnly`) said this was because `AddTubeType`'s parameter name was unverified. That reason no longer holds, so the restriction has been removed: the form now offers a new tube type by name (plus the weight and form `AddTubeType` also requires), the same shape Blend and Count already offered. `api/src/routes/changeover.ts`'s body schema already accepted this shape (`tubeChoice`'s `{ name, tubeWeightG, tubeForm? }` branch) and `services/changeover.ts` already called `PdasWriter.addTubeType` for it — both existed, unreachable, since roadmap Wave F. Execute is still gated by `PDAS_WRITE_RANK` and `PDAS_WRITE_ENABLED` regardless of which path (existing id or new name) a plan step took, exactly as it already gated `AddBlend`/`AddCount`; offering a new tube type is no more dangerous than offering a new blend or count.

### UX programme, Phase 9 (Print & visual polish) — CLOSES the nine-phase programme (21 Sep 2026)

Four commits on `floor-first-rework` (`c14cae0`, `99c9e40`, `a95b355`,
`08398b9`), plus a guard test committed alongside this section. This is the
last UX phase; the programme that began with Phase 2a's information
architecture on 16 Sep 2026 is complete as far as this codebase, working
against a single local dev copy, can take it.

1. **The Product screen's own composition was undersized.** `.big` is scoped
   `.sheet .big` only (`web/src/app.css:686`); outside a Sheet it is dead CSS,
   so `Running.tsx`'s product code — the fact the whole screen exists to state
   — rendered at body size, same as the label beneath it. `Catalogue.tsx` had
   the same dead class plus an inline `fontSize: '1.1em'` (~18.7px), a
   seventh type size outside the six-step ramp the 3 Sep redesign fixed at.
   Both replaced: `Running.tsx` now uses `.headline` (34px, the established
   non-h1 case); `Catalogue.tsx` uses `var(--fs-qual)`, the idiom already used
   elsewhere in the app. The tab strip gained `tight` (it lacked the spacing
   class Readings' and Weight's tab strips already carry) and its Toggle was
   wrapped in the existing `Toolbar` component so its `no-print` class hides
   it in print — before this, printing any Product tab printed the four tab
   buttons, one a solid ink pill, onto the page. Two tabs (Changeover,
   History) had duplicated the tab strip's own `first`, which zeroes the
   top border — removing it restored the hairline under the tab strip on
   those two tabs.
2. **A printed page can now state its own provenance even when the header
   fetch fails.** `Readings.tsx:253`'s Print button carries no `disabled`
   gate (unlike Report's), and `PrintHead.tsx` used to return `null` outright
   when `GET /api/reports/header` failed — so a register could be printed
   with no line, period, generated-at, operator or SMS version on it at all,
   and `reliability.guard.test.ts` had this allow-listed as "deferred to
   Phase 9" for exactly that reason. It now renders a degraded block instead:
   line, title and period from `useLive()` and the caller's own props (no
   second round trip needed), plus two sentences naming what genuinely cannot
   be stated. **It never substitutes the browser's clock for the plant's** —
   the app's own TWO CLOCKS rule — because that would print a fact on paper
   that is not true.
3. **Print CSS stopped silently clipping report tables.** `.tw {
   overflow-x: auto }` scrolls on screen; a sheet of paper has nothing to
   scroll, so a wide table's columns past the div's edge used to vanish with
   no visual cue, and no `@page` rule anywhere meant print fell back to the
   browser's own default page size. Explicit `@page` margins were added,
   `.tw` widens to the full page in print, the Calibration table's 10 columns
   were verified to go from clipped (two rightmost columns silently gone) to
   complete, and — **by owner decision, after both orientations were
   screenshotted** — reports print landscape while the Readings register
   stays portrait. Product and Station report types go from clipped to
   fitting under landscape.
4. **MachineProduct suppresses itself in print rather than clipping.** It
   renders roughly 103 columns on the dev range (one per machine, production
   day and shift) — a structural limit no orientation or type-size rule can
   fix. It now prints one line naming that the same data is in the CSV
   export, with the on-screen table itself hidden from print (`.no-print`)
   so nothing half-clipped lands on paper. Nothing on screen changed.

**A new fragility this phase introduced, not removed: the landscape rule
depends on a UI copy string.** `@page` is a document-level at-rule that
cannot be scoped by an ordinary selector, so `app.css` keys the named
`report-landscape` page off a DOM hook — `main:has([role="group"]
[aria-label="Report"])` — and that `aria-label` is rendered by `Report.tsx`
from `W.reports.selectorLabel` in `words.ts`. Edit that one copy string (for
the Urdu pass §11 already anticipates, or an unrelated tidy-up) and the CSS
selector silently stops matching: no error, no failing screen, no visible
change until someone is holding a clipped portrait printout at IFL. A guard,
`web/src/print.landscape.guard.test.ts`, now reads both sides off disk and
fails if they disagree — proven to fail on a deliberately mismatched string
and to pass once restored. The clean fix, for whoever next owns `Report.tsx`,
is a first-class wrapper class (e.g. `<main className="report">`) so the CSS
never has to key off translatable copy at all; this phase did not own
`Report.tsx`/`App.tsx`'s `<main>` and left that refactor undone.

**Recorded honestly, because this is the closing record for the whole
programme and it must not flatter what was actually verified:**
- **Nothing in this nine-phase programme has been seen by a real user on
  real plant data.** Every observation across all nine phases, including
  this one, is against the local `_SEP07` dev copy.
- **No print-pipeline verification exists, in this phase or any before it.**
  This sandbox has no real print dialog. Every print claim above — clipping,
  column counts, landscape fitting more — comes from viewport resize plus an
  injected stylesheet, cross-checked against `scrollWidth`/`clientWidth`.
  That is a simulation of print layout, not a print render, and Phase 9
  improves the print CSS without being able to prove it survives contact
  with an actual printer or PDF driver.
- **No browser or layout harness exists.** jsdom computes no layout (Phase 8
  established this and it remains true); several of the twelve acceptance
  checks below are verifiable only by a person looking at a real screen.
  Phase 9 cannot prove print stays fixed going forward, only that it was
  fixed once, observed this way, on this date.
- **Acceptance check 1 fails permanently, by arithmetic, not by oversight.**
  Line, Weight, Rejects and Report each genuinely need all six type steps —
  a headline, display figures, a qualifier, body text, captions and axis
  ticks — so "at most four of the six" cannot be met by any of them. Do not
  round this up in any future summary.
- **The twelve checks are a three-way split, not one undifferentiated
  "eleven of twelve."** Some were re-verified this phase; some are reasoned
  from code that did not change and so are assumed still true, not
  re-observed; some (3, 7, 8, 12 among them) are browser-only checks this
  programme has never had the harness to observe at all and are carried
  forward as unverified, not as passing. Say which kind a claim is; do not
  collapse the three into a single count again.
- **The rare flake Phase 8 found is still OPEN.** Roughly 1 failure in 74
  full `npx vitest run` executions, never captured with a test name. Every
  "the suite is green" claim in this programme, this phase's own 1246/4
  included, carries that caveat.
- **No viewer has ever signed in.** `rank.matrix.test.tsx` (Phase 8) proves
  rank 1 renders correctly; nobody has authenticated as one on a live
  instance. Still needs Q65-70 and an IFL-created account.
- **`sms.source_epoch.last_seen_utc` had no writer anywhere in the repo** when
  this phase was written. **Corrected 23 Sep 2026:** it has had one since
  commit `b31d574` (22 Sep) — `sync-worker/src/epoch.ts:176-180` stamps it
  once per table per pass, tested at `sync-worker/src/epoch.test.ts:112`. The
  column is still NULL on every row only because no sync pass has run since.
- **Flagged, not fixed, in this phase's own scope:** `Readings.tsx:253`
  prints while rows are still loading or failed, unlike `Report.tsx:138` —
  a real behaviour gap, deliberately left for whoever next touches that
  file rather than folded into this phase's brief.
- **Blocked on IFL, unchanged:** written authority for all nine PDAS write
  rights (`AddTubeType`'s parameter *signature* was confirmed 21 Sep 2026 —
  see the section above — but that is not the authority to call it); weight
  basis (Q4/Q5); KPI approval (Q33-37); reject-code meanings (Q10); sack
  stock per machine (still not computable from IFL's data); the 10 Jul - 5
  Aug data; the live read-only login and host (Q65-70). **(Superseded 24 Sep
  2026 as to written PDAS authority only: written grant 19 Sep, see D-12; the
  other items in this list are unaffected.)** **36 questions
  remain unsent.**
- **The branch is unpushed**, roughly 95 commits ahead of `origin/main`; CI
  has never run against it. Only the owner pushes.

Suite: **1246 passed / 4 skipped**, `npx vitest run` from `sms/`, observed
21 Sep 2026 (was 1240 at the end of Phase 8; includes this phase's own
`PrintHead.test.tsx` and the landscape guard). Typecheck (`npm run
typecheck`, all five workspaces) clean the same date.

### UX programme, Phase 8 (Testing) — a component harness exists at last (21 Sep 2026)

Six commits on `floor-first-rework` (`c827e49`, `963ecb6`, `3f2de1b`, `58644d3`,
`6bcdffd`). This phase added a test harness and 46 tests; it changed no
production behaviour — the content-hashed files in `web/dist` are unchanged.

1. **React components can be rendered under test for the first time.**
   `sms/vitest.config.ts` still defaults to `environment: 'node'` but adds
   `environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']]` — keyed on the file
   EXTENSION, not the directory, because `web/src/App.test.ts` assigns and
   deletes `globalThis.window` itself in teardown, and a directory-keyed glob
   would have swallowed it into jsdom and had it delete the real window.
2. **Three dev dependencies, in the ROOT `sms/package.json` only** (verified
   not present in `web/package.json`): `jsdom` (pinned `^26.1.0`; `30.x` needs
   Node ≥22.22 and this host runs v22.18.0), `@testing-library/react`,
   `@testing-library/dom`. `user-event` and `jest-dom` were considered and
   deliberately not added — Setup's forms and the Changeover confirm flow stay
   untested until one is.
3. **The rank-1 (viewer) rendering gap, open since Phase 5, is closed.**
   `web/src/rank.matrix.test.tsx` mounts the real `<App/>` at all four ranks
   against a faked `/api/auth/me` — no account, no database needed. All seven
   nav entries render at rank 1; Setup is absent below rank 4; five write
   controls are absent one rank below their server gate and present at or
   above it. This closes the *rendering* question only — nobody has signed in
   as a viewer on a live instance yet; that still needs Q65-70 and an
   IFL-created account.
4. **`web/src/rank.crosscheck.test.ts`** reads each write route's
   `requireRole` and asserts it against the client-side rank constant — the
   mechanical form of the 3 Sep defect where Export was offered at rank 2
   while the server gated it at 3.
5. **Phase 7's failure states are locked down**: nine two-sided cases across
   `SyncHealthBlock`, `Readings` and `Weight`, each asserting the false
   all-clear sentence is gone AND that a healthy fetch still shows the real
   value.
6. **Six drilldown hops** (`web/src/hops.test.tsx`) assert the URL and the
   destination's first request. One hop, Reading sheet → Product Catalogue,
   carries its id in the URL only, never in a request — documented in the
   file rather than given a hollow assertion.
7. **A real test-ordering defect, found and fixed**: `--sequence.shuffle`
   failed 14 of 15 runs. `api/src/routes/ops.test.ts` shared session cookies
   from `beforeAll` while some of its own tests revoke sessions;
   `api/src/app.config.test.ts` had a *different* cause — a deliberately
   stateful fake DB tolerating only one run order. Both now independent, 45
   shuffled runs clean.
8. **An unexplained rare flake remains OPEN** — roughly 1 failure in 74 full
   runs, never captured with a test name. 60 clean runs in normal order did
   not reproduce it. The one suggestive observation, `Weight.test.tsx` failing
   once under concurrent vitest load and not otherwise, is consistent with
   resource contention but is **not proven, not a capture**. Every "the suite
   is green" claim from here on carries this caveat.

Suite: **1194 → 1240 passed / 4 skipped**, 118 files, `npx vitest run` from
`sms/`, observed 21 Sep 2026.

**Not done by this phase:** Phase 9 (visual polish, the last UX phase) is
unstarted, including `report/PrintHead.tsx` (still drops its print
attribution block silently on a failed header fetch) and the Product screen's
visual pass. **Update: Phase 9 closed both — see the Phase 9 section above,
which now precedes this one.** There is still no browser/layout harness — jsdom computes no
layout, so nothing asserts layout, print CSS, or the Wall at 1920px;
Playwright is deferred by the owner and would sit on top of this harness, not
replace it. Of the 16 top-level `web/src/screens/` files, only 2 (Readings,
Weight) have a direct component test. Blocked on IFL, unchanged: written
authority for the nine PDAS write rights (`AddTubeType`'s parameter
*signature* was confirmed 21 Sep 2026 — see the dated section above the
Phase 9 entry — which does not itself grant authority to call it), weight
basis (Q4/Q5), KPI approval (Q33-37), reject-code meanings (Q10), sack
stock per machine, the 10 Jul – 5 Aug data, and the live read-only login/host
(Q65-70). **(Superseded 24 Sep 2026 as to written PDAS authority only: written
grant 19 Sep, see D-12; the other items in this list are unaffected.)**
`sms.source_epoch.last_seen_utc` had no writer anywhere in the repo
when this was written; **corrected 23 Sep 2026 — `sync-worker/src/epoch.ts`
writes it since `b31d574`, and it reads NULL only because no pass has run
since.** Verified against the local `_SEP07` dev copy only, never real plant
data. The branch remains unpushed, now roughly 90 commits ahead of
`origin/main`.

### UX programme, Phase 7 (Reliability states) — a failed fetch stops reading as "none" (21 Sep 2026)

Six commits on `floor-first-rework` (`b689e99` — a `PROJECT_STATUS.md` figure
correction, not phase work — then `1d32f02`, `e596724`, `8611d2b`, `2bcaad8`,
`48de0a7`). One defect class, closed everywhere it was found: **a failed
fetch rendering as an EMPTY or ZERO answer** — the app asserting a fact it
does not have — not new analytics.

1. **`SyncHealthBlock.tsx` never read `ops.error`** (verified in
   `web/src/screens/health/SyncHealthBlock.tsx` — it now does), so a failed
   `/api/operations` printed "None" for blocking DQ findings, "no findings
   open", and an empty per-table list: the block whose job is to report
   breakage announced all-clear while blind. It now states in words that the
   count could not be read, which is not the same as none being open. Four
   more instances of the same shape fixed on Weight, Readings, Product ›
   Running and Wall.
2. **Partial-failure naming**: where several fetches feed one statement, the
   screen now says which part failed instead of collapsing to one blanket
   error — Readings keeps its weighed total when only the reject count fails
   to load; Weight no longer lets one fetch gate the whole screen.
3. **`sms.verify_run`** (migration `039_dq_destination_and_verify_run.sql`) is
   written by `cli/src/commands/verify.ts` (one `INSERT` per run, non-fatal on
   write failure) and read, with `sms.source_epoch` and `sms.rebuild_audit`,
   by the new `GET /api/system-history` — the first screen either table ever
   reached. Health states plainly that this is the record of a manual run,
   not a live check. **`sms verify` over HTTP was deliberately not built**:
   the API has no IFL connection, the credential/host are open questions
   (Q65-70), and a route would put table scans on the live plant server.
4. **`GET /api/dq-destination`** resolves a DQ finding's `subjectRef` to its
   canonical row; both it and `/api/system-history` are rank 1 — verified: no
   `requireRole` call gates either in `api/src/app.ts`. `reject_event` cannot
   say whether a reading came from the QCS check or the weight scale, so
   those findings offer no destination link and say why, rather than
   guessing — a worker proved the danger by resolving one real `subjectRef`
   against both tables and getting two different plausible rows.
5. **Two guards, both proven to fail when the defect is reintroduced**
   (`web/src/reliability.guard.test.ts`): every `usePolling()` result's
   `.error` must be read in its own file, or carry a written
   `ALLOW_LIST`/`KNOWN_DEFECTS` entry (`KNOWN_DEFECTS` is verified empty — no
   live exception currently claimed); and the ONE AUDIENCE rule is now
   mechanical client-side — the exact set of `rank >=` read-tier gates in
   `App.tsx` cannot grow without a reviewed change to this file.
6. **A finding, not a fix**: `sms.source_epoch.last_seen_utc` had **no writer
   anywhere in the repository** — verified by grep at the time (only the
   column definition in `025_source_epoch.sql` and a read in
   `systemHistory.ts`). `web/src/lib/words.ts` says so on screen instead of
   showing bare dashes unexplained. **RESOLVED 22 Sep 2026, commit `b31d574`
   (recorded here 23 Sep):** `sync-worker/src/epoch.ts:176-180` stamps
   `last_seen_utc = SYSUTCDATETIME()` on the resolved epoch once per table per
   pass — the one place that has already proven the source IS that generation
   — with a regression test at `sync-worker/src/epoch.test.ts:112`. Both
   re-read on 23 Sep 2026 rather than taken from the commit message. The
   column is nevertheless still NULL on all rows of the dev database, because
   no sync pass has run since the fix; the two UI strings that tell a viewer
   so are therefore still correct and were deliberately left alone
   (`web/src/lib/words.ts:1195`, `screens/health/SystemHistoryBlock.tsx:57`).
   Revisit that copy once a worker has run against a database — tracked as
   D-14 in `DEFECTS.md`.

Suite: **1169 → 1194 passed / 4 skipped**, `npx vitest run` from `sms/`,
observed 21 Sep 2026.

**Not done by this phase:** roadmap Phases 8 (Testing) and 9 (Documentation/
visual polish) are unstarted. There IS a real HTTP route/RBAC harness
(`api/src/app.routes.test.ts`, `api/src/app.rbac.test.ts` — real Express, fake
pool, `node fetch`), but no browser or component harness exists for the
client: `vitest.config.ts` is `environment: 'node'`, `include` is `*.test.ts`
only, and zero of the 16 top-level files in `web/src/screens/` has a
component test (verified 21 Sep 2026).

> **Update, UX Phase 8 (same day, 21 Sep 2026):** this paragraph is now
> superseded on the harness point — see the Phase 8 section above. A
> component harness was built the same day, closing the rank-1 rendering gap
> and adding tests for two of the sixteen screens; the browser/layout gap
> (no Playwright, no layout assertions) and the PrintHead gap below remain
> open.

`web/src/screens/report/PrintHead.tsx`
still silently drops its whole print attribution block on a failed header
fetch (`if (!header) return null`) — allow-listed as a deferred, cosmetic-only
gap. Blocked on IFL, unchanged: written authority for the nine PDAS write
rights, `AddTubeType`'s parameter name, weight basis (Q4/Q5), KPI approval
(Q33-37), reject-code meanings (Q10), sack stock per machine, the 10 Jul – 5
Aug data, and the live read-only login/host (Q65-70, which is what blocks
`sms verify` over HTTP). **(Superseded 24 Sep 2026 as to written PDAS
authority only: written grant 19 Sep, see D-12; the other items in this list
are unaffected.)** **The rank-1 (viewer) UI path has still never been
exercised live** — Phase 7's guards close the client-side *gating* question
mechanically; they do not close the *rendering* one. Verified against the
local `_SEP07` dev copy only, never real plant data. The branch remains
unpushed, now roughly 85 commits ahead of `origin/main`.

### UX programme, Phase 6 (Expose backend) — Product screen, changeover UI, two readers (16 Sep 2026)

Four commits on `floor-first-rework` (`be4b9fc`, `fd85624`, `0d8b74a`, `177abc9`),
following Phase 5. Verified against the code, not against the brief that
described it: the nav bar (`SCREENS` in `web/src/ui/Bar.tsx`) has **seven**
entries — `line, readings, weight, rejects, sacks, product, report` — one more
than Phase 5's six, not eight.

1. **A 7th nav item, Product**, with four tabs (Running / Changeover /
   Catalogue / History, URL key `pt`, `running` the default). `web/src/screens/
   ProductSheet.tsx` is **deleted** and unreferenced (verified by grep); its
   line-wide product display and change form moved into `Running.tsx`, its
   PDAS catalogue into `Catalogue.tsx`. `?sheet=product:*` bookmarks redirect.
   Product › Running pivots the existing `/api/machines/running` payload by
   material; Line's own machine table was deliberately left untouched (one
   capability, one screen).
2. **The changeover workflow is reachable at last** — `?s=product&pt=changeover`
   over `/api/changeover/{refs,plan,execute}`, which existed, routed and tested
   since roadmap Wave F with no client ever calling it. Plan is rank 1 and never
   opens the PDAS writer pool; execute is `requireRole(PDAS_WRITE_RANK)` = rank
   2 and returns `503 DISABLED` while `PDAS_WRITE_ENABLED=false` (`409 BLOCKED`
   once enabled and a blocker fires) — verified in `api/src/routes/
   changeover.ts`. The screen prints the server's `disabledReason` verbatim, no
   optimistic UI.
3. **`sms.product_change` got its first reader.** `GET /api/product-changes`
   (rank 1, keyset-paged, `api/src/services/productChanges.ts`) — the table had
   two writers (`pdasWrite.ts`, `changeover.ts`) and, before this, nothing that
   read it back. Product › History renders the trail beside the product
   timeline; `outcome='disabled'` rows are labelled as attempts that never
   reached PDAS.
4. **DQ findings are listed**, grouped by `subjectTable`, on Health — the count
   was already on the wire and is now itemised, no API change.
5. **Reconciliation is on Health**, `GET /api/reconciliation`, rank lowered
   from 3 to 1 (owner decision — it is a read of SMS's own `sms.cone_event`
   aggregates, no more sensitive than `/api/production`). It is a census of
   SMS's own readings, **not** a comparison against IFL's source (`sms verify`
   is that, and has no HTTP route); a UI sentence claiming a "by source table
   and generation" grouping the endpoint does not do was removed.

Suite: **1169 passed / 4 skipped**, `npx vitest run` from `sms/`, observed
16 Sep 2026 (was 1164).

**Not done by this phase, plainly not:** reliability states (a DQ-finding →
source-table destination, source-generation history, `sms.rebuild_audit`,
archived floor, `sms verify` over HTTP), testing (there is still no automated
route/browser harness — every hop above was verified by grep, by the vitest
suite, and by hand), and visual polish of the Product screen. Blocked on IFL,
unchanged: written authority for all nine PDAS write rights, `AddTubeType`'s
parameter name, weight basis (Q4/Q5), KPI approval (Q33-37), reject-code
meanings (Q10); sack stock per machine is still not computable from IFL's
data. **(Superseded 24 Sep 2026 as to written PDAS authority only: written
grant 19 Sep, see D-12; the other items in this list are unaffected.)**
Everything above was verified against the local `_SEP07` dev copy only,
never against real plant data. The rank-1 (viewer) UI path was never exercised
live in Phase 5 or 6 — workers stayed signed in as admin and were forbidden to
create or reset accounts — so rank gating rests on code inspection and the
RBAC test, not a live viewer session. The branch is unpushed, now roughly 80
commits ahead of `origin/main`; only the owner pushes.

### UX programme, Phase 5 (Analytics) — versioned targets given teeth (16 Sep 2026)

Six commits on `floor-first-rework` (`be5ac3e` … `1f16faf`), against the specs in
`audit/IA-PROPOSAL.md` (Phase 2a) and `audit/OVERVIEW-SPEC.md` (Phase 3). This did not add
analytics; it made the §8 rule — **a reading is judged by the limits in force at its own
time, never by today's mirror** — actually hold everywhere a target is shown, and closed the
one place it didn't:

1. **The cone-weight report's figure tile stopped reading `weights.ts`'s "current product,
   right now" target** (`FALLBACK_CONE_SETPOINT_G = 1950` when none was selected) while its
   own `vs target` column, two lines away, already used the period's own versioned target —
   one report, two answers. It now takes the single target `getWeightStations()` already
   resolves for the period end (`api/src/services/reports/coneWeight.ts`'s `target` field:
   `setpointG`, `productLabel`, `inForceAtUtc`, `source: 'none'` when nothing was in force).
2. **Per-station-per-material targets.** A station that ran exactly one material in the
   window is judged against that material's own target; a station that ran more than one
   gets no number, not a blended one (`WeightStationRow.targetBasis: 'station_material' |
   'mixed' | 'line_product'`, `api/src/services/weightStations.ts`); pre-`MaterialId` July
   rows fall back to the line-wide product, marked as such.
3. **A guard test locks this down**: `web/src/targets.guard.test.ts` fails if
   `nominalSetpointG` / `nominalSource` / `FALLBACK_CONE_SETPOINT_G` leak out of `weights.ts`
   (the Weight screen's own current-product "now" stat, a written, evidenced exception) into
   any report or screen, and fails if a report payload declares a `target` field without
   also stating `inForceAtUtc` or an explicit `'none'` source.
4. Coverage-sensitive KPIs (counts) stopped being marked as a trend when the compared period
   has materially less data behind it; an explicit `KpiShape = 'total' | 'rate'`
   (`api/src/services/reports/summary.ts`) replaced a unit-string heuristic that had wrongly
   suppressed ratio KPIs (Average sack kg, Cones per sack) that aren't coverage-sensitive.
   The Pareto's cumulative line, already computed server-side, is now rendered.

Verified in this repo, not carried over from the brief: 1164 tests passed / 4 skipped (was
1138), `npx vitest run` from `sms/`, 16 Sep 2026. Typecheck and web build were not re-run in
this pass.

**Not done by this phase, and still open:** the Product nav item (Running / Changeover /
Catalogue / History) and the changeover workflow UI over `/api/changeover/{refs,plan,
execute}` — four Phase-4 drilldown hops built in `053e4de` still have no destination to land
on. Weight basis (Q4/Q5) is unchanged: the Weight headline still states mean and target as
two separate facts, never "X g below target". KPI approval (Q33-37) is unchanged: every
summary row keeps `approval: 'awaiting'`. Reject code meanings (Q10) are unchanged. No sack
tolerance exists in any IFL table. Everything above was verified against the local `_SEP07`
dev copy only, not live plant data.

### Roadmap execution — the IFL requirement (from 14 Sep 2026)

`IFL_SMS_Claude_Code_Development_Roadmap.md` is **the requirement** from IFL's
quotation document, not a proposal to be argued with: existing code is credit
toward it, and where the code differs the difference is a clarification to
confirm with IFL, never a reason to call the roadmap wrong. Three files carry
its execution and must be kept true:

- **`PROJECT_STATUS.md`** — roadmap rule 15 (completed / in progress /
  blocked / IFL dependency / test status). Update it at the end of every wave
  or phase; never mark a phase complete without it (rule 14).
- **`BASELINE.md`** — the frozen Phase 0 picture at tag `v0.1.0-baseline`
  (`a585302`); not updated.
- **`ROADMAP-GAP-ANALYSIS.md`** — verified per-phase gap analysis, the wave
  plan (§15), the defect register (§17) and the IFL clarifications (§18).

Day 0 and Wave A are done (`92df608`, `478c456`, `a473d4d` + the docs/CI
commit). Wave B onward waits on IFL answers or owner decisions listed in
`PROJECT_STATUS.md` §4–§5. Rule 17: never guess past an IFL dependency.

**Phase 0 (Database Discovery) — COMPLETE.** → `SCHEMA.md`, `QUESTIONS.md`
### September 2026 — IFL's rebuilt source, and what the app does about it (11 Sep 2026)

A second sample from IFL (`SPS.rar`, 7 Sep) showed the plant **dropped and recreated its four weighing tables on 2026-08-05**, restarting every identity at 1, renaming `Source` → `MachineNo`, and adding **`MaterialId` to every row** (populated on 100 %, joins to `PDAS.Materials`, confirmed trustworthy by IFL). Three things followed, all built and verified:

1. **Source generations ("epochs").** `sms.source_epoch` names each physical generation of each source table; the worker resolves its generation before every read and **halts** on an unknown one (`sms epoch:accept` registers it — never automatic). July's 142,511 cones and September's 132,552 coexist under different epochs. The sidecar is the archive of record; IFL keeps about a month. **`sms verify` reconciles per generation to the checksum (`SUM(id)`).** Full record: `SEPT-2026-EPOCH-DECISION.md`.
2. **Product attribution is real.** `NullAttribution` is retired for rows that carry `MaterialId` (`attribution_method = 'source_column'`); older rows keep `'none'` honestly. Limits are **time-versioned** (`sms.product_limit_version`): a reading is judged by the limits in force at its own time, never by today's mirror. Up to six materials run concurrently on different machines, so the line-wide "Current Product" is now only the fallback for pre-`MaterialId` rows.
3. **The PDAS write path exists and is OFF.** Add / Retire / Change-limits, through the vendor's own procs (there is no UPDATE proc; changing a setpoint is one guarded single-row UPDATE with the vendor's own event-log row), rank ≥ 3, `PDAS_WRITE_ENABLED=false`, a **separate** writer login. It stays off until IFL confirms **in writing** that SMS may write to PDAS — the read-only rule for `DATA_TP1U2` is unchanged. Retire-and-recreate is **not** an edit: `CreateMaterial` refuses a duplicate blend/count/tube regardless of active flag (IFL's own engineer hit this four times on 18 Aug). **Finding H6, closed 23 Sep 2026 (see the WS-PDAS2 section under "Current phase"):** the 15 Sep 2026 audit's "unverified" call was right about the ten SSMS screenshots at `Desktop/SPS unzip/SPS/*.jpg` (they show no error — every call shown returns `@error`/`@errorMsg` = `NULL`/`NULL`, because the errors went to `nhs_events`, not the grid) but wrong to conclude the incident itself was unverified. `nhs_events` EventIds 23204/23206/23207/23208 record the four `-7001` refusals at 10:35–10:41 on 18 Aug 2026, bracketed by `SetMaterialStatusActive` retiring and reactivating MaterialId 1022 — i.e. the engineer's own attempt at retire-then-recreate. A 23 Sep 2026 execution pass against the local `PDAS_TP1U2_SEP07` copy reproduced the identical sequence (create → retire → recreate same triple → **refused, `-7001`, no row inserted** → reactivate) and confirms it: retire-and-recreate cannot work, by the vendor's own uniqueness check, which never references `MaterialActive`.

**Still to ask IFL for:** the 10 Jul – 5 Aug data (exists, not sent); `db_datareader` on both DBs; written authority for PDAS writes; whether the PLC reads limits live. **(Superseded 24 Sep 2026 as to written PDAS authority only: written grant 19 Sep, see D-12; the other items in this list are unaffected.)**

**Phase 1 — COMPLETE (build steps 0–13 done & verified).** Full stack under `sms/`: sync-worker (IFL→raw→canonical, continuous self-healing loop) · CLI (sync/verify/summary/rebuild/user:create) · Express API (auth, RBAC, /production, /operations, /shift-analysis, /rejects, /weights, admin) · React web (Dashboard, Shift, Rejects, Weights, Admin, login, Current Product). 31 app tables after 27 migrations (27 `sms.*` + 4 `sms_raw.*`; this line used to say 25, and README said 21 — both were wrong), session-cookie auth (argon2), 266 tests in 28 files (the "17 tests" this line carried was Phase 1's count), perf 11–15ms. Deployment: `DEPLOY.md`. All four blocked client questions (Q1/Q4-5/Q7/Q10) resolved or self-answering + one admin action from applying. **Awaiting IFL answers + go-live cutover — which is repointing `IFL_DB_*` *plus* `sms epoch:accept` for the live generation; "repoint and nothing else" stopped being true on 5 Aug 2026.**

### Visual redesign applied from the design handoff (3 Sep 2026)

A second, purely visual pass, delivered by the designer as
`Sack Management System Redesign.zip` and applied in full. It changed no
route, API, query or metric, and renamed nothing. Sources kept in
`design/handoff-2026-09-03/`.

**What changed.** `web/src/app.css` was replaced by the bundle’s production
stylesheet (eleven marked edits). **Instrument Sans** variable, self-hosted at
`web/public/fonts/InstrumentSans-Variable.woff2`, replaced Archivo — one file,
weights 400-700, and the plant PC has no internet, so a Google Fonts link
would silently fall back to Segoe UI on the one machine that matters. New
display step at 56px so a shift’s output outranks the sentence describing it.
Block labels hang in a 180px left margin; rules are carried by full-bleed
bands, so a hairline reaches both bezels while text stops at 1100px. Report
gained the **verdict mark**, the one ink fill in the application. Wall was
rebuilt as a composed board: stations encode their count as bar height, the
state sentence is 79px at 1920, and the footer is pinned.

**Three defects found while applying it, and fixed:**
1. `.h2 .note` in the bundled CSS could never match a grid item, so every
   block’s note overprinted its own label. The selector was extended and the
   declarations left untouched; both changes are marked in `app.css`.
2. The same rule’s `-1.5em` then placed the note a line too high once it was a
   real grid item.
3. The register’s Export button was offered at rank 2 while the server gates it
   at 3 — a control that could only ever answer 403. `EXPORT_RANK` now matches
   `requireRole(3)`.

**The twelve acceptance checks live at `design/handoff-2026-09-03/README.md:623-655`,
not in `REDESIGN.md`** (`REDESIGN.md` describes the audit and the chosen
option; it contains no numbered checklist — verified by grep, zero hits for
"acceptance check" in that file). An earlier version of this section pointed
readers at `REDESIGN.md` for them; that pointer was wrong from the day it was
written and is corrected here.

**Eleven of the twelve acceptance checks pass, verified in the browser.**
Skeletons were added to every block so nothing changes height as it lands
(check 9): the figure, chart and station skeletons match their real boxes
exactly — measured 90/90, 250/250 and 86/86. **Check 1, at most four of the
six type steps, is the one that cannot pass**, and it is unreachable by
arithmetic rather than by oversight: the spec’s own Line, Weight, Rejects and
Report compositions each need a headline, display figures, a qualifier, body
text, captions and axis ticks, which is all six. The one avoidable size — a
30px inline on Weight — is gone, replaced by the `.fig-val.small` class the
bundle ships for exactly that case.

**Four corrections to the bundled CSS, each marked in place in `app.css`:**
`.h2 .note` could never match a grid item, so every note overprinted its own
label; its `-1.5em` then over-corrected once the note was a real grid item;
`.skel.fig` summed the note’s font size rather than its line box, so it
under-reserved by 9px; and `.bars` reserved about 340px of fixed columns
before the bar, so “reasons as horizontal bars” rendered with no bars once the
spec’s own two-column Rejects layout put them in a half-width column.

**Two conformance fixes in the app.** The station cell now always renders
`.st-tag`, the reserved line the spec asks for so the row does not reflow as a
station goes quiet; it was rendered only WHEN quiet, which caused the reflow
the rule exists to prevent. Both trend charts now choose a tick count that
fits their width, after the narrower Rejects column made four hardcoded labels
overprint each other.

**Open question 4 is resolved as its own recommendation suggested:** the report
CSV carries attribution in the filename and in trailing rows after a blank
line, never as a comment header, which Excel shows as a mangled first row.

### UI redesign — BUILT AND LIVE (3 Sep 2026)

The floor-first rework below did not cure the interface; the owner's verdict
after a day of point fixes was "unusable". A three-agent audit plus two
adversarial critics produced **[`REDESIGN.md`](REDESIGN.md)** and a mockup;
the owner chose **Option A** and the redesign was built the same day.

**What the app is now.** One slim top bar — SMS, then Line · Readings · Weight
· Rejects · Report — one global period control, and one sentence about how old
the data is. Seven screens, each answering one question, under
`web/src/screens/`; shared pieces under `web/src/ui/`; the rules that must not
differ between screens under `web/src/lib/`. The 7,400-line `App.tsx`, the icon
rail, the section column, the "Light Steel" stylesheet, the floor and wall
screens and the three endpoints no requirement asks for (`/api/oee`,
`/api/shift-analysis`, `/api/stoppage-patterns`) are **deleted**, not unrouted.
Net: 8,058 lines added, 10,375 removed.

> **Update, UX Phase 6 (16 Sep 2026):** the nav bar now has **seven** entries —
> Line · Readings · Weight · Rejects · Sacks · **Product** · Report — `SCREENS`
> in `web/src/ui/Bar.tsx`. Product is new (see the dated section above); the
> other six are unchanged. Do not read this paragraph's "six" as current.

**Rules the code now enforces, each of which was a real defect before.** Do not
undo any of these without reading why they exist:

1. **ONE STATUS VOCABULARY.** The scale's own in-range bit is the single flag,
   named as the scale's ("Passed" / "Rejected by the scale"). The product's
   tolerance is a SECOND, separately-named fact, shown only when a product was
   in force at that reading's time — `api/src/services/productAt.ts`. The old
   app applied today's tolerance to readings weeks old and printed a difference
   that meant nothing.
2. **TWO CLOCKS, NAMED.** `api/src/services/plantClock.ts`. Production
   timestamps are the plant's wall clock labelled UTC; app-written instants
   (product timeline, rules, adjustments, sync runs) are genuine UTC. They are
   five hours apart on this plant. Never compare them unconverted.
3. **THE DETECTORS IGNORE THE PERIOD.** Station drift, the attention list and
   reject episodes run over a fixed 14 production days (`lib/period.ts`
   `trailingWindow`), because the pattern tests need consecutive DAYS and one
   shift is a single point.
4. **THE HEALTH DECISION IS SERVER-SIDE AND MEASURED.** `live.ts` reports the
   sync cadence it observes, freshness from the OLDEST source table (not the
   newest — one dead feed used to hide behind three healthy ones), and the lag
   as measured up to a day. When it is not `ok`, no screen asserts whether the
   line is running.
5. **NO OVER-CLAIMING.** No "reduce station 7 by 9 g": weighing data cannot
   tell a heavy scale from heavy cones. No product limits without a product.
   The Weight headline states the mean and the target as two facts until the
   weight basis is confirmed in Setup.
6. **ONE STATION TABLE** in the whole application, on Weight, and it shows bias
   against the line AND against the target. On live data every station sits
   within 3 g of the line and 9-12 g below target: the old "difference from the
   line" column alone would have read "Fine" on all fourteen rows.

**Still to do, in this order:** the role rename to viewer/engineer/manager/
admin; a *Product limits* rule in Setup; the per-day-per-code reason sheet;
the line-level sack ledger once IFL answers. **The five questions in
`REDESIGN.md` §11 have not been sent.**

> **Update, 23 Sep 2026 — three of those four are done; do not read the list
> above as current.** Roles are `1 viewer · 2 engineer · 3 manager · 4 admin`
> (read back from `sms.role` on the dev database, 23 Sep 2026; renamed by
> `db/migrations/035_roles_and_answers.sql` on IFL's 15 Sep answer that the
> process engineer owns these writes). Product limits are settable in SMS
> without touching PDAS (`POST /api/products/limits/local`, rank 2,
> `api/src/routes/cone.ts:70`). The per-day-per-code reason sheet shipped with
> roadmap Phase 5. The line-level sack ledger exists (migration 033) and IFL's
> Q28 answer moved it behind the production view. **Still unsent:** the
> `REDESIGN.md` §11 questions — now folded into
> [`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md), the one list to send.

> **Update, Sep 2026 audit fix (finding H3):** the app-owned product-details
> overlay (dropped from the list above — it is done, not pending) is now built
> as `web/src/screens/ProductSheet.tsx`, opened from Line's "Change" button and
> its "History" link — both previously dead ends: the button navigated to
> admin-only Setup, which has no product section, and the link pointed at a
> `#history` anchor that existed nowhere on the page. It is a sheet, not a
> Setup section, because Setup is gated at `rank >= 4` while setting the
> product is a `rank >= 2` action server-side; nesting it in Setup would have
> hidden it from every supervisor/manager account IFL actually uses.

### Floor-first rework (2 Sep 2026) — response to IFL's first review

IFL's reaction to the demo was **very poor**: too complicated for a
non-technical floor worker, nothing live, unclear what period any number
described, and per-sack / per-cone detail buried. All four were true in the
code, not a matter of taste: no polling anywhere in `sms/web`; Line opened on
the day *before* the newest data under a "Live picture" label with three tabs
wired to nothing; ~17 analysis sub-screens of SPC/OEE/Cpk; Records exposed
merge keys and transform versions. The response, built and verified live:

- **Floor screens for every role — `?v=now` (the landing page), `?v=sacks`,
  `?v=cones`, `?v=wall`.** Plain words (every string in
  `web/src/floor/strings.ts`, kept there so an Urdu set can be added without
  touching a screen), big type, ten-second refresh through `GET /api/live`
  (`api/src/services/live.ts`: plant clock, current shift window,
  running / stopped / idle from the same 120 s inter-cone split as downtime,
  this-shift counts, last sack / cone / reject, per-station activity). Lists
  re-read every 15 s and slide new rows in. **One time selector everywhere** —
  This shift / Today / Yesterday / Pick a day — anchored on the plant clock the
  API reports, never the browser's.
- **Wall mode** (`?v=wall`): fullscreen, no navigation, viewport-unit type for
  a TV; one card per line the API reports (one today — `LINE_NAME`). Sessions
  now renew while in use (`api/src/auth.ts`), so a display never logs itself
  out.
- **Line's section tabs are wired at last** (Latest day / Day before). They had
  changed the URL and the highlight but never the content.

### Live rehearsal and the plant simulator (2 Sep 2026)

`sms/scripts/simulate-plant.mjs` writes synthetic source readings so the app can
be exercised against data that is arriving *now*. It writes ONLY to
`DATA_TP1U2_SIM`, never to `DATA_TP1U2` — the read-only rule gets no local-copy
exemption, and the script refuses any target not ending in `_SIM` and any
non-local server. Its distributions are measured from the real 19 days, not
invented: cone gap buckets, weight mean and spread, reject rate and code Pareto,
sack intervals, station bias, and the plant's own Shift-from-insert-time bug.
Usage and setup are in `DEPLOY.md`.

**What the first rehearsal found — a defect no amount of work against the July
copy could have surfaced.** IFL's acquisition layer writes a cone's row about
**18 minutes** after the cone is weighed (909 s min, 1090 s mean, over 142,509
rows). The newest production timestamp available is therefore always ~18 minutes
old on a perfectly healthy line. The live screens compared it against the wall
clock and so reported **"Stopped 17 min" permanently**, with "cones in the last
ten minutes" structurally zero. Against weeks-old data everything read "no
readings", so nothing looked wrong.

Fixed in `api/src/services/live.ts`: the line is judged against `now - lag`,
where the lag is the median of `src_Date - src_ProductionDate` over recent raw
rows — IFL's own insert time against their own production time. Every "recent"
window is anchored on the newest reading rather than the clock, the per-hour
rate divides by the time the counts actually cover, and the screens state the
lag so "the line stopped" is distinguishable from "the reading has not arrived".
Three regression tests lock this down.

**The general lesson, worth applying to anything else time-relative:** this
software never sees the present. It sees the plant as it was one acquisition lag
ago. Any screen that compares a production timestamp to `Date.now()` is wrong
unless it accounts for that.

### ⚠️ The user base is ONE audience — corrected 2 Sep 2026

For a few hours on 2 Sep 2026 this project split the app in two, putting the
analysis screens behind the manager role, on the assumption that the audience
included non-technical floor staff. **IFL's own representative then confirmed
the software is for the GM, managers, and engineers of the process
department.** There is no second audience. The split was removed the same day.

What this means, and it governs every future UI decision here:

1. **Every screen is open to every signed-in account.** Only Setup is
   restricted (`rank >= 4` in `web/src/App.tsx`; there is no `shell.tsx` —
   that file belonged to the 2 Sep intermediate structure and was deleted in
   the 3 Sep redesign). Do not reintroduce read-access tiers.
2. **Roles remain for WRITES only** — setting the running product, logging a
   calibration adjustment, exporting the raw register, and Setup — enforced
   server-side. That is requirement 9's access control. **Create IFL's accounts
   at manager rank** so none of those gates obstruct them (see `DEPLOY.md`).
3. **"Too complicated" never meant "too advanced."** A process engineer reads a
   control chart without help. IFL's stated objection is *"overflow of useless
   information and a solution not implemented smartly."* The failure was
   density, duplication and organisation, not statistical content.
4. **No two screens may answer the same question.** The two-tier split had
   quietly produced exactly that — Now beside Line for the current state,
   Sacks/Cones beside Records for the register — because each tier grew its
   own. The rail is now seven items ordered by time window, with `sacks` and
   `cones` kept as routes only (the Now screen's tiles open their record card,
   which has no equivalent in Records).
5. **The Output/Shifts withdrawal still stands**, for the original reason and
   not the retracted one. It was never "too advanced for the reader"; it is
   that no requirement asks for OEE, and the figure is inferred from event
   timestamps rather than measured. An engineer is the reader most likely to
   ask how it was derived and least satisfied by the answer. The measured part,
   time lost and stop count, survives on the Report screen.
- **The sack ↔ cone link is approximate and says so.** The plant records no
  key from a cone to its sack, and cones between consecutive sack timestamps
  range 0–250 (measured 2 Sep 2026), not ~25. A sack's card shows "cones
  weighed between the previous sack and this one" with the caveat printed —
  never a packing list. Do not present it as one.
- **Replay, for demos and verification:** `?at=<ISO>` moves the plant clock
  (server flag `LIVE_ALLOW_AS_OF` — **false in production**, true in dev where
  the copy ends 10 Jul 2026). A replay is always bannered on screen.
- **Still open from this review:** which device the floor will use (TV, shared
  PC, phone); Urdu labels; and whether the demo ran on the July copy or live
  data (if the copy, half of "not live" was stale source data and disappears
  at cutover — the missing refresh was real and is now fixed).

### Requirement mapping and the Output/Shifts cut (2 Sep 2026)

IFL's original requirement list was read back against the build for the first
time on 2 Sep 2026. Ten lines. The mapping, and it is the reason for the cut:

| IFL asked for | State |
|---|---|
| Connectivity with PLCs, HMIs, machines, databases | SQL only; PLC path deferred on IFL's own later answer (Q22) |
| Cone weight collection, flag weights outside limits | Built |
| Screens to view and **update product details on machines** | **Built, off:** Add / Retire / Change-limits write to PDAS through the vendor's procs behind `PDAS_WRITE_ENABLED` (11 Sep 2026). Still never written to a *machine* (Q22); whether the PLC reads the values live is an open question for IFL |
| History logs and trend graphs for rejected cones | Built |
| **AI**-based analytics recommending calibration adjustments | Built as statistics (Nelson rules, station drift, ledger), not AI |
| Collection and logging of all sack data | Built |
| **Sack stock tracking per machine** | **Not built.** See the blocker below |
| Comprehensive **reporting**, analytics, graphical dashboards | Analytics and dashboards yes; **reporting missing** |
| User-friendly interface, access control, data security | Access and security built; "user-friendly" is the complaint above |
| Scalable to more machines and data points | `line_id` throughout; multi-line not built |

**Nothing in that list asks for OEE.** Not availability, performance, quality,
downtime, stoppage clustering, MTBF/MTTR, or shift-versus-shift. Output
(`?v=performance`) and Shifts (`?v=shift`), five sub-screens, answered a
question no customer posed, and they carried the charts IFL called unreadable.
They were **removed from the product** on 2 Sep 2026 and then **deleted
outright** in the 3 Sep redesign (commit `f4b941a`): the screens, their
services (`oee.ts`, `shiftAnalysis.ts`) and the routes `/api/oee`,
`/api/shift-analysis`, `/api/stoppage-patterns` are gone, and the view
parameter itself changed from `?v=` to `?s=`, so an old URL lands on Line.
Restoring them means recovering the code from git history (`git show
f4b941a^:<path>`), not flipping a switch. Three orphaned client wrappers
(`getOee`, `getShiftAnalysis`, `getStoppagePatterns` in `web/src/api.ts`)
remain and target endpoints that now 404.

The "availability below normal" finding was dropped with them, since its only
destination was Output. Time lost returns as a finding once the period report
exists. The Line ribbon still shows availability as a plain figure.

**Kept because they ARE contracted, not because the data allowed them:** the
reject trend graphs (requirement 4) and the weight control chart plus station
drift, which are the machinery under the calibration requirement (5).

**The sack-stock blocker, to raise with IFL.** `sack1_TP1U2` carries no machine
or station column — only sack number, weight, in-range and insert time. Sack
stock *per machine* is therefore not computable from the data IFL supplied, by
anyone. It needs the PLC path they deferred, or a manual entry screen on the
floor. This question has a long turnaround and blocks the largest missing
module, so it goes to IFL before the report screen is finished.

**On the AI expectation (confirmed open with IFL, 2 Sep 2026).** They are
non-technical here and simply expect AI in the product. Do not fabricate it,
and do not promise anything cloud-hosted: the plant is air-gapped by their own
hosting constraint. The honest deliverable is to extend the existing
calibration advisory from "this station is off target today" to "this station
reaches the action limit in about N days at the current drift", which is a real
prediction from real data and is defensible when challenged.

### IFL answers — decisive points (23 Jul 2026)

- **Q1:** no product data in DB; **product-wise historical reporting not required.** App adds a **Current Product** selector (Process Engineer sets it), stored in the **app-owned DB**. → `NullAttribution` default for history; `ManualEntryAttribution` forward-only. **Superseded 11 Sep 2026:** IFL's rebuilt tables carry `MaterialId` on every row; attribution is now the plant's own for those rows.
- **Q21 (HARD):** **zero modifications to IFL's DB** — no schema, indexes, tables, procs, or data. Retires the "add indexes" option. All optimisation is app-side.
- **Q22:** **no PLC integration in scope.** Component B is now indefinitely deferred; `cone_id` column stays nullable but its PLC path is dormant. Q2 redirects cone traceability to `rejectWeight1_TP1U2.[Source]` (a station, not a unique id).
- **Q12:** dispatch **not required** (confirmed out).
- **Q19 vs Q21 vs Q1 → open decision D0:** IFL says "connect directly" (Q19) but forbids DB indexes (Q21), while Q1 forces an app-owned writable DB anyway. **Recommend sidecar sync (SPEC §1 Option B).** Needs user call.
- **Still blocking:** weights gross/net + units (Q4/Q5), reject-code meanings (Q10), shift fix-vs-reproduce (Q7). Shift boundaries confirmed 06/14/22 (Q8).
- **Still pending:** single vs multi-line (Q14), hosting (Q20) — both to be settled at the upcoming textile-team meeting.

### Revised phase plan (21 July 2026)

Commissioning is split by **component**, not just by activity. Phase 1 does **not** touch the PLCs.

| Component | Phase | Status |
|---|---|---|
| **A** — Read-only sync: IFL SQL Server → local sidecar DB | **1** | Specced |
| **B** — Direct S7-1500 PLC reader for `P1_ConeID` | **2 — DEFERRED** | **Stub + disabled flag only** |
| **C** — Web app, queries local sidecar DB only | **1** | Specced |

**Phase 1 = A + C.** **Stop for user approval between every phase.**

### 🚫 Phase 1 hard constraints

1. **Do not implement Component B.** No PLC reader logic. (Q22: PLC integration is out of scope entirely.)
2. **Do not add any PLC dependency** — no `snap7`, `python-snap7`, `S7NetPlus`, or equivalent, in any manifest.
3. **Do not write to IFL's acquisition database (`DATA_TP1U2`), and do not alter it in any way** — no schema, **indexes**, tables, procs, or data (Q21, hard client constraint). Reads only. Writes (Current Product, users, notes) go to the **app-owned DB only**. **The one exception, 11 Sep 2026, is the PDAS write path** — a separate `sms_pdas_writer` login, behind `PDAS_WRITE_ENABLED`. **Written authority, owner's statement:** Hassan sb of IFL gave the SMS project owner a written grant by WhatsApp on 19 September 2026 ("complete autonomy and permission to enable and work on the PDAS changing the DB"), covering all nine write rights below, for both the local copy and the plant; process engineers will be the users. That message is held by the project owner, not in this repo. Timeline: 11 Sep verbal/partial (2 of 9), 15 Sep verbal (all nine), 19 Sep written (all nine), 22 Sep `af420a4` flipped `PDAS_WRITE_ENABLED` on locally only. See `DEFECTS.md` D-12 (resolved 24 Sep 2026) and `handover/PDAS-WRITE-GRANT-2026-09-19.md`.

   **The gate still in force:** the code path (`pdasWrite.ts`, `/api/changeover/execute`) has never run end to end. The plant stays off until the local end-to-end proof completes on the owner's Windows laptop: all nine rights exercised through our code against `PDAS_TP1U2_SEP07`, with backups, failure paths, and an EXECUTE-only "ibrahim"-shaped login rehearsal, plus any fixes that proof turns up. Q21 is unchanged for `DATA_TP1U2`. The PDAS exception stays bounded exactly as before: **no new PDAS objects, no DELETE, no other table, ever.** Retire-and-recreate is still not an edit: `CreateMaterial` refuses a duplicate blend/count/tube regardless of active flag.

   **All nine rights, granted 19 Sep 2026 (owner's statement), none yet run through our code end to end:** `CreateMaterial` (create a product), `SetMaterialStatusActive` (retire/reactivate a product), `AddBlend`, `AddCount`, `AddTubeType`, `CreatePallet`, `SetPalletStatusActive` (roadmap Phase 6 / Wave F, the rest of IFL's own "QCS ID Creation by P-DAS" SOP — `sms/api/src/services/pdasWrite.ts`), the guarded single-row `UPDATE dbo.Materials` that changes limits (the vendor supplies no UPDATE proc for this), and the `INSERT dbo.nhs_events` row written alongside it, in the vendor's own event-log format, covering `dbo.Materials`, `dbo.Blends`, `dbo.Counts`, `dbo.TubeTypes`, `dbo.Pallets` and `dbo.nhs_events`. `PDAS_WRITE_ENABLED=false` in `sms/.env`; the `.env` comment there is the owner's to correct. See `sms/DEPLOY.md`'s credentials table for the `sms_pdas_writer` grant these cover.
4. **Web app queries the app-owned DB** (sidecar). *Pending D0:* IFL's Q19 says "connect directly"; do not finalise the data-access path until D0 is decided.

### Phase 2 readiness — VERIFIED STATUS (audited 17 Aug 2026)

> **Read this section as a status report, not as a design intent.** Three of the
> five items below were previously written here as accomplished fact and were
> not true in the code. They were corrected only after an audit grepped for them
> and found nothing — after they had already been repeated to the customer-facing
> side of the project. **Anything in this file that claims a capability must be
> greppable in the code, or must say plainly that it is a plan.**
> Marked ✅ implemented / ⚠️ partial / ❌ designed only.

1. ✅ **IMPLEMENTED — `cone_id` column exists and is nullable** on `sms.cone_event`, alongside **`cone_id_source`** (provenance: `plc_direct` \| `sql_sync` \| null). Both null in Phase 1. Verified: `sms/db/migrations/003_cone_event.sql:36`.
2. ❌ **DESIGNED ONLY — ingestion is NOT adapter-based.** There is no `IngestionAdapter` interface anywhere in the codebase (zero hits in any `.ts`). `SPEC.md` §3 and `ARCHITECTURE.md` §10 describe an *intended* shape. In reality the runner news a concrete `IflSqlAdapter`, `transform.ts` bakes in `source_system: 'ifl_sql'`, and `persistRaw` is insert-only. Adding a second source is a refactor (~1.5 wk), not a drop-in. **Do not quote §3 as evidence of pluggability.**
3. ✅ **IMPLEMENTED — cross-source merge key** `(line_id, production_ts_utc_ms, hanger_num)` is on every row and enforced by a unique index. Verified: `UX_cone_merge` on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)`, `003_cone_event.sql:55`. See `SPEC.md` §3.2 for the DQ-2 collision caveat. *Caveat:* a `plc_direct` row arriving on an existing merge key would **violate** this index, not enrich the row — Phase 2 needs a merge-and-enrich upsert, not `UPDATE ... SET cone_id`.
4. ❌ **DESIGNED ONLY — there is no PLC stub and no test.** `PLC_READER_ENABLED` and the host/rack/slot keys appear **only** in `.env.example`; no TypeScript file reads them, nothing validates them, no stub class exists, and **no test asserts anything about them** (3 test files total: `appConfig`, `fingerprint`, `transform` — zero PLC references). What IS true, and is the only version safe to state externally: **no PLC library appears in any of the five package manifests.** That is a convention, enforced by review, not by a test. Describe this as *a documented, dependency-free re-entry point* — never as "PLC-ready" or "a stub".
5. ✅ **RESOLVED BY IFL'S DATA (11 Sep 2026).** `transform.ts` now stamps `attribution_method = 'source_column'` from the row's own `MaterialId` (132,551 of 132,552 September cones) and `'none'` only where the column did not exist (all July rows). `/api/production?product=` is live and reports the unattributed count alongside its rows so a screen can say which readings predate product recording.

### Consequence of unanswered Q1

Phase 1 shipped with `NullAttribution`. **From the September 2026 sample onward, product attribution comes from IFL's own `MaterialId`** and product-wise reporting is possible for those rows. Rows from before the column existed stay unattributed — do not fabricate attribution for them.

## Working rules (apply to the whole project)

1. **Never hardcode credentials.** Connection details come from environment variables only, loaded from `.env`. `.env` is in `.gitignore`; commit a `.env.example` with placeholder values.
2. **Treat the client DB as production data.** Default to **read-only** queries. Do not issue `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER` — including adding indexes — without explicit user approval. (See OQ-14 and SCHEMA.md §5.9.)
3. **Parameterised queries only.** No string-concatenated SQL, ever.
4. **Ask before adding any dependency** or making an architectural decision not already agreed.
5. **Keep docs current.** Update `CLAUDE.md` and `SCHEMA.md` whenever a decision is made or understanding changes. Record answered open questions in `SCHEMA.md` (mark them RESOLVED with the answer and date) rather than deleting them.
6. **Flag ambiguity, don't guess.** If a column's meaning, unit, or semantics is unclear, add it to the open-questions list.
7. **Validate all inputs**; handle loading and error states in every UI slice.
8. After each vertical slice: **run it**, tell the user how to verify it, and commit with a clear message.

## Database

Two SQL Server databases, delivered as a detached `DATA` folder inside `SPS.adding` (a RAR archive despite the extension).

| DB | Role |
|---|---|
| `DATA_TP1U2` | PLC acquisition — sack/cone weights, rejects. **The main SMS source.** |
| `PDAS_TP1U2` | Product master (blends, counts, tube types, materials, pallets) + vendor label module. |

**Local analysis instance:** attached to `.\SQLEXPRESS` as `DATA_TP1U2` and `PDAS_TP1U2`.
**Production instance:** not yet known — see OQ-12.

### Connection approach

```
# .env  (never committed)
DB_SERVER=<plant-server>\<instance>
DB_NAME_DATA=DATA_TP1U2
DB_NAME_PDAS=PDAS_TP1U2
DB_USER=<read-only login>
DB_PASSWORD=<secret>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true   # plant-local server, self-signed cert
```

Request a **dedicated read-only SQL login** from IFL — do not use `sa` or the vendor app's account.

### Non-negotiable query rules (from SCHEMA.md)

- Query the **`*_TP1U2` wide tables** (`sack1_TP1U2`, `pack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`). **Never** the raw EAV tables (`sack1`, `pack1`, …) — 6× the rows, zero extra information.
- Event time for cone/reject data is **`ProductionDate`**, not `Date`. `Date` is insert time and lags by ~3.8 h on average.
- The stored `Shift` column is derived from insert time and is therefore **wrong for many rows**. Recompute from `ProductionDate` (pending OQ-4).
- Row key is **`id`**. Never `SackNum` (resets to 0) or `reference_value` (collides; 8.4 % of groups).
- Filter vendor seed data: `Materials.MaterialId > 10`, `Pallets.PalletId > 10`.
- Cast `Counts.Count` (nvarchar) to int before ordering.
- Exclude/flag outliers in aggregates: sacks < 40 kg, cones < 1500 g.

### Known constraints

- **`DATA_TP1U2` has no foreign keys** and no views or stored procedures — only triggers.
- **The two databases cannot be joined** — there is no product/lot key on the weighing data (OQ-1, blocking).
- **No dispatch data exists** anywhere (OQ-15). If dispatch is in scope it is a new module.
- Wide tables have only a clustered PK on `id`; date-range queries will scan. Index additions need client approval.
- Two samples, two source generations: **19 production days** (2026-06-22 → 2026-07-10, July sample) and **34 days** (2026-08-05 → 2026-09-07, September sample), with the month between them not yet sent by IFL. Two further
  dates appear in the raw data and are excluded as clock faults: 1969-12-31 and
  2026-06-21, holding 1 and 2 readings.

## Security

- **Do not reuse `DATA_TP1U2.Users`.** It holds 3 accounts with **plaintext passwords equal to the usernames** and no role column. Build fresh auth with hashed passwords (see OQ-8 re: AD/SSO vs app-local).
- Deployment target is the **plant intranet, no cloud dependency** — but still hash passwords, use parameterised queries, and scope the DB login to read-only.

## Tech stack — DECIDED (23 Jul 2026)

**React + Node + TypeScript, end to end.** Chosen for a **solo developer**: one language across frontend, API, and sync worker; shared types; minimal moving parts. EMS uses a different stack — we are deliberately *not* mirroring it (the brief's "mirror EMS" is superseded here; UI/UX freedom was the explicit goal).

| Decision | Choice | Notes |
|---|---|---|
| **D0** data access | **Sidecar sync** (SPEC §1 Option B) | App-owned DB required anyway (Q1). **Deployment plan (confirmed by user):** develop against the supplied copy, then integrate on IFL's live DB — under sidecar this is just **repointing the sync worker's source connection string** (copy → live); API/UI unchanged. Read-only, no load or index needs on the live server (honours Q21). |
| **D1** app/sidecar DB engine | **SQL Server Express** | Already on the plant PC; same driver as source; free. |
| **D2** stack | **React + Node + TypeScript** | Frontend: React + TypeScript. Backend API + Component A sync worker: Node + TypeScript. |
| **D3** sync cadence | 60 s incremental on `MAX(id)` watermark | Per table. |
| **D4** backfill | One-off full-history load, then incremental | |
| **D5** auth | Session cookies (not JWT) | Single-server intranet. AD vs app-local pending Q18. |

**Provisional library choices (ask before adding anything beyond these):**
- SQL Server driver: `mssql` (Tedious under the hood) — used by both the API and the sync worker.
- Sync worker supervised as a Windows Service via **NSSM** or `node-windows` (boots with machine, restarts on crash).
- Frontend build: Vite. API framework: TBD at first slice (Express vs Fastify) — will propose, not assume.

Target environment: SQL Server on the plant LAN, app on a local industrial PC/server, no cloud dependency.

Record further decisions here as they are made.

## Conventions

To be established in Phase 2 (naming, folder structure, error handling, commit message style). Mirror EMS patterns where they exist.

## Repository layout (current)

```
SPS.adding              # original client archive (RAR) — do not commit
extracted/              # unpacked MDF/LDF files — do not commit
schema_dump/            # raw introspection output — do not commit
introspect.sql          # metadata introspection script
dq.sql, dq2.sql         # data-quality profiling scripts
SCHEMA.md               # ← data model source of truth (IFL's DB)
SPEC.md                 # ← Phase 1 scope, sidecar schema, interfaces
CLAUDE.md               # ← this file
../QUESTIONS.md         # ← client questionnaire (moved to Desktop)
```

`.gitignore` must exclude `.env`, `SPS.adding`, `extracted/`, `schema_dump/`, and any `*.mdf` / `*.ldf`.
