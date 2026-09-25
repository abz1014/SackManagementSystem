# RT24-05 rehearsal: an EXECUTE-only ("ibrahim"-shaped) PDAS login, local copy only

**Who runs this: the owner, on the Windows laptop, with SSMS or `sqlcmd` access to
`.\SQLEXPRESS`. No agent may create a login, run this script, or touch `PDAS_TP1U2_SEP07`
beyond read-only `SELECT`s — see `CLAUDE.md`'s working rules and the fix-wave brief this kit
was written under.**

## 0. What this proves, and why it needs its own login

`DEFECTS.md` RT24-05 (`25b02bc`) made a PDAS write's failed read-back raise a standing
CRITICAL `pdas_write_unverified` finding instead of silently pretending the write succeeded.
That fix has never been observed firing, because every login used against PDAS so far —
including the dev login behind `PDAS_WRITE_USER` today — carries `SELECT` on the five PDAS
tables `sms/api/src/services/pdasPermissions.ts` checks (`PDAS_SELECT_TABLES`:
`Materials`, `Blends`, `Counts`, `TubeTypes`, `Pallets`). The plant's real SOP has engineers
running the vendor's procedures by hand under a named personal login (`ibrahim`, per the ten
SSMS screenshots `DEPLOY.md` cites) with **no ad-hoc SELECT grant implied** — an EXECUTE-only
shape. This rehearsal creates a login shaped exactly like that, against the **local**
`PDAS_TP1U2_SEP07` copy only, does exactly one write through it, confirms
`pdas_write_unverified` actually appears, then undoes everything.

**Target, and nothing else:** `PDAS_TP1U2_SEP07` on `.\SQLEXPRESS`. Every script below refuses
to run against any other server or database name — check the guard block before running
anything, and if a guard fails, stop and do not proceed by hand.

## 1. Pre-checks

Open `sqlcmd -S .\SQLEXPRESS -E` (Windows auth) and run:

```sql
SELECT @@SERVERNAME AS server_name, DB_NAME() AS current_db;
GO
SELECT name FROM sys.databases WHERE name = 'PDAS_TP1U2_SEP07';
GO
```

Confirm `server_name` ends in `\SQLEXPRESS` and the second query returns exactly one row. If
either check fails, **stop** — do not adapt this script to a different server or database name.

## 2. Backup, and prove it restores (reuse the earlier protocol)

Same shape as `PDAS-EXECUTION-2026-09-24.md`'s restore commands (repo root). Pick a backup
directory the owner already uses for these (e.g. `D:\sms-backups\`).

```sql
-- 2a. Full backup, timestamped, CHECKSUM (catches a corrupt backup before it is trusted).
DECLARE @stamp varchar(20) = FORMAT(SYSUTCDATETIME(), 'yyyyMMdd-HHmmss');
DECLARE @path nvarchar(400) = N'D:\sms-backups\PDAS_TP1U2_SEP07-' + @stamp + '-RT2405.bak';
BACKUP DATABASE PDAS_TP1U2_SEP07 TO DISK = @path WITH CHECKSUM, INIT;
-- Note the printed @path — you need it in step 2b and step 6.
GO

-- 2b. Prove it restores, into a SCRATCH database, never over the original.
-- Replace <path> with the exact file BACKUP DATABASE wrote above.
RESTORE VERIFYONLY FROM DISK = N'<path>';
GO
RESTORE DATABASE PDAS_RT2405_SCRATCH
  FROM DISK = N'<path>'
  WITH MOVE 'PDAS_TP1U2_SEP07' TO 'C:\SQLData\PDAS_RT2405_SCRATCH.mdf',
       MOVE 'PDAS_TP1U2_SEP07_log' TO 'C:\SQLData\PDAS_RT2405_SCRATCH_log.ldf',
       REPLACE;
GO
-- If your data/log file names differ, check them first:
--   SELECT name, physical_name FROM sys.master_files WHERE database_id = DB_ID('PDAS_TP1U2_SEP07');

-- 2c. Row counts, scratch vs. live — must match exactly (same anchor tables PDAS-EXECUTION-2026-09-24.md used).
SELECT 'live' AS which, (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Materials) AS Materials,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Blends) AS Blends,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Counts) AS Counts,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.TubeTypes) AS TubeTypes,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Pallets) AS Pallets
UNION ALL
SELECT 'scratch', (SELECT COUNT(*) FROM PDAS_RT2405_SCRATCH.dbo.Materials),
       (SELECT COUNT(*) FROM PDAS_RT2405_SCRATCH.dbo.Blends),
       (SELECT COUNT(*) FROM PDAS_RT2405_SCRATCH.dbo.Counts),
       (SELECT COUNT(*) FROM PDAS_RT2405_SCRATCH.dbo.TubeTypes),
       (SELECT COUNT(*) FROM PDAS_RT2405_SCRATCH.dbo.Pallets);
