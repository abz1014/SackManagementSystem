# DEPLOY.md — SMS deployment & operations runbook

Single-plant, single-server, intranet. Two Node processes (sync-worker + api) and one app database on the plant PC. No cloud. Read with `ARCHITECTURE.md`.

---

## Topology

```
  Plant SQL Server ──read-only──▶ sync-worker (Windows Service) ──▶ app DB (SQL Express)
     (IFL, live)                                                        │
                                                          api (Windows Service, :4000)
                                                          serves REST + the built React app
                                                                        │
                                                     browsers on the plant LAN ─▶ http://<host>:4000
```

- **sync-worker** — the ONLY process that connects to IFL. Read-only login. Loops every `SYNC_INTERVAL_SECONDS`.
- **api** — serves `/api/*` and the static React build (`WEB_DIST`). Never connects to IFL.
- One service to browse to (`:4000`); the SPA and API are same-origin, so no CORS/proxy in prod.

---

## First-time production setup

1. **Install** Node 20+ and SQL Server (Express is fine) on the plant server.
2. **Get from IFL:** a dedicated **read-only** SQL login (not `sa`, not the vendor app account) with **`db_datareader` on BOTH `DATA_TP1U2` and `PDAS_TP1U2`**, and the server\instance + port. Enable TCP on the plant SQL Server if needed.
   **This is a hard requirement, not a preference.** IFL's own engineering login (`ibrahim`, seen in the Sep 2026 sample) has EXECUTE on PDAS's stored procedures and **no table read at all** on PDAS. Handed that login, the product mirror (`seedProducts`) fails on cutover day and every screen loses its targets and limits. Ask for `db_datareader` on PDAS by name, and test it with `SELECT TOP 1 * FROM PDAS_TP1U2.dbo.Materials` before the day.
   *(Separately and later — only if IFL confirms in writing that SMS may write product data: an `sms_pdas_writer` login for the Add / Retire / Change-limits path, see `PDAS_WRITE_*` in `.env.example`. It is a different login, never the read-only one.)*
3. **Create the app DB + its login** (`sms_app`, read/write on the `sms` database only).
4. **Configure** `.env` from `.env.example`:
   - `IFL_DB_*` → the plant server + the read-only login. **This is the only dev→live change.**
   - `APP_DB_*` → the local app DB + `sms_app` (a **strong, unique** password — never the dev password).
   - No `SESSION_SECRET` to set — sessions are server-side random UUIDs, not signed cookies (see `.env.example`).
   - `WEB_DIST=./web/dist`.
   - **`COOKIE_SECURE=false`** — required for a plain-HTTP intranet. See below.
   - `LINE_NAME` → the name the floor and wall screens show for the line (default `TP1 · Line 3 · Unit 2`).
   - **`LIVE_ALLOW_AS_OF=false`** (the default) — keep it off in production. See the wall display section.

### ⚠️ `COOKIE_SECURE` — the one setting that fails silently

The session cookie is issued `Secure` by default, so browsers only keep it over
HTTPS. The exception is `http://localhost`, which browsers treat as trustworthy.
That combination hides the problem exactly where you'd test it first:

| Browsing from | `COOKIE_SECURE=true` over plain HTTP |
|---|---|
| The plant server itself (`http://localhost:4000`) | **works** |
| Any other PC (`http://<plant-ip>:4000`) | **login silently fails** |

The failure has no error: the login POST returns `200` with the user object, the
browser discards the cookie, and the next request is anonymous — so the UI just
returns to the login screen. It looks like a wrong password.

**On a plain-HTTP plant LAN, set `COOKIE_SECURE=false`.** Keep it `true` only if
you put real TLS in front. The API logs an explicit warning to stderr
(`logs\api.err.log`) whenever a login arrives over plain HTTP from a non-localhost
host while `COOKIE_SECURE=true`, so this shows up as a clear message rather than a
mystery.

### Reaching it from other machines

- Open the port once: `netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000`
- The API binds all interfaces (`0.0.0.0`), so no host config is needed.
- Give the plant PC a **static IP or DNS name** — operators should not be typing a
  DHCP address that changes.

### Wall display (TV)

The app has a wall mode at `?v=wall`: fullscreen, no navigation, type sized
for a TV, refreshing itself every ten seconds. Setting one up:

