# DEFECTS.md — SMS living defect register

**Started:** 22 Sep 2026, by a markdown-only worker on `floor-first-rework` (HEAD `de607ce` at start of this pass). This is the register `ROADMAP-GAP-ANALYSIS.md` §14 named as MEDIUM-severity unowned work: "the only severity-graded register is the one-off 10 Sep audit (untracked)... the Definition of Done's 'no critical/high unresolved defects' cannot be evidenced without one." This file is that evidence, kept going forward.

**How to use this file.** Add an entry when a defect is found, verified in the running code (not inferred from a comment or a claim in another document), and worth tracking past the session that found it. Update an entry's status in place rather than duplicating it. Do not transcribe a defect you have not personally re-checked against the current code — a register full of stale or already-fixed entries is worse than no register, because it stops being trusted. Cross-reference the commit that fixes an entry once it lands, and leave the entry in the table marked FIXED rather than deleting it — the fixed history is itself evidence for the Definition of Done.

## Severity scale

This product's Definition of Done requires "no critical/high unresolved defects" (`ROADMAP-GAP-ANALYSIS.md` §14), so these two words carry contractual weight and are defined precisely, not impressionistically:

| Severity | Definition |
|---|---|
| **CRITICAL** | Data loss, data corruption, a wrong number presented as fact that could drive a real plant or business decision (e.g. a false pass/fail on a weight, a fabricated attribution, silent data loss on rebuild/cutover), or a security hole that exposes plant data or credentials. Blocks go-live outright. |
| **HIGH** | A defect that produces an actively misleading statement or number on a screen a manager or engineer will read and could act on (a false "healthy", a wrong count, a control-limit calculation that is systematically wrong even if nothing yet renders its raw output), OR a write path that could corrupt or silently drop data under realistic conditions, OR a gap between what a governing document (`CLAUDE.md`, `DEPLOY.md`, `ARCHITECTURE.md`) claims is true and what the code actually does. Should block go-live until fixed or explicitly accepted by the owner in writing. |
| **MEDIUM** | A defect that is wrong or incomplete but does not misstate a fact — dead code, an orphaned route, a missing DQ check, a documentation drift that a reader could self-correct from context, a maintainability or concurrency risk that needs unlikely timing to trigger. Worth fixing before go-live but does not block a demo. |
| **LOW** | Cosmetic, a known and accepted design limitation, or a defect confined to the dev/demo environment with no path to the plant (an unused dependency, a default meant to be overridden, a dev-only script). |
| **VISUAL** | A UI rendering defect (overflow, collision, clipping, wrong type step) with no effect on the underlying data or logic. Kept separate from MEDIUM/LOW because these are found by a different method (viewport measurement, not code reading) and fixed by a different kind of change (CSS only). |

Status values: **open** (confirmed present in the code today) · **fixed** (confirmed absent, with the fixing commit) · **fixed, uncommitted** (confirmed absent in the working tree at time of writing, not yet committed — re-check after the commit lands) · **won't-fix** (accepted, with the reason) · **cannot determine** (could not be confirmed either way in the time available, with why).

---

## Part 1 — Triage of `ROADMAP-GAP-ANALYSIS.md` §17

§17 lists defects the 15 Sep 2026 gap-analysis pass found in code but that appeared in no project record. Four independent read-only passes re-checked every row against the code as it stands on `floor-first-rework` at HEAD `de607ce` (22 Sep 2026), file by file — not by trusting the original §17 wording or any later document's claim to have fixed it. The verdicts below are what those passes actually found. Where a sub-claim could not be pinned to its original file (the pre-redesign `App.tsx` that many of these were filed against was deleted whole in commit `f4b941a`), that is stated rather than guessed past.

**Result: of roughly 70 distinct sub-claims across the fourteen §17 rows, the large majority are FIXED, a working minority are genuinely STILL OPEN, and a handful could not be determined.** The open ones are listed below with their own IDs (R-series) so they can be tracked going forward; the fixed ones are recorded as fixed, not deleted, so the register shows its own history.

### UI / Health, Rejects

| §17 row | Verdict | Evidence |
|---|---|---|
| DQ findings count always "none" (severity case mismatch vs CHECK constraint) | **FIXED** — location moved | The pre-redesign `Setup.tsx` this was filed against no longer exists (deleted in `f4b941a`). DQ severity today is handled in `api/src/services/operations.ts:359-376` (`bySeverity` keyed on the exact uppercase strings `CRITICAL\|ERROR\|WARNING\|INFO`) and consumed in `web/src/screens/health/SyncHealthBlock.tsx:125-131` (`f.severity === 'ERROR' \|\| f.severity === 'CRITICAL'`), matching `CK_dq_severity` in `db/migrations/009_dq_finding.sql:20-22` with no case transform anywhere in the chain. |
| Every label rename nulls `is_pass`; `severity` unreferenced | **FIXED** | `api/src/app.ts:1097-1130` (`PUT /api/reject-codes/:id`): `label`/`isPass`/`severity` are all independently optional; the patch only updates fields explicitly sent, and `severity` is read, written and audited. `api/src/app.routes.test.ts:190` pins "renaming must not touch the pass flag". Fixing commit `a473d4d`. |
| Register joins `reject_code` on nullable equality; weight-reject labels invisible | **FIXED** | `api/src/services/register.ts:319-336` now joins with `ISNULL(c.tube_code,-999)=ISNULL(e.tube_inspect_code,-999)` (and the material equivalent), plus `line_id`, with a code comment naming the exact old bug. Fixing commit `a473d4d`. |
| Reject sheet prints "Passed," resolves line-wide product, wrong eyebrow, product block on weightless row | **FIXED** | `web/src/screens/ReadingSheet.tsx:87-133,166-211`: eyebrow/title now differentiate reject vs cone vs sack explicitly; product is resolved via `getProductAt(row.production_ts_utc, row.material_id, ...)` from the row's own fields, not a line-wide lookup; weight/in-range are omitted for sacks so no spurious product block appears on a weightless row. Fixing commit `a473d4d`. |
| Reasons fixed to a 14-day window; `/api/rejects`/`/api/reject-spc` accept no `shift`/`tsTo`, no range cap; Line and Rejects disagree on default period; replay ignored | **FIXED** | `api/src/app.ts:886-903,1048-1071`: both routes now accept `shift` and `tsTo` and call `validateRange`. `web/src/screens/Rejects.tsx:156-162,190`: the reasons list is fetched with the same `shift`/`tsTo`/`from`/`to` Line itself sends. Fixing commit `8fa79ca`. |
| No `GET /api/reject-codes`; codes outside the window unnameable; trend has no control limits; no fetch error states; "Record" shows two ids | **FIXED**, one sub-part **cannot determine** | `GET /api/reject-codes` exists (`app.ts:1085-1091`); `GET /api/rejects/reason` carries the out-of-window dictionary row (`routes/rejects.ts:100-121`); `Rejects.tsx:529-565,602` draws `qUcl`/`wUcl` per-bucket control bands; `Failed`-component error states are pervasive (e.g. `Rejects.tsx:275-348`). The "Record shows two different ids" sub-claim could not be pinned to a reproducible case in the current code — current navigation uses one consistent `ReasonRef`, so the symptom is absent, but the original defect could not be independently confirmed to have existed in this exact shape. Fixing commit `8fa79ca`. |

### Products, Sync, Model

