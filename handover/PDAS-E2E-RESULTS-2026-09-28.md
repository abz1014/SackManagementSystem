# PDAS write path — local end-to-end proof (28 Sep 2026, Task K2)

**Code revision:** `fa48303be357cba74cb3ba00c8cde10b44df9780` (branch `floor-first-rework`),
API restarted at this HEAD with `PDAS_WRITE_ENABLED=true`, `api/dist/app.js` built
2026-09-28 17:13:12 local. Scope exactly as authorised in chat: real write clicks
against the local `PDAS_TP1U2_SEP07` copy only, restored afterwards; plant untouched;
`DATA_TP1U2` / `DATA_TP1U2_SEP07` never written; no logins created; no passwords
printed here.

## Summary

The automated harness (`sms/scripts/pdas-e2e-local.mjs`) **did not run any case** —
its brand-new (Task P, 28 Sep) live pre-flight guard refused before touching PDAS,
because `.env`'s `PDAS_WRITE_SERVER=localhost` does not literally match the value
`@@SERVERNAME` reports on this machine (`DESKTOP-G1MSH4I\SQLEXPRESS`). This is a
harness guard defect/limitation, not a PDAS-side failure — the guard is intentionally
strict and refused safely with zero writes. Per instructions, the harness was not
patched. **The full write path was instead proven directly through the browser UI**,
against the same local `PDAS_TP1U2_SEP07` copy, with real clicks, covering 7 of the 9
write rights plus the duplicate-triple blocker. `SetPalletStatusActive` (retire/
reactivate a pallet) was attempted via the Changeover screen's pallet-retire checkbox
but the plan request did not complete in this pass (see "Not proven this pass" below)
and was not forced further given the session's scope; everything that DID execute
round-tripped correctly through PDAS, `nhs_events`, and `sms.product_change`, and the
whole set was restored to the exact pre-run state afterward.

## Per-right table

| Right | Harness case | UI step | Failure paths tested | product_change outcome | nhs_events | Verdict |
|---|---|---|---|---|---|---|
| CreateMaterial | not run (pre-flight refused) | Changeover plan+execute: new blend/count/tube/material `UI-E2E-0928-*`, MaterialId **1025** created | Duplicate-triple refusal reproduced separately (see Blockers below); `pdasWrite.echo.test.ts` covers `-7001` in isolation | `change_id 7`, `create`, outcome `ok` | EventId 23449 `CreateMaterial info "Create new MaterialId: 11"` (vendor logs `@blendId`, not the real MaterialId — same known logging bug, reconfirmed) | **Proven this pass** |
| SetMaterialStatusActive (retire) | not run | Changeover execute retired existing product 20 (Star Green); Catalogue also retired 1025 | — | `change_id 9` (product 20) and `change_id 11` (product 1025), both `set_active`, outcome `ok` | EventId 23451 (`Set active to : 0 on MaterialId: 20`), EventId 23453 (`...MaterialId: 1025`) | **Proven this pass** |
| SetMaterialStatusActive (reactivate) | not run | Catalogue: Activate on product 1025 | — | `change_id 12`, `set_active`, outcome `ok` | EventId 23454 (`Set active to : 1 on MaterialId: 1025`) | **Proven this pass** |
| AddBlend | not run | Changeover: new blend `UI-E2E-0928-BLEND` → BlendId 11 | — | `change_id 4`, `add_blend`, `AddBlend`, outcome `ok` | EventId 23446 | **Proven this pass** |
| AddCount | not run | Changeover: new count `UI-E2E-0928-COUNT` → CountId 15 | — | `change_id 5`, `add_count`, `AddCount`, outcome `ok` | EventId 23447 | **Proven this pass** |
| AddTubeType | not run | Changeover: new tube type `UI-E2E-0928-TUBE`, 70 g, form 2 → TubeTypeId 28 | `-5001`/`-5002`/`-5003` (duplicate name+form / invalid form / invalid weight) not exercised live this pass; covered by `pdasWrite.http.test.ts` / `pdasWrite.echo.test.ts` | `change_id 6`, `add_tube_type`, `AddTubeType`, outcome `ok` | EventId 23448 | **Proven this pass** (create path); refusal codes not re-exercised live |
| CreatePallet | not run | Changeover: pallet for the new material → PalletId 1023 | — | `change_id 8`, `create_pallet`, `CreatePallet`, outcome `ok` | EventId 23450 | **Proven this pass** |
| SetPalletStatusActive | not run | Attempted: checked the pallet-retire box on Changeover for PalletId 1023, filled reason, clicked "Check the plan" — no `POST /api/changeover/plan` request fired (confirmed via network log), so no plan/execute occurred | not exercised | none created | none created | **Not proven this pass** — see note below |
| Limits UPDATE (`UPDATE dbo.Materials`) | not run | Catalogue: "Change weight limits" on product 1025, target 1965→1970 g, offsets unchanged | Optimistic-concurrency conflict (F4 in harness) not exercised live this pass; covered by `pdasWrite.echo.test.ts` | `change_id 10`, `update_limits`, outcome `ok` | EventId 23452 (`SMS updateProductLimits ... "Update MaterialId: 1025 setpoint 1965->1970 ..."`) | **Proven this pass** |
| `INSERT dbo.nhs_events` (paired row) | not run | Implicit in every write above | — | — | 9 new rows this pass, EventId 23446–23454 (`nhs_events` count 3631→3640 during the run, restored to 3631 after) | **Proven this pass** |

