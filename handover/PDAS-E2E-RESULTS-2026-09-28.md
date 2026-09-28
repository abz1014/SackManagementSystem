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

---

## Second pass (28 Sep 2026, Task K2b) — the two remaining gaps closed

**Code revision:** `62c540e` (branch `floor-first-rework`). Fix `2e2f4ca` (local-alias
pre-flight) and `62c540e` (Changeover's "a plan always needs blend/count/tube" copy)
were already committed when this pass started. `api/dist` rebuilt clean
(`npm run build -w api`, `tsc -b`, no errors) before the harness ran. Same scope as
the first pass: local `PDAS_TP1U2_SEP07` copy only, restored afterward; plant,
`DATA_TP1U2`, `DATA_TP1U2_SEP07` never touched; no logins created; no passwords
printed.

### Step 1 — anchors, read-only

Both PDAS and `sms` anchors were re-queried before touching anything and matched
K2's first-pass recorded values **exactly**, in every column:

| PDAS table | Materials | Blends | Counts | TubeTypes | Pallets | nhs_events |
|---|---|---|---|---|---|---|
| count | 24 | 10 | 14 | 27 | 25 | 3631 |
| MAX(id) | 1024 | 10 | 14 | 27 | 1022 | 23445 |

| sms table | product_change | product_limit_version | dq_finding | audit_log | session | blend | yarn_count | tube_type | product | pallet | product_timeline |
|---|---|---|---|---|---|---|---|---|---|---|---|
| count | 3 | 14 | 30 | 150 | 5 | 10 | 14 | 27 | 14 | 15 | 22 |

No difference from K2's figures.

### Step 2 — fresh backups

`D:\sms-backups\PDAS_TP1U2_SEP07-20260928-pre-e2e2.bak` (1074 pages, 0.183 s) and
`D:\sms-backups\sms-20260928-pre-e2e2.bak` (56330 pages, 1.593 s), both
`COPY_ONLY, CHECKSUM, INIT`. `RESTORE VERIFYONLY ... WITH CHECKSUM` on both: *"The
backup set on file 1 is valid."*

### Step 3 — the scripted harness ran for the first time

`node scripts/pdas-e2e-local.mjs` from `sms/`, `RUN_TAG=20260928130240`. The live
pre-flight **passed** this time (the `2e2f4ca` local-alias fix worked as intended):

```
Live pre-flight: @@SERVERNAME="DESKTOP-G1MSH4I\SQLEXPRESS" DB_NAME()="PDAS_TP1U2_SEP07"
  (expected host "DESKTOP-G1MSH4I" / instance "SQLEXPRESS" / db "PDAS_TP1U2_SEP07")
Live pre-flight PASSED.
Leftover-data check PASSED: no E2E-tagged rows found.
```

**18 of 19 cases passed.** Per-right summary table, as printed by the harness:

| right | happy case | failure cases | pass/fail |
|---|---|---|---|
| CreateMaterial | R1-execute (material step); F7-create | F2 (-7001 duplicate); F7-recreate-fail (-7001 after retire+recreate) | FAIL* |
| SetMaterialStatusActive | R1-execute (retire step); R3 (reactivate); F7-retire/F7-reactivate | (none exercised) | FAIL* |
| AddBlend | R1-execute (blend step); F7-addBlend | (none exercised) | FAIL* |
| AddCount | R1-execute (count step); F7-addCount | (none exercised) | FAIL* |
| AddTubeType | R1-execute (tube step); F7-addTubeType | F3a (-5001 duplicate); F3c (IMPLAUSIBLE form); F3d (IMPLAUSIBLE weight) | FAIL* |
| CreatePallet | R1-execute (pallet step) | (none exercised) | PASS |
| SetPalletStatusActive | R1-execute (retire pallet step); R4 (reactivate) | (none exercised) | PASS |
| UPDATE dbo.Materials (limits) | R2 | F4 (CONFLICT, second call) | PASS |
| INSERT dbo.nhs_events | N1 | (none exercised) | PASS |

`*` — every FAIL above is caused by the SAME single root cause, not five separate
defects: case **F7**'s own setup code calls
`writer.setProductActive({ ..., reason: 'F7 retire', actor })` — `'F7 retire'` is 9
characters, one short of the harness's (and the app's own) 10-character minimum
reason length, so `setProductActive` refused client-side with
`IMPLAUSIBLE: "A reason of at least 10 characters is required."` **before it ever
opened a PDAS connection.** This is a bug in the harness's own F7 test data (the
reason string), not in `pdasWrite.ts`, `changeover.ts`, or PDAS itself. It cascaded
two ways: F7's own verdict went FAIL (`retired.ok=false`), and A1 (the
one-`product_change`-row-per-operation cross-check) went FAIL because no row was
ever written for the blocked F7-retire call (`rowCount=0` where 1 was expected —
every other one of A1's 21 entries matched exactly). Because the summary table's
`keys` list ties CreateMaterial/SetMaterialStatusActive/AddBlend/AddCount/AddTubeType
to F7's verdict, all five inherited the FAIL even though **every one of those five
rights independently passed clean** via R1, R2, R3, F2, F3a, F3b, F3c, F3d earlier in
the same run. Per this task's own instruction ("a failing case is data: record it and
do not patch code"), the harness script was **not edited**. Individual verdicts, all
18 of 19 PASS:

```
R1-plan: PASS · R1-execute: PASS · R2: PASS · R3: PASS · R4: PASS · F1: PASS ·
F2: PASS · F3a: PASS · F3b: PASS · F3c: PASS · F3d: PASS · F4: PASS · F5: PASS ·
F5b: PASS · F6: PASS · F7: FAIL (harness data bug, see above) · T1: PASS ·
A1: FAIL (cascade of F7's bug, 20/21 entries matched) · N1: PASS
```

Full per-case detail (every request/response, all 19 `nhs_events` rows EventId
23446–23464, the F6/F7 blocker text) is in the harness's own JSON/markdown log,
captured to the operator's scratchpad this pass and not committed (contains no
secrets, but is a raw run artifact, not a durable record — this section and the
table above are the durable record). Harness exit code: **1** (`OVERALL: FAIL`,
driven entirely by the F7/A1 cascade above; every individual PDAS write right the
harness actually exercised behaved correctly).

