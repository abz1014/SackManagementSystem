# SPEC.md — IFL Sack Management System

**Status:** Phase 1 scope frozen · awaiting sign-off on deliverables · **no code written yet**
**Last updated:** 21 July 2026

> **Standing caveat.** IFL has not yet answered the questionnaire (`../QUESTIONS.md`). Five questions are blocking. This spec is written so that Phase 1 can proceed *around* the unanswered ones — chiefly by putting product attribution behind an interface (§5). Anything that genuinely cannot be built without an answer is marked **⛔ BLOCKED** and excluded from the Phase 1 deliverables list.

---

## 1. Architecture — three components

| | Component | Phase | Description |
|---|---|---|---|
| **A** | **Sync service** | **1** | Read-only pull from IFL's SQL Server → our local sidecar database. Incremental, one-way, never writes to IFL. |
| **B** | **PLC reader** | **2 — indefinitely deferred** | IFL Q22: **no PLC integration in scope at all**; app consumes SQL Server only. IFL Q2 redirects cone traceability to the `Source` column instead of a PLC Cone ID. The `cone_id` column stays (nullable, cheap) but its PLC-fed future is dormant. Keep the disabled stub for optionality; add **no** PLC dependency. |
| **C** | **Web application** | **1** | Dashboards and reports. Queries **only** the local sidecar DB — never IFL's server directly. |

```
┌────────────────────┐         ┌──────────────────────┐         ┌──────────────┐
│  IFL SQL Server    │  read   │   A · Sync service   │  write  │   Sidecar    │
│  DATA_TP1U2        │ ──────► │   (incremental)      │ ──────► │   database   │
│  PDAS_TP1U2        │  only   └──────────────────────┘         │   (ours)     │
└────────────────────┘                                          └──────┬───────┘
                                                                       │ read
┌────────────────────┐         ┌──────────────────────┐                │
│  S7-1500 PLC       │ ──────► │   B · PLC reader     │ ─ ─ ─ ─ ─ ─ ─ ─┘
│  10.1.1.11         │ PHASE 2 │   (stub only, OFF)   │  same tables,
└────────────────────┘         └──────────────────────┘  no migration
                                                                       │
                                                         ┌─────────────▼──────┐
                                                         │  C · Web app       │
                                                         └────────────────────┘
```

**Why a sidecar:** IFL's database is production plant data with no indexes on date columns (SCHEMA.md DQ/§5.9). Querying it live from a dashboard would scan 142k+ rows per request and put avoidable load on a live plant system. Syncing into our own schema lets us index freely, reshape for reporting, fix the shift bug (SCHEMA.md DQ-4), and guarantee we can never write to IFL's data.

> ### ⚠️ OPEN ARCHITECTURE DECISION (raised by IFL answers, 23 Jul 2026) — needs your call
>
> IFL's answers pull in two directions and must be reconciled before we build the data layer:
>
> - **Q19:** "the web application will connect **directly** to the plant's SQL Server over the LAN."
> - **Q21:** **no** indexes or any change on IFL's DB — all optimisation lives in the app layer.
> - **Q1:** the app must **persist** the Current Product selection → an **app-owned writable DB is required regardless.**
>
> So an app-owned database is not optional (Q1 forces it). The only real question is where dashboards *read production data* from:
>
> | Option | Reads production data from | Pros | Cons |
> |---|---|---|---|
> | **(A) Direct-connect** (literal Q19) | Plant DB live, per request | Simplest; always current; matches IFL's words | Every dashboard scans 142k+ unindexed rows on the **live plant server**; can't fix shift bug at source; load grows with data |
> | **(B) Sidecar sync** (our original) | App-owned DB (synced read-only) | Fast, indexable, shift-fix, zero query load on plant DB, provably read-only | One more moving part; data is seconds–minutes stale |
> | **(C) Hybrid** | Live for "today" tiles, sidecar for history/analytics | Fresh where it matters, fast where it's heavy | Most complex |
>
> **My recommendation: (B).** It is *not* a contradiction of Q21 — a sidecar reads IFL's DB and changes nothing on it, and "optimisation within the app layer" is exactly what a sidecar is. It also honours the Q19 intent (non-intrusive, over the LAN). I suspect IFL wrote "connect directly" without the sidecar option in front of them; worth a one-line confirmation that a read-only replica/cache is acceptable. **The rest of this spec assumes (B); if you choose (A), §3–§4 collapse to a query layer + a small app DB for product/users, and the shift-fix moves into the query.**

