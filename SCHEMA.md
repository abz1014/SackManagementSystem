# SCHEMA.md — IFL Sack Management System (SMS)

**Source:** `SPS.adding` (RAR archive, renamed extension) provided by Ibrahim Fibres Limited.
**Contents:** a full SQL Server `DATA` directory copy — system DBs (master/model/msdb/tempdb) plus two application databases.
**Discovery performed:** 2026-07-21, against a local `.\SQLEXPRESS` instance with both DBs attached read-only for analysis.

| Database | Size | Purpose | Rows (largest) |
|---|---|---|---|
| `DATA_TP1U2` | 200 MB | PLC data acquisition — live sack & package weighing / rejects | `pack1` 949,188 |
| `PDAS_TP1U2` | 75 MB | Product master data, pallet definitions, label printing | `nhs_events` 3,062 |

Plant context inferred from data: a **polyester/viscose yarn spinning plant**, line designation **TP1 Line 3 / Unit 2 (TP1U2)**. Yarn is wound onto **cones** (~1.95 kg each), cones are auto-weighed and either **packed** or **rejected**, and cones are collected into **sacks** (~47 kg each).

---

## 1. ER-style overview

### 1.1 `DATA_TP1U2` — acquisition layer

There are **no foreign keys** in this database. Relationships below are *logical only*, enforced by triggers and application code.

```
t_plcs (2 PLCs: PLC_sack1 10.1.1.14, PLC_pack1 10.1.1.11 — Siemens S7-1500)
   │ 1:N  (t_items.plc_id → t_plcs.id, NOT enforced)
   ▼
t_items (23 tag definitions: PLC address ⇄ target table/column)
   │ 1:N  (<raw>.item_id → t_items.id, NOT enforced)
   ▼
┌─────────────────────────────────────────────────────────┐
│  RAW EAV TABLES  (one row per tag reading)               │
│  sack1 · pack1 · rejectQCS1 · rejectWeight1              │
│  (id, date, reference_value, item_id, value)             │
└─────────────────────────────────────────────────────────┘
   │  AFTER INSERT trigger pivots EAV → wide, once all
   │  tags for a given reference_value have arrived
   ▼
┌─────────────────────────────────────────────────────────┐
│  WIDE REPORTING TABLES  (one row per physical event)     │
│  sack1_TP1U2 · pack1_TP1U2 ·                             │
│  rejectQCS1_TP1U2 · rejectWeight1_TP1U2                  │
└─────────────────────────────────────────────────────────┘

Users (3 rows) — standalone, no FK to anything
pack2 / sack2 — EMPTY, structural placeholders for a second line
t_actual_value / t_write_value / *_edit — EMPTY, PLC write-back & audit scaffolding
```

**This is the critical structural insight for the app:** the `*_TP1U2` wide tables are the *only* ones worth reading for reporting. The raw EAV tables are ~6× larger, are the trigger's input, and contain no extra information.

### 1.2 `PDAS_TP1U2` — product master layer

This database is properly normalised, vendor-built (event log prefix `nhs_`), **with real foreign keys**.

```
Blends (10)      Counts (11)      TubeTypes (27)
     └──────────────┼─────────────────┘
                    ▼
                Materials (18)  ◄── the SKU: blend × count × tube colour
                    │                + setpoint weight & ± tolerance
                    ▼
                Pallets (18)  ──► PackSchemas (2) ──► PackTypes (2: Pallet 12.5 kg, Sack 0.5 kg)
                    │                    └────────► Separators (1: 600 g)
                    ▼
                Productions (0 rows — MODULE NEVER USED)
                    │
                    └──► nhs_printers (0 rows) / nhs_printerLabelTracker (0 rows)

nhs_events (3,062) — application audit log
nhs_*Captions / nhs_columnsMaxLen / nhs_settings — UI label & formatting config
```

### 1.3 ⚠️ The two databases are NOT linked

**There is no join key of any kind between `DATA_TP1U2` and `PDAS_TP1U2`.** The weighing records carry no `MaterialId`, `PalletId`, `Lot`, or product code. The only apparent linkage mechanism is **temporal + implicit**: `Materials.MaterialActive = 1` marks the SKU currently running, so a weighing row is attributed to whichever material was active at that moment.

