# COMMANDS.md — every command a user or IT types, exactly

All commands run from `sms/` unless stated. Arguments must use `--key=value` (a bare
space-separated `--flag value` is NOT supported by the CLI's parser — `sms/cli/src/context.ts:70-78`,
`parseArgs()` regex `^--([^=]+)(?:=(.*))?$` — a space-separated value is silently dropped as a
stray positional word; this trap is called out explicitly for `--label` and `--provenance`).

## 1. The CLI — `node cli/dist/index.js <command> [flags]`

Dispatch table: `sms/cli/src/index.ts:59-104`; help text: `sms/cli/src/index.ts:14-56`.
Unknown/empty command prints help; exit 1 if a command word was given and unrecognised, 0 if none.

### `sync`
`node cli/dist/index.js sync` — `sms/cli/src/commands/sync.ts`. No flags.
- Runs one full Reader→raw→Transform→canonical pass; prints per-table read/written counts.
- On success, clears any standing `persistent_sync_failure` finding.
- On a partial `TableHaltsError`, reports what synced, prints the halt message, **exits 1**.
- Exit codes: 0 success, 1 partial/total failure.

### `verify`
`node cli/dist/index.js verify [--weights] [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--source-db=<name> --epoch=<id>[,<id>]]` — `sms/cli/src/commands/verify.ts`.
- `--weights` — adds COUNT/SUM/AVG/MIN/MAX weight reconciliation per source generation.
- `--from`/`--to` — must both be given together, `YYYY-MM-DD`, plant-wall-clock production day;
  errors if only one given, not a real date, or `from > to`.
- `--source-db=<name>` (added 29 Sep 2026) reconciles a CLOSED, backfilled generation against a
  named archive database on the same server instead of the live source. It **requires**
  `--epoch=<id>[,<id>]` alongside it (a usage error otherwise). With `--epoch`, only the named
  generations are checked; any other generation is listed as "not named by --epoch — skipped" and
  cannot cause a STOP.
- Reconciles per source generation, then per-table (identity check, id-checksum, raw⇄canonical
  key gaps), then merge-key collisions and DQ-finding counts.
- Writes one row to `sms.verify_run` per run regardless of verdict (write failure logged only).
- Exit codes: 0 clean, 1 on any STOP or weight mismatch.

### `summary`
`node cli/dist/index.js summary [--date=YYYY-MM-DD] [--shift=<text>] [--epoch=N[,M]]` — `sms/cli/src/commands/summary.ts`.
- `--date` defaults to the latest `shift_date` in scope.
- `--shift` is not validated against a fixed enum in this command.
- `--epoch=N[,M]` is optional here (unlike `rebuild`); an invalid/empty list with a non-empty
  string given errors with **exit 2**.
- Prints one block per source generation covering the date; if more than one generation covers
  it, no combined total is shown, and the exact narrowing command is printed.
- Read-only; **exit 0 always**, including the "no data" case.

### `rebuild`
`node cli/dist/index.js rebuild --table=<cone_event|sack_event|reject_event> --snapshot-id=<id> (--epoch=N[,M] | --all-generations) --confirm` — `sms/cli/src/commands/rebuild.ts`.
- `--table` must be exactly one of `cone_event`, `sack_event`, `reject_event`, else exit 2.
- `--snapshot-id` required, must match `/^[A-Za-z0-9][A-Za-z0-9_.:\-]{7,}$/` (≥8 chars, alnum
  start); example given in the code: `sms_20260914_1530`.
- `--epoch=N[,M]` XOR `--all-generations` is **required, with no default** (changed 23 Sep
  2026) — giving both, or neither, is refused.
- Refuses if any `sms.sync_run` row has a pass in flight, refuses unknown/unregistered epoch
  ids, refuses an empty scope.
- Prints a full plan before requiring `--confirm`; without it, **exit 2**, "Nothing has been
  changed."
- On confirm: writes `sms.rebuild_audit` + `sms.audit_log` rows, deletes canonical rows in
  chunks of 5000 under the transform lock, resets transform watermarks, re-runs the transform.
- Exit codes: 0 success, 1 failure during execution, 2 for any refusal/validation gate.

