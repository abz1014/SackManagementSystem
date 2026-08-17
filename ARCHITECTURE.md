# ARCHITECTURE.md — IFL Sack Management System (Phase 2)

**Status:** **FROZEN BUILD CONTRACT** (23 July 2026). Further changes come from running-code evidence, not upfront design.
**Stack:** React + Node + TypeScript · sidecar sync · SQL Server Express · Express API
**Read with:** `SPEC.md` (scope), `SCHEMA.md` (IFL's DB), `CLAUDE.md` (rules + decisions)

> This is a single-plant, single-line, solo-developer industrial data platform, deployed on the plant intranet. Design investment is matched to that context using one test: **adopt now only what is cheap to build in now and expensive to retrofit later.** Infra-heavy items with cheap-later retrofits (Redis, Prometheus/Grafana, multi-factory) are deliberately deferred with named triggers (§16).

---

## 1. System shape

```
                         ┌────────────────────────────────────────────────────────┐
                         │                      ONE MACHINE                        │
                         │                (plant PC / industrial server)           │
 ┌──────────────┐  read  │  ┌────────┐   ┌──────────┐   ┌───────────┐   ┌────────┐ │
 │ IFL SQL Srv  │ only,  │  │ Reader │──►│ sms_raw.*│──►│ Transform │──►│ sms.*  │ │
 │ DATA_TP1U2   │ overlap│  │ +retry │   │ verbatim │   │ (versioned│   │canonical│ │
 │ PDAS_TP1U2   │◄───────┼──│ +schema│   │  replay  │   │  pure fn) │   │        │ │
 │ (copy→live)  │ window │  │  hash  │   └──────────┘   └───────────┘   └───┬────┘ │
 └──────────────┘        │  └────────┘                                      │      │
                         │        │ writes sync_run + dq_finding            │      │
                         │        ▼                                         │      │
                         │  ┌──────────────┐          ┌────────────────┐    │ read │
                         │  │  Operations  │          │  Express API   │◄───┘      │
                         │  │ sync/DQ/logs │          │ /production ... │           │
                         │  │ schema/latency│         │ +TTL cache      │           │
                         │  └──────────────┘          └───────┬────────┘           │
                         │                                    │ JSON+metadata      │
                         │                            ┌───────▼────────┐           │
                         │                            │  React SPA     │           │
                         │                            └────────────────┘           │
                         └────────────────────────────────────────────────────────┘

 Dev→Live cutover = repoint the Reader's SOURCE connection string. Nothing else changes.
 Canonical is ALWAYS rebuildable from sms_raw.* — so interpretation mistakes are recoverable
 without re-reading the plant DB.
```

**Pipeline stages are independent and separately testable** (addresses the "was it SQL, transform, merge, or watermark?" debugging problem):

| Stage | Responsibility | Tested by |
|---|---|---|
| **Reader** | Read IFL rows (read-only, overlap window, retry, schema-fingerprint check) → write verbatim to `sms_raw.*` | Integration test vs the local copy |
| **Transform** | Pure function: raw row → canonical event (shift, weights, merge key, DQ tags). Stamped with `transform_version`. | Pure unit tests, no DB |
| **Persistence** | Idempotent upsert of canonical events; provenance; `sync_run` | Unit + integration |
| **Metrics/API** | Read canonical, serve filtered ranges | Unit + integration |

---

## 2. Monorepo layout

```
sms/
├─ shared/                     # TS domain types, config schema, transform-version constant
├─ sync-worker/
│  ├─ src/
│  │  ├─ reader/               # IFL read: overlap window, retry/backoff, schema fingerprint
│  │  ├─ raw/                  # write verbatim rows to sms_raw.*
│  │  ├─ transform/            # PURE raw→canonical (versioned); shift, weight, merge key, DQ tags
│  │  ├─ persist/              # idempotent upsert + provenance + sync_run
│  │  ├─ dq/                   # data-quality checks → dq_finding (with severity)
│  │  ├─ attribution/          # ProductAttributionStrategy (time-versioned)
│  │  ├─ runner.ts             # orchestrates stages; watermark; schedule
│  │  └─ index.ts
├─ cli/                        # `sms sync | verify | summary` — debug before API/UI exists (§18)
├─ api/                        # Express REST + auth + TTL cache; /production, /operations, ...
├─ web/                        # React SPA
└─ db/
   ├─ migrations/              # app-DB DDL: sms_raw.*, sms.*, reference tables
   └─ seed/                    # stations 1–14, reject codes (unlabelled), rules, roles
```

---

## 3. Raw → Canonical, and transform versioning

**Raw layer (`sms_raw.*`)** — the **replay source**: append-only, never interpreted. "Lean" is defined at the **table** level, verbatim at the **column** level:

- **Only the 4 event wide tables** are captured: `sack1_TP1U2`, `pack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`. The bloated EAV tables (`pack1` = 949k rows, same info) are never touched — that's the 6× lean.
- **PDAS is NOT mirrored into raw.** It is slowly-changing *reference* data (products/blends/tubes), not an event stream to replay — it flows into the versioned reference tables (§5), not `sms_raw`.
- Within the event tables, **all original columns are kept verbatim** (plus `raw_id`, `ingest_run_id`, `read_at_utc`). Column-pruning is deliberately rejected: a misinterpretation usually means "we should have used a column we ignored," so pruning deletes exactly what replay needs — and the saving is negligible (all 18 days of raw ≈ 10–15 MB; a year ≈ 200–300 MB).

**Canonical layer (`sms.*`)** — the shaped, reporting-ready events. **Always reproducible from raw.**

**Transform versioning:** every canonical row carries `transform_version` (an integer constant in `shared/`). When transform logic changes (v1→v2), we:
1. bump the constant,
2. rebuild canonical from raw for affected rows,
3. rows now show which logic produced them.

No guessing which interpretation is in a given row, ever. Rebuild is a CLI command (§18), not a re-read of IFL.

---

## 4. The three swappable unknowns (unchanged — see also §4 of prior revision)

Store raw truth, interpret at read time via **reference/rule tables** (§5). Defaults are honest, not assumed.

- **Q4/Q5 weight** — raw weight always stored; `weight_rule` decides gross/net/as-recorded at read time.
- **Q7/Q8 shift** — **cached derived** `shift_code` stored on canonical (for cheap indexing) **but source of truth is raw + `shift_rule`**; change the rule → rebuild from raw. `shift_code_legacy` also stored.
- **Q10 reject codes** — raw codes stored; `reject_code` table supplies labels when IFL answers; all history re-labels instantly.

> On the shift debate: cached-derived-in-canonical beats view-computation here because canonical is rebuildable from raw (so flexibility is preserved) *and* `shift_date` stays cheaply indexable for range queries. Confirmed with reviewer.

---

## 5. Reference data — real tables, not a generic bag

Domain entities get proper, **append-only versioned** tables (`effective_from`, `changed_by`, `reason`; never `UPDATE`). A generic `app_config` holds **only** genuine scalars that aren't entities.

| Table | Holds | Labels/values filled |
|---|---|---|
| `sms.station` | id (1–14), name, machine, description | Names pending Q11 — usable with raw ids meanwhile |
| `sms.reject_code` | reject_type, tube_code, material_code, label, is_pass, severity | Labels pending Q10 |
| `sms.product` | material/blend/count/tube mirror from PDAS (seed 1–10 filtered) | From PDAS |
| `sms.shift_rule` | boundaries + night-attribution rule, versioned | Q8 boundaries known; mode/night pending Q7 |
| `sms.weight_rule` | basis, cone tube g, sack tare kg, versioned | Pending Q4/Q5 |
| `sms.unit` | canonical units (kg, g) and display labels | Known |
| `sms.app_config` | true scalars only (sync interval, line id, cache TTL) | — |

Because rules are versioned tables, a rule change is auditable *and* triggers a scoped canonical rebuild.

---

## 6. Product attribution — time-versioned, append-only, dual timestamps

Replaces "active until changed." A `sms.product_timeline` records the running product as **intervals**, and every cone/sack event joins to the interval covering its production time.

```
sms.product_timeline (append-only — NEVER updated or deleted)
  timeline_id     bigint identity
  line_id         int
  product_id      int            -- what was running
  effective_from  datetime2      -- when production ACTUALLY changed (may be backdated)
  changed_at      datetime2      -- when the engineer RECORDED it (audit truth)
  changed_by      int            -- app_user
  reason          nvarchar(255)  -- optional note
```

- **`effective_from` ≠ `changed_at`** — an engineer recording at 13:15 that product changed at 13:05 sets `effective_from = 13:05`, `changed_at = 13:15`. Both are kept; neither is derivable from the other.
- **The "engineer forgot" gap:** events whose production time falls in no interval attribute to `method='none'`, `confidence` null, and raise a DQ finding (`WARNING`) — the gap is visible, not silently mis-assigned.
- Attribution is resolved at read time by interval join (and optionally cached onto canonical for speed, rebuildable).

---

## 7. Watermark & CDC safety

`MAX(source_row_id)` alone is unsafe (restore, reseed, deletes). Instead:

- **Overlap re-read window:** each incremental pass re-reads the last **N=500** source rows below the watermark and relies on the **idempotent upsert** (unique merge key) to absorb duplicates. Survives late inserts and small reseeds.
- **Idempotent upsert** on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)` — re-reading a row is a no-op.
- **Schema fingerprint at startup:** hash the *specific columns/types we depend on* in each IFL table; compare to the expected hash. A silent `decimal(10,2)→float` or a renamed/added column **halts sync with a clear error** rather than corrupting canonical. Fingerprint is over our dependencies only, not the noisy full DB.

---

## 8. Data Quality + Operations

DQ is first-class, not just flags. Checks run in the pipeline and write `sms.dq_finding` with **severity**:

```
sms.dq_finding
  finding_id, run_id, check_name, severity, subject_ref, detail, detected_at_utc
  severity ∈ INFO | WARNING | ERROR | CRITICAL