This is **Open Question 1** and it is the single biggest determinant of what the app can report. Everything about product-wise / lot-wise reporting depends on the answer.

---

## 2. Table-by-table documentation

### 2.1 `DATA_TP1U2`

#### `t_plcs` — 2 rows — PLC connection registry
| Column | Type | Meaning |
|---|---|---|
| `id` | int IDENTITY PK | |
| `name` | varchar(255) | `PLC_sack1`, `PLC_pack1` |
| `ip` | varchar(255) | `10.1.1.14`, `10.1.1.11` — plant LAN |
| `rack`, `slot` | varchar(255) | S7 rack 0 / slot 1 |
| `cpu_type` | varchar(255) | `S71500` (Siemens S7-1500) |

Confirms the plant network is `10.1.x.x` and the app must run on the plant LAN.

#### `t_items` — 23 rows — PLC tag → table mapping
| Column | Type | Meaning |
|---|---|---|
| `id` | int IDENTITY PK | Referenced by `<raw>.item_id` |
| `plc_id` | int | → `t_plcs.id` |
| `tag_name` | varchar(255) | e.g. `S1_SackNetWeight`, `P1_Weight` |
| `description` | varchar(255) | Human label, e.g. "Weight of sack" |
| `connection_string` | varchar(255) | S7 address, e.g. `DB3.DBR48`, `DB7.DBW0` |
| `reference` | int | **1 = this tag is the group key** (`reference_value`); 0 = payload |
| `table_name` | varchar(255) | Destination raw table |

Full tag map:

| id | plc | tag | S7 addr | ref? | table | meaning |
|---|---|---|---|---|---|---|
| 1 | sack1 | `S1_Sack_No` | DB3.DBD32 | **1** | sack1 | sack sequence number |
| 2 | sack1 | `S1_SackNetWeight` | DB3.DBR48 | 0 | sack1 | sack weight |
| 3 | sack1 | `S1_SackWeightInRange` | DB3.DBX60.0 | 0 | sack1 | in-tolerance flag |
| 4 | pack1 | `P1_Hanger_No` | DB7.DBW0 | 0 | pack1 | conveyor hanger/carrier ID |
| 5 | pack1 | `P1_Timestamp` | DB7.DDT2 | **1** | pack1 | epoch-ms production time |
| 6 | pack1 | `P1_ConeID` | DB7.DBD10 | 0 | pack1 | **NOT persisted to wide table** |
| 7 | pack1 | `P1_Source` | DB7.DBB14 | 0 | pack1 | source station (1–14) |
| 8 | pack1 | `P1_Lifter` | DB7.DBB15 | 0 | pack1 | lifter station (1–14) |
| 9 | pack1 | `P1_PackageWeightInRang` | DB7.DBW16 | 0 | pack1 | in-tolerance flag |
| 10 | pack1 | `P1_Weight` | DB7.DBR18 | 0 | pack1 | cone/package weight |
| 11–17 | pack1 | `PQCS1_*` | DB7.DBW22–42 | 12=ref | rejectQCS1 | QC-station reject record |
| 18–23 | pack1 | `PW1_*` | DB7.DBW46–66 | 19=ref | rejectWeight1 | weight reject record |

Note `P1_ConeID` (item 6) **is captured in raw `pack1` but is dropped by the trigger** — it never reaches `pack1_TP1U2`. This may be a lost linkage to product identity (see Open Question 1).

#### `sack1` (raw, 16,386) / `sack1_TP1U2` (wide, 5,462) — **the core SMS table**
Wide table:

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `id` | int IDENTITY PK | | |
| `Date` | datetime | **Insert time (`GETDATE()`), NOT PLC event time** | see OQ-4 |
| `Shift` | varchar(8) | `Morning`/`Evening`/`Night` | derived in trigger from `Date` hour |
| `Area` | varchar(10) | Always `Sack-1` | hardcoded in trigger; `Sack-2` reserved |
| `SackNum` | int | PLC sack counter | resets to 0 — see DQ-3 |
| `Weight` | decimal(6,3) | Sack weight, **kg** (avg 47.22) | gross vs net → **OQ-2** |
| `inRange` | bit | 1 = within tolerance | 231 of 5,462 = **4.23 %** out of range |

