# What IFL IT must provide {#it-must-provide}

Before installation begins (Chapter 4), IFL's IT department needs to have
the following ready. Each item is referenced again from the installation
steps that need it.

- **Server hardware.** A PC or server on the plant network with enough disk
  space for SQL Server Express and the app database, running Windows, set
  to the plant's own local time zone (UTC+5, the same offset the app itself
  is told about via `PLANT_UTC_OFFSET_MINUTES` — see {{ref:env-keys}}).
- **SQL Server Express.** Free, and already used elsewhere at the plant. It
  caps a single database file at 10 GB — see Appendix C, item 10, for what
  this means in practice.
- **Node.js**, the version pinned in the package's `.nvmrc` file. The API,
  sync worker and CLI all run on Node; `npm ci && npm run build`
  ({{ref:install-build}}) needs it.
- **Microsoft Edge**, for PDF report export. The API launches Edge headless
  to render a report to PDF; `PDF_EDGE_PATH` can point at a non-default
  install location (see {{ref:env-keys}}).
- **NSSM** (the Non-Sucking Service Manager), to run the API and sync worker
  as Windows services that restart on crash and start with the machine.
  NSSM is third-party software and is not part of the SMS package — IT must
  download and provide it themselves.
- **Network access**: a static IP or a resolvable name for the server, and
  the API's port (`API_PORT`, 4000 by default) open in the Windows Firewall
  for anyone who will browse to SMS.
- **A read-only SQL login into IFL's own databases**, with `db_datareader`
  on both `DATA_TP1U2` and `PDAS_TP1U2`, and nothing more — SMS never
  writes to `DATA_TP1U2`, and writes to `PDAS_TP1U2` only through the
  separate, off-by-default path described in {{ref:pdas-writes}}. See
  {{ref:install-ifl-login}}.
- **A Windows account** to run the scheduled backup, maintenance and
  retention tasks (`RunAs` in {{ref:install-scheduled-tasks}}) — it needs
  `db_backupoperator` on the app database.
- **A backup folder** the SQL Server service account can write to and the
  API can read from, for example `C:\sms-backups` — [[Health]] reports the
  age of the newest backup file it finds there.
- **A wall-display PC** (optional), if IFL wants a fullscreen, no-navigation
  board — any PC with a browser pointed at `/?s=wall` will do; see
  {{ref:install-wall-pc}}.
- **A decision on who will be the first administrator**, so their account
  can be created in {{ref:install-first-admin}} and they can create manager
  and engineer accounts for everyone else from [[Setup]].