### `cutover`
`node cli/dist/index.js cutover --confirm --backup=<path.bak>` — `sms/cli/src/commands/cutover.ts`.
- `--backup=<path>` is **required**, must exist and end in `.bak` — checked before opening any
  database connection (`sms/cli/src/commands/guards.ts:43-67`, `requireBackupFlag`).
- Prints row counts per table to be cleared, then requires `--confirm`; without it, exit 2.
- Checks no pass is in flight, else exit 2.
- Clears canonical + all four raw tables, resets transform watermarks, clears
  `sms.source_epoch` (left empty, not re-seeded), clears `sms.dq_finding`.
- **Preserves**: `app_user`, `product`/`product_timeline`, `reject_code` labels,
  `shift_rule`/`weight_rule`/`plausibility_rule`, `calibration_adjustment`, admin audit.
- Records `cutover.last_utc` and an audit row; prints the exact next-step commands.
- Exit codes: 0 success, 1 on error, 2 on any refusal.
- **DEPLOY.md contradiction:** `sms/DEPLOY.md:410` shows the invocation as `sms cutover --confirm`
  with no `--backup` — copy-pasted literally this is refused at exit 2 by the code's own guard.
  Always include `--backup=<path to a .bak file>`.

### `retention`
`node cli/dist/index.js retention [--dry-run]` — `sms/cli/src/commands/retention.ts`.
- `--dry-run` runs the same COUNT queries and deletes nothing.
- Prunes `sms.sync_run` older than `RETENTION_SYNC_RUN_DAYS` (default 90) **always keeping the
  newest row per (line, table)**; prunes `sms.dq_finding` older than `RETENTION_DQ_FINDING_DAYS`
  (default 365) **except CRITICAL**; prunes expired `sms.session` rows.
- **Never touches** `sms.audit_log`, `sms.product_change`, or any raw/canonical reading table.
- A real (non-dry-run) run writes one audit row, `retention.run`.
- Exit codes: 0 success, 1 on error.

### `user:create`
`node cli/dist/index.js user:create --username=<u> --password=<p> --role=<viewer|engineer|manager|admin> [--display=<name>]` — `sms/cli/src/commands/user.ts`.
- **`--display=<name>` is undocumented** in the CLI's own help text — sets `display_name`;
  defaults to the username if omitted (`sms/cli/src/commands/user.ts:46`).
- Valid roles are exactly `viewer`, `engineer`, `manager`, `admin` — the old names `operator`
  and `supervisor` are **refused**, not aliased (since migration 035, 15 Sep 2026); an invalid
  role exits 2 with `--role must be one of: viewer, engineer, manager, admin`.
- Password must be at least `PASSWORD_MIN_LENGTH` characters (default 10, valid range 6–128),
  else exit 2 with `The password must be at least N characters.`
- Default role when `--role` is omitted: `viewer`.
- Success message: `created user '<username>' (<role>)`.
- Exit codes: 0 success, 1 on DB error, 2 on validation refusal.
- **README.md contradiction:** `sms/README.md`'s own example still shows
  `--role=<operator|supervisor|manager|admin>` — those first two names are stale and will be
  refused by the current code. Use `viewer|engineer|manager|admin`.

### `user:password`
`node cli/dist/index.js user:password --username=<u> --password=<new password>` — `sms/cli/src/commands/user.ts:96-160`.
- Same password-length policy as `user:create`. Unknown username exits 2.
- Updates the password hash, **revokes every existing session for that user**, writes an audit
  row `user.password_reset`.
- Success message: `password set for '<username>'; N session(s) revoked`.
- Exit codes: 0 success, 1 on DB/transaction error, 2 on validation refusal.

### `epoch:list`
`node cli/dist/index.js epoch:list` — `sms/cli/src/commands/epoch.ts:44-99`. No flags. Prints
every `sms.source_epoch` row joined against raw-table counts/min/max production timestamps.
Always exits 0.

### `epoch:accept`
`node cli/dist/index.js epoch:accept (--all | --table=<sourceTable>) --confirm --provenance=<ifl_live|ifl_copy|simulator> [--label="…"] [--i-know-this-is-a-new-generation]` — `sms/cli/src/commands/epoch.ts:127-408`.
- `--all` XOR `--table=<t>` — one required, else exit 2.
- `--provenance` is **required** for any new registration (not required for an in-place update
  of an already-open generation) — no default ever; must be exactly `ifl_live`, `ifl_copy`, or
  `simulator`, else exit 2.
