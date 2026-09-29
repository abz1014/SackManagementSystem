# Commissioning gaps — what's missing to install this at IFL

One-minute read. Full evidence: `FRICTION-AUDIT.md`, `VERIFICATION-2026-09-23.md`,
`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md`, `ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md`,
`DEFECTS.md`, `IFL-OPEN-QUESTIONS.md`, `PDAS-EXECUTION-2026-09-24.md`.
Originally written 23 Sep 2026 after the first red-team audit (`d2cba5e`) and its
15-commit fix wave (`016a047`…`cf1c363`). **Corrections dated 24 Sep 2026 are marked
inline below, in place, per this file's own convention** — old text is struck through
or labelled superseded, not deleted, so the file shows its own history.

**29 Sep 2026 addendum (owner-scope hardening loop, documentation-only, no app code
changed by this pass).** Full account: `DEFECTS.md` Part 12; dated summary: `CLAUDE.md`'s
"Owner-scope hardening loop" section. Closed or narrowed below, in place: the
`newestProductionDay` generation-pooling anchor (§2, now fixed), and the nightly-backup
item (§1, narrowed — a verified marker mechanism now exists and one manual run proved it
works, but no unattended run has happened). **Also new this pass, not previously in this
file:** `sms epoch:backfill` and the `epoch:accept` data-vintage guard exist and are
unit-tested (fake pools only) but the R-17 fixture was never run against a real SQL Server
instance — see §4 below, corrected in place, for a claim about this that did not survive
verification. **Corrected again, 29 Sep 2026, later the same day:** the fixture HAS since
been run, twice, against real scratch SQL Server databases — see
`handover/R17-SCRATCH-RUN-2026-09-29.md` and `DEFECTS.md` Part 12; §4 below is updated in
place. A PDAS limit-change guard, two-step UI review and `WITH (UPDLOCK, HOLDLOCK)`
now exist (narrows F-26/F-27 in `handover/FAILURE-ANALYSIS-2026-09-29.md`, not previously
named in this file). RT-028's missing range cap on `/api/production`/`/api/weights` is
closed.

## 1. Stops commissioning

- No read-only login/host for the live plant server — nothing can be installed until this arrives → IFL #1
- PC-to-plant network reachability unconfirmed → IFL #2
- Cutover has never been rehearsed against an unknown login shape → ours
- ~~PDAS: written grant recorded (19 Sep); `sms_pdas_writer` not provisioned; local end-to-end proof not run → ours + IFL #3~~
  **Superseded 24 Sep 2026:** the local end-to-end proof has now run — `sms_pdas_writer`
  was created locally and all nine write rights were driven through the app's own code
  against `PDAS_TP1U2_SEP07` (`PDAS-EXECUTION-2026-09-24.md`, commits `58a705c`/`c21dfa9`).
  This still stops PLANT commissioning: `sms_pdas_writer` is **not** provisioned against
  the plant, `sms/.env`'s `PDAS_WRITE_ENABLED=true` points only at the local copy, and a
  new finding the same day (RT24-05, `DEFECTS.md` Part 6) means the write path's own
  verification cannot detect a real PDAS mismatch under the plant's anticipated
  EXECUTE-only role and must be fixed before that role is ever used → ours + IFL #3
  **Superseded further, 28 Sep 2026 (Task K2c, `DEFECTS.md` Part 10):** the scripted
  local harness (`scripts/pdas-e2e-local.mjs`) now runs clean end to end — all 19 of 19
  cases PASS, all nine per-right summary rows PASS, `OVERALL: PASS`, exit code 0 — proving
  all nine PDAS write rights through the app's own code against `PDAS_TP1U2_SEP07`, with
  fresh verified backups taken before and restored (anchors matched exactly) after. D-34
  (Catalogue had no pallet-reactivate control) was found and fixed the same day,
  `801dc58`. **Still owner-run, unchanged:** the EXECUTE-only "ibrahim"-shaped login
  rehearsal (`handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md`), the below-rank RBAC rehearsal
  (`handover/REHEARSAL-RBAC-BELOW-RANK.md`), and anything requiring the plant itself —
  agents may not create logins, so these two kits remain the owner's own to run. RT24-05
  (the write path's echo-back verification cannot detect a real mismatch under an
  EXECUTE-only role) is unchanged by this pass and still gates enabling
  `PDAS_WRITE_ENABLED` against the plant → ours + IFL #3
