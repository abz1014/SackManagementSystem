# PACKAGE.md — what "the package" means

Per `sms/DEPLOY.md:636-641`, "a release is the `sms/` tree at a version." This guide uses:

**Package = `git ls-files sms/` at the release commit, plus the build outputs each workspace
produces on the host (`npm ci && npm run build`), plus this guide.**

Current version, read from `sms/package.json:3`: **0.2.0**.

## Build outputs

Each workspace's `build` script is `tsc -b` (compiles TypeScript to its own `dist/`), except
`web`, which also runs Vite:

| Workspace | Build script | `outDir` | Confirmed at |
|---|---|---|---|
| `api` | `tsc -b` | `dist/` | `sms/api/package.json:8`, `sms/api/tsconfig.json:5` |
| `sync-worker` | `tsc -b` | `dist/` | `sms/sync-worker/package.json:13`, `sms/sync-worker/tsconfig.json:5` |
| `cli` | `tsc -b` | `dist/` | `sms/cli/package.json:9`, `sms/cli/tsconfig.json:5` |
| `web` | `tsc -b && vite build` | `dist/` (Vite default; includes `dist/fonts/` for the self-hosted Instrument Sans variable font) | `sms/web/package.json:9` |

So the four build-output directories the plan named are confirmed correct:
`api/dist/`, `sync-worker/dist/`, `cli/dist/`, `web/dist/` (with `web/dist/fonts/`).

## Manifest

The full tracked file list is saved verbatim at `docs/guide/facts/package-manifest.txt`
(`git ls-files sms/` from the repo root) — **617 files** (refreshed 30 Sep 2026).

## Top-level folders under `sms/` and what each is for

| Folder | What it is for |
|---|---|
| `shared/` | TypeScript domain types and swappable-unknowns config, imported by every other workspace. |
| `db/` | App-database schema: `db/migrations/` (numbered `.sql` migrations, currently 001–042, with 031/032 absent) and `db/bootstrap/` (creates the app database and its SQL logins before the first migration runs). |
| `sync-worker/` | The only process that talks to IFL's SQL Server — read-only, source→raw→canonical transform, continuous self-healing loop, epoch/generation handling. |
| `cli/` | `node cli/dist/index.js <cmd>` — sync, verify, summary, rebuild, cutover, retention, user:create, user:password, epoch:list/accept/purge/drop/backfill. See `COMMANDS.md`. |
| `api/` | Express REST API — auth, RBAC, `/api/*` routes, and serves the built web app when `WEB_DIST` is set. |
| `web/` | The React front end — seven screens (Line, Readings, Weight, Rejects, Sacks, Product, Report) open to every signed-in account, plus Wall and admin-only Setup. |
| `layout-tests/` | The Playwright/browser layout-test harness (added 24 Sep 2026) — real-browser print/layout verification (run with `npm run test:layout`), separate from the Vitest unit/integration suite. |
| `scripts/` | Operational PowerShell/Node scripts: backups, the plant simulator (`simulate-plant.mjs` + its schema/copy-history SQL), database maintenance, migration runner. |
| `ops/` | Present in the tree; not otherwise documented in `sms/README.md` — treat its contents on their own terms if the guide needs to cite anything from it. |
| `test/` | Cross-workspace test support/fixtures, distinct from each workspace's own `*.test.ts` files. |
| `db/`, `logs/`, `node_modules/` | `logs/` and `node_modules/` exist in the working tree but are **excluded** from the package (see below); `sms/logs/` currently exists on this host with runtime log files in it — confirmed present, contents not read (out of scope, and not committed — not in `package-manifest.txt`). |

Root-level `.md` files directly under `sms/` (`DEPLOY.md`, `README.md`, and several dated
audit/report files such as `AUDIT-FINDINGS.md`, `WS-PW-REPORT.md`, `PERFORMANCE-*.md`,
`BASELINE-RUN-2026-09-14.txt`) ARE tracked by git and so ARE inside `git ls-files sms/` —
they ship with the package by this definition, but `DEPLOY.md` in particular contains real
host/IP/login details (see `REDACTION.md`) and must never be copied into the guide verbatim.

## Explicitly excluded from the package

- `.env` — IT creates this from `.env.example` on the target host; never shipped.
- `node_modules/` — restored by `npm ci` on the host.
- `logs/` — runtime output, not source.
- NSSM — third-party Windows service manager; IT must supply it themselves.

## Consequence for this guide

`handover/*.md`, `INSTALLATION-FIRST-HOUR.md`, and the many other dated root-level documents
one level above `sms/` (`CLAUDE.md`, `DEFECTS.md`, `COMMISSIONING-GAPS.md`, etc.) are **outside
`sms/`** and therefore outside the package by this definition. The guide may use them as source
material for writing chapters (re-verified against code), but must never tell IT to go read
them after installation, since they will not be present on the delivered system.

## IT-side path placeholders

Use these generic placeholders in the guide rather than any path specific to this development
machine: `C:\sms` (install root), `C:\sms-backups` (backup folder), `C:\sms\logs\*.log` (log
files).

## Open item (owner decision, per the illustrated-guide plan §6 Q2/Q4)
Whether `handover/` documents should ship with the package, and whether `docs/guide/images/`
and `docs/guide/out/` should be committed, are both flagged in the plan as needing owner
confirmation. This file's default (no to both) is not yet owner-approved.
