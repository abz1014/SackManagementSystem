# PDAS-EXECUTION-2026-09-23.md

## What was authorised, and by whom

The owner, in this session (23 Sep 2026), explicitly authorised the first
execution in this project's history of PDAS stored procedures — **against
the local attached copy `PDAS_TP1U2_SEP07` on `.\SQLEXPRESS` only**, never
the plant (150 km away, unreachable from this laptop, not attempted).
`PDAS_WRITE_ENABLED` was not touched and stays `false`; `.env` was not
edited; `/api/changeover/execute` was never called; no login was created,
reset or guessed — all execution used the current Windows identity via
`sqlcmd -E`.

## Backup and its proven restore

- **Backup taken before any execution:**
  `D:\sms-backups\PDAS_TP1U2_SEP07-20260923-195411-preexec.bak` (8,900,608
  bytes; `BACKUP DATABASE PDAS_TP1U2_SEP07 ... WITH CHECKSUM, INIT`).
- **Verified:** `RESTORE VERIFYONLY FROM DISK = N'<path>' WITH CHECKSUM` →
  "The backup set on file 1 is valid."
- **Restorability proven before any write**, not just claimed: restored into
  a scratch database `pdas_restore_test` (`RESTORE DATABASE ... WITH MOVE ...
  MOVE ...`), row counts checked (Materials 24, Blends 10, Counts 14,
  TubeTypes 27, Pallets 25, nhs_events 3631 — all matching the live copy),
  then the scratch database was dropped (`ALTER DATABASE ... SET
  SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ...`).
- **Restore command used to revert the live copy after testing** (see
  below):
  ```sql
  ALTER DATABASE PDAS_TP1U2_SEP07 SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  RESTORE DATABASE PDAS_TP1U2_SEP07
    FROM DISK = N'D:\sms-backups\PDAS_TP1U2_SEP07-20260923-195411-preexec.bak'
    WITH REPLACE;
  ALTER DATABASE PDAS_TP1U2_SEP07 SET MULTI_USER;
  ```

## Before-state (live `PDAS_TP1U2_SEP07`, pre-execution)

| Table | Count | Max id |
|---|---|---|
| Materials | 24 | 1024 |
| Blends | 10 | 10 |
| Counts | 14 | 14 |
| TubeTypes | 27 | 27 |
| Pallets | 25 | 1022 |
| nhs_events | 3631 | 23445 |

## Executions, verbatim inputs and outputs

All five calls ran in one `sqlcmd -i` batch against `PDAS_TP1U2_SEP07`,
current Windows identity, no other database touched.

