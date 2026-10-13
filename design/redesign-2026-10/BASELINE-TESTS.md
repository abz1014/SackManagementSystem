# Test baseline before the redesign build

- HEAD: f08b307 (floor-first-rework), run 2026-10-13 09:37-09:38 UTC, from `sms/`: `npx vitest run`, once.
- Test files: 403 passed, 1 failed, 1 skipped (405).
- Tests: 4181 passed, 4 skipped, 0 failed (4185).
- Duration: 52.21 s.

## Failure

`api/src/services/weightStations.test.ts` failed to load (0 tests ran): PARSE_ERROR at line 150:28, `it('returns each station's cone count ...')`, an unescaped apostrophe inside a single-quoted string. The file is tracked and shows as modified in `git status`, so this is another worker's in-progress edit, not part of the committed baseline.

## After foundation (B/C/D/G0), 13 Oct 2026, task C8

Measured from `sms/` on branch `floor-first-rework` after the copy consolidation, the charts-use-shared-states change, the uniformity guard and the component gallery (HEAD before this docs commit: the Gallery rank-name fix commit).

- `npm run typecheck` (shared, sync-worker, cli, api, web, web-next): clean.
- `npx vitest run`, twice, identical: **428 files passed / 1 skipped (429), 4,456 tests passed / 4 skipped / 2 todo, 0 failed.** (The first attempt had 1 failure, `web/src/rank.crosscheck.test.ts` "every WriteGate uses a named rank": the new Gallery used literal `minRank={2}`; fixed to `ENGINEER_RANK`, then both runs above were clean.)
- web-next alone: 18 files, 223 tests.
- `/next` smoke: web-next built to a scratch directory and served by the read-only login-free harness on an ephemeral port; Edge via Playwright at 1366x768 loaded `/next/`: HTTP 200 for page, css, js, font; page text "SMS (next)"; 0 console errors or warnings. Stub only (App.tsx is not yet wired to the screens or the gallery).
- Not run here: `npm run test:layout` (no layout spec covers web-next yet), a person looking at the gallery, the plant. The owner's API on :4000 and the Vite dev server on :5173 were not contacted.
