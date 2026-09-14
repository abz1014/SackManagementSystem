# SMS — September database briefing

*Investigation completed 10 Sep 2026. Everything below marked **FACT** was re-run by me against the live attached copies or greppped in the code; **JUDGEMENT** is my recommendation; **OPEN** needs IFL or you to decide.*

> **Status, 11 Sep 2026.** Section 2 describes the code **as it was on 10 Sep**. Every defect in it has since been built out — source generations (`sms.source_epoch`), per-generation watermarks, halt-on-unknown-generation, the `raw_read_without_write` finding, `sms epoch:*`, a rewritten `DEPLOY.md` cutover, and the hard `db_datareader` requirement. The September data is loaded and reconciled. See `SEPT-2026-BUILD-PLAN.md` → *Status* for what is done and what remains. Two claims below were **retracted** and are marked in place: the 26-day gap is a sampling gap, not a data loss.

---

## 1. Your question, answered

**FACT — both September copies are attached and ONLINE**, alongside the untouched July copies:

| Database | State | Attached |
|---|---|---|
| `DATA_TP1U2` / `PDAS_TP1U2` | ONLINE | 2026-07-21 |
| `DATA_TP1U2_SEP07` / `PDAS_TP1U2_SEP07` | ONLINE | 2026-09-10 |
| `sms` (ours) | ONLINE | 2026-07-23 |

Local instance is SQL Server 2022 (16.0.1000.6) — same major version as the plant's `TP1-PDAS\PDAS`, so nothing is version-gated.

**FACT — PDAS shows everything.** `PDAS_TP1U2_SEP07` exposes 18 tables, 13 stored procedures, 3 views, 14 triggers. Proc bodies are fully readable from `sys.sql_modules`.

**FACT — the 13 procs are not new and not changed.** They are byte-identical between the July and September copies (same MD5 over the dumped bodies), all carry `create_date = modify_date = 2026-02-23 16:49:14`, and `SCHEMA.md:241` already documented them. This was a re-confirmation, not a discovery.

| Proc | Does | Notes |
|---|---|---|
| `GetAllBlends/Counts/TubeTypes/Materials/Pallets` | `SELECT *`, returns `COUNT(*)` | Includes vendor seed rows 1–10 that DQ-10 says to filter |
| `GetAllProduction` | — | **Unusable here:** no EXECUTE grant to anyone, and `dbo.Productions` has 0 rows in both copies |
| `AddBlend` / `AddCount` / `AddTubeType` | INSERT, returns new id | |
| `CreateMaterial` | INSERT, keyed on (BlendId, CountId, TubeTypeId) | Refuses an existing triple with `-7001` |
| `CreatePallet` | INSERT, keyed on (MaterialID, PackSchemaId, Lot) | |
| `SetMaterialStatusActive` / `SetPalletStatusActive` | `UPDATE … SET Active` only | |

**FACT — the single most useful thing the proc bodies tell us: no proc can UPDATE a material's setpoint or tolerance.** The entire mutation surface is create-and-activate. Changing a running product's target weight through the vendor API is impossible; it would need a direct `UPDATE dbo.Materials`. IFL's own operators hit this — `nhs_events` on 2026-08-18 shows four consecutive `CreateMaterial error -7001: Material already exist` (10:35–10:41) with a deactivate/reactivate of MaterialId 1022 in between.

**JUDGEMENT:** if a "product details" screen is ever built, design it as **New product + Activate/Retire**. An "Edit setpoint" field is undeliverable through the vendor API.

**FACT — PDAS was never wiped.** `nhs_events` runs unbroken from EventId 1 (2026-02-24 13:21) to 2026-09-07 11:46 in both copies. Only `DATA_TP1U2` was dropped and recreated. Correct the working note accordingly — the "source database was wiped" statement is true of the acquisition DB only, and PDAS's change history back to February is intact and trustworthy.

---

## 2. What could break the software at go-live

### 2.1 The live source has dropped `Source`, and that is currently the only thing saving us

