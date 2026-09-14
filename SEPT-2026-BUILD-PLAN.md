# SMS — September 2026 build plan

**Written 11 Sep 2026.** From step zero to done. Three goals, in the owner's own
priority order:

1. Get IFL's September data **into our database, appended**, so the software can
   be validated against it.
2. Evaluate **everything Hassan sent** and change the software to match.
3. Build the **Add / Edit product** capability — confirmed required: IFL's process
   engineers currently hand-write SQL against PDAS, and our software must replace
   that with a button.

---

## The one design decision everything else rests on

**September is appended, not swapped in.** July (22 Jun – 10 Jul) and September
(5 Aug – 7 Sep) do not overlap in time. They collide only because IFL rebuilt the
tables on 5 Aug and **both datasets number their rows from `id = 1`**.

The wrong fix is to wipe one. The right fix is to teach the app that a source has
**generations** — a `source_epoch` discriminator — so both live in the sidecar
permanently.

This matters beyond convenience. IFL's live tables hold roughly one month at a
time, so **long-term history has to live in the sidecar** — which is exactly what
the sidecar architecture was chosen for. Building epochs makes that true instead
of aspirational.

> **Correction, 11 Sep 2026.** An earlier draft said 26 days (10 Jul – 5 Aug) were
> *permanently lost* and that our sidecar held the only surviving copy. **That was
> wrong.** It was inferred from the sample Hassan sent, and stated as a fact about
> the plant. The owner confirms the data exists at IFL — it simply was not
> included in the drop. It is a **sampling gap, not a data loss**, and the fix is
> to ask for it. The 5 Aug drop-and-recreate and the identity reset are unaffected:
> those come from `sys.tables.create_date`, not from the gap.

**The missing window belongs to epoch 1, and something is currently squatting on
its id space.** The July sample ends at cone `id = 142,511`. Rows for 10 Jul –
5 Aug came from that *same* table generation, so they carry ids from **142,512**
upward. Our simulator was seeded to start at exactly **142,512**. So the synthetic
rows do not merely overlap the September window in time — they occupy the precise
id range the real missing data needs. Removing them is a prerequisite for ever
loading it, not just housekeeping.

Consequence: **`sms cutover` is no longer needed to absorb a source rebuild.** It
stays only for a deliberate "throw everything away" reset. Nothing gets deleted
to complete this plan.

---

## Step 0 — Record the decisions, and make it safe

| | Decision |
|---|---|
| **D-1** | The sidecar is the **archive of record**. IFL's source retains ~1 month. |
| **D-2** | **September is the target schema.** The July shape is not supported — it is gone from IFL's live server, and supporting both would mean a reader that cannot tell a schema change from a misconfiguration. |
| **D-3** | **Append, never replace.** Source generations coexist via `source_epoch`. |
| **D-4** | **Writes to PDAS are in scope**, via the vendor's own stored procedures only, behind an off-by-default flag, fully audited. Client-confirmed 11 Sep 2026. Still to be confirmed by IFL **in writing** before it is switched on in the plant. |

Safety before any schema change:

- Snapshot `cone_event` / `sack_event` / `reject_event` to side tables.
- Confirm the July sample (`DATA_TP1U2`, ONLINE) and `SPS.rar` are intact — they
  are the recovery path for everything epoch-1.
- Commit the current working tree to `floor-first-rework` (33 files, uncommitted).

---

## Step 1 — Source epochs (the coexistence key)

**Migration 025.**

- New `sms.source_epoch`: `epoch_id`, `line_id`, `source_table`,
  `source_created_utc`, `first_seen_utc`, `label`, `note`. One row per
  (line, table, generation).
- `source_epoch INT NOT NULL DEFAULT 1` on the four `sms_raw` tables and the three
  canonical tables; existing rows backfilled and **labelled honestly** (see below).
- Raw uniqueness moves from `(line_id, src_id)` → `(line_id, source_epoch, src_id)`.
- Canonical dedupe moves from `source_row_id` → `(source_system, source_epoch,
  source_row_id)`.

**Code.**

- `store.ts` — watermark becomes per-epoch.
- `runner.ts` — resolve the current epoch from the source table's `create_date`;
  an unrecognised one **registers a new epoch and logs it loudly** rather than
  halting, so a legitimate vendor rebuild keeps running. The
  watermark-above-source-max gate stays, now scoped per epoch, to catch a
  *restore* (same `create_date`, ids rewound) which epoch registration cannot see.
