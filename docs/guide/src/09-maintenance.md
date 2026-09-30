# Maintenance {#maintenance}

## Backups and a restore test {#backups}

The nightly backup task (registered in {{ref:install-scheduled-tasks}}) runs
`backup-appdb.ps1`, which backs up the app database only, checks the file
with `RESTORE VERIFYONLY ... WITH CHECKSUM`, and deletes `.bak` files older
than 30 days from its output folder (add `-NoPrune` to keep every file for
that run):
```powershell
powershell -File scripts\backup-appdb.ps1 -Server "<host>,<port>" -Db sms -Pass "<sms_backup password>" -OutDir "<backup dir>"
```
The scheduled task itself runs it with `-User ''` (a trusted Windows
connection via `sqlcmd -E`), so no password needs to be stored for it.

When the check passes, the script writes a small marker file beside the
backup, named like the backup with `.verified.json` added. [[Health]] reads
it, so its Backups block can say the newest backup has been proven
restorable. If the check fails, the backup file is renamed to end in
`.unverified` and the script exits with an error; Health then reports the
newest backup that does have a good marker. Keep `BACKUP_DIR` in `.env` the
same as the backup folder, or Health will look in the wrong place.

> **Note:** A verified marker proves the file is intact, not that it
> restores cleanly onto your server. The restore test below is still needed.

> **Warning:** A backup is only worth having if it can be restored. Test
> this deliberately, on a spare or scratch SQL Server instance, not the live
> app database — restore the newest `.bak` file with SQL Server's own
> `RESTORE DATABASE`, and confirm the restored copy opens and its row counts
> look sane, on a schedule IFL is comfortable with (for example, after every
> significant configuration change, and at least once a quarter).

Configuration (not the database) is backed up separately, into an
ACL-locked folder, and never includes the database itself:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-config.ps1 -InstallDir "C:\sms" -BackupDir "C:\sms-backups"
```

## Scheduled tasks {#maintenance-tasks}

The three scheduled tasks registered in {{ref:install-scheduled-tasks}} run
on their own; check any one's history with:
```cmd
schtasks /query /tn "SMS Nightly Backup" /v /fo LIST
```
Substitute "SMS Weekly Maintenance" or "SMS Daily Retention" for the other
two.

## Retention {#retention}

`retention` prunes only `sms.sync_run` history (default 90 days, always
keeping the newest row per line/table) and non-CRITICAL `sms.dq_finding`
rows (default 365 days) — never readings, `sms.audit_log`, or
`sms.product_change`. Preview what a run would remove before running it for
real:
```text
node cli/dist/index.js retention --dry-run
```
Then, once satisfied:
```cmd
node cli/dist/index.js retention
```
The daily scheduled task already runs this automatically; running it by
hand is for checking its behaviour, not something to do routinely.

## Database maintenance {#db-maintenance}

The weekly maintenance task runs SQL Server's own maintenance script
directly:
```cmd
sqlcmd -S .\SQLEXPRESS -E -d sms -b -i scripts\db-maintenance.sql
```

## Configuration backup {#config-backup}

See {{ref:backups}} above — `backup-config.ps1` is the dedicated tool for
this, separate from the database backup.

## Logs and rotation {#logs}

The API and sync worker write their own log files under `C:\sms\logs`.
Check them directly when a service's behaviour does not match what
[[Health]] or `GET /api/health` reports.

## Restarting services {#restart-services}

Restart `SMS-Api` and `SMS-Sync` from Windows' Services console, or with
NSSM's own restart command, whenever `.env` changes — neither process
re-reads `.env` while running.

## Upgrade and rollback {#upgrade}

1. Take a fresh, verified backup first (see {{ref:backups}}).
1. Stop `SMS-Api` and `SMS-Sync`.
1. Replace the package contents with the new release (keep the existing
   `.env` — never overwrite it from `.env.example`).
1. Run `npm ci && npm run build` and `npm run db:migrate` again.
1. Start the services and work through {{ref:verification}} again.

To roll back, restore the previous release's package contents and the
database backup taken immediately before the upgrade, then repeat
{{ref:verification}}.

## Health checks worth a glance {#health-glance}

Besides the backup verification above, [[Health]] shows the free space on
the database volume and the backup volume, the record of the last manual
`verify` run, and when the sync worker last checked in beside the newest
reading's own time. A worker that checks in on time and finds nothing new
looks different from a dead one only when both times are shown, which is why
both are. Findings that are known and need no action can be acknowledged
by an engineer (see {{ref:troubleshooting}}).

## Loading the missing 10 July to 5 August data {#backfill}

IFL has not yet sent the data between the July and September samples.
When it arrives, do not run `epoch:accept` on it: it belongs to a
generation SMS already holds. `epoch:backfill` adds it to the end of that
generation's raw tables, and refuses everything if its checks fail. Run it
first without `--confirm` to read the plan, then with it, then run
`rebuild` for the same generation to derive the readings, then `verify`
with `--source-db` and `--epoch`. This has been proven only on scratch
copies of the database. The exact commands are in Appendix B; ask the
maintainer before running them for the first time.

## Database size {#db-size}

[[Health]]'s Database block states the current size against the 10 GB SQL
Server Express cap and raises a warning past 80% full (see Appendix C, item
10). How long readings are kept against this cap is IFL's own decision to
make — nothing in SMS prunes readings automatically today.