1. Any PC or stick PC driving the TV, with the browser in kiosk mode pointed at
   the wall URL — Edge: `msedge --kiosk http://<plant-ip>:4000/?v=wall --edge-kiosk-type=fullscreen`,
   Chrome: `chrome --kiosk http://<plant-ip>:4000/?v=wall`. Add it to the PC's
   startup so a power cut brings the display back on its own.
2. Sign in **once**, with an operator account made for the display:
   `node cli/dist/index.js user:create --username=wall --password=<strong> --role=operator`.
   Sessions renew while they are in use, so the display never returns to the
   login page by itself; it will only if the browser's cookies are cleared or
   the account is disabled in Setup.
3. Turn off the PC's screen sleep. Nothing else is needed: after a network
   drop the page shows "Could not reach the server" over the last numbers it
   had and recovers on its own.
4. Leave **`LIVE_ALLOW_AS_OF=false`** in production. When it is on, `?at=<time>`
   replays a past moment — right for a demo on the July copy, wrong for a wall:
   a display left on a replay URL is bannered, but it is still showing old
   numbers.

### Rehearsing go-live with the plant simulator

The supplied copy of IFL's database ends on 10 Jul 2026, so nothing that only
happens when readings are arriving *now* can be tested against it.
`scripts/simulate-plant.mjs` writes plausible readings so it can be.

It writes to a **separate database, `DATA_TP1U2_SIM`**, never to `DATA_TP1U2`.
IFL's databases are read-only to this project and that does not get a local-copy
exemption; the script refuses any target whose name does not end in `_SIM` and
any server that is not local. The 19 real days also stay untouched, which
matters because every measured figure in `CAPABILITIES.md` was checked against
them.

First-time setup, as a Windows administrator:

```
sqlcmd -S .\SQLEXPRESS -E -Q "CREATE DATABASE [DATA_TP1U2_SIM]"
```

then create the four wide tables with the same column types as `DATA_TP1U2`,
grant `sms_readonly` db_datareader on it, and create a writer login for the
simulator. Copy IFL's real rows in as well, so the simulator is a complete
stand-in and `verify` reconciles.

```bash
node scripts/simulate-plant.mjs --check      # confirm the schema fingerprints match
node scripts/simulate-plant.mjs --days=7     # seven days of history, ending now
node scripts/simulate-plant.mjs --live       # keep appending, in real time
node scripts/simulate-plant.mjs --reset      # empty the sim tables
```

Point the sync worker at it exactly as you will point it at the plant, by
changing one line: `IFL_DB_NAME_DATA=DATA_TP1U2_SIM`. Everything downstream
runs unchanged, so the rehearsal exercises the reader, the schema-fingerprint
gate, the raw layer, the transform, the data-quality checks, the API and the
screens. **Set `IFL_DB_NAME_DATA` back to `DATA_TP1U2` when you are done**, and
rebuild the app database if you want the simulated rows out of it.

#### What the first rehearsal found, and why it could not have been found sooner

IFL's acquisition layer writes a cone's row about **18 minutes** after the cone
is weighed (measured over 142,509 real rows: 909 s minimum, 1090 s mean). The
newest production timestamp this software can see is therefore always a quarter
of an hour old, even while the line runs flat out.

The live screens originally compared that timestamp against the wall clock, so
on a healthy line they reported **"Stopped 17 min"**, permanently, and "cones in
the last ten minutes" was structurally always zero. Against the July copy every
screen read "no readings" anyway, so it was invisible.

The line state is now judged against `now - lag`, where the lag is measured from
IFL's own two timestamps in the raw layer, and every "recent" window is anchored
on the newest reading rather than the clock. The screens state the lag, so a
reader can tell "the line stopped" from "the reading has not arrived yet".

**If the plant's real lag differs from the copy's, nothing needs changing** —
it is measured, not configured. But it is worth checking on the first live day,
because a lag beyond two hours is treated as a clock fault rather than as an
acquisition delay.

### Internet access is not required

The built SPA references no external hosts: fonts are system stacks (Segoe UI /
Cascadia Mono), and there are no CDN scripts, styles, or web fonts. Everything is
served from `:4000`. An air-gapped plant LAN is the intended environment — Node,
SQL Server and the build output are the only prerequisites, all installed locally.