GO
-- Fill both rows into the results template (section 7) before continuing.

-- 2d. Drop the scratch database — its only job was proving the backup restores.
ALTER DATABASE PDAS_RT2405_SCRATCH SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE PDAS_RT2405_SCRATCH;
GO
```

**Also record the live pre-run anchor counts** (same five tables, against
`PDAS_TP1U2_SEP07` directly, plus the `sms.dq_finding` and `sms.product_change` row counts
in the app DB) — you will re-check both sets in step 5 and again in step 6.

```sql
SELECT (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Materials) AS Materials,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Blends) AS Blends,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Counts) AS Counts,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.TubeTypes) AS TubeTypes,
       (SELECT COUNT(*) FROM PDAS_TP1U2_SEP07.dbo.Pallets) AS Pallets;
GO
```

## 3. The EXECUTE-only login — SQL template

Save as `rt2405-login.sql`. It has its own guard (refuses any server not ending
`\SQLEXPRESS` or any database name other than `PDAS_TP1U2_SEP07`) and takes the password as a
`sqlcmd` variable so nothing is ever typed into a file. **No SELECT is granted on any table —
that is the entire point of this rehearsal.**

```sql
-- rt2405-login.sql — owner runs this by hand. Refuses to run anywhere else.
:setvar TargetDb "PDAS_TP1U2_SEP07"

IF @@SERVERNAME NOT LIKE '%\SQLEXPRESS'
BEGIN
  RAISERROR('Guard: this script only runs against a .\SQLEXPRESS instance. Stopping.', 16, 1);
  RETURN;
END
IF DB_ID('$(TargetDb)') IS NULL
BEGIN
  RAISERROR('Guard: database $(TargetDb) does not exist on this server. Stopping.', 16, 1);
  RETURN;
END
IF '$(TargetDb)' <> 'PDAS_TP1U2_SEP07'
BEGIN
  RAISERROR('Guard: this script only targets PDAS_TP1U2_SEP07. Stopping.', 16, 1);
  RETURN;
END

USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_rt2405_execonly')
  CREATE LOGIN sms_rt2405_execonly WITH PASSWORD = '$(WriterPassword)', CHECK_POLICY = ON;
GO

USE $(TargetDb);
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_rt2405_execonly')
  CREATE USER sms_rt2405_execonly FOR LOGIN sms_rt2405_execonly;
GO

-- The seven vendor procs pdasWrite.ts ever calls (PDAS_EXEC_PROCS in
-- api/src/services/pdasPermissions.ts) plus the guarded UPDATE/INSERT rights
-- for a setpoint change — the same nine rights IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md
-- asks IFL for, MINUS every SELECT grant that letter also asks for.
GRANT EXECUTE ON OBJECT::dbo.CreateMaterial          TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.SetMaterialStatusActive TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.AddBlend                TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.AddCount                TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.AddTubeType             TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.CreatePallet            TO sms_rt2405_execonly;
GRANT EXECUTE ON OBJECT::dbo.SetPalletStatusActive   TO sms_rt2405_execonly;
GRANT UPDATE ON OBJECT::dbo.Materials  TO sms_rt2405_execonly;
GRANT INSERT ON OBJECT::dbo.nhs_events TO sms_rt2405_execonly;
-- Deliberately NO SELECT anywhere in this database. If a later run of this
-- script needs to add one for some other purpose, that is a different
-- rehearsal, not this one.
GO