**Test 1 — `AddTubeType`, fresh name.**
Input: `@tubeType='PDAS_TEST_TUBE_23SEP'`, `@tubeForm=1`, `@tubeWeight=55.5`.
Output (confirmed by direct row read, since the batch's own PRINT after this
call did not surface — see "surprise" note below): row inserted,
`TubeTypeId=28`, `TubeType='PDAS_TEST_TUBE_23SEP'`, `TubeForm=1`,
`TubeWeight=55.5`. `nhs_events` EventId 23446: `Src='storedProc
AddTubeType', Severity='info', Logtext='Add new TubeTypeId: 28'`. Function
return value == the new id (per the proc body's `RETURN @typeTypeId`).

**Test 2 — `AddTubeType`, exact duplicate of Test 1.**
Same inputs. Output: `ret=-1`, `@error=-5001`, `@errorMsg='Tube Form already
exist'`, `@typeTypeId=NULL`. Server-side `PRINT 'TubeType exist already'`
also fired. `nhs_events` EventId 23447: `Src='storedProc AddTubeType',
Severity='error', Logtext='-5001: Tube Form already exist'`. No row
inserted.

**Test 3 — `CreateMaterial`, duplicate of the pre-existing combo
(BlendId=1, CountId=1, TubeTypeId=1 — MaterialId 1, already present before
any test ran).**
Input: `@blendId=1, @countId=1, @tubeTypeId=1, @materialSetpointWeight=100,
@materialWeightOffsetMinus=5, @materialWeightOffsetPlus=5,
@materialActive=0, @materialDesc1='PDAS_TEST_DUP'`.
Output: `ret=-1`, `@error=-7001`, `@errorMsg='Material already exist'`,
`@materialId=NULL`. `nhs_events` EventId 23448: `Src='storedProc
CreateMaterial', Severity='error', Logtext='-7001: Material already
exist'`. No row inserted.

**Test 4 — `CreateMaterial`, fresh combo** (BlendId=1, CountId=2,
TubeTypeId=28 — the tube type created in Test 1; this exact
Blend/Count/TubeType triple had never existed).
Input: `@blendId=1, @countId=2, @tubeTypeId=28,
@materialSetpointWeight=123.4, @materialWeightOffsetMinus=5,
@materialWeightOffsetPlus=5, @materialActive=0,
@materialDesc1='PDAS_TEST_NEW'`.
Output (confirmed by direct row read): row inserted, `MaterialId=1025`,
`BlendId=1, CountId=2, TubeTypeId=28, MaterialSetpointWeight=123.4,
MaterialWeightOffsetMinus=5, MaterialWeightOffsetPlus=5, MaterialActive=0,
MaterialDesc1='PDAS_TEST_NEW'`. `nhs_events` EventId 23449:
`Src='storedProc CreateMaterial', Severity='info', Logtext='Create new
MaterialId: 1'`.

**Test 5 — `CreateMaterial`, duplicate of Test 4's combo.**
Same Blend/Count/TubeType triple, different desc/weights (`@materialDesc1=
'PDAS_TEST_DUP2'`, `@materialSetpointWeight=999`).
Output: `ret=-1`, `@error=-7001`, `@errorMsg='Material already exist'`,
`@materialId=NULL`. `nhs_events` EventId 23450: `Src='storedProc
CreateMaterial', Severity='error', Logtext='-7001: Material already
exist'`. No row inserted.

**A surprise, reported rather than guessed past:** the client-side `PRINT`
lines this script placed immediately after Test 1's and Test 4's
(successful) `EXEC` calls did not appear in `sqlcmd`'s output, while the
identical `PRINT` pattern after Tests 2/3/5 (the refusal paths) did appear.
The server-side effects (the inserted rows, the `nhs_events` rows, the
`RETURN` value convention) are unaffected and were confirmed independently
by reading the rows back directly — the finding is cosmetic, in how
`sqlcmd` interleaves batch-level `PRINT` output around a stored procedure's
own internal work, not in the procedures' behaviour. Not investigated
further since it does not bear on any of the four questions.

## What each of the four beliefs turned out to be

1. **The duplicate-refusal code — resolved, and the premise "which is
   right?" was a false dichotomy.** Both `-5001`/`-5002`/`-5003` (from
   `pdasWrite.ts`/`CLAUDE.md`, read from proc bodies) and `-7001` (observed
   in `nhs_events` from 18 Aug 2026) are real and simultaneously correct —
   **they belong to different procedures.** `-5001` = `AddTubeType`'s
   duplicate refusal ("Tube Form already exist"); `-5002` = `AddTubeType`'s
   invalid-form check; `-5003` = `AddTubeType`'s invalid-weight check (all
   confirmed by reading and executing the proc body). `-7001` =
   `CreateMaterial`'s duplicate refusal ("Material already exist"),
   confirmed by Tests 3 and 5, and it is exactly what the 18 Aug 2026
   `nhs_events` rows (23204/23206/23207/23208) show — because those events
   were logged by `CreateMaterial`, not `AddTubeType`. Both documented
   beliefs were correct all along; the "which is right" framing conflated
   two different procedures.
2. **`AddTubeType`'s runtime behaviour — now observed, matches the read
   signature exactly.** Test 1 created `TubeTypeId=28` with the given
   `@tubeType`/`@tubeForm`/`@tubeWeight`, logged an `nhs_events` info row,
   and returned the new id both via the `@typeTypeId` OUTPUT parameter and
   the procedure's `RETURN` value. Test 2 (same name+form) refused with
   `-5001`, confirming the uniqueness check is `(TubeType, TubeForm)`
   together — a *different* form with the same name would not collide (not
   tested; inferred directly from `WHERE TubeType LIKE @tubeType AND
   TubeForm = @tubeForm` in the body, which Test 1/2 already exercises the
   relevant half of).
3. **`CreateMaterial` logs the blend id where its own text says
   MaterialId — confirmed, exactly as suspected.** Test 4 inserted
   `MaterialId=1025` (verified by direct row read) but the `nhs_events` row
   it wrote (EventId 23449) reads `'Create new MaterialId: 1'` — that `1`
   is `@blendId` (which was `1` in this test), not `1025`. The proc body
   confirms the cause: `INSERT INTO nhs_events (...) VALUES (...,
   'Create new MaterialId: ' + CAST(@blendId AS NVARCHAR))` — a
   copy-paste bug in the vendor's own logging, not a materialId computed
   incorrectly. **Any downstream code or human reading this log line as the
   created MaterialId will be wrong whenever BlendId != the real
   MaterialId** — which is every row except by coincidence (as it was
   here).
4. **Whether retire-and-recreate works — not exercised this pass, and
   correctly scoped out.** No `SetMaterialStatusActive` call was made, so
   whether a retired-then-recreated duplicate still refuses was not tested.
   What Tests 3 and 5 *do* establish is that `CreateMaterial`'s uniqueness
   check (`WHERE BlendId=@b AND CountId=@c AND TubeTypeId=@t`, from the
   proc body) takes no account of `MaterialActive` at all — it is a bare
   existence check over the three key columns regardless of active status.
   That is visible directly in the body text (already quoted in the
   19/21 Sep record) and this pass's executions are consistent with it,
   but a retire-then-recreate round trip specifically was not run — doing
   so would have required a `SetMaterialStatusActive` call, judged not
   part of the minimum set needed to answer the other three questions, and
   left out to keep the write footprint smaller. **Still open, needs a
   dedicated pass if IFL's H6 field notes are to be resolved further.**

