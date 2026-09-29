# SMS Administrator & Deployment Manual

Audience: IFL's IT/DBA staff and the supplier's commissioning engineer. This is a
consolidated reference for installing, configuring, operating and troubleshooting the
Sack Management System (SMS) on IFL's plant network. It draws together and supersedes
nothing on its own — it restates, in one place, what `sms/DEPLOY.md`,
`INSTALLATION-FIRST-HOUR.md`, `HANDOVER-PDAS.md`, `HANDOVER-QA.md`, the `db/bootstrap/*.sql`
scripts, `.env.example`, the `scripts/*`, `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md`
and `PDAS-EXECUTION-2026-09-24.md` already say. Where this manual and one of those source
documents disagree, the source document is authoritative — read it before acting on anything
here you consider high-stakes.

Steps marked **[UNVERIFIED — not yet rehearsed]** have never been run end-to-end on a clean
machine or at the plant; treat them as the best current instructions, not as proven fact.

---

## 1. Architecture overview

Single plant, single server, plant intranet, no cloud dependency. Two Node.js processes and
one SQL Server database on the plant PC:

```
  IFL's plant SQL Server ──read-only──▶ sync-worker (Windows Service)
     (DATA_TP1U2, PDAS_TP1U2)                    │
                                                  ▼
                                          app DB "sms" (SQL Server Express)
                                                  ▲
                                                  │
                                          api (Windows Service, :4000)
                                          serves REST + the built React app
                                                  │
                                   browsers on the plant LAN ─▶ http://<host>:4000
```

- **sync-worker** is the ONLY process that reads from IFL's source databases
  (`DATA_TP1U2`, the cone/sack/reject weighing tables, and `PDAS_TP1U2`, the product
  master). It connects with a dedicated **read-only** SQL login and loops every
  `SYNC_INTERVAL_SECONDS` (default 60 s), copying new rows into the app-owned sidecar
  database (raw layer, then a transform into canonical tables).
- **api** serves `/api/*` REST endpoints and the built React single-page app. It never
  connects to IFL's read-only source. The one exception is the **PDAS write path**: a
  separate, narrower login (`sms_pdas_writer`) that the API uses, only when explicitly
  enabled, to call a small set of vendor stored procedures on `PDAS_TP1U2` (see §8).
- **web** is the React SPA, built to static files and served by the API process — one
  service to browse to, same-origin, no CORS or reverse proxy required in production.
- **Sidecar DB** (`sms`, SQL Server Express) is the only database this project writes to
  under normal operation. IFL's own databases are read-only to this software, always,
  with the PDAS write path being the sole exception, and only after IFL's written
  authorization and only through the vendor's own stored procedures / one guarded UPDATE.

## 2. Prerequisites

- **Node.js 22** (pinned in `sms/.nvmrc` and `engines` in `sms/package.json`; Node 20
  reached end-of-life 30 Apr 2026).
- **SQL Server** on the plant server — SQL Server Express is sufficient and is what this
  project is built and tested against. Express caps a database's data file at **10 GB**
  (log file unbounded) — see §11.
- **Ports:** API listens on `4000` (configurable, `API_PORT`). SQL Server's own port
  (`1433` by default, or resolved via SQL Browser for a named instance such as
  `.\SQLEXPRESS`) must be reachable from wherever sync-worker/CLI run.
- **npm registry access** during install/build (`npm ci` needs it, even for an otherwise
  air-gapped host — see §2.1). No internet access is required once built and running
  (see §7).
- IFL must have TCP enabled on their SQL Server instance if sync-worker/CLI run from a
  different host than the plant SQL Server itself.

### 2.1 Internet access is not required once running

The built SPA references no external hosts — no CDN scripts/styles, no Google Fonts
`<link>` (the Instrument Sans font is self-hosted at `web/public/fonts/`, copied into
`web/dist/fonts/` by the build — copy the whole `web/dist` output to the plant, do not
hand-pick files, or the app silently falls back to Segoe UI with no error). `npm ci` at
build/install time is the one step needing registry access; run that on a machine with
internet, or mirror the registry, then copy the built tree to the air-gapped host.

## 3. Install steps

1. **Install** Node 22 and SQL Server on the plant server.
2. **Obtain from IFL** a dedicated **read-only** SQL login for the sync worker —
   `db_datareader` on **both** `DATA_TP1U2` and `PDAS_TP1U2`, plus the server\instance and
   port. This is a hard requirement: IFL's own engineering login (`ibrahim`, as seen in
   the Sep 2026 sample) has EXECUTE on PDAS's procedures but **no table read at all** on
   PDAS — handed that login instead, the product mirror fails on cutover day and every
   screen loses its targets and limits, and because the product seed runs before the
   cone/sack/reject reader on every pass, that failure stops **all** ingestion, not just
   the product mirror. The exact grant script to hand IFL's DBA is
   `sms/db/bootstrap/10_ifl_readonly_login.template.sql`, which includes four pre-day
   test queries at the bottom. Test with `SELECT TOP 1 * FROM PDAS_TP1U2.dbo.Materials`
   before go-live day.
