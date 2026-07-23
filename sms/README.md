# IFL Sack Management System (SMS)

Production monitoring for the TP1 Line 3 / Unit 2 yarn cone line. React + Node + TypeScript, sidecar-sync architecture. See `../ARCHITECTURE.md`, `../SPEC.md`, `../SCHEMA.md`, `../CLAUDE.md`.

## Layout

| Workspace | Role | Built in |
|---|---|---|
| `shared/` | TypeScript domain types + swappable-unknowns config | **done** |
| `db/migrations/` | App-DB schema (`sms_raw.*`, `sms.*`, 21 tables) | **done** |
| `sync-worker/` | Read-only IFL → raw → canonical sync | **done** |
| `cli/` | `sms sync / verify / summary / rebuild` | **done** |
| `api/` | Express REST + auth | next (Step 5–6) |
| `web/` | React dashboard | Step 7 (demo) |

## CLI

```bash
node cli/dist/index.js sync                       # full pass
node cli/dist/index.js verify                      # reconcile source⇄raw⇄canonical
node cli/dist/index.js summary --date=2026-07-05   # KPIs [--shift=morning]
node cli/dist/index.js rebuild --table=cone_event --snapshot-id=<id>
```

## Getting started

```bash
cd sms
npm install
cp .env.example .env      # fill in APP_DB_* and IFL_DB_* (dev: local .\SQLEXPRESS copy)
npm run build:shared
npm test                  # shared unit tests
npm run db:migrate        # create sms schema + cone_event / sack_event / sync_run
```

## Ground rules (enforced, see CLAUDE.md)

- **IFL database is read-only** and must never be altered (no indexes, no writes). Only `sync-worker` connects to it.
- **No credentials in code** — env only.
- **Parameterised SQL only.**
- **No PLC dependency** in Phase 1.
- Dev→live cutover = repoint `IFL_DB_SERVER` in `.env`; nothing else changes.
