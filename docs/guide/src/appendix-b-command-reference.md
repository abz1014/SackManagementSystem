# Command reference {appendix #appendix-commands}

All commands below run from the package root (`C:\sms` once installed)
unless stated otherwise. Arguments use `--key=value`; a bare space-separated
`--flag value` is not accepted.

## The CLI — `node cli/dist/index.js <command> [flags]`

| Command | Purpose |
|---|---|
| `sync` | Runs one full read-transform-write pass. Halts and exits 1 on an unregistered source generation or a partial failure. |
| `verify [--weights] [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--source-db=<name> --epoch=<id>[,<id>]]` | Reconciles the app database against the source, per generation. Exits 1 on any mismatch. `--source-db` checks a backfilled generation against an archive database and needs `--epoch`. |
| `summary [--date=YYYY-MM-DD] [--shift=<text>] [--epoch=N[,M]]` | Prints one block per source generation covering the date. Read-only, always exits 0. |
| `rebuild --table=<cone_event\|sack_event\|reject_event> --snapshot-id=<id> (--epoch=N[,M] \| --all-generations) --confirm` | Deletes and re-derives canonical rows for one table and scope. Prints a plan first; without `--confirm`, exits 2 and changes nothing. |
| `cutover --confirm --backup=<path.bak>` | Clears canonical and raw readings ahead of a cutover from a test copy to the live plant. `--backup=<path.bak>` is required — a bare `--confirm` with no backup flag is refused at exit 2, even though `DEPLOY.md`'s own shorthand omits it. Preserves accounts, product timeline, rule history and the audit log. |
| `retention [--dry-run]` | Prunes old `sms.sync_run` and non-CRITICAL `sms.dq_finding` rows only — never readings, the audit log, or the product-change history. |
| `user:create --username=<u> --password=<p> --role=<viewer\|engineer\|manager\|admin> [--display=<name>]` | Creates an account. Role must be exactly `viewer`, `engineer`, `manager` or `admin`. |
| `user:password --username=<u> --password=<new password>` | Resets a password and revokes every session for that account. |
| `epoch:list` | Lists every registered source generation with its row counts and time range. |
| `epoch:accept (--all \| --table=<sourceTable>) --confirm --provenance=<ifl_live\|ifl_copy\|simulator> [--label="…"]` | Registers a source generation. Two-step: run once without `--confirm` to see the plan, then re-run identically with `--confirm` added. `--provenance` is required for a new registration. It refuses a restored old archive posing as a new generation; `--i-know-this-is-a-new-generation` overrides that, audited, only on the maintainer's instruction. |
| `epoch:backfill (--table=<sourceTable> \| --all) --epoch=<id> --source-db=<archive database> [--confirm] [--sampled]` | Adds older rows to the end of a closed generation's raw tables. Dry run without `--confirm` (exit 2, nothing changed). Refuses everything on any failed check. Proven only on scratch copies; IFL's real archive has not been sent. Run `rebuild` afterwards. |
| `epoch:purge --epoch=N[,M] --confirm --backup=<path.bak>` | Deletes rows for closed generation(s), keeping the generation record itself as a tombstone. Same backup gate as `cutover`. |
| `epoch:drop --epoch=N --confirm` | Deletes a generation record entirely — only if it holds no rows; use `epoch:purge` first otherwise. |

## `npm` scripts (from the package root)

| Script | Does |
|---|---|
| `npm run build:shared` | Builds the `shared` workspace only. |
| `npm run typecheck` | Type-checks every workspace. |
| `npm test` | Runs the test suite. |
| `npm run test:layout` | Runs the browser layout tests (developers). |
| `npm run db:migrate` | Applies every pending database migration. |
| `npm run build` | Builds every workspace in dependency order (`shared`, `sync-worker`, `cli`, `api`, `web`). |
| `npm run verify:release` | `typecheck` + `test` + `build`, together. |

## `sms\scripts\*.ps1`

| Script | Purpose |
|---|---|
| `backup-appdb.ps1 -Server <host,port> -Db sms -Pass <password> -OutDir <dir>` | Nightly checksummed backup of the app database only. `-User ""` uses a trusted Windows connection instead of a SQL login/password — what the scheduled task itself uses. Writes a `.verified.json` marker beside a backup that passes `RESTORE VERIFYONLY`, and renames one that fails to `.unverified`. Deletes `.bak` files (and markers) older than 30 days in `-OutDir` unless `-NoPrune` is given. |
| `backup-config.ps1 -InstallDir C:\sms -BackupDir C:\sms-backups` | Copies `.env`, TLS material, service definitions and scheduled-task XML into an ACL-locked folder — never the database itself. Must run as administrator. |
| `install-scheduled-tasks.ps1 -InstallDir C:\sms -RunAs <account> -BackupDir C:\sms-backups [-WhatIf]` | Registers the three production scheduled tasks: nightly backup, weekly database maintenance, daily retention. `-WhatIf` previews without registering. |

## `sqlcmd` and Windows commands used during installation

| Purpose | Command |
|---|---|
| Create the app database and its logins | `sqlcmd -S <server\instance> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="…" -v MigratePassword="…"` |
| Open the API port | `netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000` |
| Weekly database maintenance | `sqlcmd -S .\SQLEXPRESS -E -d sms -b -i scripts\db-maintenance.sql` |
| Check/run a scheduled task | `schtasks /query /tn "SMS Nightly Backup" /v /fo LIST`, `schtasks /run /tn "SMS Nightly Backup"` |
| Wall-mode kiosk browser | `msedge --kiosk http://<plant-ip>:4000/?s=wall --edge-kiosk-type=fullscreen` |

> **Warning:** DEPLOY.md's own shorthand for cutover, `sms cutover --confirm`,
> omits the required `--backup=<path.bak>` flag and is refused by the code.
> Always include `--backup=<path.bak>`.
