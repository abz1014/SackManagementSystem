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


### D-12 — The PDAS write authority is recorded only in a commit message, and two records contradict each other — **MEDIUM (process/documentation) → RESOLVED 24 Sep 2026 (owner's statement)** (23 Sep 2026)

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
and **`PDAS_WRITE_ENABLED=false` holds it** — the plant itself has never been written to and
this entry's severity does not change on that basis. **Correction, 23 Sep 2026 (WS-PDAS2):** the
parenthetical this entry originally carried — "no PDAS procedure has ever executed against any
database, local or plant" — is no longer accurate and should not be read as current. Two
authorised passes on 23 Sep 2026 (`PDAS-EXECUTION-2026-09-23.md`, and `CLAUDE.md`'s WS-PDAS2
section) executed `AddTubeType`, `CreateMaterial` and `SetMaterialStatusActive` **against the
local `PDAS_TP1U2_SEP07` copy on `.\SQLEXPRESS` only**, each time from a proven-restorable
backup, each time restored to the exact pre-execution state afterward, by hand via `sqlcmd -E`
under Windows auth — never through `sms_pdas_writer`, never through `pdasWrite.ts`'s own
connection path, never with `PDAS_WRITE_ENABLED` on, and never against the plant. That local
execution does not resolve D-12's own finding (the grant is still undocumented outside a commit
message) and does not change this entry's MEDIUM severity.

**What it blocks in practice, today:** `IFL-OPEN-QUESTIONS.md` ask 3 cannot be sent. Asking a
client to re-give permission they already gave reads as badly as switching a write path on
against a permission nobody can produce.

**Fix (owner only, not a code change):** state which of 1 and 2 is true, and put it in a
document with a date and a name. If the grant is real, record which of the nine rights it
covers; if it is not, `af420a4`'s message should be corrected in the record.

