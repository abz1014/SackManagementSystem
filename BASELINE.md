# BASELINE.md — what the IFL Sack Management System does today

**Baseline:** tag `v0.1.0-baseline` = commit `a585302`, branch `floor-first-rework`, 14 September 2026.
**This document was verified against:** `a473d4d` (the same tree plus the Wave A commits listed in §1), the development sidecar database, and a captured run of the release gate — and then **adversarially re-verified on 14 Sep 2026 by three independent checks** (git/secrets, tests/build/CI, database/environment), each of which tried to refute it with its own commands. They refuted five statements in the first draft; those are corrected below and marked *(corrected after adversarial check)*, and the code defects they exposed are fixed in `7a0c5f7`. Every claim that remains is either greppable in the code or names the rehearsal that produced it. Where something is a plan and not a fact, it says so.

This is the Phase 0 deliverable the roadmap asks for ("a `BASELINE.md` describing what works today"). Its companion, `PROJECT_STATUS.md`, is the living status the roadmap's rule 15 requires and is updated per phase; this file describes one frozen point and is not.

---

## 1. Identity of the baseline

| Fact | Value |
|---|---|
| Tag | `v0.1.0-baseline` (annotated) on `a585302` — "Freeze the September 2026 working tree as the Phase 0 baseline" |
| Branch | `floor-first-rework`. `origin/main` is at `b1c6de2` (19 Aug 2026) and is a **strict ancestor**: fast-forwarding `main` to this branch is clean. The branch has **no upstream and has not been pushed** — that is an owner decision (§10). |
| Paths frozen by the baseline commit | 114 (48 added, 66 modified). Per-file disposition: Appendix A. |
| Commits on top of the baseline | `92df608` from-zero bootstrap and honest migration guidance · `478c456` sync-worker halt rows, product-mirror isolation, pool lifecycle, validated env · `a473d4d` reject sheet, one server-side verdict, versioned SPC limits · `0dd33fa` this file, `PROJECT_STATUS.md`, `.github/workflows/ci.yml` · `7a0c5f7` the fixes from the adversarial check (§7) · plus the commit carrying this corrected text. **A checkout of the tag itself does not contain this file or the CI workflow** — they were written after the freeze; read them at the branch head. |
| Copies *(corrected after adversarial check)* | The first draft said "the second drive". False: `C:\sms-backups` is on disk 0, the OS disk — the same physical disk as the repository and as SQL Server's data files. Corrected 14 Sep 14:08: `D:\sms-backups` (disk 1, a separate physical drive) now holds SHA-256-matched copies of `sms-2026-09-14-baseline.bak` (242 MB, `RESTORE VERIFYONLY WITH CHECKSUM` passed on the copy), `sms-repo-2026-09-14.bundle` (HEAD `a585302` + tag) and `sms-repo-2026-09-14-waveA.bundle` (HEAD `0dd33fa` + tag), plus `sms-20260914-140827.bak` written by the backup script's exact statement. **Still one machine.** A copy on other hardware is the owner's (§10). |
| Node / npm | 22 (pinned in `sms/.nvmrc` and `engines`) / ≥ 10 |
| Database engine | SQL Server Express (dev instance `localhost,14330`, app DB `sms`) |

---

## 2. What runs today — verified

The system is an npm-workspaces monorepo under `sms/` with five packages: `shared`, `sync-worker`, `cli`, `api`, `web`. One language (TypeScript) end to end; no ORM, no router library, no UI framework beyond React.

### 2.1 Sync worker (`sms/sync-worker`)

Runs a full pass every `SYNC_INTERVAL_SECONDS` (default 60, validated ≥ 5) or once with `--once`. A pass is: reference seed → PDAS product mirror → read the four IFL wide tables into `sms_raw.*` → transform into `sms.*` canonical → data-quality findings.

- **Source generations ("epochs").** `sms.source_epoch` names each physical generation of each source table, keyed by (line, table, server, database, `create_date`). The worker resolves the generation before every read and **halts on an unknown one**; `sms epoch:accept` registers it, never automatically. This exists because IFL dropped and recreated the four tables on 5 Aug 2026 and every identity restarted at 1 — a change the schema fingerprint could not see.
- **Per-generation watermark** on `MAX(src_id)`, with a 500-row overlap re-read and an epoch-scoped dedupe. A source that goes backwards within a generation halts the pass.
- **Every halt leaves a row** (since `478c456`): an unknown generation, a source gone backwards, an IFL connection failure or a reference-seed failure each write one `sms.sync_run` row per table with `outcome = 'halted'` and the reason; tables the halt prevented from being read get a row saying which table stopped the pass. Before this, a halt wrote nothing and the only symptom was rising data age.
- **The PDAS product mirror cannot stop ingestion** (since `478c456`): a PDAS read failure records a standing `product_mirror_failed` finding and the pass continues; the finding clears on the next mirror that succeeds. A transform failure is a standing `transform_failed` CRITICAL finding, cleared likewise.
- **Product limits are time-versioned.** `seedProducts` mirrors `PDAS.Materials` into `sms.product` every pass and appends a row to `sms.product_limit_version` whenever the setpoint or offsets differ from the newest recorded version (a lower bound on when the change happened, and it says so).
- **Transform ↔ rebuild mutual exclusion** through `sp_getapplock` (`lock.ts`).
- **Retry** covers only the IFL row read (`withRetry` around `adapter.readSince`); the generation gate, the watermark read and the mirror are not retried.