- `persistRaw.ts` / `persistCanonical.ts` — epoch-aware dedupe.
- `verify.ts` — its contract changes: it currently reconciles source vs raw vs
  canonical by `COUNT(*)`, which will now **always** mismatch, because the app DB
  holds two generations and the live source holds one. It must reconcile
  **per-epoch**.

**Honest labelling of the existing 204,076 rows — measured 11 Sep 2026.** They are
**two different things**, and calling them one epoch would be a fiction:

| Band | cone_event | sack_event | Covers |
|---|---|---|---|
| `source_row_id` ≤ July max | 142,511 | 5,462 | 1970-01-01 → **2026-07-10** — the real July sample |
| above it | 61,565 | 2,739 | **2026-08-26 → 2026-09-03** — simulator-generated |

**The synthetic rows overlap the real September window (5 Aug – 7 Sep).** If they
stay, every time-range query over September blends invented readings with IFL's
actual ones — which destroys the validation this whole exercise is for. Synthetic
data has no business in a database being used to validate against real data.

So the epoch layout is:

| Epoch | Contents | Action |
|---|---|---|
| **1** | Pre-rebuild generation — real IFL data, 22 Jun – 5 Aug (ids 1 → ~180k) | **KEEP**; today we hold 22 Jun – 10 Jul, the rest is still to come from IFL |
| **2** | Post-rebuild generation — real IFL data, 5 Aug – 7 Sep (ids 1 → 132,552) | **ADD** |
| — | simulator rows, 26 Aug – 3 Sep, ids 142,512+ | **REMOVE** |

Epoch 1 is deliberately defined as *the generation*, not *the sample*. When IFL
sends 10 Jul – 5 Aug it slots straight into epoch 1 by id, with no migration and
no special case — the per-epoch watermark simply advances.

The removal is 61,565 cones + 2,739 sacks + their rejects. All synthetic, never
real, and regenerable on demand from the seeded RNG (`rng(20260902)`). Cleanly
identifiable by `source_row_id` band *and* by date — the two bands do not touch.
No real data is deleted at any point in this plan.

---

## Step 2 — Ingest the real September data

Point the reader at **`DATA_TP1U2_SEP07`** (read-only) rather than the simulator:
it is IFL's actual September data, which is what "validate against this data"
means.

- Register it as a new epoch.
- `sms sync` → raw → canonical.
- Verify: both epochs present, per-epoch counts reconcile, 26-day hole visible and
  correctly reported rather than silently smoothed over.

Already done for this step (uncommitted): `iflTables.ts` on the September schema,
migration 024 (`src_Source`→`src_MachineNo`, `src_MaterialId` added, `material_id`
on `reject_event`, three indexes), and the simulator moved to the September shape.

---

## Step 3 — Product attribution (the OQ-1 unlock)

`MaterialId` is populated on 100% of September rows and joins to
`PDAS.dbo.Materials`. This retires `NullAttribution`, which was never a choice —
it was forced by "the two databases cannot be joined".

- `transform.ts` — `attribution()` already written: `material_id` from
  `src_MaterialId`, `attribution_method: 'source_column'`, confidence `high`.
  Rows from before the rebuild keep `none`/null, because their product is
  genuinely unknown and inventing one would apply today's product to weeks-old
  readings — the exact bug CLAUDE.md rule 1 exists to prevent.
- Re-seed `sms.product` from `PDAS_TP1U2_SEP07`. The current mirror is from July
  and **believes two retired materials are live** (17, 18); September has six
  active (20, 21, 1021–1024).
- Per-cone limits: each cone is judged against **its own material's**
  `MaterialSetpointWeight ± MaterialWeightOffsetMinus/Plus`. Tolerances really do
  vary (±30/±40/±50 in the data).
- **Retire the single line-wide "Current Product" selector.** Up to six materials
  run concurrently on different machines; one global picker is structurally wrong
  and one wrong pick reportedly turns 53 out-of-limit cones into 906.
- Keep CLAUDE.md rule 1 intact: the scale's own in-range bit stays the primary
  flag; product tolerance remains a second, separately-named fact.

---

## Step 4 — Evaluate everything Hassan sent

- **66 findings** in `SEPT-2026-DB-FINDINGS-RAW.md` → triage each into *fix now* /
  *defer* / *ask IFL*, and act on the first group.
- **`P-DAS Program (1).xlsx`** — the operating procedure the process engineer
  follows today (Get Blends → Get Count → Get Tube Type → Create Material →
  Create Pallet). **This is the specification for the Add/Edit UI in step 5.**