```

Checks: duplicate merge keys, missing/future timestamps, impossible/negative weights, outliers (sacks <40kg, cones <1500g), missing stations, unknown reject codes, attribution gaps (§6).

**Operations screen** (renamed from Sync Health) surfaces: last sync per table, watermark, rows read/written, retries, schema-fingerprint status, transform version, latency/source-age, and a DQ roll-up (`🔴 CRITICAL 3 · 🟡 WARNING 12`). This exists **before** the dashboard, so a "0 production" reading is immediately explainable.

---

## 9. API design — generalized, with metadata

Build the filtered range endpoint from day one, not a narrow `/metrics/today`:

```
GET /api/production?from=&to=&shift=&station=&product=&groupBy=day|shift|station
GET /api/rejects?from=&to=&type=&groupBy=reason|station
GET /api/operations         -- sync + DQ + schema + latency
```

**Every response is an envelope** so the UI can show honesty and freshness:

```json
{
  "data": { "cones": 142, "sacks": 6, "rejectedCones": 3, "sackWeightKg": 283.4 },
  "metadata": {
    "weightBasis": "as_recorded",
    "shiftMode": "corrected",
    "transformVersion": 1,
    "lastSyncUtc": "2026-07-10T12:10:03Z",
    "sourceAgeSeconds": 32,
    "dq": { "critical": 0, "warning": 2 }
  }
}
```

**Caching:** in-memory TTL cache (default 5s, in `app_config`) on read endpoints. No Redis — the sidecar already isolates IFL from load. **Trigger to revisit:** measured app-DB strain under real concurrency.

---

## 10. Interfaces (coupling boundaries)

> ### ⚠️ NEITHER INTERFACE EXISTS — corrected 17 Aug 2026
>
> Audited: **zero hits** for `IngestionAdapter` or `ProductAttributionStrategy`
> anywhere in the monorepo. These are the intended coupling boundaries; the code
> currently hardcodes both sides.
>
> - **Instead of `IngestionAdapter`:** a concrete `IflSqlAdapter` (which *does*
>   implement `readSince` and `fingerprint` as methods, and the schema-drift
>   fingerprint genuinely works and is good) but with no interface extracted, and
>   `source_system: 'ifl_sql'` baked into `transform.ts`.
> - **Instead of `ProductAttributionStrategy`:** `transform.ts:97` hardcodes
>   `attribution_method: 'none'`. There is no strategy type and nothing to swap.
>
> The *effects* described elsewhere in this document are honest (one source; no
> product attribution). The *swappability* is not built. Extracting these is
> ~1.5 wk and is a prerequisite for a second source. **Do not cite this section
> as evidence of pluggability to a customer.**

**Target shape (design intent, unbuilt):**

```ts
interface IngestionAdapter {           // the ONLY thing that knows IFL's schema
  readonly sourceId: 'ifl_sql' | 'plc_direct';
  readSince(w: Watermark): AsyncIterable<RawRow>;   // → sms_raw.*, verbatim
  fingerprint(): Promise<string>;                   // schema-drift guard (§7)
}
interface ProductAttributionStrategy {              // resolve(event) via product_timeline (§6)
  resolve(event: CanonicalEvent, at: Date): AttributionResult;
}
```

Canonical/API never see IFL's schema. A future Line 2 / other adapter changes only the adapter.

---

## 11. Auth & RBAC

Session cookies (httpOnly/secure/SameSite=strict), server-side session store. `argon2` hashes, fresh `sms.app_user`/`role` — never IFL's plaintext `Users`. Roles: operator / supervisor / manager / admin (pending Q17). AD/SSO (Q18) pluggable later without touching routes.

---

## 12. Retention & archival — an IFL BUSINESS DECISION, not a default

Retention is **IFL's call, not ours** — it's their data, and it may carry compliance *minimums* (ISO / customer-audit) and governance *maximums* (data-minimisation) that only they know.

**Critical point IFL must weigh:** raw retention has a **capability cost, not just storage.** Because raw is the replay source, "delete raw after N months" means "we can no longer retroactively fix an interpretation bug on data older than N months." This is not ordinary log rotation — it caps how far back a transform-version rebuild can reach.

| Data | Interim (until IFL sets policy) | Decision owner |
|---|---|---|
| `sms_raw.*` | Retain (small; ~10–15 MB for 18 days) | **IFL** — informed by the replay-capability trade above |
| `sms.*` canonical | Retain (rebuildable from raw while raw exists) | **IFL** |
| `dq_finding`, logs, `sync_run` | 90 days (operational, safe to rotate) | Us (operational) |

Interim = **"retain until IFL specifies"**, NOT "indefinite by design." Archival/compression tooling is **cheap-later** — built only when IFL's policy and real volume warrant it.

## 13. Backup & restore (app DB only)

The app DB holds the only irreplaceable data (product timeline, reject labels, users, config, rules). **Nightly full backup + monthly restore test.** Design principle enforced now: nothing lives only in memory or only in IFL. Actual schedule fits IFL's backup regime (IT, at deployment).

**Additional hard gate — snapshot before any canonical rebuild:** independent of the nightly backup, `sms rebuild` (§18) must take a point-in-time canonical snapshot first and refuses to run otherwise. The nightly backup can be up to 24 h stale; the pre-rebuild snapshot is exact and gives instant rollback if a new transform version is worse than the old one.

---

## 14. Observability, retry, performance

- **Observability (scoped to one box):** structured JSON logs, correlation `run_id` threaded through the pipeline, sync duration + rows/sec + slow-query logging into `sync_run`. **No** Prometheus/Grafana/ELK. **Trigger:** multi-node.
- **Retry:** exponential backoff on IFL disconnect; resume from watermark; persistent failure raises a `CRITICAL` dq/op finding.
- **Performance targets (guardrails, not current problems):** dashboard <300 ms, API <100 ms, sync pass <30 s. Tested against; at 142k rows we're far under.

---

## 15. Config & secrets

Env holds **only** secrets + connection + the dev→live switch (`IFL_DB_SERVER`). All *behavioural* config lives in versioned reference/rule tables or `app_config` (runtime-editable via Admin). Validated on boot (`zod`), fail fast.

## 16. Non-negotiables enforced structurally

Read-only IFL login held only by the Reader · no DDL/index/writes to IFL (Q21) · parameterised SQL only · no PLC dependency (asserted by test) · outliers flagged not silently dropped · `sms_raw` never mutated.

---

## 17. Deferred with triggers (explicitly NOT now)

| Deferred | Trigger to build |
|---|---|
| Redis | Measured app-DB strain under real concurrency |
| Prometheus/Grafana/ELK | Multi-node deployment |
| Archival tooling | Raw volume approaching ~2 years / disk pressure |
| Multi-line / multi-factory | A real second line (adapter + `line_id` already in place) |
| Component B (PLC) | IFL revisits PLC scope (Q22); stub + nullable `cone_id` already present |

---

## 18. CLI verification tool (`cli/`)

Before any API/UI, a CLI makes the pipeline debuggable:

```
sms sync            # run one sync pass (reader→raw→transform→canonical)
sms verify          # reconcile raw vs canonical vs IFL counts; list DQ findings
sms summary --date  # print totals (cones/sacks/rejects/weight) for a date/shift
sms rebuild         # rebuild canonical from raw at current transform_version
                    #   HARD GATE: refuses to run without a fresh canonical snapshot (§13)
