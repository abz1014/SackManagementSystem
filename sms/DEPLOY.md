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

1. **Install** Node **22** (pinned: `sms/.nvmrc`, `engines` in `sms/package.json`; Node 20 reached end-of-life 30 Apr 2026) and SQL Server (Express is fine) on the plant server. `npm ci` needs the npm registry — see *Internet access* below for an air-gapped host.
2. **Get from IFL:** a dedicated **read-only** SQL login (not `sa`, not the vendor app account) with **`db_datareader` on BOTH `DATA_TP1U2` and `PDAS_TP1U2`**, and the server\instance + port. Enable TCP on the plant SQL Server if needed.
   **This is a hard requirement, not a preference.** IFL's own engineering login (`ibrahim`, seen in the Sep 2026 sample) has EXECUTE on PDAS's stored procedures and **no table read at all** on PDAS. Handed that login, the product mirror (`seedProducts`) fails on cutover day and every screen loses its targets and limits. Ask for `db_datareader` on PDAS by name, and test it with `SELECT TOP 1 * FROM PDAS_TP1U2.dbo.Materials` before the day. **The exact SQL to hand IFL's DBA is `db/bootstrap/10_ifl_readonly_login.template.sql`**, with the four pre-day test queries at the bottom. Note that a login without table read on PDAS stops **all** ingestion, not only the product mirror: the product seed runs before the cone/sack/reject reader on every pass.
   *(Separately and later — only if IFL confirms in writing that SMS may write product data: an `sms_pdas_writer` login for the Add / Retire / Change-limits path, see `PDAS_WRITE_*` in `.env.example`. It is a different login, never the read-only one.)*
3. **Create the app DB + its two logins** — run `db/bootstrap/00_create_app_database.sql` once as a sysadmin:
   `sqlcmd -S <server\instance> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="<strong unique password>" -v MigratePassword="<a DIFFERENT strong unique password>"`
   It creates `[sms]` (recovery model SIMPLE — see the file header for why), the `sms_app` login (`db_datareader` + `db_datawriter` — the runtime login every unattended process uses), and a separate `sms_migrate` login (adds `db_ddladmin`, used only for `db:migrate`, run by hand). `sms_app` no longer gets `db_ddladmin` — that split is the fix for defect R-13 (an unattended login able to alter/drop the append-only trigger on `sms.audit_log`); see the file's own header and *Credentials and secrets* below. Neither login is `db_owner`; backups use a separate login (below). Idempotent — safe, and the intended remediation, to re-run against a database bootstrapped before this fix.
4. **Configure** `.env` from `.env.example`:
   - `IFL_DB_*` → the plant server + the read-only login. **This is the only dev→live change.**
   - `APP_DB_*` → the local app DB + `sms_app` (a **strong, unique** password — never the dev password).
   - `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` → NOT set in the persistent `.env` a service reads; set them only in the shell that runs `npm run db:migrate` (step 6), then leave them unset.
   - No `SESSION_SECRET` to set — sessions are server-side random UUIDs, not signed cookies (see `.env.example`).
   - `WEB_DIST=./web/dist`.
   - **`COOKIE_SECURE=false`** — required for a plain-HTTP intranet. See below.
   - `LINE_ID` (default `1`) → the line this worker and this API serve; every row is stamped with it. Rows carry no line identity of their own — `LINE_ID` is the ground truth, so it must be set the same on the sync worker and the API and never changed after data has been ingested. `LINE_NAME` is only the **seed** for that line's display name on a fresh database; afterwards the plant, unit and line names live in `sms.line` and are edited in **Setup › Line** (roadmap Phase 1, migration 028).
   - **`LIVE_ALLOW_AS_OF=false`** (the default) — keep it off in production. See the wall display section.
   - **PLANT_UTC_OFFSET_MINUTES=300** (UTC+5, this plant) — set this on every install. See below.

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

### ⚠️ `PLANT_UTC_OFFSET_MINUTES` — declares what timezone the plant IS

The whole two-clocks design (`shared/src/domain/plantClock.ts`) assumes the deployment host's OS timezone equals the plant's. Nothing enforces that assumption except this variable: at startup, both the API and the sync worker compare `PLANT_UTC_OFFSET_MINUTES` against the host's own OS-reported offset and warn loudly on a mismatch — the sync worker additionally raises a standing WARNING finding, visible on the Operations screen, cleared automatically once the host's clock is fixed and the worker restarts.

This matters specifically because **the owner supplies the plant PC** (IFL, 15 Sep 2026), and a freshly imaged Windows Server defaults to UTC. On such a host every reading arrives "five hours in the future" relative to the plant clock — silently, until shift attribution or the live status is visibly wrong. **Set `PLANT_UTC_OFFSET_MINUTES=300` (this plant is UTC+5) on every install; do not leave it commented out.** Neither process refuses to start on a mismatch — check the log (API) or the Operations screen (worker) after first boot to confirm the host's clock actually matches.

### Reaching it from other machines

- Open the port once: `netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000`
- The API binds all interfaces (`0.0.0.0`), so no host config is needed.
- Give the plant PC a **static IP or DNS name** — operators should not be typing a
  DHCP address that changes.

### Wall display (TV)

The app has a wall mode at `?s=wall` (the view parameter is `s`; an older `?v=` form is ignored and lands on the Line screen): fullscreen, no navigation, type sized
for a TV, refreshing itself every ten seconds. Setting one up:

