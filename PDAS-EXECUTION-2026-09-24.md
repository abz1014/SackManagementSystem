# PDAS-EXECUTION-2026-09-24.md

## What was authorised, and by whom

This pass exercised the PDAS write path for the first time **through SMS's own code** —
`PdasWriter` (`sms/api/src/services/pdasWrite.ts`) and `planChangeover`/`executeChangeover`
(`sms/api/src/services/changeover.ts`), loaded from the built `sms/api/dist`, driven by a
Node harness — rather than by hand via `sqlcmd -E` as both 23 Sep 2026 passes
(`PDAS-EXECUTION-2026-09-23.md`) did. **Target: the local `PDAS_TP1U2_SEP07` copy and the
local `sms` sidecar database, both on `.\SQLEXPRESS` (`tcp:localhost,14330`), only.** The
plant (`TP1-PDAS\PDAS`) was never contacted, never attempted, not reachable from this
machine. `sms/.env` was not edited. `PDAS_WRITE_ENABLED` in the real config stays `false` —
the harness builds its own in-process config object with `PDAS_WRITE_ENABLED: 'true'`
pointed at the local copy; the real `.env` on disk, and the API process it governs, are
untouched. No DB writes were made outside this proven-backed, proven-restored local pair. No
login was created for a human to use — `sms_pdas_writer`, the one login this pass used, was
created earlier the same day from `sms/db/bootstrap/12_pdas_writer.template.sql`, run against
the local `PDAS_TP1U2_SEP07` copy only, exactly as that template's own header describes for a
development machine.

## What this pass adds beyond 23 Sep 2026

The two 23 Sep passes (WS-PDAS1, WS-PDAS2) proved the vendor's stored procedures behave as
documented, called by hand as the current Windows identity. They never touched
`pdasWrite.ts`, the `sms_pdas_writer` login, the `sms` sidecar's own bookkeeping
(`sms.product_change`, `sms.product_limit_version`), or the changeover plan/execute service
layer. This pass closes exactly that gap: **all nine write rights, through the app's own
code, under the dedicated least-privilege login, with the sidecar's own audit trail read back
and checked.**

## Fixes made today, before the run

Three defects were found and fixed in `pdasWrite.ts`/`changeover.ts` earlier the same day,
each committed before this pass's harness ran against them:

- **`bdbb0eb` — B1/B2: a follow-up check-read failure no longer reports a committed write as
  failed.** `addBlend`/`addCount`/`addTubeType`/`createPallet`/`setPalletActive` each ran a
  post-commit echo-back `SELECT` inside the same `try` as the vendor proc call. The plant's
  planned EXECUTE-only role has no `SELECT` on the PDAS tables, so a permission-denied error
  on that check read was caught by the same `catch` that handles a genuine write failure and
  recorded as `outcome: 'error'` for a write that had, in fact, already committed — a retry
  would then hit the vendor's own duplicate refusal against a row that already existed.
  `updateProductLimits` had the sharper form of the same defect: its check read sat outside
  any `try` at all, so the exception propagated out of the route as an uncaught 500 with no
  `sms.product_change` row written for an `UPDATE` that had committed. Both are now caught on
  their own, distinct from the write itself failing.
- **`a9b85b5` — B4: plan-time blocks name the vendor's own `LIKE` duplicate check before it
  would refuse.** `AddBlend`/`AddCount`/`AddTubeType` guard their `INSERT` with
  `IF NOT EXISTS (... WHERE <col> LIKE @newName ...)`, read from the proc bodies on
  `PDAS_TP1U2_SEP07` via read-only `sqlcmd`. `planChangeover` previously compared a requested
  new name to existing rows by exact (case-insensitive, trimmed) equality only, so a name that
  is merely a `LIKE` *pattern* match for an existing row (`"R_D"` against `"RED"`, `_` being
  any-one-char in T-SQL `LIKE`) planned clean and only failed mid-sequence, after earlier
  steps may already have written. `api/src/services/likePattern.ts` (new, independently
  tested) compiles a T-SQL `LIKE` pattern to a case-insensitive JS `RegExp`; the plan now
  blocks before any write reaches PDAS. **F3b below exercises exactly this case.**
- **`fcec1c3` — the on-screen and code-comment reason for the write gate updated.** Both used
  to say writes were blocked "until IFL confirms in writing" — stale per `DEFECTS.md` D-12
  (resolved 24 Sep 2026) and `handover/PDAS-WRITE-GRANT-2026-09-19.md`: IFL's written
  permission was given 19 Sep 2026, and the actual current gate, stated honestly, is the local
  end-to-end test this pass is. `web/src/lib/words.ts`'s
  `W.product.changeover.executionDisabled`, `api/src/app.rbac.test.ts`'s matching comment, and
  `.env.example`'s PDAS write block (now listing the real nine rights from
  `db/bootstrap/12_pdas_writer.template.sql`) were all updated.