### 2.2 CLI (`sms/cli`) — ten commands

`sync` · `verify` (reconciles per generation to `SUM(id)`) · `summary` · `rebuild --table --snapshot-id` · `cutover --confirm` · `epoch:list` · `epoch:accept` · `epoch:purge` · `epoch:drop` · `user:create`.

### 2.3 API (`sms/api`) — Express, 44 routes plus the SPA fallback

Session-cookie auth (argon2 hashes, server-side sessions in `sms.session`, renewal while in use), role ranks 1–4 enforced server-side by `requireRole`, audit log for every admin/config write. Routes, grouped:

- **Auth:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`; `GET /api/health`.
- **Reading data:** `/api/range`, `/api/live` (plant clock, current shift, running/stopped/idle, freshness measured from the *oldest* source table, the measured acquisition lag), `/api/production`, `/api/events` + `/api/events/:type/:id` + `/api/events/export` (rank 3), `/api/rejects`, `/api/reject-spc`, `/api/spc`, `/api/weights`, `/api/weight-stations`, `/api/downtime`, `/api/report`, `/api/attention`, `/api/calibration`, `/api/calibration/adjustments` (GET; POST rank 2), `/api/stations`, `/api/operations`.
- **Products:** `/api/products`, `/api/product-options`, `/api/product-timeline`, `/api/current-product` (POST rank 2), `/api/product-at` (which product and which limits were in force at an instant, and — with `weightG` — the verdict), `/api/product-write/status`, `POST /api/products`, `POST /api/products/:id/active`, `POST /api/products/:id/limits` (all three rank 3, all three answer **503 DISABLED** while `PDAS_WRITE_ENABLED` is not `true`).
- **Rejects:** `PUT /api/reject-codes/:id` (rank 3; label, optional pass flag).
- **Admin (rank 4):** users (list/create/patch), stations (list/rename), rules (read; `POST …/weight`, `…/shift`, `…/plausibility` — versioned inserts, audited), audit log.

### 2.4 Web (`sms/web`) — React 18 + Vite

One top bar, one global period control, one sentence about how old the data is. **Seven screens** — Line · Readings · Weight · Rejects · Report · Wall (`?s=wall`, fullscreen for a TV) · Setup (admin only) — plus Login and **three sheets** (reading, station, product). Every screen is open to every signed-in account; roles gate writes only. Rules the code enforces and that must not be undone are in `CLAUDE.md` → "UI redesign — BUILT AND LIVE".

### 2.5 Database (`sms/db`)

- `db/bootstrap/00_create_app_database.sql` creates the database (SIMPLE recovery), the `sms_app` login (password only via `sqlcmd -v`, never in the file) and its three roles. `10_ifl_readonly_login.template.sql` is the SQL to hand IFL's DBA.
- **27 migrations** (`001`–`027`), idempotent, applied by `scripts/migrate.mjs` and tracked in `sms.schema_migration`. They define **31 tables**: 27 `sms.*` and 4 `sms_raw.*`.
- **From-zero rehearsal, 14 Sep 2026:** a database created with exactly the bootstrap's roles, then `npm run db:migrate` as `sms_app` — all 27 applied unattended, 31 tables, `sms.source_epoch` empty, 27 history rows. `--mark-applied-through=NNN` exercised for a database migrated by the pre-history runner (10 marked, 17 skipped).
- The development sidecar holds exactly these 31 tables — re-checked by schema on 14 Sep 2026 (`sms` 27, `sms_raw` 4, no others). *(Corrected after adversarial check: the first draft said 33 tables including two `snap25_*` snapshot tables; there are none.)*

### 2.6 Data on the development sidecar

Two source generations, from two samples IFL supplied: **July** (19 production days, 22 Jun → 10 Jul 2026, 142,511 cones) and **September** (34 days, 5 Aug → 7 Sep 2026, 132,552 cones) — 275,063 canonical cone rows. The month between them exists at IFL and has not been sent. September rows carry IFL's `MaterialId` on every reading (attribution `'source_column'`); July rows do not (`'none'`, honestly). The plant simulator (`scripts/simulate-plant.mjs`) writes only to databases ending `_SIM`.

---

## 3. Test status — captured

| | Baseline commit `a585302` | At `7a0c5f7` |
|---|---|---|
| Test files | 28 | 34 |
| Tests | 266, all passing | 324, all passing — under the host zone (UTC+5), `TZ=UTC` and `TZ=GMT` |
| Typecheck (`tsc -b` over all five workspaces) | exit 0 | exit 0 |
| Build (five workspaces, dependency order) | exit 0 | exit 0 |
| Captured run | `sms/BASELINE-RUN-2026-09-14.txt` (at `e86357f` + the tree that became `a585302`) | the clean-checkout rehearsal in §9; CI (`.github/workflows/ci.yml`) runs the same gate on every push once the branch is pushed — **it has not run yet** |

The gate is `npm run verify:release` = typecheck + `vitest run` + build. **No test needs a database:** every service test uses a hand-rolled fake `mssql` pool or pure functions; the two `app.*.test.ts` files run the real Express app over such a pool and drive it with Node's `fetch`. What CI cannot reach is the live-database behaviour — that is verified in the browser and recorded in commit messages and `DEPLOY.md`.

**A failure that existed and is fixed** *(found by the adversarial check)*: at `0dd33fa` two `plantClock` tests failed on any zero-offset host — `TZ=UTC npx vitest run` gave 1 failed / 322 passed, deterministically — because `plantOffsetMinutes()` returned `-0` there and the tests compare with `Object.is`. GitHub's ubuntu-latest is such a host, so the CI workflow would have been red on its first run. Fixed in `7a0c5f7` (`0 - offset`; a new test pins it). The development machine and the plant are both UTC+5 and could never show it. No test needs a database, and none reads `.env`.

**Coverage that is missing, stated plainly:** the web workspace has **one** test file (`lib/period.test.ts`, a date helper). None of the eleven screen components has a test. The UI is verified by hand in the browser, not by the suite.

---

## 4. Flags — which are real

| Key | Status | Evidence |
|---|---|---|
| `PDAS_WRITE_ENABLED` | **Code-enforced, fail-closed.** Anything but the string `true` leaves the write path off; the three write routes exist and answer 503 with the reason. A separate `sms_pdas_writer` login is required and **does not exist anywhere yet**. | `api/src/config.ts` (parsed to `pdasWrite.enabled`), `pdasWrite.test.ts`, `app.routes.test.ts` (503 asserted) |
| `LIVE_ALLOW_AS_OF` | Code-enforced. `true` in dev (the copy ends 7 Sep), **must be `false` in production**; a replay is always bannered. | `api/src/config.ts`, `live.ts` |
| `PLC_READER_ENABLED`, `PLC_HOST`, `PLC_RACK`, `PLC_SLOT`, `PLC_CONE_ID_DB` | **Inert template keys.** Zero references in any `.ts` file; nothing reads, validates or tests them; no PLC library is in any of the five manifests. This is a documented, dependency-free re-entry point — **not** a disabled reader, and this file must never be read as saying a reader exists. | `grep -rn PLC_ sms/*/src` → no hits |

---

## 5. Environment variables — names only, no values

Forty-two active keys and ten commented ones in `sms/.env.example` (seven were commented in the first draft, which miscounted them as nine; `7a0c5f7` added the three simulator keys as commented, development-only entries). `.env` is git-ignored and has never been committed on any branch — verified by a history-wide scan on 14 Sep 2026, and independently re-verified by hashing the real local values and searching every reachable and unreachable object for them: zero hits.

| Group | Keys | Read by |
|---|---|---|
| App DB | `APP_DB_SERVER` `APP_DB_PORT` `APP_DB_NAME` `APP_DB_USER` `APP_DB_PASSWORD` `APP_DB_ENCRYPT` `APP_DB_TRUST_SERVER_CERTIFICATE` | api, sync-worker, cli, `migrate.mjs` |
| IFL source (read-only) | `IFL_DB_SERVER` `IFL_DB_PORT` `IFL_DB_NAME_DATA` `IFL_DB_NAME_PDAS` `IFL_DB_USER` `IFL_DB_PASSWORD` `IFL_DB_ENCRYPT` `IFL_DB_TRUST_SERVER_CERTIFICATE` | sync-worker, cli |
| PDAS write path (off) | `PDAS_WRITE_ENABLED` `PDAS_WRITE_SERVER` `PDAS_WRITE_PORT` `PDAS_WRITE_DATABASE` `PDAS_WRITE_USER` `PDAS_WRITE_PASSWORD` `PDAS_WRITE_ENCRYPT` `PDAS_WRITE_TRUST_SERVER_CERTIFICATE` | api |
| Sync | `SYNC_INTERVAL_SECONDS` `SYNC_OVERLAP_ROWS` `LINE_ID` (`SYNC_ONCE` commented) | sync-worker (all three validated as whole numbers since `478c456`); `LINE_ID` is also read by the API (`api/src/config.ts`) and shared config (`appConfig.ts`) — set it the same everywhere |
| Plant simulator (development only, commented) | `SIM_DB_NAME` `SIM_DB_USER` `SIM_DB_PASSWORD` | `scripts/simulate-plant.mjs` — *(added after adversarial check: in real use on the development machine and read by tracked code, documented nowhere until `7a0c5f7`)* |
| API | `API_PORT` `CACHE_TTL_SECONDS` `LINE_NAME` `LIVE_ALLOW_AS_OF` `TRUST_PROXY` `COOKIE_SECURE` (`PLANT_UTC_OFFSET_MINUTES` `TLS_PFX_PATH` `TLS_PFX_PASSPHRASE` `TLS_CERT_PATH` `TLS_KEY_PATH` `WEB_DIST` commented) | api |
| Behavioural defaults (first seed only) | `WEIGHT_BASIS` `CONE_TUBE_WEIGHT_G` `SACK_TARE_KG` `SHIFT_MODE` `SHIFT_NIGHT_BELONGS_TO` | shared `loadAppConfig` → `seedReference` |
| Inert | `PLC_READER_ENABLED` `PLC_HOST` `PLC_RACK` `PLC_SLOT` `PLC_CONE_ID_DB` | nothing (§4) |

**Secrets.** Four database logins exist by design for a plant installation — `sms_readonly` (IFL's server, `db_datareader` on both databases), `sms_app` (sidecar, three roles on `[sms]`), `sms_backup` (`db_backupoperator`), `sms_pdas_writer` (not yet provisioned) — plus a fifth, `sms_sim`, on development machines only (the simulator's writer on a `*_SIM` database; it exists on the development instance and is never created on a plant server). Each has issuer, storage and rotation in `DEPLOY.md` → *Credentials and secrets*. There is no `SESSION_SECRET`: sessions are server-side random ids. Two other secret-bearing files sit on the development machine, both git-ignored and never committed: the ngrok tunnel policy (`sms/ops/sms-tunnel-policy.yml`) and a 2 Sep 2026 copy of `.env` (`sms/.env.backup-before-sim`) — the latter is residue and is listed for the owner in §10. The tracked `sms/ops/sms-watchdog.ps1` embeds the tunnel's public hostname; that is an endpoint, not a credential.

---

## 6. Backup and restore — procedure and rehearsals

Procedure: `scripts/backup-appdb.ps1` (full backup as `sms_backup`, `WITH CHECKSUM`, followed by `RESTORE VERIFYONLY WITH CHECKSUM` on the file it wrote) and the restore steps in `DEPLOY.md` → *Backup & restore*. *(Corrected after adversarial check: until `7a0c5f7` the script wrote no checksum — the first draft said it did — and the checksummed baseline backup had been taken by hand. The script's exact new statements were then executed with Windows auth: 230.9 MB to `D:\sms-backups\sms-20260914-140827.bak`, "The backup set on file 1 is valid.")*

| Rehearsal | Schema | Result |
|---|---|---|
| 19 Aug 2026 | pre-epoch, July only, 21 tables | 75.7 MB; backup 5.6 s; restore 9.4 s; row counts matched |
| **14 Sep 2026** | two generations, migrations 001–027 | **242 MB; `RESTORE VERIFYONLY WITH CHECKSUM` passed; restore into a scratch database 5 s; every table's row counts matched the live database (31 tables — the first draft said 33, corrected); `product_timeline`'s newest row matched to the second.** Scratch database dropped afterwards. The same `.bak` was re-verified from its copy on disk 1 at 14:08. |

The nightly backup is an **instruction in `DEPLOY.md`, not an installed job** on any machine (re-confirmed: no scheduled task references the script; SQL Server Express has no Agent). The independent database check also reproduced the migration hazard `DEPLOY.md` describes — history emptied, `db:migrate` fails inside 026 and rolls it back, `--mark-applied-through` restores it — so that guidance is verified, not asserted.

---

## 7. Known defects at the baseline, and where each stands

The full verified register is `ROADMAP-GAP-ANALYSIS.md` §17 (23 areas). The items below are the ones that change what a reader of the baseline sees; **Fixed** names the commit.

| Defect at `a585302` | Status |
|---|---|
| Setup's "Blocking findings" compared severity against values the CHECK constraint forbids, so it always read "None" | Fixed `a473d4d` |
| Renaming a reject code wiped its pass flag | Fixed `a473d4d` |
| Weight rejects never matched their `reject_code` row in the register (`NULL = NULL`) | Fixed `a473d4d` |
| Reject sheet said "Passed", showed the line-wide product, eyebrow "Cone", "0 g" on an unweighed quality reject | Fixed `a473d4d` |
| `z.coerce.boolean()` turned `"false"` into `true` on the product-active routes | Fixed `a473d4d` |
| SPC chart limits came from the mirror's current row, not the version in force for the period | Fixed `a473d4d` |
| Reading sheet kept its own copy of the inside/outside comparison | Fixed `a473d4d` |
| A sync halt wrote no `sync_run` row and no finding | Fixed `478c456` |
| PDAS mirror failure stopped all ingestion | Fixed `478c456` |
| App pool abandoned per tick on IFL connect failure; NaN interval ran a 1 ms loop | Fixed `478c456` |
| Suite failed on any UTC±0 host (`plantOffsetMinutes()` returned `-0`; `Object.is` comparisons) — CI would have been red on first push | Fixed `7a0c5f7` *(found by the adversarial check)* |
| Backup script wrote no `CHECKSUM` and never verified its own file, while the records said it did | Fixed `7a0c5f7` *(found by the adversarial check)* |
| CI tracked-secret-file check ran from `sms/` and could not see the repository root | Fixed `7a0c5f7` *(found by the adversarial check)* |
| `DEPLOY.md` claimed re-running migrations was a no-op (026 is not re-runnable); no `CREATE DATABASE`/login anywhere; dev epoch seed inside migration 025 | Fixed `92df608` |
| Three documents gave three table counts; `sack1`/`pack1` inverted in `CAPABILITIES.md`; phantom PLC test in `SPEC.md` | Fixed `92df608` |
| `shared/src/domain/events.ts` is a dead contract (exported, never imported by a consumer) | **Open** — obsolete; removal is a Phase 2 adapter-extraction decision |
| Three orphaned client wrappers in `web/src/api.ts` (`getOee`, `getShiftAnalysis`, `getStoppagePatterns`) target routes deleted at `f4b941a` | **Open** — obsolete; harmless; remove with the next `api.ts` change |
| `TRANSFORM_VERSION` never bumped although the transform's semantics changed | **Open** — deliberately held for Wave B (needs the rebuild it implies) |
| Reject reasons fixed to a 14-day window regardless of period; no `GET /api/reject-codes`; trend draws no control limits | **Open** — Phase 5 scope |
| `cutover` and `epoch:purge` unlocked and without a backup check; `epoch:accept` non-transactional | **Open** — Phase 11 scope |
| Audit writes are fire-and-forget; `sms_app` holds DDL and so could alter `audit_log` | **Open** — Phase 12 scope |
| Station roster is `SELECT TOP (14)` with no insert path; shift boundaries are constants in three consumers | **Open** — Phase 1 scope |
| The July source shape cannot be re-ingested by the current reader (renamed columns), so the Jul–Aug window IFL has not sent cannot be loaded as-is | **Open** — Phase 13/data path; needs IFL's data first |
| UI: 11 screens, 0 tests | **Open** — §3 |

---

## 8. Experimental, obsolete and dev-only — separated

| Kind | What | Disposition |
|---|---|---|
| Dev-only tooling, in repo | `scripts/simulate-plant.mjs` + `simulate-plant-schema.sql` (writes only to `*_SIM`); `scripts/seed-dev-epochs.sql` (the dev machine's two closed generations, moved out of migration 025); `scripts/backfill-source-epoch.mjs` (one-off, hard-codes this machine's id boundaries — read its header before any reuse) | Keep; never run on a plant sidecar |
| Dev-only scratch, **not** in repo | `sms/q.mjs`, `sms/sync-trace.mjs` | Git-ignored since `a585302`; the first hard-codes the developer's absolute path |
| Design sources | `design/handoff-2026-09-03/` | Keep as the record of what was applied |
| Historical documents | `SPEC.md` (header marked historical), `SEPT-2026-DB-BRIEFING.md` (with retractions annotated), `SEPT-2026-DB-FINDINGS-RAW.md` | Keep; read for reasoning, not for current state |
| Dead code | `shared/src/domain/events.ts` (re-exported from `shared/src/index.ts`, no type-level consumer anywhere); three client wrappers in `web/src/api.ts` targeting routes deleted at `f4b941a`; `web/src/lib/strings.ts` (floor-era string set — still imported by `fmtAgo` in `lib/fmt.ts`, which itself has no callers, so dead transitively rather than unreferenced) | Obsolete — §7 |
| Shipped but off | The PDAS write path (`api/src/services/pdasWrite.ts`, three routes, `ProductSheet.tsx` forms) | Complete and tested; stays off until IFL confirms in writing |
| On the dev instance only | An unexplained `sms_real` database beside `sms` (the `snap25_*` snapshot tables the first draft listed do not exist) | Owner decision (§10) |
| Secret-bearing residue, ignored, never committed | `sms/.env.backup-before-sim` (a 2 Sep 2026 copy of `.env`) | Owner decision (§10): delete, or keep as the pre-simulator record |
| Test residue on the dev sidecar | a station-7 calibration adjustment with reason "verification test"; a `floor` operator account | Owner decision (`DECISIONS-PENDING.md` §12) |

---

## 9. Phase 0 acceptance — item by item

| Criterion | State |
|---|---|
| Clean Git baseline | **Met.** Tag `v0.1.0-baseline`; working tree clean after each Wave A commit. |
| Existing tests pass or known failures are documented | **Met.** 324/324 at `7a0c5f7`, under three timezones and in a fresh clone; no known failures. The one failure that existed at the first closure (UTC hosts) is recorded in §3 with its fix. Coverage gaps documented in §3. |
| Application starts from a clean checkout | **Met — rehearsed for real on 14 Sep 2026** *(the first draft claimed this on the strength of a build over a month-old `node_modules`; the adversarial check pointed out `npm ci` had never actually been run, so it was done properly)*: `git clone` of `7a0c5f7` into a fresh directory on the second disk → `npm ci` (184 packages from the lockfile) → `npm run verify:release` (typecheck 0; 34 files / 324 tests; five builds) → `git status --porcelain` empty after the build → the API started from `api/dist/index.js` on a spare port and answered `/api/health` `{"status":"ok","db":"up"}`, the SPA and `/api/auth/me` → the sync worker ran one full pass from `sync-worker/dist/index.js --once` → `cli/dist/index.js summary` printed the 7 Sep day. The clone (and the `.env` copied into it) was deleted afterwards. **Same machine, fresh checkout, fresh dependencies.** A different machine still waits on IFL's host (Q65–70); CI, once pushed, adds a fresh Ubuntu runner for install/typecheck/test/build — it starts no service and no database, so it does not replace this rehearsal. |
| Database can be created/restored from documented steps | **Met.** From-zero rehearsal (§2.5) and restore rehearsal (§6), both on 14 Sep 2026, both recorded in `DEPLOY.md`. |
| No production credentials in source control | **Met.** Verified four ways on 14 Sep 2026 (history over `*.env` on every branch, `git ls-files`, `git check-ignore`, history-wide `-p` scan), and independently by the adversarial check, which hashed the real local secret values and found them in no reachable or unreachable object. CI's tracked-secret-file check now runs from the repository root (`7a0c5f7`) and fails on any tracked `.env`, `.bak`, `.mdf`/`.ldf`, `.rar`, `SPS.adding` or the tunnel policy file — **a control that has not yet executed**, because nothing is pushed. |

---

## 10. Decisions the baseline leaves to the owner

Not done unilaterally; listed in `PROJECT_STATUS.md` under *Blocked — owner decision*.

1. **Push** `floor-first-rework` (no upstream yet) and the tag; decide whether `main` fast-forwards to it.
2. **A copy on other hardware** of `D:\sms-backups\*` (the bundles and the `.bak` now sit on both physical disks of the development machine, and nowhere else). The July generation (142,511 cones) survives only in those files and in an extracted MDF; IFL dropped the table.
3. Explain or drop the `sms_real` database on the development instance.
3a. Delete `sms/.env.backup-before-sim` (an ignored, never-committed 2 Sep copy of `.env` with real values) or keep it deliberately.
4. The two test-data rows (`DECISIONS-PENDING.md` §12).
5. Whether to provision `sms_pdas_writer` locally against the SEP07 copy for offline write-path tests (touches a copy of client data).
6. Send the IFL question pack (`IFL-QUESTIONS-STATUS.md`: 36 open).

---

## Appendix A — per-file disposition of the 114 paths frozen by `a585302`

Classification: **done** = completed feature or its test, in use · **schema** = migration, applied and rehearsed · **doc** = documentation · **tooling** = build/ops/dev script · **off** = complete, shipped disabled · **defect** = carried a known defect at the baseline (see §7 for status). No whole path is obsolete; the obsolete items are parts of files (§8) and appear as notes on the rows that hold them.

Totals: 114 paths — done 65, doc 16, tooling 11, schema 11, defect 8, off 3.

| # | Status | Path | Disposition | Note |
|---|---|---|---|---|
| 1 | A | `.gitattributes` | tooling | added at the baseline so the freeze was not a line-ending rewrite |
| 2 | M | `.gitignore` | tooling |  |
| 3 | M | `ARCHITECTURE.md` | doc | frozen build contract; retry/halt line corrected |
| 4 | M | `CLAUDE.md` | doc | table/test counts corrected 92df608 |
| 5 | A | `IFL-QUESTIONS-STATUS.md` | doc |  |
| 6 | A | `IFL_Hassan_Simple_Requirements_Questions.md` | doc |  |
| 7 | A | `IFL_Historical_Data_Requirement_Guide.md` | doc |  |
| 8 | A | `IFL_SMS_Claude_Code_Development_Roadmap.md` | doc |  |
| 9 | A | `PROJECT_TECHNICAL_HISTORY.md` | doc |  |
| 10 | A | `ROADMAP-GAP-ANALYSIS.md` | doc |  |
| 11 | M | `SCHEMA.md` | doc | IFL data model; source of truth for queries |
| 12 | A | `SEPT-2026-BUILD-PLAN.md` | doc |  |
| 13 | A | `SEPT-2026-DB-BRIEFING.md` | doc | historical; retractions annotated in place |
| 14 | A | `SEPT-2026-DB-FINDINGS-RAW.md` | doc | historical raw findings |
| 15 | A | `SEPT-2026-EPOCH-DECISION.md` | doc |  |
| 16 | M | `sms/.env.example` | tooling |  |
| 17 | M | `sms/.gitignore` | tooling |  |
| 18 | A | `sms/.nvmrc` | tooling | Node 22 |
| 19 | A | `sms/AUDIT-FINDINGS.md` | doc |  |
| 20 | A | `sms/BASELINE-RUN-2026-09-14.txt` | doc | captured release gate: 28 files / 266 tests |
| 21 | M | `sms/DEPLOY.md` | doc | corrected in 92df608 and 478c456 |
| 22 | M | `sms/api/src/app.rbac.test.ts` | done | test |
| 23 | M | `sms/api/src/app.ts` | defect | `z.coerce.boolean()`, is_pass nulling, product-at hand-rolled — fixed a473d4d |
| 24 | M | `sms/api/src/config.ts` | done |  |
| 25 | M | `sms/api/src/index.ts` | done |  |
| 26 | M | `sms/api/src/services/attention.test.ts` | done | test |
| 27 | M | `sms/api/src/services/attention.ts` | done |  |
| 28 | M | `sms/api/src/services/calibration.ts` | done |  |
| 29 | M | `sms/api/src/services/currentProduct.ts` | done |  |
| 30 | M | `sms/api/src/services/live.test.ts` | done | test |
| 31 | M | `sms/api/src/services/live.ts` | done |  |
| 32 | M | `sms/api/src/services/operations.ts` | done |  |
| 33 | A | `sms/api/src/services/pdasWrite.test.ts` | off | tests the disabled path and the guarded UPDATE |
| 34 | A | `sms/api/src/services/pdasWrite.ts` | off | PDAS write path; 503 until `PDAS_WRITE_ENABLED=true` |
| 35 | A | `sms/api/src/services/plantClock.gap.test.ts` | done | test |
| 36 | M | `sms/api/src/services/plantClock.ts` | done |  |
| 37 | A | `sms/api/src/services/productAt.catalogue.test.ts` | done | test |
| 38 | M | `sms/api/src/services/productAt.ts` | done |  |
| 39 | A | `sms/api/src/services/productLimits.test.ts` | done | test |
| 40 | A | `sms/api/src/services/productLimits.ts` | done |  |
| 41 | M | `sms/api/src/services/production.ts` | done |  |
| 42 | A | `sms/api/src/services/register.test.ts` | done | test |
| 43 | M | `sms/api/src/services/register.ts` | defect | reject_code join on nullable equality, no material_id — fixed a473d4d |
| 44 | A | `sms/api/src/services/rejectSpc.generations.test.ts` | done | test |
| 45 | A | `sms/api/src/services/rejectSpc.test.ts` | done | test |
| 46 | M | `sms/api/src/services/rejectSpc.ts` | done |  |
| 47 | A | `sms/api/src/services/weightStations.gap.test.ts` | done | test |
| 48 | A | `sms/api/src/services/weightStations.test.ts` | done | test |
| 49 | M | `sms/api/src/services/weightStations.ts` | done |  |
| 50 | M | `sms/api/src/services/weights.ts` | done |  |
| 51 | A | `sms/cli/src/commands/cutover.ts` | done |  |
| 52 | A | `sms/cli/src/commands/epoch.ts` | done |  |
| 53 | M | `sms/cli/src/commands/rebuild.ts` | done |  |
| 54 | A | `sms/cli/src/commands/verify.test.ts` | done | test |
| 55 | M | `sms/cli/src/commands/verify.ts` | done |  |
| 56 | M | `sms/cli/src/index.ts` | done |  |
| 57 | A | `sms/db/migrations/017_rebuild_audit_failure.sql` | schema |  |
| 58 | A | `sms/db/migrations/018_sync_run_line_index.sql` | schema |  |
| 59 | A | `sms/db/migrations/019_calibration_adjustment_amount.sql` | schema |  |
| 60 | A | `sms/db/migrations/020_product_color.sql` | schema |  |
| 61 | A | `sms/db/migrations/021_source_station_index.sql` | schema |  |
| 62 | A | `sms/db/migrations/022_schema_migration_history.sql` | schema |  |
| 63 | A | `sms/db/migrations/023_shift_rule_marker.sql` | schema |  |
| 64 | A | `sms/db/migrations/024_september_source_schema.sql` | schema |  |
| 65 | A | `sms/db/migrations/025_source_epoch.sql` | schema | dev seed block removed to `scripts/seed-dev-epochs.sql` in 92df608 |
| 66 | A | `sms/db/migrations/026_source_epoch_constraints.sql` | schema |  |
| 67 | A | `sms/db/migrations/027_product_limit_history.sql` | schema |  |
| 68 | M | `sms/package.json` | tooling | engines, root typecheck incl. web, build, verify:release |
| 69 | A | `sms/scripts/backfill-source-epoch.mjs` | tooling | one-off; hard-codes this machine's id boundaries |
| 70 | M | `sms/scripts/backup-appdb.ps1` | tooling | rehearsed 19 Aug and 14 Sep 2026 |
| 71 | M | `sms/scripts/migrate.mjs` | tooling | self-tracking runner; `--mark-applied-through` added 92df608 |
| 72 | M | `sms/scripts/simulate-plant-schema.sql` | tooling | dev-only simulator schema |
| 73 | M | `sms/scripts/simulate-plant.mjs` | tooling | dev-only; refuses any target not ending `_SIM` |
| 74 | M | `sms/shared/src/config/appConfig.test.ts` | done | test |
| 75 | A | `sms/shared/src/domain/plantClock.ts` | done | two-clocks rule; imported by 11 modules |
| 76 | M | `sms/shared/src/domain/shift.ts` | done |  |
| 77 | M | `sms/shared/src/index.ts` | done | still re-exports the dead `domain/events.ts` contract (obsolete) |
| 78 | M | `sms/sync-worker/src/config.ts` | defect | bare Number() on env — fixed 478c456 |
| 79 | A | `sms/sync-worker/src/epoch.test.ts` | done | test |
| 80 | A | `sms/sync-worker/src/epoch.ts` | done |  |
| 81 | A | `sms/sync-worker/src/epochIngest.test.ts` | done | test |
| 82 | M | `sms/sync-worker/src/lib.ts` | done |  |
| 83 | A | `sms/sync-worker/src/lock.ts` | done |  |
| 84 | M | `sms/sync-worker/src/pipeline.ts` | defect | mirror coupled to ingestion — fixed 478c456 |
| 85 | M | `sms/sync-worker/src/raw/persistRaw.ts` | done |  |
| 86 | M | `sms/sync-worker/src/reader/IflSqlAdapter.ts` | done |  |
| 87 | M | `sms/sync-worker/src/reader/iflTables.ts` | done |  |
| 88 | A | `sms/sync-worker/src/runner.test.ts` | done | test |
| 89 | M | `sms/sync-worker/src/runner.ts` | defect | halts wrote no row — fixed 478c456 |
| 90 | M | `sms/sync-worker/src/seed/seedProducts.ts` | done |  |
| 91 | M | `sms/sync-worker/src/store.ts` | done |  |
| 92 | M | `sms/sync-worker/src/transform/dq.test.ts` | done | test |
| 93 | M | `sms/sync-worker/src/transform/dq.ts` | done |  |
| 94 | M | `sms/sync-worker/src/transform/persistCanonical.ts` | done |  |
| 95 | A | `sms/sync-worker/src/transform/runTransform.test.ts` | done | test |
| 96 | M | `sms/sync-worker/src/transform/runTransform.ts` | done |  |
| 97 | M | `sms/sync-worker/src/transform/transform.ts` | done |  |
| 98 | M | `sms/web/src/App.tsx` | done |  |
| 99 | M | `sms/web/src/api.ts` | defect | three orphaned wrappers (obsolete); `setRejectLabel` sent no isPass — fixed a473d4d |
| 100 | M | `sms/web/src/app.css` | done |  |
| 101 | M | `sms/web/src/lib/fmt.ts` | done |  |
| 102 | M | `sms/web/src/lib/period.ts` | done |  |
| 103 | M | `sms/web/src/lib/words.ts` | done |  |
| 104 | M | `sms/web/src/screens/Line.tsx` | done |  |
| 105 | A | `sms/web/src/screens/ProductSheet.tsx` | off | Add/Retire/Change-limits forms; the sheet itself is live |
| 106 | M | `sms/web/src/screens/ReadingSheet.tsx` | defect | reject sheet said "Passed", client-side judge() — fixed a473d4d |
| 107 | M | `sms/web/src/screens/Readings.tsx` | done |  |
| 108 | M | `sms/web/src/screens/Rejects.tsx` | done |  |
| 109 | M | `sms/web/src/screens/Report.tsx` | done |  |
| 110 | M | `sms/web/src/screens/Setup.tsx` | defect | severity case mismatch — fixed a473d4d |
| 111 | M | `sms/web/src/screens/StationSheet.tsx` | done |  |
| 112 | M | `sms/web/src/screens/Wall.tsx` | done |  |
| 113 | M | `sms/web/src/screens/Weight.tsx` | done |  |
| 114 | M | `sms/web/src/ui/Bar.tsx` | done |  |