- Windows service (NSSM) never installed or exercised on any machine → ours
- Nightly backup scheduled only on paper, never run unattended → ours
  (**Narrowed 29 Sep 2026, owner-scope hardening loop:** a verified-backup marker
  mechanism now exists and a BOM bug that silently broke every marker's `JSON.parse` was
  found and fixed by actually running it once, `00c3174` — `GET /api/health` now reports
  `backup.verified=true` for that one manual run. This is still one hand-run against the
  `sms` app DB's backup directory, not a proven unattended nightly run — the item above
  stays open. See `DEFECTS.md` Part 12, F-15.)
- ~114 commits ahead of `origin/floor-first-rework` (last pushed 16 Sep), ~179 ahead of `origin/main` — never seen by CI → ours
- No off-machine copy of IFL's data — both samples live on one laptop → ours

## 2. Wrong on screen today

- ~~MachineProduct report: ~82% of columns are off-screen with no sticky column or fallback (RT-017, unfixed) → ours~~
  **Superseded 28 Sep 2026:** fixed 25 Sep 2026, `fb9fd9d` — table transposed (machines
  across, day×shift down) inside its own scroll box with a sticky header row and sticky
  first column; verified present in `sms/web/src/screens/report/MachineProduct.tsx`. See
  `DEFECTS.md` Part 8.
- ~~Product › Running shows a retired product with no "retired" marker while reports cite it as "the target" (RT-018, unfixed) → ours~~
  **Superseded 28 Sep 2026:** fixed 25 Sep 2026, `c52a34d` — a new `productActive` field is
  carried by `machinesRunning.ts`, `weightStations.ts`, `/api/product-at`, and the
  cone-weight/station/product/management-summary reports, shown as "(retired in PDAS)";
  verified present in `sms/api/src/services/weightStations.ts:300,438`. See `DEFECTS.md`
  Part 8.
- ~~No server-side response-size/row-count cap independent of SQL (RT-014, unfixed) → ours~~
  **Superseded 28 Sep 2026:** fixed 24 Sep 2026, `855045f` — `sms/api/src/middleware/
  responseCap.ts`, wired at `app.ts:135` (`app.use(responseCap())`), ahead of RT-020/RT-017/
  RT-018 despite the shared 25 Sep commit dates. See `DEFECTS.md` Part 7 and Part 8's own
  correction of this file.
- ~~A calendar-invalid date (`2026-13-45`) crashes the DB driver instead of being validated by the app, on 9 of 9 endpoints tried (RT-016, unfixed) → ours~~
  ~~**Checked 28 Sep 2026: still open, no fix found.** No commit named "RT24-06" or "RT-016"
  exists in `git log --all`; `DEFECTS.md` line 714 confirms "open — not addressed by this
  wave." Text unchanged.~~
  **Superseded later the same day, 28 Sep 2026:** fixed, all three surfaces — query-string
  timestamps (`5d42cf5`), query-string dates (`11ce30b`, predates both this note and the 23 Sep
  fix wave), and the sack-stock movement form's `occurredAtPlant` field
  (`sms/api/src/services/sackStock.ts::parsePlantLocal`, `60d397f`). See `DEFECTS.md` Part 9.
- **Added 28 Sep 2026:** D-30 — Health's sync verdict, Bar's header alarm, Wall's per-line
  dot, and `lib/health.ts`'s `assessHealth` all fell through to a false "OK"/"healthy" for
  `lag_unknown`/`no_data`/a missing health kind. **Fixed 25 Sep 2026, `5b2b56a`** — now
  exhaustive, unrecognised kinds read "could not be read"; verified present in
  `sms/web/src/lib/health.ts:44,60-71`. See `DEFECTS.md` Part 8.