**FACT.** In `DATA_TP1U2_SEP07`, `pack1_TP1U2`, `rejectQCS1_TP1U2` and `rejectWeight1_TP1U2` have **no `Source` column** — it is `MachineNo` at ordinal 7 — and all four event tables gained `MaterialId`. `sms/sync-worker/src/reader/iflTables.ts:36, :67, :84` declare `Source` as a depended-on column, so the fingerprint gate at `sync-worker/src/runner.ts:45-50` throws `Schema drift on pack1_TP1U2` on the **first table of the first pass**, before anything is read. `index.ts` catches and retries every 60 s forever.

That halt is correct behaviour arrived at by accident. It is also the reason section 2.2 is latent rather than live.

### 2.2 The sync worker is structurally blind to a source id reset — and IFL already did one

**FACT — the mechanism.** The reader watermark is `SELECT ISNULL(MAX(src_id),0) … FROM <rawTable>` (`sync-worker/src/store.ts:45`), read live out of our own raw table. The reader then asks IFL for `id > watermark − 500` (`runner.ts:55`, `SYNC_OVERLAP_ROWS=500` in `sms/.env:27`). If zero rows come back, `finishSyncRun(… outcome: 'success')` fires (`runner.ts:81`). There is no epoch, generation or source-instance concept anywhere in the codebase.

**FACT — the fingerprint cannot catch it.** `fingerprint.ts` hashes only the *depended-on* columns' name/type/precision/scale/maxlen. `sack1_TP1U2` depends on id, Date, Shift, Area, SackNum, Weight, inRange — none of which changed. I dumped the signature from both copies: byte-identical, and SHA-256 → `06ee47196e50eba946195cb560e5e9c3`, which is exactly the baseline stored in `sms.app_config`. **A full wipe, recreate and identity reset is invisible to the gate on that table.** ARCHITECTURE.md §7 opens by saying `MAX(source_row_id)` alone is unsafe "(restore, reseed, deletes)" and then lists three mitigations, none of which addresses a reset.

**FACT — what happens at cutover, simulated against real numbers.** App DB watermarks today vs. the live September source:

| Stream | Our watermark | `afterId` | Rows read | Rows **written** | Effect |
|---|---|---|---|---|---|
| cone | 204,076 | 203,576 | **0** | 0 | Permanent silence. All 132,552 Sept cones never read. |
| sack | 8,201 | 7,701 | **0** | 0 | Permanent silence. All 5,435 Sept sacks never read. |
| reject_qcs | 4,203 | 3,703 | 2,346 | **1,846** | 1,846 rejects dated **30 Aug – 07 Sep** appended to canonical beside July's, with no epoch marker |
| reject_weight | 366 | −1 (floored) | 41 | 0 | All 41 dropped as already-seen |

All four report `outcome: 'success'`.

> **Correction to the investigation:** an earlier pass reported reject_qcs writing 0 rows at cutover. It writes **1,846**. I re-ran it (`SELECT COUNT(*), MIN(ProductionDate), MAX(ProductionDate) FROM rejectQCS1_TP1U2 WHERE id > 4203`). This is worse, not better: the reject numerator keeps growing while the cone denominator is frozen at July's 142,511, so every reject rate on the Report and Rejects screens becomes nonsense rather than merely stale.

**FACT — two independent layers then drop new-epoch rows.** `raw/persistRaw.ts:56-60` filters against `src_id BETWEEN @lo AND @hi` backed by `UNIQUE (line_id, src_id)`; `transform/persistCanonical.ts:31-32, :47-48` filters again on `source_row_id` with only `source_system = 'ifl_sql'` as a qualifier. Neither drop is counted, logged, or raised as a DQ finding — `written` simply comes back below `read` and nothing compares the two. **Fixing the watermark alone would convert a silent blackout into a silent discard, which looks identical from the UI.**