- **The 10 screenshots** — the vendor's own screen conventions and the live
  `GetAllPallets` output shape.
- **`Sack Packing…docx`** — network topology. Deferred by the owner; it is an
  infrastructure scope item, not software. Recorded, not built.

---

## Step 5 — Add / Edit product (the write path)

Confirmed required. Design constraints, all verified from the proc bodies:

- **Vendor procs only** — `AddBlend`, `AddCount`, `AddTubeType`, `CreateMaterial`,
  `CreatePallet`, `SetMaterialStatusActive`, `SetPalletStatusActive`. They write
  IFL's own `nhs_events` audit trail, and the new MaterialId reaches the QCS panel
  the operator actually looks at. A direct `UPDATE` would do neither.
- **There is no UPDATE proc.** "Edit setpoint" is *impossible* through the vendor
  API. Underneath, an edit is **retire + create**, which mints a **new
  MaterialId** — and every future cone is stamped with it. The UI must say this
  plainly rather than pretending an in-place edit happened.
- **A second, separately-configured write connection.** The sync login stays
  read-only by policy. Absent write credentials ⇒ the UI degrades to read-only,
  never crashes. No hardcoded credentials (rule 1).
- **Rails:** RBAC rank, off-by-default flag, our own audit row per call,
  double-submit protection, and a confirmation screen showing exactly what will be
  written.
- **We must validate what their procs do not.** Six `IF @x = NULL` guards are dead
  code under `ANSI_NULLS ON` — e.g. a NULL `@tubeTypeId` creates a material their
  own `ActiveMaterials` view cannot display. Their guard will not stop it; ours
  must.

---

## Step 6 — Verification

Nothing is "done" until: full typecheck, the whole `vitest` suite, all five
workspace builds, a real sync end-to-end, `sms verify` reconciling per-epoch, and
browser verification of every screen whose meaning changed. New regression tests
for the epoch keys and the write path — and each one proved by breaking the code
it pins, not just by passing.

---

## Step 7 — Documents and questions

- `CLAUDE.md` — OQ-1 resolved; the write decision and why it was taken.
- `SCHEMA.md` — September schema, `MaterialId`, Q4/Q5 closed for cones with the
  132,551/132,551 evidence, retention reality.
- `DEPLOY.md` — the cutover procedure rewritten; the login requirement stated as
  hard (`db_datareader` on **both** DBs, or `seedProducts` dies on cutover day).
- `ARCHITECTURE.md` — §7 currently claims drift detection it does not have.
- The short list of questions IFL must answer **in writing** before the write path
  is enabled in the plant.

**The one thing to ask Hassan for immediately, ahead of everything else:** the
**10 Jul – 5 Aug** production data. It exists; it simply was not included in the
drop. It closes the only hole in our history, it needs no new engineering (it
lands in epoch 1 by id), and every day it is not requested is a day it might age
out of whatever backup currently holds it. Worth asking for in the same message
as the `db_datareader` request.

---

## What I will not do without asking

- Delete anything from the app database.
- Write to any IFL database until the flag is deliberately enabled and IFL has
  confirmed in writing.
- Commit to `main`, or commit at all until asked.

---

## Status — 11 Sep 2026, end of build

