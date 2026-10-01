# Installation, step by step {#installation}

Run every command below from the package root (`C:\sms` once installed, or
the extracted package folder) unless a step says otherwise. Each step names
what you should see, and where to look if it does not match.

## Prerequisites {#prereqs}

1. Confirm every item in {{ref:it-must-provide}} is in place: SQL Server
   Express reachable, Node.js installed at the version in `.nvmrc`, Microsoft
   Edge installed, NSSM downloaded, and the backup folder created.
1. Copy the package to its install folder, for example `C:\sms`.

You should see: the package folder containing `api`, `web`, `cli`,
`sync-worker`, `shared`, `db`, and `scripts` subfolders, and no `node_modules`
or `.env` (these are created by later steps). If it fails, see
{{ref:troubleshooting}}.

## Ask IFL's DBA for the read-only login {#install-ifl-login}

Before SMS can read anything, IFL's own database administrator must create a
SQL login for SMS with `db_datareader` on `DATA_TP1U2` and on `PDAS_TP1U2`,
and nothing more. A template script for this is in the package at
`db\bootstrap\10_ifl_readonly_login.template.sql` — hand it to IFL's DBA to
adapt and run against their own server; SMS's own installer never connects
to IFL's server to create this login itself (Working rule: never modify
IFL's database without their own hand on it).

You should see: a login (the documented generic name is `sms_readonly`) with
`db_datareader` on both databases, and its username/password recorded
securely for step {{ref:install-env}}. If it fails, see
{{ref:troubleshooting}}.

## Create the app database and its logins {#install-app-db}

1. Run the bootstrap script against the app database server, substituting
   the real server/instance name and two strong passwords:
   ```cmd
   sqlcmd -S <server\instance> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="…" -v MigratePassword="…"
   ```

You should see: no error from `sqlcmd`, and the app database plus its
`sms_app` and `sms_migrate` logins created on the server. If it fails, see
{{ref:troubleshooting}}.

> **Note:** `-E` uses your own Windows login to connect and create the
> database; it must be a login with permission to create databases and
> logins on that SQL Server instance.

## Create `.env` {#install-env}

1. Copy `.env.example` (in the package root) to `.env` in the same folder.
1. Fill in every key described in {{ref:env-keys}} — at minimum the
   `APP_DB_*` keys (using the `sms_app` login from the previous step), the
   `IFL_DB_*` keys (using the read-only login from
   {{ref:install-ifl-login}}), `LINE_ID`, `BACKUP_DIR`, and
   `PLANT_UTC_OFFSET_MINUTES`.

You should see: a `.env` file with no `__set_me__` placeholders left in it.
If it fails, see {{ref:troubleshooting}}.

> **Warning:** Never commit `.env` to version control and never send it by
> email. It holds every database password SMS uses.

## `npm ci` and `npm run build` {#install-build}

1. From the package root, install dependencies and build every workspace:
   ```cmd
   npm ci && npm run build
   ```

You should see: `api\dist`, `sync-worker\dist`, `cli\dist` and `web\dist`
each created with no build errors. On a plant PC with no internet access,
run `npm ci` once on a machine that does have access and copy the resulting
`node_modules` folders across instead — `npm ci` itself needs the npm
registry. If it fails, see {{ref:troubleshooting}}.

> **Note:** `npm run verify:release` (`npm run typecheck && npm test && npm
> run build`) is a stronger check than a plain build, if you want to confirm
> the package itself is sound before relying on it.

## Migrate {#install-migrate}

1. Apply every database migration:
   ```cmd
   npm run db:migrate
   ```

You should see: each migration file applied in order with no error, ending
at the newest migration in `db\migrations`. If it fails, see
{{ref:troubleshooting}}.

> **Note:** `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` (the `sms_migrate`
> login), if set, is preferred over `APP_DB_USER` for this one step only —
> set it in the shell you run this command from, not in `.env`, since it is
> never loaded by the long-running services.

## First admin account {#install-first-admin}

1. Create the first administrator account:
   ```cmd
   node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin
   ```

You should see:
```text
created user 'admin' (admin)
```
If it fails, see {{ref:troubleshooting}}.

> **Warning:** The password must be at least 10 characters (`PASSWORD_MIN_LENGTH`).
> Choose the real administrator's username, not literally `admin`, if IFL
> prefers a personal account.

## Manager accounts {#install-manager-accounts}

1. Create one account per manager or engineer who needs to record changes
   (set the running product, log a calibration adjustment, record a sack
   movement, change local product limits — see {{ref:roles-table}} for what
   each rank can do):
   ```cmd
   node cli/dist/index.js user:create --username=<u> --password=<p> --role=<viewer|engineer|manager|admin> [--display=<name>]
   ```

You should see: `created user '<u>' (<role>)` for each account created. If a
role name is rejected, only `viewer`, `engineer`, `manager` and `admin` are
valid — the older names `operator` and `supervisor` are refused. If it
fails, see {{ref:troubleshooting}}.