- Guard: if the target database name ends in `_SIM` (case-insensitive) but `--provenance` is
  not `simulator`, refused — because the simulator only ever writes to `_SIM`-suffixed
  databases.
- `--label="…"` optional; **must use `=`** — a bare `--label "x"` is silently treated as no
  label given, with a printed warning.
- `--confirm` required after the plan is printed, else exit 2, "Nothing has been changed."
  **Two-step flow**: first run without `--confirm` to see the plan, then re-run identically
  with `--confirm` added.
- **Data-vintage guard (added 29 Sep 2026).** It refuses (exit 2, nothing changed) to register a
  "new" generation that is really an old archive: one whose newest reading is implausibly older
  than what is already open, or whose id range checksums as an already-closed generation. A
  restored or rebuilt old database gets today's create date, so the guard reads the data itself.
  The refusal names `epoch:backfill` as the right path for genuinely old data.
  `--i-know-this-is-a-new-generation` overrides it; use it only on instruction from the SMS
  developer. Every use that changes a real registration is written to the audit log.
- Exit codes: 0 success/no-op, 1 on error, 2 on validation refusal.

### `epoch:backfill`
`node cli/dist/index.js epoch:backfill (--table=<sourceTable> | --all) --epoch=<id> --source-db=<archive database> [--confirm] [--sampled]` — `sms/cli/src/commands/backfill.ts`.
- Added 29 Sep 2026 for the 10 Jul – 5 Aug gap once IFL sends it. It adds older rows to the end of
  an already-CLOSED generation's raw tables (`sms_raw.*` only). It never touches IFL's database
  and never writes canonical tables; run `rebuild` afterwards to derive them.
- `--epoch=<id>` is required and must name the closed generation being extended. `--source-db` is
  required: a database on the same server as the configured IFL source, opened read-only.
- **Dry run by default.** Without `--confirm` it prints the plan (source max id, id already held,
  the tail range, the overlap proof) and exits 2 with "Nothing has been changed."
- Refuses everything (zero writes) if the epoch is open or unknown, the source has the September
  column shape, or the overlap checksum does not match. With `--all`, one failing table aborts the
  whole run.
- `--sampled` swaps the full overlap check for a faster check on every 50th id.
- Writes an audit row, `epoch.backfill`. Exit codes: 0 success, 1 on error, 2 on refusal.
- Status: proven only on scratch copies; never run against IFL's real archive (not yet sent).

### `epoch:purge`
`node cli/dist/index.js epoch:purge --epoch=N[,M] --confirm --backup=<path.bak>` — `sms/cli/src/commands/epoch.ts:421-532`.
- `--epoch=N[,M]` (comma list, positive integers) required.
- `--backup=<path.bak>` required, same gate as `cutover`.
- Prints per-table row counts to be purged (canonical + raw, 7 tables), then requires `--confirm`.
- Checks no pass is in flight.
- Deletes rows (chunked, canonical then raw); the `sms.source_epoch` row itself is **kept as a
  tombstone** — only `closed_utc` is set and a note appended.
- Writes audit row `epoch.purge`.
- Exit codes: 0 success, 1 on error, 2 on refusal.

### `epoch:drop`
`node cli/dist/index.js epoch:drop --epoch=N --confirm` — `sms/cli/src/commands/epoch.ts:535-578`.
- `--epoch=N` single positive integer required.
- Refuses (exit 2) if the epoch still holds any raw rows — use `epoch:purge` first.
- Without `--confirm`, prints what would be deleted and exits 2.
- Deletes the `sms.source_epoch` row entirely (no tombstone) — for undoing a bad registration
  with zero rows attached.
- Exit codes: 0 success, 2 on refusal; an unexpected DB error propagates to exit 1.

## 2. `sms/package.json` npm scripts (run from `sms/`)