1. Any PC or stick PC driving the TV, with the browser in kiosk mode pointed at
   the wall URL — Edge: `msedge --kiosk http://<plant-ip>:4000/?s=wall --edge-kiosk-type=fullscreen`,
   Chrome: `chrome --kiosk http://<plant-ip>:4000/?s=wall`. Add it to the PC's
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
simulator (`sms_sim`; its name, database and password go in `.env` as
`SIM_DB_USER`, `SIM_DB_NAME`, `SIM_DB_PASSWORD` — see `.env.example`). Copy
IFL's real rows in as well, so the simulator is a complete stand-in and
`verify` reconciles.

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

The built SPA references no external hosts. The design handoff's Instrument
Sans variable font is **self-hosted**, not a system stack: one file,
`web/public/fonts/InstrumentSans-Variable.woff2`, weights 400–700, served via
`@font-face` in `app.css` and named first in `--font` (3 Sep 2026 visual
redesign, `CLAUDE.md`) — because the plant PC has no internet, and a Google
Fonts `<link>` would silently fall back to Segoe UI on the one machine that
matters, with no error to say so. There are no CDN scripts, styles, or `<link>`
web-font references in `index.html`, and no other external host is referenced
anywhere in the built bundle. Everything is served from `:4000`. An air-gapped
plant LAN is the intended environment — Node, SQL Server and the build output
are the only prerequisites, all installed locally.

**This makes `web/dist/fonts/` a deployment prerequisite, not an asset that
can be dropped.** `npm run build` copies it from `web/public/fonts/` as part
of the Vite build, but the directory still has to physically reach the plant
host along with the rest of `web/dist` — copy the build output as a whole, do
not hand-pick files. If it does not reach the host, the app does not error;
it silently renders in Segoe UI, which is exactly the failure self-hosting
the font exists to prevent.

> **ngrok is a review-time tool only.** The tunnel and its watchdog
> (`ops/sms-watchdog.ps1`) exist to share the app with reviewers over the
> internet. Neither is part of the plant deployment: no tunnel, no `ops/`
> watchdog, no outbound dependency. Use the NSSM services below instead.
5. **Build:** `npm ci && npm run build` (builds all five workspaces in dependency order). To gate a release: `npm run verify:release` = typecheck of all five workspaces + the test suite + the build.

   **A note on what actually lands on the plant host.** `npm ci` above is run with no `--omit=dev`, and it has to be — the build needs `typescript` and `vite`, both devDependencies. So every devDependency already installs on the plant PC today, `vitest` included; jsdom and `@testing-library/react`/`@testing-library/dom` (added UX Phase 8 Brief A, 21 Sep 2026, for component tests) simply join that same set, on disk and wherever this install reaches the npm registry from. None of the three is imported by anything under `web/src` that ships in the built bundle (only by `*.test.tsx` files, which `vite build` never touches) — the sha256 check `verify:release`/this brief's own acceptance run performs on `web/dist` is the evidence, not an assumption.


