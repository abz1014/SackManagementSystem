# Handover: QA / try to break SMS

Repo root: `C:\Users\ABDULLAH SAJID\Desktop\sag database`, branch `floor-first-rework`,
commit `238e7a9`. Suite 1792 passed / 4 skipped / 0 failed (not re-run this pass).

## Goal of this session

The owner tests and tries to break the software — hands-on plus agent-assisted QA
against the local dev copy. Find defects; do not fix them in this session unless told to.

## Start-up

- API runs on `:4000` (last known PID 8928 — check it is still alive; if not, restart).
  `api/dist` goes stale whenever `api/src` changes — **rebuild (`npm run build` in
  `sms/api`) and restart before trusting any number the API returns.**
- **Vite (`:5173`) is currently DOWN.** Check `.claude/launch.json` and
  `sms/package.json` scripts for the dev-server command (likely `npm run dev` in
  `sms/web` or a root script) and start it before testing the UI.
- Sign in as the existing admin account. The owner knows the credentials — never write
  them into any file, commit, or agent prompt.

## Data reality — read before judging any number "wrong"

- `.env` deliberately points at `DATA_TP1U2_SIM` — the plant simulator overlapping
  real September data is the only fixture with two overlapping generations for
  testing epoch boundaries.
- Epoch 1 = July real (2026-06-22 → 2026-07-10). Epochs 9–12 = September real
  (2026-08-05 → 2026-09-07, clean through 2026-08-20). Epochs 13–16 = simulator rows,
  **deliberately mislabelled `provenance='ifl_copy'` — do not "fix" this**, it is
  intentional so the app can't cheat by branching on provenance.
- The 2026-07-10 → 2026-08-05 gap is real (IFL has not sent that month).
- Clock-fault rows exist at 1969-12-31, 2026-06-21, and a 1970 sentinel — expect a
  handful of rows there, not zero.
- 18-minute acquisition lag: the newest production timestamp is always ~18 min old on
  a healthy line. Never compare a production timestamp to `Date.now()` directly.
- Two clocks: plant production timestamps are the plant's wall clock labelled UTC;
  app-written instants (product timeline, adjustments, sync runs) are genuine UTC —
  5 hours apart on this plant. Do not compare them unconverted.
- **Validate any number you're unsure about against epoch 1 or epochs 9–12 only** —
  those are the real, trusted generations.

## Prior evidence to read first

`ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md`, `REMEDIATION-VERIFICATION-2026-09-23.md`,
`DEFECTS.md`, `FRICTION-AUDIT.md`, `sms/PERFORMANCE-APP-2026-09-24.md`,
`sms/PERFORMANCE-SOURCE-LOAD-2026-09-24.md` — all verified present in the repo.

## Known open — don't re-report these as new findings

RT-014 (no server-side response-size/row-count cap independent of SQL), RT-016
(an invalid calendar date crashes the DB driver → 500), RT-017 (MachineProduct's
on-screen columns clip — distinct from the print-only fix in a prior UX phase),
RT-018 (a retired product can render as the live target with no marker), RT-019
(Nelson rules 2–8 flag 37.6–54.8% of station-groups on real generations — owner
decision pending, see `DEFECTS.md` D-10), RT-020 (no confidence interval on the
days-to-limit projection). See `DEFECTS.md` and `CLAUDE.md` for the fuller open list.
Below-rank RBAC is untested live — no rank-1/2 accounts exist yet. Layout specs are
blocked on `SMS_TEST_USERNAME`/`SMS_TEST_PASSWORD` env vars not being set.

## Test tools

- `npx vitest run` and `npm run typecheck`, both from `sms/`.
- `npm run test:layout` — Playwright against installed Edge, needs
  `SMS_TEST_USERNAME`/`SMS_TEST_PASSWORD` set first.
- Read-only SQL: `node sms/q.mjs <db> "SELECT ..."`.
- Browser: patch `window.fetch` to simulate failures or partial/degraded payloads.
- A second API instance on `:4100` with overridden `IFL_DB_*` as process env (not
  `.env`) for DB-failure-path testing.
- Fake-pool test infrastructure: `sms/api/src/testkit/generations.ts`,
  `fakePositionalPool`, and `stripFields` in `sms/web/src/testkit/fixtures.ts`.

## Attack ideas (short list, not exhaustive)

Partial-200 payloads per screen (missing fields, not just missing rows); a source
table stopping or going stale mid-window; generation-boundary windows (a period
spanning two epochs); midnight/shift-boundary edges; invalid or malformed date
ranges; huge date ranges (perf/timeout); filters that are claimed but not actually
sent or honoured server-side; export (XLSX/PDF) numbers vs on-screen numbers
disagreeing; the `?at=` replay banner under edge times; Wall screen behaviour under a
dead fetch.

## How to record a finding

Use the 12-field format into `DEFECTS.md`: ID · severity · component
(`file::symbol`) · exact reproduction steps · data/generation used · expected ·
actual · why it matters · evidence (query output, screenshot, log) · existing test
coverage · why tests missed it · recommended fix.

## Hard rules

- Read-only on every IFL/PDAS database, no exceptions.
- Never repoint `.env`.
- Never run `epoch:accept`, `rebuild`, `cutover`, or `sync` commands.
- Never set `PDAS_WRITE_ENABLED=true` — that is the separate PDAS session's job
  (see `HANDOVER-PDAS.md`), not this one's.
- Never call `POST /api/changeover/execute` — the existing audit artefact
  `sms.product_change change_id=3` is the only record of that path ever firing;
  do not create a second one casually.
- Agents never create logins, accounts, or credentials to verify their own work.
- Validate any number in doubt against epoch 1 or epochs 9–12 only.

## Shared operating rules (apply to this session)

Orchestrator runs on Opus and plans nothing itself — all planning goes to an Opus
planner sub-agent, all execution to Sonnet worker sub-agents, max 4 running at once.
Locate code by symbol, not by line number (line numbers drift). Commit by explicit
pathspec only — never `git add -A`, `git add .`, `git add -a`, and never `git stash`
(six git incidents came from parallel workers doing this on 23 Sep). `git push` is
blocked by the Claude Code permission gate — **the owner runs
`git push origin floor-first-rework` himself**, never an agent. Commit trailer:
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `VERIFICATION-2026-09-23.md`
already carries a pre-existing uncommitted change in the working tree — leave it alone,
it is not this session's to resolve.

**Git state:** as of commit `238e7a9`, 4 commits are unpushed
(`git rev-list --count origin/floor-first-rework..HEAD`).
