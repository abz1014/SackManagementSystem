# CONFIG-KEYS.md — every environment key, default, and meaning

Source of the template: `sms/.env.example`. Source of the code reads: `grep -rn` over
`sms/api/src`, `sms/sync-worker/src`, `sms/cli/src`, `sms/shared/src` for `env.`, `intEnv(`,
and `process.env`, plus a targeted check of `sms/scripts/simulate-plant.mjs` and
`sms/scripts/migrate.mjs` for the dev-only keys those scripts read outside the four grepped
trees.

## 1. Every key in `sms/.env.example`, in file order

| Key | Example/default in file | Meaning |
|---|---|---|
| `APP_DB_SERVER` | `.\SQLEXPRESS` | App database server. |
| `APP_DB_PORT` | `1433` | App database port (no code default — required). |
| `APP_DB_NAME` | `sms` | App database name. |
| `APP_DB_USER` | `sms_app` | App's own SQL login. |
| `APP_DB_PASSWORD` | `__set_me__` | Password for `APP_DB_USER`. |
| `APP_DB_ENCRYPT` | `true` | TLS to the app database. |
| `APP_DB_TRUST_SERVER_CERTIFICATE` | `true` | Accept a self-signed cert on the app database. |
| `MIGRATE_DB_USER` | (commented out) `sms_migrate` | Login used only by `db:migrate`, set in the invoking shell, never loaded by a long-running service. |
| `MIGRATE_DB_PASSWORD` | (commented out) `__set_me__` | Password for the migration login. |
| `IFL_DB_SERVER` | `.\SQLEXPRESS` | IFL's SQL Server — the dev-vs-live switch. |
| `IFL_DB_PORT` | `1433` | IFL server port (required, no default). |
| `IFL_DB_NAME_DATA` | `DATA_TP1U2` | The weighing-data database name. |
| `IFL_DB_NAME_PDAS` | `PDAS_TP1U2` | The product-master database name. |
| `IFL_DB_USER` | `sms_readonly` | Read-only login into IFL's databases. |
| `IFL_DB_PASSWORD` | `__set_me__` | Password for `IFL_DB_USER`. |
| `IFL_DB_ENCRYPT` | `true` | TLS to IFL's server. |
| `IFL_DB_TRUST_SERVER_CERTIFICATE` | `true` | Accept a self-signed cert on IFL's server. |
| `PDAS_WRITE_ENABLED` | `false` | Master switch for the nine PDAS write rights — off by default. |
| `PDAS_WRITE_SERVER` | `localhost` | PDAS writer connection host (prefer a plain host+port over a named instance). |
| `PDAS_WRITE_PORT` | `14330` | PDAS writer connection port. |
| `PDAS_WRITE_DATABASE` | `PDAS_TP1U2` | PDAS database the writer connects to. |
| `PDAS_WRITE_USER` | `sms_pdas_writer` | Separate writer login, distinct from the read-only login. |
| `PDAS_WRITE_PASSWORD` | `__set_me__` | Password for `PDAS_WRITE_USER`. |
| `PDAS_WRITE_ENCRYPT` | `true` | TLS on the PDAS writer connection. |
| `PDAS_WRITE_TRUST_SERVER_CERTIFICATE` | `true` | Accept a self-signed cert on the PDAS writer connection. |
| `PDAS_LIMIT_MAX_SETPOINT_CHANGE_PCT` | `3` | Largest percent a product's target weight may move in one limits edit before it counts as a "large change" (needs a tick-box and a reason of 20+ characters). The 3 is the developer's own choice, not IFL's. |
| `PDAS_LIMIT_MAX_OFFSET_CHANGE_G` | `20` | Largest change in grams to either weight limit in one edit before it counts as a "large change". Developer default, not IFL's. |
| `SYNC_INTERVAL_SECONDS` | `60` | How often the worker runs a pass (minimum 5). |
| `SYNC_OVERLAP_ROWS` | `500` | Watermark overlap window, in rows (minimum 0). |
| `LINE_ID` | `1` | Which line this process serves (minimum 1; immutable once data is ingested). |
| `SYNC_ONCE` | (commented out) `true` | Dev/CI single-pass mode. |
| `SYNC_FAILURE_CRITICAL_AFTER` | `5` | Consecutive failed passes before a CRITICAL finding is raised (minimum 1). |
| `SACK_BLACKOUT_HOURS` | `4` | Hours without a new sack row before a WARNING is raised (minimum 1). |
| `PASSWORD_MIN_LENGTH` | `10` | Shortest accepted account password (valid range 6–128). |
| `BACKUP_DIR` | `C:\sms-backups` | Where Health looks for the newest `.bak` file (must match the backup scripts' own `-OutDir`/`-BackupDir`). |
| `RETENTION_SYNC_RUN_DAYS` | `90` | Days of `sms.sync_run` history kept by `retention` (newest row per line/table is always kept regardless). |
| `RETENTION_DQ_FINDING_DAYS` | `365` | Days of non-CRITICAL `sms.dq_finding` history kept by `retention`. |
| `SIM_DB_NAME` | (commented out) `DATA_TP1U2_SIM` | Dev-only: the plant simulator's target database (must end `_SIM`). |
| `SIM_DB_USER` | (commented out) `sms_sim` | Dev-only: the simulator's writer login. |
| `SIM_DB_PASSWORD` | (commented out) `__set_me__` | Dev-only: password for `SIM_DB_USER`. |
| `API_PORT` | `4000` | HTTP port the API listens on. |
| `CACHE_TTL_SECONDS` | `5` | In-memory response cache time-to-live. |
| `LINE_NAME` | `TP1 · Line 3 · Unit 2` | Seed-only fallback display name for the line (used only until a `sms.line` row exists). |
| `LIVE_ALLOW_AS_OF` | `false` | Allows the `?at=` replay/demo parameter to move the plant clock — **must stay `false` in production**. |
| `LIVE_ALLOW_SIMULATOR` | (commented out) `false` | **Development PC only; never set at IFL.** Lets the live screens follow the plant simulator's newer readings. The API ignores it unless the source database name ends `_SIM` and the server is local. |
| `PLANT_UTC_OFFSET_MINUTES` | `300` | The plant's declared UTC offset in minutes (UTC+5 = 300), used for the two-clocks cross-check. |
| `TRUST_PROXY` | `false` | Whether to trust `X-Forwarded-For`. |
| `COOKIE_SECURE` | `true` | Secure flag on the session cookie — **must be `false` on a plain-HTTP LAN**, e.g. the demo. |
| `TLS_PFX_PATH` | (commented out) `C:\sms\certs\sms.pfx` | Direct TLS termination, PFX form. |
| `TLS_PFX_PASSPHRASE` | (commented out) `__set_me__` | Passphrase for the PFX file. |
| `TLS_CERT_PATH` | (commented out) `C:\sms\certs\sms.crt` | Direct TLS termination, cert file. |
| `TLS_KEY_PATH` | (commented out) `C:\sms\certs\sms.key` | Direct TLS termination, key file. |
| `WEB_DIST` | (commented out) `./web/dist` | When set, the API also serves the built React app from this path — the production single-process setup. |
| `WEIGHT_BASIS` | `as_recorded` | Cone/sack weight interpretation (`as_recorded`\|`gross`\|`net`) — IFL's Q4/Q5, only partly confirmed (see `LIMITATIONS.md` item 12). |
| `CONE_TUBE_WEIGHT_G` | `70` | Tube tare weight used only under `net` basis (developer placeholder, not IFL-confirmed). |
| `SACK_TARE_KG` | `0.5` | Sack tare weight used only under `net` basis. |
| `SHIFT_MODE` | `corrected` | Shift-boundary basis (`corrected`\|`legacy`) — IFL's Q7. |
| `SHIFT_NIGHT_BELONGS_TO` | `start_day` | Night-shift attribution rule (`start_day`\|`calendar_day`). |
| `PLC_READER_ENABLED` | `false` | Component B (direct PLC reader) — disabled; no PLC dependency exists in any package manifest. |
| `PLC_HOST` | `10.1.1.11` | Placeholder PLC host — never read by any code path (confirmed below). |
| `PLC_RACK` | `0` | Placeholder PLC rack — never read by any code path. |
| `PLC_SLOT` | `1` | Placeholder PLC slot — never read by any code path. |
| `PLC_CONE_ID_DB` | `DB7.DBD10` | Placeholder PLC data-block address — never read by any code path. |

There is no `SESSION_SECRET` key — sessions are server-side random UUIDs
(`sms/.env.example:191` area, noted explicitly in the file).

## 2. Every key actually read in code, with default and first read site

| Key | Default (code) | Meaning | First read site |
|---|---|---|---|
| `WEB_DIST` | `join(process.cwd(),'web','dist')` | static build dir the API serves | `sms/api/src/app.ts:2083` |
| `COOKIE_SECURE` | `true` unless exactly `'false'` | Secure flag on session cookie | `sms/api/src/auth.ts:95` |
| `API_PORT` | 4000 | HTTP port | `sms/api/src/config.ts:90` (schema), `:372` |
| `LINE_ID` | 1 | which line this process serves | `sms/api/src/config.ts:91,372`; `sms/sync-worker/src/config.ts:159`; `sms/shared/src/config/appConfig.ts:19,40` |
| `CACHE_TTL_SECONDS` | 5 | in-memory cache TTL | `sms/api/src/config.ts:92,373` |
| `LINE_NAME` | `TP1 · Line 3 · Unit 2` | seed-only fallback line name | `sms/api/src/config.ts:101,374` |
| `LIVE_ALLOW_AS_OF` | `false` | allow `?at=` replay | `sms/api/src/config.ts:109-112,375` |
| `TRUST_PROXY` | `false` | trust `X-Forwarded-For` | `sms/api/src/config.ts:127-130,376` |
| `TLS_CERT_PATH`/`TLS_KEY_PATH`/`TLS_PFX_PATH`/`TLS_PFX_PASSPHRASE` | unset (optional) | direct TLS termination | `sms/api/src/config.ts:141-144,377-380` |
| `PLANT_UTC_OFFSET_MINUTES` | unset/optional | plant's declared UTC offset for the two-clocks cross-check | `sms/api/src/config.ts:153,381`; `sms/sync-worker/src/config.ts:168` |
| `PASSWORD_MIN_LENGTH` | 10 (range 6–128) | shortest accepted password | `sms/api/src/config.ts:162,382`; `sms/cli/src/commands/user.ts:29-34` (own copy, same default) |
| `BACKUP_DIR` | `C:\sms-backups` | where Health looks for `.bak` files | `sms/api/src/config.ts:168,383` |
| `API_DB_POOL_MAX` | 10 | API's own SQL pool ceiling | `sms/api/src/config.ts:174,384` |
| `API_DB_POOL_MIN` | 1 | API's own SQL pool floor | `sms/api/src/config.ts:175,385` |
| `API_DB_POOL_IDLE_TIMEOUT_MS` | 30000 | pool idle timeout | `sms/api/src/config.ts:176,386` |
| `API_DB_REQUEST_TIMEOUT_MS` | 30000 | per-request SQL timeout | `sms/api/src/config.ts:177,387` |
| `APP_DB_SERVER`/`PORT`/`NAME`/`USER`/`PASSWORD`/`ENCRYPT`/`TRUST_SERVER_CERTIFICATE` | required, no default | app DB connection | `sms/api/src/config.ts:389-395`; `sms/sync-worker/src/config.ts:141-147` |
| `PDAS_WRITE_ENABLED` | `false` | on/off for the PDAS write path | `sms/api/src/config.ts:213-216,397` |
| `PDAS_WRITE_SERVER`/`PORT`/`DATABASE`/`USER`/`PASSWORD` | all optional | PDAS writer connection | `sms/api/src/config.ts:217-227,399-403` |
| `PDAS_LIMIT_MAX_SETPOINT_CHANGE_PCT` | 3 | large-change guard, percent | `sms/api/src/config.ts:248,534` |
| `PDAS_LIMIT_MAX_OFFSET_CHANGE_G` | 20 | large-change guard, grams | `sms/api/src/config.ts:249,535` |
| `LIVE_ALLOW_SIMULATOR` | `false` (dev only) | live screens follow the simulator; refused unless database ends `_SIM` and server is local | `sms/api/src/config.ts:455-511` |
| `PDAS_WRITE_ENCRYPT` | `true` | | `sms/api/src/config.ts:224,404` |
| `PDAS_WRITE_TRUST_SERVER_CERTIFICATE` | `true` | | `sms/api/src/config.ts:225,405` |
| `IFL_DB_NAME_PDAS` | unset/optional in API's schema (compared, never connected) | cross-check against sync-worker's PDAS db name | `sms/api/src/config.ts:235,409`; `sms/sync-worker/src/config.ts:172` (default there `PDAS_TP1U2`) |
| `IFL_DB_USER` | unset/optional in API's schema (compared only) | cross-check that PDAS writer login ≠ read-only login | `sms/api/src/config.ts:236,410`; `sms/sync-worker/src/config.ts:153` |
| `PDF_EDGE_PATH` | unset | explicit override path to `msedge.exe` for PDF export | `sms/api/src/services/reports/edge.ts:66` |
| `IFL_DB_SERVER`/`PORT`/`NAME_DATA`/`USER`/`PASSWORD`/`ENCRYPT`/`TRUST_SERVER_CERTIFICATE` | required, no default | sync-worker's read-only IFL connection | `sms/sync-worker/src/config.ts:149-157` |
| `PDAS_MIRROR_REFRESH_SECONDS` | 600 (min 5) | how often the product mirror re-pulls PDAS | `sms/sync-worker/src/config.ts:169` |
| `SYNC_ONCE` | boolean via `=== 'true'` | single-pass mode | `sms/sync-worker/src/index.ts:154` |
| `SYNC_OVERLAP_ROWS` | 500 (min 0) | watermark overlap window | `sms/sync-worker/src/config.ts:160` |
| `SYNC_INTERVAL_SECONDS` | 60 (min 5) | pass cadence | `sms/sync-worker/src/config.ts:161` |
| `SYNC_FAILURE_CRITICAL_AFTER` | 5 (min 1) | consecutive-failure threshold for CRITICAL finding | `sms/sync-worker/src/config.ts:162` |
| `SACK_BLACKOUT_HOURS` | 4 (min 1) | hours without a sack row before WARNING | `sms/sync-worker/src/config.ts:163` |
| `WEIGHT_BASIS` | `as_recorded` | Q4/Q5 weight interpretation | `sms/shared/src/config/appConfig.ts:23,42` |
| `CONE_TUBE_WEIGHT_G` | 70 | tare for net cone weight | `sms/shared/src/config/appConfig.ts:24,43` |
| `SACK_TARE_KG` | 0.5 | tare for net sack weight | `sms/shared/src/config/appConfig.ts:25,44` |
| `SHIFT_MODE` | `corrected` | Q7 shift basis | `sms/shared/src/config/appConfig.ts:30,47` |
| `SHIFT_NIGHT_BELONGS_TO` | `start_day` | night-shift attribution rule | `sms/shared/src/config/appConfig.ts:31,48` |
| `SIM_DB_NAME` | `DATA_TP1U2_SIM` | simulator's target db name | `sms/scripts/simulate-plant.mjs:75` |
| `SIM_DB_USER` | `sms_sim` | simulator writer login | `sms/scripts/simulate-plant.mjs:116` |
| `SIM_DB_PASSWORD` | required, no default | simulator writer password | `sms/scripts/simulate-plant.mjs:118` |

Every key is read once per process at startup except `PASSWORD_MIN_LENGTH` (independently read
by both the API and the CLI, same default/logic) and `PLANT_UTC_OFFSET_MINUTES` (independently
read by both the API and the sync-worker, by design — each process cross-checks its own OS
timezone).

## 3. Cross-check: template vs. code

**Read in code but missing from `.env.example`** (no code default gap — all six are optional
tuning knobs with safe defaults, simply undocumented in the template):
`API_DB_POOL_MAX`, `API_DB_POOL_MIN`, `API_DB_POOL_IDLE_TIMEOUT_MS`,
`API_DB_REQUEST_TIMEOUT_MS`, `PDF_EDGE_PATH`, `PDAS_MIRROR_REFRESH_SECONDS`.

**In `.env.example` but not read by `api/src`, `sync-worker/src`, `cli/src`, `shared/src`
directly** (consumed elsewhere, or genuinely unused):
- `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` — read by `sms/scripts/migrate.mjs`, deliberately
  outside the four service trees (set only in the invoking shell, never loaded by a
  long-running service).
- `SIM_DB_NAME`/`SIM_DB_USER`/`SIM_DB_PASSWORD` — read by `sms/scripts/simulate-plant.mjs`
  (dev-only).
- `PLC_READER_ENABLED`/`PLC_HOST`/`PLC_RACK`/`PLC_SLOT`/`PLC_CONE_ID_DB` — **confirmed not read
  anywhere in the codebase.** This matches the project's own documented position: a
  dependency-free re-entry point for the still-deferred Component B (direct PLC reader), not a
  working feature. See `LIMITATIONS.md` item 1.