---

## 2. Phase 1 scope

### In scope
- Component **A** — incremental read-only sync
- Component **C** — web app: auth, RBAC, and the reporting screens listed in §6
- Sidecar schema, **including Phase-2-ready columns** (§4)
- Ingestion layer structured for a second source (§3)
- PLC reader **config stub + feature flag, disabled** (§7)
- Product attribution **interface with a Phase 1 implementation selected by Q1's answer** (§5)

### Explicitly out of scope
- ❌ Component B / any PLC connectivity, and any PLC dependency (`snap7`, `python-snap7`, `S7NetPlus`, etc.)
- ❌ Writes of any kind to IFL's databases
- ❌ Dispatch module (no source data exists — QUESTIONS Q12)
- ❌ Pallet / label printing module (`Productions` table is empty — QUESTIONS Q13)
- ❌ Multi-line support beyond a `line_id` column carried through the schema (QUESTIONS Q14)

---

## 3. Ingestion layer — designed for a second source now

**Requirement:** Component B must later write into the same tables **without schema migration**.

### 3.1 Adapter contract

> ### ⚠️ NOT IMPLEMENTED — this section is a design target, not a description of the code.
>
> Audited 17 Aug 2026: **`IngestionAdapter` does not exist.** Zero hits across the
> monorepo. The runner instantiates a concrete `IflSqlAdapter`; `transform.ts`
> hardcodes `source_system: 'ifl_sql'`; `persistRaw` is insert-only, not an
> idempotent upsert. The claim below that "the sync runner is source-agnostic"
> is **false today**.
>
> Extracting this interface for real — plus making transform source-agnostic and
> adding a merge-and-enrich upsert — is roughly **1.5 weeks** and is a hard
> prerequisite for any second source (PLC or otherwise). Budget it explicitly;
> do not present it as already done, and do not cite this section as evidence of
> pluggability in any customer-facing document.

**Design intent (unbuilt).** Every data source implements one interface. Phase 1 would register one adapter; Phase 2 adds a second with no change to the tables or the merge logic.

```
interface IngestionAdapter:            // TARGET SHAPE — no such type exists yet
    source_id      -> str            # 'ifl_sql' | 'plc_direct'
    fetch(since)   -> Iterable[CanonicalConeEvent | CanonicalSackEvent]
```

The intended end state is a source-agnostic runner: it calls `fetch()`, maps to the canonical event shape, and hands off to a single **idempotent upsert** path, so adding Component B means registering a second adapter — no new tables, no altered columns, no changed merge code. **Reaching that state is future work.**

### 3.2 Merge key — the part that must be right today

For a Phase 2 PLC event to **enrich an existing row** rather than create a duplicate, both sources must independently compute the same key.

| Source | Available fields |
|---|---|
| IFL SQL (`pack1_TP1U2`) | `ProductionDate`, `HangerNum`, `Source`, `Lifter`, `Weight` |
| PLC (DB7, Phase 2) | same raw tags — `P1_Timestamp`, `P1_Hanger_No`, `P1_Source`, … **plus `P1_ConeID`** |

**Canonical merge key:** `(line_id, production_ts_utc_ms, hanger_num)`

`production_ts_utc_ms` is the raw epoch-milliseconds value — the PLC's own `P1_Timestamp` — stored *unconverted* alongside the converted timestamp. This is deliberate: it is the one value both sources produce identically, with no timezone-conversion drift.