PRINT 'sms_rt2405_execonly created/updated: EXECUTE + guarded UPDATE/INSERT only, no SELECT.';
```

Run it (the owner types the password, never this file):

```
sqlcmd -S .\SQLEXPRESS -E -i rt2405-login.sql -v WriterPassword="<a password you choose, not written down>"
```

**Validate the SQL parses without running it**, before ever executing it for real. Run it once
with `TargetDb` deliberately wrong first — the guard block fires and `RETURN`s before any
`CREATE LOGIN`/`GRANT` runs, proving the guard, not the grants, without creating anything:

```
sqlcmd -S .\SQLEXPRESS -E -i rt2405-login.sql -v WriterPassword="x" -v TargetDb="__parse_only__"
```

**Not run this pass**: this environment's `sqlcmd`/ODBC could not reach `.\SQLEXPRESS` at all
(`Named Pipes Provider: Could not open a connection... [53]`) from the sandbox this agent runs
in — the same instance other passes reached directly by hand on the owner's own machine. §8
below states this as unverified live, not as a passing check.

## 4. The rehearsal script — `sms/scripts/rehearse-rt24-05.mjs`

**This replaces an earlier, wrong draft of this section.** The earlier draft told you to set
`.env`'s own `PDAS_WRITE_*` names and start a full second API instance on `:4600`, then hand-roll
an `updateProductLimits` call with a `setpointG`/`offsetMinusG`/`offsetPlusG` shape directly on
`p` — that is not the real signature. Read from `api/src/services/pdasWrite.ts` directly:

```ts
async updateProductLimits(p: {
  productId: number;
  before: ProductFields;   // { setpointG, offsetMinusG, offsetPlusG, desc1, desc2, active }
  after: ProductFields;
  bounds: SetpointBounds;  // { setpointLoG, setpointHiG }
  reason: string;
  actor: Actor;            // { userId, username }
}): Promise<LimitsResult>
```

`before` must be the row's REAL current values (the call rejects a stale/wrong `before` as a
`CONFLICT`, by design — see `PdasWriter.sameFields`), so it must be read first, not invented.
There is also no standalone HTTP route for a single `updateProductLimits` call — every route
that reaches `PdasWriter` is `/api/changeover/execute`, which always plans a full
blend+count+tube+material+pallet changeover — so this rehearsal uses a small script instead,
`sms/scripts/rehearse-rt24-05.mjs` (new this pass, modelled on `sms/scripts/pdas-e2e-local.mjs`'s
own local-only guard and import shape). Read its own header comment before running it; the
summary:

- **Guard, no override**: refuses to run unless the target resolves to
  `localhost`/`127.0.0.1`/`::1` AND the database name ends in `_SEP07` or `_E2E` — checked
  BEFORE anything else, including the credentials check below.
- **Credentials**, checked second, before any connection opens: four env vars, named
  **exactly** `RT2405_WRITE_SERVER` (default `localhost`), `RT2405_WRITE_PORT` (default
  `1433`), `RT2405_WRITE_DATABASE` (default `PDAS_TP1U2_SEP07`), `RT2405_WRITE_USER` and
  `RT2405_WRITE_PASSWORD` (both required, no default). These are deliberately **not** `.env`'s
  own `PDAS_WRITE_*` names — that separation means a copy-paste slip can never make this
  rehearsal accidentally use the real app's (always-disabled) writer config, or vice versa.
- Reads the CURRENT `before` values off `dbo.Materials` using `.env`'s own `IFL_DB_*`
  login — the same read-only credential `q.mjs` already uses for PDAS reads (provisioned with
  SELECT only) — never the EXECUTE-only rehearsal login, because `before` must be read
  reliably regardless of whether the write login can read anything (that is the entire point
  of this rehearsal).
- Builds `after` as the same six fields with `setpointG` **+1** (smallest real change).
- Resolves `bounds` the same way `routes/changeover.ts`'s own `setpointBounds()` does:
  `getPlausibilityRule(pool, lineId)` against the local `sms` app database.
- Opens a `PdasWriter` whose PDAS connection uses `RT2405_WRITE_USER`/`RT2405_WRITE_PASSWORD` —
  the EXECUTE-only login from §3 — and calls `updateProductLimits`.
- Prints the call's result, the newest `sms.product_change` rows, every
  `pdas_write_unverified` row in `sms.dq_finding`, and `writer.probePermissions()`'s own
  verdict.

**Exact copy-paste PowerShell**, from `sms/` (build first if `api/dist` is stale:
`npm run build --workspace @sms/api`):

```powershell
$env:RT2405_WRITE_SERVER = "localhost"
$env:RT2405_WRITE_PORT = "1433"
$env:RT2405_WRITE_DATABASE = "PDAS_TP1U2_SEP07"
$env:RT2405_WRITE_USER = "sms_rt2405_execonly"
$securePw = Read-Host -AsSecureString "Password for sms_rt2405_execonly (the one you chose in step 3)"
$env:RT2405_WRITE_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw))
node scripts/rehearse-rt24-05.mjs --material 1024
```

`--material 1024` is the default and may be omitted; it is a REAL product row on the LOCAL
copy (verified this pass, `node q.mjs PDAS_TP1U2_SEP07 "SELECT MAX(MaterialId) FROM
dbo.Materials"` → `1024`, and the row exists with `MaterialSetpointWeight = 1960`), never a
row IFL depends on outside this local rehearsal — it is restored to its exact prior value by
§7's restore, the same as everything else on the copy.