Shift boundaries hardcoded in trigger: **Morning 06:00–14:00, Evening 14:00–22:00, Night 22:00–06:00**.

Data span: **2026-06-22 11:22 → 2026-07-10 12:09** (~18 days). Roughly 300–345 sacks/day.

#### `pack1` (raw, 949,188) / `pack1_TP1U2` (wide, 142,511) — cone/package weighing
| Column | Type | Meaning | Notes |
|---|---|---|---|
| `id` | int IDENTITY PK | | |
| `Date` | datetime | Insert time | |
| `Shift` | varchar(8) | derived from `Date` | |
| `Area` | varchar(10) | Always `Package-1` | |
| `ProductionDate` | datetime | **True PLC event time**, converted from epoch-ms → Pakistan Standard Time | |
| `HangerNum` | int | Conveyor hanger 1–299 | |
| `Source` | int | Source station 1–14 | |
| `Lifter` | int | Lifter station 1–14 | almost always `= Source` |
| `Weight` | decimal(6,2) | Cone weight, **grams** (avg 1951.5) | gross vs net → **OQ-3** |
| `inRange` | bit | 419 of 142,511 = **0.29 %** out of range | |

`Date − ProductionDate` averages **~3.8 hours** (min 909 s). The wide-table `Date` is therefore *not* usable as the event timestamp — **use `ProductionDate`**.

#### `rejectWeight1_TP1U2` — 246 rows — weight rejects
Same shape as `pack1_TP1U2` minus `inRange`, plus `Weight`. Avg 2010 g (vs 1951 accepted), range 0–2354 g — consistent with over/underweight rejects. **These rows do NOT also appear in `pack1_TP1U2`** (verified: zero hanger+time matches) — reject and accept streams are disjoint.

#### `rejectQCS1_TP1U2` — 2,900 rows — quality-control rejects
Adds `TubeInspectResult` and `MaterialInspectResult` (int codes) in place of weight.

Observed code pairs (Tube, Material) — **meaning unknown, see OQ-5**:
| Tube | Material | Count | % |
|---|---|---|---|
| 10 | 1 | 1,730 | 59.7 % |
| 2 | 1 | 764 | 26.3 % |
| 1 | 2 | 203 | 7.0 % |
| 1 | 1 | 84 | 2.9 % |
| 9 | 1 | 37 | 1.3 % |
| others | | 82 | 2.8 % |

QC rejects (2,900) outnumber weight rejects (246) by ~12:1. Against 142,511 packed cones, overall reject rate ≈ **2.2 %**.

#### `Users` — 3 rows — ⚠️ SECURITY
| Id | UserName | Password |
|---|---|---|
| 1 | Admin | `admin` |
| 2 | TP1Admin | `TP1Admin` |
| 3 | TP1User | `TP1User` |

**Passwords are stored in plaintext and equal the usernames.** No role column, no email, no last-login, no active flag. This table is **not fit for reuse** — see OQ-8.

#### Empty tables
`pack2`, `sack2` (second-line placeholders), `t_actual_value`, `t_write_value`, `t_write_value_edit`, `t_items_edit`, `t_plcs_edit` (PLC write-back + config audit scaffolding, unused).

### 2.2 `PDAS_TP1U2`

#### `Materials` — 18 rows — the SKU definition
`MaterialId` PK; FKs to `Blends`, `Counts`, `TubeTypes`.

| MaterialId | Blend | Count | Tube | Setpoint (g) | ± Tol (g) | Active | Desc1 | Desc2 |
|---|---|---|---|---|---|---|---|---|
| 1–10 | DEFAULT | DEFAULT | DEFAULT | 1950 | 30 | 0 | ConeID=1..10 | |
| 11 | PVSD8020 | 46 | LINE_GREEN | 1950 | 40 | 0 | 201-IH0-SD | PARROT |
| 12 | PVSD8020 | 50 | ORANGE | 1960 | 40 | 0 | 201-IH0-SD | |
| 13 | SLUBPVSD8020 | 40 | GREY | 1960 | 40 | 0 | 201-IH0-SD | |
| 14 | PVT8020 | 30 | KHAKI | 1960 | 30 | 0 | 204-ILT-BR | BROWN |
| 15 | PVSD8020 | 36 | BROWN | 1960 | 30 | 0 | 201-IHO-SD | BLACK |
| 16 | PVT8020 | 20 | STAR_RED | 1960 | 30 | 0 | 204-ILT-BR | ORANGE |
| **17** | PVT8020 | 20 | STR-RED | 1960 | 50 | **1** | STR-RED | ORANGE |
| **18** | PVT8020 | 30 | Khakhi-2 | 1960 | 50 | **1** | 204-ILT-BR | Khaki-2 |

