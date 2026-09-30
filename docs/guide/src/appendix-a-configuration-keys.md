# Configuration keys {appendix #appendix-config-keys}

Every key below lives in `.env` (copied from `.env.example` — see
{{ref:install-env}}). Defaults shown are the template's own defaults, not
necessarily what a real plant should use.

| Key | Default/example | Meaning |
|---|---|---|
| `APP_DB_SERVER` | `.\SQLEXPRESS` | App database server. |
| `APP_DB_PORT` | `1433` | App database port (required, no code default). |
| `APP_DB_NAME` | `sms` | App database name. |
| `APP_DB_USER` | `sms_app` | App's own SQL login. |
| `APP_DB_PASSWORD` | — | Password for `APP_DB_USER`. |
| `APP_DB_ENCRYPT` | `true` | TLS to the app database. |
| `APP_DB_TRUST_SERVER_CERTIFICATE` | `true` | Accept a self-signed certificate on the app database. |
| `MIGRATE_DB_USER` / `MIGRATE_DB_PASSWORD` | — | The `sms_migrate` login, used only for `npm run db:migrate`, set in the invoking shell rather than `.env` for a long-running service. |
| `IFL_DB_SERVER` | `.\SQLEXPRESS` | IFL's SQL Server — the dev-vs-live switch. |
| `IFL_DB_PORT` | `1433` | IFL server port (required). |
| `IFL_DB_NAME_DATA` | `DATA_TP1U2` | The weighing-data database name. |
| `IFL_DB_NAME_PDAS` | `PDAS_TP1U2` | The product-master database name. |
| `IFL_DB_USER` | `sms_readonly` | Read-only login into IFL's databases. |
| `IFL_DB_PASSWORD` | — | Password for `IFL_DB_USER`. |
| `IFL_DB_ENCRYPT` | `true` | TLS to IFL's server. |
| `IFL_DB_TRUST_SERVER_CERTIFICATE` | `true` | Accept a self-signed certificate on IFL's server. |
| `PDAS_WRITE_ENABLED` | `false` | Master switch for the PDAS write path — see {{ref:pdas-writes}}. |
| `PDAS_WRITE_SERVER` / `PORT` / `DATABASE` / `USER` / `PASSWORD` | — | The separate `sms_pdas_writer` connection, used only when `PDAS_WRITE_ENABLED=true`. |
| `PDAS_LIMIT_MAX_SETPOINT_CHANGE_PCT` | `3` | Largest percent a product's target may move in one limits edit before it counts as a large change (tick-box plus a reason of 20+ characters). The developer's default, not IFL's. |
| `PDAS_LIMIT_MAX_OFFSET_CHANGE_G` | `20` | Largest change in grams to either weight limit in one edit before it counts as a large change. The developer's default, not IFL's. |
| `PDAS_WRITE_ENCRYPT` / `PDAS_WRITE_TRUST_SERVER_CERTIFICATE` | `true` | TLS on the PDAS writer connection. |
| `SYNC_INTERVAL_SECONDS` | `60` | How often the sync worker runs a pass (minimum 5). |
| `SYNC_OVERLAP_ROWS` | `500` | Watermark overlap window, in rows (minimum 0). |
| `LINE_ID` | `1` | Which line this process serves — immutable once data has been ingested. |
| `SYNC_ONCE` | — | Dev/CI single-pass mode. |
| `SYNC_FAILURE_CRITICAL_AFTER` | `5` | Consecutive failed passes before a CRITICAL finding is raised. |
| `SACK_BLACKOUT_HOURS` | `4` | Hours without a new sack row before a WARNING is raised. |
| `PASSWORD_MIN_LENGTH` | `10` | Shortest accepted account password (valid range 6–128). |
| `BACKUP_DIR` | `C:\sms-backups` | Where [[Health]] looks for the newest `.bak` file — must match the backup scripts' own output folder. |
| `RETENTION_SYNC_RUN_DAYS` | `90` | Days of sync-run history kept (newest row per line/table always kept regardless). |
| `RETENTION_DQ_FINDING_DAYS` | `365` | Days of non-CRITICAL data-quality finding history kept. |
| `SIM_DB_NAME` / `SIM_DB_USER` / `SIM_DB_PASSWORD` | — | Dev-only: the plant simulator's target database and login. Not used on a real installation. |
| `API_PORT` | `4000` | HTTP port the API listens on. |
| `CACHE_TTL_SECONDS` | `5` | In-memory response cache time-to-live. |
| `LINE_NAME` | `TP1 · Line 3 · Unit 2` | Seed-only fallback display name for the line, used only until a line record exists. |
| `LIVE_ALLOW_AS_OF` | `false` | Allows a replay/demo parameter to move the plant clock — must stay `false` in production. |
| `LIVE_ALLOW_SIMULATOR` | `false` (commented out) | Development PC only; never set at IFL. Lets live screens follow the plant simulator. Ignored unless the database name ends in `_SIM` and the server is local. |
| `PLANT_UTC_OFFSET_MINUTES` | `300` | The plant's declared UTC offset in minutes (UTC+5 = 300) — see {{ref:two-clocks}}. |
| `TRUST_PROXY` | `false` | Whether to trust `X-Forwarded-For` from a reverse proxy in front of SMS. |
| `COOKIE_SECURE` | `true` | Secure flag on the session cookie — must be `false` on a plain-HTTP LAN. |
| `TLS_PFX_PATH` / `TLS_PFX_PASSPHRASE` | — | Direct TLS termination, PFX form. |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | — | Direct TLS termination, certificate/key file form. |
| `WEB_DIST` | `./web/dist` | When set, the API also serves the built web app from this path — the normal production setup. |
| `WEIGHT_BASIS` | `as_recorded` | Cone/sack weight interpretation (`as_recorded`, `gross` or `net`) — not fully confirmed by IFL; see Appendix C, item 12. |
| `CONE_TUBE_WEIGHT_G` | `70` | Tube tare weight, used only under the `net` basis — a developer placeholder, not IFL-confirmed. |
| `SACK_TARE_KG` | `0.5` | Sack tare weight, used only under the `net` basis. |
| `SHIFT_MODE` | `corrected` | Shift-boundary basis (`corrected` or `legacy`) — see Appendix C, item 12. |
| `SHIFT_NIGHT_BELONGS_TO` | `start_day` | Night-shift attribution rule (`start_day` or `calendar_day`). |
| `PLC_READER_ENABLED`, `PLC_HOST`, `PLC_RACK`, `PLC_SLOT`, `PLC_CONE_ID_DB` | `false` / placeholders | The still-deferred direct PLC reader — see Appendix C, item 1. None of these keys is read by any current code path; they exist only as a documented, dependency-free re-entry point. |
| `PDF_EDGE_PATH` | — | Explicit path to `msedge.exe`, if PDF export cannot find Edge at its default install location. |

Five further keys tune connection-pool and request-timeout behaviour with
safe built-in defaults and are not in `.env.example`: `API_DB_POOL_MAX`
(10), `API_DB_POOL_MIN` (1), `API_DB_POOL_IDLE_TIMEOUT_MS` (30000),
`API_DB_REQUEST_TIMEOUT_MS` (30000), and `PDAS_MIRROR_REFRESH_SECONDS`
(600, minimum 5) — leave these unset unless a specific performance problem
calls for tuning them.

There is no `SESSION_SECRET` key: sessions are server-side random
identifiers, not signed tokens, so there is nothing for such a key to sign.