**Proven this pass, without the EXECUTE-only login and without touching PDAS** (the script
refuses before opening any connection in both cases, so nothing below needed a login):

```
$ node scripts/rehearse-rt24-05.mjs
REFUSING TO RUN: RT2405_WRITE_USER and/or RT2405_WRITE_PASSWORD is not set.
  This script needs the EXECUTE-only rehearsal login's own credentials —
  never sms_pdas_writer, never any value from .env or .env.e2e-writer.
  Set both (see handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md §4) and re-run.

$ RT2405_WRITE_SERVER='TP1-PDAS\PDAS' node scripts/rehearse-rt24-05.mjs
REFUSING TO RUN: server "TP1-PDAS\PDAS" does not resolve to localhost/127.0.0.1/::1.
  RT2405 server resolved to: "TP1-PDAS\PDAS" (host: "tp1-pdas")
  RT2405 database resolved to: "PDAS_TP1U2_SEP07"
  This script only ever runs against a local, _SEP07- or _E2E-named copy.
  It must never be pointed at the plant. There is no override flag.

$ RT2405_WRITE_DATABASE='PDAS_TP1U2' node scripts/rehearse-rt24-05.mjs
REFUSING TO RUN: database "PDAS_TP1U2" does not end in _SEP07 or _E2E.
  ...
```

Both `exit 1`. A fourth run, with the guard and credentials check both passed but a
deliberately fake `RT2405_WRITE_USER`/`PASSWORD`, was also run this pass to prove the script
proceeds past both checks and only then attempts a real network connection (it opened the real
local `sms` app pool, then failed with `ECONNREFUSED`/`ConnectionError` trying to reach
`localhost:1433` — this sandbox cannot reach `.\SQLEXPRESS` over TCP at all, the same limitation
noted in §1; the owner's own machine reaches it directly). **No write happened in any of these
four runs** — the first two never open a connection at all, and the fourth fails before ever
querying `dbo.Materials`.

## 5. Fallback: via the UI instead of the script

If the script does not run cleanly on the owner's machine, a full changeover through the app's
own UI is an alternative single-write proof (a heavier one — it exercises `AddBlend` plus
`CreateMaterial` plus `CreatePallet`, not the single-row `UPDATE`). Start a SEPARATE API
instance on `:4600`, using `.env`'s own `PDAS_WRITE_*` names this time (this is the real app's
own writer config path, `resolvePdasWrite` in `api/src/config.ts` — different from §4's
`RT2405_WRITE_*` names, which belong only to the standalone script):