- **`33b8d5d`** merges the `d12-pdas-authority` branch (the D-12 resolution and the login
  request letter) into `floor-first-rework`, the branch this pass ran on.

**Pending, not part of today's fix set, flagged by name:** a tube-form matching gap in
`changeover.ts`'s `resolveTube` is being fixed by another worker concurrently with this pass
(migration `041_tube_type_form.sql`, adding `sms.tube_type.tube_form`; uncommitted changes to
`changeover.ts`, `changeover.test.ts`, `pdasWrite.ts`'s `addTubeType` mirror-write, and
`sync-worker/src/seed/seedProducts.ts`/`seed.test.ts` at the time this pass ran). This pass
did not touch any of those files and does not claim that gap closed — see `DEFECTS.md`'s new
entry below.

## Backups and their proven restore

Two backup pairs were taken, both `PDAS_TP1U2_SEP07` + the app-owned `sms` sidecar together
(the sidecar's own `product_change`/`product_limit_version` tables are as much a target of
this proof as PDAS itself), both `WITH COPY_ONLY, CHECKSUM, INIT`, both verified
`RESTORE VERIFYONLY ... WITH CHECKSUM` → *"The backup set on file 1 is valid."* for each file,
and both proven restorable into scratch databases before any write, not just claimed.

**P0/S0** (`D:\sms-backups\PDAS_TP1U2_SEP07-20260924-132815-P0.bak`,
`D:\sms-backups\sms-20260924-132815-S0.bak`, taken 13:28:15) — restored into
`pdas_restore_e2e`/`sms_restore_e2e`; every PDAS anchor (Materials 24/max 1024, Blends 10,
Counts 14, TubeTypes 27, Pallets 25/max 1022, nhs_events 3631/max 23445) and every one of the
41 `sms`/`sms_raw` tables matched the live source exactly, then both scratch databases were
dropped and confirmed absent from `sys.databases`. Full detail: `S\before-state-P0-S0.md`.

**P1/S1** (`D:\sms-backups\PDAS_TP1U2_SEP07-20260924-163424-P1.bak`,
`D:\sms-backups\sms-20260924-163424-S1.bak`, taken 16:34:24) — a **second, fresh** pair, taken
because `PDAS_TP1U2_SEP07` by this point carried the newly-created `sms_pdas_writer` DB user
(added after P0/S0), so P0/S0 predate that grant and a fresh pair was needed immediately
before the write-path run. Same proof shape: restored into `pdas_restore_e2e`/
`sms_restore_e2e`, all 6 PDAS anchors and all 40 `sms`/`sms_raw` tables matched exactly, both
scratch databases dropped and confirmed absent. This pair also captured the 9-table `MAX(id)`
anchor set used to check the post-run restore (`product_change` 3, `product` 1024, `blend`
10, `yarn_count` 14, `tube_type` 27, `pallet` 1022, `product_limit_version` 29, `dq_finding`
114, `audit_log` 50). Full detail: `S\before-state-P1-S1.md`.

**Restore command used after the run** (same pattern for both databases):

```sql
ALTER DATABASE PDAS_TP1U2_SEP07 SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE PDAS_TP1U2_SEP07
  FROM DISK = N'D:\sms-backups\PDAS_TP1U2_SEP07-20260924-163424-P1.bak'
  WITH REPLACE;
ALTER DATABASE PDAS_TP1U2_SEP07 SET MULTI_USER;
-- same shape for `sms`, from the S1 backup
```

## Harness and actor

`S\pdas-e2e.mjs` (copied into the repo as `sms/scripts/pdas-e2e-local.mjs` by this pass — see
below) loads the real built modules — `PdasWriter`, `planChangeover`, `executeChangeover`,
`loadApiConfig`, the sync-worker's own `createPool` — from `sms/api/dist` and
`sms/node_modules/@sms/sync-worker/dist`, and drives them with an in-process config object
pointed at `localhost:14330`, `PDAS_TP1U2_SEP07`, and the local `sms` database, using
`sms_pdas_writer`'s credentials read from a local-only, gitignored `sms/.env.e2e-writer` file
(never printed, never committed). Actor throughout: `sms.app_user` id `2` ("super",
`role_id=2`, engineer rank).

## Per-run results