> **Note:** Every account can read every screen — Setup is the only screen
> restricted, to `admin`. Roles only govern who can write — see
> {{ref:roles-table}}.

## Windows services (NSSM) {#install-services}

The API (`api\dist\index.js`) and the sync worker (`sync-worker\dist\index.js`)
are meant to run continuously and restart automatically if they crash or the
machine reboots. NSSM is the recommended way to do this on Windows, wrapping
each as a Windows service (the documented generic service names are
`SMS-Api` and `SMS-Sync`). NSSM is third-party software, outside the SMS
package — follow NSSM's own instructions to register each service, pointing
it at the Node executable and the built entry point for each process, with
the working directory set to the package root so `.env` is found.

You should see: `SMS-Api` and `SMS-Sync` listed as running services in
Windows' Services console, and `GET /api/health` answering once `SMS-Api`
is running. If it fails, see {{ref:troubleshooting}}.

## Firewall {#install-firewall}

1. Open the API's port for anyone on the plant network who needs to browse
   to SMS:
   ```cmd
   netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000
   ```

You should see: the rule listed in Windows Firewall's inbound rules, and
the SMS sign-in page reachable from another PC on the network at
`http://<server>:4000/`. If it fails, see {{ref:troubleshooting}}.

## First connection to the plant: `sync` halts → `epoch:accept` → `verify` {#install-first-connection}

A brand-new app database has no source generation registered yet, so the
very first sync is expected to stop and ask for one to be accepted — this
is not a failure.

1. Run the first sync:
   ```cmd
   node cli/dist/index.js sync
   ```
   You should see: it **halts**, reporting an unregistered source
   generation and exiting 1. This is expected on a first run.
1. Accept the generation currently on the plant. First without `--confirm`,
   to see the plan:
   ```cmd
   node cli/dist/index.js epoch:accept --all --provenance=ifl_live --label="Plant, live"
   ```
   You should see: a printed plan describing the generation to register, and
   nothing changed yet.
1. Re-run identically with `--confirm` added to apply it:
   ```cmd
   node cli/dist/index.js epoch:accept --all --provenance=ifl_live --label="Plant, live" --confirm
   ```
   You should see: the generation registered, with no error.
1. Run `sync` again, and confirm the data against the source:
   ```cmd
   node cli/dist/index.js sync
   node cli/dist/index.js verify
   ```
   You should see: `sync` completes with per-table read/written counts and
   exit 0; `verify` reports no `STOP` lines and no weight mismatch.
1. List the registered generations at any time with:
   ```cmd
   node cli/dist/index.js epoch:list
   ```

If any of these steps fails, see {{ref:troubleshooting}}.

> **Warning:** Use `--provenance=ifl_live` for the real plant connection.
> `--provenance=simulator` is refused unless the target database name ends
> in `_SIM`, and exists only for development and demonstration systems like
> the one that produced this guide's own screenshots.

## Scheduled tasks {#install-scheduled-tasks}

1. Register the three production scheduled tasks (nightly backup, weekly
   database maintenance, daily retention), previewing first with
   `-WhatIf`:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -InstallDir "C:\sms" -RunAs "<domain>\<svc account>" -Server "SERVER-SQL,<port>" -BackupDir "C:\sms-backups" -WhatIf
   ```
1. Once the preview looks right, re-run the same command with `-WhatIf`
   removed to register the tasks for real.

> **Note:** `-Server` is a required parameter with no default; give it the
> host and port of the app database on this server, as shown in the command
> above. The script refuses to run without it, so the nightly backup cannot
> silently look at the wrong place. `-Database` defaults to `sms`. Run the
> command as an administrator.

You should see: "SMS Nightly Backup", "SMS Weekly Maintenance" and "SMS
Daily Retention" listed in Windows Task Scheduler. Confirm one runs with:
```cmd
schtasks /run /tn "SMS Nightly Backup"
schtasks /query /tn "SMS Nightly Backup" /v /fo LIST
```
If it fails, see {{ref:troubleshooting}} and Chapter 9's backup section.

## Wall display PC {#install-wall-pc}

The wall display is any PC with a browser, pointed at `/?s=wall` on the SMS
server — this view has no navigation and refreshes itself every 10 seconds,
so it is meant to be left open, not signed out of. A dedicated Windows PC
running Edge in kiosk mode is one way to do this:
```cmd
msedge --kiosk http://<plant-ip>:4000/?s=wall --edge-kiosk-type=fullscreen
```
Create a low-privilege viewer account for the wall PC to sign in with, so
its session can be revoked independently of any person's own account:
```cmd
node cli/dist/index.js user:create --username=wall --password=<strong> --role=viewer
```

You should see: the wall board filling the screen with no browser chrome,
updating on its own. If it fails, see {{ref:troubleshooting}}.