```

**Rebuild safety gate:** `sms rebuild` will not proceed unless a **point-in-time snapshot of canonical** was taken immediately beforehand (the command takes it, or fails if it can't). It records `snapshot_id`, `from_transform_version`, `to_transform_version`, and row counts in an audit row. Rationale: a rebuild replaces the entire canonical set, so a buggy transform v2 corrupts what users see; the nightly backup (§13) can be ~24 h stale, whereas this snapshot is point-in-time exact and gives instant rollback. (Staged/blue-green rebuild — build into a copy, `verify`, then swap — is deferred; the snapshot gate is the right weight unless rebuilds become frequent.)

---

## 19. Build order (revised — demo at step 6, robust)

| # | Step | Milestone |
|---|---|---|
| 1 | ✅ **DONE** Models & DDL — raw, canonical (+transform_version), reference tables, product_timeline, dq_finding, rebuild_audit | Schema applied + verified (21 tables) |
| 2 | ✅ **DONE** Reader → `sms_raw.*` (overlap window, retry, schema fingerprint) | 151,119 rows synced, source⇄raw reconciled exactly |
| 3 | ✅ **DONE** Transform → `sms.*` (pure, versioned) + inline DQ | 151k canonical rows; shift-fix live (4.45% of cones corrected); idempotent; DQ matches SCHEMA DQ-6 |
| 4 | ✅ **DONE** CLI (`sync/verify/summary/rebuild`) | Reconciles source⇄raw⇄canonical; summary prints KPIs; rebuild snapshot-gate enforced |
| 5 | ✅ **DONE** Express API + Operations/DQ endpoint | `/api/health` + `/api/operations` live; metadata envelope; app-DB-only boundary held |
| 6 | ✅ **DONE** Generalized `/production` API (range+filters, groupBy, TTL cache, metadata) | Filters/grouping verified; cache MISS→HIT; totals reconcile (47.22 kg/sack) |
| 7 | ✅ **DONE Dashboard MVP** | **← the demo** — live React dashboard: 4 KPIs, date/shift filter, shift breakdown, freshness badge; interactive, verified end-to-end |
| 8 | ✅ **DONE** Shift analysis (corrected/legacy toggle) | Q7 self-answering: 6,340 (4.45%) mismatch shown, toggle verified in browser |
| 9 | ✅ **DONE** Reject analysis (Pareto + editable labels) | Q10 self-answering: 14-code Pareto (top 2 = 79.3% cum), inline label save round-trips |
| 10 | ✅ **DONE** Weight analysis (basis toggle) | Q4/Q5 self-answering: gross↔net swing flips overfill→underfill (~9.76 t), histograms + DQ-6 outliers, verified in browser |
| 11 | ✅ **DONE** Auth + Current Product (timeline) | Session-cookie auth (argon2), RBAC verified (401/403), login UI, Current Product selector on append-only timeline; PDAS products seeded |
| 12 | ✅ **DONE** Admin + Config/reference UI | Users/roles, station labels (Q11), versioned rule config (Q4/Q5·Q7); admin-only, verified in browser |
| 13 | ✅ **DONE** Hardening + deployment | Continuous self-healing sync loop, single-service static serving, structured logs, backup script, `DEPLOY.md` runbook; perf 11–15ms/prod (target <100ms) |

---

## 20. Sign-off & open items

**Design status: production-grade for a single-plant industrial system. Frozen.** Next change comes from running code.

**Open items (do not block Step 1):**
- Retention numbers (§12) and backup window (§13) — confirm with IFL/IT.
- Q4/Q5, Q7, Q10, Q11, Q14, Q17, Q18 — flow into their reference tables when answered.

**Approved (23 Jul 2026):** stack (React+Node+TS), Express, sidecar, SQL Express, and this architecture including the raw layer, transform versioning, time-versioned attribution, reference-data tables, CDC-safe watermark, DQ+Operations with severity, generalized+metadata API, CLI verify, retention/backup policy, and the deferral triggers.