> **ngrok is a review-time tool only.** The tunnel and its watchdog
> (`ops/sms-watchdog.ps1`) exist to share the app with reviewers over the
> internet. Neither is part of the plant deployment: no tunnel, no `ops/`
> watchdog, no outbound dependency. Use the NSSM services below instead.
5. **Build:** `npm ci && npm run build:shared && npm run build --workspaces --if-present && npm run build --workspace @sms/web`.
6. **Migrate the app DB:** apply `db/migrations/*.sql` in order (via `sqlcmd` or `npm run db:migrate`).
   - **Stop the sync-worker service first when migrating an app DB that already holds data.**
     Some migrations build indexes on `cone_event`/`reject_event`, which take a
     schema-modification lock; against a service inserting every 60 s that means
     blocking, and potentially a deadlocked migration, on a live host. A fresh
     install has nothing to contend with and can skip this.
   - `npm run db:migrate` records what it applies in `sms.schema_migration` and
     skips those files next time. On a database migrated before that table
     existed, the first run re-applies every earlier file — they are all
     guarded (`IF OBJECT_ID(...) IS NULL`), so this is a no-op, but it means the
     first recorded timestamps are when tracking began, not when those
     migrations were originally applied.
7. **Create the first admin:** `node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin`.
8. **Create IFL's users at `--role=manager`.** The software is used by the GM,
   managers and process-department engineers, and every one of them needs to
   set the running product and to export data. Every screen is readable at any
   rank, so the only effect of a lower role is to block those two actions for
   no reason. Reserve `admin` for whoever administers the installation.
   `operator` and `supervisor` exist for a possible future in which floor staff
   are given accounts; nothing today needs them.
8. **Install services** (below), start them, browse to `http://<host>:4000`, sign in.

---

## TLS (optional)

Plain HTTP with `COOKIE_SECURE=false` (above) is the documented default for a
plant-intranet deployment, and is what most sites should ship with — the
network is a closed LAN, not the open internet. Put real TLS in front only if
plant policy requires encrypted traffic even on the intranet.