> ⚠️ **Known risk, carried from SCHEMA.md DQ-2.** `reference_value` (the epoch-ms timestamp) collides for **8.4 %** of cone groups, and one PLC clock fault produced 274 cones sharing `-18000000`. Adding `hanger_num` resolves most collisions but **not all**. The upsert therefore also stores `ingest_seq` (a per-key ordinal) and flags rows where the key is non-unique, so Phase 2 merges can be audited rather than silently mis-joining. **This is a real limitation to raise with IFL** — it is the strongest argument for Component B, since a true Cone ID would give us a clean key.

### 3.3 Provenance on every row

Every synced row records where it came from and when, so a Phase 2 PLC write is distinguishable from a Phase 1 SQL sync:

`source_system`, `source_row_id`, `ingested_at_utc`, `ingest_run_id`

---

## 4. Sidecar schema — Phase-2-ready from day one

Only the reporting-relevant tables are shown. Full DDL comes with the first slice.

### `sms.cone_event` — one row per cone weighing

| Column | Type | Null | Notes |
|---|---|---|---|
| `cone_event_id` | bigint identity | no | PK |
| `line_id` | int | no | `1` = TP1U2. Multi-line ready. |
| `production_ts_utc` | datetime2 | no | **Event time** — from `ProductionDate`, not `Date` |
| `production_ts_utc_ms` | bigint | no | Raw epoch-ms — **the cross-source merge key** |
| `ingest_ts_utc` | datetime2 | yes | IFL's `Date` (insert time), kept for reconciliation |
| `shift_code` | varchar(10) | no | **Recomputed** from `production_ts_utc` (SCHEMA.md DQ-4) |
| `shift_date` | date | no | Business date; night-shift rule per QUESTIONS Q8 |
| `shift_code_legacy` | varchar(10) | yes | IFL's original (incorrect) value — lets us show both |
| `hanger_num` | int | yes | |
| `source_station` | int | yes | |
| `lifter_station` | int | yes | |
| `weight_g` | decimal(10,2) | yes | Grams; gross/net per QUESTIONS Q5 |
| `in_range` | bit | yes | |
| **`cone_id`** | **nvarchar(64)** | **YES — null in Phase 1** | **Populated by Component B in Phase 2** |
| **`cone_id_source`** | **varchar(20)** | **YES — null in Phase 1** | **Provenance: `plc_direct` \| `sql_sync` \| null** |
| `material_id` | int | yes | Resolved attribution (§5) |
| `lot_code` | nvarchar(64) | yes | Resolved attribution (§5) |
| `attribution_method` | varchar(30) | yes | `none` \| `active_material` \| `manual_entry` \| `cone_id` |
| `attribution_confidence` | varchar(10) | yes | `high` \| `low` \| `ambiguous` |
| `source_system` | varchar(20) | no | `ifl_sql` \| `plc_direct` |
| `source_row_id` | bigint | yes | IFL's `id` |
| `merge_key_is_unique` | bit | no | False where DQ-2 collision detected |

Unique index on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)`.
Covering indexes on `(shift_date, shift_code)` and `(production_ts_utc)`.

> **The Phase 2 promise:** `cone_id` and `cone_id_source` exist and are nullable from day one. Component B's arrival is an `UPDATE … SET cone_id = ?, cone_id_source = 'plc_direct'` on matched rows. **No migration, no downtime, no schema change.**

### `sms.sack_event` — one row per sack weighing
Same shape, minus hanger/station, with `sack_num` (not a key — resets, SCHEMA.md DQ-3), `weight_kg`, and the same `cone_id`-adjacent attribution and provenance columns.

### `sms.reject_event` — unified rejects
Merges `rejectQCS1_TP1U2` and `rejectWeight1_TP1U2` into one table with `reject_type` (`quality` \| `weight`), `tube_inspect_code`, `material_inspect_code`, `weight_g`. Code→label decoding lives in a lookup table populated when QUESTIONS Q10 is answered — the raw codes are stored regardless, so nothing is lost by waiting.

### Supporting tables
`sms.material` / `sms.blend` / `sms.yarn_count` / `sms.tube_type` (mirrored from PDAS, seed rows 1–10 filtered per SCHEMA.md DQ-10) · `sms.reject_code` (lookup, pending Q10) · `sms.sync_run` (audit: run id, adapter, watermark, rows read/written, duration, outcome) · `sms.app_user` / `sms.role` (fresh auth — **not** IFL's plaintext `Users`).

---

## 5. Product attribution — behind an interface

Product-wise reporting depends entirely on **QUESTIONS Q1**, which is unanswered. Rather than block Phase 1, attribution is a strategy interface with swappable implementations.

```
interface ProductAttributionStrategy:
    resolve(event) -> AttributionResult(material_id, lot_code, method, confidence)
