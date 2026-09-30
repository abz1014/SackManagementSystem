# Owner step — demo logins and first accounts

Workers must never create logins, users or app accounts. Everything below
must be run by the **owner**, as a Windows administrator, from the repo root
(`C:\Users\ABDULLAH SAJID\Desktop\sag database`). Passwords go **only** into
the gitignored files named below (`demo-secrets.env`, `demo-login.env`) — do
**not** paste any password into chat, into a commit, or into any other file.

Everything here was re-verified against the actual code on 28 Sep 2026:
`sms/cli/src/commands/user.ts` (user:create's flags), `sms/scripts/migrate.mjs`
(how it loads its DB login and what it needs from the environment), and this
task's own `docs/guide/demo/demo.ps1` (the launcher's subcommands and guards).

Three new, empty databases already exist, created by worker T1:
`SMS_DEMO`, `DATA_DEMO_SIM`, `PDAS_DEMO` — no logins on any of them yet.

## Step 1 — create the three demo logins

Run `docs\guide\demo\30-owner-logins.sql`, supplying three passwords you
choose (they are never stored in the script itself; `sqlcmd -v` passes them
on the command line only):

```
sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\30-owner-logins.sql -v DemoAppPassword="<choose one>" DemoReaderPassword="<choose one>" DemoSimPassword="<choose one>"
```

Expected output ends with:
```
sms_demo_app, sms_demo_reader and sms_demo_sim created (or already present), each scoped to exactly one demo database.
```

This creates:
- `sms_demo_app` — db_datareader + db_datawriter + db_ddladmin on `SMS_DEMO` only.
- `sms_demo_reader` — db_datareader on `DATA_DEMO_SIM` and `PDAS_DEMO` only.
- `sms_demo_sim` — db_owner on `DATA_DEMO_SIM` only.

None of the three can reach any other database on this instance, including
`DATA_TP1U2`, `DATA_TP1U2_SEP07`, `PDAS_TP1U2*`, `DATA_TP1U2_SIM`, or the dev
app database `sms`.

## Step 2 — write the demo secrets file

Create `docs\guide\demo\demo-secrets.env` (already gitignored — verified by
`git check-ignore -v` during T1) with exactly these eight lines, using the
three passwords from Step 1:

```
APP_DB_USER=sms_demo_app
APP_DB_PASSWORD=<the DemoAppPassword you chose>
MIGRATE_DB_USER=sms_demo_app
MIGRATE_DB_PASSWORD=<the DemoAppPassword you chose>
IFL_DB_USER=sms_demo_reader
IFL_DB_PASSWORD=<the DemoReaderPassword you chose>
SIM_DB_USER=sms_demo_sim
SIM_DB_PASSWORD=<the DemoSimPassword you chose>
```

(`MIGRATE_DB_USER`/`PASSWORD` repeat the same demo app login — in the demo,
unlike production, one login holds both the runtime and the migration
rights; `docs/guide/demo/30-owner-logins.sql`'s header explains why, and the
guide itself must still describe the production split, not this shortcut.)

## Step 3 — run the migrations

From the repo root (`demo.ps1` changes into `sms\` itself, so it does not
matter which directory you start it from):

```
powershell -ExecutionPolicy Bypass -File docs\guide\demo\demo.ps1 migrate
```

This runs `node scripts/migrate.mjs` (`sms/package.json`'s own `db:migrate`
script) inside the demo environment `demo.ps1` builds. Expected: every
migration file 001…041 applied with no error (re-verified against
`sms/scripts/migrate.mjs`'s own header, 28 Sep 2026: it prefers
`MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD`, which Step 2 set, and falls back to
`APP_DB_USER`/`APP_DB_PASSWORD` — both point at the same login here, so
either path works).

## Step 4 — create the demo admin account

```
powershell -ExecutionPolicy Bypass -File docs\guide\demo\demo.ps1 cli user:create --username=demo-admin --password=<at least 10 characters> --role=admin --display="Demo Admin"
```

Exact flags re-verified against `sms/cli/src/commands/user.ts`
(28 Sep 2026): `--username`, `--password`, `--role` (one of `viewer`,
`engineer`, `manager`, `admin` — the old names `operator`/`supervisor` are
refused, not aliased), and the optional `--display` (undocumented in the
CLI's own `--help` text, but present and read at `user.ts:48`). The password
must be at least `PASSWORD_MIN_LENGTH` characters — 10 by default, and
`demo.env` does not override it, so 10 applies here too.

Expected output: `created user 'demo-admin' (admin)`.

## Step 5 — write the demo login file

Create `docs\guide\demo\demo-login.env` (gitignored) with:

```
SMS_TEST_USERNAME=demo-admin
SMS_TEST_PASSWORD=<the password you chose in Step 4>
```

This is read directly by the capture tool (T4/T7/T8), not by `demo.ps1`'s
own guards (those only require `demo.env` + `demo-secrets.env`).

## Step 6 — reply

Reply **"owner step done"**. Do not paste any password, username, or the
contents of any of the three `*.env` files into chat.