**A publicly-trusted certificate (Let's Encrypt or similar) is not obtainable
here** — issuance requires a domain reachable from the public internet, which
directly contradicts the air-gapped deployment this app is built for (§
"Internet access is not required" above). The realistic options on a plant PC
are a self-signed certificate, or an internal CA if the plant already runs
one (uncommon; ask IT before assuming it exists). Either way, every client
browser will show a trust warning until that certificate is installed in its
trusted root store — a one-time step per PC, or an accepted click-through on
a small, known set of plant machines.

### Option A — the API terminates TLS itself (no extra software)

The API can listen with TLS directly; `api/src/index.ts` picks this up
automatically from two possible env var pairs — set one pair, not both:

**PFX, Windows-native (no OpenSSL install needed):**
```powershell
$cert = New-SelfSignedCertificate -DnsName "<plant-host-or-ip>" `
  -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable
$pwd = ConvertTo-SecureString -String "<a-real-passphrase>" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath C:\sms\certs\sms.pfx -Password $pwd
```
Then in `.env`:
```
TLS_PFX_PATH=C:\sms\certs\sms.pfx
TLS_PFX_PASSPHRASE=<the same passphrase>
COOKIE_SECURE=true
```

**PEM, if OpenSSL is already on the box:**
```bash
openssl req -x509 -newkey rsa:2048 -keyout sms.key -out sms.crt -days 1825 -nodes -subj "/CN=<plant-host-or-ip>"
```
Then in `.env`:
```
TLS_CERT_PATH=C:\sms\certs\sms.crt
TLS_KEY_PATH=C:\sms\certs\sms.key
COOKIE_SECURE=true
```

Restart `SMS-Api`. The startup log line changes from `http://` to `https://`;
`GET /api/health` should now answer on `https://<host>:4000` and the
`Strict-Transport-Security` response header appears (it is deliberately
absent over plain HTTP — see `security.ts`). Browse to `https://<host>:4000`.
Leave `TRUST_PROXY=false` — nothing is proxying in this option, Node sees the
TLS connection directly.

*Verified 19 Aug 2026 against this exact code, both forms: a self-signed PFX
and a self-signed PEM pair each started the API on `https://`, served
`/api/health` over real TLS, correctly refused a plain-HTTP request to the
same port, and correctly showed `Strict-Transport-Security` only on the TLS
response and never on a plain-HTTP one.*

### Option B — a reverse proxy terminates TLS (IIS)

If the plant's IT team already manages certificates centrally through IIS,
put IIS in front instead: install the **URL Rewrite** and **Application
Request Routing (ARR)** modules, bind the plant's certificate to an IIS site
on 443, and add a reverse-proxy rule forwarding to `http://localhost:4000`.
The API itself stays on plain HTTP behind it — set:
```
TRUST_PROXY=true
COOKIE_SECURE=true
```
`TRUST_PROXY=true` is only as safe as its precondition: IIS must be the
**only** path to the API. The API still binds `0.0.0.0:4000` regardless of
this option (nothing in the code changes that) — so also remove or restrict
the `:4000` firewall rule from "Reaching it from other machines" above, or
scope it to loopback, once IIS is fronting it. Leaving `:4000` open to the
LAN while `TRUST_PROXY=true` re-opens exactly the `X-Forwarded-For` bypass
documented on `TRUST_PROXY` in `.env.example`: anyone who can reach `:4000`
directly, bypassing IIS, could forge that header.

---

## Windows Services (NSSM)

Node has no native service manager; use **NSSM** (or `node-windows`). Example with NSSM:

```bat
:: sync-worker
nssm install SMS-Sync "C:\Program Files\nodejs\node.exe" "C:\sms\sync-worker\dist\index.js"
nssm set SMS-Sync AppDirectory "C:\sms"
nssm set SMS-Sync AppStdout "C:\sms\logs\sync.log"
nssm set SMS-Sync AppStderr "C:\sms\logs\sync.err.log"
nssm set SMS-Sync Start SERVICE_AUTO_START
nssm start SMS-Sync

:: api (serves REST + web build)
nssm install SMS-Api "C:\Program Files\nodejs\node.exe" "C:\sms\api\dist\index.js"
nssm set SMS-Api AppDirectory "C:\sms"
nssm set SMS-Api AppStdout "C:\sms\logs\api.log"
nssm set SMS-Api Start SERVICE_AUTO_START
nssm start SMS-Api
```

Both boot with the machine and restart on crash. The sync-worker also self-heals per pass (a transient DB error is logged and retried next tick — it never exits on a blip).

---

## Dev → Live cutover

By design the *connection* is one string; nothing in `api/` or `web/` changes. But the live server is a **different physical source** with its own `id` counter, and the app DB already holds generations of data from the samples. The worker must be told, deliberately, that a new generation is being read — it will not guess. (An earlier version of this section said "first pass backfills from the live DB". It did not: with a watermark above every id the new source held, the worker read nothing and reported success every 60 s, forever. That is exactly what `sms epoch:accept` now prevents — `SEPT-2026-EPOCH-DECISION.md` §2.7.)

1. Take a backup of the app DB (see below). **Nothing in the app DB is deleted by this procedure** — the sample generations stay as archived history beside the live one.
2. Stop `SMS-Sync`. Confirm nothing is mid-pass: `SELECT COUNT(*) FROM sms.sync_run WHERE finished_at_utc IS NULL` → 0.
3. Edit `.env`: point `IFL_DB_SERVER` / `IFL_DB_PORT` / `IFL_DB_NAME_DATA` / `IFL_DB_NAME_PDAS` / `IFL_DB_USER` / `IFL_DB_PASSWORD` at the **live** plant DB and the `db_datareader` login IFL provisioned (setup step 2). Leave `PDAS_WRITE_ENABLED=false`.
4. `node cli/dist/index.js sync` — **it must halt** with `No open source generation … sms epoch:accept`. That halt is the gate working. If it does anything else, stop and look.
5. `node cli/dist/index.js epoch:accept --all --provenance=ifl_live --label="Plant, live"` — read the plan it prints: the server/database, each table's `create_date`, fingerprint and `MAX(id)`. Then re-run with `--confirm`. (`--label` needs the `=`.)
6. Start `SMS-Sync`. The first pass backfills the live generation; watch `logs\sync.log` — every stream's `written` should equal its `read`.
7. `node cli/dist/index.js verify` — every **open** generation must reconcile with its source by count, min, max and sum of ids; the sample generations are reported as *archived*. **A STOP after the backfill has settled is a stop condition, not noise.**
8. `node cli/dist/index.js epoch:list` — the live generation should be OPEN with rows; the samples closed.

The worker keeps halting, on every pass, if the live schema drifts within a generation (fingerprint), if the source is replaced (`create_date`), if the connection points at a different server/database, or if the source's `MAX(id)` falls below the watermark (a restore). Each message names the fix. Never clear `sms.source_epoch` by hand; `sms cutover --confirm` exists for "throw every reproducible row away and start again" and nothing else.

---

## Backup & restore

The app DB is the only irreplaceable data (product timeline, reject labels, users, config, rules).

### One-time setup: a login the script can actually use

`scripts/backup-appdb.ps1` defaults `-User` to `sms_backup` (fixed Sep 2026 —
it used to default to `sms_app`, the app's own runtime login, which must
**not** be given backup rights: it has no operational reason to ever take a
backup of itself, and least-privilege means not handing it permissions it
will never use). `-Pass` has no default and is required every run — create
the dedicated login first:

```sql
CREATE LOGIN sms_backup WITH PASSWORD = '<a-real-password>', CHECK_POLICY = ON;
-- in the app DB:
CREATE USER sms_backup FOR LOGIN sms_backup;
ALTER ROLE db_backupoperator ADD MEMBER sms_backup;
```

`-User` defaults to `sms_backup` already; pass the password every run:
`-Pass <that password>`.

### Running it

- **Nightly:** schedule `scripts/backup-appdb.ps1` via Task Scheduler (keeps 30 days).
- **`-OutDir` must be writable by the SQL Server *service account*, not just
  whoever runs the script** — `BACKUP DATABASE` executes on the server
  process, not the client. An arbitrary user-profile folder is often not
  writable by the service account even though your own login can write there
  fine; a path under the instance's own data directory always is. Find it:
  `EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'BackupDirectory';`
- **Monthly:** test a restore into a scratch DB — an untested backup is not a backup.
- **Before any canonical rebuild:** the `sms rebuild` command **requires** a point-in-time snapshot id and refuses without it (`ARCHITECTURE §18`). This is separate from and more precise than the nightly backup.
- **Rebuild and the sync-worker service are now mutually exclusive** (Sep 2026
  audit fix, C1): `sms rebuild` and the service's own 60s transform pass take
  the same `sp_getapplock`, so running `sms rebuild` with the service still
  running is safe — one simply waits for the other rather than racing on the
  canonical tables. You do not need to stop the service first, but stopping
  it is still the faster path if you're doing several rebuilds in a row (each
  one otherwise waits for up to a minute for the lock).