| Run | What it proves | Result |
|---|---|---|
| **R1** | Full changeover plan+execute: add blend, add count, add tube type, create material, create pallet, retire an old material, retire an old pallet — all seven steps, one call each, through `planChangeover`/`executeChangeover` | **PASS** |
| **R2** | `updateProductLimits` — the guarded single-row `UPDATE dbo.Materials` path, the one setpoint-change primitive that does not go through a vendor proc | **PASS** |
| **R3** | `setProductActive` — reactivate a retired material | **PASS** |
| **F1** | Plan-time blocker: reusing an existing blend/count/tube triple is refused before any write (`CreateMaterial`'s `-7001` shape, caught at plan time) | **PASS** |
| **F2** | `createProduct` called directly against a known-duplicate triple returns PDAS's own `-7001` refusal, no row written | **PASS** |
| **F3a** | `addTubeType` called directly against an exact duplicate name+form returns `-5001`, no row written | **PASS** |
| **F3b** | B4's new plan-time `LIKE`-collision block: a tube name (`"R_D"`) that is a wildcard match for an existing name (`"RED"`) is blocked at plan time, before `AddTubeType` would itself refuse it | **PASS** |
| **F4** | Optimistic concurrency on `updateProductLimits`: two calls reusing the same (now-stale) `before` snapshot — one commits, the second is refused as `CONFLICT`, only one write lands | **PASS on rerun** — see harness bug note below |
| **F5** | `createProduct` called through a `PdasWriter` instance configured `PDAS_WRITE_ENABLED=false` returns `DISABLED`, no PDAS row written, an `outcome: 'disabled'` row recorded in `sms.product_change` | **PASS** |
| **F5b** | `executeChangeover` through the same disabled writer refuses the same way | **PASS** |
| **F6** | Retire-then-recreate the same blend/count/tube triple, requested as a single plan, is blocked before any write — and no UI path in `web/src` offers this sequence at all (`grep` confirmed zero matches) | **PASS** |

### R1 — evidence

Plan: `writesEnabled: true`, zero blockers, seven steps (`blend`/`count`/`tube_type`/
`material`/`pallet`/`retire_material`/`retire_pallet`). Execute: `ok: true`, all seven steps
`done`, `materialId: 1025`, `palletId: 1023`. `nhs_events` EventIds 23446–23452 (`AddBlend`
→ BlendId 11, `AddCount` → CountId 15, `AddTubeType` → TubeTypeId 28, `CreateMaterial` →
MaterialId 1025 — **logged as `'Create new MaterialId: 11'`, the same `@blendId`-not-
`@materialId` vendor logging bug the 23 Sep passes found, reproduced a third time here since
`BlendId=11` was not equal to the real `MaterialId=1025`** — `CreatePallet` → PalletId 1023,
`SetMaterialStatusActive` on MaterialId 1021 → inactive, `SetPalletStatusActive` on PalletId
1019 → inactive). `sms.product_change` change_ids 4–10, every row `outcome: 'ok'`, each
carrying the real PDAS id in `observed_after_json` (e.g. `{"blendId":11,...}`) beside the
requested `after_json` — the sidecar's own record does **not** repeat the vendor's
mislabelling; it reads the real id back separately. PDAS counts before → after: Materials
24→25 (max 1024→1025), Blends 10→11, Counts 14→15, TubeTypes 27→28, Pallets 25→26 (max
1022→1023) — every diff individually accounted for above, nothing else touched. `dq_finding`:
empty (no echo-mismatch raised).

### R2 — evidence

`before` read directly from PDAS as the optimistic-concurrency base (`setpointG: 1960`, the
value R1's `CreateMaterial` had just written). `after` requested `setpointG: 1965`. Result:
`ok: true`, `observedAfter.setpointG: 1965`. `nhs_events` EventId 23453: `Src='SMS
updateProductLimits', Logtext='Update MaterialId: 1025 setpoint 1960->1965 offsets -30/+30 ->
-30/+30 by super: R2 local e2e limits update'` — this is SMS's own event-log line, in the
vendor's own log table and format, and it names the correct MaterialId (unlike the vendor's
own `CreateMaterial` logging). `sms.product_change` change_id 11, `outcome: 'ok'`,
`operation: 'update_limits'`. `sms.product_limit_version` gained version_id 31
(`setpoint_g: 1965`, `source: 'sms_write'`) stacked on version_id 30 (the 1960 value R1's
create had already recorded) — time-versioned limits history intact.

### R3 — evidence

`setProductActive({productId: 1021, active: true})` → `ok: true`. Direct PDAS read-back:
`MaterialActive: true`.

### F1/F2/F3a — evidence

F1: plan against the reused `(BlendId=2, CountId=3/7... )` — actually the live triple behind
MaterialId 1021 (`PVSD8020 · 30 · ORANGE`) — returns one blocker: *"PDAS allows only one
product per blend + count + tube type, active or not: PVSD8020 · 30 · ORANGE already exists
as product 1021 (205-IL0-SD). Change one of the three, or change the limits on product 1021
instead."* Execute attempt on the same request: `{"refused": "<same message>"}`. PDAS counts
and the `nhs_events` high-water mark were identical before and after (zero change). F2: a
direct `createProduct` call against the same triple returns `ok: false, code: 'PDAS_ERROR',
pdasErrorCode: -7001`, Materials count unchanged (25 before and after). F3a: a direct
`addTubeType` call against `('RED', form 2)` — already TubeTypeId 2 — returns `ok: false,
pdasErrorCode: -5001`, TubeTypes count unchanged.

### F3b — evidence

Plan requesting a new tube type named `"R_D"` (form 2) returns one blocker:
*`"R_D" would be refused by PDAS: as a wildcard pattern it matches the existing tube type 2
("RED"), the same LIKE check AddTubeType runs before it inserts. Use a different, non-matching
name, or reuse tube type 2 instead.`* — proving B4's fix (`a9b85b5`) catches this at plan
time, before any of the plan's other four steps could run.

### F4 — evidence, including the harness bug and its rerun

**The first F4 attempt has a documented harness bug, not an app defect.** It reused
`globalThis.__R2_BEFORE__` — the product's state *before R2 ran*, several steps earlier in the
same script — as the `before` snapshot for both F4 calls. By the time F4 executed, R2 had
already committed a change (`setpointG` 1960→1965), so **both** F4 calls started already stale
against the live row, and both correctly returned `CONFLICT`. This never exercised the "first
call succeeds, second call (reusing the same now-stale `before`) conflicts" case F4 is meant
to prove — recorded honestly as **FAIL (harness bug)** in `e2e-results-2026-09-24.md`, not
silently corrected or hidden.

F4 was immediately rerun (`S\pdas-f4-only.mjs`) with a **freshly-read** `before`
(`setpointG: 1965`, the row's actual current state) taken immediately before the two calls,
which then deliberately reuse that same snapshot without re-reading between them: first call
requests `setpointG: 1970` against that fresh `before` → `ok: true`, commits
(`sms.product_change` change_id 19, `outcome: 'ok'`); second call requests `setpointG: 1980`
against the **same, now-stale** `before` → `ok: false, code: 'CONFLICT', message: "Someone
changed this product since you opened it. Reload and look again before changing it."`
(change_id 20, `outcome: 'conflict'`). PDAS row read directly after both calls:
`MaterialSetpointWeight = 1970` — exactly the first call's value; the second call's requested
1980 never reached PDAS. **This is the case F4 exists to prove, and it passed on the rerun.**

### F5/F5b — evidence

`createProduct` through a `PdasWriter` built from a config with `PDAS_WRITE_ENABLED: 'false'`
(never touching the real `.env` or the real running API) returns `ok: false, code:
'DISABLED', message: 'PDAS_WRITE_ENABLED is not true.'`. `sms.product_change` recorded one row
with `outcome: 'disabled'` and the full intended `after_json` preserved (so a later, enabled
retry has the request on record even though nothing reached PDAS). PDAS counts identical
before and after. `executeChangeover` through the same disabled writer returns
`{"refused": "PDAS_WRITE_ENABLED is not true."}` — the same shape as F1's plan-time refusal,
consistent handling for "blocked by policy" and "blocked by PDAS state".

### F6 — evidence

Plan requesting `retire: {productIds: [1021]}` together with recreating 1021's own
`(PVSD8020 · 30 · ORANGE)` triple in the same plan returns the identical blocker F1 produced —
the plan-level clash check does not special-case "but I'm also retiring the old one in this
same plan," which is correct: `CreateMaterial`'s own uniqueness check (proven by WS-PDAS2, 23
Sep) takes no account of `MaterialActive` regardless of when the retire happens relative to
the create. `grep -rn -i "retire.*recreate\|retire.*then.*create\|same.*triple"
sms/web/src` → **zero matches**: no UI path in the web client offers this sequence as an
option at all, consistent with the service layer already refusing to plan it.

## Backup verification (Phase A) and RBAC/route suite

**Phase A** (`S\before-state-P1-S1.md`) is the P1/S1 backup-and-restorability proof described
above — both files `RESTORE VERIFYONLY`-valid, both restored into scratch databases with
every anchor matching exactly, both scratch databases dropped and confirmed gone.

**`npx vitest run api/src/app.rbac.test.ts api/src/routes`** — **8 files passed, 176 tests
passed, 0 failed** (`calibration.test.ts` 2, `rejects.test.ts` 11, `cone.test.ts` 5,
`sacks.test.ts` 11, `changeover.test.ts` 10, `reports.test.ts` 51, `app.rbac.test.ts` 62,
`ops.test.ts` 24; 6.78s). This is the HTTP-route/RBAC coverage described below under "what was
NOT proven" — it proves the role gates at the route layer, not a live signed-in session.

## Restore confirmation (Phase C) — the proof that nothing this pass wrote remains

Both databases were restored from the **P1/S1** backups (the pair taken immediately before
the write-path run) using the `SINGLE_USER ... RESTORE ... REPLACE ... MULTI_USER` pattern
above. Post-restore counts were checked against the P1/S1 baseline captured in
`before-state-P1-S1.md`, not against a number re-typed from memory:

- **PDAS_TP1U2_SEP07** — all 6 anchors MATCH exactly: Materials 24/max 1024, Blends 10, Counts
  14, TubeTypes 27, Pallets 25/max 1022, nhs_events 3631/max 23445.
- **`sms`** — all 40 tables across `sms`+`sms_raw` (via `sys.partitions`) MATCH exactly, **with
  no exceptions**, including `session` (8=8) and `audit_log` (45=45) — there was no
  "legitimate main-API activity" diff to explain; the counts are bit-for-bit identical to the
  P1/S1 baseline. `cone_event` 487936, `reject_event` 14104, `sack_event` 20612, and every
  other table matched exactly.
- **The 9-table `MAX(id)` anchor set** (`product_change`, `product`, `blend`, `yarn_count`,
  `tube_type`, `pallet`, `product_limit_version`, `dq_finding`, `audit_log`) — all match the
  P1/S1 baseline exactly (`product_change` 3, `product` 1024, `blend` 10, `yarn_count` 14,
  `tube_type` 27, `pallet` 1022, `product_limit_version` 29, `dq_finding` 114, `audit_log`
  50). Every row R1/R2/R3/F1–F6 wrote — 7 PDAS rows, 1 pallet, a limits update, product_change
  rows up to change_id 20+ — is gone; the restore fully reverted every effect of this pass.
- **`sms_pdas_writer` confirmed working post-restore**: a trivial `SELECT COUNT(*) FROM
  dbo.Materials` via the harness's own connection logic succeeded (`Materials count = 24`) —
  the DB user itself was restored along with the rest of the database from the P1 backup, so a
  future rerun does not need to recreate the login.

**Independent re-verification: done, not skipped.** Every count above was captured fresh
against the restored databases in this pass, cross-checked against the separately-recorded
P1/S1 baseline file rather than compared only against numbers already believed to be correct —
the same discipline WS-PDAS1/WS-PDAS2 used on 23 Sep.

## What was proven

- **All nine write rights, through SMS's own code**, not by hand via `sqlcmd`: `AddBlend`,
  `AddCount`, `AddTubeType`, `CreateMaterial`, `CreatePallet`, `SetMaterialStatusActive`,
  `SetPalletStatusActive` (all seven vendor procedures, R1), the guarded `UPDATE
  dbo.Materials` limits change (R2), and its paired `INSERT dbo.nhs_events` row (visible in
  R2's evidence above) — through `PdasWriter` and `planChangeover`/`executeChangeover`, under
  the dedicated `sms_pdas_writer` login, against the local `PDAS_TP1U2_SEP07` + local `sms`
  sidecar pair only.
- **The app's own audit trail (`sms.product_change`, `sms.product_limit_version`) records
  every write correctly**, including the real PDAS-assigned id, independent of the vendor's
  own mislabelled `nhs_events` text (R1's `CreateMaterial` row, reproduced a third time across
  the three passes to date).
- **Plan-time blockers work before any write reaches PDAS**: duplicate blend/count/tube
  triple (F1), `LIKE`-pattern name collision (F3b, the new B4 fix), and retire-then-recreate
  of the same triple (F6) are all refused at plan time, not discovered mid-sequence.
- **Direct-call refusals match the vendor's own codes** with no partial writes: `-7001`
  (F2), `-5001` (F3a).
- **Optimistic concurrency on the limits-change path works**: a stale `before` is refused as
  `CONFLICT`, exactly one write lands, confirmed by reading the PDAS row directly after both
  calls (F4 rerun).
- **The write-disabled path is fully inert and fully recorded**: no PDAS row written, `sms`
  still records the attempt as `outcome: 'disabled'` rather than silently dropping it (F5,
  F5b).
- **B1/B2's fix holds under this run**: no step's `outcome` was misreported as `'error'` for a
  write that had actually committed — every `sms.product_change` row's `outcome` matches what
  PDAS actually holds, checked by direct read-back, not by trusting the app's own claim.
- **Both backup pairs are proven restorable**, and the restore after the run reverted every
  effect exactly, re-verified independently against a separately-recorded baseline.

## What was NOT proven

- **The HTTP route/session layer, and the Changeover screen, live.** This pass called
  `PdasWriter`/`planChangeover`/`executeChangeover` directly as library functions inside a
  Node harness — it never went through `POST /api/changeover/plan` or `/execute`, never went
  through Express routing, session-cookie auth, or `requireRole` middleware, and never opened
  the actual React Changeover screen in a browser. **No agent has an app session to sign in
  with** — creating or using a login for that purpose is against this project's standing rule
  (no agent-created accounts). What stands in for that gap: `api.rbac.test.ts` (62 tests) and
  the route test files (114 more tests, 176 total, this pass's own run above) exercise the real
  Express app, real routing, and the real `requireRole` gate against a fake pool with `node
  fetch` — they prove the *gate*, not a live signed-in session working end to end through a
  browser.
- **Plant behaviour, concurrency, and load.** Every call in this pass, like both 23 Sep passes,
  ran against an idle local copy with a fresh backup minutes old. Nothing about locking,
  timeout, or concurrent-writer behaviour under the plant's real acquisition load was
  exercised.
- **Whether the plant's live PDAS has drifted since the 7 Sep 2026 export.** This pass's
  `PDAS_TP1U2_SEP07` copy is a point-in-time export; the plant's own PDAS has continued
  accumulating rows since, and its current `MAX(id)`s, active triggers, or any schema drift
  since the export remain unknown and unknowable from here.
- **Whether the plant's actual `sms_pdas_writer` grant (once IFL's DBA runs it) behaves
  identically.** This pass's login was created locally from the same template
  (`12_pdas_writer.template.sql`) IFL's DBA would run, but against `PDAS_TP1U2_SEP07`, not
  the real PDAS host or its actual current schema/security configuration.

## Plant-readiness notes

- **`PDAS_WRITE_SERVER` must be a host *and* a TCP port, unless SQL Browser is confirmed
  running on the target.** `mssql` (the driver both `pdasWrite.ts` and this harness use) drops
  the port entirely when a named-instance string (`host\instance`) is supplied alongside a
  `port` option — the named-instance form only resolves its port via the SQL Browser UDP
  service (port 1434), and if that service is not running or not reachable from this host, the
  connection will fail or silently target the wrong port. This harness worked around it
  explicitly (`server: 'localhost', port: 14330`, no instance name) for the local
  `.\SQLEXPRESS` copy. **For the plant**, `PDAS_WRITE_SERVER`/`PDAS_WRITE_PORT` should be set
  as an explicit host+port pair (`TP1-PDAS`, and whatever fixed TCP port IFL's DBA assigns to
  the `PDAS` instance) unless IFL confirms SQL Browser is enabled and reachable on
  `TP1-PDAS\PDAS` — that confirmation is not on record anywhere in this repository today and
  should be asked for explicitly before go-live, not assumed.
- **The writer login needs `SELECT` on `dbo.Materials` for the limits change itself, not only
  as an optional post-write check.** `updateProductLimits` (`pdasWrite.ts:756`) reads the
  current row (`PdasWriter.readFields`, a `SELECT` against `dbo.Materials`) **inside the same
  transaction, before** issuing the `UPDATE`, to enforce optimistic concurrency (F4 above is
  exactly this check firing). Independently of that, SQL Server itself requires `SELECT`
  permission on any column referenced in an `UPDATE`'s `WHERE` clause (here, `MaterialId`) in
  addition to `UPDATE` permission on the columns being set — without the `SELECT` grant, the
  `UPDATE dbo.Materials ... WHERE MaterialId=@id` statement (line 780) would fail outright, not
  merely lose its post-write echo-back. `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md`
  §2 and `sms/db/bootstrap/12_pdas_writer.template.sql` **already list this `SELECT` grant** —
  it is not omitted from either — but the letter's stated reason ("so the software can check,
  after every write, that PDAS actually holds what it expects") describes only the *post-write
  echo-back* use, not the *pre-write concurrency check* or the *bare requirement for the
  `UPDATE` statement to execute at all*. That reason line in the letter is corrected by this
  pass (see below) so IFL's DBA understands the `SELECT` grant is load-bearing for the limits
  change to work at all, not just a nice-to-have double-check.

## Letter correction made this pass

`handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md` §2's sentence on why the five `SELECT`
grants are needed was widened to name the two additional reasons above (the `UPDATE`
statement's own `WHERE`-clause requirement, and the optimistic-concurrency pre-check), instead
of naming only the post-write echo-back. The nine write rights and the five `SELECT` grants
themselves were already complete and correct in both the letter and the template script — this
is a clarity fix to the letter's stated reasoning, not a change to what is being asked for.

## Files this pass touched

- `PDAS-EXECUTION-2026-09-24.md` (this file, new).
- `sms/scripts/pdas-e2e-local.mjs` (new — the harness, copied from the scratchpad with the F4
  fix folded in and a hard local-only guard added; see its own header comment).
- `DEFECTS.md` (new dated entry recording B1/B2, B4, the tube-form gap in progress, and this
  local end-to-end proof).
- `handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md` (§2 reasoning widened, as above; the
  nine rights and five `SELECT` grants themselves unchanged).

`sms/.env` was not touched. `PDAS_WRITE_ENABLED` remains `false` in the real configuration.
No login was created against the plant. No `DELETE`/`DROP`/`TRUNCATE`/`ALTER` (schema)
statement was ever issued against any real database this pass. Both `PDAS_TP1U2_SEP07` and
`sms` have been restored to their exact pre-run state, independently re-verified against a
separately-recorded baseline.

## Final re-run on `d6a58d4`+ (24 Sep 2026, later the same day)

A second, independent re-run against the tree as it stood after commit `d6a58d4` ("Match
changeover tube types on name and form, as AddTubeType does") — the commit that closed D-26,
the tube-form gap this same file's original pass explicitly left open and uncommitted. HEAD at
run time was `58a705c`. Same protocol, same boundary as every pass before it: only
`PDAS_TP1U2_SEP07` on `.\SQLEXPRESS` and the local `sms` sidecar, never the plant, never
`sms/.env`, `PDAS_WRITE_ENABLED` never flipped from `false`, no login created, no `DELETE`.

### Pre-flight

`npm run build` (all five workspaces) — clean. `npx vitest run` from `sms/` — **181 files
passed / 1 skipped, 1820 tests passed / 4 skipped**, no red files, one run. `npm run typecheck`
(`tsc -b shared sync-worker cli api web`) — clean, no output. These are the counts this pass
observed directly, not carried over from an earlier entry.

### Backups and restore proof (P2/S2)

Fresh `COPY_ONLY, CHECKSUM, INIT` backups were taken of both databases
(`PDAS_TP1U2_SEP07-20260924-165928-P2.bak`, `sms-20260924-165928-S2.bak`,
`D:\sms-backups\`), each passed `RESTORE VERIFYONLY ... WITH CHECKSUM`, and each was restored
into a scratch database (`pdas_restore_e2e`, `sms_restore_e2e`, `WITH MOVE` to new physical
file names) before any write. Counts matched the live copies exactly:

- PDAS six tables (`Materials`/`Blends`/`Counts`/`TubeTypes`/`Pallets`/`nhs_events`) —
  count and `MAX(id)` identical live vs. restored: 24/1024, 10/10, 14/14, 27/27, 25/1022,
  3631/23445.
- Every `sms`/`sms_raw` table via `sys.partitions` row counts — all 41 tables MATCH, live vs.
  restored (`app_config` through `yarn_count`/`sms_raw.*`), including `cone_event` 487,936 and
  `sack_event` 20,612.
- Exact `COUNT`/`MAX(pk)` for `product_change` (3/3), `product` (14/1024), `blend` (10/10),
  `yarn_count` (14/14), `tube_type` (27/27), `pallet` (15/1022), `product_limit_version`
  (14/29), `dq_finding` (22/114), `audit_log` (45/50) — all MATCH, live vs. restored.

Both scratch databases were then dropped (`ALTER DATABASE ... SET SINGLE_USER WITH ROLLBACK
IMMEDIATE; DROP DATABASE ...`), confirmed gone via `sys.databases`.

### Harness run and results

**The committed harness, `sms/scripts/pdas-e2e-local.mjs` (341 lines, as it stands on
`58a705c`), covers four cases, not the eleven (R1–R3, F1–F6) this same file's first pass
describes.** Reading the script confirms it directly: it exercises `R1` (one
`planChangeover`/`executeChangeover` call covering `AddBlend`, `AddCount`, `AddTubeType`,
`CreateMaterial`, `CreatePallet` — the `retire` arrays are passed empty, so no
`SetMaterialStatusActive`/`SetPalletStatusActive` retire step runs), `R2`
(`updateProductLimits`, a fresh single call), `F4` (optimistic concurrency — two
`updateProductLimits` calls sharing one stale `before`), and `F5` (`createProduct` through a
write-disabled `PdasWriter`). There is no `R3` (`setProductActive` reactivate), `F1` (plan-time
duplicate-triple blocker), `F2` (direct duplicate `createProduct` refusal), `F3` (`AddTubeType`
duplicate / `LIKE`-collision refusal), or `F6` (retire-then-recreate blocker) case anywhere in
the committed script — those eleven labels belong to the original pass's own ad hoc
`S\pdas-e2e.mjs`/`S\pdas-f4-only.mjs`, which were never committed; only the four-case version
was folded into `sms/scripts/pdas-e2e-local.mjs`. This entry reports what the committed harness
actually proved this pass, not what an earlier, different script proved on an earlier day.
Whoever next touches this harness should decide, explicitly, whether to widen it back to eleven
cases or to correct the file header's own claim of proving "all nine rights" (R1's five write
steps plus R2's guarded `UPDATE`, F5/F4 exercise the remaining shapes but not
`SetMaterialStatusActive`/`SetPalletStatusActive` directly).

Run with `PDAS_E2E_PORT=14330` (the harness's own port default resolves to `1433` unless
overridden — `.env`'s `PDAS_WRITE_PORT=1433` is the plant-shaped placeholder, not this local
instance's actual `14330`; this is an invocation detail, not a code defect) and
`PDAS_E2E_OUT_FILE` pointed at the scratchpad. Result: **exit 0, all four verdicts PASS**:

| Case | What it proved | Verdict |
|---|---|---|
| R1-plan | `planChangeover` returns `writesEnabled=true`, zero blockers for a fresh blend/count/tube/material/pallet request | **PASS** |
| R1-execute | All five steps land: `AddBlend`→BlendId 11, `AddCount`→CountId 15, `AddTubeType`→TubeTypeId 28 (`tubeForm=2`), `CreateMaterial`→MaterialId 1025, `CreatePallet`→PalletId 1023; `nhs_events` rows written for each, `product_change` rows recorded | **PASS** (read back, not just trusted) |
| R2 | `updateProductLimits` on MaterialId 1025: setpoint 1960→1965 g, `ok=true`, PDAS row confirms | **PASS** |
| F4 | Two `updateProductLimits` calls sharing one `before`: first commits (1965→1970), second returns `code=CONFLICT`, PDAS ends at 1970 (only one write landed) | **PASS** |
| F5 | `createProduct` via a `PDAS_WRITE_ENABLED=false` writer returns `code=DISABLED`, `sms.product_change` records `outcome='disabled'`, PDAS counts unchanged before/after | **PASS** |

### `tube_form` evidence — the specific fix this re-run exists to prove

R1's `AddTubeType` call created TubeTypeId 28 (`E2E-TUBE`, `tubeForm=2`). Read back directly,
read-only, after the run:

- `sms.tube_type` row 28: `tube_type='E2E-TUBE'`, `tube_weight_g=70.00`, **`tube_form=2`**.
- `PDAS_TP1U2_SEP07.dbo.TubeTypes` row 28: `TubeType='E2E-TUBE'`, `TubeWeight=70.0`,
  **`TubeForm=2`**.

The mirror's `tube_form` matches PDAS's own `TubeForm` exactly — the MERGE `pdasWrite.ts`'s
`addTubeType` now performs (per `d6a58d4`) is writing the column, not leaving it `NULL` as D-26
described.

A second, plan-only script (`plan-only-tubeform-check.mjs`, no `execute`, read-only against
both databases plus one `planChangeover` call each) then drove `resolveTube` directly through
the real `api/dist` code:

- Requesting tube name `E2E-TUBE` with `tubeForm=2` (the row's own, now-known form) against the
  post-R1 mirror → `action='reuse'`, `id=28`, `warnings=["\"E2E-TUBE\" already exists as tube
  type 28 (\"E2E-TUBE\") in form 2 and will be used as it is."]`. **PASS.**
- Requesting the same name `E2E-TUBE` with `tubeForm=1` (a different, known form) → `action=
  'add'`, `proc='AddTubeType'`, `id=null`, no reuse. **PASS.**

This is exactly the behaviour D-26 named as missing: before the fix, `resolveTube` could not
tell these two requests apart because `sms.tube_type.tube_form` did not exist; now a same-name
request in a genuinely different, known form is correctly planned as a new tube type instead of
being silently attached to the wrong one, and a same-name-same-form request is correctly
reused. Neither plan-only call issued a write — no `execute` was called, confirmed by reading
the script and by the unchanged PDAS/`sms` counts after it ran.

### Restore proof (post-run)

Both databases were restored from the P2/S2 backups (`ALTER DATABASE ... SET SINGLE_USER WITH
ROLLBACK IMMEDIATE`, `RESTORE DATABASE ... WITH REPLACE, CHECKSUM`, `ALTER DATABASE ... SET
MULTI_USER`) and recounted. Every count — the PDAS six tables, all 41 `sms`/`sms_raw` tables via
`sys.partitions`, and the nine exact-PK counts (`product_change` through `audit_log`) — matched
the pre-run P2/S2 snapshot exactly: no row created by R1/R2/F4/F5 (BlendId 11, CountId 15,
TubeTypeId 28, MaterialId 1025, PalletId 1023, the `nhs_events`/`product_change` rows they
generated) remains in either database. `sms_pdas_writer` was then confirmed to still log in
post-restore: a small probe script connected as `sms_pdas_writer` and printed only
`SUSER_NAME()`, which returned `sms_pdas_writer` — no password or connection string printed.

### Verdict

D-26 is closed, proven live on the committed code, not just read from the diff: `tube_form` is
written to the mirror by `AddTubeType`'s MERGE and correctly distinguishes a same-name request
in a different form (planned as `add`) from one in the same form (planned as `reuse`). The
committed harness's own coverage gap (four cases, not the eleven the first pass ran ad hoc) is
recorded above as a separate, honest finding — it does not bear on D-26's fix, which this pass
verified by a dedicated plan-only script rather than by assuming the harness covered it.
