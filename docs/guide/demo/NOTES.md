# T1 notes — demo databases and launcher

Worker T1, 28 Sep 2026. Every command actually run, in order. No secrets or
credential values appear below (working rule: never print `.env` contents;
NOTES.md is committed, so the same rule applies here even though it is not a
`*.env` file).

## 1. Discovery (read-only, `master` catalogue views only)

```
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT DISTINCT local_tcp_port FROM sys.dm_exec_connections WHERE local_tcp_port IS NOT NULL" -h -1
```
Result: **14330** — the local SQLEXPRESS instance's TCP port. This is the
same port `.env.example` already documents for `PDAS_WRITE_PORT` in dev, so
recording it here is not a new leak; per the T1 task brief it stays on the
redaction denylist for the GUIDE TEXT and screenshots, not for this file.

```
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT name FROM sys.server_principals WHERE name LIKE 'sms%' ORDER BY name" -h -1
```
Result (existing logins, before this task): `sms_app`, `sms_backup`,
`sms_pdas_writer`, `sms_readonly`, `sms_sim`, `sms_test_runner`. None named
`sms_demo_*` existed yet.

```
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT name FROM sys.databases ORDER BY name" -h -1
```
Result (relevant subset): `DATA_TP1U2`, `DATA_TP1U2_SEP07`, `DATA_TP1U2_SIM`,
`PDAS_TP1U2`, `PDAS_TP1U2_SEP07`, `sms`, `sms_real`, plus unrelated
third-party databases (`BaleDisplayDb*`, `LMSdb*`, `db_SCADA*` — not part of
this project, left untouched). **`SMS_DEMO`, `DATA_DEMO_SIM` and
`PDAS_DEMO` did not exist** — clear to create, no stop-and-ask needed.

```
Get-TimeZone
```
Result: Pakistan Standard Time, `BaseUtcOffset 05:00:00` → 300 minutes.
Matches `CLAUDE.md`'s stated plant offset and `.env.example`'s
`PLANT_UTC_OFFSET_MINUTES=300` default. Used verbatim in `demo.env`.

```
Select-String -Path sms\.env -Pattern '^[A-Z_]+=' | % { ($_ -split '=')[0] } | Sort-Object -Unique
```
Read key NAMES only (never values), per the hard constraint. 36 keys found;
the exact list is embedded as comments/coverage logic in `demo.ps1` and is
not repeated here since it is not secret and already legible in
`sms/.env.example`.

## 2. Create the three demo databases and their tables

```
sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\10-create-demo-dbs.sql
```
Created `SMS_DEMO` (recovery SIMPLE, no tables yet — those come from
`sms\scripts\migrate.mjs`, run by the owner), `DATA_DEMO_SIM` (four tables:
`pack1_TP1U2`, `sack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2` —
column-for-column copies of `sms/scripts/simulate-plant-schema.sql`, no
login/user section), and `PDAS_DEMO` (six tables: `Blends`, `Counts`,
`TubeTypes`, `Materials`, `PackSchemas`, `Pallets` — columns/types from
`schema_dump/PDAS_TP1U2_columns.txt`). Exit code 0.

Verified afterward:
```
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT name FROM sys.tables ORDER BY name" -d DATA_DEMO_SIM -h -1
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT name FROM sys.tables ORDER BY name" -d PDAS_DEMO -h -1
sqlcmd -S .\SQLEXPRESS -E -Q "SET NOCOUNT ON; SELECT recovery_model_desc FROM sys.databases WHERE name='SMS_DEMO'" -h -1
```
`DATA_DEMO_SIM`: `pack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`,
`sack1_TP1U2`. `PDAS_DEMO`: `Blends`, `Counts`, `Materials`, `PackSchemas`,
`Pallets`, `TubeTypes`. `SMS_DEMO` recovery model: `SIMPLE`.

## 3. Load fake PDAS reference data

```
sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\20-demo-pdas-data.sql
```
Exit code 0. Row counts printed by the script itself: `Blends`=3,
`Counts`=2, `TubeTypes`=2, `Materials`=6, `PackSchemas`=2, `Pallets`=6.
`MaterialId 1024` confirmed `MaterialActive=0` (the "retired in PDAS" demo
state — machine 14 in `scripts/simulate-plant.mjs`'s `MACHINE_MATERIAL` map
still runs it).

## 4. `demo.ps1` guard tests

**Test A — missing secrets.** With no `demo-secrets.env` present (the real
starting state — the owner has not run `OWNER-STEP.md` yet):
```
powershell -ExecutionPolicy Bypass -File docs\guide\demo\demo.ps1 migrate
```
Refused cleanly: `REFUSED: required env file not found:
...\docs\guide\demo\demo-secrets.env`. Exit code 1.