Restore into a scratch DB first, never straight over `sms`:
```sql
RESTORE FILELISTONLY FROM DISK = N'...bak';   -- get the logical file names first
RESTORE DATABASE sms_restore_test FROM DISK = N'...bak'
  WITH MOVE 'sms' TO N'<data dir>\sms_restore_test.mdf',
       MOVE 'sms_log' TO N'<data dir>\sms_restore_test_log.ldf';
```
Restoring over the live `sms` database directly is `WITH REPLACE`, no `MOVE`
needed — but do that only once the scratch restore above has already proven
the backup file is good.

> **Rehearsed 19 Aug 2026 against this exact script and this exact database**
> (142,511 cone events, 5,462 sack events, 3,146 reject events, 20 product
> changeovers). Backup: 75.7 MB, 9,226 pages, 5.6 s. Restore into a scratch DB:
> 9.4 s. Every table's row count matched exactly; `product_timeline`'s three
> newest rows matched the source down to the millisecond. Three real defects
> surfaced by actually running it, all now fixed in `scripts/backup-appdb.ps1`
> (previously this recommendation had never been executed):
> 1. `sms_app` has no backup rights — `BACKUP DATABASE` needs a login with
>    `db_backupoperator`, which the app's own runtime login correctly doesn't
>    have (see setup above).
> 2. `-OutDir` needs to be writable by the SQL Server *service* account, not
>    the account running the script — a user-profile temp folder failed with
>    `Access is denied` even though the invoking account could write there.
> 3. **`WITH COMPRESSION` is not supported on SQL Server Express** (Msg 1844)
>    — the edition this project is built on (CLAUDE.md D1). The script had
>    carried that option since it was written; every backup it would ever
>    have taken against the real deployment target would have failed. Worse,
>    the script printed `backup written: ...` regardless of whether `sqlcmd`
>    actually succeeded, so this would have failed silently, every night,
>    forever. Both are fixed: `COMPRESSION` is removed, and the script now
>    checks `sqlcmd`'s exit code and the resulting file's existence before
>    ever reporting success.
>
> **Follow-up, Sep 2026 audit (finding L4):** item 1 above fixed the *login's*
> permissions but not the *script's own default* — `-User` still defaulted to
> `sms_app` despite this file's own header comment saying never to use it for
> backups, so a run with no `-User` flag would always fail at the sqlcmd step.
> Fixed: `-User` now defaults to `sms_backup`, and `-Pass` has no default at
> all (previously `$env:APP_DB_PASSWORD` — another login's password) and is
> required on every invocation.

---

## Operations & monitoring

- **`GET /api/operations`** (Operations screen) — last sync per table, watermark, schema-fingerprint status, transform version, source age, DQ roll-up by severity. First place to look if a dashboard reads low/zero: check `sourceAgeSeconds` — climbing age = sync stalled.
- **`node cli/dist/index.js verify`** — full reconciliation + DQ findings.
- **`node cli/dist/index.js summary --date=YYYY-MM-DD`** — spot-check totals from the shell.
- **Logs** — structured JSON lines in `logs\sync.log` / `logs\api.log`.

### Performance targets (guardrails)
Dashboard < 300 ms · API < 100 ms · sync pass < 30 s. At the current data volume we are well under; re-check after a few months of accumulation and add indexes on `sms.*` if needed (never on IFL's DB).

### Database size (SQL Server Express's 10 GB ceiling) — finding L5, Sep 2026 audit

SQL Server Express caps each database's data file at **10 GB** (log file is
unbounded). This was never checked or planned for. The real 19-day copy holds
142,511 cone events + 5,462 sack events + 3,146 reject events — roughly 8,000
rows/day across the three event tables — which, at that rate, projects to
somewhere around **1 GB/year** of raw event data (rough order-of-magnitude
from the 19-day copy, not a measured multi-year rate). That is years of
runway on a 10 GB cap, not an urgent problem — but it is currently unplanned,
and `sms_raw.*` (the raw layer, kept for replay/lineage) adds to the same
total.

- **Check current size:** `EXEC sp_spaceused;` against the `sms` database, or
  `SELECT name, size/128.0 AS size_mb, max_size FROM sys.master_files WHERE
  database_id = DB_ID('sms');` — re-run this every few months alongside the
  performance guardrails above.
- **When it becomes a real concern** (size approaching a few GB, or multi-line
  deployment — see `CLAUDE.md`'s note on `line_id` cross-contamination —
  multiplying the growth rate): either archive/prune old `sms_raw.*` rows
  (canonical is the layer every screen actually reads; raw exists for replay
  and lineage, and is the safer thing to trim first) or move off Express to a
  licensed SQL Server edition, which removes the cap entirely. Neither is
  needed today — this is a plan to revisit, not an action to take now.

---

## Hard rules (never violate)

1. **IFL DB is read-only and unmodified** — no writes, no indexes, no DDL. Only `sync-worker` connects, via the read-only login.
2. **No credentials in code** — `.env` only; never commit it. Dev password ≠ prod password.
3. **Parameterised SQL only.**
4. **No PLC dependency** (Phase 1). Verified by inspection of all five package manifests — `mssql`, `zod`, `express`, `argon2`, `react` and nothing protocol-related. **This is a review convention, not an automated guarantee: no test asserts it.** (An earlier version of this line claimed a test did. There isn't one — adding it is cheap and worth doing.)

---

## When IFL answers the open questions

No redeploy needed — an **admin sets it once in the UI** (`ARCHITECTURE §4`):
- **Q4/Q5 weights (gross/net):** Admin → Interpretation rules → Weight basis. Applies immediately.
- **Q7 shift (fix/reproduce):** Admin → Shift basis, then `sms rebuild --table=cone_event --snapshot-id=<id>` to apply to stored data.
- **Q10 reject codes:** Rejects view → type labels (manager+).
- **Q11 station names:** Admin → Station labels.
- **Q1 current product:** Dashboard → Current Product selector (supervisor+).