3. **Create the app database and its two logins** — run once, as a sysadmin:
   ```
   sqlcmd -S <server\instance> -E -i db\bootstrap\00_create_app_database.sql ^
     -v AppPassword="<strong unique password>" -v MigratePassword="<a DIFFERENT strong unique password>"
   ```
   This creates database `[sms]` (recovery model SIMPLE), the `sms_app` login
   (`db_datareader` + `db_datawriter` only — no `db_ddladmin`, since defect R-13's fix),
   and a separate `sms_migrate` login (`db_ddladmin` added, used only for
   `npm run db:migrate`, run by hand, never held by a long-running service). Idempotent —
   safe to re-run against a database bootstrapped before the R-13 fix; it will detect and
   correct an `sms_app` login that still holds `db_ddladmin`.
4. **Configure `.env`** from `sms/.env.example` (key names below in §5). The only
   dev→live change under normal operation is `IFL_DB_*` (§9, cutover).
5. **Build:** from `sms/`, `npm ci && npm run build` (builds all five workspaces in
   dependency order). `npm run verify:release` gates a release: typecheck of all five
   workspaces + the full test suite + the build.
6. **Migrate the app DB:** set `MIGRATE_DB_USER=sms_migrate` /
   `MIGRATE_DB_PASSWORD=<its password>` **in the shell for this one command only** (never
   in the persistent `.env`), then `npm run db:migrate` from `sms/`. **Stop the
   sync-worker service first if migrating a database that already holds data** — some
   migrations build indexes that take a schema-modification lock, which would otherwise
   block against (and potentially deadlock with) a service inserting every 60 s. A fresh
   install applies all migration files (001 through the current head) unattended and has
   nothing to contend with. Do not apply migration files by hand with `sqlcmd` — the
   migration runner, not the files themselves, writes `sms.schema_migration`; a
   hand-applied set leaves an empty history and the next `db:migrate` re-applies
   everything, which is not safe for every file (see `sms/DEPLOY.md`'s cutover section
   for the recovery path, `--mark-applied-through`).
7. **Create the first admin account:**
   `node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin`.
8. **Create IFL's user accounts at `--role=manager`.** Every screen in the app is
   readable at any rank; only writes (setting the running product, calibration entries,
   raw-register export, and Setup) are gated by role. The software is used by IFL's GM,
   managers and process-department engineers — give them all `manager` rank so no gate
   obstructs their normal work. Reserve `admin` for whoever administers the installation.
9. **Install the Windows services** (§6), start them, browse to `http://<host>:4000`,
   sign in.

Full detail, including every edge case in the migration sequence (a database with
pre-epoch data, a database migrated by a pre-September runner, etc.), is in
`sms/DEPLOY.md` under "First-time production setup" — read it before a production
migration if the database is not being created fresh.

### 3.1 Pre-flight checklist against IFL's live server — INSTALLATION-FIRST-HOUR.md

Before running any real `sync`/`epoch:accept`/`rebuild`/`cutover` command against IFL's
live server, run the four **read-only** checks in `INSTALLATION-FIRST-HOUR.md`, using the
read-only login IFL provides, against the live server (not Windows auth, not `sa`):

1. **Catalogue read check** — can the login read `sys.tables`, `sys.columns`, `sys.types`
   and `INFORMATION_SCHEMA.COLUMNS` on both `DATA_TP1U2` and `PDAS_TP1U2`? (Schema-drift
   detection depends on this; this project has already seen a plant login with EXECUTE
   only and no table read at all.) Any permission error here is itself the finding — do
   not retry with a more privileged login; get the specific missing grant added instead.
2. **Timing check** — time a steady-state read (last ~500 rows by id) and a full backfill
   count against the live tables with `SET STATISTICS IO, TIME ON`, confirming a
   Clustered Index Seek (not a Scan) and reads in the low tens for the steady-state
   query. **[UNVERIFIED — not yet rehearsed against a live plant server; only measured
   against detached development copies.]**
3. **Row-count comparison** — compare live row counts against the two development
   samples (19 and 34 production days) to sanity-check that a live table isn't orders of
   magnitude larger, which would change backfill cost (linear in row count) even though
   it does not change the steady-state seek cost.
4. **Lock-wait check** — while a steady-state read is in flight, query
   `sys.dm_exec_requests`/`sys.dm_exec_sql_text` for blocking sessions, to confirm no
   lock contention with IFL's own acquisition process writing to the same tables.

After all four pass, confirm the read-only login's actual granted permissions match
`db/bootstrap/10_ifl_readonly_login.template.sql`, then proceed with the install steps
above. **[UNVERIFIED — this whole checklist has not yet been run against IFL's live
server; every figure it checks against was measured on detached development copies.]**

## 4. SQL logins — five (soon six) dedicated logins, each for one job

None of these is ever written into source control. `.env` is git-ignored.

| Login | Lives on | Rights | Issued by | Used by |
|---|---|---|---|---|
| `sms_readonly` (named `IFL_DB_USER` in `.env`) | IFL's plant SQL Server | `db_datareader` on **both** `DATA_TP1U2` and `PDAS_TP1U2`, nothing else | IFL's DBA, via `db/bootstrap/10_ifl_readonly_login.template.sql` | sync-worker, CLI |
| `sms_app` | the sidecar server | `db_datareader` + `db_datawriter` on `[sms]` only — **no `db_ddladmin`** | installer, via `db/bootstrap/00_create_app_database.sql` | API, sync-worker, CLI (including `retention`) — every unattended process |
| `sms_migrate` | the sidecar server | `db_datareader` + `db_datawriter` + `db_ddladmin` on `[sms]` only | installer, via `db/bootstrap/00_create_app_database.sql` | `npm run db:migrate` only, run by hand, never held by a long-running service |
| `sms_backup` | the sidecar server | `db_backupoperator` on `[sms]` only | installer, by hand (SQL in `sms/DEPLOY.md`'s Backup & restore section) | `scripts/backup-appdb.ps1`, passed as `-Pass` |
| `sms_sim` | development machines only | writer on a database whose name ends `_SIM` (the simulator refuses any other) | the developer, by hand | `scripts/simulate-plant.mjs` — never created on a plant server |
| `sms_pdas_writer` | IFL's PDAS host (`TP1-PDAS\PDAS`, `192.168.100.37` — a **different** host than the one serving `DATA_TP1U2`; do not assume they are the same box) | Nine write rights plus five read-back SELECTs (below) | IFL's DBA, via `db/bootstrap/12_pdas_writer.template.sql`; written authority for the nine rights was requested by `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md` | API — `PDAS_WRITE_USER`/`PDAS_WRITE_PASSWORD`, only while `PDAS_WRITE_ENABLED=true` |

### 4.1 Why `sms_pdas_writer` is a separate, dedicated login

Every PDAS procedure call IFL has demonstrated so far ran under a named personal login
(`ibrahim`), not a service account. Reusing or mirroring that login is wrong for three
reasons, and this is the argument the written-authority request to IFL rests on:

1. **Attribution.** An application's writes cannot be attributed to a person's account —
   every change SMS makes would read as something `ibrahim` did by hand, indistinguishable
   in PDAS's own event log (`nhs_events`) from an actual manual edit.
2. **Rotation.** The credential cannot be rotated without breaking `ibrahim`'s own access
   to PDAS — a password change made for the app's sake would lock a person out.
3. **Continuity.** It disappears the day `ibrahim` leaves or changes role, which is
   exactly the moment a production dependency must not break.

### 4.2 The nine PDAS write rights, and why SELECT on Materials is required

`sms_pdas_writer` needs exactly these nine rights, on `PDAS_TP1U2`, and nothing else — no
DDL, no DELETE, no other table:

| Right | In plain terms |
|---|---|
| EXECUTE `CreateMaterial` | Add a new product |
| EXECUTE `SetMaterialStatusActive` | Retire or reactivate a product |
| EXECUTE `AddBlend` | Add a new blend entry |
| EXECUTE `AddCount` | Add a new count entry |
| EXECUTE `AddTubeType` | Add a new tube type entry |
| EXECUTE `CreatePallet` | Add a new pallet entry |
| EXECUTE `SetPalletStatusActive` | Retire or reactivate a pallet entry |
| UPDATE `dbo.Materials` | Change one product's weight setpoint or limits — a single guarded row; the vendor supplies **no** UPDATE stored procedure for this, so this direct UPDATE is the only path |
| INSERT `dbo.nhs_events` | Record that change in PDAS's own event log, the same way the vendor's own procedures do |

Alongside these nine, the login also needs plain **SELECT** on the five tables it writes
to or reads reference data from: `Materials`, `Blends`, `Counts`, `TubeTypes`, `Pallets`.
This SELECT grant serves three distinct purposes — **do not treat it as optional or
cosmetic**:

1. It lets the software check, after every write, that PDAS actually holds what it
   expects, rather than assuming the write went through (the "read-back" step).
2. It lets the software check, before changing a product's setpoint, that nobody else
   changed that same product since the screen was opened (optimistic concurrency).
3. For the setpoint-change UPDATE specifically, it is a **plain requirement of SQL
   Server itself**: SQL Server will not run an UPDATE whose WHERE clause names a column
   (here, the product's id) without SELECT permission on that column, regardless of the
   UPDATE permission already granted. **Without this SELECT grant, the setpoint-change
   right does not work at all** — not merely lose its double-check.

There is deliberately **no INSERT on `dbo.Materials`** — a new product goes through
`CreateMaterial`, never a raw insert.

The exact grant script is `sms/db/bootstrap/12_pdas_writer.template.sql`; run it against
the PDAS host:
```
sqlcmd -S TP1-PDAS\PDAS -E -i db\bootstrap\12_pdas_writer.template.sql ^
  -v PdasDb="PDAS_TP1U2" -v WriterPassword="<a strong password IFL's DBA chooses>"
```
It is idempotent (safe to re-run) and creates the login if it does not already exist. IFL's
DBA should choose the password and hand it to the SMS project owner directly (phone or in
person), never by email or in a document.

**Why retire-and-recreate is not an alternative to the UPDATE right.** The natural
instinct — retire an old product record and create a fresh one whenever a setpoint needs
to change — was tested against a local copy of IFL's data and fails:
`CreateMaterial` refuses to add a product sharing an existing blend/count/tube
combination, **even after the old one has been retired**; its own uniqueness check never
references the active/retired flag. IFL's own event log shows this exact failure
occurring on their side on 18 August 2026 (`nhs_events` entries 23204, 23206, 23207, 23208,
Material 1022); a local reproduction on `PDAS_TP1U2_SEP07` hit the identical error. The
guarded single-row UPDATE is therefore the only reliable way to change a setpoint.

## 5. Configuration keys

Copy `sms/.env.example` to `sms/.env` and fill in real values. **This manual states key
names and meaning only — never real values, and never anything from the actual `.env`
file.**

### 5.1 App database (sidecar, read/write)
`APP_DB_SERVER`, `APP_DB_PORT`, `APP_DB_NAME`, `APP_DB_USER`, `APP_DB_PASSWORD`,
`APP_DB_ENCRYPT`, `APP_DB_TRUST_SERVER_CERTIFICATE` — connection to the local `[sms]`
database as `sms_app`.

### 5.2 Migration login (set in the invoking shell only, never in the persistent `.env`)
`MIGRATE_DB_USER`, `MIGRATE_DB_PASSWORD` — used only by `npm run db:migrate`; falls back
to `APP_DB_USER`/`APP_DB_PASSWORD` if unset, which only works on a database whose
`sms_app` login still holds `db_ddladmin` (pre-R-13-fix).

### 5.3 IFL source database (sync-worker only, read-only)
`IFL_DB_SERVER`, `IFL_DB_PORT`, `IFL_DB_NAME_DATA` (`DATA_TP1U2`), `IFL_DB_NAME_PDAS`
(`PDAS_TP1U2`), `IFL_DB_USER` (`sms_readonly`), `IFL_DB_PASSWORD`, `IFL_DB_ENCRYPT`,
`IFL_DB_TRUST_SERVER_CERTIFICATE`. **This block is the entire dev→live switch** — in
development it points at a local attached copy; in production it points at the plant
server/instance. Nothing else in the API or web app changes.

### 5.4 PDAS write path
`PDAS_WRITE_ENABLED` — off (`false`) by default; the one deliberate exception to "the API
holds no IFL connection." `PDAS_WRITE_SERVER`, `PDAS_WRITE_PORT`, `PDAS_WRITE_DATABASE`,
`PDAS_WRITE_USER` (`sms_pdas_writer`), `PDAS_WRITE_PASSWORD`, `PDAS_WRITE_ENCRYPT`,
`PDAS_WRITE_TRUST_SERVER_CERTIFICATE`.

**`PDAS_WRITE_SERVER` must be a plain host or IP, plus an explicit TCP port
(`PDAS_WRITE_PORT`) — not a `host\instance` name, unless SQL Browser is running to
resolve it.** A named instance (e.g. `.\SQLEXPRESS` or `HOST\PDAS`) needs SQL Browser
running to resolve its port, and the `mssql` driver silently drops any `PDAS_WRITE_PORT`
you set once an instance name is present in `PDAS_WRITE_SERVER`. For the real PDAS host
this means either confirm SQL Browser is running and reachable on `TP1-PDAS\PDAS`, or use
its plain host/IP (`192.168.100.37`) with the instance's actual TCP port found once via
SQL Browser or SSMS. Never reuse `IFL_DB_USER` here — that login is read-only by policy.
With `PDAS_WRITE_ENABLED=false`, or with any PDAS-write credential missing, the product
screen is read-only in the app and states why.

### 5.5 Sync
`SYNC_INTERVAL_SECONDS` (≥5, default 60), `SYNC_OVERLAP_ROWS` (≥0, default 500),
`LINE_ID` (≥1, default 1 — stamped on every row; set once at first install and never
change after data has been ingested), `SYNC_ONCE` (dev/CI only — one pass then exit),
`SYNC_FAILURE_CRITICAL_AFTER` (≥1, default 5 — consecutive failed/halted passes before
the CRITICAL `persistent_sync_failure` finding is raised), `SACK_BLACKOUT_HOURS` (≥1,
default 4 — hours without a sack row while cones are being weighed before the WARNING
`sack_blackout` finding is raised).

### 5.6 Operations
`PASSWORD_MIN_LENGTH` (6–128, default 10), `BACKUP_DIR` (where
`scripts/backup-appdb.ps1` writes `.bak` files; the Health screen reads the newest file's
age from here), `RETENTION_SYNC_RUN_DAYS` (default 90), `RETENTION_DQ_FINDING_DAYS`
(default 365).

### 5.7 Plant simulator (development only — never set on a plant install)
`SIM_DB_NAME`, `SIM_DB_USER`, `SIM_DB_PASSWORD` — the simulator writes only to a database
whose name ends `_SIM` and refuses any other target.

### 5.8 API
- `API_PORT` (default 4000).
- `CACHE_TTL_SECONDS` (default 5).
- `LINE_NAME` — **seed value only**, used to populate `sms.line.display_name` on a
  fresh database (migration 028); once that row exists, this env value is ignored and
  the name is edited in Setup › Line.
- `LIVE_ALLOW_AS_OF` — must be `false` in production. Lets `?at=<ISO>` replay a past
  moment for demos; a wall display left on a replay URL would present old numbers as
  live.
- `PLANT_UTC_OFFSET_MINUTES` — **set this on every install; do not leave it commented
  out.** Minutes east of UTC (300 for this plant, UTC+5). This is not optional in
  practice even though the code treats it as skippable: the whole two-clocks design
  assumes the deployment host's OS timezone equals the plant's, and this is the one
  check that verifies that rather than assuming it. IFL supplies the plant PC, and a
  freshly imaged Windows Server defaults to UTC — on such a host every reading arrives
  "five hours in the future" relative to the plant clock, silently, until shift
  attribution or the live status is visibly wrong. Both the API and sync-worker compare
  this value against the host's own OS-reported offset at startup and warn loudly on a
  mismatch; the worker additionally raises a standing WARNING finding on the Operations
  screen, cleared automatically once the host's clock is fixed and the worker restarts.
  Neither process refuses to start on a mismatch.
- `TRUST_PROXY` — default `false`; set `true` **only** when a reverse proxy you control
  terminates TLS in front of this service (see §6.2, Option B). `true` with no proxy in
  front reopens an `X-Forwarded-For` spoofing bypass of the login lockout.
- `COOKIE_SECURE` — defaults `true` (requires TLS). **Set `false` for a plain-HTTP plant
  intranet.** See the callout below — this is the one setting most likely to look like it
  works during testing and then fail for every other PC on the LAN.
- `TLS_PFX_PATH`/`TLS_PFX_PASSPHRASE` or `TLS_CERT_PATH`/`TLS_KEY_PATH` — set one pair,
  not both, only if terminating TLS directly in the API process (§6.2, Option A).
- `WEB_DIST` — path to the built React app (`./web/dist`) so the API serves it.
- No `SESSION_SECRET` — sessions are server-side random UUIDs (`sms.session`), not
  signed cookies.

### 5.9 Swappable unknowns (values IFL has not yet confirmed)
`WEIGHT_BASIS` (`as_recorded` | `gross` | `net`), `CONE_TUBE_WEIGHT_G`, `SACK_TARE_KG`,
`SHIFT_MODE` (`corrected` | `legacy`), `SHIFT_NIGHT_BELONGS_TO` (`start_day` |
`calendar_day`). These are now also settable at runtime by an admin in the UI (Admin →
Interpretation rules) without a redeploy — see §9.4.

### 5.10 PLC reader stub (Phase 2 — disabled; not in scope)
`PLC_READER_ENABLED` (`false`), `PLC_HOST`, `PLC_RACK`, `PLC_SLOT`, `PLC_CONE_ID_DB` —
these keys exist in `.env.example` only as a documented, dependency-free re-entry point.
No PLC library appears in any of the five package manifests. This is a review
convention, enforced by inspection, **not enforced by an automated test today.**

### 5.11 Response-size guardrails (in `api/src/config.ts`, not `.env`)
`MAX_RESPONSE_ROWS = 50,000` and `MAX_RESPONSE_BYTES = 20 * 1024 * 1024` (20 MB) are
constants in `sms/api/src/config.ts`, not environment variables — there is no `.env` key
for either today. **Fixed, 24 Sep 2026, `855045f` (RT-014, was "still open" as of this
section's earlier wording — corrected here, later the same day the fix landed).** These
two constants are now genuinely enforced, independent of whatever the SQL layer already
did: `api/src/middleware/responseCap.ts` is mounted globally in `createApp` and refuses
any response outright — HTTP `413` — whenever it exceeds either cap, before the response
reaches the caller. The row cap looks at the largest array in this app's known envelope
shapes (a bare top-level array, or `.rows`/`.data`/`.data.rows`); the byte cap is an
independent backstop measured on the serialized JSON, catching a huge non-array payload or
many moderately-sized rows with heavy per-row fields that the row check alone would miss.
`/api/spc` additionally keeps its own tighter, separately-named span cap
(`MAX_SPC_RANGE_DAYS = 186` days) rather than relying on the row cap alone. The register
CSV export (`/api/events/export`) is deliberately **not** wrapped by this middleware — it
already enforces its own `CSV_ROW_CAP` with an explicit `truncated`/`X-Export-Truncated`
flag, a different, already-labelled contract this middleware would only duplicate; this is
a documented exclusion, not a residual gap. `MAX_RESPONSE_ROWS`/`MAX_RESPONSE_BYTES` can now
be relied on for capacity planning at the HTTP layer, on top of whatever the SQL query
itself already bounds.

### ⚠️ `COOKIE_SECURE` — the one setting that fails silently

| Browsing from | `COOKIE_SECURE=true` over plain HTTP |
|---|---|
| The plant server itself (`http://localhost:4000`) | **works** |
| Any other PC (`http://<plant-ip>:4000`) | **login silently fails** |

Browsers treat `http://localhost` as trustworthy and keep a `Secure` cookie there, but
drop it everywhere else over plain HTTP. The failure has no visible error: the login
POST returns `200` with the user object, the browser discards the cookie, and the next
request is anonymous, so the UI just returns to the login screen — it looks exactly like
a wrong password. **On a plain-HTTP plant LAN, set `COOKIE_SECURE=false`.** Keep it
`true` only behind real TLS. The API logs an explicit warning to stderr
(`logs\api.err.log`) whenever a login arrives over plain HTTP from a non-localhost host
while `COOKIE_SECURE=true`.

## 6. Windows services (NSSM)

Node has no native service manager on Windows; use NSSM (or `node-windows`).

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

`DependOnService` names the SQL Server service (`MSSQL$SQLEXPRESS` for a default Express
install — check `sc query` for the instance name), because the API exits with code 1 if
the app database is unreachable at startup, which at boot would otherwise put it into
NSSM's restart loop until SQL Server finishes starting.

### 6.1 Restart policy — what happens on a crash

Both processes install guards (`sms/api/src/processGuards.ts`) around the two ways a
Node process can fail unexpectedly:

- **An unhandled promise rejection** is logged with its stack, the service is marked
  **degraded** (visible on `/api/health` and the Health screen via `degradedReason`), and
  the process **keeps running** — a single bad request should cost one 401/500, not the
  whole API going down.
- **An uncaught exception** (a synchronous throw that escaped every handler) is logged,
  then the process calls **`exit(1)`** deliberately — an uncaught exception means process
  state may be inconsistent, so this does not try to keep running. NSSM's
  `AppRestartDelay 10000` then restarts the service **10 seconds later**.

Both processes also handle `SIGTERM`/`SIGINT` (`nssm stop`, `Stop-Service`, Ctrl+C)
gracefully: the API drains in-flight requests, the worker finishes its current sync pass
(each with a deadline), then both close their database pool and exit 0. On startup, the
worker closes any `sms.sync_run` row a previous process left `running` (older than twice
`SYNC_INTERVAL_SECONDS`) as `failed` with reason `orphaned` — before this existed, one
unclean crash made `sms rebuild` refuse to run forever afterward.

### 6.2 TLS (optional)

Plain HTTP with `COOKIE_SECURE=false` is the documented default for a plant-intranet
deployment and is what most sites should ship with. Put real TLS in front only if plant
policy requires encrypted traffic even on the intranet. A publicly-trusted certificate
(Let's Encrypt or similar) is **not obtainable** here — issuance requires a domain
reachable from the public internet, which contradicts the air-gapped deployment. Use a
self-signed certificate, or an internal CA if the plant already runs one.

- **Option A — the API terminates TLS itself.** Set either the PFX pair
  (`TLS_PFX_PATH`/`TLS_PFX_PASSPHRASE`) or the PEM pair
  (`TLS_CERT_PATH`/`TLS_KEY_PATH`), plus `COOKIE_SECURE=true`, leave `TRUST_PROXY=false`.
  *Verified 19 Aug 2026* against this exact code, both forms: each started the API on
  `https://`, served `/api/health` over real TLS, correctly refused plain HTTP on the same
  port, and correctly showed `Strict-Transport-Security` only on the TLS response.
- **Option B — a reverse proxy (IIS) terminates TLS.** Install URL Rewrite + Application
  Request Routing, bind the plant's certificate to an IIS site on 443, forward to
  `http://localhost:4000`. Set `TRUST_PROXY=true`, `COOKIE_SECURE=true` on the API. This
  is only as safe as its precondition — IIS must be the **only** path to the API; also
  remove or restrict the `:4000` firewall rule to loopback once IIS fronts it, or the
  `X-Forwarded-For` bypass this option exists to avoid re-opens.

## 7. Reaching the app from other machines

- Open the port once: `netsh advfirewall firewall add rule name="SMS API" dir=in action=allow protocol=TCP localport=4000`.
- The API binds all interfaces (`0.0.0.0`) — no host-specific config needed.
- Give the plant PC a **static IP or DNS name** — operators should not type a DHCP
  address that changes.

## 8. PDAS write path — what it is, and the enablement checklist

The PDAS write path is a single deliberate exception to "the API holds no IFL
connection." When enabled, the API calls a small set of the vendor's own stored
procedures (never a raw INSERT except through those procedures) and one guarded UPDATE,
under the `sms_pdas_writer` login (§4).

### 8.1 Enablement checklist

1. **Written authorization from IFL** naming the nine rights precisely — see
   `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md` for the letter and grant script
   sent to IFL, and `handover/PDAS-WRITE-GRANT-2026-09-19.md` for the record of IFL's
   go-ahead. Confirm the current state of this authorization in `DEFECTS.md` D-12 and
   `CLAUDE.md` before proceeding — this project's own documents have at different times
   stated both "granted" and "still awaited"; read the most recent dated entry rather
   than assuming either.
2. **Provision the login** on the target PDAS host using
   `db/bootstrap/12_pdas_writer.template.sql` (§4.2) — IFL's DBA runs this against the
   plant PDAS host (`TP1-PDAS\PDAS`); for local proof, the project owner runs it against
   a local copy only.
3. **Take a backup before enabling**, of both the PDAS database and the app's own
   `sms` sidecar (the sidecar's `sms.product_change` / `sms.product_limit_version`
   tables are as much a target of any write as PDAS itself). Use `WITH COPY_ONLY,
   CHECKSUM, INIT`, verify with `RESTORE VERIFYONLY WITH CHECKSUM`, then prove
   restorability into a scratch database with matching row counts, before any write is
   made.
4. **Prove the write path locally first**, with `sms/scripts/pdas-e2e-local.mjs`.
   **This script is LOCAL ONLY — it must never be run against the plant.** It refuses to
   proceed unless the write target resolves to `localhost`/`127.0.0.1`/`::1` **and** the
   PDAS database name ends in `_SEP07` or `_E2E` — there is no override flag. It drives
   all nine write rights plus refusal/blocker/conflict/disabled paths through the real
   app code (`PdasWriter`, `planChangeover`/`executeChangeover`), then must be followed
   by a full restore of both databases from the pre-run backup — the script itself never
   deletes or restores anything; that is deliberate, not an oversight. As of the 24 Sep
   2026 pass, all thirteen cases in this harness pass (`PDAS-EXECUTION-2026-09-24.md`).
5. **Set `PDAS_WRITE_ENABLED=true`** in the real `.env`, with `PDAS_WRITE_SERVER`
   pointed at the **actual plant PDAS host** (§5.4's naming caveat) — only after steps
   1–4 are all complete for the plant, not just for a local copy. **[UNVERIFIED — as of
   the most recent dated entry in this repository, the write path has been proven
   end-to-end against a local copy only; it has never been pointed at the plant.]**
6. **Notify IFL before the very first write reaches the plant database.**
7. **Monitor Health afterward** — the Health screen and `/api/health`'s DQ findings
   report `pdas_write_unverified` (a write's own read-back could not be confirmed) and
   `pdas_write_readback_failed` (the read-back check itself failed, distinct from the
   write failing) as standing findings if either occurs; see §10 and
   `sms/api/src/services/health.ts`'s `raiseReadbackFailed` for what this covers ("Checked
   after writing" — a committed write followed by a failed confirmation read is not
   silently treated as a clean success).

### 8.2 What this write path is not

It does not touch `DATA_TP1U2` at all. It never DELETEs anything. It offers no way to
retire-and-recreate a product as an edit — that operation is refused by the vendor's own
`CreateMaterial` uniqueness check, proven by direct execution (see §4.2's callout); the
only way to change a setpoint is the guarded single-row UPDATE.

## 9. Go-live cutover (repointing from a development/sample copy to the live plant server)

By design the connection is one string; nothing in the API or web app code changes. The
live server is a **different physical source** with its own `id` counter restarting from
1, and the app DB may already hold sample/development generations of data. The
sync-worker must be told, deliberately, that a new generation is being read — **it will
not guess, and does not automatically backfill on its own inference.**

1. **Back up the app DB first.** Nothing is deleted by this procedure — sample
   generations stay in the sidecar as archived history beside the live one.
2. **Stop `SMS-Sync`.** Confirm nothing is mid-pass:
   `SELECT COUNT(*) FROM sms.sync_run WHERE finished_at_utc IS NULL` → must be 0.
3. **Edit `.env`:** point `IFL_DB_SERVER` / `IFL_DB_PORT` / `IFL_DB_NAME_DATA` /
   `IFL_DB_NAME_PDAS` / `IFL_DB_USER` / `IFL_DB_PASSWORD` at the **live** plant database
   and the read-only login IFL provisioned (§3, step 2). Leave `PDAS_WRITE_ENABLED=false`
   unless §8's checklist is separately complete for the plant.
4. **`node cli/dist/index.js sync`** — **it must halt** with a message naming
   `No open source generation … sms epoch:accept`. That halt is the safety gate working
   as intended. If it does anything else — proceeds, or reports success — **stop and
   investigate before going further**; this would mean the gate itself is not behaving
   as documented.
5. **`node cli/dist/index.js epoch:accept --all --provenance=ifl_live --label="Plant, live"`**
   — read the plan it prints first (server/database, each table's `create_date`,
   fingerprint and `MAX(id)`), then re-run with `--confirm` added.
6. **Start `SMS-Sync`.** The first pass backfills the live generation — watch
   `logs\sync.log`; every stream's `written` count should equal its `read` count.
7. **`node cli/dist/index.js verify`** — every **open** generation must reconcile with
   its source by count, min, max and sum of ids; sample generations report as *archived*.
   A stop here, after the backfill has settled, is expected behaviour, not a fault.
8. **`node cli/dist/index.js epoch:list`** — the live generation should show as OPEN with
   rows; sample generations show as closed.

The worker halts, on every subsequent pass, if: the live schema drifts within a
generation (fingerprint changed), the source is replaced (`create_date` changed), the
connection points at a different server/database, or the source's `MAX(id)` falls below
the watermark (indicating a restore on IFL's side). Each halt message names the fix.
**Never clear `sms.source_epoch` by hand** — `sms cutover --confirm` exists specifically
for "discard every reproducible row and start again" and nothing else should be used for
that purpose.

### 9.1 Configuring the installation post-cutover (roadmap Phase 1)

Since migration 028, plant/unit/line/machine/station names, shift rules, weight rules,
plausibility rules and reject-code labels are rows in the sidecar database, edited in
**Setup** (admin only), not source code:

| Entity | Table(s) | Edited in |
|---|---|---|
| Plant · Unit · Line | `sms.plant`, `sms.plant_unit`, `sms.line` | Setup › Line |
| Machine | `sms.machine` | Setup › Machines |
| Station | `sms.station` | Setup › Stations |
| Data source · Source table | `sms.data_source`, `sms.source_table` | Setup › Sources |
| Shift rule | `sms.shift_rule` (versioned) | Setup › Rules |
| Weight rule · Plausibility rule | `sms.weight_rule`, `sms.plausibility_rule` (versioned) | Setup › Rules |
| Product · Product limits | `sms.product`, `sms.product_limit_version` | Line › Change / History; also §9.2 below |
| Reject code | `sms.reject_code` | Setup › Reject codes |

`LINE_ID` in `.env` names which line this worker/API instance serves and must never
change after data has been ingested; `LINE_NAME` is a seed value only (§5.8).

### 9.2 When IFL answers a remaining open question

No redeploy is needed for these — an admin sets each once in the UI:
- **Weight basis (gross/net):** Admin → Interpretation rules → Weight basis, applies
  immediately.
- **Shift rule (fix vs reproduce history):** Admin → Shift basis, then
  `sms rebuild --table=cone_event --snapshot-id=<id> --epoch=<generation> --confirm` to
  restamp stored data for that generation specifically — restamping every generation is
  `--all-generations`, a deliberate choice, not a side effect. Run `sms epoch:list`
  first to see the generations.
- **Reject code meanings:** Rejects screen → type labels (manager rank and above).
- **Station names:** Admin → Station labels.
- **Current product:** Line screen → Current Product selector.

## 10. Monitoring (`/api/health` and the Health screen)

`GET /api/health` is the probe for external monitoring (a scheduled `curl`, a
PRTG/Zabbix HTTP sensor — email alerting is not possible on an air-gapped host, so
alerting is whatever monitoring tool IFL already runs). It answers `200` with
`status: "ok" | "degraded"`, or **`503` with `status: "down"`** when the app database
cannot be reached — it never returns a bare `500`. Anonymous callers get `status` and
`service` only; a signed-in browser gets the full payload the Health screen renders:

```json
{ "status": "ok",
  "service":     { "version": "0.2.0", "uptimeSeconds": 86400, "startedAtUtc": "…", "pid": 1234 },
  "database":    { "ok": true, "latencyMs": 3, "sizeMb": 512.0, "capMb": 10240, "pctOfCap": 5.0 },
  "acquisition": { "kind": "ok", "ageSeconds": 30, "cadenceSeconds": 60, "halted": [] },
  "backup":      { "dir": "C:\\sms-backups", "newestFile": "sms-20260915-020001.bak", "newestAtUtc": "…", "ageDays": 0.4, "warning": false },
  "degradedReason": null }
```

### 10.1 `status` states

`HealthStatus` is one of three values (`sms/api/src/services/health.ts`):
- **`down`** — the app database itself cannot be reached (`db.ok` is false). This is the
  only state that returns HTTP 503 instead of 200.
- **`degraded`** — the database answers, but at least one of: the acquisition state is
  `stale` or `late`, a source table is halted, or a pool error was reported since the
  last good probe (`markDegraded`), or the data file is past 80% of the Express cap.
  `degradedReason` (present whenever the overall status is degraded, and — per the RT24-12
  fix — meant to name every signal that actually contributed, not only a raw pool error)
  states which.
- **`ok`** — everything else.

`acquisition.kind` uses the same classification the top bar's data-age sentence uses,
measured from the **oldest** of the four source tables, so one dead feed cannot hide
behind three healthy ones.

### 10.2 DQ findings surfaced on Health/Operations, worth knowing by name

- **`shift_rule_drift`** — the stored `Shift` column (derived from insert time) disagrees
  with the shift computed from `ProductionDate` under the currently configured shift
  rule. Fixed 23 Sep 2026 for a false-positive case involving BIGINT-as-string
  timestamps (commit `32e9d0d`).
- **`isolated_production_day`** — a production day that sits alone, disconnected from
  the rest of its source generation's contiguous range; worth checking whether it belongs
  to a different generation entirely (RT24-09 flags this can still happen unflagged inside
  a documented data gap).
- **`pdas_write_unverified`** — a PDAS write's own read-back could not be confirmed
  (`pdasWrite.ts`'s `raiseReadbackFailed`); the write may have committed but this app
  cannot currently prove it did.
- **`pdas_write_readback_failed`** — the read-back check itself failed (e.g. a permission
  error under an EXECUTE-only role with no SELECT), distinct from the underlying write
  failing — see §4.2 on why the read-back SELECT grant is not optional.
- **`product_mirror_failed`** (ERROR) — the PDAS product mirror failed this pass;
  readings still ingest, but the product list stops updating. Self-clears on the next
  successful pass.
- **`transform_failed`** (CRITICAL) — raw rows arrived but the canonical transform
  failed; canonical tables fall behind. Self-clears on the next successful pass.
- **`source_columns_changed`** (WARNING) — IFL added or removed a column this app does
  not read; ingestion continues, but worth checking whether the new column matters.
- **`persistent_sync_failure`** (CRITICAL) — raised after `SYNC_FAILURE_CRITICAL_AFTER`
  (default 5) consecutive failed/halted passes; cleared by the next successful pass.
- **`sack_blackout`** (WARNING) — no sack row for `SACK_BLACKOUT_HOURS` (default 4) while
  cones are still being weighed.
- **`database_size`** (WARNING) — the data file has passed 80% of the Express 10 GB cap;
  checked once an hour.

### 10.3 Logs

Both services log one structured JSON line per event to stdout:
`{"ts","level","svc","msg",...}` with a `correlationId` (the sync pass id on the worker,
the request id — `X-Request-Id`, minted when absent, echoed back — on the API). Filter
by `level` (`warn`/`error`). `logs\sync.log` / `logs\api.log` are the plain-text
destinations under the NSSM config above; keep `AppStderr` regardless, since Node's own
crash output and anything a library prints still goes there, not through the structured
logger.

## 11. Backups, restore, and retention

### 11.1 One-time setup
`scripts/backup-appdb.ps1` defaults `-User` to `sms_backup` — never `sms_app`, which has
no operational reason to hold backup rights. Create the login first:
```sql
CREATE LOGIN sms_backup WITH PASSWORD = '<a-real-password>', CHECK_POLICY = ON;
-- in the app DB:
CREATE USER sms_backup FOR LOGIN sms_backup;
ALTER ROLE db_backupoperator ADD MEMBER sms_backup;
```

### 11.2 Running it
- **Nightly:** `scripts\install-scheduled-tasks.ps1` registers *SMS Nightly Backup* at
  02:00, run as a Windows account holding `db_backupoperator` (no SQL password appears
  in the task definition). Keeps 30 days.
- `-OutDir` must be writable by the SQL Server **service account**, not just whoever runs
  the script — `BACKUP DATABASE` executes on the server process. A path under the
  instance's own data directory is always writable by it; an arbitrary user-profile
  folder often is not.
- **Monthly:** test a restore into a scratch database — an untested backup is not a
  backup.
- **Before any canonical rebuild:** `sms rebuild` requires a point-in-time snapshot id
  and refuses without one, and (since 23 Sep 2026) requires an explicit source-generation
  scope (`--epoch=` or `--all-generations`) with no default — see `sms/DEPLOY.md`'s
  "Which CLI commands know about source generations" table for the full audit of every
  CLI command's generation-awareness.

### 11.3 Restoring
Restore into a scratch database first, never straight over the live `sms` database:
```sql
RESTORE FILELISTONLY FROM DISK = N'...bak';
RESTORE DATABASE sms_restore_test FROM DISK = N'...bak'
  WITH MOVE 'sms' TO N'<data dir>\sms_restore_test.mdf',
       MOVE 'sms_log' TO N'<data dir>\sms_restore_test_log.ldf';
```
Only once that scratch restore has proven the backup file good, restore over the live
database directly with `WITH REPLACE` (no `MOVE` needed).

### 11.4 SQL Server Express's 10 GB cap
Express caps a database's **data file** at 10 GB (log file unbounded). At the measured
rate on the real 19-day sample (~8,000 rows/day across the three event tables), this
projects to roughly **1 GB/year** — years of runway, not an urgent problem, but currently
unplanned. Check current size periodically:
```sql
EXEC sp_spaceused;
-- or:
SELECT name, size/128.0 AS size_mb, max_size FROM sys.master_files WHERE database_id = DB_ID('sms');
```
When it becomes a real concern (approaching a few GB, or a multi-line deployment
multiplying the growth rate): archive/prune old `sms_raw.*` rows first (canonical is the
layer every screen actually reads; raw exists for replay/lineage and is safer to trim),
or move off Express to a licensed SQL Server edition, which removes the cap entirely.
Neither is needed today.

### 11.5 Retention
`node cli\dist\index.js retention [--dry-run]` (the daily scheduled task runs this)
prunes only what the application grows for itself:

| Table | Rule | Setting |
|---|---|---|
| `sms.sync_run` | older than N days, always keeping the newest row per (line, table) | `RETENTION_SYNC_RUN_DAYS` (default 90) |
| `sms.dq_finding` | older than N days, **except CRITICAL** | `RETENTION_DQ_FINDING_DAYS` (default 365) |
| `sms.session` | expired rows | — |

**Never pruned:** `sms.audit_log` (append-only at the database level since migration
030) and `sms.product_change` (the record of who changed what), and **every raw and
canonical reading** — how long readings themselves are kept against the 10 GB cap is
IFL's decision, not yet made; until they answer, readings simply accumulate.

### 11.6 Database maintenance
`scripts\db-maintenance.sql`, run weekly (03:00 Sunday, by the scheduled task, or by hand
as a `db_owner` login): `DBCC CHECKDB`, fragmentation-based index
`REORGANIZE`/`REBUILD`, and `sp_updatestats`. Recovery model is SIMPLE, so the log does
not grow between backups and needs no log backups.

### 11.7 Configuration backup
`scripts\backup-config.ps1` (run monthly and after any change to `.env`, TLS, services or
scheduled tasks) copies `.env`, the TLS files it names, the NSSM service dumps, and the
scheduled task XML into an ACL-restricted folder (`.env` holds database passwords in
clear text) under `BACKUP_DIR\config\<stamp>\`. Keeps the last 10 snapshots.

### 11.8 Quick card — Restore from backup (added 29 Sep 2026)

1. Find the newest **verified** backup: `GET /api/health` → `backup.verified`
   (or check `BACKUP_DIR` by hand for a `.bak` with a matching
   `<file>.verified.json` whose `sizeBytes` still matches the `.bak`'s
   current size — an unverified `.bak` may have been renamed to
   `.unverified` and skipped).
2. `RESTORE FILELISTONLY FROM DISK = N'<file>.bak';` — read the logical file
   names first, they vary by install.
3. Restore into a **scratch** database, never straight over `sms`:
   ```sql
   RESTORE DATABASE sms_restore_test FROM DISK = N'<file>.bak'
     WITH MOVE 'sms' TO N'<data dir>\sms_restore_test.mdf',
          MOVE 'sms_log' TO N'<data dir>\sms_restore_test_log.ldf';
   ```
4. Spot-check: row counts against what you expect, `product_timeline`'s
   newest row, `sms.source_epoch` still shows the right generations.
5. Only once step 4 looks right: stop both services (`nssm stop SMS-Api`,
   `nssm stop SMS-Sync`), then restore over the live database —
   `RESTORE DATABASE sms FROM DISK = N'<file>.bak' WITH REPLACE` — start the
   services back up, and confirm `GET /api/health` reports `status: "ok"`.
6. Drop `sms_restore_test` once you're done with it.
7. **What you lose:** anything written after the backup's timestamp and
   before the restore — a product changeover, a calibration entry, a DQ
   acknowledge. Readings themselves are re-read from IFL by the worker once
   it resumes (the watermark is inside the restored database), so those
   are not lost — say this out loud to whoever asked for the restore before
   you run step 5.

### 11.9 Quick card — Backfill the 10 Jul – 5 Aug 2026 data (added 29 Sep 2026)

Full detail and the reason each step exists: `sms/DEPLOY.md`'s "Backfilling
the 10 Jul – 5 Aug 2026 gap" section. **This has been unit-tested against a
fake database only — the fixture meant to rehearse it against a real scratch
SQL Server instance has never actually been run.** Rehearse it there first.

1. Ask IFL for `db_datareader` on the archive database, for the same login
   already reading the live source.
2. `sms epoch:backfill --table=<name> --epoch=<id> --source-db=<archive-db>`
   — no `--confirm` — read the dry-run plan (max ids, overlap check, tail
   range). Repeat with `--all` to preview every table at once.
3. `sms epoch:accept ...` to register the generation if it is not already
   registered. If it refuses with a data-vintage error, and you are certain
   this genuinely is the older generation (it is, by construction, for this
   specific gap), add `--i-know-this-is-a-new-generation`.
4. Re-run step 2 with `--confirm`.
5. `sms rebuild --table=<t> --snapshot-id=<id> --epoch=<id> --confirm` —
   take a backup first (11.1 above); a rebuild needs a snapshot id and
   refuses without one.
6. `sms verify --source-db=<archive-db> --epoch=<id>` to reconcile.
7. Confirm on screen: the new date range appears in reports scoped to that
   generation, and `sms summary --epoch=<id>` prints the expected totals.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login works on the server itself but silently fails from every other PC (200 OK, back to login screen) | `COOKIE_SECURE=true` on plain HTTP | Set `COOKIE_SECURE=false` (§5.8), or put real TLS in front (§6.2) |
| Every reading looks "five hours in the future" / shift attribution or live status visibly wrong right after install | Host OS timezone does not match the plant's (freshly imaged Windows Server defaults to UTC) | Set the OS timezone to match the plant, confirm `PLANT_UTC_OFFSET_MINUTES=300` is set, restart both services, check for the startup warning clearing |
| `sms sync` proceeds normally instead of halting after repointing `.env` at the live server | The `sms epoch:accept` step was skipped, or a stale generation is still registered | Do not proceed — investigate before running `sync` again; the halt is the safety gate working, its absence means something is wrong |
| The service enters an NSSM restart loop at boot | SQL Server had not finished starting when the API/worker tried to connect | Confirm `DependOnService` names the correct SQL instance service (`sc query`); `AppRestartDelay 10000` should give it time on subsequent attempts |
| `/api/health` reports `degraded` with no clear `degradedReason` | Possible RT24-12 gap — a degrading signal not yet named in `degradedReason` | Check `acquisition.kind`, `database.pctOfCap`, and the DQ findings list directly rather than relying on `degradedReason` alone |
| A permission error appears the first time the read-only login is tested | The login is missing a specific grant (commonly `VIEW DEFINITION` or `db_datareader` on PDAS specifically) | Do not retry with a more privileged login — ask IFL's DBA for the exact missing grant named in the error, re-run Check 1 from `INSERTALLATION-FIRST-HOUR.md` §3.1 after the grant |
| A PDAS setpoint-change write fails specifically, while other PDAS writes succeed | The `sms_pdas_writer` login is missing `SELECT` on `dbo.Materials` | SQL Server requires SELECT on any column named in an UPDATE's WHERE clause, independent of the UPDATE grant itself (§4.2) — grant the five read-back SELECTs from `12_pdas_writer.template.sql` |
| `npm run db:migrate` fails partway through file `026` | The database was migrated by a pre-September runner that kept no history table, so a fresh run re-applied every file from scratch and hit an unguarded `ALTER COLUMN` | Use `node scripts/migrate.mjs --mark-applied-through=NNN` to record already-applied files without re-executing them — see `sms/DEPLOY.md`'s migration section for the exact sequence |
| A rebuild is refused, or its scope looks larger than intended | Since 23 Sep 2026, `sms rebuild` requires an explicit `--epoch=` or `--all-generations` with no default | Run `sms epoch:list` first, then scope the rebuild to the specific generation intended |

## 13. Upgrades

1. `nssm stop SMS-Sync` then `nssm stop SMS-Api` (both drain/finish in flight). Confirm
   nothing is mid-pass: `SELECT COUNT(*) FROM sms.sync_run WHERE finished_at_utc IS NULL` → 0.
2. **Back up first:** `scripts\backup-appdb.ps1` and `scripts\backup-config.ps1` — note
   the backup's path, a rollback needs it.
3. Unpack the release into a **new** folder beside the current one (do not overwrite the
   running folder — it is the rollback path); copy `.env` into it.
4. In the new folder: `npm ci` (see §2.1 for an air-gapped host), `npm run build`.
5. `npm run db:migrate` (as `sms_migrate`) — applies only files not yet recorded in
   `sms.schema_migration`.
6. Repoint the services at the new folder (`nssm set SMS-Api AppDirectory <new path>` and
   the `Application` path, same for `SMS-Sync`), start both.
7. Verify: `/api/health` reports the new `service.version` and `status: ok`; the Health
   screen's sync block goes green within two passes; `node cli\dist\index.js verify` is
   clean.

**Rolling back:** migrations are forward-only by design (no down scripts — a migration
that drops a column it added is a second way to lose data). A rollback is therefore a
**restore**: stop both services, `RESTORE DATABASE sms FROM DISK = N'<pre-upgrade .bak>'
WITH REPLACE` (after a scratch restore has proven the file), repoint the services at the
previous release folder, start them, confirm `service.version` on `/api/health` is the
old one. Readings ingested between the upgrade and the rollback are re-read from IFL by
the worker (the watermark is in the restored database); anything an operator typed in
that window (a product changeover, a calibration entry) is lost with the restore and must
be re-entered — say so before rolling back.

## 14. Sync-worker CLI commands, quick reference

| Command | Purpose |
|---|---|
| `sync` | one pass, or looped, of read → transform → write; halts on an unregistered source generation |
| `verify` | full reconciliation of every open generation against its source (count/min/max/sum of id), plus DQ findings |
| `epoch:list` | lists every registered source generation, open/closed/archived |
| `epoch:accept --all --provenance=<label> --label="<text>" [--confirm]` | registers a new source generation as the one the worker should read; required after any cutover or connection repoint |
| `epoch:purge` / `epoch:drop` | deletes raw/canonical rows for named generations; gated by `--backup=<path.bak>`, `--confirm`, no pass in flight |
| `rebuild --table=<t> --snapshot-id=<id> (--epoch=N[,M] \| --all-generations) --confirm` | re-derives canonical rows from the raw layer for the named generation(s); requires a snapshot id and an explicit generation scope, no default, since 23 Sep 2026 |
| `cutover --backup=<path.bak> --confirm` | clears raw and canonical for everything — a full reset, not a repoint |
| `summary --date=YYYY-MM-DD [--shift=] [--epoch=N[,M]]` | spot-check totals from the shell, one block per generation covering the date |
| `retention [--dry-run]` | prunes `sms.sync_run`, non-critical `sms.dq_finding`, and expired sessions per §11.5 |
| `user:create --username=<u> --password=<p> --role=<r>` | creates an account (`operator`/`supervisor`/`manager`/`admin`) |
| `user:password` | resets a user's password |

---

*Consolidated from `sms/DEPLOY.md`, `INSTALLATION-FIRST-HOUR.md`, `HANDOVER-PDAS.md`,
`HANDOVER-QA.md`, `sms/db/bootstrap/*.sql`, `sms/.env.example`, `sms/scripts/*`,
`handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md`, `PDAS-EXECUTION-2026-09-24.md`,
`sms/api/src/services/health.ts`, `sms/api/src/processGuards.ts`, and the sync-worker CLI.
Where a claim here concerns anything not yet rehearsed on a clean machine or at the
plant, it is marked `[UNVERIFIED — not yet rehearsed]`; treat every other claim as
sourced from the documents above, not independently re-verified by the writing of this
manual.*