| Script | Command |
|---|---|
| `npm run build:shared` | `npm run build --workspace @sms/shared` |
| `npm run dev` | prints guidance to run `web`'s dev server and the built API separately (no single dev command) |
| `npm run typecheck` | `tsc -b shared sync-worker cli api web` |
| `npm test` | `vitest run` |
| `npm run test:layout` | `playwright test -c playwright.config.ts` |
| `npm run db:migrate` | `node scripts/migrate.mjs` |
| `npm run dictionary` | `node scripts/data-dictionary.mjs` |
| `npm run build` | builds `shared`, `sync-worker`, `cli`, `api`, `web` in that order, each `tsc -b` (web also runs `vite build`) |
| `npm run verify:release` | `npm run typecheck && npm test && npm run build` |

Per-workspace: `api`: `start` = `node dist/index.js`. `sync-worker`: `sync:once` = `node dist/index.js --once`. `web`: `dev` = `vite`, `preview` = `vite preview`.

## 3. `sms/scripts/*.ps1`

### `backup-appdb.ps1` — nightly checksummed backup of the app database only
```
powershell -File scripts\backup-appdb.ps1 -Server "<host>,<port>" -Db sms -Pass "<sms_backup password>" -OutDir "<backup dir>"
```
Params (defaults): `-Server` (`localhost,14330`, a local dev example), `-Db` (`sms`), `-User`
(`sms_backup`; pass `-User ""` for a trusted Windows connection via `sqlcmd -E`, used by the
scheduled task), `-Pass` (no default; required only when `-User` is non-empty), `-OutDir`
(`C:\sms-backups`), `-NoPrune` (switch; skip the 30-day cleanup for this run). Uses `WITH INIT, CHECKSUM, STATS = 10` (Express has no backup compression).
Verifies success by exit code, file existence, and a `RESTORE VERIFYONLY ... WITH CHECKSUM`.
On success it writes a marker file `<backup>.bak.verified.json` beside the backup (file name,
size, UTC time, method); Health reads it to say a backup is "proven restorable". If verification
fails, the `.bak` is renamed to `<backup>.bak.unverified` and the script exits non-zero.
Unless `-NoPrune` is given, it deletes `.bak` files (and their markers) older than 30 days in `-OutDir`.

