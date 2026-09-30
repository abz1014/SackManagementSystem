# What is in the package {#package}

"The package" means the `sms` folder of the release, at one version
(this guide describes version 0.2.0), plus what `npm ci && npm run build`
produces on the server, plus this guide. Nothing else is needed from the
developer's machine.

## What you receive

| Folder | What it is for |
|---|---|
| `shared` | Types and settings used by every other part. |
| `db` | The app database's setup: numbered migrations (001 to 042) and the bootstrap scripts that create the database and its logins. |
| `sync-worker` | The only program that talks to IFL's SQL Server. Read-only. |
| `cli` | The command-line tool, run as `node cli/dist/index.js <command>`. See Appendix B. |
| `api` | The web service: sign-in, permissions and every screen's data. It also serves the web app once it is built. |
| `web` | The screens people see in the browser. |
| `scripts` | Backup, scheduled-task and database-maintenance scripts, and the plant simulator used only for demonstrations. |
| `layout-tests` | Browser-based layout tests. Used by developers; not needed to run SMS. |

## What is built on the server

`npm ci && npm run build` (see {{ref:install-build}}) creates a `dist`
folder inside `api`, `sync-worker`, `cli` and `web`. The two long-running
programs are `api\dist\index.js` and `sync-worker\dist\index.js`.

## What is not in the package

- **`.env`.** IT creates it from `.env.example` on the server (see
  {{ref:install-env}}). It holds every password and is never shipped.
- **`node_modules`.** Restored by `npm ci`.
- **Log files.** Written at run time.
- **NSSM.** Third-party service software that IT must supply.
- **IFL's own data.** SMS reads it from IFL's SQL Server; it is never part
  of the package.

> **Note:** Use the placeholders `C:\sms` for the install folder,
> `C:\sms-backups` for backups and `C:\sms\logs` for logs unless IT chose
> other folders.
