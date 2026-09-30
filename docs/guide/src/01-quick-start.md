# Quick start {unnumbered}

This is the fast path for someone who already has the package, SQL Server
Express, and Node installed, and just needs SMS running so it can be tested.
Chapters 3 and 4 give the full, detailed version of every step below, including
what to do if a step fails.

1. **Create the app database and its SQL logins.** Run
   `db\bootstrap\00_create_app_database.sql` against the app database server
   with `sqlcmd`, as described in {{ref:install-app-db}}.
1. **Create `.env`.** Copy `.env.example` to `.env` in the package root and
   fill in the database connection details, the read-only IFL login, and the
   other keys described in {{ref:env-keys}}.
1. **Build, migrate, and create the first admin account.** Run
   `npm ci && npm run build`, then `npm run db:migrate`, then
   `node cli/dist/index.js user:create` with `--role=admin`, as described in
   {{ref:install-build}} and {{ref:install-first-admin}}.
1. **Start the services and connect to the plant for the first time.** Start
   the API and sync-worker services (directly, or as Windows services once
   NSSM is set up — {{ref:install-services}}), then run the first `sync`,
   accept the source generation with `epoch:accept`, and confirm with
   `verify`, as described in {{ref:install-first-connection}}.
1. **Sign in.** Open the SMS web address in a browser and sign in with the
   admin account created in step 3.

## How to know it works

- `GET /api/health` returns `"status": "ok"` (or an explainable `"degraded"`
  — see {{ref:troubleshooting}}).
- The [[Health]] screen turns green — its headline reads
  [[Everything is healthy.]] — within two sync passes of the plant
  connection being live.
- `node cli/dist/index.js verify` exits with no `STOP` lines and no weight
  mismatches.

If any of these do not hold, do not consider the installation finished —
work through the relevant numbered installation step again before moving on
to daily use.
