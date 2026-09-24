# Handover: prove SMS's own PDAS write path, then prepare IFL's written ask

Repo root: `C:\Users\ABDULLAH SAJID\Desktop\sag database`, branch `floor-first-rework`,
commit `238e7a9`. Suite 1792 passed / 4 skipped / 0 failed (not re-run this pass).

## Goal of this session

Prove SMS's OWN code (routes → services → `pdasWrite.ts`) can execute all nine PDAS
write rights against the LOCAL copy of `PDAS_TP1U2_SEP07` — not just the vendor procs
by hand — then draft the one-page written ask to IFL. **Never the plant.**

## State today

- Vendor procedures **proven by hand** via `sqlcmd -E` against local `PDAS_TP1U2_SEP07`:
  `PDAS-EXECUTION-2026-09-23.md` (commits `f5ac691`, `8199955`). Its backup/restore
  protocol (fresh backup, prove restorability into a scratch DB with matching row
  counts, execute, restore live copy, re-verify counts match) is the template — reuse
  it exactly, do not reinvent it.
- **Our code has never executed.** `sms/api/src/services/pdasWrite.ts`,
  `sms/api/src/services/changeover.ts`, route `sms/api/src/routes/changeover.ts` are
  written and unit-tested but never driven end-to-end against a real PDAS database.
- `sms_pdas_writer` login **not created**; script
  `sms/db/bootstrap/12_pdas_writer.template.sql` never run.
- `.env`: `PDAS_WRITE_ENABLED=false`. Its comment wrongly says "enabled 22 Sep" — owner
  corrects that himself; this session does not touch `.env`.
- Facts already established (do not re-derive): `-7001` = `CreateMaterial` duplicate
  triple refusal; `-5001`/`-5002`/`-5003` = `AddTubeType` (dup name+form / bad form /
  bad weight). **Retire-and-recreate is impossible** — `CreateMaterial`'s uniqueness
  check never references `MaterialActive`. `CreateMaterial` logs `@blendId`, not the
  real new `MaterialId`, in `nhs_events` (vendor bug, confirmed twice). Changeover's
  `plan()` already blocks offering an existing combo as "new."
- **D-12 status (see `DEFECTS.md`):** owner confirmed the grant is real — all nine
  rights, local and plant, IFL's process engineers as users. **Still missing:** who at
  IFL granted it, on what date, written or verbal — this session's Step 0.
- **The nine rights**, across `dbo.Materials/Blends/Counts/TubeTypes/Pallets/nhs_events`:
  `CreateMaterial`, `SetMaterialStatusActive`, `AddBlend`, `AddCount`, `AddTubeType`,
  `CreatePallet`, `SetPalletStatusActive`, the guarded single-row `UPDATE
  dbo.Materials` (no vendor UPDATE proc exists — this is the only way to change a
  setpoint), and the paired `INSERT dbo.nhs_events` row. **Only `CreateMaterial` and
  `SetMaterialStatusActive`** were confirmed in writing by IFL on 2026-09-11; the
  other seven, including the edit-in-place UPDATE, were not part of that confirmation.

## Plan

**Step 0 — paperwork, do first, cheap.** Record in `DEFECTS.md` D-12, `CLAUDE.md`, and
`IFL-OPEN-QUESTIONS.md` item 3: who/when/written-or-verbal is still unconfirmed for the
nine-rights grant; the ask to IFL is "please confirm in writing" plus attaching the
grant script from Step 1.

**Step 1 — OWNER ONLY, never an agent.** Create `sms_pdas_writer` on the LOCAL copy via
`sms/db/bootstrap/12_pdas_writer.template.sql` — read the script first for its
variables (login name, password placeholder, database) and run with:
```
sqlcmd -E -S .\SQLEXPRESS -i "sms\db\bootstrap\12_pdas_writer.template.sql" -v DbName="PDAS_TP1U2_SEP07" -v LoginName="sms_pdas_writer" -v LoginPassword="<owner picks>"
```
(confirm actual `-v` variable names against the file — do not guess without reading it).
Also create a second, narrower login shaped like what `ibrahim` (an IFL process
engineer) would realistically get: EXECUTE on the nine procs only, no `db_datareader`,
no `VIEW DEFINITION`. Minimal sketch, **for the owner to run, not an agent** — adjust to
match what the actual grant script produces, this is a sketch not gospel:
```sql
CREATE LOGIN ibrahim_test WITH PASSWORD = '<owner picks>';
USE PDAS_TP1U2_SEP07; CREATE USER ibrahim_test FOR LOGIN ibrahim_test;
GRANT EXECUTE ON dbo.CreateMaterial TO ibrahim_test;
GRANT EXECUTE ON dbo.SetMaterialStatusActive TO ibrahim_test;
GRANT EXECUTE ON dbo.AddBlend TO ibrahim_test;
GRANT EXECUTE ON dbo.AddCount TO ibrahim_test;
GRANT EXECUTE ON dbo.AddTubeType TO ibrahim_test;
GRANT EXECUTE ON dbo.CreatePallet TO ibrahim_test;
GRANT EXECUTE ON dbo.SetPalletStatusActive TO ibrahim_test;
GRANT UPDATE ON dbo.Materials TO ibrahim_test;  -- guarded single-row path only
GRANT INSERT ON dbo.nhs_events TO ibrahim_test;
```
**Step 2 — backup, second instance, drive all nine rights.**
- Back up BOTH `PDAS_TP1U2_SEP07` and the `sms` sidecar database; prove both restore
  into scratch copies with matching row counts, same protocol as
  `PDAS-EXECUTION-2026-09-23.md`, before touching either live copy.
- Run a SECOND API instance on a non-4000 port (e.g. 4100) with
  `PDAS_WRITE_ENABLED=true` and the `sms_pdas_writer` credentials passed as **process
  env vars**, never written into `.env`, pointed at the local copy only.
- Drive all nine rights through our own routes/Changeover screen (not raw `sqlcmd`)
  end to end.
- After each call, read back PDAS state, `nhs_events`, and `sms.product_change`.
- Restore both databases from the Step 2 backups; re-verify row counts match the
  pre-execution state exactly.

**Step 3 — trimmed verification.** Confirm duplicate refusals surface through our
error handling (not just the vendor's raw `@error`), flag-off returns `503`, a real
blocker returns `409`. Rank/RBAC tests wait until real accounts exist.

**Step 4 — `ibrahim` rehearsal.** Point the second instance at the narrower
EXECUTE-only login from Step 1 and record exactly what breaks (missing grants,
missing `db_datareader` where the code assumes it, etc.) — this is the dry run for
what IFL's own engineer login will need.

**Step 5 — fix only what Steps 2/4 actually broke**, test-first, smallest diff.

**Step 6 — write the one-page letter to IFL** naming: the nine rights precisely, the
edit-in-place explanation (why "retire then recreate" cannot work and "edit the
existing material's limits" is the real path), the login shape needed (EXECUTE-only,
no read access), and the grant script to hand their DBA.

**Plant is out of scope for this session, even though permission exists in principle** —
local `PDAS_TP1U2_SEP07` only, every step.

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