## Failure/blocker paths

- **Duplicate blend+count+tube triple (PDAS `-7001` shape, plan-time blocker):**
  planned a second changeover reusing `UI-E2E-0928-BLEND`/`UI-E2E-0928-COUNT`/
  `UI-E2E-0928-TUBE` (all "reuse"). The plan correctly showed a blocker: *"PDAS
  allows only one product per blend + count + tube type, active or not:
  ...already exists as product 1025 ... Change one of the three, or change the
  limits on product 1025 instead."* Clicking "Execute the changeover" while
  blocked did nothing — no `POST /api/changeover/execute` fired, no PDAS row
  changed. This is the plan-time form of the retire-then-recreate refusal
  (`-7001`) documented in `PDAS-EXECUTION-2026-09-23.md` and reproduced by
  direct SQL execution in that earlier pass; this pass reproduces it through
  the UI's plan-blocker path rather than by calling `CreateMaterial` directly
  against an already-existing triple.
- **`-5001`/`-5002`/`-5003` (AddTubeType duplicate name/invalid form/invalid
  weight) and optimistic-concurrency `CONFLICT`:** not re-exercised live this
  pass (harness did not run). These remain covered by the automated suite —
  `sms/api/src/routes/pdasWrite.http.test.ts` and
  `sms/api/src/services/pdasWrite.echo.test.ts` — and by the 23 Sep 2026 direct
  execution pass recorded in `PDAS-EXECUTION-2026-09-23.md`.
- **Rank gate and disabled 503:** not re-exercised live this pass (the session
  ran with `PDAS_WRITE_ENABLED=true` and an admin/rank-4 session throughout, as
  authorised). Both paths are covered by the automated tests named above and by
  Product › History's own record of three earlier `disabled` rows
  (`change_id 1–3`, all `CreateMaterial`, outcome `disabled`, message
  `PDAS_WRITE_ENABLED is not true`), which this pass observed unchanged in the
  History screen and confirmed still present after restore.
- **IMPLAUSIBLE for bad tube form/weight:** unreachable-by-design per
  `CLAUDE.md`/harness docstring; not re-exercised live this pass; the design
  claim was not re-verified by this pass (no code read of the validation path).

## Harness pre-flight failure (recorded, not patched)

```
PDAS writer login (name only, never the password): "sms_pdas_writer", read from .env.
RUN_TAG: 20260928122433
appPool connected: true
pdasRawPool connected: true
Live pre-flight: @@SERVERNAME="DESKTOP-G1MSH4I\SQLEXPRESS" DB_NAME()="PDAS_TP1U2_SEP07"
  (expected "DESKTOP-G1MSH4I\SQLEXPRESS" / "PDAS_TP1U2_SEP07")
REFUSING TO RUN: .env's PDAS_WRITE_SERVER ("localhost") does not match the live
  server ("DESKTOP-G1MSH4I\SQLEXPRESS").
```

Exit code 1. No `PDAS_E2E_OUT_FILE` was written (confirmed by its absence on disk) —
the script aborted before any case, so nothing needed restoring on account of the
harness run itself. The guard is doing what Task P's own docstring says it should
(refuse on any divergence between `.env`'s stated server and the live
`@@SERVERNAME`), but `.env`'s `PDAS_WRITE_SERVER=localhost` will never literally
equal a `@@SERVERNAME` hostname string on this or any machine where the app connects
via `localhost` rather than by its own computer name — this looks like a standing
mismatch in the guard's assumption, not a one-off. Left unpatched per instructions;
flagging for the owner to decide whether the guard should resolve/normalize
`localhost` before comparing, or whether `.env` should state the hostname instead.

## Backup, verify, scratch-restore, and final-restore evidence

**Pre-run backups** (`COPY_ONLY, CHECKSUM, INIT`):
- `D:\sms-backups\PDAS_TP1U2_SEP07-20260928-pre-e2e.bak` (1074 pages, 0.151 s)
- `D:\sms-backups\sms-20260928-pre-e2e.bak` (56330 pages, 1.567 s)