**FACT — nothing in the running system would tell you.** `classifyHealth` (`api/src/services/live.ts:215-228`) keys off `sync.ageSeconds` — the age of the last successful *run*, not of the newest *data*. Under a reset the worker succeeds every 60 s, so health stays `ok` while the line reads `idle`. That is a confident false statement ("the plant has produced nothing for 58 days"), which is worse than a warning, and it defeats CLAUDE.md rule 4. Meanwhile `api/src/services/operations.ts:237` hardcodes `status: 'ok'` on the schema panel — including right now, while three of four live tables have in fact dropped a depended-on column.

**JUDGEMENT — the sequencing that matters:** build reset detection **before** mapping `Source → MachineNo`. The moment that mapping lands and the fingerprints are re-baselined, all four gates pass and this blackout becomes fully exposed. Do not do them in the other order.

### 2.3 The documented cutover procedure is wrong

**FACT.** `sms/DEPLOY.md:291-301` is five steps: backup app DB, stop sync, repoint `IFL_DB_*`, start sync — *"First pass backfills from the live DB into the app DB"* — then `sms verify`. There is **no step that clears `sms_raw.*` or `sms.*`**, and step 1 deliberately preserves them. That sentence is simply false whenever the app DB is not empty, and the procedure guarantees it is not.

`sms verify` (`cli/src/commands/verify.ts:29-39`) is the one genuine detector and it does work — at today's numbers it would print MISMATCH on all four streams. But it is step 5 of 5, manual, one-shot, and DEPLOY.md never says a MISMATCH is a stop-the-line condition rather than a backfill in progress.

**FACT — the real tension:** the app DB *must* survive the cutover (product timeline, users, reject labels, rules), and the raw/canonical layers *must not*.

### 2.4 `seedProducts` will fail at cutover if IFL hands over the `ibrahim` login

**FACT.** `sync-worker/src/seed/seedProducts.ts:35-43` SELECTs four **base tables** directly: `Blends`, `Counts`, `TubeTypes`, `Materials`. On `PDAS_TP1U2_SEP07`, `ibrahim` belongs to the `storedProcedures` role **only** — it is **not** `db_datareader`. (On `DATA_TP1U2_SEP07` it *is* `db_datareader`; the asymmetry is deliberate.) The `sms_readonly` user in our local PDAS restore was created 2026-07-23 — it is our own Phase 1 artefact, not something IFL provisioned.

`seedProducts` runs inside the pipeline, so this throws rather than degrading: empty Current Product selector, no setpoint for any screen to resolve. **Our local restore cannot surface this**, because it has a `db_datareader` account the plant does not.

**FACT — related, and unexplained.** A view `GetMaterialsData` was created on IFL's PDAS at **2026-08-05 15:00:51** — two weeks after the 23 Jul exchange — hand-written (no vendor header, hardcoded three-part name `[PDAS_TP1U2].[dbo].[Materials]`), and it is the only object with a **direct SELECT grant to `ibrahim`**. Its columns are almost exactly a product-master read surface. It is **not** a drop-in for `seedProducts`: it omits `BlendId`, `CountId`, `TubeTypeId` and `TubeWeight`, all four of which we bind.

---

## 3. Genuinely good news

**FACT — Q4/Q5 (gross vs net) is settled for cones, by measurement.** `pack1_TP1U2` in the September copy carries `MaterialId`, so IFL's own in-range bit can be tested against IFL's own setpoint. It equals `Weight BETWEEN setpoint − offsetMinus AND setpoint + offsetPlus` on **132,551 of 132,551** joinable rows — zero accepted-outside, zero rejected-inside, across all seven MaterialIds present. If the PLC had written a value on a different basis from the one it compared, that agreement could not hold. Mean recorded cone weight 1,951.8 g against a 1,960 g setpoint (−0.42 %); against setpoint+tube (2,030) it would be −78 g. July corroborates independently with no MaterialId column at all: accepted weights span exactly [1910.00, 2007.00].

