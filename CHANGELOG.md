# Changelog — IFL Sack Management System

Every workspace under `sms/` carries the same version (`sms/package.json` and
the five workspace manifests), and the API reports it at `GET /api/health`
(`service.version`) and on the Health screen, so "which release is on the
plant PC" is answered by the running service rather than by a folder name.
Phase numbers follow `IFL_SMS_Claude_Code_Development_Roadmap.md`; the
evidence for each line is in `PROJECT_STATUS.md` and `ROADMAP-GAP-ANALYSIS.md`.

## 0.2.0 — unreleased (roadmap Phases 1–3 complete; Phases 4, 5 and 11 in this wave)

### Phase 11 — security, reliability and operations (14 Sep 2026)
- **Passwords.** `POST /api/auth/password` (any account: verifies the current
  password, refuses reuse, revokes every other session of the account),
  `POST /api/admin/users/:id/password` (admin reset of another account, all its
  sessions revoked, refused for the actor's own id), `sms user:password`. One
  length policy, `PASSWORD_MIN_LENGTH` (default 10), shared by all four paths
  and by account creation, replacing the literal 6 and the CLI's "anything".
  Change password from the account menu; Reset from Setup › People.
- **Last-admin guard** on `PATCH /api/admin/users/:id` (409), inside the
  transaction, so the last active administrator cannot be deactivated or
  demoted from any client.
- **Audit events:** `auth.login`, `auth.login_failed` (username only, no
  actor), `auth.logout`, `export.csv`; CLI writes (`user.create`,
  `user.password_reset`, `retention.run`, `cutover.run`, `epoch.purge`) with
  no actor and the command named. The audit viewer is keyset paged
  (`?before=&limit=`, "Show older").
- **`GET /api/health`** separates service (version, uptime, pid), database
  (reachability, latency, data-file size against the 10 GB Express cap) and
  acquisition (the live health kind, age, cadence, halted tables); status
  `ok | degraded | down` (503 when down, never a 500). Unauthenticated for a
  monitor; size and acquisition details are nulled unless signed in.
- **Health screen** (`?s=health`), open to every signed-in account: the sync
  block Setup shows (one component, `screens/health/SyncHealthBlock.tsx`),
  database size with a plain sentence past 80 %, service version and uptime,
  newest backup age from `BACKUP_DIR` with a warning past two days. The top
  bar's data-age sentence links here for everyone.
- **Recovery.** `pool.on('error')` in both processes (the API marks itself
  degraded; the worker logs and reconnects on the next tick); SIGTERM/SIGINT
  graceful shutdown in both; the worker reconciles `sync_run` rows a crash
  left `running`; `persistent_sync_failure` CRITICAL after
  `SYNC_FAILURE_CRITICAL_AFTER` (default 5) consecutive failed passes,
  cleared on the next success; `database_size` WARNING checked hourly.
- **`sms cutover` and `sms epoch:purge`** require `--backup=<existing .bak>`,
  refuse while a pass is in flight, and delete under the transform lock.
- **`sms retention [--dry-run]`:** prunes `sync_run` (> `RETENTION_SYNC_RUN_DAYS`,
  newest row per table kept), non-critical `dq_finding`
  (> `RETENTION_DQ_FINDING_DAYS`), expired sessions. Never `audit_log`,
  `product_change`, raw or canonical readings (IFL's decision; the command
  says so).
- **Migration 030:** `sms.audit_log` append-only by trigger (the header says
  what that does and does not guarantee while `sms_app` holds
  `db_ddladmin`); index on `sms.session(expires_at_utc)`.
- **Scripts:** `db-maintenance.sql` (CHECKDB, index maintenance by
  fragmentation, statistics), `install-scheduled-tasks.ps1` (nightly backup
  as a Windows account — no password in any task; weekly maintenance; daily
  retention; `-WhatIf`), `backup-config.ps1` (`.env`, TLS files, NSSM dumps,
  task XML into `BACKUP_DIR\config\<stamp>` with a restricted ACL);
  `backup-appdb.ps1` gains a trusted-connection mode (`-User ""`). All
  three `.ps1` files carry a UTF-8 BOM: Windows PowerShell 5.1 (`powershell
  -File`, as DEPLOY.md instructs) reads a BOM-less file as ANSI, and the
  em-dashes in the committed backup script then contained a `”` byte that
  terminated a string — the script did not parse under 5.1 at all.
- **DEPLOY.md:** Upgrading and rolling back, Retention, Database maintenance,
  Configuration backup, Health; the credentials table notes the migration
  login split real tamper-evidence needs.
- Limiter and cache are bounded in fact (pruned on check / swept on set).

### Phases 1–3 (14 Sep 2026, commits `45b678b`, `571fabc`)
- Phase 1: the installation is rows, not source — plant / unit / line /
  machine / station / data source / source table (migration 028), shift
  boundaries as the versioned rule, Setup sections for each, every write
  audited in the same transaction.
- Phase 2: `SourceAdapter` registry, error classification with retry for
  transient failures only, per-table halt isolation, a source probe per
  pass, full column list per generation, one JSON log line per event with a
  correlation id.
- Phase 3: migration 029 + `TRANSFORM_VERSION = 2` — every canonical row
  carries source system, table, row id, insert time, production time, SMS
  ingestion time, sync pass, transform version, attribution; data dictionary
  generated by `npm run dictionary`.

## 0.1.0 — baseline (tag `v0.1.0-baseline`, commit `a585302`, 14 Sep 2026)
The September 2026 working tree frozen as roadmap Phase 0: sync worker
(IFL → raw → canonical, source generations, versioned product limits), CLI,
Express API with session auth and RBAC, the seven-screen React app, 27
migrations, the PDAS write path built and off. `BASELINE.md` is the record.