6. **Migrate the app DB:** set `MIGRATE_DB_USER=sms_migrate` and `MIGRATE_DB_PASSWORD=<its password>` for this one command (in the shell, not in `.env`), then `npm run db:migrate` (from `sms/`). The runner prefers `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` and falls back to `APP_DB_USER`/`APP_DB_PASSWORD` only if the former are unset — on a database bootstrapped after the R-13 fix, `sms_app` no longer has `db_ddladmin`, so that fallback will fail on any file with DDL (which is nearly all of them). Not `sqlcmd` over the files by hand: the migration files do not write `sms.schema_migration` themselves — the runner does — so a hand-applied set leaves an empty history, and the next `db:migrate` re-applies everything and fails inside 026 (the hazard described below). If that has already happened, `--mark-applied-through` is the way back.
   - **Stop the sync-worker service first when migrating an app DB that already holds data.**
     Some migrations build indexes on `cone_event`/`reject_event`, which take a
     schema-modification lock; against a service inserting every 60 s that means
     blocking, and potentially a deadlocked migration, on a live host. A fresh
     install has nothing to contend with and can skip this.
   - `npm run db:migrate` records what it applies in `sms.schema_migration` and
     skips those files next time. **A fresh database applies 001 → 027 unattended.**
   - **A database migrated by the pre-September runner** (which kept no history
     table) is a different case, and it is *not* a no-op: the first run would
     see an empty history and re-apply every file, and not every file tolerates
     that — `016` is a bare `DELETE`, and `026` carries seven unguarded
     `ALTER COLUMN … NOT NULL` statements plus a `THROW` guard, so the re-run
     fails inside 026 and rolls that file back. Record the already-applied range
     first: `node scripts/migrate.mjs --mark-applied-through=NNN` (records files
     ≤ NNN as applied *without executing them*, then applies the rest). Use it
     only when you know the database's real state — it asserts, it does not verify.
   - **A database that already holds pre-epoch rows** (raw/canonical data loaded
     before migration 025) needs the interleaved sequence, with the sync worker
     stopped: apply through `025` → run `node scripts/backfill-source-epoch.mjs`
     (assigns every existing row to its generation; read the script header — it
     encodes one machine's id boundaries and must be adapted) → apply `026`,
     whose guard refuses to run while any `source_epoch` is still NULL. The
     development sidecar has been through this; a plant sidecar never will,
     because it starts empty.
   - The development machine's two closed bootstrap generations are **not** in
     migration 025 (moved out 14 Sep 2026 to `scripts/seed-dev-epochs.sql`). A
     plant sidecar starts with an empty `sms.source_epoch` and registers its
     live generation with `sms epoch:accept` (cutover, below).
   - **Rehearsed from zero, 14 Sep 2026:** a database created with exactly the
     bootstrap's three roles, then `npm run db:migrate` as `sms_app` — all 27
     files applied unattended, `31` tables (27 `sms.*` + 4 `sms_raw.*`),
     `sms.source_epoch` empty, 27 history rows. `--mark-applied-through=010`
     was then exercised on the same database with 001–010 forgotten from the
     history: 10 marked without execution, 17 skipped, 27 rows restored. The
     throwaway database was dropped. **This predates the R-13 fix (22 Sep
     2026):** at that date `sms_app` still held `db_ddladmin`, which is
     exactly why that run could apply DDL as `sms_app`. Repeated today
     against a bootstrap run with the fix in place, the same rehearsal would
     need `MIGRATE_DB_USER=sms_migrate` for the `db:migrate` step — the two
     login/bootstrap changes were reasoned through against `migrate-core.mjs`
     and the bootstrap script (no `db_ddladmin` right is used anywhere except
     schema DDL, which every migration file is), but have not been
     re-rehearsed from zero on a live SQL Server instance in this pass; see
     the R-13 fix commit for what could and could not be proven without one.
7. **Create the first admin:** `node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin`.
8. **Create IFL's users at `--role=manager`.** The software is used by the GM,
   managers and process-department engineers, and every one of them needs to
   set the running product and to export data. Every screen is readable at any
   rank, so the only effect of a lower role is to block those two actions for
   no reason. Reserve `admin` for whoever administers the installation.
   `operator` and `supervisor` exist for a possible future in which floor staff
   are given accounts; nothing today needs them.
9. **Install services** (below), start them, browse to `http://<host>:4000`, sign in.

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
nssm set SMS-Api AppStderr "C:\sms\logs\api.err.log"
nssm set SMS-Api Start SERVICE_AUTO_START
nssm start SMS-Api

:: both: start after SQL Server, and do not crash-loop at boot while it is still coming up
nssm set SMS-Sync DependOnService MSSQL$SQLEXPRESS
nssm set SMS-Api  DependOnService MSSQL$SQLEXPRESS
nssm set SMS-Sync AppRestartDelay 10000
nssm set SMS-Api  AppRestartDelay 10000

:: log rotation (NSSM does it; the app does not): rotate at 50 MB, keep rotating online
nssm set SMS-Sync AppRotateFiles 1
nssm set SMS-Sync AppRotateOnline 1
nssm set SMS-Sync AppRotateBytes 52428800
nssm set SMS-Api  AppRotateFiles 1
nssm set SMS-Api  AppRotateOnline 1
nssm set SMS-Api  AppRotateBytes 52428800
```

Both boot with the machine and restart on crash. The sync-worker also self-heals per pass (a transient DB error is logged and retried next tick — it never exits on a blip).

**Both services log one JSON line per event to stdout** (roadmap Phase 2, 14 Sep 2026): `{"ts","level","svc","msg",...}` with a `correlationId` — the sync pass id on the worker, the request id (`X-Request-Id`, minted when absent and echoed back) on the API. Filter by `level` (`warn`/`error`): the `COOKIE_SECURE` cookie-drop warning, the plant-clock offset mismatch, the access log of non-2xx requests, audit-write failures and the stack of every 500 are all `warn`/`error` lines in `api.log`; a halted worker pass is an `error` line in `sync.log` whose `msg` names the table and the reason, prefixed with the driver error's class — `[transient]` (retried, then halted), `[auth]` (a login or permission failure — never retried), `[schema]` (a missing table or database). Keep `AppStderr` anyway: Node's own crash output and anything a library prints still goes there. **`DependOnService`** names the SQL Server service — `MSSQL$SQLEXPRESS` for a default Express install; check `sc query` for the instance name — because the API exits with code 1 if the app database is not reachable at startup, which at boot would otherwise put it into NSSM's restart loop until SQL Server finishes starting. The rotation settings replace the absence of any log rotation in the application itself.

---

## Configuring the installation (roadmap Phase 1)

Since migration 028 the installation is described by rows, not by source code, and every one of them is edited in **Setup** (admin only) and written to the audit log in the same transaction as the change:

| Entity | Where it lives | Edited in | Notes |
|---|---|---|---|
| Plant · Unit · Line | `sms.plant`, `sms.plant_unit`, `sms.line` | Setup › Line | `LINE_ID` in `.env` names which line this worker/API serves; the names are data. |
| Machine | `sms.machine` | Setup › Machines | `machine_no` is the number the acquisition layer writes in `MachineNo`; the sack packer has none. |
| Station | `sms.station` | Setup › Stations | Linked to a machine; the default link is *by number* (station N ↔ winder N) until IFL answers whether a machine and a station are the same thing (Q3). |
| Data source · Source table | `sms.data_source`, `sms.source_table` | Setup › Sources | Which physical table feeds each raw table. Connection details (server, database, login) stay in `.env` — the row says which `.env` block it uses. |
| Shift rule (boundaries, night rule, mode) | `sms.shift_rule` | Setup › Rules | Versioned; the worker reads the newest row at the start of every pass, the API per request. Changing the boundaries or the night rule changes how NEW rows are stamped; a rebuild restamps history. |
| Weight rule · Plausibility rule | `sms.weight_rule`, `sms.plausibility_rule` | Setup › Rules | Versioned; read-time. |
| Product · Product limits | `sms.product` (mirror of PDAS), `sms.product_limit_version` | Line › Change / History; PDAS writes off | IFL's product master is PDAS by their own arrangement. |
| Reject code | `sms.reject_code` | Setup › Reject codes | Discovered from the data; label, pass flag and severity are configuration. |

**Adding a machine (no code change).** Setup › Machines › *Add a machine*: number (as the PLC writes it), kind, name, make. A numbered winder gets its station row at once, linked to it. The next worker pass reads its rows; until then a row with an unknown machine number raises a `station_not_in_roster` warning on Setup › Sync health rather than being dropped.

**Adding a line (Q14 — IFL has not said whether a second line shares the database).** The schema allows it: a `sms.line` row, its machines and stations, and four `sms.source_table` rows naming that line's tables. Each line is served by its own worker process (`LINE_ID=<n>` in that worker's `.env`). The API serves one line per process today (`LINE_ID`); serving several lines from one API is Phase 1 follow-on work that waits on IFL's answer.

**Renaming a source table** (Setup › Sources) applies on the worker's next pass and is a new source generation: the worker halts on it until `sms epoch:accept` registers it — exactly the cutover procedure below.

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

- **Nightly:** `scripts\install-scheduled-tasks.ps1` registers it (roadmap Phase 11, 14 Sep 2026) as the task *SMS Nightly Backup* at 02:00, run **as a Windows account holding `db_backupoperator`** so no password appears in the task definition — the script is called with `-User ""`, which makes it connect as that account (`sqlcmd -E`). See *Scheduled tasks* under Operations below. Keeps 30 days. Run it by hand with a SQL login as before: `-User sms_backup -Pass <password>`.
- **`-OutDir` must be writable by the SQL Server *service account*, not just
  whoever runs the script** — `BACKUP DATABASE` executes on the server
  process, not the client. An arbitrary user-profile folder is often not
  writable by the service account even though your own login can write there
  fine; a path under the instance's own data directory always is. Find it:
  `EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'BackupDirectory';`
- **Monthly:** test a restore into a scratch DB — an untested backup is not a backup.
- **Before any canonical rebuild:** the `sms rebuild` command **requires** a point-in-time snapshot id and refuses without it (`ARCHITECTURE §18`). This is separate from and more precise than the nightly backup.
- **A rebuild must name the source generation it means** (23 Sep 2026). The
  full form is
  `sms rebuild --table=<t> --snapshot-id=<id> (--epoch=N[,M] | --all-generations) --confirm`.
  There is no default scope. **Until 23 Sep 2026 there was none at all**: the
  command scoped by `source_system` only, so one `--table=cone_event` deleted
  and re-derived *every* generation's cone rows together — on the development
  sidecar that is 487,936 rows across IFL's July copy, IFL's September copy
  and the simulator. Run it without a scope and it now prints every
  generation of the table with its row count and exits 2; run it with one and
  it prints exactly what it will delete, what it will re-derive it from, and
  what it will leave alone, then refuses without `--confirm`.
  `sms epoch:list` names the generations.
- **What a rebuild does and does not restore.** Canonical rows are re-derived
  from `sms_raw.*`, which the command never touches, so the rows come back.
  Two things do not: the transform applies the shift rule, plausibility rule
  and station roster **on file now**, so a re-derived row is stamped under
  today's rules rather than the ones in force when it was first transformed;
  and `sms.dq_finding` carries no generation, so a targeted rebuild clears
  none of it (stale findings may sit beside the new ones) while
  `--all-generations` clears the table's **non-critical** findings only. A
  CRITICAL finding is never deleted by a rebuild — `transform_zero_write` is
  the alarm saying rows were *not* written, and losing it is how a real loss
  becomes invisible.
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

> **Re-rehearsed 14 Sep 2026 on the two-generation schema** (migrations 001–027,
> `sms.source_epoch`, `sms.product_limit_version`; July + September generations
> loaded: 275,063 cone rows across `cone_event`). Backup with `CHECKSUM`: 242 MB;
> `RESTORE VERIFYONLY WITH CHECKSUM` passed; restore into a scratch database:
> **5 s**; every table's row counts matched the live database exactly (31
> tables; an earlier draft of this record said 33 — the live sidecar has 27
> `sms.*` + 4 `sms_raw.*` and nothing else, re-checked 14 Sep 2026);
> `product_timeline`'s newest row matched to the second. The scratch database
> was dropped afterwards. This is the rehearsal the 19 Aug one below no longer
> covers — that one predates ten migrations and the second source generation.

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

- **The top-bar sentence** on every screen states how old the newest data is, measured from the *oldest* of the four source tables (one dead feed cannot hide behind three healthy ones). When it is not "ok", no screen asserts whether the line is running.
- **Health** (`?s=health`, every signed-in account — roadmap Phase 11, 14 Sep 2026) — the same sync block Setup shows (verdict, last pass age, per-table outcome with the source *generation* and *watermark*, measured cadence, blocking findings, halted tables and the worker's reason), then the database's size against the Express cap, the service's version and uptime, and the age of the newest backup file. The top bar's data-age sentence links here. First place to look if a dashboard reads low or zero. **Setup › Sync health** (admin only) is the same block. Since 14 Sep 2026 **every halt writes a row**: an unknown generation, a source gone backwards, an IFL connection failure or a reference-seed failure each leave one `halted` row per table for that pass, and the screen prints the worker's reason under "N of 4 tables did not sync" (a generation halt names the `sms epoch:accept` command; a connection halt names the host; a table the pass never reached says which table stopped it). Two conditions are *findings* rather than halts, because the raw tables did sync: a PDAS product-mirror failure (`product_mirror_failed`, ERROR — readings still ingest, the product list stops updating) and a transform failure (`transform_failed`, CRITICAL — raw rows arrive, canonical tables fall behind). Both clear themselves on the next pass that succeeds. A third, `source_columns_changed` (WARNING), says IFL added or removed a column SMS does not read — ingestion continues, because the fingerprint of the columns SMS *does* read is unchanged, but someone should look at whether the new column matters (the way `MaterialId` did). Since 14 Sep 2026 a table that halts no longer stops the others: each table's outcome is its own row, the healthy tables still sync and transform, and the pass is reported failed at the end with every halted table named. `logs\sync.log` carries the stack as an `error` line.
- **`GET /api/operations`** — the JSON behind that section, open to any signed-in account: per-table sync outcome, generation label, watermark range, age, lifetime pass/failure counts, the last failure's error text, DQ roll-up by severity, and mixed shift-rule regimes.
- **`node cli/dist/index.js verify`** — full reconciliation + DQ findings.
- **`node cli/dist/index.js summary --date=YYYY-MM-DD [--shift=] [--epoch=N[,M]]`** — spot-check
  totals from the shell. It prints **one block per source generation** covering that date, and
  names the generation above every block: there is deliberately no combined total when two
  generations overlap, because their row ids each restart at 1 and adding them reports the same
  production day twice. Add `--epoch=` (ids from `sms epoch:list`) to narrow it to one generation;
  what that leaves out is listed under "EXCLUDED by --epoch" rather than dropped silently. A date
  covered by a single generation prints exactly the block it always did.
- **Logs** — structured JSON lines in `logs\sync.log` / `logs\api.log`.

### Which CLI commands know about source generations (23 Sep 2026)

`sms.source_epoch` is the only thing keeping IFL's two data generations apart
(they dropped and recreated all four weighing tables on 2026-08-05, restarting
every identity at 1). A command that ignores it either reports a pooled number
as if it were one generation's, or operates across generations the operator did
not mean. Audited command by command; re-audit this table whenever a command is
added.

| Command | Generation-aware | What a wrong answer costs |
|---|---|---|
| `sync` | **yes** — the worker resolves the generation before every read and halts on an unknown one | it halts rather than guessing; this is the gate everything else rests on |
| `verify` | **yes** — per-generation identity, `COUNT/MIN/MAX/SUM(id)` against the open generation only, closed ones reported as archived, `raw ⇄ canonical` by key per epoch, and `--weights` likewise | read-only; a wrong answer here is a missed or false alarm, not a deletion |
| `epoch:list` / `epoch:accept` / `epoch:purge` / `epoch:drop` | **yes** — generations are their subject | `epoch:purge` deletes raw **and** canonical for the named epochs; its gates (`--backup=<path.bak>`, `--confirm`, no pass in flight, transform lock) are the model the rebuild gates now follow |
| `rebuild` | **yes, since 23 Sep 2026** — `--epoch=` or `--all-generations`, required, no default. **Before that: no.** It scoped by `source_system` alone and rebuilt every generation of the table together | the one command that deletes canonical rows. They are re-derivable from `sms_raw.*` (untouched), so the rows come back; the stamping and the DQ history do not — see *Backup & restore* above |
| `cutover` | n/a by design — it clears raw **and** canonical for **everything**, which is what a cutover is. Gated by `--backup`, `--confirm` and the in-flight check | total loss of the sidecar's archive if run with a bad or missing backup; the gates are the whole defence |
| `retention` | n/a — prunes `sync_run`, non-critical `dq_finding` and expired sessions only, and never a reading of either layer | prints what it will never touch on every run |
| `summary` | **yes, since 23 Sep 2026** — counts are `GROUP BY source_epoch` and printed one block per generation; optional `--epoch=N[,M]` narrows the scope and the excluded generations are named. **Before that: no.** It aggregated by `shift_date` alone and pooled every generation into one number with nothing on screen to say so | read-only, so it never destroyed anything — but it is the command someone reaches for before quoting a figure to IFL, which is the worst place for a silently pooled number. It **reports** rather than refusing (unlike `rebuild`): a read-only command that refuses is one an operator routes around with ad-hoc SQL that has no epoch predicate either. The same omission still runs through most API read services — one decision, not a per-command patch, and still open |
| `user:create` / `user:password` | n/a — accounts, not readings | — |

### Health

`GET /api/health` (roadmap Phase 11, 14 Sep 2026) is the probe for a monitor. Unauthenticated; answers 200 with `status: "ok" | "degraded"` or **503 with `status: "down"`** when the app database cannot be reached — never a 500. Anonymous callers get `status` and `service` only (database size and acquisition details are `null`); a signed-in browser gets everything, which is what the Health screen renders.

```json
{ "status": "ok",
  "service":     { "version": "0.2.0", "uptimeSeconds": 86400, "startedAtUtc": "…", "pid": 1234 },
  "database":    { "ok": true, "latencyMs": 3, "sizeMb": 512.0, "capMb": 10240, "pctOfCap": 5.0 },
  "acquisition": { "kind": "ok", "ageSeconds": 30, "cadenceSeconds": 60, "halted": [] },
  "backup":      { "dir": "C:\\sms-backups", "newestFile": "sms-20260915-020001.bak", "newestAtUtc": "…", "ageDays": 0.4, "warning": false },
  "degradedReason": null }
```

`degraded` means one of: the API's pool reported an error since the last good probe (`degradedReason` says which), the acquisition is `stale` or `late` or a table is halted, or the data file is past 80 % of the cap. `acquisition.kind` is the same classification the top bar uses (`api/src/services/live.ts`). A `uptimeSeconds` that resets is a restart: NSSM restarted the process after a crash, and `logs\api.err.log` has the crash. Poll it from whatever the plant already monitors with (a scheduled `curl`, a PRTG/Zabbix HTTP sensor); email is not possible on an air-gapped host, so alerting is IFL's monitoring tool's job — Phase 11 clarification.

**Recovery behaviour (roadmap Phase 11).** Both processes attach `pool.on('error')`: the API logs it and reports `degraded` until the next probe succeeds; the worker logs it and reconnects on the next tick (each pass opens its own pools). Both handle `SIGTERM`/`SIGINT` — `nssm stop`, `Stop-Service`, Ctrl+C — by finishing what is in flight (the API drains open requests, the worker finishes the current pass, each with a deadline) and closing the pool before exiting 0. On start the worker closes any `sms.sync_run` row a previous process left `running` (older than twice `SYNC_INTERVAL_SECONDS`) as `failed` with `orphaned: the worker was restarted mid-pass`; before this, one crash made `sms rebuild` refuse for ever. After `SYNC_FAILURE_CRITICAL_AFTER` consecutive failed passes (default 5) the worker raises the CRITICAL finding `persistent_sync_failure` on Setup › Sync health and the Health screen; the next successful pass clears it. Once an hour it checks the data file and raises the WARNING `database_size` past 80 % of the cap.

### Scheduled tasks

`scripts\install-scheduled-tasks.ps1` registers the three recurring jobs (run as an administrator; `-WhatIf` prints what it would register and registers nothing):

```
powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -InstallDir "C:\sms" -RunAs "PLANT\svc-sms" -BackupDir "C:\sms-backups" -WhatIf
```

| Task | When | What | Runs as |
|---|---|---|---|
| SMS Nightly Backup | 02:00 daily | `scripts\backup-appdb.ps1 -User ""` (trusted connection) | `-RunAs`, holding `db_backupoperator` on `[sms]` |
| SMS Weekly Maintenance | 03:00 Sunday | `sqlcmd -E -i scripts\db-maintenance.sql` | `-RunAs`, holding `db_owner` on `[sms]` |
| SMS Daily Retention | 04:00 daily | `node cli\dist\index.js retention` | `-RunAs` (reads `.env`, connects as `sms_app`) |

**No password in any task argument** — that was the gap analysis's objection to "schedule it via Task Scheduler". The run-as account's password is entered once at registration and held by the Task Scheduler service. Create the Windows login on SQL Server first (the SQL is in the script's header). `-BackupDir` must be writable by the SQL Server *service* account and should equal `BACKUP_DIR` in `.env`, so the Health screen looks where the backups land. Verify: `schtasks /query /tn "SMS Nightly Backup" /v /fo LIST`; run one now: `schtasks /run /tn "SMS Nightly Backup"`.

### Retention

`node cli\dist\index.js retention [--dry-run]` (roadmap Phase 11 core function 11; the daily task above runs it) prunes only what this application grows for itself:

| Table | Rule | Setting |
|---|---|---|
| `sms.sync_run` | rows older than N days, **always keeping the newest row per (line, table)** — the row every "last pass" reading depends on | `RETENTION_SYNC_RUN_DAYS` (default 90) |
| `sms.dq_finding` | rows older than N days, **except CRITICAL** | `RETENTION_DQ_FINDING_DAYS` (default 365) |
| `sms.session` | expired rows | — |

`--dry-run` prints the counts with the same predicates and deletes nothing. A real run writes one audit row, `retention.run` (no actor — the CLI has none), with the counts.

**Never pruned by it: `sms.audit_log` and `sms.product_change`** (the record of who changed what; `audit_log` is append-only at the database since migration 030), **and every raw and canonical reading.** How long readings are kept against the 10 GB Express cap is IFL's decision (Phase 11 clarification: retention of raw and canonical readings; also whether IFL themselves delete within a table or only drop-and-recreate, which sets the longest recoverable outage). Until they answer, readings accumulate and the Health screen states the size; ~1 GB/year at the measured rate means the answer is not urgent, but it is theirs. When it comes, the remedy is a further retention rule, not a change to this command's defaults.

### Database maintenance

`scripts\db-maintenance.sql` — parameter-free T-SQL, run weekly by the task above or by hand as a login holding `db_owner` on `[sms]`:

```
sqlcmd -S .\SQLEXPRESS -E -d sms -b -i scripts\db-maintenance.sql
```

1. `DBCC CHECKDB WITH NO_INFOMSGS, ALL_ERRORMSGS` — corruption is found the night it happens; `-b` makes a failure a red task.
2. Index maintenance by measured fragmentation: `REORGANIZE` above 10 %, `REBUILD` above 30 %, indexes under 1,000 pages skipped. Rebuilds take a brief lock on Express (no `ONLINE`), hence 03:00 Sunday.
3. `sp_updatestats` — the worker appends ~8,000 rows/day and the auto-update threshold lags that by a week on a 275k-row table.

The recovery model is SIMPLE (set by `db/bootstrap/00_create_app_database.sql`), so the log file does not grow between backups and needs no log backups. Size is watched by the worker (`database_size` finding) and shown on Health; the plan when it approaches the cap is under *Database size* below.

### Configuration backup

The nightly `.bak` holds every row and none of the configuration. `scripts\backup-config.ps1` (roadmap Phase 11; run as an administrator, monthly and after any change to `.env`, TLS, the services or the tasks) copies `.env`, the TLS files `.env` names, `nssm dump SMS-Api` / `SMS-Sync`, and `schtasks /query /xml` for the three tasks into `BACKUP_DIR\config\<stamp>\` with a `manifest.txt`, then **restricts that folder's ACL** (`icacls`, inheritance removed) to the invoking user and Administrators — `.env` holds the database passwords in clear. Keeps the last 10 snapshots. Restoring a host is then: install Node and SQL Server, restore the `.bak`, copy `env` back to `.env`, put the TLS files where `.env` says, replay the `nssm-*.txt` commands, `schtasks /create /xml` each task file.

### Upgrading and rolling back

A release is the `sms/` tree at a version (`CHANGELOG.md` at the repository root; `sms/package.json` and every workspace carry it; `GET /api/health` reports it). Upgrade in place, in this order, as an administrator on the plant PC:

1. `nssm stop SMS-Sync` then `nssm stop SMS-Api` (both handle the stop signal: the worker finishes its pass, the API drains). Confirm nothing is in flight: `SELECT COUNT(*) FROM sms.sync_run WHERE finished_at_utc IS NULL` → 0.
2. **Back up first:** `scripts\backup-appdb.ps1` (a checksummed `.bak`; note its path — a rollback needs it) and `scripts\backup-config.ps1`.
3. Unpack the release into a **new** folder beside the current one (`C:\sms-0.2.0` next to `C:\sms-0.1.0`); copy `.env` in. Do not overwrite the running folder — it is the rollback.
4. In the new folder: `npm ci` (offline: see *Internet access*), `npm run build`.
5. `npm run db:migrate` — applies only the files not yet recorded in `sms.schema_migration`; each file runs in one transaction.
6. Repoint the services at the new folder (`nssm set SMS-Api AppDirectory C:\sms-0.2.0` and the `Application` paths, same for `SMS-Sync`; or install fresh from the NSSM block above) and start them: `nssm start SMS-Api`, `nssm start SMS-Sync`.
7. Verify: `GET /api/health` reports the new `service.version` and `status: ok`; the Health screen's sync block goes green within two passes; `node cli\dist\index.js verify` is clean; the audit log shows nothing unexpected.

**Rolling back.** Migrations are forward-only — there are no down scripts, by design (a migration that drops a column it added is a second way to lose data). So a rollback is a **restore**: stop both services, `RESTORE DATABASE sms FROM DISK = N'<the pre-upgrade .bak from step 2>' WITH REPLACE` (after a scratch restore has proven the file, as *Backup & restore* says), repoint the services at the previous release folder, start them, and confirm `service.version` on `/api/health` is the old one. Readings ingested between the upgrade and the rollback are re-read from IFL by the worker (the watermark is in the restored database), which is why the sidecar can afford this; anything an operator typed in that window (a product changeover, a calibration entry) is lost with the restore and must be re-entered — say so before rolling back.

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

## Credentials and secrets

Five database logins exist by design, each for one job. None is ever written into source control; `.env` and `ops/sms-tunnel-policy.yml` are git-ignored (verified against every commit on every branch, 14 Sep 2026).

| Login | Where it lives | Rights | Issued by | Used by |
|---|---|---|---|---|
| `sms_readonly` | IFL's plant SQL Server | `db_datareader` on `DATA_TP1U2` **and** `PDAS_TP1U2`, nothing else | IFL's DBA (`db/bootstrap/10_ifl_readonly_login.template.sql`) | sync worker, CLI — `IFL_DB_USER/PASSWORD` |
| `sms_app` | the sidecar server | `db_datareader`, `db_datawriter` on `[sms]` only — **no `db_ddladmin`, fixed 22 Sep 2026 (defect R-13)** | us, at install (`db/bootstrap/00_create_app_database.sql`) | API, sync worker, CLI (including `retention`) — `APP_DB_USER/PASSWORD`, every unattended process |
| `sms_migrate` | the sidecar server | `db_datareader`, `db_datawriter`, `db_ddladmin` on `[sms]` only | us, at install (`db/bootstrap/00_create_app_database.sql`) | `db:migrate` ONLY, run by hand at install/upgrade time — `MIGRATE_DB_USER/PASSWORD`, never held by a long-running service |
| `sms_backup` | the sidecar server | `db_backupoperator` on `[sms]` only | us, at install (SQL in *Backup & restore*) | `scripts/backup-appdb.ps1` — passed as `-Pass` |
| `sms_sim` | **development machines only** | writer on `DATA_TP1U2_SIM` (a database whose name ends `_SIM`; the simulator refuses any other) | the developer, by hand (*Plant simulator*, above) | `scripts/simulate-plant.mjs` — `SIM_DB_NAME/USER/PASSWORD` in `.env`; never created on a plant server |
| `sms_pdas_writer` | IFL's plant SQL Server (`TP1-PDAS\PDAS`, see below — **not** whatever host serves `DATA_TP1U2`) | **Nine rights** (finding H6, 15 Sep 2026 audit — this row used to name two): `EXECUTE` on `CreateMaterial`, `SetMaterialStatusActive`, `AddBlend`, `AddCount`, `AddTubeType`, `CreatePallet`, `SetPalletStatusActive`; `UPDATE` on `dbo.Materials` (the vendor supplies no UPDATE proc — changing a setpoint is one guarded single-row `UPDATE`); `INSERT` on `dbo.nhs_events`. **Does not exist yet.** | IFL's DBA — theirs to issue, and only after written authority that names all nine rights above, not the two this row used to state | API — `PDAS_WRITE_USER/PASSWORD`, behind `PDAS_WRITE_ENABLED` |

**The real PDAS host (observed, not assumed — 15 Sep 2026, finding H6).** IFL's own screenshots — SSMS's Object Explorer and a VNC session title bar, ten images under `Desktop/SPS unzip/SPS/*.jpg` — show PDAS on its own box: server `TP1-PDAS` at `192.168.100.37`, instance `TP1-PDAS\PDAS`, SQL Server 2022 (16.0.1000). `PDAS_WRITE_SERVER` must point there. Nothing in those screenshots says whether `DATA_TP1U2` lives on the same box; do not assume it does.

**Why `sms_pdas_writer` must be its own login, not the one in those screenshots.** Every procedure call demonstrated there ran under a NAMED PERSONAL LOGIN — `ibrahim`, visible in the SSMS connection panel and the VNC window title on all ten images — not a service account. A dedicated `sms_pdas_writer` is required instead of reusing (or mirroring) that login, for three reasons, and this is the argument the written-authority request to IFL rests on:
1. **Attribution.** An application's writes cannot be attributed to a person's account — every change SMS makes would read as something `ibrahim` did by hand, indistinguishable in PDAS's own event log from an actual manual edit.
2. **Rotation.** The credential cannot be rotated without breaking `ibrahim`'s own access to PDAS — a password change made for the app's sake would lock a person out.
3. **Continuity.** It disappears the day `ibrahim` leaves or changes role, which is exactly the moment a production dependency must not break.

The request to IFL should therefore ask for a new login provisioned for the application, scoped to the nine rights in the table above — not for the use of an existing person's credentials.

**The migration login split — DONE (defect R-13, HIGH, fixed 22 Sep 2026).** `sms_app` used to hold `db_ddladmin` so `npm run db:migrate` could run as it (roadmap Phase 11, 14 Sep 2026, first documented the risk without fixing it). That right also let it drop the append-only trigger migration 030 puts on `sms.audit_log` — so the trigger stopped accidents and ordinary misuse, but a party holding the app's own login could have removed it, deleted rows and put it back. `db/bootstrap/00_create_app_database.sql` now creates a **second** login, `sms_migrate` (`db_ddladmin` + `db_datareader`/`db_datawriter`, for migrations that touch data as well as schema), and no longer adds `sms_app` to `db_ddladmin`. Run `db:migrate` with `MIGRATE_DB_USER=sms_migrate` / `MIGRATE_DB_PASSWORD=<its password>` set for that one invocation (step 6 below) — never in the `.env` a long-running service reads. **Re-running the bootstrap script against a database provisioned before this fix is itself the remediation**: it detects `sms_app` still holding `db_ddladmin` and drops it (`ALTER ROLE db_ddladmin DROP MEMBER sms_app`), idempotently, alongside creating `sms_migrate`. Until that re-run happens on a given install, that install's audit log remains append-only against the code and against mistakes, but not yet against its own runtime credential — re-run the bootstrap script to close that gap.

Storage: `.env` on the sidecar host, readable by the service account only; `scripts\backup-config.ps1` copies it into an ACL-restricted folder under `BACKUP_DIR\config`. Rotation: change the password at the source, update `.env`, restart the affected service. The scheduled backup runs as a Windows account holding `db_backupoperator` (`scripts\install-scheduled-tasks.ps1`), so no SQL password appears in any task argument; `-User sms_backup -Pass …` remains for a by-hand run.

There is no `SESSION_SECRET`: sessions are server-side random UUIDs (`sms.session`), not signed cookies.

## Hard rules (never violate)

1. **IFL DB is read-only and unmodified** — no writes, no indexes, no DDL. Only `sync-worker` connects, via the read-only login.
2. **No credentials in code** — `.env` only; never commit it. Dev password ≠ prod password.
3. **Parameterised SQL only.**
4. **No PLC dependency** (Phase 1). Verified by inspection of all five package manifests — `mssql`, `zod`, `express`, `argon2`, `react` and nothing protocol-related. **This is a review convention, not an automated guarantee: no test asserts it.** (An earlier version of this line claimed a test did. There isn't one — adding it is cheap and worth doing.)

---

## When IFL answers the open questions

No redeploy needed — an **admin sets it once in the UI** (`ARCHITECTURE §4`):
- **Q4/Q5 weights (gross/net):** Admin → Interpretation rules → Weight basis. Applies immediately.
- **Q7 shift (fix/reproduce):** Admin → Shift basis, then `sms rebuild --table=cone_event --snapshot-id=<id> --epoch=<the generation you mean> --confirm` to apply to stored data. Name the generation: restamping every generation under the new rule is `--all-generations`, and it is a decision, not a side effect. `sms epoch:list` first.
- **Q10 reject codes:** Rejects view → type labels (manager+).
- **Q11 station names:** Admin → Station labels.
- **Q1 current product:** Dashboard → Current Product selector (supervisor+).