**JUDGEMENT:** the recorded cone weight and `MaterialSetpointWeight` are one quantity. `WEIGHT_BASIS` must stay `as_recorded` for cones permanently, and `net` should be removed or hard-warned on the cone side of `shared/src/config/appConfig.ts` — `interpretWeight` subtracts `coneTubeWeightG` under `net` and that path is reachable today via `POST /api/admin/rules/weight`. The withheld headline (`web/src/lib/words.ts:243`, `headlineConfirmed`) can be switched on.

**Still open, honestly:** the sack side. Implied packaging measures 0.427–0.461 kg against a nominal `SACK_TARE_KG=0.5`, and the 24-cones-per-sack figure is **inferred from the observed ratio, not read from `PackSchemas`** — that table has no layer count. Keep `SACK_TARE_KG` open.

**FACT — `MaterialId` is populated on 100 % of rows** (pack1 132,552, sack1 5,435, rejectQCS1 6,049) and joins cleanly to `Materials → Blends/Counts/TubeTypes`. **JUDGEMENT:** this is potentially the answer to OQ-1 / Q1 — the product key that "does not exist" and that forced `NullAttribution`. Investigate it **before** re-baselining fingerprints, because it may change the transform.

**FACT — `MachineNo` ranges 1..14** (plus one `MachineNo=0` clock-fault row), matching the 14 rewinders in the client's document. Machine identity is already in SQL; no new network link is needed to get it.

**FACT — the product master has completely turned over.** July: 18 materials, **2 active** (17, 18). September: 24 materials, **6 active** (20, 21, 1021, 1022, 1023, 1024) — all `205-IL0-SD`, setpoint 1960 ±50, created 30 Jul – 03 Sep. Materials 17 and 18 are now retired. `sms.product` is seeded from July and believes two retired products are live. Note also `SCHEMA.md` OQ-1's "two materials are currently active, so this is ambiguous" is now **six-way** ambiguous.

**FACT — the gap between the two samples is ~26 days, not 2.** Source tables were dropped and recreated 2026-08-05 18:54:50–19:03:16. Production restarts 05 Aug (1,324 cones), 06 Aug (5,858). The single 2026-07-12 row is a stray. Gap from the July copy's end (10 Jul 11:23) is 26 days.

> **Retracted, 11 Sep 2026: this is a sampling gap, not a data loss.** The earlier wording ("blackout", and elsewhere "permanently lost" / "the sidecar holds the only copy") was inferred from what the 7 Sep drop *contained* and stated as a fact about the *plant*. The owner confirms the 10 Jul – 5 Aug rows exist at IFL and were simply not included. They belong to the pre-rebuild generation and will load into epoch 1 by id with no further engineering. Ask for them; do not engineer around their absence.

---

## 4. What was refuted during verification — do not act on these

- **"Q21 only asked about indexes, so the no-writes rule is our own extrapolation."** Refuted. `QUESTIONS.md:304` **Q15 — "Will the system ever need to *change* data, or only display it?"** asked the write question directly and enumerated the write cases; `QUESTIONS.md:390` requests a read-only login on the explicit rationale that SMS *cannot* modify their data. Also false in that finding: requirement 3 is **not** deliverable via the vendor API (no UPDATE proc, see §1); "update product details" is **not** the largest missing module (sack stock per machine is, per `CLAUDE.md:289`); there are **7** granted write procs, not 5; and `ibrahim` + the `storedProcedures` role were created 23–25 Feb 2026 at vendor commissioning, four months before this project — they are vendor runtime grants, not IFL provisioning for us.
  **Residual, small and real:** `CLAUDE.md:303` states the Q21 answer in wording ("no schema, indexes, tables, procs, or data") broader than any recorded IFL text, and **Q15's answer is not recorded anywhere**. That is doc hygiene plus one unrecorded answer — not a reopened decision.
- **"Two segmented subnets that the one-switch plan must reconcile."** Downgraded. The IPs are fact — `dbo.t_plcs` returns exactly two rows, `PLC_sack1 10.1.1.14` and `PLC_pack1 10.1.1.11`, identical in both copies, and the VNC title bar reads `PDAS 192.168.100.37 (TP1-PDAS)`. But nothing establishes netmasks, routing or physical segmentation. Carry it as an **open question**, not a finding.