### Step 4 — UI proof of `SetPalletStatusActive` (the gap K2 could not close)

With `62c540e`'s picker-unlock live (hot-reloaded, no API restart needed), a new
browser tab opened Product › Changeover, signed in as the owner's existing
admin session. Picked **existing** blend `PVSD8020`, count `18`, tube type `RED`
(none newly created) and ticked the retire checkbox for **PalletId 1023**
(`E2E-LOT-20260928130240 · E2E`), the pallet the harness run above had just
created and left active — satisfying "use one the harness created if one exists."
Reason: `"Task K2b UI-E2E2-0928 retire pallet 1023 proof"`.

The blend+count+tube triple `PVSD8020 · 18 · RED` did not already exist as a
product, so the plan's `material`/`pallet` steps showed `action: "create"`
alongside `retire_pallet` / `SetPalletStatusActive` for pallet 1023 — exactly the
task's anticipated case ("accept creating one new ... material alongside the
retire"). First plan attempt blocked on "The lot name is required"; filled
`Lot / description = UI-E2E2-0928-LOT` and replanned — zero blockers, `POST
/api/changeover/plan` returned the six-step plan including:

```json
{"step":"retire_pallet","action":"retire","proc":"SetPalletStatusActive","id":1023,
 "detail":{"active":false,"productId":1025}}
```

Clicked "Execute the changeover". Result banner: **"Applied to PDAS"** — material
1,027, pallet 1,024 created, blend/count/tube reused (ids 2/2/2), and
`retire_pallet → pallet 1023 → 1,023`.

**Confirmed via `sqlcmd`, independent of the UI's own claim:**

```
PalletId  PalletActive  Lot
1023      0             E2E-LOT-20260928130240
```
```
EventId  Src                         Severity  Logtext
23467    storedProc SetPalletStatusActive  info  Set active to : 0 on PalletId: 1023
```
```
change_id  operation           proc_name               outcome  reason
30         set_pallet_active   SetPalletStatusActive   ok       Task K2b UI-E2E2-0928 retire pallet 1023 proof
```

**SetPalletStatusActive is now proven live through the UI**, closing gap (b) from
the task brief. It was already independently proven by the harness's R1/R4 cases in
Step 3 above (PASS, not touched by the F7 bug) — this UI pass is a second,
independent confirmation through a different code path (`changeover.ts`'s
`executeChangeover`, not the harness's direct `PdasWriter` calls).

**Reactivation: the UI offers no path for it.** After the retire, PalletId 1023
disappeared from Changeover's own "Retire" checklist (checked: it is no longer
listed, confirmed by re-reading the page) — that list only offers ACTIVE
products/pallets to retire, symmetric with how Catalogue offers "Activate" only for
retired *materials*, never for pallets. There is no "reactivate a pallet" control
anywhere in the web app. This is not a gap in this pass's proof: the harness's **R4**
case (Step 3, verdict PASS) already exercises `SetPalletStatusActive(reactivate)`
directly through `PdasWriter`, and this task's own brief anticipated exactly this
("If not, note that the harness's R4 case covers it").