- Nelson rules 2–8 flag 37.6–54.8% of station-groups on real data and stay deliberately suppressed pending an owner decision on one of four options (RT-019/`DEFECTS.md` D-10) → ours
- ~~`routes/reports.ts`'s `newestProductionDay()` anchor still pools every source generation when picking the "default" report day (D-11's report-layer fix covers the report bodies; this one anchor query was not in that list) → ours~~
  **Fixed 29 Sep 2026, `7bfa4b8`** (owner-scope hardening loop) — the anchor now routes
  through the same `resolveGenerationScope(..., {preferReal: true})` every other
  report/service query already uses, closing the anchor/body mismatch. `live.ts`'s
  dev-only `resolveLiveScope` is deliberately untouched. See `DEFECTS.md` Part 12.
- **Added 24 Sep 2026, second audit (`ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md`, `DEFECTS.md` Part 6):**
  - ~~Line's headline reject rate silently reverts to the pre-fix double-count formula if `unmatchedRejects` is missing from a response, no caveat shown (RT24-07, in progress, hash pending) → ours~~
    **Fixed 24 Sep 2026, `4e8513c`.** Verified 28 Sep 2026: `Line.tsx` now reads
    could-not-read via the existing `rateUnreadable`/`fieldMissing` idiom instead of
    silently falling back to the old formula when `unmatchedRejects` is missing; the
    rejected COUNT still renders. `Line.render.test.tsx` (new case in this commit) is
    green (`npx vitest run web/src/screens/Line.render.test.tsx` — 14 tests passed).
  - ~~No stale-vs-dead distinction per machine — a machine quiet 3 minutes and one dead for weeks render identically (RT24-08, in progress, hash pending) → ours~~
    **Fixed 24 Sep 2026, `4e8513c`.** Verified 28 Sep 2026: `machinesRunning.ts` now
    carries `lastSeenUtc` and a four-way `state: 'running'|'quiet'|'stale'|'silent'`
    graded off `lastSeenUtc` relative to the file's existing `asOfMs` anchor (never
    `Date.now()`). `machinesRunning.test.ts` is new in this commit (did not exist at
    `4e8513c^`, so it was red by non-existence before the fix) and is green
    (`npx vitest run api/src/services/machinesRunning.test.ts` — 3 tests passed).
    **Owner must confirm the thresholds**: "running" under 2h since last seen; "silent"
    means nothing seen for 7 days (intermediate window graded "stale").
  - ~~A mis-generation row can sit inside the documented 10 Jul–5 Aug "no data" gap and count as real, unflagged (RT24-09, open) → ours~~
    **Fixed 24 Sep 2026, `edae627`.** Verified 28 Sep 2026: a new read-only DQ check,
    `isolated_production_day` (`sms/sync-worker/src/transform/isolatedDay.ts`, registered
    in `dq.ts`'s `CHECK_NAMES` and run once per pass at the end of `runTransform.ts`),
    flags a shift_date with fewer than 5 rows whose ±3-day neighbourhood in the same
    source generation has no data, or which falls outside that generation's coverage
    range — a WARNING naming the first raw_id, not a deletion or exclusion; flagged rows
    are still counted. Verified read-only on the local DB per the commit message: exactly
    one row flagged (source_epoch 9, shift_date 2026-07-12, raw_id 208207 → source_row_id
    4130, matching RT24-09's cited id). `isolatedDay.test.ts` is new in this commit (did
    not exist at `edae627^`, so red by non-existence before the fix) and is green
    (`npx vitest run sync-worker/src/transform/isolatedDay.test.ts` — 6 tests passed).
    **Owner must confirm**: the day is flagged as a warning only; its rows are still
    counted, not excluded.
  - `/api/health` can report `degraded` with `degradedReason:null` (RT24-12, treated as still open pending re-check) → ours

## 3. Fixed today, worth naming so it is not re-reported

- Line/Rejects/Report no longer disagree on the same period's reject rate (RT-001/003/004/009/029/032 — `ae7a59b`, `53ae8a3`, `54601a6`)
- The station report's "impossible row" (more within-tolerance cones than cones produced) is gone (RT-002 — `54601a6`)
- A 200 response with a field silently deleted no longer renders as a confident zero on Line, Weight, Rejects, Wall, Sacks or Calibration (RT-005/012/013/033 — `71757a3`, `ae7a59b`, `add32c5`, `26525ad`, `cf1c363`)
- The false "stopped" state from a zero-lag sample, and the 1970 clock-fault sentinel hijacking three anchor queries (a third site than the audit itself named), are both closed (RT-006/021 — `7558854`)
- Line's own provenance banner can no longer call simulator figures real (RT-007 — `19a4aa0`)
- Almost every canonical-table query now scopes to one source generation and says what it excluded, closing most of RT-008's root cause and RT-010/011 (`54601a6`, `26525ad`, `add32c5`, plus the pre-audit `6052b69`/`8673ffd`/`ca34a23` wave) — `weightStations.ts` and `routes/reports.ts:104` were re-checked this pass and are now scoped or noted above, respectively
- **Added 24 Sep 2026, second audit fix wave:** a malformed session cookie no longer crashes
  the whole API process — CRITICAL, unauthenticated, was killing the running preview
  mid-audit (RT24-01 — `3e0d349`); `production.ts`'s reject-rate query is no longer pooled
  across source generations (RT24-02 — `8e8a188`); exported CSV/XLSX reports now carry the
  generation-scope disclosure that was already in the JSON (RT24-03 — `f60e04a`/`b077815`);
  time-versioned rule tables (`plausibility_rule`/`weight_rule`/`shift_rule`) are read as-of
  the reading's own time, not "whatever is newest," including at transform time (RT24-04 —
  `1315d23`/`8f5c80c` — **note: rows transformed before this fix are not retroactively
  rewritten**, open backfill); calendar-invalid dates now return `400`, not a silent-empty
  `200` (RT24-06 — `11ce30b`)