---

## 5. Recommended next actions, in order

1. **Do not run the DEPLOY.md cutover.** Today the fingerprint gate blocks it anyway (hard halt on `pack1_TP1U2`, the first table) — that halt is protecting you.
2. **Build source-reset detection first.** Minimum viable: before reading, compare the stored watermark to `SELECT MAX(id) FROM <sourceTable>`; if the source max is **below** our watermark, halt that stream with a CRITICAL `dq_finding` the way the fingerprint gate halts. `sys.databases.create_date` on the source is a free, read-only epoch discriminator requiring no write to IFL's DB.
3. **Three cheap safety nets, independent of the above and worth doing regardless:** (a) emit a WARNING DQ finding when `read > 0 && written === 0` on a stream — that alone would have made every silent drop visible; (b) recompute the fingerprint live in `operations.ts:237` and report `ok | drift | unreachable` instead of the literal; (c) make `classifyHealth` consider **data** age, not only run age.
4. **Rewrite `DEPLOY.md:291-301`.** Add an explicit step between 2 and 3 clearing `sms_raw.*`, `sms.cone_event/sack_event/reject_event`, the transform watermarks and the four `fingerprint.*` keys — while leaving `product_timeline`, `app_user`, `reject_code`, rules and audit intact. Delete the false "First pass backfills" sentence. Make `sms verify` a **gate**, stating that any MISMATCH after backfill settles means STOP. Ship it as `sms cutover --confirm` so it cannot be half-done by hand.
5. **Investigate `MaterialId` as a resolution to OQ-1 / Q1** — before touching the transform for the rename.
6. **Then** map `Source → MachineNo` across the three tables and re-baseline the fingerprints. Not before steps 2 and 5.
7. **Re-seed `sms.product` from the September copy**, and re-check any conclusion that used a 1950 g setpoint or ±30/±40 offsets.
8. **Close Q4/Q5 for cones in `SCHEMA.md`** with the 132,551/132,551 evidence; enable the confirmed weight headline; remove or hard-warn `net` on the cone side. Keep `SACK_TARE_KG` open and say why.
9. **Fix the login ask.** `DEPLOY.md:27` requests "db_datareader on `DATA_TP1U2` **and** `PDAS_TP1U2`" — that is the right ask, but it must be stated as a hard requirement with the `ibrahim` case called out, or `seedProducts` dies on cutover day.
10. **Correct the docs that overstate a capability**, per CLAUDE.md's own greppability rule: `ARCHITECTURE.md` §7 detects **column drift only**; reset/restore detection is not built, and 500 overlap rows cover a hiccup, not a reseed.
11. **For the network quote: draw the topology yourself first.** The client `.docx` contains zero connectors, zero switches and no network vocabulary at all — it is an illustrated equipment list (14 Rieter winders, PLC for Cones, PLC for Sacks, SCADA PC, two DB server icons), authored by "SCADAClient1" in 60 minutes on 2026-09-05, illustrated with web stock photos (the PLC photo is an **S7-1200**, so the file evidences no PLC model at all). Every topological claim — ring vs line, switch position — comes solely from an unrecorded voice note. Issue our own single-page drawing to Hassan sb for **written** sign-off as the quotation's controlling reference.

---

## 6. Questions to put to IFL / Hassan sb

