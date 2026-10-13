# Test baseline before the redesign build

- HEAD: f08b307 (floor-first-rework), run 2026-10-13 09:37-09:38 UTC, from `sms/`: `npx vitest run`, once.
- Test files: 403 passed, 1 failed, 1 skipped (405).
- Tests: 4181 passed, 4 skipped, 0 failed (4185).
- Duration: 52.21 s.

## Failure

`api/src/services/weightStations.test.ts` failed to load (0 tests ran): PARSE_ERROR at line 150:28, `it('returns each station's cone count ...')`, an unescaped apostrophe inside a single-quoted string. The file is tracked and shows as modified in `git status`, so this is another worker's in-progress edit, not part of the committed baseline.