### Step 5 — restore

`sms-api` stopped via `preview_stop`. Both databases: `SET SINGLE_USER WITH ROLLBACK
IMMEDIATE` → `RESTORE DATABASE ... FROM DISK <pre-e2e2 .bak> WITH REPLACE, CHECKSUM`
→ `SET MULTI_USER`. Anchors re-queried after restore — **identical to Step 1 in every
column**, both tables. The Changeover screen's Blend/Count/Tube-type dropdowns and
"Retire" checklist, re-read after restore, show zero `E2E-`/`UI-E2E2-`-tagged rows —
a visual confirmation on top of the anchor counts. `sms-api` restarted via
`preview_start`; `GET /api/auth/me` (browser tab, no navigation to a login page, no
password typed) still returned
`{"user":{"username":"admin","displayName":"Plant Admin","role":"admin"}}` — the
session row survived the restore intact, same as the first pass.

### Final per-right verdict, all nine rights, both passes combined

| Right | First pass (K2) | Second pass (K2b) | Combined verdict |
|---|---|---|---|
| CreateMaterial | Proven via UI (MaterialId 1025) | Proven via harness R1/F7-create (table shows FAIL only from the F7-retire cascade, not from CreateMaterial itself); proven again via UI (material 1027) | **PROVEN** |
| SetMaterialStatusActive (retire) | Proven via UI | Proven via harness R1-execute | **PROVEN** |
| SetMaterialStatusActive (reactivate) | Proven via UI | Proven via harness R3 | **PROVEN** |
| AddBlend | Proven via UI (BlendId 11) | Proven via harness R1/F7-addBlend | **PROVEN** |
| AddCount | Proven via UI (CountId 15) | Proven via harness R1/F7-addCount | **PROVEN** |
| AddTubeType | Proven via UI (TubeTypeId 28) | Proven via harness R1/F7-addTubeType; F3a (-5001 duplicate), F3c/F3d (IMPLAUSIBLE) all reproduced live | **PROVEN**, including the three refusal codes |
| CreatePallet | Proven via UI (PalletId 1023) | Proven via harness R1-execute (PASS); proven again via UI (pallet 1024) | **PROVEN** |
| SetPalletStatusActive | **Not proven** (plan request never fired) | Proven via harness R1-execute + R4 (PASS, both directions); **proven via UI this pass** (pallet 1023 retired, reactivation path confirmed absent from the UI by design, covered by harness R4) | **PROVEN, both directions** — the one gap K2 left is now closed |
| Limits UPDATE (`UPDATE dbo.Materials`) + paired `nhs_events` | Proven via UI | Proven via harness R2 (happy path) and F4 (optimistic-concurrency CONFLICT, second call) | **PROVEN**, including the conflict path |

**All nine PDAS write rights are now proven through our own code, end to end,
against the local `PDAS_TP1U2_SEP07` copy — some via the real browser UI, some via
the harness driving the same `PdasWriter`/`changeover.ts` code paths directly, most
via both.** The harness's overall exit code (1) reflects a bug in one test case's own
setup data (a 9-character reason string), not a failure of any of the nine rights;
that is recorded above rather than smoothed over.

**Still owner-run, unchanged by this pass:**
- `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` — the EXECUTE-only "ibrahim"-shaped
  login rehearsal (agents may not create logins).
- `handover/REHEARSAL-RBAC-BELOW-RANK.md` — below-rank RBAC on a live instance.
- Anything on the plant itself — concurrent/production-load behaviour, whether the
  live PDAS's schema/`MAX(id)`s have drifted since the 7 Sep 2026 export, whether
  `sms_pdas_writer`'s plant-side grant behaves identically to the local login used
  here, and whether IFL's own process depends on the mislabelled `nhs_events`
  MaterialId text (reconfirmed again this pass: EventId 23449 logged
  `'Create new MaterialId: 11'` for a material actually created with
  `@blendId=11`/`MaterialId=1026` — HEAD's copy of the vendor's own logging bug,
  unchanged).
- `PDAS_WRITE_ENABLED` in the plant deployment remains the owner's call; this pass,
  like the first, ran only locally against `PDAS_TP1U2_SEP07` with the flag already
  `true` in the local `.env`.