**Database access (blocks go-live):**
1. Will SMS get `db_datareader` on **both** `DATA_TP1U2` and `PDAS_TP1U2` for a new dedicated login? If PDAS access will be proc/view-only (as `ibrahim`'s is today), say so now — our product-master seeding reads the base tables and would fail.
2. **Who created the view `GetMaterialsData` on 5 Aug 2026, and for whom?** *(Answered 11 Sep 2026: a process engineer made it for hand-typed queries — it is their workaround for having no product screen, which is what the Add / Edit product build replaces.)* Is it intended as SMS's read path into the product master? If yes, we need `BlendId`, `CountId`, `TubeTypeId` and `TubeWeight` added, and the hardcoded `[PDAS_TP1U2].` prefix dropped to a two-part name.

**The source database rebuild:**
3. `DATA_TP1U2` was dropped and recreated on **5 Aug 2026** with all identity counters restarting at 1, and the `Source` column renamed to `MachineNo` with `MaterialId` added. Was this a planned vendor upgrade? **Will it happen again, and will we be told in advance?** *(Owner's judgement, 11 Sep 2026: it will not recur. Reset detection was built regardless — a generation the app does not know halts the worker until it is accepted with `sms epoch:accept`, so a repeat costs one command, not a blackout.)*
4. ~~Is any production data from **10 Jul – 5 Aug** recoverable, or is that 26-day gap permanent?~~ **Superseded 11 Sep 2026** — the owner confirms it exists and was not sent. The ask is now simply: *please send the 10 Jul – 5 Aug rows of all four tables (the pre-rebuild generation).*
5. `MaterialId` now appears on every event table. Is it reliable enough to use for product-wise reporting — i.e. is it always the product actually running when the cone was weighed? (Q1 previously told us no product key existed; this changes that answer.) *(Answered 11 Sep 2026: **yes, trustworthy.** Built: September rows carry `attribution_method='source_column'` and are judged against their own material's limits.)*

**Product master:**
6. Confirm: to change a running product's target weight you deactivate the old material and create a new one — there is no edit. Is that how you work today? *(Our reading of your own procs and your 18 Aug event log says yes.)*
7. Is 1,960 g the weight of the cone **including** its 70 g tube, or the yarn alone? *(No arithmetic consequence for us — we need it for the label only.)*
8. *(Owner, 11 Sep 2026: not our concern — do not raise.)* Two defects in your PDAS application worth reporting to the vendor regardless of what we do: six `IF @x = NULL` guards are dead code under `ANSI_NULLS ON` (a NULL `@tubeTypeId` creates a material your own `ActiveMaterials` view cannot see), and `CreateMaterial` logs `@blendId` where it means `@materialId`, so every audit row reads `Create new MaterialId: 2`.

**Network / quote (Hassan sb):**
9. What data is meant to travel over the proposed 14-machine ring, and to which application? Nothing in the SMS data path needs it — machine number 1–14 already arrives in SQL.
10. Dimensioned site layout with cable-route distances between machine cabinets, PLC cabinets and the server room. This decides fibre vs copper and is the largest cost variable; it cannot be answered from an office.
11. Do the winders have a free Ethernet port for this, and is it single- or dual-port? A single-port device cannot sit in a protected ring. *(The document does not even establish the machine model.)*
12. Are `10.1.1.0/24` (PLCs) and `192.168.100.0/24` (server) to stay separate or be flattened?
13. **Ring or line — in writing.** They are different bills of materials with different redundancy, and the only record of this choice is a verbal brief.
14. Who supplies cable trays, containment, power at each cabinet, and civil/conduit work?
15. The document draws "Database Server PDAS" and "Database Server Sack Packing" as two nodes, but on 7 Sep both databases were on the single instance `TP1-PDAS\PDAS`. Is the intent to **split** them onto separate servers?
16. Who owns IP allocation and switch configuration after handover — IFL IT or us?
17. Where will the SMS host physically sit, and is the plant still air-gapped?

---

## 7. Uncertainty I want on the record

- I could **not** establish what IFL actually said on 23 Jul. `QUESTIONS.md` was never updated with answers and git holds a single commit, so `CLAUDE.md:303`'s wording is unverifiable in either direction — I neither confirm nor deny it was extrapolated.
- The 24-cones-per-sack figure is **inferred from the observed ratio**, not read from IFL's config. The sack tare conclusion rests on it.
- Whether `10.1.1.0/24` and `192.168.100.0/24` are genuinely separate segments is **not established** — only that two devices carry addresses in different ranges.
- The §2.2 cutover simulation is arithmetic I ran against the live copies; it is not an executed sync. I did not run the worker against `DATA_TP1U2_SEP07`, because doing so would write to the app DB.