**RESTORE VERIFYONLY ... WITH CHECKSUM:** both backups reported *"The backup set on
file 1 is valid."*

**Scratch restore-and-compare** (`PDAS_SCRATCH_E2E_0928`, `SMS_SCRATCH_E2E_0928`,
`WITH MOVE` using the logical names from `RESTORE FILELISTONLY` —
`PDAS_TP1U2`/`PDAS_TP1U2_log` and `sms`/`sms_log`): anchors matched step-1 exactly
(table below), then both scratch databases were dropped (`SET SINGLE_USER WITH
ROLLBACK IMMEDIATE; DROP DATABASE`), confirmed gone by `sys.databases`.

**Before/after anchors** (identical in all three columns — step 1, scratch restore,
and final restore after the UI pass):

| Table | Materials | Blends | Counts | TubeTypes | Pallets | nhs_events |
|---|---|---|---|---|---|---|
| count | 24 | 10 | 14 | 27 | 25 | 3631 |
| MAX(id) | 1024 | 10 | 14 | 27 | 1022 | 23445 |

| sms table | product_change | product_limit_version | dq_finding | audit_log | session | blend | yarn_count | tube_type | product | pallet | product_timeline |
|---|---|---|---|---|---|---|---|---|---|---|---|
| count | 3 | 14 | 30 | 150 | 5 | 10 | 14 | 27 | 14 | 15 | 22 |

**Final restore** (after the UI pass, with `sms-api` stopped first via `preview_stop`):
`ALTER DATABASE ... SET SINGLE_USER WITH ROLLBACK IMMEDIATE` →
`RESTORE DATABASE ... FROM DISK <pre-e2e .bak> WITH REPLACE, CHECKSUM` →
`ALTER DATABASE ... SET MULTI_USER`, for both `PDAS_TP1U2_SEP07` and `sms`. Anchors
re-queried after restore: **identical to the table above, in every column.**
`sms-api` was restarted with `preview_start`; `GET /api/auth/me` in the already-open
browser tab still returned `{"user":{"username":"admin","displayName":"Plant Admin",
"role":"admin"}}` with no re-login — the session row survived the restore intact.

## What this pass proves and does not

**Proven, against the local `PDAS_TP1U2_SEP07` copy only, through the real UI and
real app code (not a direct SQL rehearsal):** CreateMaterial, SetMaterialStatusActive
(both directions), AddBlend, AddCount, AddTubeType, CreatePallet, the guarded
single-row `UPDATE dbo.Materials` limits change, and the paired `nhs_events` insert —
all round-tripping correctly through PDAS's own tables, `nhs_events`, and
`sms.product_change`, with plain-language, env-name-free outcomes on Product ›
History. The plan-time duplicate-triple blocker was also proven live.

**Not proven this pass:**
- `SetPalletStatusActive` — attempted, did not complete (see table above); the
  pallet from this run (PalletId 1023) was created and remained active throughout,
  never retired or reactivated by this pass.
- The automated harness's 19 cases (R1–R4, F1–F7, T1, A1, N1) — the harness itself
  did not execute due to the pre-flight mismatch above.
- `-5001`/`-5002`/`-5003`, optimistic-concurrency `CONFLICT`, the rank gate, and the
  disabled-503 path — not re-exercised live this pass; all remain covered by the
  automated suite (`pdasWrite.http.test.ts`, `pdasWrite.echo.test.ts`) and by the
  23 Sep 2026 direct-SQL execution pass.
- Anything requiring the plant: concurrent/production-load behaviour, whether the
  live PDAS's schema/`MAX(id)`s have drifted since the 7 Sep 2026 export, whether
  `sms_pdas_writer`'s plant-side grant behaves identically, and whether IFL's own
  process depends on the mislabelled `nhs_events` MaterialId text.

**Owner must still run:**
- `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` — the EXECUTE-only "ibrahim"-shaped
  login rehearsal (agents may not create logins).
- `handover/REHEARSAL-RBAC-BELOW-RANK.md` — below-rank RBAC on a live instance.
- Anything on the plant itself. `PDAS_WRITE_ENABLED` in the committed `.env` example
  and the plant deployment remain the owner's call; this pass only ran locally with
  the already-set `PDAS_WRITE_ENABLED=true` against `PDAS_TP1U2_SEP07`.

## Verification note on `.env`

`PDAS_WRITE_PASSWORD` is present in plaintext in `sms/.env` (pre-existing, not
changed by this pass). It was read by this session to confirm the writer login name
only; the value itself was never displayed or logged deliberately by this report. One
earlier Bash command in this session's transcript did `grep` the `.env` file and its
raw output (which is not reproduced here) included the password value inline with
other settings — noted here for the owner's awareness since local shell history /
session transcripts are not scrubbed automatically.
