# Commissioning gaps — what's missing to install this at IFL

One-minute read. Full evidence: `FRICTION-AUDIT.md`, `VERIFICATION-2026-09-23.md`,
`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md`, `DEFECTS.md`, `IFL-OPEN-QUESTIONS.md`.
Updated 23 Sep 2026 after the red-team audit (`d2cba5e`) and its 15-commit fix
wave (`016a047`…`cf1c363`). Every line traces to one of those, not to another
status document.

## 1. Stops commissioning

- No read-only login/host for the live plant server — nothing can be installed until this arrives → IFL #1
- PC-to-plant network reachability unconfirmed → IFL #2
- Cutover has never been rehearsed against an unknown login shape → ours
- PDAS write authority contradicts itself in our own records — `.env`'s comment says "ENABLED 22 Sep 2026 (IFL granted permission)", the flag itself still reads `false`, and no document names who at IFL granted it or which of the nine rights it covers (`DEFECTS.md` D-12) → IFL #3
- Windows service (NSSM) never installed or exercised on any machine → ours
- Nightly backup scheduled only on paper, never run unattended → ours
- ~114 commits ahead of `origin/floor-first-rework` (last pushed 16 Sep), ~179 ahead of `origin/main` — never seen by CI → ours
- No off-machine copy of IFL's data — both samples live on one laptop → ours

## 2. Wrong on screen today

- MachineProduct report: ~82% of columns are off-screen with no sticky column or fallback (RT-017, unfixed) → ours
- Product › Running shows a retired product with no "retired" marker while reports cite it as "the target" (RT-018, unfixed) → ours
- No server-side response-size/row-count cap independent of SQL (RT-014, unfixed) → ours
- A calendar-invalid date (`2026-13-45`) crashes the DB driver instead of being validated by the app, on 9 of 9 endpoints tried (RT-016, unfixed) → ours
- Nelson rules 2–8 flag 37.6–54.8% of station-groups on real data and stay deliberately suppressed pending an owner decision on one of four options (RT-019/`DEFECTS.md` D-10) → ours
- `routes/reports.ts`'s `newestProductionDay()` anchor still pools every source generation when picking the "default" report day (D-11's report-layer fix covers the report bodies; this one anchor query was not in that list) → ours

## 3. Fixed today, worth naming so it is not re-reported

- Line/Rejects/Report no longer disagree on the same period's reject rate (RT-001/003/004/009/029/032 — `ae7a59b`, `53ae8a3`, `54601a6`)
- The station report's "impossible row" (more within-tolerance cones than cones produced) is gone (RT-002 — `54601a6`)
- A 200 response with a field silently deleted no longer renders as a confident zero on Line, Weight, Rejects, Wall, Sacks or Calibration (RT-005/012/013/033 — `71757a3`, `ae7a59b`, `add32c5`, `26525ad`, `cf1c363`)
- The false "stopped" state from a zero-lag sample, and the 1970 clock-fault sentinel hijacking three anchor queries (a third site than the audit itself named), are both closed (RT-006/021 — `7558854`)
- Line's own provenance banner can no longer call simulator figures real (RT-007 — `19a4aa0`)
- Almost every canonical-table query now scopes to one source generation and says what it excluded, closing most of RT-008's root cause and RT-010/011 (`54601a6`, `26525ad`, `add32c5`, plus the pre-audit `6052b69`/`8673ffd`/`ca34a23` wave) — `weightStations.ts` and `routes/reports.ts:104` were re-checked this pass and are now scoped or noted above, respectively

## 4. Built but unproven

- PDF export has never been invoked end to end outside a script
- `sms verify` has never run against a live plant login
- Print/PDF layout is verified only by viewport-resize simulation, never a real print dialog
- Viewer (rank 1) role has never been signed into on a live instance

## Honesty block
- Nothing above has run against real plant data — every figure comes from a local dev sidecar with a deliberately contaminated (simulator-overlapping) generation.
- No PDAS procedure has ever been executed against any database, local or plant.
- Suite: 1745 passed / 4 skipped, `npx vitest run` from `sms/`; typecheck clean across all five workspaces — both observed 23 Sep 2026, after `cf1c363`. A ~1-in-74 flake was found and fixed 22 Sep (`DEFECTS.md` D-7); no re-occurrence observed today, which is not proof it cannot recur.

Excluded on purpose: cosmetic polish, refactors, guard-test hygiene, the LOW/MEDIUM/informational RT findings already itemised in `DEFECTS.md`.