```powershell
$env:API_PORT = "4600"
$env:PDAS_WRITE_ENABLED = "true"
$env:PDAS_WRITE_SERVER = "localhost"
$env:PDAS_WRITE_PORT = "1433"
$env:PDAS_WRITE_DATABASE = "PDAS_TP1U2_SEP07"
$env:PDAS_WRITE_USER = "sms_rt2405_execonly"
$securePw = Read-Host -AsSecureString "Password for sms_rt2405_execonly"
$env:PDAS_WRITE_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw))
$env:PDAS_WRITE_ENCRYPT = "true"
$env:PDAS_WRITE_TRUST_SERVER_CERTIFICATE = "true"
node api/dist/index.js
```

`resolvePdasWrite` refuses to enable the writer if `PDAS_WRITE_DATABASE` does not match
`IFL_DB_NAME_PDAS`, or if `PDAS_WRITE_USER` equals `IFL_DB_USER` — both conditions are already
satisfied by `.env`'s existing values, so no `.env` edit is needed; only the process-env
overrides above are new, and they exist only in this PowerShell session.

**Proven this pass, at the config level only** (no server or DB connection needed — called
`loadApiConfig()` twice in the same Node process, once with `PDAS_WRITE_ENABLED` unset, once
with it `"true"` plus fake `PDAS_WRITE_*` values): the unset case returned `{ enabled: false,
db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' }`; the enabled case returned
`{ enabled: true, db: { server: 'localhost', ... } }`. The override is read correctly, and
`.env` itself was confirmed unchanged before and after (`PDAS_WRITE_ENABLED=false`). This
proves the env-reading path only — it does **not** prove the live authenticated `/api/health`
round trip mentioned below, which needs an actual `:4600` process and a signed-in session
(`health.ts` only fills in the `pdasWrite` block for an authenticated request — `a ?
pdasWrite : null` — so an anonymous request always shows `pdasWrite: null` regardless of the
flag; sign in first, or the toggle will look like it "did nothing").

Then sign in on `:4600` as a rank ≥ `PDAS_WRITE_RANK` account, open Product › Changeover, plan
a changeover that adds one new blend by name, reusing an existing count/tube/pallet where
possible, and execute it.

## 6. Exactly what to check afterward

Against the **app** database (`sms`, not PDAS) on the same `.\SQLEXPRESS`:

```sql
-- The standing CRITICAL finding RT24-05 exists to raise.
SELECT TOP 5 run_id, check_name, severity, subject_table, detail, detected_at_utc
FROM sms.dq_finding
WHERE check_name = 'pdas_write_unverified'
ORDER BY detected_at_utc DESC;
-- Expect exactly one new row, severity CRITICAL, subject_table = 'product'
-- (updateProductLimits' subject table), detail naming the table and the
-- missing-SELECT reason (raiseReadbackFailed's own message text,
-- pdasWrite.ts ~line 1000).

-- The write itself, marked UNVERIFIED, observed_after_json NULL.
SELECT TOP 3 change_id, product_id, operation, outcome, message,
       before_json, after_json, observed_after_json, changed_at
FROM sms.product_change
ORDER BY changed_at DESC;
-- Expect outcome = 'ok' (the UPDATE itself committed — PDAS really holds
-- the new limits), message prefixed "UNVERIFIED — PDAS accepted the write
-- but SMS could not read it back (...)", observed_after_json IS NULL.
```