Rows 1–10 are vendor seed/demo data. Rows 11–18 are real. **Two materials are simultaneously active** — which complicates "the currently running product" inference (see OQ-1).

Note `MaterialSetpointWeight` (1950–1960 g) matches `pack1_TP1U2.Weight` avg (1951.5 g) — **this confirms package weight is in grams and is per-cone.**

`MaterialDesc1` looks like a customer/order code (`201-IH0-SD`, `204-ILT-BR`); `MaterialDesc2` a colour name. Note typos in the source data: `201-IHO-SD` vs `201-IH0-SD` (letter O vs zero), `Khakhi-2` vs `Khaki-2`.

#### Reference tables
- **`Blends`** (10): `DEFAULT`, `PVSD8020`, `SLUBPVSD8020`, `CPPVSD8020`, `PPSD100`, `PVT8020`, `PVSD9010`, `SLUBPVSD9010`, `CPPVSD9010`, `VIS100`. Decode: PV=Polyester/Viscose, SD=Semi-Dull, T=?, 8020=80/20 blend ratio, CP=?, SLUB=slub yarn, VIS100=100 % viscose. → **OQ-6**
- **`Counts`** (11): `DEFAULT`, 18, 20, 24, 26, 28, 30, 36, 40, 46, 50 — yarn count (Ne). Stored as **nvarchar**, not numeric.
- **`TubeTypes`** (27): colour-coded cone tubes (`RED`, `DOT_BLUE`, `STAR_RED`, `LINE_GREEN`, `HFCIR_BLACK`, …). All non-default have `TubeWeight = 70.0` g and `TubeForm = 2`. → **OQ-7**
- **`PackTypes`** (2): `Palett` 12,500 g; `Sack` 500 g. These are **tare weights** of the packaging.
- **`PackSchemas`** (2): `Pallet 4x5` = 20 cones/layer, separator 201; `Sack 3x4` = 12 cones/layer, no separator.
- **`Separators`** (1): `Separator 201`, 600 g.

**Weight reconciliation (supports the sack↔cone relationship):**
`Sack 3x4` = 12 cones/layer. Observed sack weight 47.22 kg ÷ observed cone weight 1.9515 kg ≈ **24.2 cones**, i.e. **12 × 2 layers = 24 cones**, plus 0.5 kg sack tare:
> 24 × 1.9515 kg + 0.5 kg = **47.34 kg** vs observed mean **47.22 kg** ✅

This strongly implies a sack = **24 cones (2 layers of 12)** and that `sack1_TP1U2.Weight` is **gross (includes the 0.5 kg sack)**. Needs client confirmation → **OQ-2**.

However the *volume* ratio does not agree: 142,511 packed cones ÷ 5,462 sacks = **26.1 cones/sack**, not 24. Either some cones go to pallets rather than sacks, or sack records were lost. → **OQ-9**

#### `Pallets` — 18 rows
`PalletId`, `MaterialId` (FK), `PackSchemaId` (FK), `Lot` (nvarchar — holds the order code e.g. `204-ILT-BR`), `SteamProg`, `LabelType`, `Routing`, `PalletActive`, `PalletDesc1..5`. Rows 1–10 are seed data (`Lot = 'Data 1'…`). `PalletActive = 1` for PalletId 17 and 18 only.

#### `Productions` — **0 rows** — the label/pallet-output module was never used
Would hold `LabelId`, `PalletId`, `ConeCount`, `LayerCount`, `GrossWeight`, `NetWeight`, `TareWeight`, `PrinterNo`, `Printed`. **This is exactly the data an SMS would want** — and it is empty. → **OQ-10**

#### `nhs_events` — 3,062 rows — application audit log
`EventId`, `Src` (function/proc name), `Severity` (`info` 3,006 / `error` 36 / `warn` 20), `Logtext` (nvarchar(max), semicolon-delimited params), `Timestamp`. Span 2026-02-24 → 2026-07-10. Useful as a precedent for our own audit logging; not business data.