Everything below was verified on the running system on 11 Sep 2026: typecheck
clean, **266 / 266** tests across 28 files, all five workspaces build, `sms verify`
exit 0 across all 12 generations, all API routes answering, and the screens whose
meaning changed re-checked in the browser. **Nothing is committed** (owner: "we
will commit later"); the working tree is 64 modified + 41 new files on
`floor-first-rework`.

### Goal 1 — September data appended and validated: DONE

| Generation | Table | Rows in app DB | Source | Reconciled |
|---|---|---|---|---|
| 1 / 2 / 3 / 4 | cones / sacks / rejectQCS / rejectWeight | 142,511 / 5,462 / 2,900 / 246 | July copy (`DATA_TP1U2`) | exact — count, min, max, **sum of ids** |
| 5 – 8 | (simulator) | 0 — purged to tombstones | `DATA_TP1U2_SIM` | — |
| 9 / 10 / 11 / 12 | cones / sacks / rejectQCS / rejectWeight | 132,552 / 5,435 / 6,049 / 41 | September copy (`DATA_TP1U2_SEP07`) | exact |

July (22 Jun – 10 Jul) and September (5 Aug – 7 Sep) coexist; no row of either
was altered. The ids collide (both start at 1) and the app tells them apart by
`source_epoch` everywhere — raw uniqueness, canonical dedupe, merge keys,
watermarks, SPC baselines, the register's provenance column and Setup's
generation panel.

**Deviation from Step 1 as written.** The plan said an unrecognised generation
"registers a new epoch and logs it loudly rather than halting". It was built the
other way — the worker **halts** and names the command (`sms epoch:accept`) —
after the decision record (`SEPT-2026-EPOCH-DECISION.md` §1) argued that
auto-registering is the same silent-success failure in a new coat: a restored
backup or a wrong connection string would be adopted as "the new generation" with
no human in the loop. Accepting a real rebuild costs one command.

### Goal 2 — everything Hassan sent, evaluated and acted on: DONE, with asks

- **`SPS.rar` (both databases).** Attached, read, reconciled, and now the target
  schema. The 66 raw findings (`SEPT-2026-DB-FINDINGS-RAW.md`) were triaged; the
  ones that change the software are built (rename `Source→MachineNo`,
  `MaterialId` attribution, six active materials, time-versioned limits, the
  `db_datareader` requirement, the rewritten cutover). Q4/Q5 closed for cones
  (132,551 / 132,551). The PDAS stored procedures are readable and are the only
  write surface we use.
- **`P-DAS Program (1).xlsx`** — used as the specification for the product sheet
  (Add product = Blend → Count → Tube type → Create; Retire / Activate).
- **Screenshots** — the vendor's field names and option lists are mirrored in
  `GET /api/product-options`.
- **`Sack Packing…docx`** — network topology. Recorded in the briefing §5.11 and
  §6.9–17; **not built**, by the owner's instruction (infrastructure scope).
- **Retracted:** the briefing's "26 days permanently lost / sidecar holds the only
  copy" claim. It is a sampling gap; the rows exist at IFL. Marked in place.

### Goal 3 — Add / Edit product: BUILT, SHIPS OFF

`web/src/screens/ProductSheet.tsx` + `api/src/services/pdasWrite.ts`:

- **Add** (vendor `CreateMaterial` + `SetMaterialStatusActive`), **Retire /
  Activate** (`SetMaterialStatusActive`), **Change limits** — one guarded
  single-row `UPDATE dbo.Materials` on setpoint / offsets only, because no vendor
  UPDATE proc exists and retire-and-recreate **cannot** change a setpoint
  (`CreateMaterial` refuses the duplicate blend/count/tube; IFL's own engineer hit
  this four times on 18 Aug).
- Rails, all in code: `PDAS_WRITE_ENABLED=false` by default; a **separate**
  `sms_pdas_writer` login (never the read-only sync login); `requireRole(3)`;
  plausibility bounds; our own `sms.product_change` audit row plus IFL's
  `nhs_events` row; the vendor's error codes (-7001…-7004) explained in plain
  words. With the flag off the sheet is read-only and says why.
- **Deviation from Step 3 as written.** The line-wide "Current Product" selector
  was **not** retired. It survives as the fallback for pre-MaterialId rows
  (`attribution: 'timeline'`); September rows are judged by their own material
  (`attribution: 'row'`). Removing it would have left July's 142,511 cones with
  no product at all.

**Not exercised end-to-end:** the three write paths have unit tests against a
fake pool (5 tests) but have **never been run against a real PDAS**, because no
writer login exists yet and the flag is off. That is the first thing to do once
IFL confirms in writing — against `PDAS_TP1U2_SEP07` locally, before the plant.

### What is left against the September data

1. **Ask IFL for 10 Jul – 5 Aug** (all four tables, pre-rebuild generation). It
   loads into generations 1–4 by id with no engineering; only the per-generation
   watermark advances. Until then every trend across the gap says so
   (`daysWithReadings`, `spansGenerations`).
2. **Ask IFL for `db_datareader` on both DBs** for a dedicated login — hard
   requirement, `DEPLOY.md` step 2. `ibrahim` has no table read on PDAS.
3. **Written authority for the write path**, then run Add / Retire / Change-limits
   against the local `_SEP07` copy with a real writer login, then enable.
4. **Sack tare** (`SACK_TARE_KG`) stays open — the 24-cones-per-sack figure is
   inferred, not read from `PackSchemas`.
5. **Per-machine target on the station table** — recorded, not built. Six
   materials with different limits run concurrently; the station table still
   shows one line-wide target.
6. **Ask whether the PLC reads limits live** from `Materials`, or only at product
   change. It decides whether a limits edit takes effect on the floor immediately.
7. **Commit**, when the owner says so.