| §17 row | Verdict | Evidence |
|---|---|---|
| `z.coerce.boolean()` turns `"false"` into `true` on the active routes | **FIXED** | `api/src/app.ts:1103,1417-1419` now use plain `z.boolean()` with an explicit guard comment referencing this exact defect. The only remaining `z.coerce.boolean()` in the codebase is in `api/src/config.ts` for DB-connection env flags, which is a different, non-route context. Fixing commit `a473d4d`. |
| PDAS write path: TOCTOU check, cached rejected connect promise, post-proc bookkeeping inside `try`, unaudited rejections, dropped `MaterialDesc3`, float-vs-DECIMAL `===`, write bounds coupled to the DQ rule | **Mixed — six fixed, one cannot-determine** | FIXED: the concurrency check is now a transactional read-compare, not TOCTOU (`pdasWrite.ts` `updateProductLimits`, ~line 706); `MaterialDesc3`/4/5 are now bound (fixing commit `b1b6675`). **FIXED, R-1, commit `fc67812` (22 Sep 2026):** `pool()`'s connect promise is now cleared on rejection instead of cached forever, so a transient PDAS outage no longer locks the writer out until process restart. **FIXED, R-2, commit `fc67812`:** `createProduct`'s post-proc bookkeeping (`mirrorProduct`, `appendLimitVersion`, `recordChange`, `recordAudit`) now runs in its own try/catch — a bookkeeping-only failure after a successful PDAS write records outcome `'ok'` with the gap named in the message, not `'error'`. **FIXED, R-3, commit `78c7b85`:** all three product-write routes (`POST /api/products`, `/:id/active`, `/:id/limits`) now write an audit row on a validation rejection, matching every other outcome these routes can produce. **CANNOT DETERMINE (float vs DECIMAL `===`):** `sameFields` (~line 649-658) still compares PDAS `float` columns against the app's `DECIMAL(10,2)` mirror with strict `===`; plausible but unreproduced without live data — not attempted this pass either. Write bounds sharing the DQ plausibility rule (`app.ts:1424-1426`) is confirmed still true and is a design choice, not obviously a defect — not tracked further here. |
| `spc.ts` limits/Cp-Cpk from the mirror; `weights.ts` stale attribution/1950 fallback; station table line-wide target | **FIXED**, as `CLAUDE.md` claims | `spc.ts:184-209` now reads the time-versioned `sms.product_limit_version` when a period is supplied, with a comment naming the exact prior bug. `weights.ts`'s `FALLBACK_CONE_SETPOINT_G = 1950` still exists but is now an explicit, labelled `nominalSource: 'fallback'`, surfaced to the UI rather than silent. `weightStations.ts:65-97,180-297` computes a per-station-per-material target (`targetBasis`), not a line-wide one. Fixing commits `a473d4d` and `be5ac3e` (UX Phase 5). |
| Sync worker: app pool orphaned per tick on IFL connect failure | **FIXED** | `sync-worker/src/index.ts`: all housekeeping goes through `withAppPool()` (~line 124-134), which always closes its pool in a `finally`. |
| Non-numeric `SYNC_INTERVAL_SECONDS` → `NaN` → zero-delay loop | **FIXED** | `sync-worker/src/config.ts:93-139` (`intEnv`) validates against `/^-?\d+$/`, throws on a non-numeric value, and enforces a 5 s floor. |
| `seedProducts` before the gate, unguarded; O(n) MERGEs per pass; halted pass writes no `sync_run` row | **Mixed — two fixed, one still open** | FIXED: `seedProducts` now runs in its own `try/catch` and a failure is recorded as a standing DQ finding rather than halting the whole pass (`pipeline.ts:119-137`); a halted pass now does write `sync_run` rows for every halted table (`pipeline.ts:40-68`, `store.ts:155-166`). **STILL OPEN (R-4):** `seedProducts.ts` still issues one awaited `MERGE` per row, sequentially, for blends/counts/tubes/materials/pack schemas/pallets and again for limit-version history — no batching was introduced. Low urgency (PDAS's own product counts are small) but genuinely unfixed. |
| Only the row read is retried, not the write; `rebuild.ts` hardcodes `'ifl_sql'` including in a DELETE | **Mixed** | **STILL OPEN by current design (R-5, low severity):** `runner.ts:196-204` wraps only `adapter.readSince` in `withRetry`; the subsequent `persistRaw` write is not retried. This is a real gap (a transient write failure after a successful read is not retried) but is bounded by the pipeline's own halt/report behaviour rather than silently losing data. FIXED: `rebuild.ts:89-99,136-144` now binds `source_system` codes as SQL parameters from `loadSourceStreams`, not the literal `'ifl_sql'`, for both the version lookup and the DELETE; the target table is also checked against a hardcoded allow-list. |
| `events.ts` dead contract; `TRANSFORM_VERSION` never bumped; `ingest_run_id` orphan; `subject_ref` never written; attribution write-only; shift-rule 1/5 live; epoch label not on the sheet; rebuild gate a non-empty string; migration 025 seeds laptop tombstones; backfill script hard-codes this machine | **Mostly fixed, one confirmed still true by design** | `events.ts` could not be located anywhere in the current tree or git history under that name — cannot determine what the original claim referred to. Everything else in this row is FIXED: `TRANSFORM_VERSION = 2` with a documented history (`shared/src/domain/version.ts:32`); `ingest_run_id` is stamped from the raw row's own value; `subject_ref` is both written (`transform/dq.ts`) and read (`operations.ts:366-379`); attribution is read by `weights.ts`/`rejects.ts`/`register.ts`, not write-only; the full shift rule (not one field) is read live each pass; the epoch label is joined onto both the reading sheet and the reject sheet; the rebuild gate is now a hardcoded allow-list of three table names, not a truthy-string check; migration 025 no longer seeds the dev bootstrap generations (moved to a dev-only script, confirmed absent from a production install). **STILL OPEN, by design, not hidden (R-6, LOW):** `scripts/backfill-source-epoch.mjs` hardcodes id boundaries measured on this specific dev database — a one-shot migration-support script, not a defect anyone is pretending is general-purpose, but still literally true as stated. |

### Calibration, Screens, Ops/CLI, Ops/Docs

| §17 row | Verdict | Evidence |
|---|---|---|
| StationSheet compares production-day string to UTC without plant offset; Nelson centerline includes pre-adjustment days; line-wide adjustments unshown; per-station SD unrendered; `/api/calibration`, `/api/weights` orphaned | **Mixed — four fixed, one still open** | FIXED: `StationSheet.tsx` now routes every comparison through `lib/plantClock.ts`; `calibration.ts` computes the Nelson centreline/sigma per logged-adjustment epoch, restarting at each one; line-wide adjustments render a badge; per-station SD is rendered with a note. Fixing commit `114a8f6`. **STILL OPEN (R-7, LOW):** `getCalibration`/`getCalibrationAdjustments`/`getWeights` in `web/src/api.ts` remain referenced only by tests, not by any screen — the routes work but nothing in the UI calls them; the screen instead uses `listAdjustments`/`getCalibrationRules`. |
| `Weight.tsx` no `tsTo`; `Wall.tsx` `from=undefined` on first render; Readings Print has no header; three orphaned `api.ts` wrappers; `format.ts`/`lib/strings.ts` dead; two unused `@fontsource` deps; HEAD `live.ts` samples the older generation | **Mixed — five fixed, one FIXED this pass, R-8 was WRONG** | FIXED: `Weight.tsx` now passes `tsTo`; `Wall.tsx` guards its attention fetch against an undefined `from`; the Readings Print header gap is the one CLAUDE.md's Phase 9 section already documents as closed (`PrintHead.tsx`'s degraded block, commit `99c9e40`) — independently re-confirmed here; `format.ts` no longer exists in the tree; `live.ts` now orders by SMS's own monotone `raw_id`, not the source's own id, so it no longer samples the older generation. **R-8 IS WRONG, corrected 22 Sep 2026:** `web/src/lib/strings.ts` is NOT dead — `grep -rln "from '.*lib/strings'"` finds exactly one importer, `web/src/lib/fmt.ts:7` (`import { S } from './strings'`, used at `fmt.ts:69-70` for `S.justNow`/`S.ago`), and `fmt.ts` itself is imported by 34 files across `web/src/screens` and `web/src/ui` (`Line.tsx`, `Weight.tsx`, `Rejects.tsx`, `Report.tsx`, every report sub-screen, etc. — confirmed by grep, not sampled). The original claim ("zero importers") checked only direct importers of `strings.ts` and missed the one-hop indirection through `fmt.ts`. Downgraded from "R-8, open" to a corrected register entry — no fix needed, the file is live code. **FIXED, R-9, commit `af72218` (22 Sep 2026):** `@fontsource/archivo` and `@fontsource/dm-mono` removed from `web/package.json` (zero references confirmed by grep) and the lockfile regenerated. |
| `cutover`/`epoch:purge` unlocked, no backup/running-worker check, string-built id lists; `epoch:accept` non-transactional; server string is identity; station survives cutover while epoch tombstones do not; orphaned `'running'` rows never reconciled; no INSERT station path; no DQ for station outside roster | **Mixed — five fixed, three still open (by design)** | FIXED: `cutover` and `epoch:purge` both now require an explicit `--backup` flag, check for in-flight passes, and run under a transform lock; `epoch:accept` is now genuinely transactional (`BEGIN TRAN` / `SET XACT_ABORT ON` / commit-or-rollback, fixing commit `c67e1c2` — this directly answers CLAUDE.md's own open question about it); orphaned `'running'` sync rows are now reconciled on worker start; an `INSERT` path for a new station exists (`POST /api/admin/stations`); a DQ check for a station outside the configured roster exists. **FIXED, R-10, commit `eb34170` (22 Sep 2026):** `epoch.ts`'s purge path now builds its `WHERE source_epoch IN (...)` clause through a new `idInClause()` helper that binds each id as its own named parameter (`@e0`, `@e1`, …) instead of joining them into a literal string — the array was already pre-filtered to integers so this was not exploitable, but it was exactly the string-concatenated SQL shape the project's own working rules forbid. New unit test (`epoch.idInClause.test.ts`). **STILL OPEN, by design (R-11, LOW):** source identity is still plain string/value equality on server+database+created-key, not a stronger key — documented as intentional, not hidden. **CANNOT DETERMINE / not clearly a defect:** "station survives cutover while epoch tombstones do not" describes the current code's actual, documented behaviour (cutover ≠ purge; stations are deliberately preserved) — it reads as an intentional design choice rather than an oversight, but nothing in this pass could confirm which the original 15 Sep audit meant. |
| `DEPLOY.md` false no-op claim, non-re-runnable migration, no `schema_migration` seeding, duplicated step, stale `?v=` reference, retracted cutover procedure, false "IFL has been asked" sentence, fragile backup script, missing NSSM options, undocumented boot-order dependency, stale Operations section | **FIXED**, one minor default unchanged | Every specific sub-claim checked is now either corrected in `DEPLOY.md`'s own text (several sections explicitly narrate and retract their own earlier wrong claims, which is a healthy pattern worth keeping) or fixed in `backup-appdb.ps1` (no default password on the command line for the standard path; `-User` now defaults to a dedicated backup login rather than the app login) and in the NSSM service definitions (both services now get `AppStderr` and `DependOnService`). No "IFL has been asked" sentence exists anywhere in `web/src/lib/words.ts` today. **STILL OPEN (R-12, LOW):** `backup-appdb.ps1`'s `-Server` parameter still defaults to a dev-only port (`localhost,14330`); every documented usage overrides it explicitly, so the risk is low, but the literal default is unchanged. |

### Security, Docs, Build, Data path

| §17 row | Verdict | Evidence |
|---|---|---|
| Audit fire-and-forget; `sms_app` has DDL so can mutate `audit_log`; limiter map never pruned; `TtlCache` sweep on re-read only; a test claim in `auth.ts` that does not exist; `/api/operations` ungated; rank-1 cannot see the product list; a Setup element claimed but absent | **Mixed — five fixed, one unchecked** | FIXED: config-change audit writes are now wrapped in the same transaction as the change itself (login/logout audit remains intentionally fire-and-forget — a documented, deliberate scope boundary, not the defect this row named); the login-attempt limiter's map is now pruned on every check; `/api/operations` and `/api/products` both sit behind the blanket `requireRole(1)` gate applied to `/api`, so a rank-1 viewer can reach both — not ungated, and the product list is visible at rank 1. **FIXED, R-13, commit `523e3b4`:** the runtime `sms_app` login no longer holds `db_ddladmin` — split into a separate, narrower migration-only login, so the application's own runtime login can no longer alter or disable `audit_log`'s append-only trigger. **FIXED, R-14, commit `39ffb58` (22 Sep 2026):** `auth.ts`'s comment claiming a test "walks `app._router.stack`" was corrected — no test anywhere in the repo does this (confirmed again by grep); the comment now names `auth.test.ts`'s real method (synthetic req/res, no `app.ts` import) and `web/src/rank.crosscheck.test.ts` as the test that actually does the router-vs-client-constant cross-check. **CANNOT DETERMINE:** whether `TtlCache`'s sweep only happens on re-read (not checked in this pass). |
| Three conflicting table counts; `sack1`/`pack1` inverted in `CAPABILITIES.md`; overclaimed basis toggle and register filters; `SPEC.md` phantom PLC test and stale header; stale `README.md`/`CLAUDE.md` lines; `nelson.ts` describing a deleted UI statement; `CLAUDE.md` describing uncommitted code as done | **Mostly fixed** | `CLAUDE.md` now explicitly self-corrects its own table-count history ("this line used to say 25, and README said 21 — both were wrong... 31"); `README.md` agrees at 31. `CAPABILITIES.md`'s `sack1`/`pack1` mapping is correct in both places checked; its basis-toggle and register-filter passages now explicitly disclose their own limitations rather than overclaiming. `SPEC.md`'s header is now explicitly marked historical and dated. `nelson.ts` and `CAPABILITIES.md` describe the same, current UI behaviour, not a deleted one. **CANNOT DETERMINE (noted, not tracked as a numbered item):** `CAPABILITIES.md` separately states "23 tables" for the canonical layer alone, a fourth number alongside 21/25/31 — this may simply be a narrower scope (canonical tables only, excluding raw/config tables) rather than a fresh contradiction, but nothing in this pass proved that scope claim either way. Whether `CLAUDE.md` as a whole ever describes uncommitted code as done could not be fully audited in the time available; spot checks found the opposite pattern (the file repeatedly and explicitly retracts its own earlier overclaims), which is reassuring but not a full clearance. |
| Root typecheck excludes web; no root build; stub `dev`; no `engines`/`.nvmrc`; no `.gitattributes`; `q.mjs` not ignored; `plantClock.ts` untracked despite being widely imported | **Mixed — five fixed, one fixed this pass, one still open by design** | FIXED: root `typecheck` now runs across all five workspaces including `web`; a real root `build` script exists; `engines` and `.nvmrc` both exist; `q.mjs` is gitignored; `plantClock.ts` (all three copies — api, shared, web) are tracked and have real commit history. **STILL OPEN (R-15, LOW):** the root `dev` script is still a stub that only prints instructions and exits — not a defect exactly, but the claim is confirmed true. **FIXED, R-16, commit `1350375` (22 Sep 2026):** a repository-root `.gitattributes` now exists (`text=auto eol=lf`, plus explicit `binary` entries for common non-text types). |
| Reader refuses the July shape; epoch 1 seeded closed; `epoch:accept` closes the live generation on re-accept; ordinal is `MAX+1` and breaks chronology — the Jul–Aug gap cannot be loaded as-is | **Confirmed STILL OPEN, by design — carried forward as R-17 (HIGH, IFL-blocked)** | All four sub-parts independently reconfirmed true in the current code: `sync-worker/src/reader/iflTables.ts` explicitly refuses the July table shape by comment; the dev bootstrap seeds the July generations as already closed; `epoch.ts`'s accept path closes whichever generation is currently open before registering a new one; `generation_ordinal` is still `MAX(...)+1` with no chronology check against the source's own creation timestamp. This is not a regression to fix quietly — `CLAUDE.md`'s own Sep 2026 sections already flag the missing 10 Jul – 5 Aug data as the single most consequential open item — but it is worth carrying in this register as a live tracked defect (not just a narrative aside) precisely because it currently blocks loading that data even once IFL sends it. Rated HIGH here, not CRITICAL, because it blocks a valuable but non-essential capability (backfilling a known gap) rather than corrupting or losing data already held. |

---

## Part 2 — Findings from this pass (22 Sep 2026)

Three other workers were editing source files in parallel while this register was written; several of the items below were open when checked and had a fix land in the *uncommitted working tree* during the same session. Status reflects what was actually observed at time of writing, including "uncommitted" where that is the honest answer — re-verify after the next commit if reading this later.

### D-1 — `spc.ts` subgroup sizing, 8×–197× the module's own design target — **HIGH, open**

`api/src/services/spc.ts:176-180` sets `TARGET_PER_SUBGROUP = 20`, `MIN_BUCKETS = 8`, `MAX_BUCKETS = 72`; the file's own header (`spc.ts:15`) documents the intent as "auto-sized to keep ~80 readable points across the range." Measured on live data: a single shift produces 13 subgroups of median 151 readings; a month produces 36 subgroups of median 3,935 — both far above the ~20-per-subgroup target.

**Root cause, confirmed by reading `pickBucketMinutes` (`spc.ts:164-181`) and its caller (`spc.ts:320,370`) rather than assumed:** it is two compounding causes, not one.
1. `days` is computed as the full **calendar** span between `from` and `to` (`days = round((to-from)/86_400_000)+1`), regardless of how much of that span the filtered data (e.g. one 8-hour shift out of a 24-hour day) actually occupies. `totalMinutes` is therefore inflated relative to the real production window whenever a narrow time filter (a single shift) is combined with a wide `from`/`to` day range.
2. `desiredBuckets = round(count / TARGET_PER_SUBGROUP)` is clamped to `MAX_BUCKETS = 72`. For any period producing much above ~1,440 readings (which most shifts and every multi-day period do, given ~8,000 cones/day), this cap dominates: the bucket count stops growing with volume long before the per-bucket population reaches the 20-reading target, so subgroups balloon in direct proportion to how far volume exceeds the cap's implied ceiling.

**Consequence, and a correction to how this was originally briefed to the register author:** the brief that started this pass stated "nothing currently renders the [X̄ control-limit] band, so the visible impact today is limited to subgroup sizing." That is not accurate — confirmed by reading `Weight.tsx:651,668`: `xViolates` (a boolean computed in `spc.ts` from exactly these oversized subgroups' per-subgroup standard error, `σ_within/√n_i`) **does** drive a rendered signal — an accent-filled marker on each violating point, and a "non-random pattern" annotation shown on hover. Because `n_i` here is 8×–197× the size the module was designed for, `σ_within/√n_i` is correspondingly tighter than intended, which means the control band this flag is drawn from is narrower than the module's own design assumes — a live, visible, and directionally-biased-toward-false-positive correctness defect in a chart an engineer could read as "this point is anomalous," not merely an invisible sizing choice. That is why this is rated HIGH rather than LOW/cosmetic: it affects a statement of fact rendered on screen, not just an internal parameter.

**Fix is not attempted here** — this pass touches no source file. The two most direct remedies, for whoever picks this up: base `totalMinutes` on the data's own observed span (min/max timestamp in the filtered set) rather than the full calendar range of `from`/`to`; and/or raise `MAX_BUCKETS` or make it scale with `count` so the target-per-subgroup constraint is not overridden by volume alone.

### D-2 — Weight X̄ chart rendered as a flat line — **HIGH → fixed, uncommitted**

Originally: `Weight.tsx`'s y-domain (`niceDomain([...values, ...marks], {pad:0.15})`, old code) folded the spec limits (±40 g from target) into the same domain as the subgroup means (spanning ~7 g), so the real signal rendered at a measured 3.2 px inside a 204 px plot (1.6% of the chart's height) — a chart that looked flat regardless of what the line was actually doing.

**Status at time of writing: fixed in the uncommitted working tree**, confirmed by reading the current `git diff` for `web/src/screens/Weight.tsx`. The domain now comes from `values` alone; a limit that falls outside `[lo, hi]` is drawn as an edge annotation ("↑ upper limit … off scale") rather than being allowed to widen the domain and flatten the data. A companion change adds a stated noise-floor sentence (`σ_within/√n` in words, via a new `noiseFloor` string in `words.ts:541`) rather than a drawn control band — the same worker's own code comment records that a drawn band was investigated and rejected because ragged live subgroup sizes (see D-1) would swing it 4.5× across one shift. This fix has not yet been committed as of this register's own commit; re-verify the commit lands and carries the same behaviour before marking this row closed for good.

### D-3 — Sacks' fourth figure overflowed into the next figure — **VISUAL → fixed, uncommitted**

Originally: `.fig-val`/`.fig-unit` were `white-space: nowrap` (`app.css`, pre-fix), so Sacks' "100.0% within range" figure — a longer, two-word unit than the other three figures' plain "sacks"/"kg" — had nowhere to break and ran 81 px into the neighbouring figure at 1440px, garbling both.

**Status at time of writing: fixed in the uncommitted working tree.** `app.css`'s current diff (dated in-file "UX PHASE 10, 22 Sep 2026", marked `[PHASE 10 Q1]`) makes `.fig-val` a wrapping flex row and `.fig-unit` `white-space: normal`, so a long unit wraps within its own cell instead of overrunning the next one. Not yet committed.

### D-4 — Right-aligned table column collides with its neighbour on four screens — **VISUAL → fixed, uncommitted**

Originally, on four separate screens: Health's source-generation register printed a generation ordinal directly against its provenance label with no gap ("1IFL copy"); Product Catalogue printed a product id directly against its setpoint ("1024" against "1,960 g"); the cone-weight report printed a delta directly against a flag column ("−10.6 g" against "Flagged"'s Yes/No); the management summary printed a change figure directly against the approval note ("−6,023 (−79.0 %)" against "awaiting IFL's approval"). All four confirmed independently in the source (`web/src/screens/health/SystemHistoryBlock.tsx:96`, `web/src/screens/product/Catalogue.tsx:167-168`, `web/src/screens/report/Summary.tsx:82-92`, and the cone-weight report's own equivalent column) before the fix was found.

**Root cause, one rule, four symptoms:** `app.css`'s base `td` rule pads only on the right (`padding: 9px 12px 9px 0`), and `td.n` (used for every right-aligned numeric column) zeroes even that (`padding-right: 0`) so a genuinely trailing numeric column sits flush to the table's own edge. Every one of these four tables, though, puts another cell *after* the `.n` column — so the "flush to the table edge" rule fired against the next cell's own zero left-padding instead, with nothing to separate them.

**Status at time of writing: fixed in the uncommitted working tree**, and fixed exactly at the root cause rather than four separate patches: `app.css`'s current diff adds `th.n:not(:last-child), td.n:not(:last-child) { padding-right: 12px; }`, restoring the normal gap for any `.n` column that has a sibling after it, while leaving a genuinely trailing `.n` column (Sacks' own register, Weight's KPI rows) untouched. The in-file comment names all four collisions above explicitly. Not yet committed.

### D-5 — Rejects Pareto reason label overflows into the "Name it" control at 1600px — **VISUAL → fixed, uncommitted**

Originally: at 1600px the Pareto's cumulative-share label ("26 · 55% · 55.3% cum.") measured wider than its grid track (155px needed against 121px assigned) and, being `white-space: nowrap`, ran sideways into the neighbouring "Name it" button rather than wrapping. `app.css:525-531`'s own comment on an earlier, related fix (documented in `CLAUDE.md`'s redesign section) shows this general failure mode — a label column computing to less than its content needs in the two-column layout — has recurred before.

**Status at time of writing: fixed in the uncommitted working tree.** The current `app.css` diff removes `white-space: nowrap` from `.bars em`, letting an over-length label wrap onto a second line inside its own track instead of bleeding into the next column — the same fix shape as D-3, deliberately kept inside the column rather than widening it (widening would come out of the bar or name column and reopen the defect the existing 5.5em name-column backstop exists to prevent, per the same in-file comment). Not yet committed.

### D-6 — Reports "with graphics", Q30/Q36 — **requirement gap, tracked in `PROJECT_STATUS.md`, not duplicated here as a code defect**

IFL's 15 Sep 2026 answer to Q30/Q36 asked for reports "beautiful, Excel AND PDF, with graphics" (`handover/IFL-ANSWERS-2026-09-15.md:10`). As of the 15 Sep audit this was fully unbuilt (`FINALIZATION-ASSESSMENT-2026-09-15.md:62`, `AUDIT-2026-09-15.md:690`).

**Re-checked against the code today, and the picture has moved twice since that audit.** As first re-checked in this pass (before the commit below landed): XLSX export was no longer dead code — `api/src/services/reports/xlsx.ts` existed, wired into `GET /api/reports/:type/export?format=xlsx`, audited as `export.xlsx` — but embedded no charts or images. **That has since changed: a parallel worker's commit `f61eb35` ("Excel workbooks gain charts, data bars and a real styling pass") added real chart/drawing/dataBar XML parts to `xlsx.ts`** — confirmed by grep: `chart`, `drawing`, `dataBar` all now appear repeatedly in the file (`NS_CHART`/`NS_XDR` namespaces, `chartSpecFor`, `dataBarKey`, `<cfRule type="dataBar">`), not just in a header comment. **R-18 is therefore FIXED as a side effect, commit `f61eb35`** — the concern that `xlsx.ts`'s header comment overclaimed "with graphics" no longer applies once the file actually ships graphics. Separately, `api/src/services/reports/pdf.ts` (owned by the same parallel worker this pass, per the "Serve a server-rendered PDF for every report type" commit `47ac224`) now exists — a dedicated PDF path beyond browser print, not checked further here since that file is outside this worker's scope.

This is a decision not yet given to the register-writer to answer, so it is recorded here as **flagged, not tracked as a numbered code defect**: whether the current XLSX+PDF combination fully satisfies Q30/Q36 "beautiful, Excel AND PDF, with graphics" is an open product decision for the owner and IFL to confirm by looking at real output, not something this register can certify from reading source. Full tracking of this requirement belongs in `PROJECT_STATUS.md` §5 (IFL dependency) and `KPI-DEFINITIONS.md`, which already carry it.

### D-7 — The rare, unexplained test flake — **FIXED, 22 Sep 2026 (production code)** — see "Fixed" below

**Captured on run 1 of 57** in this pass (`npx vitest run`, default TZ, no shuffle, HEAD `47ac224`):

```
FAIL  web/src/screens/Weight.test.tsx > Weight — the headline > /api/spc REJECTS: headline is couldNotLoad; the honest-empty sentence is absent
AssertionError: expected 'No cones were weighed in this period.' not to contain 'No cones were weighed in this period.'
 ❯ web/src/screens/Weight.test.tsx:160:32
    158|
    159|     await waitFor(() => expect(h1.textContent).toBe(W.couldNotLoad));
    160|     expect(h1.textContent).not.toContain('No cones were weighed in this period.');
```

`waitFor` at line 159 observed the headline correctly reading `W.couldNotLoad` (the failure sentence); by the very next, synchronous line the headline had already changed to the *empty-period* sentence — the two-sided pair this test exists to keep apart. `Test Files 1 failed | 123 passed`, `Tests 1 failed | 1317 passed | 4 skipped`. Full log preserved this session at `.../scratchpad/flake-hunt/A_default_01.log` (ANSI-stripped).

**Mechanism (read from the code, not guessed):** `web/src/screens/Weight.tsx:216` renders `headline(d, sLine, coneLine.error)`, where `sLine = coneLine.data?.data ?? null` (`Weight.tsx:206`) and `coneLine` is a `usePolling` call whose **poll key includes `productId`** (`Weight.tsx:121-132`, key `` `spc-cone:${period.from}:${period.to}:${period.shift ?? 'all'}:${productId ?? 'none'}` ``), and `productId` is itself derived from a *different, independent* fetch: `const productId = st.data?.data.productId ?? null` (`Weight.tsx:115`, `st` = `getWeightStations`). On first render, before `st` resolves, `productId` is `null` and `coneLine`'s key ends `:none`. `coneLine`'s own `/api/spc` call is mocked to always reject, so it correctly sets `coneLine.error` and `headline()` correctly returns `W.couldNotLoad` (`Weight.tsx:511`, `if (coneLineError && !s) return W.couldNotLoad;`) — this is the state `waitFor` observed. If `getWeightStations` then resolves *after* that first `coneLine` error is already set, `productId` changes from `null` to `231`, which changes `coneLine`'s poll key. `usePolling` (`web/src/lib/live.tsx:76-81`) treats any key change as "a different question" and unconditionally clears `data`/`error`/`updatedAt` back to `null` — including a *genuine, still-true* error — the instant before its new fetch (for the new key) has even started. For one render, `coneLine.error` is `null` and `sLine` is still `null`, so `headline()` falls through to `Weight.tsx:518` (`!s || s.count === 0`) and — since `d` (weight-stations data) is already non-null — returns `'No cones were weighed in this period.'` instead of `W.couldNotLoad`, exactly the flip the test caught. The new fetch (key `...231`) then rejects too, `coneLine.error` is set again, and the headline reverts to `W.couldNotLoad` — but by then the assertion has already run against the wrong intermediate frame. This is a genuine race between two independently-resolving fetches (`getWeightStations` and `getSpc`) whose interleaving determines whether the key change happens before or after the first error is visible; it needs no fake timers and no shuffle to trigger, only an unlucky Promise resolution order, which is why it is rare, timing-dependent, and was invisible to 105 prior clean runs across two earlier hunts.

**Reproduction attempts to bound the mechanism (this pass):** running `web/src/screens/Weight.test.tsx` alone, 20/20 clean — consistent with the race depending on interleaving with the rest of the ~124-file suite (CPU/scheduler contention from concurrently-collecting test files shifts microtask timing enough to expose the ordering), matching the earlier "contention" clue from attempt 2. It was **not** reproduced again in 34 further full-suite runs this pass across four other conditions (12 default TZ, 8 `TZ=Asia/Karachi`, 10 `--sequence.shuffle`, 6 as two concurrent `npx vitest run` processes) — consistent with "roughly 1 in 74," not with every condition being equally likely to trigger it.

**Why this is not fixed here:** the root cause is in production code (`web/src/screens/Weight.tsx` and `web/src/lib/live.tsx`'s `usePolling`), and this pass's brief forbids editing production source. Recorded as a **MAJOR / HIGH finding** for whoever owns `Weight.tsx` or `lib/live.tsx` next. Two independent, non-mutually-exclusive fixes are visible from the code (not applied, not endorsed as *the* fix — that call belongs to whoever owns the file): (a) stop deriving `coneLine`'s poll key from `productId` when the *only* thing that changed is `productId` resolving from `null` to a real value on first load (i.e. don't fold "the id we didn't have yet" into a key-change-clears-error event), or (b) have `usePolling` distinguish "key changed because the underlying query genuinely changed" from "key changed because a dependency we needed was still loading" — the latter should not discard a real, already-observed error. This is speculative diagnosis of the fix, not a fix; do not apply either without the owner's review.

**A second, unrelated hygiene gap found by static audit, not shown to cause this or any other failure:** `web/src/testkit/fetchRouter.ts`'s own header comment states the contract — "a test that installs its own router must restore it itself... two different fake-fetch instances stacking silently is worse than one leaking into the next test loudly" — but five of the six `.test.tsx` files that call `installFakeFetch` (`SyncHealthBlock.test.tsx`, `Running.test.tsx`, `Readings.test.tsx`, `PrintHead.test.tsx`, `Weight.test.tsx`) never call `.restore()` or register an `afterEach` to do so; only `hops.test.tsx` follows its own module's contract (`afterEach(() => { openFake?.restore(); openFake = null; })`). Harmless today because every `it()` in those five files reinstalls its own full route set before rendering, so the stub is always overwritten before use — but it is a real, avoidable violation of the module's documented contract and a plausible risk for a *future* test file that renders without installing its own routes. Not the D-7 mechanism (confirmed above); recorded here so the next hunt does not have to re-derive it. **Fixed alongside the mechanism below**, see "Fixed" paragraph.

**Status prior to the fix below: root cause identified and reproduced once with full detail; not fixed (production code, out of that pass's scope).** Run tally from that pass: 57 total (1 full-suite failure on run 1; 12 further default-TZ, 8 `TZ=Asia/Karachi`, 10 `--sequence.shuffle`, 6 two-concurrent-process, and 20 `Weight.test.tsx`-only runs, all clean). Conditions ruled out as the *sole* trigger: TZ, shuffle order, and process-level contention alone are none of them necessary or sufficient — the capture happened under the plainest condition (default TZ, no shuffle, single process), and later attempts at the same condition did not reproduce it, which is exactly what a Promise-interleaving race predicts.

**Fixed, 22 Sep 2026, commit `441f3f9`.** Three fixes were available (see the "two independent, non-mutually-exclusive fixes" paragraph above, plus the consumer-side option it didn't enumerate): (a) change `usePolling` (`web/src/lib/live.tsx`) to not clear `error` on a key change; (b) stop `coneLine`'s poll key from depending on `productId`, or defer it until `productId` settles; (c) make `Weight.tsx`'s `headline()` distinguish "no answer yet" from "no cones exist" instead of conflating them.

**Only (c) was applied.** Reasoning:

- **(a) was rejected.** `usePolling` backs roughly twenty poll sites across nine screens (`Health`, `Line`, `Readings`, `Rejects`, `Report`, `Sacks`, `Wall`, `Weight`, `product/Running`, plus the health blocks and the live-context provider itself). Clearing stale data on a key change is a deliberate, already-shipped decision (Phase 5's `39a5a6e`) that stops a failed refetch from showing a previous period's numbers under a new label; clearing the paired `error` at the same time is the same instinct applied to the error channel, and is *correct* for every consumer whose key changes because the underlying QUESTION changed (a new period, a new station, a new report type — the ordinary case at every other call site, verified by grep: none of the other ~19 `usePolling` keys are built from a value that itself arrives from a separate, independent poll — they're all built from props/URL state/`useState`, available synchronously on first render). Only `Weight.tsx`'s `coneLine`/`spc`/`stationSpc` keys carry `productId` sourced from a *different* poll (`st` = `getWeightStations`). Changing `usePolling`'s semantics to fix that one shape risks quietly changing what every other screen shows on a genuine key change (a stale error surviving into a question it no longer describes) — a worse outcome than the bug, per the brief for this fix. Not touched.
- **(b) was rejected.** `coneLine`'s key including `productId` is not spurious: `getSpc` filters/scopes its answer by `productId` (confirmed in the fixture — `WEIGHT_STATIONS_OK.data.productId = 231`, and the header comment above `coneLine`'s definition, `Weight.tsx:112-114`, states this is "so the chart can draw the LIMITS, not just the target"). Removing the dependency, or gating the fetch until `productId` resolves, would mean `coneLine` never refetches once the real product becomes known — the headline would permanently describe an unfiltered population instead of the correct one. Not touched.
- **(c) was applied, and is sufficient on its own.** `headline()` (`Weight.tsx`) now takes a fourth argument, `coneLineLoading` (`coneLine.loading`), and returns `W.loading` when `(!s || s.count === 0) && coneLineLoading` — i.e. before asserting either "could not load" or "nothing was weighed," it checks whether an answer is even in yet. This works because `usePolling`'s own effect (`live.tsx`) sets `loading` back to `true` in the *same* state batch that clears `data`/`error` on a key change (`setData(null); setError(null); setUpdatedAt(null); ...; setLoading(true)` all run synchronously inside one effect invocation), so the render that used to read as "empty" now correctly reads `coneLineLoading === true` and shows the honest, ungrounded `"Loading…"` sentence instead of asserting the plant had nothing weighed. No change to `usePolling`'s public contract or to any other consumer.
- This also incidentally fixes a related, previously-unnoticed defect on plain first load: even without any key-change race, if `st` (`getWeightStations`) resolves before `coneLine`'s own first `/api/spc` call, the pre-fix `headline()` would show "No cones were weighed in this period." for the ordinary duration of `coneLine`'s first fetch, on every mount, every time — not just during the rare race. This was invisible in the existing tests because they always resolve `/api/spc` on the very next microtask.

**Deterministic reproduction, `web/src/screens/Weight.test.tsx`** (describe block `Weight — the headline`, test `deterministic: coneLine's error is cleared by a productId-driven key change while its refetch is still in flight — the heading must not read as empty`). Rather than hoping for the right Promise-interleaving window, it forces the exact interleaving: `/api/weight-stations` fails once (so the guard at `Weight.tsx:196` opens with `st.error` set and `productId` still `null`) and both `/api/spc` calls that fire on mount (`coneLine`'s and `spc`'s — they share the same key shape and the fake router cannot tell their identical requests apart) also fail; the test then clicks the Stations block's own `Failed`+retry button (`Weight.tsx:412`, wired to `st.refresh`), which this time succeeds with `productId: 231`, changing `coneLine`'s key from `...:none` to `...:231`. The test holds every *subsequent* `/api/spc` call open on a promise it controls, so it can assert the intermediate state directly and synchronously instead of racing for it:

- **RED** (`web/src/screens/Weight.tsx` reverted to its pre-fix `headline()`, isolated run: `npx vitest run web/src/screens/Weight.test.tsx -t "deterministic"`):
  ```
  FAIL  web/src/screens/Weight.test.tsx > Weight — the headline > deterministic: coneLine's error is cleared by a productId-driven key change while its refetch is still in flight — the heading must not read as empty
  AssertionError: expected 'No cones were weighed in this period.' not to be 'No cones were weighed in this period.' // Object.is equality
   ❯ web/src/screens/Weight.test.tsx:261:32
  ```
- **GREEN** (fix restored, same command): `Test Files 1 passed (1)`, `Tests 5 passed (5)`.

**A second reproduction attempt with a `MutationObserver` (recording every value the heading's text node took, including via each mutation's `oldValue` so an intermediate frame collapsed into the same microtask batch as its successor is not silently lost) was tried first and did NOT reproduce the bug** — with both fetches resolving as fast as an already-settled/immediately-rejecting mock allows, React's automatic batching appears to fold the key-change clear and the subsequent re-fetch's settlement into commits close enough together that no wrong frame ever painted in that configuration. This is recorded rather than discarded: it is consistent with the original flake's own rarity (~1 in 74, needing real scheduler contention across ~124 concurrently-collecting test files to separate the two updates into different ticks) and is why the deterministic test above deliberately holds the second fetch open rather than trying to win a timing race the way the original capture did.

**The `installFakeFetch` restore hygiene gap fixed in the same commit:** all five non-compliant files (`SyncHealthBlock.test.tsx`, `Running.test.tsx`, `Readings.test.tsx`, `PrintHead.test.tsx`, `Weight.test.tsx`) gained a module-level `afterEach(() => vi.unstubAllGlobals())` — the alternative the module's own header comment explicitly allows ("or rely on Vitest's own `vi.unstubAllGlobals()` in a project-wide `afterEach`, which this repo does not configure"). `hops.test.tsx`'s existing per-instance `.restore()` pattern was left as-is (already compliant, no reason to unify the two styles in this pass).

**Verification for this fix:** `npx vitest run` clean (129 files, 1348 passed / 4 skipped — was 1347/4 before this pass's one new test), `npm run typecheck` clean (all five workspaces), `npm run build --workspace @sms/web` clean. A loop of 30 consecutive full-suite runs was started after the fix and, in the end, run to completion: **30/30 clean** (`Test Files 128 passed | 1 skipped`, `Tests 1348 passed | 4 skipped`, every single run, no exceptions — the entry was first written at 21/30 while still declining to block on the rest; the loop finished on its own shortly after and this line was updated with the true final count rather than left at the partial one). This is offered as supporting evidence only: the historical rate is ~1 in 74, so 30 clean runs does not prove the fix by itself the way the deterministic reproduction above does — it shows the fix introduced no new regression at the scale this pass could check. The load-bearing proof is the deterministic red/green pair above, not the run count.

### D-8 — `sms.source_epoch.last_seen_utc` has no writer anywhere in the repository — **MEDIUM → FIXED, commit `b31d574` (22 Sep 2026)**

Confirmed again by grep at the start of this pass: `last_seen_utc` is defined in `db/migrations/025_source_epoch.sql:39`, read in `api/src/services/systemHistory.ts:133,156`, and written nowhere — no `UPDATE`/`INSERT` touching that column existed anywhere under `sync-worker`, `api`, or `cli`. This was not silently hidden: `db/dictionary.json:183` documents it as "Reserved; not maintained by the worker today," and both `web/src/lib/words.ts:1195` and `web/src/screens/health/SystemHistoryBlock.tsx:57` explicitly state on screen that the column has no writer rather than showing an unexplained dash.

**Fixed:** `sync-worker/src/epoch.ts`'s `resolveEpoch()` — the one place that has already proven, this pass, that the source IS the currently-open generation (identity and schema checks both pass) — now stamps `last_seen_utc = SYSUTCDATETIME()` on the resolved epoch row once per table per pass. New regression test in `sync-worker/src/epoch.test.ts` asserts the UPDATE and its bound `epoch_id`. **Not done in this same commit, and worth a follow-up:** the two UI call sites that state "no writer" (`web/src/lib/words.ts:1195`, `web/src/screens/health/SystemHistoryBlock.tsx:57`) are in files owned by a parallel worker this pass and were left untouched — they are not wrong (their claim was true when written and remains true of any epoch resolved before this fix runs against it), but once this commit has run against a live database for a while, that copy should be revisited so it doesn't go stale.

### D-9 — Fixed today, included to show the register's own working

Per the brief for this pass, both are re-confirmed against the actual diffs (see the "Verify §17" work above for method) rather than taken on faith from the commit messages alone:

- **Health's headline asserted "Everything is healthy" while the same page showed two blocking DQ findings and an 8-day-stale backup** — `foldStatus()` in `api/src/services/health.ts` computed status from database reachability, the degraded marker, database size and acquisition staleness only, and never consulted the blocking-findings count or backup staleness that the same page already rendered. **Fixed in `de607ce`** ("Health's headline must consult everything it claims to summarise") — both facts now fold into `foldStatus`, verified live: the headline now reads "Something needs attention." against the same data that used to read "Everything is healthy." Suite at that commit: 1253 passed / 4 skipped.
- **Six PDAS materials sharing one plain description ("205-IL0-SD") collided into one indistinguishable entry on Line, Product › Running and Changeover's retire list** — the disambiguation helper `distinctProductLabels()` already existed (built for Rejects' product filter, 15 Sep 2026) but had not been reused on these three later-built screens. **Fixed in `a0c87ba`** ("Disambiguate colliding product names on Line, Product > Running and Changoever's retire list") — Line's 14 stations, Product › Running's six group headings, and Changeover's 12 retire entries are all now distinct, verified live against the running dev server, with a new regression test (`Running.test.tsx`) proven red before and green after. Suite at that commit: 1253 passed / 4 skipped (was 1246/4 immediately before).

### D-10 — X̄ control limits do not fit the process; 503 of ~3,130 subgroups (~16%) "violate" at month scale — **HIGH; limit model replaced and rule-1 rendering restored 23 Sep 2026. Rules 2-8 remain suppressed — see the RESOLUTION at the end of this entry.**

> **RESOLUTION, 23 Sep 2026 — read this before the 22 Sep record below, which is kept
> unedited as the account of what was found and why the marks came off.**
>
> **The limit model was replaced** (`6052b69`, `api/src/services/spc.ts`). The 22 Sep entry
> below names station bias folded into σ_within as the probable mechanism and marks that as
> *not investigated*; it was investigated, and it is **wrong** — station bias (σ_station =
> 3.87 g) inflates σ_within, which WIDENS the band and would explain fewer flagged points,
> not more. The real cause was an unmodelled BETWEEN-subgroup component: `X̿ ± 3·σ_within/√n`
> assumes zero wander between one group and the next, and the observed SD of the subgroup
> means runs 1.76x-3.62x wider than that assumption allows, growing with period length. The
> band is now I-MR on the subgroup means — `X̿ ± 2.66·MR̄`, MR̄ taken only over
> time-contiguous, single-generation pairs — and `spc.ts` reports `xLimits.valid` false
> (forcing every `xViolates` false) below 3 such pairs.
>
> **Rule 1 (`xViolates`) is rendered again** on `Weight.tsx`'s OverTime chart, gated on
> `spc.xLimits.valid` rather than merely on the field being present, together with a factual
> count sentence (`W.weight.outsideBand`) that names the band's own basis in the same
> breath. Measured after the model change, real generations only, on the dev sidecar:
>
> | window | generation | groups | rule 1 | rate |
> |---|---|---|---|---|
> | 2026-06-22 → 2026-07-10 | epoch 1 (July) | 1,660 | 218 | **13.1 %** |
> | 2026-08-05 → 2026-08-20 | epoch 9 (September) | 1,438 | 88 | **6.1 %** |
> | 2026-08-05 → 2026-09-07 | epoch 9 (September) | 2,837 | 159 | **5.6 %** |
>
> Live confirmation on the running app, `?s=weight&p=pick&from=2026-08-05&to=2026-08-20`:
> exactly 88 accent dots drawn, and the sentence "88 of 1,438 group averages fell outside
> the control band…". Forcing `xLimits.valid` false on the same payload took the dots from
> 84 to **0** and printed `W.weight.bandInvalid` instead.
>
> **RULES 2-8 (the Nelson dots) STAY SUPPRESSED, and this is a decision with a number
> behind it.** They now share the corrected `sigmaBetween`, so the old objection ("the same
> ill-fitting band wearing a different name") no longer applies. They were measured anyway,
> on the same three real windows: **54.8 %** of groups flag on July's full range, **38.8 %**
> on 5-20 Aug and **37.6 %** on 5 Aug - 7 Sep — dominated by rule 2 (nine in a row on one
> side: 702/395/713 groups) and rule 6 (four of five beyond 1σ: 731/351/671). That pattern
> is what an autocorrelated, slowly wandering level looks like to rules written for
> independent samples; it is not a plant in crisis and it is not actionable. A mark on two
> groups in five is noise, and restoring a noisy signal is worse than leaving it off — which
> is the whole reason this entry exists. `W.weight.patternsWithheld` now says so on screen,
> so their absence cannot read as "no patterns found".
>
> **A second thing the screen now says, which it did not before.** `getWeightSpc` scopes
> every query to ONE source generation and reports `otherGenerationExcluded` /
> `spansGenerations`. Excluding the others is right — IFL dropped and recreated their
> weighing tables on 5 Aug 2026 and the two are not one continuous record — but excluding
> them *silently* is the no-over-claiming rule read backwards: the chart implied the period
> was fully represented when, on a 21 Aug - 15 Sep window of the dev copy, it was drawing
> 55,058 of the period's 219,942 readings. `W.weight.oneGeneration` states the split in
> words. It deliberately never names HOW a generation arose: the case this must read
> correctly for at IFL is their own rebuild, not this machine's simulator data.
>
> **What is still NOT established.** The new band has not been validated against a
> known-good reference process, only against this plant's own two generations; 13.1 % on
> July is still far above the textbook 0.3 %, which is why the on-screen sentence explains
> what the band is measured from instead of leaving a bare count. Nothing here has been seen
> on real live plant data. `reports/ConeWeight.tsx` and `reports/Calibration.tsx` still
> render no `xViolates`/`nelson` field and were not changed. The per-station drift sparkline
> (`calibration.ts`) remains a separate computation and remains untouched.
>
> Tests: `web/src/screens/Weight.test.tsx`, describe block *"Weight — X̄ rule 1 restored,
> patterns still withheld (DEFECTS.md D-10, 23 Sep 2026)"* — five cases pinning the dot for
> rule 1, no dot for a Nelson-only group, no dot and the band-invalid sentence when
> `xLimits.valid` is false, the exclusion sentence when a period spans generations, and its
> absence when it does not.

`spc.ts`'s D-1 fix (`62263da`, same day) corrected a real defect — subgroups were sized from the requested period's *calendar* span rather than the data's own occupied span, running 8x–297x over the module's own `TARGET_PER_SUBGROUP = 20`. That fix is right and stays; **D-1's own commit message reported, honestly, that correcting the sizing would make the chart flag *more* points, not fewer** (month `xbarOutOfControl` went 44 → 503), and flagged this as expected, not a regression to review away.

Measured after the fix, live `_SEP07` copy, month scale, cone weight, line 1: **~3,130 subgroups, 503 `xViolates` (rule 1) — ~16% of points "out of control."** A stable process at 3σ should show ~0.3%. That is ~50x the expected rate and reads as a limit-model defect, not a plant in crisis: `Weight.tsx`'s Nelson pattern flags (rules 2-8, `Subgroup.nelson`) share the exact same per-subgroup `se = stdevWithin / √n` and `grandMean` as `xViolates` (`spc.ts:505-543`), so both are driven by the same ill-fitting band, not two independent signals corroborating each other.

**Probable mechanism (not investigated further this pass — read from the code, not verified by simulation or a second dataset):** the band is `X̿ ± 3·σ_within/√n_i` (`spc.ts` ~:502-510). A 15-minute bucket contains all ~14 interleaved winding stations, so the persistent 3–12 g station-to-station bias (already surfaced separately by the per-station analysis and the drift sparkline) sits *inside* each subgroup and is folded into `σ_within` — while the *between*-subgroup variation the band is supposed to bound also carries drift, product changes and shift effects that `σ_within` never models. The standard remedy for exactly this shape — limits derived from the moving range of the subgroup means (an I-MR-style band on X̄ itself) rather than from within-subgroup sigma alone — is the likely direction, but this is **explicitly marked as not investigated**: no alternative limit model has been built, tested, or measured against this data. Do not read this paragraph as a decision already taken.

**Fix applied this pass (owner-approved): render suppression, not a limit-model fix.** `web/src/screens/Weight.tsx`'s `OverTime` chart no longer draws the accent-fill dot for `p.xViolates || p.nelson.length > 0` (was: a `<circle fill="var(--acc-fill)">` per flagged subgroup), and the hover readout no longer appends a "non-random pattern" clause off either field. The "Over this period" summary paragraph no longer states `s.xbarOutOfControl`/`s.nelsonFlagged` as counts — that sentence was the identical over-claim in words rather than a mark, and by the same no-over-claiming rule (CLAUDE.md) it had to go with the dots, not survive as a fallback. No sentence was added asserting the process IS in control, which would be the same unsupported claim inverted. `spc.ts` itself is untouched (out of scope this pass, owned by another worker) — both fields stay on the wire for whoever builds the corrected limit model; nothing in `web/` draws them until then.

**Checked and deliberately left alone, with reason:** the per-station drift sparkline on Weight (`stations[].days[].nelson`, rendered `Weight.tsx:830`) is a *different* computation — `api/src/services/calibration.ts`'s per-station-per-*day* means, its own epoch-split day-to-day sigma (`individualsSigma`), and its own `nelsonViolations` call against that day series, entirely independent of `spc.ts`'s X̄ subgroups. It is not proven affected by D-1 or this finding and was not touched. Also checked: `report/ConeWeight.tsx` and `report/Calibration.tsx` render no `xViolates`/`nelson` field at all (verified by grep, zero hits) — the reports are unaffected and needed no change.

**A string this fix could use once someone who owns `words.ts` can add it** (not added — `words.ts` is owned by a parallel worker this pass): a short note under Weight's Details disclosure, near where the removed sentence was, along the lines of *"Per-group violation and pattern counts are not shown: the current control-limit model does not fit this process (see DEFECTS.md D-10) and would overstate special causes."* Left as a gap rather than a hardcoded literal competing with that worker's file.

New test: `web/src/screens/Weight.test.tsx`, describe block `Weight — X̄ violation/pattern suppression (DEFECTS.md, 22 Sep 2026)` — a fixture subgroup with both `xViolates: true` and `nelson: [2, 3]` set, asserting no `circle[fill="var(--acc-fill)"]` is drawn and that neither "control band" nor "non-random pattern" nor any "in control" claim appears anywhere in the rendered screen.

---

## D-11 — Almost no query constrained which SOURCE GENERATION it was reading (23 Sep 2026)

**Severity: HIGH. Partly fixed; the remainder is inventoried below by `file:line`, not summarised.**

IFL dropped and recreated their four weighing tables on **2026-08-05**, restarting every
identity at 1 (`SEPT-2026-EPOCH-DECISION.md`). `sms.source_epoch` exists to keep those
generations apart. An inventory on 23 Sep 2026 of every query reading `sms.cone_event`,
`sms.sack_event` or `sms.reject_event` found:

| | |
|---|---|
| **Constrained** | 2 — `spc.ts getWeightSpc` (fixed the same day, `6052b69`) and `dq.ts loadPriorSackNums` |
| **Correct by partitioning** | 1 — `rejectSpc.ts getRejectSpc`, which groups by `source_epoch` and has never pooled p̄ across the boundary |
| **Unconstrained** | everything else |

This is a defect about **IFL's own rebuild**, not about this laptop. It is *visible* here
because the plant simulator's generation (`DATA_TP1U2_SIM`, epoch 13, 21 Aug – 22 Sep)
**overlaps** IFL's real September generation (`DATA_TP1U2_SEP07`, epoch 9, 5 Aug – 7 Sep) in
time. Measured on the sidecar, 21 Aug – 7 Sep, plausible cones:

| | cones | mean |
|---|---|---|
| pooled — what the app showed | 190,284 | 1951.79 g |
| IFL's own (epoch 9) | **55,058 (29 %)** | 1952.94 g |

The means agree to about 1 g because the simulator's distributions were measured from the
real data, which is exactly why three weeks of pooled counts read as normal to everyone.
Sacks over the same window: 8,509 pooled against 2,310 real — so cones-per-sack was a ratio
across two physically different tables.

**The case that exists at the plant has no simulator in it at all.** Over 1 Jul – 20 Aug on
this same sidecar, `sms.cone_event` holds 75,178 cones of IFL's July generation and 77,493
of their September one, pooled into one figure by every unconstrained query. The fix is
built for that, not for the simulator.

### The worst instance: `downtime.ts` ERASED real events

Every figure there comes from `LAG(production_ts_utc)` over an ordered cone stream. Two
generations interleaved in time make **one** stream, and each fills the other's gaps, so a
genuine stop with another generation's cones inside it yields no gap at all. Measured for
`shift_date` 2026-09-01, where epoch 9 (3,089 cones) and epoch 13 (7,470) overlap hour for
hour:

| | stoppages ≥120 s | downtime | availability |
|---|---|---|---|
| pooled | 12 | 3,301 s | 96.2 % |
| epoch 9 only | **65** | **48,032 s** | **44.1 %** |

53 real stoppages and 12.4 hours of real downtime erased — a line down more than half the
day reported as running 96 % of it. The predicate is now bound **inside** the CTE, where the
window function reads its rows; applied to the CTE's output it would compile, run, and still
be wrong.

### The rule adopted, and the alternatives rejected

`api/src/services/generation.ts` holds it: **restrict to the newest generation present in
the window, preferring a real generation over a simulator one, and then SAY SO.** Every
touched service returns `generationNote` — `{ generation, spansGenerations,
otherGenerationExcluded }` — deliberately the same shape `spc.ts` adopted in `6052b69`, so
the application has one generation vocabulary rather than two.

- **Pooling** (the old behaviour) is wrong for a mean, a rate and a LAG sequence alike.
- **"The generation with the most rows"** was rejected as unstable: the same period's answer
  would flip generation as data accrues, and every figure would jump with it for no reason
  the reader can see.
- **Partition and report both** (the `rejectSpc.ts` shape) is right for a chart whose x-axis
  can carry two series, wrong for a single figure, and would change every payload shape in
  the application. Kept where it already is; not generalised.

Excluding data is the correct answer. Excluding it **silently** is the NO OVER-CLAIMING rule
read backwards — the screen would imply the period is fully represented when it is not.

A generation is keyed on **(source_db, generation_ordinal)**, not on one `epoch_id`: one
generation spans one `sms.source_epoch` row *per source table* (cone gen 3 is epoch 9, sack
gen 3 is epoch 10, reject gen 3 is epochs 11 **and** 12). Getting that wrong would make
cones-per-sack a ratio across two generations, i.e. the defect itself.

"Simulator" is read from `source_db` (`/_SIM$/i`), **not** from `provenance`:
`cli/src/commands/epoch.ts` defaulted `--provenance` to `ifl_copy`, so epochs 13-16 claim
IFL provenance while sitting on the simulator. That default is removed (`6b76ae3`) and those
rows are **deliberately left standing**, so `provenance` alone is not safe to key off. The
`_SIM` test is a safety net; the mechanism is "newest generation, one at a time".

### Fixed (commits `8673ffd` — see below — and `ca34a23`)

`production.ts bindFilters`, `weights.ts dateWhere`, `sacks.ts bindFilters`,
`rejects.ts bindRejectFilters`, `downtime.ts`, `calibration.ts`, `shiftCheck.ts`,
`reconcile.ts`. 23 new tests across `services/generation.test.ts`,
`services/downtime.generations.test.ts` and `sacks.test.ts`, including a period that
genuinely spans the 5 Aug boundary with no simulator in it.

Two further defects found while wiring it, both fixed: `rejects.ts bindConeFilters` would
have bound **`reject_event`'s** epoch to a `cone_event` query; and `getUnmatchedRejects`'s
`NOT EXISTS` now constrains the **cone** side too — without it a reject from one generation
could be "matched" by a cone from another sharing (production instant, hanger), and a reject
wrongly counted as matched drops straight out of the reject-rate denominator, silently.

> **Note on `8673ffd`.** That commit's *message* describes unrelated UI work. A parallel
> worker's bare commit swept this pass's staged files into it. The code is correct and
> intact; its reasoning lives in `generation.ts`'s own file header and in `ca34a23`.

### STILL UNCONSTRAINED — the list, by name

Held by another worker on 23 Sep 2026:

| Site | Note |
|---|---|
| `services/reports/coneWeight.ts:110`, `reports/product.ts:109,119`, `reports/station.ts:72`, `report.ts:231`, `routes/reports.ts:104` | every report. A `generation` parameter on `/api/reports` belongs with them |
| `services/weightStations.ts:634,698,704,730,732` | per-station targets |

Deferred with a reason, not forgotten:

| Site | Why it was not done |
|---|---|
| ~~`services/live.ts:548-651`, `services/health.ts:225,227`, `services/machinesRunning.ts:73,128`, `app.ts:209,341,561`, `envelope.ts:34`~~ | **RESOLVED 23 Sep 2026 — the owner chose the newest REAL generation.** Measurements, the accepted cost, and the sentences the screens now print are in "The five live sites" below |
| `services/register.ts:315` | Already JOINs `sms.source_epoch` for the generation **label** on every row; it does not filter. Listing two generations of rows, each labelled, is defensible for a register in a way it is not for a mean. Left as it is, on purpose |
| `services/sackStock.ts:387,406,538` | Its `priorWeighed` opening-balance query reaches back before `@from` with no lower bound at all, so scoping it needs a decision about what an opening balance *means* across a rebuild. Not a one-line change |
| `services/productAt.ts:502` | limits-vs-scale agreement count — not attempted this pass |
| `services/machineProducts.ts:174,195` | per-machine product grid — not attempted this pass |

### The five live sites — RESOLVED by owner decision (23 Sep 2026)

`live.ts`, `health.ts`, `machinesRunning.ts`, `app.ts` (three queries) and `envelope.ts` were
the five "what is the NEWEST thing we have" queries deferred above because two defensible
rules conflicted. **The owner chose: the NEWEST REAL GENERATION — prefer IFL's own data over
simulator rows.**

They chose it **knowing the stated cost, and did not ask for it to be softened**: the plant-
simulator rehearsal stops driving the live screens, because the simulator is never the real
generation, and `.env` stays pointed at `DATA_TP1U2_SIM`. "Soften the rule to keep the
rehearsal working" was the rejected option and must not be reintroduced.

At IFL this rule is a **no-op**: their generations do not overlap in time and none is
synthetic, so "newest real" and "newest" are the same generation. The simulator is the only
thing it visibly changes, which is exactly why it is safe to adopt — and why the
verification below must be read as a demonstration of the mechanism, not as a plant figure.

**Measured read-only on the development sidecar (`sqlcmd -E` against the app-owned `sms`
database, then re-run through the built services themselves), 23 Sep 2026:**

| Site | Pooled (before) | One generation (after) |
|---|---|---|
| `live.ts` newest reading (cone ∪ reject) | 2026-09-22 12:29:22 | **2026-09-07 12:00:28** |
| `live.ts` acquisition lag, median of 200 | **1,041 s** — all 200 newest raw rows are epoch 13 | **617 s**, epoch 9's own |
| `health.ts` freshness/lag source | whichever generation held the newest rows | epoch 9, stated on screen |
| `machinesRunning.ts` anchor · active stations · cones | 2026-09-22 · 14 · 603 | 2026-09-07 · **8** · **347** |
| `machinesRunning.ts` materials running *at the same 7 Sep anchor* | **6** | **4** |
| `app.ts:209` newest production day | 2026-09-22 | **2026-09-07** |
| `app.ts:341` `/api/range` production days offered | 65 | **34** (2026-08-05 – 2026-09-07) |
| `app.ts:561` product-at clock anchor | 2026-09-22 (a simulator instant) | 2026-09-07 12:00:28 |
| `envelope.ts:34` `transformVersion` | `MAX` over every generation | `MAX` over the one being shown |

**What a wrong answer looked like.** The landing screen defaulted to 2026-09-22, a day on
which the period-scoped services (fixed in `8673ffd`/`ca34a23`) correctly found nothing — so
the app opened on an empty screen. Product › Running reported fourteen machines running six
materials; none of those readings were IFL's, and even at IFL's own newest instant the
pooled grid counted two materials that were running in a different physical table. Worst of
the set: the line state of IFL's September generation was judged against the **simulator's**
acquisition delay, because `ORDER BY raw_id DESC` over `sms_raw.cone_raw` returns the newest
INGESTED rows and all 200 of them are epoch 13. Two halves of one piece of arithmetic,
describing two different tables.

**The consequence is made VISIBLE, which was the condition of taking the rule.** When the
newest real generation has ended while rows keep arriving under another one, the state
arithmetic is correct and its conclusion — "stopped", "idle" — is false about the plant. A
board that says "stopped" when it means "the data I trust ended two weeks ago" is the same
over-claim `fc0e3c3` removed from the Wall, wearing a different hat. So:

- `LiveLine.generation`, `AcquisitionHealth.generation` and `MachinesRunningData.generation`
  carry `GenerationNote` **plus** `newerElsewhereUtc` / `newerElsewhereSourceDb` /
  `newerElsewhereLabel` / `newerElsewhereSimulator` — the newest reading on record that the
  chosen generation does not hold, and which generation owns it. Null means nothing newer
  exists anywhere, the ordinary case at IFL, and then **no sentence is printed at all**.
- **Line** prints the reason directly under its headline, and the headline stops asserting
  the state — a generation that has ended is a third reason the state is not knowable,
  alongside stale sync and a late feed.
- **Wall** does the same: `knowable` is false, so the 79px sentence reads "The state of the
  line is not known" instead of "Line 3 stopped 15 d", and the footer carries the short form
  beside (never instead of) the lag sentence.
- **Health** states which generation freshness, the lag and the newest reading were measured
  from, and how many readings on record belong to a different one and were not measured.
- **Product › Running** states which generation its window is a window into.
- **`/api/range`** returns `generations`: every generation present, with its own day range
  and `offered: true` for the one the range covers. This is not decoration. Scoping the range
  means IFL's own **July generation (2026-06-22 – 2026-07-10) — real data — is no longer
  reachable from the picker**. That is a genuine loss; it is on the wire rather than silently
  gone, and reaching it again needs a generation selector on the period control. **Open
  item**, owner's call, not decided here.

**Invariants kept, each with a test:**

- A generation is keyed **(source_db, generation_ordinal)** — cone gen 3 is epoch 9, sack
  gen 3 is epoch 10, reject gen 3 is epochs 11 **and** 12. Each table binds its own.
- **`provenance` is not trusted**: epoch 13 is registered `ifl_copy` and is the simulator,
  and that row still stands deliberately. `simulator` is derived from `source_db` matching
  `/_SIM$/i`. The rule **degrades to "newest"** when nothing is synthetic, which is the shape
  at IFL; when the *only* generation present is synthetic it is used and `simulator` says so.
- **The 18-minute acquisition lag still measures**, now from the generation it judges:
  `sms_raw.cone_raw.source_epoch` references the same `sms.source_epoch` rows (migration
  025), so the cone fragment applies without translation, and the ordering stays `raw_id`
  (our monotone identity, never IFL's restarted `src_id`).
- **Freshness still comes from the OLDEST source table.** `sms.sync_run` is the worker's own
  log, not an event table, and is deliberately **not** generation-scoped — scoping it would
  have broken the very rule that stops one dead feed hiding behind three healthy ones.
- The run-start predicate is bound **inside** the CTE, where `LAG()` reads its rows — the
  `downtime.ts` lesson, applied to the live screen's own query.
- The scope probe is **cached 60 s** in `live.ts` (the TTL the line identity and shift rule
  already use) and shared by all five sites, so a ten-second poll from every floor PC does
  not add a three-table `GROUP BY` per request. The "what is newer elsewhere" query runs only
  when more than one generation is present — never on a single-generation poll, which is
  every poll at IFL.

**Tests:** `api/src/services/generations.live.test.ts` (22),
`api/src/app.generations.test.ts` (6, over the real Express app), and
`web/src/generationQuiet.test.tsx` (9, two-sided — each also asserts the sentence is ABSENT
in the ordinary single-generation case). The **1969-12-31 boundary** is exercised: 1 cone
under epoch 1 and 1 under epoch 9, two of IFL's own generations with no simulator anywhere
in it, which is the case that exists at the plant. So is the case where the **newest
generation is simulated**.

**Not done, and named.** The UI copy for these sentences lives in
`web/src/lib/generationWords.ts` rather than in `web/src/lib/words.ts`, purely because
`words.ts` was open and uncommitted in a parallel worker's tree when this was written and a
pathspec commit would have swept it. **Fold it into `words.ts`.** `/api/range`'s
`generations` list has no consumer yet — nothing offers the July generation back to the
reader. Nothing here was verified against real plant data; it is the local `_SEP07` + `_SIM`
sidecar throughout, and the running API process was stale, so the figures above come from
the services themselves rather than from an HTTP response. No PDAS procedure was executed,
no `epoch:accept` was run, `sms.source_epoch` was not hand-repaired, and no login was
created.

**A correction to the brief that prompted this work.** `services/operations.ts:473-492`
`resolveDqDestination` was listed as a hazard because `raw_id` is "not unique across
generations". **Measured 23 Sep 2026: it is unique** — 0 duplicate `raw_id` in
`cone_event`, `sack_event` or `reject_event` — because `raw_id` is the **sidecar** raw
table's identity, app-owned and monotonic across generations, not the source's. The column
that genuinely collides is `source_row_id`: **132,552 duplicates in `cone_event` alone**. So
`resolveDqDestination` is sound as written; anything keyed on `source_row_id` is not.

`cli rebuild` scoped by `source_system` and never by `source_epoch`, so it deleted and
re-transformed every generation. Reported out of this pass and fixed separately (`fb44b11`).

**Verified against the local `_SEP07` development sidecar only, never real plant data.** Every
measurement above came from read-only `SELECT`s against the app-owned `sms` database
(`sqlcmd -E`). No `epoch:accept` was run, no login was created, and `sms.source_epoch` was
**not** hand-repaired — epoch 13's mislabelled row still stands, so the registration bug it
proves stays visible.


### D-12 — The PDAS write authority is recorded only in a commit message, and two records contradict each other — **MEDIUM (process/documentation), open, owner's call** (23 Sep 2026)

Found while bringing the IFL-facing documents current. Four facts, each checked on 23 Sep 2026:

1. `handover/IFL-ANSWERS-2026-09-15.md:7` records that as of the 15 Sep meeting the PDAS write
   authority was **still verbal** (Q18), and instructs that `PDAS_WRITE_ENABLED` stay `false`.
2. Commit **`af420a4`** (22 Sep 2026) states in its message: *"IFL granted permission for SMS
   to write product data to PDAS. The owner instructed that the path be enabled."*
3. **No document anywhere in the repository records that grant** — not its date, not who at IFL
   gave it, not which of the nine rights it covers (`grep -rn "IFL granted\|granted permission"
   --include=*.md` returns nothing).
4. `sms/.env` reads `PDAS_WRITE_ENABLED=false` today, so the flag the commit says was enabled
   is off again.

**Why this is a defect and not a note.** The register's own HIGH definition covers "a gap
between what a governing document claims is true and what the code actually does"; this is the
same shape one level up — a grant that governs nine write rights against a client's production
database exists in exactly one place, a commit message, which no IFL-facing document can cite
and no auditor would accept. It is rated MEDIUM rather than HIGH only because the flag is off
and **no PDAS procedure has ever executed against any database, local or plant** (the commit
itself says so and `PDAS_WRITE_ENABLED=false` holds it).

**What it blocks in practice, today:** `IFL-OPEN-QUESTIONS.md` ask 3 cannot be sent. Asking a
client to re-give permission they already gave reads as badly as switching a write path on
against a permission nobody can produce.

**Fix (owner only, not a code change):** state which of 1 and 2 is true, and put it in a
document with a date and a name. If the grant is real, record which of the nine rights it
covers; if it is not, `af420a4`'s message should be corrected in the record.

### D-13 — One `basis` setting answers two different questions; IFL was asked only one of them — **LOW, open (no wrong number today)** (23 Sep 2026)

`sms.weight_rule` has a single `basis` column (`as_recorded | gross | net`) governing **both**
cone and sack weights, plus one `cone_tube_weight_g` and one `sack_tare_kg` (read from the
running dev database, 23 Sep 2026). IFL's 15 Sep answer to Q24 was about **sacks** — "the total
weight of the sack" — and was applied to that shared setting the same day (row 9, `basis =
'gross'`, reason "IFL answer Q24, 15 Sep 2026"). Cone weights are therefore computed on a basis
IFL was never asked about.

**Why LOW and not HIGH, stated precisely so this is not read as worse than it is:** at `gross`
the conversion is the **identity** — the tube weight is subtracted only under `net`
(`api/src/services/weights.ts:239`, `coneAdj = basis === 'net' ? tube : 0`) — and the service
still emits an explicit "Weight basis is unconfirmed (Q4/Q5)" reason naming the exact
consequence, including that Gross and As-recorded are identical until IFL confirms
(`weights.ts:370-375`, `:417`). **No number on any screen is currently wrong.** The defect is
structural: one control answers two questions, and a future `net` selection would silently
apply a **developer placeholder** — `cone_tube_weight_g = 70.00`, `sack_tare_kg = 0.500`,
values IFL has never seen — to every cone figure in the application.

**Fix:** either split the basis per measurement kind, or refuse `net` until IFL has supplied
the real tube and tare weights. Tracked on the IFL side as ask 6 in `IFL-OPEN-QUESTIONS.md`
and N-5 in `IFL-QUESTIONS-STATUS.md`.

### D-14 — `CLAUDE.md` asserted a finding in three places that had been fixed the day before — **LOW (documentation), FIXED this pass** (23 Sep 2026)

`CLAUDE.md:212`, `:301` and `:348` each stated that `sms.source_epoch.last_seen_utc` "has no
writer anywhere in the repository". It has had one since commit `b31d574` (22 Sep 2026):
`sync-worker/src/epoch.ts:176-180` stamps `last_seen_utc = SYSUTCDATETIME()` on the resolved
epoch once per table per pass, with a regression test at `sync-worker/src/epoch.test.ts:112`
asserting the UPDATE and its bound `epoch_id` — both re-read, not taken from the commit
message. The column is still NULL on every row only because no sync pass has run since.

All three sentences corrected in this pass, each rewritten to say what is true *and* why the
column still reads empty, rather than being deleted. **Two UI strings deliberately not
touched** (`web/src/lib/words.ts:1195`, `web/src/screens/health/SystemHistoryBlock.tsx:57`):
they tell a viewer the column has never been populated, which remains true of the live database
until a pass runs, and they belong to another worker's files. They should be revisited once the
worker has run against a database for a while — carried here so that follow-up is not lost.


---

## Part 3 — Suite result observed for this pass

`npx vitest run` from `sms/`, run once at the end of this pass, 22 Sep 2026: **120 test files (1 skipped), 1253 tests passed / 4 skipped.** No red files. This number is consistent with the 1253/4 the two commits above already carried (this pass added no test files, since it touches no source), and it was captured with the working tree in the state described in Part 2 above (uncommitted CSS and Weight.tsx changes from a parallel worker present, `IFL-DEMO-WALKTHROUGH.md` untracked). Carries the same open caveat as every other "green" claim in this project: the D-7 flake is roughly 1-in-74 and this was one run.

---

## Open items index (for quick scanning)

| ID | Severity | One line | Status |
|---|---|---|---|
| R-1 | MEDIUM | PDAS writer caches a rejected connect promise indefinitely | **fixed**, `fc67812` |
| R-2 | MEDIUM | PDAS post-proc bookkeeping inside the same `try` as the write, misleading audit outcome on a bookkeeping-only failure | **fixed**, `fc67812` |
| R-3 | MEDIUM | Failed validation / short retire reason on product-write routes is unaudited | **fixed**, `78c7b85` |
| R-4 | LOW | `seedProducts` issues one sequential MERGE per row, no batching | open — re-verified still true; batching is a bigger change than this pass's "cheap fix" bar, left for the owner to prioritise |
| R-5 | LOW | Only the sync read is retried, not the subsequent write | open — re-verified still true, not attempted this pass |
| R-6 | LOW | Backfill script hardcodes id boundaries measured on this dev database (documented, one-shot) | open, by design |
| R-7 | LOW | `/api/calibration`, `/api/weights`, `/api/calibration/adjustments` unreferenced by any screen | open — re-verified still true, not attempted this pass |
| R-8 | LOW | ~~`web/src/lib/strings.ts` is dead code~~ | **register entry was WRONG** — `strings.ts` is imported by `lib/fmt.ts`, which is imported by 34 files; corrected 22 Sep 2026, no fix needed |
| R-9 | LOW | `@fontsource/archivo`, `@fontsource/dm-mono` unused dependencies | **fixed**, `af72218` |
| R-10 | LOW | `epoch:purge`'s id list is string-interpolated, not parameterised (pre-filtered to integers) | **fixed**, `eb34170` |
| R-11 | LOW | Source-generation identity check is plain string/value equality (documented, intentional) | open, by design |
| R-12 | LOW | `backup-appdb.ps1`'s `-Server` default is a dev-only port | open — re-verified still true; every documented usage overrides it explicitly, judged low enough risk not to touch blindly this pass |
| R-13 | **HIGH** | `sms_app` login has `db_ddladmin`, can alter/drop `audit_log`'s own append-only trigger | **fixed before this pass**, `523e3b4` |
| R-14 | LOW | `auth.ts` comment claims a router-walk test that does not exist | **fixed**, `39ffb58` |
| R-15 | LOW | Root `dev` script is a stub | open, by design |
| R-16 | LOW | No `.gitattributes` in the repository | **fixed**, `1350375` |
| R-17 | **HIGH** | The reader/epoch machinery cannot load the 10 Jul – 5 Aug archive as-is, even once IFL sends it | open, IFL-blocked — explicitly out of scope this pass (design job, not a bug fix) |
| R-18 | LOW | `xlsx.ts` doesn't state in its own comment that it ships data-only, no charts | **fixed as a side effect**, `f61eb35` (a parallel worker added real charts/dataBars, so the premise — data-only — no longer holds) |
| D-1 | **HIGH** | `spc.ts` subgroups run 8×–197× the module's own 20-reading design target, tightening the control band `xViolates` renders as a visible pattern flag | open — **skipped this pass, contention**: `api/src/services/spc.ts` is owned by another worker this pass |
| D-2 | HIGH | Weight X̄ chart's y-domain used to include spec limits, flattening the real signal to 1.6% of the plot | fixed, `c714666` |
| D-3 | VISUAL | Sacks' fourth figure overflowed into the next figure | fixed, `cb197f9` |
| D-4 | VISUAL | Right-aligned table columns collided with their neighbour on four screens (one root cause) | fixed, `cb197f9` |
| D-5 | VISUAL | Rejects Pareto label overflowed into the "Name it" button at 1600px | fixed, `cb197f9` |
| D-6 | — | Reports "with graphics" (Q30/Q36) — requirement gap, tracked in `PROJECT_STATUS.md`, not a numbered code defect here | open, IFL/owner decision — XLSX now has charts (`f61eb35`) and a PDF generator exists (`47ac224`, `pdf.ts`), narrowing but not closing the requirement-gap question |
| D-7 | HIGH | Weight.tsx headline flips to the wrong sentence when `getWeightStations` resolves after `coneLine`'s first error, changing its poll key and wiping a real error (`usePolling` key-change semantics) | **fixed**, `441f3f9` — `headline()` now checks `coneLine.loading` instead of touching `usePolling`'s shared key-change semantics; deterministic regression test added |
| D-8 | MEDIUM | `sms.source_epoch.last_seen_utc` has no writer | **fixed**, `b31d574` |
| D-10 | **HIGH** | X̄ control limits (`grandMean ± 3σ_within/√n`) do not fit the process — ~16% of subgroups "violate" at month scale post-D-1 vs an expected ~0.3% | **model replaced** (`6052b69`, I-MR on the subgroup means) and **rule-1 rendering restored** 23 Sep 2026, gated on `xLimits.valid`; rule-1 rate now 5.6–13.1% on real generations. **Rules 2-8 stay suppressed** — measured 37.6–54.8% flag rate on the same windows. Band not validated against a known-good reference process. |
| D-11 | **HIGH** | Almost no query constrained which SOURCE GENERATION it read; `downtime.ts` ERASED 53 real stoppages on one measured day | **partly fixed** (`8673ffd`, `ca34a23`, `fc27b60`, and the 23 Sep live pass) — the shared filter builders, downtime/calibration/shiftCheck/reconcile, register/sackStock/productAt/machineProducts, and now the five live sites (`live.ts`, `health.ts`, `machinesRunning.ts`, `app.ts`, `envelope.ts`) read ONE generation and say what they excluded; **reports and `weightStations.ts` remain unconstrained**, listed by `file:line` in D-11 above |
| D-12 | MEDIUM | PDAS write authority exists only in commit `af420a4`'s message; `handover/IFL-ANSWERS-2026-09-15.md` says it was still verbal and no document records a grant | open — **owner's call**, blocks sending `IFL-OPEN-QUESTIONS.md` ask 3 |
| D-13 | LOW | One `sms.weight_rule.basis` governs cones and sacks; IFL's 15 Sep answer covered sacks only, and `net` would apply placeholder tube/tare values | open — no wrong number today (`gross` is the identity conversion, `weights.ts:239`) |
| D-14 | LOW | `CLAUDE.md` asserted in three places that `last_seen_utc` has no writer; it has had one since `b31d574` | **fixed** this pass (23 Sep 2026) |
