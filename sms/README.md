# IFL Sack Management System (SMS)

Production monitoring for the TP1 Line 3 / Unit 2 yarn cone line. React + Node + TypeScript, sidecar-sync architecture. See `../ARCHITECTURE.md`, `../SPEC.md`, `../SCHEMA.md`, `../CLAUDE.md`.

## Layout

| Workspace | Role | Built in |
|---|---|---|
| `shared/` | TypeScript domain types + swappable-unknowns config | **done** |
| `db/migrations/` | App-DB schema — 27 migrations, 31 tables (27 `sms.*` + 4 `sms_raw.*`); `db/bootstrap/` creates the database and login first | **done** |
| `sync-worker/` | Read-only IFL → raw → canonical sync | **done** |
| `cli/` | `sms sync / verify / summary / rebuild / user:create / epoch:list,accept,purge,drop / cutover` | **done** |
| `api/` | Express REST + auth (+ `/api/live` for the floor screens) | **done** |
| `web/` | React app — seven screens open to every signed-in account (Line · Readings · Weight · Rejects · Report · Wall, plus admin-only Setup) and three detail sheets; the earlier floor/analysis split was removed on 3 Sep 2026 | **done** |

## CLI

```bash
node cli/dist/index.js sync                       # full pass
node cli/dist/index.js verify                      # reconcile source⇄raw⇄canonical
node cli/dist/index.js summary --date=2026-07-05   # KPIs [--shift=morning]
node cli/dist/index.js rebuild --table=cone_event --snapshot-id=<id>
node cli/dist/index.js user:create --username=<u> --password=<p> --role=<operator|supervisor|manager|admin>
node cli/dist/index.js epoch:list                 # registered source generations
node cli/dist/index.js epoch:accept --all --confirm --provenance=ifl_live --label="..."   # register a new source generation (cutover)
node cli/dist/index.js cutover --confirm          # throw-away reset of raw/canonical/epochs (keeps users, rules, product data)
```

## Getting started

```bash
cd sms
npm install
cp .env.example .env      # fill in APP_DB_* and IFL_DB_* (dev: local .\SQLEXPRESS copy)
npm run build:shared
npm test                  # the whole suite (vitest, all five workspaces; no database needed)
npm run db:migrate        # apply db/migrations/*.sql in order, tracked in sms.schema_migration (run db/bootstrap/00_create_app_database.sql first on a new server)
```

## Ground rules (enforced, see CLAUDE.md)

- **IFL database is read-only** and must never be altered (no indexes, no writes). Only `sync-worker` connects to it.
- **No credentials in code** — env only.
- **Parameterised SQL only.**
- **No PLC dependency** in Phase 1.
- Dev→live cutover = repoint `IFL_DB_*` in `.env` **and register the live source generation** with `sms epoch:accept` — the worker deliberately halts until that is done. "Nothing else changes" was true before IFL rebuilt its tables on 5 Aug 2026 and is now false; see `DEPLOY.md` → *Dev → Live cutover*.