```

| Implementation | When it applies | Status |
|---|---|---|
| `NullAttribution` | **Historical data — CONFIRMED default (Q1)** | Leaves attribution null. IFL confirmed **product-wise historical reporting is not required.** All reporting is time/shift/station-wise. |
| `ManualEntryAttribution` | **Forward-only — CONFIRMED approach (Q1)** | A Process Engineer sets the **Current Product** via the app; it persists in the app-owned DB until changed, and events produced while it is active attribute to it. Writes go to **our DB only** — never IFL's (Q21). |
| `ActiveMaterialAttribution` | Not selected | IFL did not choose the active-material inference; superseded by explicit manual entry. Kept as a possible implementation only. |
| `ConeIdAttribution` | Dormant | Depended on Component B (PLC), now out of scope (Q22). Interface slot retained. |

Attribution results are **stored denormalised** on the event row *and* recomputable — a background re-attribution job can backfill rows when the Current Product timeline changes.

**Confirmed consequence (Q1):** historical data carries no product attribution, and that is acceptable to IFL. Manual Current Product selection is a **forward-only** feature — it attributes cones produced *after* an engineer sets it, not the 18-day back-history. The primary dashboards IFL asked for (total cones, total rejected cones, total sacks, total sack weight) need **no** attribution and are unaffected.

---

## 6. Phase 1 screens

> **IFL's stated priority metrics (23 Jul 2026):** total cones produced · total rejected cones · total sacks produced · total sack weight. **None of these require product attribution or the reject-code key** — so Screen 1 (dashboard) is fully buildable now. This is the confirmed MVP.

| # | Screen | Source tables | Blocked? |
|---|---|---|---|
| 1 | **Production dashboard** — today's cones & sacks, rate, in-range %, live-ish tiles | `cone_event`, `sack_event` | No |
| 2 | **Shift summary** — output per shift, corrected vs legacy shift figures | `cone_event`, `sack_event` | No |
| 3 | **Sack register** — searchable/filterable list with weight, shift, in-range | `sack_event` | No |
| 4 | **Reject analysis** — counts and trend by type | `reject_event` | Partial — reason-level Pareto ⛔ pending **Q10** |
| 5 | **Weight consistency** — distribution, outliers, giveaway analysis vs setpoint | `cone_event`, `material` | Partial — setpoint compare needs **Q5** |
| 6 | **Station performance** — throughput and reject rate by station 1–14 | `cone_event`, `reject_event` | No (labels improve with **Q11**) |
| 7 | **Sync health** — last run, watermark, row counts, failures | `sync_run` | No |
| 8 | **Admin** — users, roles | `app_user`, `role` | No (login method per **Q18**) |
| — | Product/lot reporting | — | ➖ **Not required** for historical data (Q1); forward-only Current Product feature instead |
| — | Dispatch | — | ➖ **Out of scope — confirmed** (Q12) |

**Roles (provisional, pending Q17):** Operator → screens 1–3 · Supervisor → 1–6 + export · Manager → all reports · Admin → all + user management.

---

## 7. PLC reader — documented re-entry point (NO stub exists)

> **Status after Q22:** IFL confirmed **no PLC integration in scope**, so nothing
> was built.
>
> ### ⚠️ Corrected 17 Aug 2026 — this section previously overstated what exists.
>
> There is **no stub, no adapter, and no config parsing.** The keys below live in
> `.env.example` and **nothing reads them** — `PLC_READER_ENABLED` has zero hits
> in any `.ts` file. There is no class that raises `NotImplementedError`, and
> **no test asserts the flag defaults false or that no PLC library is importable**
> (the three test files are `appConfig`, `fingerprint`, `transform`).
>
> What is genuinely true and safe to state: **no PLC library appears in any of the
> five package manifests**, and IFL's own PLC addressing has been reverse-engineered
> into `SCHEMA.md` §2.1 so the homework is done. Call this *a documented,
> dependency-free re-entry point* — **never "PLC-ready" or "a stub"**.

The addressing below is real, taken from IFL's own `t_plcs` / `t_items` registry — it is reference material for whenever a PLC phase is actually commissioned, **not evidence of an implementation**:

```
# .env.example — DECLARED ONLY; no code reads these
PLC_READER_ENABLED=false      # never read by any .ts file
PLC_HOST=10.1.1.11            # from t_plcs
PLC_RACK=0
PLC_SLOT=1
PLC_CONE_ID_DB=DB7.DBD10      # P1_ConeID, from t_items
```

- Config keys are **declared, not parsed or validated**. No adapter is registered.
- **No PLC library is in any dependency manifest.** Enforced by review convention, not by a test — adding that test is cheap and would make the guarantee real.
- A test asserts the flag defaults to false and that no PLC dependency is importable — so Phase 1 cannot accidentally acquire PLC connectivity.

---

## 8. Open decisions — needed before coding starts

These are architecture choices not covered by prior agreement. Per the project rules I am **not** deciding them unilaterally.

| # | Decision | Recommendation |
|---|---|---|
| **D0** | ✅ **Sidecar sync** (Option B, §1) | Chosen. App-owned DB required anyway (Q1). **Deployment (user-confirmed):** build against supplied copy → go live by repointing the sync worker's *source* from copy to IFL's live DB; API/UI unchanged, read-only, no load/index impact on the live server. |
| **D1** | ✅ **SQL Server Express** | Already on the plant PC, same driver as source, free. |
| **D2** | ✅ **React + Node + TypeScript** | Solo dev → one language end to end, shared types. EMS stack deliberately not mirrored (UI/UX freedom was the goal). |
| **D3** | ✅ **60 s incremental** on `MAX(id)` watermark per table | |
| **D4** | ✅ **One-off 18-day backfill**, then incremental | |
| **D5** | ✅ **Session cookies** over JWT | Single-server intranet. AD vs app-local pending Q18. |

> **Retired by Q21:** the earlier "may we add indexes to IFL's DB?" decision is now a firm **no**. This is a further point in favour of the sidecar (D0-B), where indexing is entirely ours to control.

---

## 9. Traceability to client questions

| Question | Phase 1 impact if unanswered |
|---|---|
| **Q1** product link | ✅ Resolved — `NullAttribution` for history + forward-only manual entry. No product-wise historical reporting (accepted). |
| **Q4/Q5** weights gross/net | ❌ **Still open.** Figures shown as raw values, units labelled "unconfirmed" until answered. Affects total-sack-weight KPI accuracy, not its display. |
| **Q7 (shift fix?)** | ❌ **Still open.** Boundaries confirmed (Q8); fix-vs-reproduce undecided. Sidecar stores both, so no rework when decided. |
| **Q10** reject codes | ❌ **Still open.** Total reject **counts** (an IFL priority metric) work now; reason-level Pareto blocked. |
| **Q19** live server / **Q21** no-DB-changes | ✅ Resolved on constraints; ⚠️ triggers the D0 direct-connect-vs-sidecar decision (§1). Go-live also needs the live connection details. |
| **Q22** PLC | ✅ Resolved — no PLC; Component B dormant. |

**Net effect on the MVP:** IFL's four priority metrics (total cones, total rejected cones, total sacks, total sack weight) are all buildable **now**, with only the total-sack-weight *interpretation* (gross/net) pending Q4. The still-open questions block secondary analytics, not the confirmed dashboard.