#### `nhs_printers` / `nhs_printerLabelTracker` — **0 rows** — no printers configured.

#### Config tables
`nhs_settings` (9 rows, label number format `0000000#`), `nhs_columnsMaxLen` (1 row, UI column widths), `nhs_materialCaptions` / `nhs_palletCaptions` / `nhs_printerCaptions` / `nhs_productionCaptions` (2 rows each: `en` + one other language) — UI label localisation. Not needed by our app.

#### Views & procedures (PDAS only)
- Views: `ActiveMaterials`, `Events`
- Scalar functions: `GenerateLabel`, `GetFullMonthsSeparation`, `UpdateColumnsMaxLen`
- Procs: `AddBlend`, `AddCount`, `AddTubeType`, `CreateMaterial`, `CreatePallet`, `GetAllBlends`, `GetAllCounts`, `GetAllMaterials`, `GetAllPallets`, `GetAllProduction`, `GetAllTubeTypes`, `SetMaterialStatusActive`, `SetPalletStatusActive`

These are the vendor app's API. We can reuse the `GetAll*` procs for read-only master-data screens, which would keep us consistent with vendor behaviour.

---

## 3. Data quality observations

| # | Severity | Finding |
|---|---|---|
| **DQ-1** | 🔴 High | **No foreign keys anywhere in `DATA_TP1U2`.** No referential integrity on the acquisition side. Orphan check passed today (0 orphan `item_id`), but nothing prevents future orphans. |
| **DQ-2** | 🔴 High | **`pack1.reference_value` is not unique.** It is an epoch-ms timestamp used as a group key. 11,906 of 142,511 groups (**8.4 %**) have >6 rows, meaning multiple cones share one timestamp. Worst case: `reference_value = -18000000` has **1,644 rows (274 cones)** — a PLC clock fault (negative epoch = 1970-01-01 minus 5 h). The trigger's `count(*)+1 = @valuesCount` guard silently mis-groups these. Wide-table row counts still reconcile exactly (142,511 = 142,511), so the damage is bounded, but **cone-level attribution within a collided group is unreliable**. |
| **DQ-3** | 🟠 Medium | **`sack1_TP1U2.SackNum` resets.** One reset observed: id 1209 on 2026-06-26 10:26 went from 5399 → 0. Range 0–9652 but only 5,462 distinct values → large gaps. `SackNum` is **not** a reliable unique key or a reliable production counter across the whole period. Use `id` as the key. |
| **DQ-4** | 🟠 Medium | **`Date` ≠ event time in `pack1_TP1U2`.** `Date` is `GETDATE()` at insert; lag to `ProductionDate` averages ~3.8 h. **`Shift` is derived from `Date`, so `Shift` is wrong** — a cone produced in the Morning may be labelled Night. Any shift-wise reporting must recompute the shift from `ProductionDate`. This is a genuine bug in the existing system. |
| **DQ-5** | 🟠 Medium | **`sack1_TP1U2` has no independent event time at all** — only `Date` (insert time). If sack inserts have a similar lag, sack shift attribution is also suspect. Cannot verify without a PLC-side timestamp. → OQ-4 |
| **DQ-6** | 🟡 Low | **Outlier weights.** `sack1_TP1U2`: 3 rows < 40 kg (0.000, 0.880, 37.660 kg) — all correctly flagged `inRange = 0`. `pack1_TP1U2`: 1 row at 824 g (flagged). `rejectWeight1_TP1U2` min 0.00 g. Dashboards must exclude or clearly mark these or averages will skew. |
| **DQ-7** | 🟡 Low | **`Source ≠ Lifter` in only 2 of 142,511 rows** (ids 3824, 14591). Both otherwise anomalous (one is the epoch-0 row). Effectively `Source` and `Lifter` are redundant — confirm before showing both. |
| **DQ-8** | 🟡 Low | **Master-data typos**: `201-IHO-SD` vs `201-IH0-SD` (O vs zero); `Khakhi-2` vs `Khaki-2`; `TubeTypes` has both `STAR_RED` and `STR-RED`. Grouping by these strings will split what should be one group. |
| **DQ-9** | 🟡 Low | **`rejectWeight1_TP1U2` identity starts at 0**, not 1 (ids 0–245, 246 rows) — unlike every other table. Any incremental read using `id > watermark` with a floor of 0 silently drops the id=0 row. The sync-worker floors the watermark at **-1** to include it (found + fixed during Step 2 backfill; source⇄raw now reconcile exactly at 246). |
| **DQ-9** | 🟡 Low | `Counts` values stored as **nvarchar** ("18", "50") — will sort lexically (`"46" < "50" < "9"`). Cast for ordering. |
| **DQ-10** | 🟡 Low | **Seed/demo data mixed with real data**: `Materials` 1–10 and `Pallets` 1–10 are vendor placeholders (`ConeID=1`, `Lot='Data 1'`). Must be filtered out of any UI. |
| **DQ-11** | 🔴 High | **Plaintext passwords** in `DATA_TP1U2.Users`, equal to usernames. Cannot be used as-is. |
| **DQ-12** | 🟢 Info | Raw↔wide reconciliation is **exact** for all four streams (sack 5,462=5,462; pack 142,511=142,511; QCS 2,900=2,900; weight 246=246). The trigger pipeline is not dropping records. |
| **DQ-13** | 🟢 Info | Only **18 days** of data (2026-06-22 → 2026-07-10). Insufficient for month-over-month or seasonal reporting at go-live. |