### `backup-config.ps1` — copies config (never the database) into an ACL-locked folder
```
powershell -ExecutionPolicy Bypass -File scripts\backup-config.ps1 -InstallDir "C:\sms" -BackupDir "C:\sms-backups"
```
Params: `-InstallDir` (`C:\sms`), `-BackupDir` (`C:\sms-backups`), `-Services`
(`@("SMS-Api","SMS-Sync")`), `-Tasks` (`@("SMS Nightly Backup","SMS Weekly Maintenance","SMS Daily Retention")`),
`-Keep` (10). Must run as administrator. Copies `.env`, TLS material, NSSM service definitions,
and scheduled-task XML under `<BackupDir>\config\<stamp>\`, then restricts that folder's ACL to
the current user plus `BUILTIN\Administrators`. Keeps the newest `-Keep` snapshots.

### `install-scheduled-tasks.ps1` — registers the three production scheduled tasks
```
powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -InstallDir "C:\sms" -RunAs "<domain>\<svc account>" -BackupDir "C:\sms-backups" -WhatIf
```
Params: `-InstallDir` (`C:\sms`), `-RunAs` (**mandatory, no default** — a Windows account
holding `db_backupoperator`), `-Server` (`localhost,14330`), `-Database` (`sms`), `-BackupDir`
(`C:\sms-backups`), `-NodeExe` (`C:\Program Files\nodejs\node.exe`), `-BackupTime` (`02:00`),
`-MaintenanceTime` (`03:00`), `-RetentionTime` (`04:00`). Supports `-WhatIf` (prints without
registering). Registers exactly three tasks: "SMS Nightly Backup" (daily, runs
`backup-appdb.ps1 -User ''`), "SMS Weekly Maintenance" (weekly Sunday, runs
`sqlcmd.exe -S <Server> -E -d <Database> -b -i <InstallDir>\scripts\db-maintenance.sql`),
"SMS Daily Retention" (daily, runs `<NodeExe> "<InstallDir>\cli\dist\index.js" retention`).
Pre-flight checks that `backup-appdb.ps1`, `db-maintenance.sql`, `cli\dist\index.js`, and
`-NodeExe` all exist, else exit 1.

## 4. `sms/DEPLOY.md` commands (redacted placeholders substituted per REDACTION.md)

| Purpose | Command | file:line | Contradicted by code? |
|---|---|---|---|
| Create the app database and logins | `sqlcmd -S <server\instance> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="…" -v MigratePassword="…"` | DEPLOY.md:31 | No (SQL script, not independently re-verified this pass) |
| Open the API port | `netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000` | DEPLOY.md:73 | No — matches `API_PORT` default 4000 |
| Wall-mode kiosk browser | `msedge --kiosk http://<plant-ip>:4000/?s=wall --edge-kiosk-type=fullscreen` | DEPLOY.md:84-85 | No (browser flag, not app code) |
| Create the local simulator database | `sqlcmd -S .\SQLEXPRESS -E -Q "CREATE DATABASE [DATA_TP1U2_SIM]"` | DEPLOY.md:118 | No — matches the `_SIM`-suffix requirement in the simulator's guard |
| Build | `npm ci && npm run build` | DEPLOY.md:190 | No |
| Release verification | `npm run verify:release` | DEPLOY.md:190 | No |
| Migrate, marking a range already applied | `node scripts/migrate.mjs --mark-applied-through=NNN` (exactly 3 digits, e.g. `022`) | DEPLOY.md:209-211,227 | No — matches the migration runner's own regex |
| Migrate | `npm run db:migrate` | DEPLOY.md:195,201,225,642 | No |
| First admin account | `node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin` | DEPLOY.md:240 | No |
| Wall-display viewer account | `node cli/dist/index.js user:create --username=wall --password=<strong> --role=viewer` | DEPLOY.md:90 | No |
| First sync | `node cli/dist/index.js sync` | DEPLOY.md:404 | No |
| Accept the first generation | `node cli/dist/index.js epoch:accept --all --provenance=ifl_live --label="Plant, live"`, then re-run with `--confirm` added | DEPLOY.md:405 | No — matches the two-step confirm flow exactly |
| Verify | `node cli/dist/index.js verify` | DEPLOY.md:407,539 | No |
| List generations | `node cli/dist/index.js epoch:list` | DEPLOY.md:408 | No |
| Cutover (documentation shorthand) | `sms cutover --confirm` | DEPLOY.md:410 | **YES — see the `cutover` section above: `--backup=<path.bak>` is required and this literal command is refused at exit 2.** |
| Retention | `node cli\dist\index.js retention [--dry-run]` | DEPLOY.md:604 | No |
| Summary | `node cli/dist/index.js summary --date=YYYY-MM-DD [--shift=] [--epoch=N[,M]]` | DEPLOY.md:540-546 | No |
| Rebuild one table | `node cli/dist/index.js rebuild --table=cone_event --snapshot-id=<id> --epoch=<generation> --confirm` | DEPLOY.md:718,450 | No |
| Weekly DB maintenance | `sqlcmd -S .\SQLEXPRESS -E -d sms -b -i scripts\db-maintenance.sql` | DEPLOY.md:621 | No — matches the scheduled task's own invocation |
| Register scheduled tasks | `powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -InstallDir "C:\sms" -RunAs "<domain>\<svc account>" -BackupDir "C:\sms-backups" -WhatIf` | DEPLOY.md:591 | No, but DEPLOY.md itself is internally inconsistent about the example account name (`<svc account>` vs. `<svc account>-backup` in different sections) — a documentation inconsistency, not a code bug |
| Check/run a scheduled task | `schtasks /query /tn "SMS Nightly Backup" /v /fo LIST`, `schtasks /run /tn "SMS Nightly Backup"` | DEPLOY.md:600 | No — task name matches exactly |

### Contradictions found (summary)
1. **`sms cutover --confirm`** (DEPLOY.md:410) omits the required `--backup=<path.bak>` flag —
   literally refused by the code. Always include `--backup`.
2. **`sms/README.md`'s `user:create` example** still shows the retired role names
   `operator|supervisor` — the current CLI refuses them; use `viewer|engineer|manager|admin`.
3. **Migration count**: DEPLOY.md and README.md describe "27 migrations / 31 tables" as the
   steady state; the migrations folder currently holds more files on disk (39 by one count in
   this pass), and later migrations (e.g. 039, `sms.verify_run`) are referenced elsewhere in the
   code. The "27" figure is a superseded snapshot per this project's own dated-entry convention,
   not a live bug — use the current on-disk count on any cover page rather than quoting "27" as
   present fact.
