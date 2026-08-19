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
2. **Get from IFL:** a dedicated **read-only** SQL login (not `sa`, not the vendor app account) with `db_datareader` on `DATA_TP1U2` and `PDAS_TP1U2`, and the server\instance + port. Enable TCP on the plant SQL Server if needed.
3. **Create the app DB + its login** (`sms_app`, read/write on the `sms` database only).
4. **Configure** `.env` from `.env.example`:
   - `IFL_DB_*` → the plant server + the read-only login. **This is the only dev→live change.**
   - `APP_DB_*` → the local app DB + `sms_app` (a **strong, unique** password — never the dev password).
   - `SESSION_SECRET` → a long random string.
   - `WEB_DIST=./web/dist`.
   - **`COOKIE_SECURE=false`** — required for a plain-HTTP intranet. See below.

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
7. **Create the first admin:** `node cli/dist/index.js user:create --username=admin --password=<strong> --role=admin`.
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

By design this is **one connection string**. Nothing in `api/` or `web/` changes.

1. Take a backup/snapshot of the app DB (see below).
2. Stop `SMS-Sync`.
3. Edit `.env`: point `IFL_DB_SERVER` / `IFL_DB_PORT` / `IFL_DB_USER` / `IFL_DB_PASSWORD` at the **live** plant DB.
4. Start `SMS-Sync`. First pass backfills from the live DB into the app DB; watch `logs\sync.log`.
5. `node cli/dist/index.js verify` — reconcile source ⇄ raw ⇄ canonical.

The **schema-fingerprint gate** halts sync with a clear error if the live schema differs from our snapshot — investigate before forcing.

---

## Backup & restore

The app DB is the only irreplaceable data (product timeline, reject labels, users, config, rules).

### One-time setup: a login the script can actually use

`scripts/backup-appdb.ps1` defaults to `sms_app` (the app's own runtime
login), but that login should **not** be given backup rights — it has no
operational reason to ever take a backup of itself, and least-privilege means
not handing it permissions it will never use. Create a dedicated login instead:

```sql
CREATE LOGIN sms_backup WITH PASSWORD = '<a-real-password>', CHECK_POLICY = ON;
-- in the app DB:
CREATE USER sms_backup FOR LOGIN sms_backup;
ALTER ROLE db_backupoperator ADD MEMBER sms_backup;
```

Pass it explicitly: `-User sms_backup -Pass <that password>`.

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

---

## Operations & monitoring

- **`GET /api/operations`** (Operations screen) — last sync per table, watermark, schema-fingerprint status, transform version, source age, DQ roll-up by severity. First place to look if a dashboard reads low/zero: check `sourceAgeSeconds` — climbing age = sync stalled.
- **`node cli/dist/index.js verify`** — full reconciliation + DQ findings.
- **`node cli/dist/index.js summary --date=YYYY-MM-DD`** — spot-check totals from the shell.
- **Logs** — structured JSON lines in `logs\sync.log` / `logs\api.log`.

### Performance targets (guardrails)
Dashboard < 300 ms · API < 100 ms · sync pass < 30 s. At the current data volume we are well under; re-check after a few months of accumulation and add indexes on `sms.*` if needed (never on IFL's DB).

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