## 4. Built but unproven

- PDF export has never been invoked end to end outside a script
- `sms verify` has never run against a live plant login
- ~~**Added 29 Sep 2026 (owner-scope hardening loop):** `sms epoch:backfill`, the
  `--source-db`/`--epoch` verify-scoping fixes, and the `epoch:accept` data-vintage guard
  (R-17, `b81eb1c`/`937616d`/`96f913e`/`08df232`/`2eaa7a3`) are real, working code with
  unit-test coverage — but every one of those tests runs against a fake/mocked `mssql`
  pool. The R-17 fixture (`sms/scripts/r17-fixture.sql`) was, by its own commit message,
  "parse-checked... never executed" against a real SQL Server instance. A claim that this
  had been proven end to end on a scratch database, with specific row counts, was checked
  against every file in `handover/`, this file, `CLAUDE.md` and `DEFECTS.md` this pass and
  **not found anywhere** — do not repeat it. See `DEFECTS.md` Part 12.~~
  **Corrected 29 Sep 2026, later the same day:** the search above was incomplete, not the
  run's absence. Two scratch-DB integration runs were genuinely executed by agents on the
  dev PC that same day; their results were reported to the orchestrator and simply never
  written to the repository until `handover/R17-SCRATCH-RUN-2026-09-29.md` was added. R-17
  is now **built, unit-tested, and proven end to end against real SQL Server scratch
  databases** (not fake pools) — moved out of this "Built but unproven" section, into
  §1/§3 wherever it is otherwise referenced. It is still IFL-blocked for the real 10 Jul –
  5 Aug archive, which is a separate fact from whether SMS's own code is ready. See
  `DEFECTS.md` Part 12.
- ~~Print/PDF layout is verified only by viewport-resize simulation, never a real print dialog~~
  **Superseded 24 Sep 2026:** a real browser/layout harness now exists
  (`sms/playwright.config.ts`, `layout-tests/`, commit `b866754`; run 24 Sep 2026: 3 passed /
  13 skipped / 0 failed). Print/PDF layout is now *reachable* by that harness rather than
  simulation-only, but the 13 skipped cases are exactly the ones needing a signed-in session
  (owner-supplied credentials, not yet provided), so print/PDF layout has still not actually
  been *observed* by it — reachable, not yet proven.