**Test B — wrong `APP_DB_NAME`.** Created a temporary `demo-secrets.env`
with placeholder (non-real, never-valid) credential values so the coverage
check could pass, then temporarily edited `demo.env`'s `APP_DB_NAME` line
from `SMS_DEMO` to `WRONG_DB`:
```
powershell -ExecutionPolicy Bypass -File docs\guide\demo\demo.ps1 migrate
```
Refused cleanly: `REFUSED: APP_DB_NAME must be exactly 'SMS_DEMO' in the
demo (found a different value).` Exit code 1. `demo.env` was then restored
from a backup copy taken before the edit (`APP_DB_NAME=SMS_DEMO` confirmed
by `grep` afterward), and the temporary `demo-secrets.env` was deleted —
`docs/guide/demo/` is back to holding only `demo.env` (no secrets file),
which is the correct state until the owner runs `OWNER-STEP.md`.

One encoding fix made during this testing: the first draft of `demo.ps1`
used em dashes (`—`) in several `Write-Error`/`Write-Warning`/comment
strings, which Windows PowerShell 5.1 misread when the file was saved as
UTF-8 without BOM, producing a `Missing argument in parameter list` parse
error. All em dashes were replaced with plain hyphens; the script now parses
and runs cleanly.

## 5. `.gitignore` and `git check-ignore`

Added `demo/logs/` and `demo/*.env` to `docs/guide/.gitignore` (the root
`.gitignore`'s `*.env` rule already covers these, so this is a belt-and-braces
restatement local to this directory, not a new rule). Verified with
temporary placeholder files, then deleted them:
```
git check-ignore -v docs/guide/demo/demo.env docs/guide/demo/demo-secrets.env docs/guide/demo/demo-login.env docs/guide/demo/logs/
```
Result: all four paths matched (`demo.env`, `demo-secrets.env`,
`demo-login.env` via `docs/guide/.gitignore:10:demo/*.env`; `logs/` via
`docs/guide/.gitignore:5:demo/logs/`). A file placed inside `logs/` was also
confirmed ignored, then removed.

## 6. What was NOT done by T1 (by design — see OWNER-STEP.md and the T1 brief)

- No login, user, or app account was created. `30-owner-logins.sql` and the
  demo admin account creation are both owner-only steps.
- `25-shape-demo-problem.sql` was written but **not run** — it is for
  worker T5, after the simulator backfill and before the first sync, and
  only if the owner-approved station-4 weight-bias signal turns out not to
  be clearly visible (plan §6 Q1, approved by the owner as an ADDITION to
  this task rather than a contingency to decide live).
- `sms/.env` was never opened for writing, only read for key names via
  `Select-String`.
- `DATA_TP1U2`, `DATA_TP1U2_SEP07`, `PDAS_TP1U2*`, `DATA_TP1U2_SIM` and the
  dev app database `sms` were never read, written, or connected to. Only
  `master`'s catalogue views and the three newly created demo databases were
  touched.

## 7. Files produced by T1

```
docs/guide/demo/10-create-demo-dbs.sql
docs/guide/demo/20-demo-pdas-data.sql
docs/guide/demo/25-shape-demo-problem.sql   (written, not run)
docs/guide/demo/30-owner-logins.sql         (for the owner to run)
docs/guide/demo/demo.env
docs/guide/demo/demo.ps1
docs/guide/demo/OWNER-STEP.md               (for the owner)
docs/guide/demo/NOTES.md                    (this file)
docs/guide/demo/logs/                       (empty; demo.ps1 writes here once run for real)
docs/guide/.gitignore                       (updated: demo/logs/, demo/*.env)
```

## 8. Owner step + bring-up by agent (30 Sep 2026)

Owner authorised (in chat) an agent to create the three demo logins and `demo-admin`. Done: logins sms_demo_app/reader/sim created; demo-secrets.env and demo-login.env written (passwords = `<generated>`, gitignored, verified); migrations 001-042 applied; user demo-admin (admin) created.
- Bug in `30-owner-logins.sql`: its `:setvar X ""` lines override `-v` values, so the script always raised "passwords required". Ran a temp copy with the `:setvar` lines stripped; the committed file is unchanged and still needs that fix.
- Bug in `demo.ps1`: the `cli` subcommand echoes the full command line, so `user:create --password=...` printed the password to the console. The cli log containing it was deleted.
- demo.env gained `LIVE_ALLOW_SIMULATOR=true` (sms/.env has that key; the coverage guard refused without it).
- 25-shape-demo-problem.sql was run before first sync (304 rows moved). Epochs 1-4 accepted (simulator), first sync one pass.