## After-state and diff

| Table | Before | After | Diff |
|---|---|---|---|
| Materials | 24 (max 1024) | 25 (max 1025) | **+1**, id 1025 |
| Blends | 10 (max 10) | 10 (max 10) | none |
| Counts | 14 (max 14) | 14 (max 14) | none |
| TubeTypes | 27 (max 27) | 28 (max 28) | **+1**, id 28 |
| Pallets | 25 (max 1022) | 25 (max 1022) | none |
| nhs_events | 3631 (max 23445) | 3636 (max 23450) | **+5**, ids 23446–23450 |

Every added row is individually identified above (Materials id 1025,
TubeTypes id 28, nhs_events ids 23446–23450) — nothing else in the database
was touched. No `DELETE`, `DROP`, `TRUNCATE` or `ALTER` (schema) statement
was ever issued.

## Restore confirmation

The live copy was restored from the pre-execution backup
(`RESTORE DATABASE PDAS_TP1U2_SEP07 ... WITH REPLACE`, single-user during
restore, multi-user after). Post-restore counts:

| Table | Post-restore | Matches before-state? |
|---|---|---|
| Materials | 24 (max 1024) | yes |
| Blends | 10 (max 10) | yes |
| Counts | 14 (max 14) | yes |
| TubeTypes | 27 (max 27) | yes |
| Pallets | 25 (max 1022) | yes |
| nhs_events | 3631 (max 23445) | yes |

Directly re-checked: `SELECT COUNT(*) FROM TubeTypes WHERE
TubeType='PDAS_TEST_TUBE_23SEP'` → 0; `SELECT COUNT(*) FROM Materials WHERE
MaterialDesc1='PDAS_TEST_NEW'` → 0. **The copy is back to its exact
before-state; none of this pass's writes remain.**

## What is now known that was previously only read

- The `-5001`/`-5002`/`-5003` vs `-7001` "conflict" was never a conflict —
  they are two procedures' distinct error codes, both real, both correctly
  documented, now both observed firing exactly as their body text says.
- `AddTubeType`'s full runtime path — success (insert + OUTPUT id + RETURN
  value + info log) and refusal (no insert + `-5001` + error log) — is now
  observed, not just read from `sys.parameters` and body text.
- `CreateMaterial`'s duplicate refusal (`-7001`, no insert) is now observed
  directly, matching the 18 Aug field evidence exactly.
- **`CreateMaterial`'s `nhs_events` info-log line names the wrong id** — a
  confirmed vendor bug (logs `@blendId` under the label "MaterialId"), not
  a hypothesis. Any tooling or person auditing PDAS activity via
  `nhs_events` text alone (rather than the real `MaterialId` OUTPUT/return
  value) will misattribute created rows whenever `BlendId != MaterialId`,
  which is true for effectively every row.

## What still cannot be known without the plant

- **Retire-and-recreate** (`SetMaterialStatusActive` followed by a repeat
  `CreateMaterial` call) was not exercised this pass — see point 4 above.
- **Concurrent/production load behaviour** — this was one Windows-auth
  session against an idle local copy with a fresh backup seconds old;
  nothing about locking, timeout, or concurrent-writer behaviour under the
  plant's real acquisition load was touched.
- **Whether the live PDAS's actual data matches this Sep-07 copy's
  identity ranges, constraints or trigger behaviour** — this copy is a
  point-in-time export; the plant's PDAS has continued to accumulate rows
  since 7 Sep 2026 and its current `MAX(id)`s, active triggers, or any
  schema drift since the export are unknown and unknowable from here.
- **Whether SMS's own `sms_pdas_writer` login (not yet created) would
  encounter any different behaviour** — every call in this pass ran as the
  current Windows identity via `sqlcmd -E`, not through the app's own
  connection path, `PROC_PARAMS` binding in `pdasWrite.ts`, or its
  `PDAS_WRITE_ENABLED`/`PDAS_WRITE_RANK` gate — none of that code path was
  exercised.
- **Whether the plant expects/relies on the mislabeled `nhs_events` log
  text** — if any operational process at IFL reads that log column
  expecting a MaterialId, this pass shows it has been silently wrong since
  the procedure was written; confirming whether anyone actually depends on
  it needs IFL, not this copy.

`PDAS_WRITE_ENABLED` remains `false`. No PDAS procedure has ever been
executed against any database SMS itself connects to, or against the
plant, at any point — this pass ran entirely by hand via `sqlcmd -E`
against the local `PDAS_TP1U2_SEP07` copy, and that copy has been restored
to its exact pre-execution state.