- Viewer (rank 1) role has never been signed into on a live instance
- **Added 24 Sep 2026:** the PDAS write path's own post-commit verification (echo-back)
  cannot detect a real mismatch under the plant's anticipated EXECUTE-only role and silently
  downgrades to a WARNING instead of the intended CRITICAL (RT24-05) — must be fixed before
  `PDAS_WRITE_ENABLED` is ever set true against that role, even though the write mechanics
  themselves are now locally proven (§1 above).
- **Added 29 Sep 2026 — chart overhaul (20 commits, `870bdd9`…`741fbd2`, see
  `PROJECT_STATUS.md`'s 29 Sep entry).** `ChartFrame` (tooltip, keyboard interaction,
  drag-resize, drag-select-to-zoom snapped to shift boundaries), the top-bar "Back to
  previous range" undo control, and shift-range period filtering threaded through every
  period route and report type (`shiftRange.ts`, `TC`/`TB1`/`TB2` commits) all pass the
  suite (vitest, jsdom-only) and typecheck, but — same caveat as every other UX-programme
  claim in this project — **jsdom computes no layout**, so drag-resize and drag-select are
  exercised as simulated pointer-event sequences, not as an observed mouse drag against a
  laid-out SVG. The real-browser layout harness (`sms/layout-tests/`, Playwright) gained
  two new spec files this same window (`charts.spec.ts`, `_debug2.spec.ts`, both currently
  untracked in git status) but neither had been confirmed run-and-green as of this
  documentation pass. This pass also found three MAJOR-severity issues in the concurrently
  landing chart/report code, not yet fixed as of this writing — see `DEFECTS.md` Part 11
  (b) a chart-bar click not activating Line's drill-down, (c) `/api/weight-stations`
  accepting an inverted `periodFrom`/`periodTo`, and (d) the Report screen showing no
  on-screen (only print) batch/simulator disclosure.

## Honesty block
- Nothing above has run against real plant data — every figure comes from a local dev sidecar with a deliberately contaminated (simulator-overlapping) generation.
- ~~No PDAS procedure has ever been executed against any database, local or plant.~~
  **Corrected 24 Sep 2026 — this sentence is false and must not be repeated as current fact.**
  Two 23 Sep 2026 passes executed PDAS procedures by hand via `sqlcmd -E`
  (`PDAS-EXECUTION-2026-09-23.md`); a 24 Sep 2026 pass exercised all nine write rights
  through the app's own code (`PDAS-EXECUTION-2026-09-24.md`, `58a705c`/`c21dfa9`). All of
  it was against the local `PDAS_TP1U2_SEP07` copy only, under `sms_pdas_writer`, **never**
  the plant; every run was restored from a proven-restorable backup afterward. `sms/.env`
  locally reads `PDAS_WRITE_ENABLED=true` pointed at the local copy only — the plant stays
  off.
- ~~Suite: 1745 passed / 4 skipped, `npx vitest run` from `sms/`; typecheck clean across all five workspaces — both observed 23 Sep 2026, after `cf1c363`.~~
  **Re-captured 24 Sep 2026, HEAD `8f5c80c`:** 196 files passed / 1 skipped, 2030 tests
  passed / 4 skipped, **2 tests failed** in
  `sync-worker/src/transform/isolatedDay.test.ts` — not investigated this pass (several
  files were under concurrent, uncommitted edit at the time); typecheck not re-run this
  pass. Stated as not-clean rather than rounded up to "green." A ~1-in-74 flake was found
  and fixed 22 Sep (`DEFECTS.md` D-7); unrelated to the two failures above.

Excluded on purpose: cosmetic polish, refactors, guard-test hygiene, the LOW/MEDIUM/informational RT findings already itemised in `DEFECTS.md`.