**RESOLUTION, 24 Sep 2026 (owner's statement).** The project owner states, on 24 September
2026, that the contradiction above is resolved. **Who:** Hassan sb, IFL (role not recorded
anywhere in this repository). **When:** 19 September 2026. **Form:** a written WhatsApp message
to the SMS project owner, sent directly to the owner and held by the owner; it is not itself in
this repository, though an export or screenshot of it may be added under `handover/` at the
owner's discretion. **Scope:** the owner states the message covers all nine rights listed in
`IFL-OPEN-QUESTIONS.md` item 3, quoting IFL as giving "complete autonomy and permission to
enable and work on the PDAS changing the DB," and states this covers both the local test copy
and the plant. The owner notes the WhatsApp wording does not name the nine rights individually:
**that "all nine" is the owner's reading of the message, not a rights-by-rights confirmation
in IFL's own words.** Process engineers will be the users of the resulting workflow.
**Timeline, for the record:** 11 Sep, 2 of the nine rights were confirmed (the form of that
confirmation was not recorded, per `CLAUDE.md` hard constraint 3 as it stood before this
change, not from the owner's 24 Sep statement); 15 Sep, the authority was
verbal only (true as of that date,
per `handover/IFL-ANSWERS-2026-09-15.md`); 19 Sep, the written WhatsApp message above; 22 Sep,
commit `af420a4` enabled the flag locally only, against the local `PDAS_TP1U2_SEP07` copy, per
that commit's own message. Read this way, the 15 Sep record and `af420a4`'s message were each
true at their own date, and the "contradiction" this entry originally reported was a timeline
gap, not two records disagreeing about the same date. **What this resolution does not change:**
the code path (`pdasWrite.ts`, `/api/changeover/execute`) has still never run end to end; the
plant stays off until Steps 2-5 run on the owner's Windows laptop: all nine rights exercised
through our code against `PDAS_TP1U2_SEP07`, with backups, failure paths, and an EXECUTE-only
"ibrahim"-shaped login rehearsal, plus any fixes those runs surface. `Q21` zero-modification
still applies in full to `DATA_TP1U2`. The PDAS exception this grant covers stays bounded to the
nine rights already named: no new objects, no `DELETE`, no other table. `PDAS_WRITE_ENABLED`
reads `false` in `sms/.env` today, and its comment (which currently reads "ENABLED 22 Sep 2026
... IFL granted permission" above a `=false` value) is the owner's to correct; this pass only
flags that inconsistency, it does not edit `sms/.env`. **Left to do:** IFL's own formal
confirmation, tracked as `IFL-OPEN-QUESTIONS.md` item 3, and provisioning of
`sms_pdas_writer`. See `handover/PDAS-WRITE-GRANT-2026-09-19.md` for the citable record of this
statement.

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
| D-12 | MEDIUM | PDAS write authority exists only in commit `af420a4`'s message; `handover/IFL-ANSWERS-2026-09-15.md` says it was still verbal and no document records a grant | **resolved 24 Sep 2026 (owner's statement):** written WhatsApp grant, Hassan sb, 19 Sep 2026, owner's reading covers all nine rights, see `handover/PDAS-WRITE-GRANT-2026-09-19.md`; plant stays gated on the local end-to-end proof (Steps 2-5) |
| D-13 | LOW | One `sms.weight_rule.basis` governs cones and sacks; IFL's 15 Sep answer covered sacks only, and `net` would apply placeholder tube/tare values | open — no wrong number today (`gross` is the identity conversion, `weights.ts:239`) |
| D-14 | LOW | `CLAUDE.md` asserted in three places that `last_seen_utc` has no writer; it has had one since `b31d574` | **fixed** this pass (23 Sep 2026) |
| RT-001…036 | mixed | 23 Sep 2026 red-team audit findings — see Part 4 below for the full table | mixed, see Part 4 |
| D-15…D-23 | mixed | Defects found DURING the RT- fix wave, not present in the audit itself | see Part 4 |
| RT24-01…13 | mixed | 24 Sep 2026 red-team audit findings (`ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md`) — see Part 6 below for the full table | **all 13 now fixed or extended** — RT24-10/11/12/13 and RT-014 closed this pass, see Part 7 |
| D-27 | HIGH | `shift_rule_drift` DQ check false-positived 20,000/20,000 rows — `mssql` returns BIGINT as a JS string, `new Date(<string ms>)` parses it as an invalid date string, not milliseconds | **fixed**, `32e9d0d` — see Part 7 |
| D-28 | MEDIUM | `eventMsOfRaw` threw a bare `TypeError` (`.getTime()` on `undefined`) naming neither the row nor its table, on a raw row missing both production and insert time | **fixed**, `95b3aff` — see Part 7 |
| D-29 | LOW | 2 `sms.cone_event` rows carry `production_ts_utc_ms` before year 2000 (min 0 — an epoch-zero phantom timestamp) | **closed 25 Sep 2026 — vendor source sentinel, unreachable from every screen, already DQ-flagged; regression test `b4284ac`** — see Part 8 |
| D-30 | HIGH | Health › sync verdict (and Bar's alarm, Wall's dot, `assessHealth`'s default) fell through to "OK" for `lag_unknown`/`no_data`/a missing or unknown health kind — a false all-clear | **fixed 25 Sep 2026**, `5b2b56a` — see Part 8 |
| D-31 | MEDIUM | Changeover plan review threw on a plan without `blockers` (the PDAS write gate) | **fixed 25 Sep 2026**, `5b2b56a` — Execute disabled, safety checks named unreadable |
| D-32 | LOW | Product › History sort threw on a row without `changedAt` | **fixed 25 Sep 2026**, `5b2b56a` |
| D-33 | LOW | `sms/DEPLOY.md`'s wall-display example used `--role=operator`, refused by the CLI since migration 035 | **fixed 25 Sep 2026**, `39c2c37` |
| D-24 | MEDIUM | `pdasWrite.ts`'s post-commit echo-back check reads, run inside the same `try` as the write itself (Add*/CreatePallet/SetPalletActive), or entirely unguarded (`updateProductLimits`), misreported a committed write as failed when the check read itself failed | **fixed 24 Sep 2026**, `bdbb0eb` (B1/B2) |
| D-25 | MEDIUM | `planChangeover` compared a requested new blend/count/tube name to existing rows by exact equality only, so a name that is a `LIKE`-pattern match for an existing row (T-SQL wildcard collision, e.g. `"R_D"` vs `"RED"`) planned clean and only failed mid-sequence against PDAS's own duplicate check | **fixed 24 Sep 2026**, `a9b85b5` (B4), new `api/src/services/likePattern.ts`; proven by F3b, `PDAS-EXECUTION-2026-09-24.md` | 
| D-26 | MEDIUM | `changeover.ts`'s `resolveTube` compared candidate tube types by name only; `sms.tube_type` carried no `tube_form` column, so it could either silently reuse a wrong-form tube type PDAS would have accepted as new, or over-block a same-form name that only collided by `LIKE` pattern against a different form | **fixed 24 Sep 2026**, `d6a58d4` (migration `041_tube_type_form.sql` + `changeover.ts`/`pdasWrite.ts`'s `addTubeType` MERGE/`seedProducts.ts`); **proven live 24 Sep 2026** — the final re-run section of `PDAS-EXECUTION-2026-09-24.md`: `AddTubeType` writes `tube_form` into the mirror (TubeTypeId 28, `tube_form=2`, matches PDAS's own `TubeForm`), and a plan-only `resolveTube` check confirms same-name/same-form plans `reuse` while same-name/different-form plans `add` |

---

## Part 4 — `ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md` (commit `d2cba5e`) and its remediation wave

**This part is written after Parts 1–3 above (D-1…D-14, committed through `b31d574`/`f3b0c4b`), which were already on `HEAD` when the red-team audit landed.** The audit (13 workers, committed `d2cba5e`) found 8 CRITICAL + 28 further HIGH/MEDIUM/LOW findings — RT-001…RT-036 — against the tree as it stood at that commit, i.e. **after** D-1…D-14 were already fixed. A fifteen-commit remediation wave followed, `016a047`…`cf1c363` (HEAD at the time of writing). Every status below was checked against the code at `cf1c363`, not taken from a commit message alone — file:line spot checks are noted where done.

### RT- finding disposition

| ID | Severity | One line | Status |
|---|---|---|---|
| RT-001 | CRITICAL | Line reject-rate figure disagreed with itself, contaminated by a mislabeled simulator generation | **fixed** — `ae7a59b` (Line.tsx denominator now matches `report.ts`'s `cones + unmatchedRejects`), `53ae8a3` (rejectSpc.ts headline prefers real generation over simulator) |
| RT-002 | CRITICAL | Station-report row arithmetically impossible (more within-tolerance cones than cones produced) | **fixed** — `54601a6` (`reports/station.ts` now resolves and binds its own `resolveGenerationScope`) |
| RT-003 | CRITICAL | Daily report's "rejected by the scale" inflated ~29× by simulator rows against a real-only denominator | **fixed** — `54601a6` (`reports/daily.ts` scoped query), then `b9ff556` switched it to the shared `register.ts::countEvents` once that existed |
| RT-004 | CRITICAL | Client-side reject-rate re-derivation on Line/Rejects disagreed with the server's corrected figure | **fixed** — `ae7a59b` (both screens now sum the server's own scoped totals rather than re-deriving) |
| RT-005 | CRITICAL | Line rendered a confident "0 cones / 0 sacks / 0 kg / 0 rejected" from a 200 with fields silently missing | **fixed** — `71757a3` (`production.ts`'s `readNum` distinguishes a real zero from an absent field, emits `dataIssues[]`), `ae7a59b` (Line.tsx consumes `dataIssues`), `016a047` (field-stripped fixture added to the test harness so this class is now reproducible in CI) |
| RT-006 | CRITICAL | A zero-lag-sample edge case reprinted the "false stopped" defect a 2 Sep 2026 fix was built to kill | **fixed** — `7558854` (new `LiveHealthKind = 'lag_unknown'`, treated as unknowable rather than folding to `'ok'`) |
| RT-007 | CRITICAL | Line's own provenance banner was false for the exact data it sat above | **fixed** — `19a4aa0` (`quietBecauseGeneration` now derives both halves of its claim from `generationNote`'s own `simulator` flags instead of only the excluded side) |
| RT-008 | CRITICAL | Root cause: the currently-open live generation is the plant simulator, mislabeled as genuine IFL data | **fixed by owner decision, predates this wave** — the "five live sites" (`live.ts`, `health.ts`, `machinesRunning.ts`, `app.ts`×3, `envelope.ts`) were resolved in the pass immediately before the audit landed (commits `6052b69`/`8673ffd`/`ca34a23`/`fc27b60`, documented in Part 3's D-11 above): the owner chose "newest real generation, name what's excluded" over pooling. RT-001–007/009 are the same root cause surfacing in report/screen code that D-11's wave had not yet reached; this wave closes those. **Not re-verified live against a running server this pass** — verified by reading `generation.ts` and its ~20+ call sites only. |
| RT-009 | HIGH | Per-product weight statistics pooled simulator with real data | **fixed** — `54601a6` (`reports/product.ts` scoped) |
| RT-010 | HIGH | `getReport`'s "coverage" block ignored generation scoping | **fixed** — `26525ad` (`report.ts`'s `coverageReq` now resolves its own scope and applies `andEpoch`; the `generationScope.guard.test.ts` `KNOWN_DEFECTS` entry naming this gap was deleted, not just marked) |
| RT-011 | HIGH | Reject-rate/SPC trend charts plotted a missing bucket as a literal, indistinguishable zero | **fixed** — `add32c5` (`report/shared.tsx`'s `RejectTrendChart` now breaks into a gap instead of drawing 0%) |
| RT-012 | HIGH | Line/Wall's KPI layer collapsed "missing field" into "true zero" structurally | **fixed** — `ae7a59b` (Line), `add32c5` (Wall's `absent` station status, distinct from `quiet`) |
| RT-013 | HIGH | Wall's per-station bars silently rendered a stripped field as "quiet", the one screen with no drilldown | **fixed** — `add32c5` (same commit as RT-012's Wall half) |
| RT-014 | HIGH | No server-side response-size/row-count cap independent of SQL (DoS-adjacent) | **open — not addressed by this wave.** No commit among the fifteen touches request/response size limiting; grepped for `MAX_ROWS`/size-limit middleware, none found added. Carried into `COMMISSIONING-GAPS.md`. |
| RT-015 | HIGH | Malformed/missing/null production rows silently coerced to zero, server-side | **fixed, at least for the two files exercised: `production.ts` and `register.ts`.** `71757a3` (`production.ts::readNum`), `410c179` (`register.ts::foldGenerationTally`/`countEvents`, a second NaN→null defect found mid-pass, see D-19 below). Not confirmed fixed everywhere the audit may have meant — no full-repo sweep for the same `?? 0` / bare `Number()` pattern was done this pass. |
| RT-016 | MEDIUM/HIGH (audit rated as calendar-invalid-date crash) | A calendar-invalid date crashes the DB driver instead of app-level validation, on 9 of 9 endpoints tried | **open — not addressed by this wave.** No date-validation commit among the fifteen. **Fixed 28 Sep 2026, all three surfaces — query timestamps (`5d42cf5`), query dates (`11ce30b`, predates this wave), sack-stock form field (`60d397f`) — see Part 9.** |
| RT-017 | HIGH | MachineProduct report clips ~82% of its columns on screen, no in-app fallback | **fixed 25 Sep 2026**, `fb9fd9d` — see Part 8 |
| RT-018 | HIGH | A retired product is shown as the live weight target with no marker | **fixed 25 Sep 2026**, `c52a34d` — see Part 8 |
| RT-019 | HIGH | Nelson rules, unsuppressed, flag 78.6% of stations / 12.7% of station-days | **closed 25 Sep 2026 as a decision, by evidence: rules 2–8 stay withheld; EWMA was tried at two granularities and failed on real data** — see Part 8. Original status: **open, owner decision pending** — this is the same item as `DEFECTS.md` D-10's "Rules 2-8 stay suppressed" resolution (23 Sep, predates this wave): four options were put to the owner, none chosen yet. Re-measured this wave at 37.6–54.8% on real generations after the limit-model replacement (still noise, still withheld). |
| RT-020 | HIGH | Days-to-limit projections print precise numbers from 3–5 noisy points, no confidence interval | **fixed 25 Sep 2026**, `b182297` — see Part 8 |
| RT-021 | HIGH | A 1970 clock-fault sentinel hijacks the live "anchor" under replay, at two independent call sites | **fixed, and a THIRD site was found while fixing it** — `7558854`'s own commit message names three anchor queries floored (`live.ts`'s data tip, `health.ts`'s acquisition tip, `machinesRunning.ts`'s running-grid anchor), one more than the audit's own header text ("at two independent call sites"). Recorded as D-15 below. |
| RT-022 | HIGH | Weight basis/tare/shift-boundary rules read as "whatever is current", never "whatever was in force" | **open — not addressed by this wave.** Overlaps `DEFECTS.md` D-13 (LOW, already tracked, no wrong number today because `gross` is the identity conversion). |
| RT-023 | MEDIUM | The running API process was serving code 26 minutes older than its own rebuilt `dist/` | **cannot determine — operational fact, not a code defect.** No commit fixes "restart the process"; whether the currently-running process (if any) is stale cannot be assessed by reading source. Not re-verified this pass. |
| RT-024 | MEDIUM | `.env`'s `PDAS_WRITE_ENABLED` comment claims IFL authority was granted; the value says the gate is closed | **authority half resolved by D-12's 24 Sep 2026 resolution** (owner's statement: written WhatsApp grant, Hassan sb, 19 Sep 2026); **the stale `sms/.env` comment itself is still open:** `PDAS_WRITE_ENABLED=false` still holds and the comment above it still reads "ENABLED 22 Sep 2026 ... IFL granted permission," which is now out of date given the flag's actual value, and is the owner's to correct, not this pass's to edit. Same finding as `DEFECTS.md` D-12, not a duplicate entry, cross-referenced. |
| RT-025 | MEDIUM | `shift_code` baked in at ingest, never recomputed; a brief mixed-shift-rule regime confirmed real | **open — not addressed by this wave.** |
| RT-026 | MEDIUM | Client/server rank crosscheck covers only ~6 of ~25–32 elevated-rank routes | **open — not addressed by this wave.** `rank.crosscheck.test.ts` was not touched by any of the fifteen commits (checked by `git log --oneline -- web/src/rank.crosscheck.test.ts` since `d2cba5e`: no hits). |
| RT-027 | MEDIUM | Misleading "Login failed" message masks three distinct DB-connection causes | **open — not addressed by this wave.** |
| RT-028 | MEDIUM | `/api/production`/`/api/weights` missing the shared 366-day range cap | **open — not addressed by this wave.** |
| RT-029 | MEDIUM | Two reject-headline fields on `Rejects.tsx` generation-mixed while `pBar` was correctly scoped | **fixed** — `ae7a59b` (Rejects.tsx headline now sums `q.generations[].totalInspected`, the population `report.ts`/`weightStations.ts`/`rejectSpc.ts`'s p-chart already agree on) |
| RT-030 | MEDIUM | `CLAUDE.md`'s clock-fault-row count is stale | **not addressed by this wave** (this worker's remit is documentation, but this specific line was not touched this pass — see "What I did not get to" below) |
| RT-031 | MEDIUM | `sms.plausibility_rule`/`weight_rule`/`shift_rule` time-versioning gap | **open — not addressed by this wave**, overlaps RT-022/D-13 |
| RT-032 | MEDIUM | `medianConeWeight`'s report-query fallback unscoped | **fixed** — `54601a6` (`coneWeight.ts` gained an optional `GenerationScope` parameter, applied when the report runs the fallback query itself) |
| RT-033 | LOW | Sacks summary headline has no presence guard on `t.sacks` | **fixed** — `add32c5` (the actual failure mode was `Math.round`/subtraction producing the literal string `"NaN"`, not a thrown error or a plain zero; a `finiteOrNull` guard closes it) |
| RT-034 | LOW | Unknown filter id and valid-but-zero-data filter id indistinguishable | **open — not addressed by this wave.** |
| RT-035 | LOW | Plain-HTTP cleartext session cookie (informational) | not a code defect; no fix expected or made |
| RT-036 | LOW | A live ngrok tunnel exposes a different application (informational) | not a code defect; environmental, no fix expected or made |

**Phase-board contradiction claims (`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md`, "Roadmap phases directly contradicted", lines ~1381-1395), re-checked against the fix wave:**

- **Phase 5 (Reject management)** — audit cited RT-001/003/004. **All three now fixed.** The contradiction the audit raised no longer holds against `cf1c363`.
- **Phase 4 (Cone weight module)** — audit cited RT-002. **Fixed.** No longer contradicted.
- **Phase 11 (Security & operations)** — audit cited RT-014 and RT-015. **RT-015 fixed** (production.ts/register.ts); **RT-014 still open** (no response-size cap exists anywhere in the fifteen commits). The contradiction is narrower than the audit stated but not closed — see `PROJECT_STATUS.md`.

### New defects found DURING the fix wave, not present in the audit — D-15 through D-23

**D-15 — RT-021's fix touched a THIRD anchor site the audit's own text did not name — LOW (documentation gap in the audit, not a code defect)**

`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md:859` headlines RT-021 "at two independent call sites"; commit `7558854`'s own message and diff floor **three**: `live.ts`'s data tip, `health.ts`'s acquisitionHealth tip, **and** `machinesRunning.ts`'s running-grid anchor. All three are fixed by the same commit, so this cost nothing to close, but the audit document itself (which this worker may not edit) undercounts its own finding by one site. Recorded here as the correction; `ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md` is left as the dated record of what was written.

**D-16 — `getUnmatchedRejects` cross-generation false match — MEDIUM, fixed, `5b46d9b`**

Found while scoping `weightStations.ts`'s reject-rate queries (WS-A1): `rejectRatesByStation` called `getUnmatchedRejects` with no generation scope, so a reject in one source generation could be "matched" — and wrongly excluded from the reject-rate denominator — by a cone in a *different* generation sharing `(production_ts_utc_ms, hanger_num)`. Not an RT- finding; found by the worker building the two-generation regression fixture, who then verified `getUnmatchedRejects`'s own scoping parameter (already built, previously unused) closed it. Proven: 4 truly-unmatched rejects when scoped vs 13 when called unscoped on the same window.

**D-17 — `rejectSpc.ts`'s generation-selection policy silently diverged from the canonical rule — HIGH, fixed, `53ae8a3`**

Found while building the two-generation fixture for `2e6acd1` (a coordinator review commit, not a fix): `rejectSpc.ts`'s headline `pBar` picked the ordinally NEWEST generation with no real-vs-simulator preference, while `generation.ts`'s `resolveGenerationScope` (used by `weightStations.ts`/`production.ts`) prefers a real generation regardless of recency. On the dev sidecar the simulator's generation is ordinally newer, so for the 21 Aug – 7 Sep window the Rejects screen's own headline resolved to the *simulator's* rate while Weight and the reports resolved to the *real* rate — a live three-way disagreement distinct from the pooling defect WS-A1 was fixing. Fixed by giving `rejectSpc.ts` the same real-preferred rule via its own copy of the predicate (see D-18 immediately below for why that copy was itself later closed).

**D-18 — `spc.ts` carried a THIRD independent copy of the same generation-preference rule — HIGH, fixed, `e7534e9`**

Found immediately after D-17 landed: `getWeightSpc` (`spc.ts`) had its own hand-rolled copy of "prefer real over simulator, then newest ordinal" — a third copy beside `generation.ts`'s canonical `resolveGenerationScope` (18 call sites) and `rejectSpc.ts`'s copy from D-17, which had *just* been shown to silently diverge. `spc.ts`'s inline copy agreed with the canonical rule only because nobody had yet made it diverge — the same precondition that was true of `rejectSpc.ts` until D-17. Fixed by importing `resolveGenerationScope`/`epochFragment` directly rather than re-deriving the rule a third time; this also dropped a second, smaller policy divergence (spc.ts had folded shift/station/`col IS NOT NULL` conditions into its own generation-detection query, which none of the 18 canonical call sites do).

**D-19 — `register.ts` had two separate defects, both found in the same pass, both fixed, `410c179`**

1. `register.ts::listEvents.total` (a bare `COUNT(*)`) was consumed by `reports/sack.ts` and `reports/summary.ts` as a scoped figure when it was in fact pooled across every generation in the window — the same class of defect as RT-002/003/029 but in a file none of those commits' authors owned at the time. Fixed by adding a new, separately-scoped `register.ts::countEvents`, rather than adding an optional scope parameter to `listEvents` (which is deliberately a row-listing with per-row generation labels, used correctly as-is by the register route itself).
2. **Found mid-pass, a second and unrelated defect in the same file:** `foldGenerationTally` and `countEvents`'s own first draft used bare `Number(r.n)`/`Number(res.recordset[0]?.n ?? 0)`. A tally row with its `n` column *absent* (not SQL NULL) became `NaN`, and `JSON.stringify({total: NaN})` serializes as `{"total":null}` — confirmed directly in `register.presence.test.ts`. Downstream, `web/src/screens/Sacks.tsx`'s history block read `rows.data?.data.total ?? 0` and rendered `<Empty>` on that `null`-turned-0, i.e. a malformed count read as "no sacks this period" even while a separate, unaffected query (`rows`) still held real data. Fixed by mirroring `production.ts`'s `readNum`/`dataIssues` idiom in `register.ts` (own implementation, not a shared import) — see D-20 for the consumer-side half of this same chain.

**D-20 — the NaN→null→false-empty chain's consumer half: Sacks.tsx history block — HIGH (misleading "no data" on a real-data period), fixed, `b9ff556`**

Direct continuation of D-19.2: once `register.ts` started emitting `dataIssues` for a malformed tally, `Sacks.tsx`'s History block had to actually read it. Fixed: it now reads `dataIssues` and renders "count unknown" plus whatever rows did arrive, instead of `<Empty>`, when the tally itself (not the row listing) was the thing that failed. Two-sided test (`Sacks.history.test.tsx`): a genuine empty period (no `dataIssues`) still reads `<Empty>`; a malformed-tally-with-real-rows period reads "count unknown" and shows the rows.

**D-21 — `report.ts`'s day-coverage query (`coverageReq`) was the one unscoped query among six siblings — HIGH, fixed, `26525ad`**

`getReport`'s `Promise.all` ran six queries; five were already scoped through their own callees (production.ts, weightStations.ts, etc.) and the sixth — `coverageReq`, computing `COUNT(DISTINCT shift_date)` and first/last day with data — carried no epoch predicate at all. This is RT-010 by another name (the audit's own header called it "mechanism proven, live counterexample not found"); this pass found and fixed the live counterexample. Regression table in the commit shows single-generation windows byte-for-byte unchanged, a two-generation window correctly excludes the simulator's days, and a simulator-only window is honestly labelled rather than hidden.

**D-22 — `Weight.tsx`'s headline gate was `s.count === 0`, which a field-stripped `count` does not satisfy — HIGH, fixed, `26525ad`**

A 200 response with `count` itself deleted (the RT-005 shape, applied to a different screen) fell through the `=== 0` check to the confident-mean branch, stating `s.mean` as fact over an unreadable count. Fixed as a third, distinct state (`W.weight.countCouldNotRead`) — same precedent as Line/Rejects' `couldNotRead` treatment.

**D-23 — `Calibration.tsx` printed the literal string "undefined stations flagged for drift" — MEDIUM (a worse failure mode than a confident zero, since it does not even read as a plausible number), fixed, `cf1c363`**

`W.reports.stationsFlaggedCount(d.flaggedStationCount)` had no null guard. Not itself an RT- number; flagged by `missingField.fuzz.test.tsx`'s own canary (added by another worker, `26525ad`) as a documented finding rather than fixed at the time. Closed by adding `W.reports.stationsFlaggedUnknown` and a guard, following the same "state the absence in words" idiom as D-22/RT-005/RT-012.

### Suite and typecheck, observed this pass (23 Sep 2026, HEAD `cf1c363`)

`npx vitest run` from `sms/`: **177 files passed / 1 skipped (178), 1745 tests passed / 4 skipped (1749)**, no red files, run once at the end of this pass. `npm run typecheck` (all five workspaces via `tsc -b shared sync-worker cli api web`): clean, no errors. Both measured directly by this worker, not copied from a commit message. Carries the same standing caveat as every other "green" claim in this project: a ~1-in-74 flake was found and fixed 22 Sep (D-7 above); one clean run today is not proof it cannot recur.

### What this worker did NOT get to, named rather than left implicit

- **RT-030** (`CLAUDE.md`'s stale clock-fault-row count) was not corrected this pass — `CLAUDE.md` is shared with several other workers today and this pass prioritised the three files it was explicitly assigned. Left for a follow-up pass that owns a `CLAUDE.md` hunk cleanly.
- **RT-014, RT-016, RT-017, RT-018, RT-020, RT-025, RT-026, RT-027, RT-028, RT-031, RT-034** are unaddressed by any of the fifteen commits — confirmed by reading each, not assumed from the absence of a matching commit message. Carried into `COMMISSIONING-GAPS.md` §2 and this table above. **(RT-016 since fixed, 28 Sep 2026 — see Part 9. The rest of this list is as it stood on 23 Sep 2026 and is not otherwise updated here; see the per-item table above and later Parts for each one's current status.)**
- **RT-023** (stale running process) is an operational fact this worker cannot check from source alone — marked cannot-determine, not fixed and not disproven.
- No independent re-verification of RT-008's "five live sites" resolution was done this pass beyond reading `generation.ts` and its call sites; the live numbers in Part 3's D-11 above are from the pass that produced them, not re-measured here.

---

## Part 5 — 24 Sep 2026: PDAS write-path bugs found and fixed before, and the first local end-to-end proof through the app's own code

Written by the worker who ran `PDAS-EXECUTION-2026-09-24.md`. Where the two 23 Sep 2026 passes
(`PDAS-EXECUTION-2026-09-23.md`) called the vendor's stored procedures by hand via `sqlcmd -E`,
this pass exercised **all nine PDAS write rights through `PdasWriter` and
`planChangeover`/`executeChangeover` themselves**, under the dedicated `sms_pdas_writer` login,
against the local `PDAS_TP1U2_SEP07` copy and the local `sms` sidecar only. Full detail, every
per-run verdict, and the backup/restore proof: `PDAS-EXECUTION-2026-09-24.md`.

### D-24 — a follow-up check-read failure was reported as the write itself failing — MEDIUM, fixed, `bdbb0eb` (23 Sep 2026)

`addBlend`/`addCount`/`addTubeType`/`createPallet`/`setPalletActive` each run a post-commit
echo-back `SELECT` (to confirm PDAS now holds what was written) inside the **same `try`** as the
vendor proc call itself. Against a role with EXECUTE-only rights and no `SELECT` on the PDAS
tables — the shape the plant's real login may end up as — a permission-denied error on that
check read was caught by the same `catch` that handles a genuine write failure, and recorded as
`outcome: 'error'` for a write that had, in fact, already committed. A caller retrying "the
failed create" would then hit the vendor's own duplicate refusal against a row that already
exists — a confusing, wrong-diagnosis failure mode. `updateProductLimits` had the sharper form
of the same defect: its check read sat outside any `try` at all, so the exception propagated out
of the route as an uncaught 500 with **no** `sms.product_change` row written for an `UPDATE`
that had committed — the worst case, since even the audit trail was silent about a real write.
**Fixed**: the check read is now its own, separately-caught step, never conflated with the write
succeeding or failing. **Re-verified by this pass's own run**: R1's seven-step execute and R2's
limits update both recorded `outcome: 'ok'` on every row that actually committed, checked
against direct PDAS/sidecar reads, not against the app's own claim.

### D-25 — a `LIKE`-pattern name collision was not caught until PDAS itself refused it, mid-plan — MEDIUM, fixed, `a9b85b5` (24 Sep 2026)

`AddBlend`, `AddCount` and `AddTubeType` each guard their `INSERT` with
`IF NOT EXISTS (SELECT * FROM <table> WHERE <col> LIKE @newName [AND TubeForm = @tubeForm])` —
read from the proc bodies on `PDAS_TP1U2_SEP07` via read-only `sqlcmd`, 24 Sep 2026.
`planChangeover` compared a requested new name against existing rows by exact
(case-insensitive, trimmed) equality only, so a name that is merely a `LIKE` **pattern** match
for an existing row (T-SQL: `_` is any-one-character, `%` is any-run) — e.g. `"R_D"` against an
existing `"RED"` — planned as a clean `add` step and was only discovered to collide once PDAS's
own check refused it, potentially after earlier steps in the same plan had already written.
**Fixed**: a new, independently tested module, `api/src/services/likePattern.ts`, compiles a
T-SQL `LIKE` pattern to an equivalent case-insensitive JS `RegExp` (handling `_`, `%`, `[...]`,
`[^...]`, and escaping the literal parts' own regex metacharacters), and `planChangeover` now
blocks a colliding name at plan time, before any write. **Proven by this pass**: case F3b
(`PDAS-EXECUTION-2026-09-24.md`) requested tube name `"R_D"` against an existing `"RED"` row and
was blocked at plan time with a message naming the collision, zero writes reaching PDAS.

### D-26 — `resolveTube` had no way to distinguish two tube types by form, only by name — MEDIUM, **fixed** (24 Sep 2026, `d6a58d4`; proven live later the same day)

Found while reading `changeover.ts` for this pass's own run (not exercised directly by this
pass's harness, which reused existing tube types rather than triggering this path). PDAS's own
`AddTubeType` duplicate check is a **compound** key — `TubeType LIKE @tubeType AND TubeForm =
@tubeForm` together — but `sms.tube_type` (the local mirror `changeover.ts`'s `resolveTube` reads
to decide whether to reuse an existing tube type or plan a new one) carried no `tube_form`
column at all, since migration 006. Two failure shapes follow: (a) an exact name match gets
reused even when the requested form differs from the existing row's — silently attaching a
changeover to the wrong tube type, when PDAS's own `AddTubeType` would have accepted the request
as a genuinely new, different tube type; (b) a `LIKE`-pattern collision against a row in a
**different** form over-blocks a request PDAS's own check would have let through. **This was a
real gap** — not fixed by D-25's `LIKE`-collision fix, which does not carry form information
either.

**Fixed by commit `d6a58d4`** ("Match changeover tube types on name and form, as AddTubeType
does"), found uncommitted and in progress by a concurrent worker at the time this entry was
first written, now landed: migration `041_tube_type_form.sql` adds `sms.tube_type.tube_form`
(nullable — an existing row reads `NULL` until the mirror learns the real value from a
`seedProducts` full read or an `AddTubeType` echo-back MERGE), and `resolveTube` in
`changeover.ts` now matches PDAS's own compound key — name AND form together when the row's
form is known, and a mirror row whose form is still `NULL` blocks rather than guesses either
way (see the function's own header comment, `changeover.ts:271-291`).

**Proven live, not just read from the diff, by the "Final re-run on `d6a58d4`+" section of
`PDAS-EXECUTION-2026-09-24.md` (24 Sep 2026, HEAD `58a705c`):** the committed harness's `R1`
case ran `AddTubeType` for a new tube (`E2E-TUBE`, `tubeForm=2`, resulting TubeTypeId 28), and a
direct, read-only comparison afterward showed `sms.tube_type` row 28's `tube_form=2` matching
`PDAS_TP1U2_SEP07.dbo.TubeTypes` row 28's own `TubeForm=2` exactly — the MERGE now writes the
column instead of leaving it `NULL`. A second, plan-only script (no `execute`, `planChangeover`
only) then drove `resolveTube` directly: requesting `E2E-TUBE` with `tubeForm=2` (the row's own,
now-known form) planned `action='reuse'`, `id=28`; requesting the same name with `tubeForm=1` (a
different, known form) planned `action='add'`, `id=null`, `proc='AddTubeType'`. Both were
plan-only, zero writes reached PDAS for either check. Both databases were restored from a
proven-restorable backup afterward and recounted to match the pre-run snapshot exactly,
including the E2E-TUBE/E2E-BLEND/E2E-COUNT/E2E-material/E2E-pallet rows this same re-run's `R1`
had created.

### The local end-to-end proof itself — all nine rights, through the app's own code

Beyond the two fixes above, this pass ran a Node harness (now `sms/scripts/pdas-e2e-local.mjs`,
copied from the scratchpad original with a hard local-only guard added) that drove
`PdasWriter`/`planChangeover`/`executeChangeover` — loaded from the built `api/dist`, not
re-implemented — against `PDAS_TP1U2_SEP07` + the local `sms` sidecar, under the newly-created
`sms_pdas_writer` login. Eleven cases (R1–R3, F1–F6) all PASS; one harness bug was found (F4's
first attempt reused a stale `before` snapshot from an earlier step, making both of its calls
return `CONFLICT` and never exercise the intended "one commits, one conflicts" case) — recorded
as FAIL in the raw results rather than hidden, then immediately rerun with a freshly-read
`before` and PASS, the same fix folded into the committed harness. Full per-case evidence,
backup/restore proof (two backup pairs, both proven restorable, the post-run restore
independently re-verified against a separately-recorded baseline with zero deviation), and what
this pass explicitly did NOT prove (the live HTTP route/session layer and the Changeover screen
in a browser — no agent has an app session to sign in with; plant concurrency/load; whether the
plant's live PDAS has drifted since the 7 Sep 2026 export) are all in
`PDAS-EXECUTION-2026-09-24.md`.

### Suite, observed this pass

`npx vitest run api/src/app.rbac.test.ts api/src/routes` (the RBAC/route slice relevant to the
changeover write path, not a full-repo run — other workers were concurrently editing
`changeover.ts`/`changeover.test.ts`/migrations/sync-worker mirror code/`Changeover.tsx` at the
time): **8 files passed, 176 tests passed, 0 failed.** A full-repo `npx vitest run` was not
taken this pass, for the same reason `reportRejectRateAgreement.test.ts`'s 23 Sep entry above
gives: a parallel worker's file was mid-edit at the time.

---

## Part 6 — 24 Sep 2026: `ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md` findings (RT24-01…13)

Baseline for this audit: HEAD `a9b85b5`, `npx vitest run` → 181 files, 1815 passed, 4 skipped;
typecheck clean. Four parallel read-only workers, two passes each, orchestrator-reverified every
CRITICAL/HIGH before recording. Full evidence, repro steps and file:line citations for every
row below are in `ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md` itself — this table states
disposition only, using the audit's own numbering exactly.

| ID | Severity (audit's own grading) | Finding | Disposition |
|---|---|---|---|
| RT24-01 | **CRITICAL** | Unauthenticated single-request DoS: a malformed session cookie (`Cookie: sms_session=not-a-guid`) throws an unhandled rejection in `authMiddleware`/`userFromSession` (`api/src/auth.ts:258`), no `process.on('unhandledRejection')` guard anywhere in `api/src`, and Node exits the process — reproduced twice, and is what actually killed the running `:4000` preview mid-audit at 11:35:40Z | **fixed**, `3e0d349` — malformed cookie now resolves to anonymous (401), not a process crash; process-level guards added |
| RT24-02 | HIGH | `production.ts::getProduction` builds `unmatchedFilters` with no `scope` field, so `getUnmatchedRejects` runs unscoped across every generation in the range — the one call site missed by the 23 Sep "WS-A1" fix that scoped the same call in `weightStations.ts`/`rejects.ts`; a boundary window shows phantom July days folded into the September denominator (pooled unmatched 19 vs correctly-scoped 11) | **fixed**, `8e8a188` |
| RT24-03 | HIGH | `generationNote`/`spansGenerations`/`otherGenerationExcluded` is on the report JSON but referenced by none of the `*Csv()` functions or the XLSX builder — an exported workbook spanning a generation boundary looks complete while silently omitting over half the true combined total (measured: 57% excluded in the boundary-window repro) | **fixed**, `f60e04a` (CSV/XLSX now carry the disclosure) + `b077815` (route wiring — `reportData` passed into `buildHeader` so real, not only test, exports carry it) |
| RT24-04 | HIGH (worker rated CRITICAL; moderated — needs a config edit, and for the stored-corruption half, a rebuild) | `plausibility_rule`/`weight_rule`/`shift_rule` are read `SELECT TOP 1 … ORDER BY effective_from DESC` with no time parameter at 9+ read sites AND at transform time (`runTransform.ts`, `dq.ts`) — editing a rule today retroactively changes months-old reports, and a rebuild after a `shift_rule` edit bakes today's rule into historical rows' stored `shift_code`/`shift_date` (write-time corruption, not just read-time skew); the architecture's own §8 "judged by the limits in force at its own time" rule was never extended to these three siblings the way it was for `product_limit_version` | **fixed**, `1315d23` (transform-time: rules resolved per-reading, not per-pass; adds `shift_rule_drift` DQ check) + `8f5c80c` (API read sites: time-versioned rule tables now read as-of, not right-now). **Local `sms` database carries real rule history** (plausibility rule changed 19 Aug 2026, shift rule changed 14 Sep 2026) — rows transformed before this fix landed were **not retroactively rewritten**; the fix stops new drift, it does not repair already-stored `shift_code`/`shift_date` values baked under the old right-now read. That backfill is not this pass's scope and is carried forward here, open, until someone runs one. |
| RT24-05 | HIGH now / becomes CRITICAL the instant `PDAS_WRITE_ENABLED` is flipped true | `pdasWrite.ts`'s post-commit echo-back verification (`addBlend`/`addCount`/`addTubeType`/`createPallet`/`setPalletActive`/`updateProductLimits`) downgrades a readback failure to WARNING and assumes the write succeeded (`observed = p.after`) rather than raising the pre-existing CRITICAL `pdas_write_echo_mismatch` — and the plant's real EXECUTE-only role has no SELECT on the PDAS tables, so the readback fails on **every** write there, forever, meaning the CRITICAL mismatch detector can structurally never fire under the actual go-live role | **fixed**, `25b02bc` — `observed` (and `sms.product_change.observed_after_json`) is now NULL on a failed read-back across all six write operations, never a false `p.after` claim; the product_change message is prefixed "UNVERIFIED — PDAS accepted the write but SMS could not read it back (<reason>)"; the first read-back failure per subject table since process start raises a standing CRITICAL `pdas_write_unverified` finding (deduped in-memory), with later failures on an already-verified table staying the pre-existing transient WARNING `pdas_write_readback_failed`. New `api/src/services/pdasPermissions.ts` probes SELECT rights directly; Health gained a "Checked after writing" line. Local probe against `PDAS_TP1U2_SEP07` still reports `canReadBack: true` (the dev login is broader than the plant's anticipated EXECUTE-only role), so the new CRITICAL path itself remains unobserved firing locally — it is proven by code path and unit tests, not by a live structural-failure repro. Re-run `sms/scripts/pdas-e2e-local.mjs` (all 13 cases, commit `22d7440`) confirms the harness still passes end-to-end after this change. |
| RT24-06 | MEDIUM | Date validation in `api/src/app.ts` is regex-shape only (`YYYY-MM-DD`); `2026-02-30` passes the regex, `new Date()` rolls it over, and six routes (`/api/production`, `/api/rejects`, `/api/weights`, `/api/spc`, `/api/reject-spc`, `/api/weight-stations`) return a valid-looking empty payload instead of `400` — indistinguishable from a genuinely empty period. Distinct from the known RT-016 (the month>12 crash case); this is the non-crashing silent-empty sibling and touches more routes | **fixed**, `11ce30b` ("Validate calendar dates, not just their shape") |
| RT24-07 | MEDIUM | `Line.tsx::periodFigures` (~line 534): `unmatchedRejects = r?.unmatchedRejects ?? rejected`, no unreadable flag — if `/api/production` ever returns a row missing just that key, the headline reject-rate tile silently reverts to the pre-fix double-count formula (reproduced in jsdom: 5.0% → 4.8%) with no caveat shown | **fixed**, `4e8513c` — the rate now routes through the existing `rateUnreadable`/`fieldMissing` idiom when `unmatchedRejects` is absent (the rejected COUNT stays readable, only the computed rate goes could-not-read); new case in `Line.render.test.tsx` (RED before / GREEN after). |
| RT24-08 | MEDIUM | `machinesRunning.ts::getMachinesRunning` retains only `quiet:true\|false` on a hard 2-hour cliff, no last-seen time — a machine quiet 3 minutes renders identically to one dead for weeks, on the one screen meant to say which machines need attention | **fixed**, `4e8513c` — added `lastSeenUtc` (MAX(production_ts_utc_ms) per station, this generation, reusing the existing `IX_cone_line_station_shift` index — a full scan, not a new index; no schema change) and `state: 'running'|'quiet'|'stale'|'silent'`, graded off `lastSeenUtc` relative to the same `asOfMs` anchor the file already used, never `Date.now()`. Whole-line exception documented: when `asOfMs` itself is null, every machine reports `'quiet'`, not `'silent'`. New `machinesRunning.test.ts` covers four stations at 1h/5h/3d/10d, a never-seen station, and the whole-line exception. **Not yet measured:** the added query's cost under load — the commit message states the index reuse but no benchmark was run this pass. |
| RT24-09 | MEDIUM | `generation.ts::resolveGenerationScope` keys on `shift_date` with no temporal-plausibility check — a mis-generation row (`DATA_TP1U2_SEP07.pack1_TP1U2` id=4130, `ProductionDate` 2026-07-12 but `source_epoch` 9) sits inside the documented 10 Jul→5 Aug "no data" gap and is returned as one in-range cone with `spansGenerations=false`, unflagged | **fixed**, `edae627` — new read-only DQ check `isolated_production_day`: for each `source_epoch`, a `cone_event` `shift_date` with fewer than 5 rows raises a WARNING (naming the first raw_id) when its ±3-day neighbourhood in the same generation has no data at all, or falls outside that generation's own coverage range. Known clock-fault sentinel dates excluded. Registered in `dq.ts`'s `CHECK_NAMES`, run once per pass at the end of `runTransform.ts`. Verified read-only against the local `sms` DB (`sqlcmd -E`): exactly one row flagged across all generations — `source_epoch` 9, `shift_date` 2026-07-12, n=1, raw_id 208207, whose `source_row_id` is 4130 — an exact match to the cited id. |
| RT24-10 | LOW | Legacy `/api/report` silently ignores `from`/`to` unless `period=custom`; no UI caller (`getReport` unreferenced) — dead route, but a script hitting it directly is silently misled | **fixed, 24 Sep 2026, `855045f`** (later same day) — `/api/report` deleted server-side; the web client's own dead `getReport` caller removed the same commit. See Part 7. |
| RT24-11 | LOW | `X-Powered-By: Express` present — framework fingerprinting; every other security header is set deliberately | **fixed, 24 Sep 2026, `855045f`** (later same day) — `app.disable('x-powered-by')` added to `createApp` (`sms/api/src/app.ts:126`). See Part 7. |
| RT24-12 | LOW | `/api/health` can return `status:"degraded"` with `degradedReason:null` even though `acquisition.kind:"stale"`/`backup.warning` are in the same payload — the field is not always populated from the signals that already set the status | **fixed, 24 Sep 2026, `45bdba8`** (later same day) — new pure `degradedReasons()` (`health.ts:424`) names every true degrading signal in `foldStatus`'s own priority order; re-verified directly against current `health.ts` this pass, not left pending. See Part 7. |
| RT24-13 | LOW | Missing-field fuzz coverage (`stripFields` harness) exists for Line/Weight/Rejects/Sacks and two report sections, but not for 6 of 8 report types, all 4 Product tabs, Health's two blocks, or the 4 sheets — RT24-07 was found in a *better*-covered screen, so a sibling defect could be hiding in an un-fuzzed one | **extended, not closed to zero, 24 Sep 2026, `855045f`/`e8a1e39`** (later same day) — the 8 remaining report types and Health's `SystemHistoryBlock` are now fuzzed, finding and fixing four real defects (`61de930`). **Still un-fuzzed:** the 4 Product tabs (Running/Changeover/Catalogue/History) and Health's `SyncHealthBlock`. See Part 7. |

**Read together with Part 4/Part 5:** RT24-02/03/04 are the same "generation/time scoping not
threaded everywhere" root cause Part 4's RT-001…036 wave already fixed most instances of —
these are the sites that wave missed, now closed by this one, except RT24-04's own backfill
half (stored rows already written under the old right-now read are not rewritten by this fix).
RT24-05 is a new defect class in the PDAS write path found the day after Part 5's own
end-to-end proof of that path — the proof exercised the write and echo-back mechanics under a
role broad enough that the readback never failed, which is exactly the condition RT24-05 says
will not hold under the plant's real EXECUTE-only role.

**Suite, observed this pass (24 Sep 2026, HEAD `8f5c80c`):** `npx vitest run` from `sms/` —
**196 files passed / 1 skipped (198), 2030 tests passed / 4 skipped, 2 tests failed** in
`sync-worker/src/transform/isolatedDay.test.ts` (a day-isolation fixture expecting 1 finding,
getting 2). Not investigated further by this pass — `git status` at the time of this run showed
several files under active edit by other, concurrent work on this branch (`health.ts`,
`machinesRunning.ts`, `pdasWrite.ts`, `Line.tsx`, `Running.tsx` among them), any of which could
plausibly shift generation/day-isolation fixtures; this is a documentation pass and does not
attribute or fix the failure. Do not read this as a fully green suite — it is 196/198 files
green, 2 tests red, measured directly, not copied from a commit message. Re-run once the tree
settles and record a clean number before claiming "green" again.

---

## Part 7 — 24 Sep 2026, later the same day: RT24-10/11/12/13 and RT-014 closed; two further defects found and fixed; one new defect found, not fixed

This pass closes the four LOW findings Part 6 left open (RT24-10/11/12/13) and the one
finding that had been blocking `PROJECT_STATUS.md` Phase 11 from COMPLETE since the 23 Sep
audit (RT-014). It also records two defects fixed earlier the same day but not yet written up
here (`32e9d0d`, `95b3aff`), and one new defect found this pass and left open.

### RT24-10 — dead `/api/report` route, and its dead web caller — **fixed**, `855045f`

The legacy `/api/report` route (silently ignoring `from`/`to` unless `period=custom`) is
deleted server-side. `web/src/api.ts`'s `getReport` — already unreferenced by any screen,
confirmed by the audit — is removed the same commit, along with its `api.callers.test.ts`
allow-list entry. Closed from both ends: nothing in the tree can hit the dead contract by
accident, from the server or the client.

### RT24-11 — `X-Powered-By: Express` present — **fixed**, `855045f`

`app.disable('x-powered-by')` added to `createApp` (`sms/api/src/app.ts:126`), verified
present in the current tree by direct grep this pass.

### RT24-12 — `degradedReason` sometimes null while `status:"degraded"` — **fixed**, `45bdba8`

`foldStatus` (`sms/api/src/services/health.ts`) degrades `status` on five independent
signals — pool error, database-size cap, stale/late/halted acquisition, blocking DQ findings,
stale backup — but `degradedReason` only ever reported the first: every other route into
`'degraded'` left the field `null` right beside a status reading `"degraded"`. A new pure
function, `degradedReasons()` (`health.ts:424`), derives one plain-English sentence per true
signal, joined `'; '`, in the same priority order `foldStatus` already checks; `getHealth`
wires it in, still `null` for an unauthenticated caller. RED: a new `getHealth` case in
`health.test.ts` (stale acquisition, authenticated) asserted `degradedReason` stayed `null`
while `status` read `degraded`, matching the finding exactly — GREEN after the change.
Re-verified directly against the current file this pass, not left as the "partly addressed,
not specifically re-verified" state Part 6 recorded it in.

### RT24-13 — missing-field fuzz coverage — **extended**, `855045f`/`e8a1e39`; **not closed to zero**

`missingField.fuzz.test.tsx`'s `stripFields` harness now covers the 8 report types it did not
before (daily/shift/product/station/reject/sack/management-summary/machine-product) and
Health's `SystemHistoryBlock`, driving `stripFields` against each section component's plain
data prop. **Still not fuzzed, named rather than left implied:** the 4 Product tabs
(Running/Changeover/Catalogue/History) and Health's other block, `SyncHealthBlock`.

Four real defects the extended fuzz found, each proven with an `it.skip` canary that failed
before the fix and was restored after, all fixed the same day in `61de930`:

- `screens/report/Shift.tsx` — the whole-report empty gate was `s.totals.cones > 0`, so a
  stripped `cones` field on the only shift in a period read as empty even with real non-zero
  `rejectedCones`/`sacks`/`sackWeightKg` behind it, hiding genuine data behind "Nothing
  recorded in this period." Now counts as having data when any KNOWN total is non-zero,
  treating a missing count as unreadable rather than a confident zero.
- `screens/report/Summary.tsx` + `lib/words.ts`'s `priorCoverage` — a bare template
  interpolation printed the literal word "undefined" onto the page when
  `coverage.prior.daysWithData` was stripped. Now states the count could not be read.
- `screens/health/SystemHistoryBlock.tsx` — `g.rawRowCount.toLocaleString(...)` had no null
  guard and crashed the whole block on a missing field, unlike every other cell in the same
  table. Now renders an em dash like its neighbours.
- `screens/report/Product.tsx` (found in the same fuzz pass, not itself named in the audit's
  own RT24-13 text) — the per-row filter dropped a row whenever `cones`/`rejectedCones`/
  `sacks` were all missing, even when the row's own weight readings were real, silently
  excluding it with no caveat. Now keeps a row when any known count is non-zero, any count is
  unreadable, or `weight.n` is real.

### RT-014 — no server-side response-size/row-count cap independent of SQL — **fixed**, `855045f`

`sms/api/src/middleware/responseCap.ts`, mounted once, globally, in `createApp`, refuses
outright — `413` — whenever a response would exceed either of two caps, checked independent
of whatever the SQL layer already did:

- **Row cap** (`MAX_RESPONSE_ROWS = 50_000`, `config.ts:75`): the largest array found at one
  of this app's known envelope shapes (a bare top-level array, or `.rows`/`.data`/`.data.rows`)
  — a deliberately small, explicit set of shapes, not a recursive walk that would also flag
  small, harmless nested arrays.
- **Byte cap** (`MAX_RESPONSE_BYTES = 20 * 1024 * 1024`, `config.ts:77`): an independent
  backstop for a response the row check waves through — one huge non-array payload, or many
  moderate rows with heavy per-row fields.

Both refusals are logged with the request's correlation id before the `413` is sent.
`/api/spc` additionally keeps its own tighter, separately-named span cap
(`MAX_SPC_RANGE_DAYS = 186` days, `config.ts:87`, verified present) rather than relying on the
row cap alone, because a wide-but-shallow SPC query can return few rows yet scan a large
range. The register CSV export (`/api/events/export`) is **deliberately not** wrapped by this
middleware — it already enforces its own `CSV_ROW_CAP` with an explicit `truncated`/
`X-Export-Truncated` flag, a tighter, already-labelled contract this middleware would only
duplicate; this is a documented exclusion, confirmed by reading `responseCap.ts`'s own header
comment, not a gap. Web-side, `e8a1e39` has `usePolling` (`lib/live.tsx`) encode a thrown
`ApiError`'s status as a `[<status>] ` prefix on the error string it hands to screens, and
`Failed` (`ui/bits.tsx`) reads a `413` prefix and shows a plain-English "too much data"
sentence (`words.ts` `errorDisplay.tooMuchData`) instead of the generic "the plant connection
may be down" outage message — RED test first (`ui/bits.test.tsx`), GREEN after wiring both
files.

**Consequence for `PROJECT_STATUS.md`:** RT-014 was the one item stopping roadmap Phase 11
(Security & operations) from returning to COMPLETE (see that file's phase board, row 40, and
`handover/FAT-PROTOCOL.md`'s SEC8 row) — both corrected this pass.

### RT24-05, restated for `handover/FAT-PROTOCOL.md` — not re-fixed this pass, its consequence corrected

`25b02bc` (already recorded in Part 6) means a real read-back failure under an EXECUTE-only
role now raises the standing CRITICAL `pdas_write_unverified` finding instead of silently
downgrading to a WARNING. `handover/FAT-PROTOCOL.md`'s PW10 row used to describe this as
"currently fails silently... must be fixed before this step can pass" — that text described
the pre-`25b02bc` behaviour and is corrected in place this pass. **Not proven by a live
structural-failure repro** — the local dev login still carries SELECT rights
(`canReadBack: true` locally), so the new CRITICAL path is proven by code path and unit test
only; do not read the FAT correction as a rehearsal that has actually happened.

### D-27 — `shift_rule_drift` false-positived every sampled row (BIGINT returned as a string) — **fixed**, `32e9d0d`

`mssql` returns `BIGINT` columns as JS strings, so `production_ts_utc_ms` arrived at this
check as e.g. `"1790080162370"`. Passed straight into `new Date(...)`, that string parses as
an invalid date (JS's `Date` constructor treats a bare numeric string as a date-time string,
not milliseconds), so `wallClockOf`/`shiftCodeOf`/`shiftDateOf` all produced `NaN` and every
sampled row mismatched — **20,000/20,000 flagged as drift on local data**, though a direct SQL
recompute of the same rule shows **0 real mismatches**. `runTransform.ts` already does
`Number(...)` at this same DB boundary (its own lines ~90, ~293, ~299); this check never did,
and its unit test only ever exercised a numeric fixture, so it never caught the string case.
Fix: `SampledRow.production_ts_utc_ms` now accepts `number | string`;
`shiftRuleDriftFindingsFor` converts via `Number(...)` once per row. A non-finite result after
conversion is counted separately as `check_name: shift_rule_drift_unreadable_time` and never
folded into the drift count itself, so a genuinely unreadable time cannot masquerade as either
"drift" or "no drift." **This was a false-positive in the DQ check itself, not a defect in the
stored data** — verified this pass by an independent SQL-side recompute of the same rule
against `sms.cone_event`, which the fix's own commit message also states; no rebuild was
needed or run.

### D-28 — `eventMsOfRaw` threw a bare `TypeError` on unusable event time — **fixed**, `95b3aff`

A raw row missing both `src_ProductionDate` and `src_Date` (or missing `src_Date` alone, for
sacks) left `eventMsOfRaw`'s `dt` `undefined`; calling `.getTime()` on it threw an unhandled
`TypeError` naming neither the row nor its source table — the least informative failure mode
available for a transform-time error. It now throws a plain `Error` naming the row's `raw_id`
and source table, matching how this same file already reports other malformed rule data
(`resolveShiftRule`/`loadShiftRuleHistory`). It still throws, deliberately, rather than
silently skipping the row — a batch retries until the row is fixed or explicitly excluded,
rather than a real production reading silently vanishing. New
`runTransform.eventTime.test.ts`: RED-then-GREEN coverage for the TypeError-to-Error change,
plus a regression pinning per-row shift-rule resolution (RT24-04) across a genuine 3-version
shift_rule history.

### D-29 — two `sms.cone_event` rows carry an epoch-zero phantom timestamp — **NEW, open, not fixed this pass**

Read-only query against the local `sms` database this pass (`sqlcmd -E`, `SELECT` only):

```
SELECT COUNT(*) AS cnt, MIN(production_ts_utc_ms) AS minms
FROM sms.cone_event
WHERE production_ts_utc_ms < 946684800000;   -- year 2000
```

returns **`cnt = 2`, `minms = 0`** — two rows whose `production_ts_utc_ms` is exactly `0`
(1970-01-01T00:00:00.000Z), not a plausible production timestamp on any generation this
project has ever seen, and distinct from the already-known 1969-12-31/2026-06-21 clock-fault
sentinel dates this file and `CLAUDE.md` already document and exclude from aggregates. Not
triaged for root cause or user-facing impact this pass (which raw row(s) this traces to,
whether it is a source data defect or a transform-time defect, and which screens it could
skew are all open); recorded here as a defect found, not a defect closed, so it is not lost
between passes.

### Process note: two commits mixed files from concurrent workers

`855045f` and an earlier commit pair (`25b02bc`/`8f5c80c`) each bundle changes from more than
one concurrent worker on this branch into a single commit — confirmed by `git show --stat` on
each, which lists files spanning unrelated fixes (e.g. `855045f` touches both the RT24-10/11/
RT-014 web-side work and unrelated report-service files). Content is intact and each file's
own diff is coherent; this is a process note about commit hygiene on a branch several workers
share concurrently, not a code defect, and no file was found half-written or reverted by the
mixing.

### Suite and typecheck, measured this pass

`npx vitest run` from `sms/` — **201 files passed / 1 skipped (202), 2088 tests passed / 4
skipped (2092), 0 failed.** `npm run typecheck` (all five workspaces) — clean. Both run
directly for this pass, HEAD at the time of the run included `61de930`.

### What this pass did NOT get to

RT24-13's two remaining named gaps (Product tabs, `SyncHealthBlock`) stay unfuzzed. D-29 (the
epoch-zero cone_event rows) is found, not triaged or fixed. This is a documentation pass; no
production code was changed by it.

---

## Part 8 — 25 Sep 2026: the remaining red-team items closed, decided, or handed to the owner as a kit

Six commits on `floor-first-rework` (`b182297`, `fb9fd9d`, `c52a34d`, `b4284ac`, `5b2b56a`,
`39c2c37`) on top of `6d000cd`. Every item the 24 Sep audit and its fix wave left open is
dispositioned below. Verified against the local dev copy only, never the plant.

### RT-020 — days-to-limit had no uncertainty — **fixed**, `b182297`

`calibration.ts` `projectDaysToLimit` now fits the OLS slope's standard error and a 90%
t-interval (`olsSlopeStats`, `tCritical90`: t-table df 1–30, normal above). It reports
`daysLow`/`daysHigh` from the interval's two ends, and returns `status: 'not_established'`
with a `reason` when the interval includes zero. The minimum is raised to 5 daily points
(`MIN_PROJECTION_POINTS`). StationSheet and the attention list print the range, the reason, or
a too-few-points sentence. **Measured on real September data** (epoch 9, 08-05→09-07, in
process, read-only): the old code printed confident counts of **437, 1,046, 1,883 and 1,986
days** for stations 13, 6, 12 and 7. All four are now `not_established`. Everywhere the old
code was already null, the new code agrees.

### RT-019 — Nelson rules 2–8 — **closed as a decision, by evidence** (owner delegated the call, 25 Sep 2026)

The owner chose to replace rules 2–8 with an EWMA drift signal, and it was built and measured
before being wired anywhere. **It failed at both granularities tried**, so nothing shipped and
rules 2–8 stay withheld exactly as before (`W.weight.patternsWithheld` unchanged).
- **15-min subgroup means** (the series the I-MR band uses; σ̂ = MR̄/1.128 between-subgroup,
  gap/generation resets): every λ ∈ {0.1, 0.2, 0.3} × L ∈ {2.7, 3.0} flagged **27.9–68.2%** of
  groups (July epoch 1: 48.1–68.2%; Sept epoch 9: 27.9–47.8%). The target was 1–5%.
- **Daily per-station means**: pooled **5.6% (July) / 10.9% (Sept)** at the best setting
  (λ=0.1, L=3.0), which **missed an injected +0.3 g/day ramp entirely** on a real July
  station. Per-station n is 16–34 days, so a single day moves a station's rate 3–7 points.
- **Why:** the weight level genuinely carries momentum. Lag-1 autocorrelation of 15-min
  subgroup means is **0.713 (July) and 0.517 (Sept)**. Pattern rules built for independent
  samples cannot separate signal from wander on this process.

The calibration question stays answered by what does work: the station-vs-line-and-target
table, rule 1 (the I-MR band, 5.6–13.1% on real generations, D-10), and RT-020's honest
days-to-limit. The EWMA code was not committed. Unused code would be a backend capability
with no caller, and the measurement tables above are the record. **For IFL:** the app watches
single out-of-band points and station bias. It deliberately does not raise pattern alarms,
because on this line's data they fire on 2 groups in 5.

### RT-017 — MachineProduct on-screen clipping — **fixed**, `fb9fd9d`

The screen table is transposed: machines across (~14 columns), production day × shift down.
It sits in its own scroll box (`.mp-scroll`, 70vh) with a sticky header row and first
column, so no label is lost at any scroll position. Cell contents, click-through, CSV/XLSX
and the print path are unchanged. A 14 × 34 days × 3 shifts component test, which failed on
the old markup, asserts every row and header renders.

### RT-018 — retired product shown as target unmarked — **fixed**, `c52a34d`

`productActive` (PDAS `MaterialActive`, **current status only**, because PDAS keeps no
retirement date) is threaded through `machinesRunning.ts` (LEFT JOIN on `sms.product`'s
primary key, so a station can be neither dropped nor duplicated, with a test), `weightStations.ts`,
`/api/product-at`, and the cone-weight, station, product and management-summary reports. It
renders as "(retired in PDAS)" plus one sentence on Weight, the station table, Line, Product ›
Running, ReadingSheet and those report sections. CSV/XLSX carry it as a column or trailing row;
the PDF follows the screen. **Live check on the rebuilt API, 25 Sep:** station 7 running
MaterialId 17 → `productActive: false`. The **cone-weight report for Sept real
(08-05→08-20) names product 12 `201-IH0-SD` as its target, and that product is retired**
(`productActive: false`). That is exactly the case RT-018 described, and it is now marked.

### D-29 — epoch-zero cone rows — **closed, no code change needed**; regression test `b4284ac`

Both rows are traced: July `pack1_TP1U2` id 3824 (epoch 1) and September id 5047 (epoch 9).
Each has a real insert time and plausible weight, `ProductionDate` 1970-01-01, and machine and
material zeroed. This is a **vendor source-data sentinel**, recurring across both generations,
not a transform defect. It is unreachable from every screen: each row lands alone on
`shift_date` 1969-12-31, and `/api/range` offers no day under 20 rows
(`MIN_PRODUCTION_ROWS`). Every period query is from/to-bounded, and the RT-021 floor keeps
them out of the anchors. The rows are kept, per the clock-fault rule. The existing
`stale_timestamp` DQ check already flags them. The new test pins that. Residual, not fixed:
that finding is aggregate, so it names the batch's first offender rather than these two rows
by id.

### D-30 — false "OK" health verdicts — **fixed**, `5b2b56a` (HIGH)

Found live while closing RT24-13's last gap, not as a fuzz-only edge case.
`SyncHealthBlock.tsx`'s verdict handled `stale`/`late` only, so a real `lag_unknown` or
`no_data` from `/api/live` printed "The plant connection is healthy." That is a false
all-clear on the one block whose job is to report breakage. The same fall-through was in
`ui/Bar.tsx`'s header alarm and `Wall.tsx`'s per-line dot. It was also in `lib/health.ts`'s
`assessHealth`, whose default returned `ok` for a `/api/live` line with **no health object
at all** (a partial 200), so every screen would then have asserted running/stopped. All four
are fixed: exhaustive, with an unrecognised kind reading "could not be read" and
`assessHealth` defaulting to `lag_unknown`. RED→GREEN: one case per kind plus an unknown
string (`SyncHealthBlock.test.tsx`), and `web/src/lib/health.test.ts`.

### RT24-13 — missing-field fuzz — **closed**, `5b2b56a`

The fuzz now covers the four Product tabs and SyncHealthBlock, the last named gaps. It found two
crashes, both fixed: **D-31** (MEDIUM), Changeover's `PlanReview` threw on a plan without
`blockers`, so Execute is now disabled and the safety checks are named unreadable; **D-32**
(LOW), History's sort threw on a row without `changedAt`. Running and Catalogue were shown to
have no defect of this shape.

### PDF export — **proven end to end**, no defect

A fresh `api/dist` rendered daily, machine-product and calibration for 08-05→08-20, plus an
empty gap period (07-20→07-25), through the real route and headless Edge. The in-memory render
token wrote no session. Results: valid `%PDF`, 1–9 pages, landscape (`MediaBox 841.9 × 594.9`).
The provenance block is present. Daily figures match the JSON field for field (77,492 cones,
3,125 sacks, 147,623 kg, 3.4% rejects). The empty period says "Nothing recorded in this
period", not zeros. Renders take 1.2–2.3 s. With Edge missing the route returns a clean 503 in
0.1 s, with no hang.

### Owner-run kits — the two items an agent may not close — `39c2c37`

- **RT24-05 / FAT PW10**: `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` plus
  `sms/scripts/rehearse-rt24-05.mjs`. Proves the `pdas_write_unverified` CRITICAL fires under
  a login with EXECUTE on the vendor procedures and no SELECT on the tables. It runs against
  the local `PDAS_TP1U2_SEP07` copy only, with backup first and restore after. Guard:
  localhost plus `*_SEP07`/`*_E2E`, with no override. It refuses missing credentials before
  any connection, and it uses the real `updateProductLimits` signature (MaterialId 1024, +1 g).
  The refusal paths were proven, and the localhost TCP read path was confirmed from the
  owner's shell. **The write itself has not been run**: it needs the owner's login.
- **Below-rank RBAC / FAT SEC6**: `handover/REHEARSAL-RBAC-BELOW-RANK.md`. The owner creates
  viewer and engineer accounts with `user:create`, signs in in the browser pane, and the
  orchestrator drives the checklist, which comes from `rank.crosscheck.test.ts`'s client/server
  rank pairings. Forced-write probes go to gated routes only and never to `changeover/execute`.
  **Not yet run**: no such accounts exist.
- **D-33**: `sms/DEPLOY.md`'s wall-display example used `--role=operator`, which the CLI has
  refused since migration 035. It now reads `--role=viewer`.

### Still open after this pass — named, not implied

- **Needs the owner:** run the two kits above (RT24-05 live firing, below-rank RBAC live).
- **Needs IFL or the plant:** load on IFL's real server under concurrency, and behaviour
  across a real sequential generation cutover. Neither can be produced on the dev copy.
- **Carried from the 23 Sep register, untouched by this pass:** RT-025, RT-026, RT-027,
  RT-028, RT-030 (see Part 4's table). None is a false-number defect.

### Process notes

- A first attempt to commit RT-020/RT-017 staged `words.ts` hunks with zero context, and git
  placed one string inside an existing comment block. The resulting commit had 25 syntax errors
  in `words.ts`. It was caught before any push by parsing the staged file, and the two local,
  unpushed commits were soft-reset and redone with full-context hunks. Every commit in this
  pass has its shared-file content parse-checked.
- One worker reported proving a RED case "by stashing" despite the no-`git stash` rule. The
  stash list was empty afterwards, no conflict markers were found in any changed file, and
  the full suite passed on the combined tree. Nothing was lost, but the rule was broken, and
  it is recorded here.

### Suite and typecheck, measured this pass

`npx vitest run` from `sms/` on committed HEAD `39c2c37`: **208 files passed / 1 skipped,
2,137 tests passed / 4 skipped, 0 failed** (Part 7 recorded 2,088). `npm run typecheck`, all five
workspaces: clean.

---

## Part 9 — 28 Sep 2026: RT-016 closed

### RT-016 — calendar-invalid date reaches the DB driver / silently rolls over — **fixed, all three surfaces**

RT-016 (`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md:712`) named a calendar-invalid date
(`2026-13-45`) crashing the DB driver on 9 of 9 endpoints tried. This carried as **open** through
Part 4 (line 714 above), the 25 Sep 2026 Part 8 pass, and a 28 Sep 2026 doc-correction commit
(`083a750`/`26151a5`) that re-checked `git log --all` for a fix and found none. It is closed now,
by three separate fixes covering the three places a value like this entered the app, landed on
three different dates:

1. **Query-string timestamp params** (`tsTo`/`tsFrom`/`asOf`/`at` etc. across `app.ts` and
   `routes/{sacks,rejects,reports,cone}.ts`) — **fixed 28 Sep 2026, `5d42cf5`.** Adds
   `isoTimestamp` (`api/src/dates.ts`): shape regex, then round-trip through `Date` and compare
   the Y-M-D-h-m-s fields. Proven red first (73 failures, including bare 500s, against the
   pre-fix regex-only validator) then green. Suite at that commit: 2,270 passed / 4 skipped.
2. **Query-string date-only params** (`from`/`to`/`date`/`day`) — **fixed earlier, `11ce30b`**
   (`isoDate` in `api/src/dates.ts`, same round-trip technique). This predates both the 23 Sep
   audit's fix wave and `5d42cf5`; it is `RT24-06`'s own fix, and per `DEFECTS.md` line 920 and
   `CLAUDE.md`'s prior correction it is a **distinct, non-crashing sibling** of RT-016 (a silent
   empty `200` rather than a driver crash) — named here because it closes one of RT-016's three
   surfaces, not because it was ever the same finding.
3. **The sack-stock movement form's `occurredAtPlant` field** (`POST
   /api/sack-stock/movements`, `web/src/screens/Sacks.tsx:714`'s `datetime-local` input) —
   **fixed 28 Sep 2026, `60d397f`.** `api/src/services/sackStock.ts::parsePlantLocal` NaN-guarded
   `Invalid Date` but otherwise trusted `new Date(...)`'s calendar arithmetic, so
   `2026-02-30T10:00` silently became `2026-03-02T10:00` instead of being refused — the same
   rollover shape RT-016 named, on a form field rather than a query param, and not covered by
   either `isoTimestamp` or `isoDate` (this field is neither: no `Z`, seconds optional). Fixed
   with the same round-trip technique, now returning the DB driver never sees the value: the 400
   `occurredAtPlant must be a plant-clock time like ...` path (`validateMovement`) fires before
   any query runs. Proven red first (3 of the new test cases failed against the pre-fix
   function: 2026-02-30, hour 24, and 2026-02-29 in non-leap 2026, all silently rolled over)
   then green; the web form's actual values (`Sacks.tsx:714`, no seconds, no `Z`) still parse
   unchanged.

**All three of RT-016's surfaces this repo has found are now validated before reaching the DB
driver or rolling over silently.** No fourth surface is known; this was not a full-repo grep for
every remaining shape-only date/time regex, only the three named above (the two `dates.ts`
exports' call sites, and the one form field this pass was assigned).

`npx vitest run` from `sms/`, HEAD `60d397f`: **2,277 passed / 4 skipped** (>= 2,270 carried
from `5d42cf5`). `npm run typecheck`, all five workspaces: clean.

`COMMISSIONING-GAPS.md` §2, `PROJECT_STATUS.md` and `CLAUDE.md` each carried RT-016 as open (the
last two as of a same-day, earlier doc-correction pass) and are corrected in place, in this
file's own convention (old text kept, a dated note added), not rewritten.