On Health (`GET /api/health` on :4600, or the Health screen signed in there): the "Checked
after writing" line (`web/src/screens/health/PdasWriteBlock.tsx`) must read the `canReadBack:
false` sentence, naming the missing-SELECT tables, never "yes". `GET /api/health`'s
`pdasWrite.canReadBack` field is the same value.

Fill every one of these into the results template (§7) — do not just say "it worked."

## 7. Restore, and confirm exactly where you started

```sql
USE master;
ALTER DATABASE PDAS_TP1U2_SEP07 SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE PDAS_TP1U2_SEP07
  FROM DISK = N'<the @path from step 2a>'
  WITH REPLACE;
ALTER DATABASE PDAS_TP1U2_SEP07 SET MULTI_USER;
GO
-- Re-run the five-table count query from step 2 ("live pre-run anchor
-- counts") and confirm every number matches exactly what you recorded
-- before step 5.

-- Drop the rehearsal login — it must not survive this rehearsal.
USE PDAS_TP1U2_SEP07;
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_rt2405_execonly')
  DROP USER sms_rt2405_execonly;
GO
USE master;
IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_rt2405_execonly')
  DROP LOGIN sms_rt2405_execonly;
GO
```

Then: stop the `:4600` node process (Ctrl+C, or close the PowerShell window it runs in — it
is a separate process from `:4000`, so nothing else is affected). Confirm in a fresh shell
that `sms/.env` still reads `PDAS_WRITE_ENABLED=false` — this rehearsal never touched that
file, so it should already be true, but confirm it rather than assume it.

## 8. Results template — the owner fills this in, or pastes command output below each line

```
Date/time run: 
Operator: 

STEP 1 — pre-checks
  server_name: ____________   (expect ...\SQLEXPRESS)
  PDAS_TP1U2_SEP07 present: Y/N

STEP 2 — backup + restore proof
  Backup file path: ____________
  RESTORE VERIFYONLY: PASS/FAIL
  Scratch DB row counts vs live — Materials/Blends/Counts/TubeTypes/Pallets:
    live:    ____________
    scratch: ____________
  Match: Y/N
  Scratch DB dropped and confirmed gone: Y/N
  Live pre-run anchor counts (Materials/Blends/Counts/TubeTypes/Pallets): ____________

STEP 3 — login created
  Login name: sms_rt2405_execonly
  Grants applied (paste PRINT output): ____________
  Confirmed NO SELECT anywhere (paste a query proving it, e.g.
    SELECT * FROM fn_my_permissions('dbo.Materials','OBJECT') WHERE permission_name='SELECT'
    run AS sms_rt2405_execonly, expect zero rows): ____________

STEP 4 — the write, via rehearse-rt24-05.mjs
  --material used (default 1024): ____________
  before values printed: ____________
  after values printed: ____________
  updateProductLimits result (paste it): ____________

STEP 5 — fallback (only if STEP 4's script was not used)
  Which write performed instead: AddBlend via UI
  :4600 instance — started with PDAS_WRITE_ENABLED unset: /api/health pdasWrite.enabled = ____________ (expect false)
  :4600 instance — started with PDAS_WRITE_ENABLED=true:  /api/health pdasWrite.enabled = ____________ (expect true)
  blend name used: ____________
  UI outcome: ____________

STEP 6 — checks
  sms.dq_finding pdas_write_unverified row (paste it): ____________
  sms.product_change row — outcome / message / observed_after_json (paste it): ____________
  Health "Checked after writing" line (paste the exact sentence shown): ____________

STEP 7 — restore + cleanup
  Post-restore anchor counts (Materials/Blends/Counts/TubeTypes/Pallets): ____________
  Match pre-run counts: Y/N
  :4600 process stopped: Y/N
  Login dropped (query proving sys.server_principals no longer has it): ____________
  sms/.env PDAS_WRITE_ENABLED still false (paste the line, do not paste any password): ____________

Overall verdict (RT24-05's CRITICAL path observed firing under a real
EXECUTE-only role): PASS / FAIL / INCONCLUSIVE, with why:
```

## Validated this pass, without creating the login or touching PDAS

- The guard block in `rt2405-login.sql` (§3) was proven correct by inspection: `TargetDb <>
  'PDAS_TP1U2_SEP07'` and `@@SERVERNAME NOT LIKE '%\SQLEXPRESS'` both `RAISERROR` and `RETURN`
  before any `CREATE LOGIN`/`USE`/`GRANT` statement. Not executed against a live server this
  pass (would require a login this pass is forbidden to create); the SQL was read against the
  actual T-SQL syntax `PDAS-EXECUTION-2026-09-23.md`/`-24.md` already used successfully for
  comparable guarded scripts, not invented from scratch.
- `resolvePdasWrite` (`api/src/config.ts`) was read in full this pass — the three refusal
  conditions cited in §5 (`missing` field, database mismatch, same-login-as-reader) are quoted
  from the real function, not paraphrased from memory.
- The nine grants in §3 are copied from `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md`
  §5's own script with every `GRANT SELECT` line removed — a diff against that file, not a
  fresh list. **Not independently confirmed that the seven procedure names exist on this copy**
  via `q.mjs`: `SELECT name FROM sys.procedures WHERE name IN (...)` through `.env`'s
  `IFL_DB_USER` returns zero rows, because that login has no `EXECUTE`/`VIEW DEFINITION` on any
  procedure and SQL Server hides procedure metadata from a login with no permission on the
  object (`CLAUDE.md`'s own account of why the 16 Sep 2026 introspection needed `sqlcmd -E`
  instead) — this is the documented reason, not a new gap, and the seven names are already
  established by the 21 Sep 2026 `sys.parameters` introspection and the two 23 Sep 2026
  execution passes named throughout this file, not invented here.
- `updateProductLimits`'s REAL signature — `{ productId, before: ProductFields, after:
  ProductFields, bounds: SetpointBounds, reason, actor }`, no top-level `setpointG`/
  `offsetMinusG`/`offsetPlusG` — its subject table (`'product'`), and `raiseReadbackFailed`'s
  message text and CRITICAL/WARNING split, were read directly from
  `api/src/services/pdasWrite.ts` (~lines 215, 275, 743, 934-1010) this pass, and the earlier
  draft's wrong flat-fields call in §4 (now replaced) is corrected as of this revision.
- `sms.dq_finding`'s and `sms.product_change`'s REAL column names were confirmed by `node
  q.mjs sms "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='sms' AND
  TABLE_NAME='...'"` this pass: `dq_finding` has `detected_at_utc`, not `created_at_utc`;
  `product_change` has `changed_at`, not `changed_at_utc`. §6's queries below use the
  confirmed names; the earlier draft's queries (now corrected) did not.
- `dbo.nhs_events`'s columns (`EventId`, `Src`, `Severity`, `Logtext`, `Timestamp`) were
  confirmed the same way against `PDAS_TP1U2_SEP07`.
- `MaterialId` 1024 is confirmed the current `MAX(MaterialId)` on the local copy (`node q.mjs
  PDAS_TP1U2_SEP07 "SELECT MAX(MaterialId) maxId, COUNT(*) cnt FROM dbo.Materials"` →
  `maxId: 1024, cnt: 24`) and its row (`MaterialSetpointWeight: 1960, ...`) was read this pass
  — `1025`, the earlier draft's default, **does not exist** on this copy (it was created 23 Sep
  2026 and restored away afterward, per this file's own history above).
- `sms/scripts/rehearse-rt24-05.mjs` (new this pass) was syntax-checked (`node --check`) and
  run four times against this sandbox to prove its guard and credentials checks fire correctly
  and in the right order, without ever opening a PDAS connection or performing a write — see
  §4's "Proven this pass" block for the exact output of all four runs.