---

## 4. OPEN QUESTIONS for IFL

These must be answered before Phase 1 (SPEC). I have deliberately **not guessed** on any of these.

### Resolution log — IFL answers received 23 July 2026

Numbers below are the **QUESTIONS.md** numbers (client-facing), which differ from the OQ numbers here. Mapping in brackets.

| Client Q | OQ | Resolution |
|---|---|---|
| **Q1** [OQ-1] | ✅ RESOLVED | **No product data in the DB.** App provides a **Current Product** selector; a Process Engineer sets the active product, persisted to the **app-owned DB** (not IFL's). **Product-wise historical reporting is NOT required.** → attribution default stays `NullAttribution`; manual entry is forward-only. |
| **Q2** [OQ-13] | ⚠️ PARTIAL | Cone identity to be derived from `rejectWeight1_TP1U2.[Source]` (machine/source, 1–14). **Note:** `Source` is a *station*, not a unique per-cone id — enables source-wise traceability, not unique cone identification. |
| **Q8** [OQ-4] | ⚠️ PARTIAL | Shift boundaries **confirmed 06:00 / 14:00 / 22:00**. Still open: fix-vs-reproduce the shift-lag bug, and the night-shift date-attribution rule. |
| **Q12** [OQ-15] | ✅ RESOLVED | **Dispatch not required.** Production monitoring only. |
| **Q14** [OQ-11] | ⏳ PENDING | Single vs multiple lines — to be confirmed with textile team at upcoming meeting. Keep `line_id` throughout. |
| **Q19** [OQ-12] | ⚠️ SEE NOTE | Production: **web app connects directly to plant SQL Server over the factory LAN.** Dev uses the snapshot. **This conflicts with the sidecar-sync design — see SPEC.md §1 architecture note; needs a decision.** |
| **Q20** | ⏳ DEFERRED | Hosting/deployment architecture decided later, in production-planning phase. |
| **Q21** [OQ (new)] | ✅ HARD CONSTRAINT | **No modifications of any kind to IFL's production DB** — no schema, indexes, tables, procs, or data. All optimisation must live in the app layer. **This retires the "add indexes" option (former OQ re: index approval).** |
| **Q22** | ✅ RESOLVED | **No PLC integration in scope.** App consumes SQL Server only. → **Component B indefinitely deferred**; the PLC `cone_id` path is dormant (column kept nullable, cheaply). |

**Still blocking after this round:** weights gross/net + units (Q4/Q5 = OQ-2/OQ-3), reject-code meanings (Q10 = OQ-5), and the shift fix-vs-reproduce decision (part of Q7/Q8 = OQ-4).

### Blocking — these change what the app can do

**OQ-1 — How is a sack/cone linked to a product (Material / Lot / order)?** ✅ **RESOLVED 23 Jul 2026.**
Answer: no link exists in the DB and none is required historically. The app will offer a **Current Product** selector (Process Engineer sets it; persists until changed), stored in the **app-owned database**. Product-wise historical reporting is explicitly not required. Implementation: `NullAttribution` remains the default for historical data; `ManualEntryAttribution` becomes a forward-only feature (SPEC.md §5). *(Original question retained below for context.)*
There is no join key between the weighing data and the product master. Options: (a) infer from `Materials.MaterialActive = 1` at the time of weighing — but **two** materials are currently active, so this is ambiguous; (b) the dropped `P1_ConeID` tag carries it; (c) the link is tracked manually/on paper today; (d) it genuinely isn't tracked. **Which is it?** Without this, we cannot produce product-wise or lot-wise sack reports — only time/shift/station-wise.

**OQ-2 — Is `sack1_TP1U2.Weight` gross or net, and what unit?**
Values ~47.2. Arithmetic (24 cones × 1.9515 kg + 0.5 kg sack tare = 47.34 kg) suggests **kg, gross, 24 cones/sack**. Confirm: kg or lb? Does it include the sack? Is 24 cones/sack correct and fixed?

**OQ-3 — Is `pack1_TP1U2.Weight` gross or net, and does it include the 70 g tube?**
Values ~1951, matching `MaterialSetpointWeight` (1950–1960). Presumably **grams**. Is the 70 g `TubeWeight` included (gross) or already subtracted (net yarn)? This changes every yield calculation.

**OQ-4 — Should shift be recomputed from `ProductionDate`?** ⚠️ **PARTIAL 23 Jul 2026.**
Shift boundaries **confirmed: Morning 06:00–14:00, Evening 14:00–22:00, Night 22:00–06:00.** **Still open:** (a) fix-vs-reproduce the shift-lag bug, and (b) the night-shift date rule (does 22:00–06:00 belong to the starting or ending calendar day). Until decided, the sidecar stores both corrected and legacy shift so either can be shown.
The existing trigger derives `Shift` from insert time, which lags event time by ~3.8 h on average — so the stored `Shift` is demonstrably wrong for many rows (DQ-4). Do we (a) recompute shift correctly from `ProductionDate` in our app, and accept that our numbers won't match the vendor screens, or (b) reproduce the existing (incorrect) behaviour for consistency?

**OQ-5 — What do `TubeInspectResult` and `MaterialInspectResult` codes mean?**
Need the full code table. Dominant pairs: (10,1) 59.7 %, (2,1) 26.3 %, (1,2) 7.0 %, (1,1) 2.9 %. Is 1 = "pass"? Then what is a row doing in the *reject* table with (1,1)? A Pareto of reject reasons is a top-value dashboard, and it is blocked on this.

### Important — these shape scope

**OQ-6 — Confirm blend-code decoding.** Is `PVSD8020` = Polyester/Viscose Semi-Dull 80/20? What are `T`, `CP`, `SLUB` prefixes? Should the app parse these or treat them as opaque labels?

**OQ-7 — Is `TubeTypes.TubeForm` meaningful?** All real tubes are `TubeForm = 2`, `TubeWeight = 70 g`. Is tube colour used for product identification on the floor (i.e. is it operationally significant, or cosmetic)?

**OQ-8 — Who are the users and what are the roles?** The existing `Users` table has 3 plaintext accounts and no role column. We will build fresh auth. Please confirm: (a) the real operator/supervisor/admin headcount, (b) whether IFL wants Active Directory / domain SSO or app-local accounts, (c) whether the existing three accounts must keep working.

**OQ-9 — Why 26.1 cones per sack instead of 24?** 142,511 cones ÷ 5,462 sacks. Do some cones go to pallets instead of sacks? Are there sacks the system doesn't record? Is a partial/short sack possible?

**OQ-10 — Is the `Productions`/pallet/label module in scope?** It is fully built by the vendor but has **zero rows** and **zero printers configured** — it was never commissioned. Does IFL want the SMS to (a) ignore it, (b) start populating it, or (c) replace it? This is a large scope fork.

### Operational

**OQ-11 — Is `Area` ever anything but `Sack-1` / `Package-1`?** Hardcoded in triggers. `sack2`/`pack2` tables exist but are empty. Is a second sacking line planned? Should the app be multi-line from day one?

**OQ-12 — What is the live database?** ⚠️ **PARTIAL 23 Jul 2026.** In production the web app connects **directly to the plant SQL Server over the factory LAN**; dev uses the snapshot. Hostname/instance, retention, and read-only login still to be provided. **Direct-connect conflicts with the sidecar design — see SPEC.md §1.**
We received an 18-day snapshot from a plant PC. What is the production server hostname/instance, is it the same schema, what is the actual data volume and retention, and will we get a read-only login on the plant LAN?

**OQ-13 — Do `Source` / `Lifter` (1–14) map to named physical stations?** ⚠️ **NEW RELEVANCE 23 Jul 2026.** IFL (Q2) proposes using `Source` as the cone-traceability key — so meaningful station labels are now more valuable, not just nice-to-have. Labels still needed.
Station-wise reject analysis is high value (e.g. station 9 vs 11 reject rates), but only if we can label them meaningfully.

**OQ-14 — Do we need write access at all?** ✅ **RESOLVED 23 Jul 2026.** Writes to **IFL's DB: never** (Q21, hard constraint). Writes to the **app-owned DB: yes** — Current Product selection (Q1), plus users/roles/notes. The read-only rule applies strictly to the customer database.

**OQ-15 — Is there dispatch / despatch data anywhere?** ✅ **RESOLVED 23 Jul 2026 — dispatch NOT required** (Q12). Production monitoring only. Retained for record.
Your brief mentions dispatch. **Nothing in either database records dispatch, customer, vehicle, gate-pass, or delivery.**

**OQ-16 — Direct-connect vs sidecar (NEW, 23 Jul 2026).** Q19 says the web app connects directly to the plant SQL Server; Q21 forbids any index on that server; the date columns are unindexed, so direct dashboard queries scan 142k+ rows on a live plant box. Meanwhile Q1 forces an app-owned writable DB regardless. **Decision needed:** (a) app queries plant DB directly + app DB for product/user data, or (b) read-only sync into the app DB and query only that. See SPEC.md §1.

---

## 5. Practical guidance for the build

Derived from the above; carried into `CLAUDE.md`.

1. **Read only the `*_TP1U2` wide tables** for reporting. Never query raw `sack1`/`pack1` (6× the rows, no extra info).
2. **Use `ProductionDate` as event time** for `pack1_TP1U2` / reject tables. Recompute shift from it (pending OQ-4).
3. **Use `id` as the row key**, never `SackNum` (resets) or `reference_value` (collides).
4. **Filter seed data**: `Materials.MaterialId > 10`, `Pallets.PalletId > 10`.
5. **Exclude or flag outliers** in aggregates (sack < 40 kg, cone < 1500 g).
6. **Cast `Counts.Count` to int** for ordering.
7. **Build fresh auth** — do not reuse `DATA_TP1U2.Users`.
8. **Cross-database queries** (`DATA_TP1U2` ↔ `PDAS_TP1U2`) are possible on one instance via three-part names, but there is **no key to join on** (OQ-1).
9. Useful indexes already exist on the raw tables only; the wide tables have **only a clustered PK on `id`**. Date-range dashboard queries will table-scan. Adding a non-clustered index on `ProductionDate` / `Date` will likely be needed — **requires client approval as it is a write to their DB.**

---

## Appendix — reproducing this analysis

```powershell
# Extract (the .adding file is a RAR archive)
& "C:\Program Files\7-Zip\7z.exe" x "SPS.adding" -o"extracted"

# Attach read-only copies
sqlcmd -S ".\SQLEXPRESS" -C -Q "CREATE DATABASE DATA_TP1U2 ON (FILENAME=N'...\DATA_TP1U2.mdf'),(FILENAME=N'...\DATA_TP1U2_log.ldf') FOR ATTACH;"
sqlcmd -S ".\SQLEXPRESS" -C -Q "CREATE DATABASE PDAS_TP1U2 ON (FILENAME=N'...\PDAS_TP1U2.mdf'),(FILENAME=N'...\PDAS_TP1U2_log.ldf') FOR ATTACH;"
```

Scripts used: `introspect.sql` (keys/indexes/objects), `dq.sql` (profiling), `dq2.sql` (anomalies). Raw outputs in `schema_dump/`.
