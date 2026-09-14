# SMS data dictionary — the app-owned database

Generated 2026-09-14T11:14:31.787Z by `npm run dictionary` (sms/scripts/data-dictionary.mjs) from `sms` on `localhost,14330` — 37 tables, 369 columns, 29 migrations applied (latest `029_provenance_and_source_columns.sql`). Do not edit by hand: types, nullability and defaults are read from the catalogue; descriptions live in `sms/db/dictionary.json`. This documents the sidecar SMS owns; IFL's own tables are described in `SCHEMA.md`.

**Two clocks.** Columns named `production_ts_utc` and `ingest_ts_utc` (and every raw `src_Date` / `src_ProductionDate`) hold the PLANT'S wall clock labelled as UTC — IFL's own values, stored verbatim. Columns SMS writes itself (`ingested_at_utc`, `read_at_utc`, `started_at_utc`, `effective_from`, `changed_at`, `at_utc`, ...) are real UTC. On this plant the two are five hours apart; never compare them unconverted (CLAUDE.md, redesign rule 2).

## Contents

- [sms_raw.cone_raw](#sms_rawcone_raw)
- [sms_raw.sack_raw](#sms_rawsack_raw)
- [sms_raw.reject_qcs_raw](#sms_rawreject_qcs_raw)
- [sms_raw.reject_weight_raw](#sms_rawreject_weight_raw)
- [sms.cone_event](#smscone_event)
- [sms.sack_event](#smssack_event)
- [sms.reject_event](#smsreject_event)
- [sms.source_epoch](#smssource_epoch)
- [sms.sync_run](#smssync_run)
- [sms.dq_finding](#smsdq_finding)
- [sms.rebuild_audit](#smsrebuild_audit)
- [sms.app_config](#smsapp_config)
- [sms.plant](#smsplant)
- [sms.plant_unit](#smsplant_unit)
- [sms.line](#smsline)
- [sms.machine](#smsmachine)
- [sms.station](#smsstation)
- [sms.data_source](#smsdata_source)
- [sms.source_table](#smssource_table)
- [sms.shift_rule](#smsshift_rule)
- [sms.weight_rule](#smsweight_rule)
- [sms.plausibility_rule](#smsplausibility_rule)
- [sms.reject_code](#smsreject_code)
- [sms.product](#smsproduct)
- [sms.product_limit_version](#smsproduct_limit_version)
- [sms.product_timeline](#smsproduct_timeline)
- [sms.product_change](#smsproduct_change)
- [sms.blend](#smsblend)
- [sms.yarn_count](#smsyarn_count)
- [sms.tube_type](#smstube_type)
- [sms.unit](#smsunit)
- [sms.calibration_adjustment](#smscalibration_adjustment)
- [sms.audit_log](#smsaudit_log)
- [sms.role](#smsrole)
- [sms.app_user](#smsapp_user)
- [sms.session](#smssession)
- [sms.schema_migration](#smsschema_migration)
- [Provenance chain](#provenance-chain)

<a id="sms_rawcone_raw"></a>
## sms_raw.cone_raw

Verbatim copy of IFL's pack1_TP1U2 (one row per cone weighing), append-only, never interpreted. The replay layer: canonical is rebuilt from here, never from IFL. `src_*` columns are IFL's own, names and types kept (migration 005, 024, 025).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `raw_id` | bigint | no |  | SMS's own identity for the row — monotone across source generations and never reused, which is why canonical dedupes on it and not on src_id. |
| `line_id` | int | no |  | The line this worker was configured for (LINE_ID). IFL's tables carry no line column; the line is which table was read. |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read this row. Copied onto the canonical row since transform version 2. |
| `read_at_utc` | datetime2(3) | no | sysutcdatetime() | When SMS read the row from IFL — real UTC. Copied onto the canonical row as ingested_at_utc. |
| `src_id` | int | no |  | IFL's `id`. Restarts at 1 when IFL recreates the table (2026-08-05), so it is unique only within (line_id, source_epoch). |
| `src_Date` | datetime | yes |  | IFL's insert time, plant wall clock: about 18 minutes after the weighing (measured mean 1090 s). NOT the event time. |
| `src_Shift` | varchar(8) | yes |  | IFL's own shift label, derived from insert time and therefore wrong for many rows (SCHEMA.md). Kept verbatim; the transform recomputes. |
| `src_Area` | varchar(10) | yes |  | IFL's area code as sent by the PLC. |
| `src_ProductionDate` | datetime | yes |  | The weighing time, plant wall clock. The event time canonical uses. |
| `src_HangerNum` | int | yes |  | The hanger position on the winder that carried the cone. |
| `src_MachineNo` | int | yes |  | The machine (winder, 1..14) that weighed the cone. Was named `Source` until IFL's 2026-08-05 rebuild; renamed here by migration 024, values unchanged. |
| `src_Lifter` | int | yes |  | The lifter station number as sent by the PLC. |
| `src_Weight` | decimal(6,2) | yes |  | Cone weight in grams, as the scale recorded it. Never mutated; the weight basis (gross/net, Q4/Q5) is applied at read time. |
| `src_inRange` | bit | yes |  | The scale's own in-range bit — the one status vocabulary the app shows as Passed / Rejected by the scale. |
| `src_MaterialId` | int | yes |  | IFL's product key (PDAS.dbo.Materials.MaterialId), populated on 100% of rows since 2026-08-05; NULL on every row read before the column existed. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — WHICH physical generation of pack1_TP1U2 this row came from. Part of every dedupe and merge key. |

<a id="sms_rawsack_raw"></a>
## sms_raw.sack_raw

Verbatim copy of IFL's sack1_TP1U2 (one row per sack weighing), append-only. Sacks carry no machine and no ProductionDate, which is why sack stock per machine cannot be computed from this data (CLAUDE.md sack-stock blocker).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `raw_id` | bigint | no |  | SMS's own identity for the row — monotone across source generations and never reused. |
| `line_id` | int | no |  | The line this worker was configured for (LINE_ID). |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read this row. |
| `read_at_utc` | datetime2(3) | no | sysutcdatetime() | When SMS read the row from IFL — real UTC. |
| `src_id` | int | no |  | IFL's `id`; unique only within (line_id, source_epoch). |
| `src_Date` | datetime | yes |  | IFL's insert time, plant wall clock. For sacks this IS the event time (there is no ProductionDate) — canonical flags it with production_ts_is_insert_time. |
| `src_Shift` | varchar(8) | yes |  | IFL's own shift label, derived from insert time. Kept verbatim. |
| `src_Area` | varchar(10) | yes |  | IFL's area code as sent by the PLC. |
| `src_SackNum` | int | yes |  | IFL's sack counter. NOT a key: it resets to 0 (SCHEMA.md DQ-3). |
| `src_Weight` | decimal(6,3) | yes |  | Sack weight in kilograms, as the scale recorded it. Tare (Q4/Q5) applied at read time. |
| `src_inRange` | bit | yes |  | The scale's own in-range bit. |
| `src_MaterialId` | int | yes |  | IFL's product key, populated since 2026-08-05; NULL before. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the generation of sack1_TP1U2 this row came from. |

<a id="sms_rawreject_qcs_raw"></a>
## sms_raw.reject_qcs_raw

Verbatim copy of IFL's rejectQCS1_TP1U2 — cones rejected by the quality inspection (tube / material), one row each. Lands in sms.reject_event as reject_type 'quality'.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `raw_id` | bigint | no |  | SMS's own identity for the row. |
| `line_id` | int | no |  | The line this worker was configured for (LINE_ID). |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read this row. |
| `read_at_utc` | datetime2(3) | no | sysutcdatetime() | When SMS read the row from IFL — real UTC. |
| `src_id` | int | no |  | IFL's `id`; unique only within (line_id, source_epoch). Shares its number space with nothing in rejectWeight1 — the two reject tables are independent counters. |
| `src_Date` | datetime | yes |  | IFL's insert time, plant wall clock. |
| `src_Shift` | varchar(8) | yes |  | IFL's own shift label. Kept verbatim. |
| `src_Area` | varchar(10) | yes |  | IFL's area code. |
| `src_ProductionDate` | datetime | yes |  | The inspection time, plant wall clock. The event time canonical uses. |
| `src_HangerNum` | int | yes |  | The hanger position that carried the cone. |
| `src_MachineNo` | int | yes |  | The machine (winder) the cone came from. Was `Source` before 2026-08-05. |
| `src_Lifter` | int | yes |  | The lifter station number. |
| `src_TubeInspectResult` | int | yes |  | IFL's tube inspection result code, verbatim. Meaning pending Q10; labelled in sms.reject_code. |
| `src_MaterialInspectResult` | int | yes |  | IFL's material inspection result code, verbatim. Meaning pending Q10. |
| `src_MaterialId` | int | yes |  | IFL's product key, populated since 2026-08-05; NULL before. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the generation of rejectQCS1_TP1U2 this row came from. |

<a id="sms_rawreject_weight_raw"></a>
## sms_raw.reject_weight_raw

Verbatim copy of IFL's rejectWeight1_TP1U2 — cones rejected on weight, one row each. Lands in sms.reject_event as reject_type 'weight'. Has a genuine row at src_id = 0, which is why the reader floors its watermark at -1.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `raw_id` | bigint | no |  | SMS's own identity for the row. |
| `line_id` | int | no |  | The line this worker was configured for (LINE_ID). |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read this row. |
| `read_at_utc` | datetime2(3) | no | sysutcdatetime() | When SMS read the row from IFL — real UTC. |
| `src_id` | int | no |  | IFL's `id`; unique only within (line_id, source_epoch). |
| `src_Date` | datetime | yes |  | IFL's insert time, plant wall clock. |
| `src_Shift` | varchar(8) | yes |  | IFL's own shift label. Kept verbatim. |
| `src_Area` | varchar(10) | yes |  | IFL's area code. |
| `src_ProductionDate` | datetime | yes |  | The weighing time, plant wall clock. The event time canonical uses. |
| `src_HangerNum` | int | yes |  | The hanger position that carried the cone. |
| `src_MachineNo` | int | yes |  | The machine (winder) the cone came from. Was `Source` before 2026-08-05. |
| `src_Lifter` | int | yes |  | The lifter station number. |
| `src_Weight` | decimal(6,2) | yes |  | The rejected cone's weight in grams, as recorded. |
| `src_MaterialId` | int | yes |  | IFL's product key, populated since 2026-08-05; NULL before. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the generation of rejectWeight1_TP1U2 this row came from. |

<a id="smscone_event"></a>
## sms.cone_event

One row per cone weighing, transformed from sms_raw.cone_raw (migrations 003, 023, 024, 025, 029). The reportable record: every screen's cone figures come from here. Rebuilt from raw by `sms rebuild`, never edited. The TypeScript contract is ConeReading in shared/src/domain/canonical.ts.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `cone_event_id` | bigint | no |  | Identity. Not a business key; use raw_id for lineage. |
| `line_id` | int | no |  | The line (sms.line). Stamped from the worker's LINE_ID — IFL's rows carry no line column. |
| `production_ts_utc` | datetime2(3) | no |  | IFL's ProductionDate: when the cone was weighed. PLANT WALL CLOCK labelled UTC — five hours off real UTC on this plant. Compare only with other plant-clock columns. |
| `production_ts_utc_ms` | bigint | no |  | production_ts_utc as epoch milliseconds of the wall clock. The time part of the merge key. |
| `ingest_ts_utc` | datetime2(3) | yes |  | IFL's Date: THEIR insert time (~18 min after the weighing), plant wall clock. Not SMS's ingest time — that is ingested_at_utc. A naming trap; kept for reconciliation. |
| `shift_code` | varchar(10) | no |  | morning \| evening \| night, recomputed from production_ts_utc under the sms.shift_rule in force at transform time. |
| `shift_date` | date | no |  | The production day the shift belongs to. A night shift after midnight belongs to the day it started when night_belongs_to = 'start_day'. |
| `shift_code_legacy` | varchar(10) | yes |  | IFL's own Shift value, normalised to lower case. Derived by IFL from insert time, so wrong for many rows; kept so the difference can be shown (Q7). |
| `hanger_num` | int | yes |  | The hanger position on the winder. Part of the merge key. |
| `source_station` | int | yes |  | IFL's MachineNo — the winder (1..14) that weighed the cone; joins sms.station.station_id. NULL when the source sent 0 (the PLC's zero value, not a position). |
| `lifter_station` | int | yes |  | IFL's Lifter; NULL when 0. |
| `weight_g` | decimal(10,2) | yes |  | Grams, exactly as the scale recorded. The weight basis (as_recorded / gross / net, sms.weight_rule) is applied when read, never here. |
| `in_range` | bit | yes |  | The scale's own in-range bit: Passed / Rejected by the scale. The product's tolerance is a SEPARATE fact, judged at read time by sms.product_limit_version. |
| `cone_id` | nvarchar(64) | yes |  | Reserved for the PLC cone id (Component B, deferred — IFL Q22). Always NULL. |
| `cone_id_source` | varchar(20) | yes |  | Provenance of cone_id: 'plc_direct' \| 'sql_sync'. Always NULL. |
| `material_id` | int | yes |  | The product (sms.product.product_id = PDAS MaterialId), from the row's own MaterialId. NULL when attribution_method is 'none'. |
| `lot_code` | nvarchar(64) | yes |  | Reserved; never populated (no lot key exists at IFL — SCHEMA.md OQ-1). |
| `attribution_method` | varchar(30) | yes |  | How material_id was resolved: 'source_column' (the row's own MaterialId, IFL's, trusted 10 Sep 2026) \| 'none' (the column did not exist when the row was read — every row before 2026-08-05) \| 'manual_entry' (reserved). |
| `attribution_confidence` | varchar(10) | yes |  | 'high' for source_column; NULL for none. |
| `source_system` | varchar(20) | no |  | sms.data_source.system_code the row was read through ('ifl_sql'). A configured string, not a literal. |
| `source_row_id` | bigint | yes |  | IFL's `id` in that generation. Names two different cones since 2026-08-05 unless paired with source_epoch. |
| `raw_id` | bigint | yes |  | sms_raw.cone_raw.raw_id — the lineage key. Unique here (UX_cone_raw_id, migration 026); the dedupe key for re-runs. |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read the raw row (since transform version 2; backfilled from raw by migration 029). Was a per-transform UUID that joined to nothing. |
| `ingest_seq` | int | no | 0 | Ordinal within a merge-key collision group (rows sharing line, production_ts_utc_ms, hanger_num, source_epoch); 0 when unique. Deterministic by source_row_id so rebuilds are stable. |
| `merge_key_is_unique` | bit | no | 1 | 0 when another row shares the merge key (DQ-2: possibly the same cone weighed twice, or two cones with the same timestamp and hanger). |
| `transform_version` | int | no | 1 | Which raw→canonical logic produced this row (shared/src/domain/version.ts). 2 since 14 Sep 2026; `sms rebuild` restamps. |
| `night_belongs_to` | varchar(15) | yes |  | The night-attribution rule that produced shift_date: 'start_day' \| 'calendar_day' (migration 023). |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the physical generation of pack1_TP1U2 the raw row came from. Part of the merge key. |
| `ingested_at_utc` | datetime2(3) | yes |  | When SMS read the raw row (sms_raw.cone_raw.read_at_utc) — REAL UTC. The ingestion timestamp the roadmap asks every record to preserve (migration 029). |

<a id="smssack_event"></a>
## sms.sack_event

One row per sack weighing, transformed from sms_raw.sack_raw (migrations 004, 023, 024, 025, 029). Contract: SackReading in canonical.ts. The sack ↔ cone link is approximate (no key exists; cones between consecutive sacks range 0–250) and the app says so.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `sack_event_id` | bigint | no |  | Identity. Not a business key. |
| `line_id` | int | no |  | The line (sms.line), from the worker's LINE_ID. |
| `production_ts_utc` | datetime2(3) | no |  | IFL's Date — sacks have no ProductionDate, so the insert time IS the event time (DQ-5). Plant wall clock labelled UTC. |
| `production_ts_utc_ms` | bigint | no |  | production_ts_utc as wall-clock epoch milliseconds; the merge key's time part. |
| `ingest_ts_utc` | datetime2(3) | yes |  | IFL's Date again (the same instant as production_ts_utc for sacks). Plant wall clock. |
| `production_ts_is_insert_time` | bit | no | 0 | Always 1: says production_ts_utc is IFL's insert time, so a reader can caveat it. |
| `shift_code` | varchar(10) | no |  | morning \| evening \| night under the shift rule in force at transform time. |
| `shift_date` | date | no |  | The production day the shift belongs to. |
| `shift_code_legacy` | varchar(10) | yes |  | IFL's own Shift value, normalised; kept for comparison (Q7). |
| `sack_num` | int | yes |  | IFL's SackNum. NOT a key — it resets to 0 (DQ-3). |
| `weight_kg` | decimal(10,3) | yes |  | Kilograms as the scale recorded. Tare (sms.weight_rule.sack_tare_kg) applied at read time. |
| `in_range` | bit | yes |  | The scale's own in-range bit. |
| `material_id` | int | yes |  | The product, from the row's own MaterialId; NULL when attribution_method is 'none'. |
| `lot_code` | nvarchar(64) | yes |  | Reserved; never populated. |
| `attribution_method` | varchar(30) | yes |  | 'source_column' \| 'none' \| 'manual_entry' (reserved) — same rule as cones. |
| `attribution_confidence` | varchar(10) | yes |  | 'high' for source_column; NULL for none. |
| `source_system` | varchar(20) | no |  | sms.data_source.system_code the row was read through. |
| `source_row_id` | bigint | yes |  | IFL's `id` in that generation. |
| `raw_id` | bigint | yes |  | sms_raw.sack_raw.raw_id — lineage and dedupe key. |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read the raw row. |
| `ingest_seq` | int | no | 0 | Ordinal within a merge-key collision group (line, production_ts_utc_ms, source_epoch); 0 when unique. |
| `merge_key_is_unique` | bit | no | 1 | 0 when another sack shares the same insert second in the same generation. |
| `transform_version` | int | no | 1 | Which transform produced the row; 2 since 14 Sep 2026. |
| `night_belongs_to` | varchar(15) | yes |  | The night-attribution rule that produced shift_date. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the generation of sack1_TP1U2 the raw row came from. |
| `ingested_at_utc` | datetime2(3) | yes |  | When SMS read the raw row — real UTC (migration 029). |

<a id="smsreject_event"></a>
## sms.reject_event

One row per rejected cone, from BOTH reject tables: reject_type 'quality' rows come from sms_raw.reject_qcs_raw, 'weight' rows from sms_raw.reject_weight_raw (migrations 008, 023, 024, 025, 029). Contract: RejectEvent in canonical.ts. raw_id alone is ambiguous here — pair it with reject_type.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `reject_event_id` | bigint | no |  | Identity. Not a business key. |
| `line_id` | int | no |  | The line (sms.line), from the worker's LINE_ID. |
| `reject_type` | varchar(10) | no |  | 'quality' (tube / material inspection) \| 'weight'. Also says which raw table raw_id refers to. |
| `production_ts_utc` | datetime2(3) | no |  | IFL's ProductionDate — when the cone was inspected or weighed. Plant wall clock labelled UTC. |
| `production_ts_utc_ms` | bigint | no |  | Wall-clock epoch milliseconds; the merge key's time part. |
| `ingest_ts_utc` | datetime2(3) | yes |  | IFL's Date: their insert time, plant wall clock. Not SMS's ingest time. |
| `shift_code` | varchar(10) | no |  | morning \| evening \| night under the shift rule in force at transform time. |
| `shift_date` | date | no |  | The production day the shift belongs to. |
| `shift_code_legacy` | varchar(10) | yes |  | IFL's own Shift value, normalised; kept for comparison (Q7). |
| `hanger_num` | int | yes |  | The hanger position; part of the merge key. |
| `source_station` | int | yes |  | IFL's MachineNo — the winder the cone came from; NULL when the source sent 0. |
| `lifter_station` | int | yes |  | IFL's Lifter; NULL when 0. |
| `tube_inspect_code` | int | yes |  | Raw TubeInspectResult, quality rejects only; NULL for weight rejects. Labelled via sms.reject_code (meaning pending Q10). |
| `material_inspect_code` | int | yes |  | Raw MaterialInspectResult, quality rejects only. |
| `weight_g` | decimal(10,2) | yes |  | Grams, weight rejects only; NULL for quality rejects. |
| `source_system` | varchar(20) | no |  | sms.data_source.system_code the row was read through. |
| `source_row_id` | bigint | yes |  | IFL's `id` in that generation, within that reject table. |
| `raw_id` | bigint | yes |  | raw_id in sms_raw.reject_qcs_raw OR sms_raw.reject_weight_raw, by reject_type. |
| `ingest_run_id` | uniqueidentifier | no |  | sms.sync_run.run_id of the pass that read the raw row. |
| `ingest_seq` | int | no | 0 | Ordinal within a merge-key collision group (line, reject_type, production_ts_utc_ms, hanger_num, source_epoch). |
| `transform_version` | int | no | 1 | Which transform produced the row; 2 since 14 Sep 2026. |
| `night_belongs_to` | varchar(15) | yes |  | The night-attribution rule that produced shift_date. |
| `material_id` | int | yes |  | The product, from the row's own MaterialId (migration 024). A reject rate is only meaningful per product. |
| `source_epoch` | int | no |  | sms.source_epoch.epoch_id — the generation of the reject table the raw row came from. |
| `attribution_method` | varchar(30) | yes |  | 'source_column' \| 'none' — the same rule as cones, stamped since migration 029 (rejects carried material_id and no method for three weeks). |
| `attribution_confidence` | varchar(10) | yes |  | 'high' for source_column; NULL for none. |
| `ingested_at_utc` | datetime2(3) | yes |  | When SMS read the raw row — real UTC (migration 029). |

<a id="smssource_epoch"></a>
## sms.source_epoch

One row per (line, source table, PHYSICAL GENERATION) of an IFL table (migrations 025, 026, 029). IFL dropped and recreated its four tables on 2026-08-05 and every identity restarted at 1; without this, every September row was discarded as already-seen. The worker resolves the open generation before every read and HALTS on an unknown one — `sms epoch:accept` registers it, never the worker.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `epoch_id` | int | no |  | Identity; the value raw and canonical rows carry as source_epoch. |
| `line_id` | int | no |  | The line the table belongs to. |
| `source_table` | varchar(64) | no |  | The IFL table name ('pack1_TP1U2', ...) as configured in sms.source_table at acceptance. |
| `source_server` | nvarchar(128) | no |  | IFL_DB_SERVER at acceptance. Part of the identity: a wrong database looks exactly like a rebuild, and the two need opposite responses. |
| `source_db` | nvarchar(128) | no |  | IFL_DB_NAME_DATA at acceptance. |
| `source_created_key` | varchar(40) | no |  | sys.tables.create_date of the source table as an ISO string, compared as text. The generation discriminator: it moves when IFL recreates the table. |
| `schema_fingerprint` | char(32) | no |  | MD5 over the columns SMS DEPENDS ON (name, type, precision). A change within an open generation halts the worker (schema drift). Blind to columns SMS does not read — see column_list. |
| `provenance` | varchar(20) | no |  | 'ifl_live' \| 'ifl_copy' \| 'simulator' — what kind of source this generation was. |
| `generation_ordinal` | int | no |  | 1, 2, 3... per (line, table). Human label only. |
| `label` | nvarchar(64) | no |  | Operator-given name ('September copy'). |
| `note` | nvarchar(1000) | yes |  | Free text; appended to by epoch:purge with the purge time. |
| `first_seen_utc` | datetime2(3) | no | sysutcdatetime() | When the row was registered — real UTC. |
| `last_seen_utc` | datetime2(3) | yes |  | Reserved; not maintained by the worker today. |
| `closed_utc` | datetime2(3) | yes |  | NULL while this is the open generation; set when superseded (epoch:accept) or purged. At most one open row per (line, table) — enforced by a filtered unique index. |
| `registered_by` | nvarchar(64) | no |  | 'bootstrap' \| 'cli:epoch-accept' \| 'cutover'. |
| `column_list` | nvarchar(max) | yes |  | JSON array of "name type" for EVERY column of the source table, in ordinal order, recorded at acceptance (or first seen by the worker after migration 029). The worker compares the live list on every pass and raises the WARNING finding source_columns_changed on a difference — non-fatal — so a column IFL adds that SMS does not read (the way MaterialId arrived) is noticed. |

<a id="smssync_run"></a>
## sms.sync_run

One row per (pass, source table): what the reader did and how it ended (migrations 002, 018, 025). The operational record; never deleted by cutover. Canonical rows join here through ingest_run_id = run_id.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `sync_run_id` | bigint | no |  | Identity. |
| `run_id` | uniqueidentifier | no |  | The pass id — one per worker tick, shared by that pass's rows; raw rows carry it as ingest_run_id, canonical rows too since transform version 2. Also the correlationId on the pass's log lines. |
| `adapter` | varchar(20) | no |  | sms.data_source.system_code the table was read through ('ifl_sql'); 'unknown' on a halt written before the configuration could be read. |
| `target_table` | varchar(40) | no |  | The raw table's short name ('cone_raw'). |
| `line_id` | int | no |  | The line. |
| `watermark_from` | bigint | yes |  | The highest src_id already held for this generation when the pass started; the read began 500 rows (SYNC_OVERLAP_ROWS) below it. |
| `watermark_to` | bigint | yes |  | The highest src_id held after the pass. |
| `rows_read` | int | no | 0 | Rows the source returned (overlap included). |
| `rows_written` | int | no | 0 | Rows actually new to raw. |
| `started_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |
| `finished_at_utc` | datetime2(3) | yes |  | Real UTC; NULL while a pass is in progress (`sms rebuild` refuses while any row is NULL here). |
| `outcome` | varchar(12) | no | 'running' | 'running' \| 'success' \| 'failed' (the read or write went wrong) \| 'halted' (the pass refused to read: unknown generation, source gone backwards, probe failed, configuration unreadable). Setup counts the latest row per table that is not 'success' as 'did not sync'. |
| `error_text` | nvarchar(max) | yes |  | Why, for failed/halted rows. Since Phase 2 prefixed with the failure's class — [transient] [auth] [schema] — when a driver or server error is the cause. |
| `source_epoch` | int | yes |  | The generation read; NULL on a halt that fired before it was resolved, or a pass from before epochs existed. |

<a id="smsdq_finding"></a>
## sms.dq_finding

Standing data-quality findings (migrations 009, 016). One row per (check, table, detail), deduplicated on insert so a fault raised every 60 s is recorded once. Data findings (a future timestamp) are facts about rows and stand; state findings (product_mirror_failed, transform_failed) are cleared when the condition clears. Check names are listed in sync-worker/src/transform/dq.ts.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `finding_id` | bigint | no |  | Identity. |
| `run_id` | uniqueidentifier | no |  | The pass (sms.sync_run.run_id) or transform run that raised it. |
| `check_name` | varchar(64) | no |  | future_timestamp, stale_timestamp, nonpositive_weight, outlier_weight, no_station, station_not_in_roster, source_columns_changed, merge_key_collision, raw_read_without_write, transform_zero_write, product_mirror_failed, transform_failed. |
| `severity` | varchar(10) | no |  | INFO \| WARNING \| ERROR \| CRITICAL. |
| `subject_table` | varchar(40) | yes |  | The raw table's short name ('cone_raw') for findings about what the source sent; the canonical table for findings about rows; 'product' for the mirror; NULL for the pass. |
| `subject_ref` | bigint | yes |  | raw_id of the FIRST offending row when the finding concerns rows (stale/future timestamp, impossible weight, station_not_in_roster) — Phase 3; NULL otherwise. The count of all offenders is in the detail. |
| `detail` | nvarchar(500) | yes |  | Plain-language description carrying the count and the specifics (machine number, generation, columns). Part of the dedupe key. |
| `detected_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC when first recorded. |

<a id="smsrebuild_audit"></a>
## sms.rebuild_audit

One row per `sms rebuild` (migrations 010, 017): snapshot id as given, versions from/to, outcome. See migration 010.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `rebuild_id` | bigint | no |  | See migrations 010, 017. |
| `snapshot_id` | nvarchar(128) | no |  | See migrations 010, 017. |
| `from_transform_version` | int | no |  | See migrations 010, 017. |
| `to_transform_version` | int | no |  | See migrations 010, 017. |
| `target_table` | varchar(40) | no |  | See migrations 010, 017. |
| `rows_rebuilt` | int | no | 0 | See migrations 010, 017. |
| `started_at_utc` | datetime2(3) | no | sysutcdatetime() | See migrations 010, 017. |
| `finished_at_utc` | datetime2(3) | yes |  | See migrations 010, 017. |
| `outcome` | varchar(12) | no | 'running' | See migrations 010, 017. |
| `initiated_by` | int | yes |  | See migrations 010, 017. |
| `error_message` | nvarchar(2000) | yes |  | See migrations 010, 017. |

<a id="smsapp_config"></a>
## sms.app_config

Key/value state the worker and API keep (migration 010): transform watermarks (transform_wm_*), cutover.last_utc. See migration 010.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `config_key` | varchar(64) | no |  | See migration 010. |
| `config_value` | nvarchar(255) | no |  | See migration 010. |
| `updated_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 010. |
| `updated_by` | int | yes |  | See migration 010. |

<a id="smsplant"></a>
## sms.plant

A plant (migration 028); seeded TP1.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `plant_id` | int | no |  | See migration 028. |
| `code` | varchar(16) | no |  | See migration 028. |
| `name` | nvarchar(128) | no |  | See migration 028. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 028. |

<a id="smsplant_unit"></a>
## sms.plant_unit

A unit within a plant (migration 028); seeded U2.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `unit_id` | int | no |  | See migration 028. |
| `plant_id` | int | no |  | See migration 028. |
| `code` | varchar(16) | no |  | See migration 028. |
| `name` | nvarchar(128) | no |  | See migration 028. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 028. |

<a id="smsline"></a>
## sms.line

A production line (migration 028): plant › unit › line. Seeded: TP1 / U2 / line 1 'TP1 · Line 3 · Unit 2'. Every reading carries line_id; a second line (Q14, open) is rows here and in sms.source_table, plus a second worker with its own LINE_ID.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `line_id` | int | no |  | The id every reading and configuration row carries. Matches the worker's LINE_ID. |
| `unit_id` | int | no |  | sms.plant_unit.unit_id. |
| `code` | varchar(16) | no |  | Short code ('L3'). |
| `name` | nvarchar(128) | no |  | Name ('Line 3'). |
| `display_name` | nvarchar(128) | no |  | What the top bar and the wall show ('TP1 · Line 3 · Unit 2'). Env LINE_NAME is only the fallback. |
| `is_active` | bit | no | 1 | 0 when retired. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |

<a id="smsmachine"></a>
## sms.machine

A physical machine on a line (migration 028): 14 Rieter winders (machine_no 1..14) and one Neuenhauser packer (no machine_no). Configuration, editable in Setup › Machines; a numbered winder gets a station row. Seeded defaults could change on IFL's Q3 answer.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `machine_id` | int | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `machine_no` | int | yes |  | The number IFL's source reports as MachineNo; NULL for machines that never weigh (the packer). Unique per line where present. |
| `kind` | varchar(16) | no |  | 'winder' \| 'packer' \| 'other'. |
| `make` | nvarchar(64) | yes |  | 'Rieter', 'Neuenhauser', ... |
| `model` | nvarchar(64) | yes |  | Model text. |
| `name` | nvarchar(64) | no |  | Display name ('Winder 1'). |
| `is_active` | bit | no | 1 | 0 when retired. |
| `notes` | nvarchar(255) | yes |  | Free text. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |

<a id="smsstation"></a>
## sms.station

A weighing position on a line — station_id IS the source's MachineNo (migrations 006, 021, 028). The one station table in the app; stations 1..14 are linked to the 14 Rieter winders. Q3 (machine vs station) is still open with IFL.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `station_id` | int | no |  | IFL's MachineNo (1..14). What cone_event.source_station joins. |
| `line_id` | int | no |  | The line. |
| `name` | nvarchar(64) | yes |  | Operator-given label (Q11). |
| `machine` | nvarchar(64) | yes |  | Free-text machine name from before machines were rows; kept for the label. |
| `description` | nvarchar(255) | yes |  | Free text. |
| `machine_id` | int | yes |  | sms.machine.machine_id this station belongs to; NULL when unlinked. |
| `link_source` | varchar(20) | yes |  | 'default_by_number' (linked by seedReference: station N ↔ winder N) \| 'admin' (set in Setup). |
| `is_active` | bit | no | 1 | 0 when retired in Setup. An inactive station's readings still count as the line's — the roster check uses every row. |

<a id="smsdata_source"></a>
## sms.data_source

A source system SMS reads through (migration 028): 'ifl_sql' acquisition (DATA_TP1U2), product_master (PDAS), and sack_packing (disabled — not identified by IFL). system_code is what readings carry as source_system.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `data_source_id` | int | no |  | Identity. |
| `system_code` | varchar(20) | no |  | The adapter registry key ('ifl_sql'); anything unregistered halts the worker. |
| `role` | varchar(20) | no |  | 'acquisition' \| 'product_master' \| 'sack_packing'. |
| `label` | nvarchar(128) | no |  | Display name. |
| `connection_key` | varchar(20) | no |  | 'IFL_DB' \| 'PDAS' — which .env connection block. |
| `is_enabled` | bit | no | 1 | 0 disables every table read through it. |
| `notes` | nvarchar(255) | yes |  | Free text. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |

<a id="smssource_table"></a>
## sms.source_table

Which physical IFL table feeds which raw table for a line (migration 028). Loaded by the worker at the start of every pass — a rename in Setup › Sources is a new source generation and halts until `sms epoch:accept`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `source_table_id` | int | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `data_source_id` | int | no |  | sms.data_source. |
| `kind` | varchar(20) | no |  | 'cone' \| 'sack' \| 'reject_qcs' \| 'reject_weight' — decides the column shape and the raw table. |
| `source_table` | nvarchar(128) | no |  | The table in the acquisition database ('pack1_TP1U2'); validated as a plain identifier before it is ever interpolated. |
| `raw_table` | varchar(64) | no |  | Fixed per kind ('sms_raw.cone_raw'); the worker refuses any other value. |
| `is_enabled` | bit | no | 1 | 0 stops the worker reading it. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |

<a id="smsshift_rule"></a>
## sms.shift_rule

The shift boundaries and night rule in force from effective_from — append-only, the newest effective_from wins (migration 006). Read by the transform at the start of every pass; changing it requires `sms rebuild` to restamp history. Q7 (fix vs reproduce IFL's shift, `mode`) is still open, so mode is carried but not applied.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `shift_rule_id` | bigint | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `morning_start` | time(0) | no |  | Start of the morning shift, plant local time. Seeded 06:00 (Q8, confirmed). |
| `evening_start` | time(0) | no |  | Start of the evening shift. Seeded 14:00. |
| `night_start` | time(0) | no |  | Start of the night shift. Seeded 22:00. |
| `mode` | varchar(10) | no |  | 'corrected' (recompute the shift from ProductionDate) \| 'legacy' (reproduce IFL's insert-time shift). Q7. |
| `night_belongs_to` | varchar(15) | no |  | 'start_day' (a night shift after midnight belongs to the day it started) \| 'calendar_day'. |
| `effective_from` | datetime2(3) | no |  | Real UTC from which this rule applies. |
| `changed_at` | datetime2(3) | no | sysutcdatetime() | Real UTC when written. |
| `changed_by` | int | yes |  | sms.app_user.user_id. |
| `reason` | nvarchar(255) | yes |  | Operator's reason. |

<a id="smsweight_rule"></a>
## sms.weight_rule

How a recorded weight is interpreted (migration 006): the basis and the tube / tare to subtract. Applied at read time; canonical weights are never mutated. Q4/Q5 (gross vs net, units) are still open with IFL, so the seeded basis is 'as_recorded'.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `weight_rule_id` | bigint | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `basis` | varchar(12) | no |  | 'as_recorded' \| 'gross' \| 'net'. |
| `cone_tube_weight_g` | decimal(10,2) | no |  | Tube weight subtracted from a cone under 'net', grams (env CONE_TUBE_WEIGHT_G seed). |
| `sack_tare_kg` | decimal(10,3) | no |  | Tare subtracted from a sack under 'net', kilograms. |
| `effective_from` | datetime2(3) | no |  | Real UTC from which this rule applies. |
| `changed_at` | datetime2(3) | no | sysutcdatetime() | Real UTC when written. |
| `changed_by` | int | yes |  | sms.app_user.user_id. |
| `reason` | nvarchar(255) | yes |  | Operator's reason. |

<a id="smsplausibility_rule"></a>
## sms.plausibility_rule

The bounds outside which a reading is treated as a scale or clock fault rather than production (migration 013): aggregates exclude them, DQ flags them (outlier_weight).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `plausibility_rule_id` | bigint | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `cone_lo_g` | decimal(10,2) | no |  | Lowest plausible cone weight, grams (seed 1500 — SCHEMA.md). |
| `cone_hi_g` | decimal(10,2) | no |  | Highest plausible cone weight, grams. |
| `sack_lo_kg` | decimal(10,3) | no |  | Lowest plausible sack weight, kilograms (seed 40). |
| `sack_hi_kg` | decimal(10,3) | no |  | Highest plausible sack weight, kilograms. |
| `effective_from` | datetime2(3) | no |  | Real UTC from which this rule applies. |
| `changed_at` | datetime2(3) | no | sysutcdatetime() | Real UTC when written. |
| `changed_by` | int | yes |  | sms.app_user.user_id. |
| `reason` | nvarchar(255) | yes |  | Operator's reason. |

<a id="smsreject_code"></a>
## sms.reject_code

Labels for the raw inspection codes (migrations 006, 028). Populated by the transform with every (type, tube code, material code) pair it sees; labels, pass flag and severity are set in Setup once IFL answers Q10. Unique per (line, type, tube, material).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `reject_code_id` | bigint | no |  | Identity. |
| `reject_type` | varchar(10) | no |  | 'quality' \| 'weight'. |
| `tube_code` | int | yes |  | Raw TubeInspectResult value. |
| `material_code` | int | yes |  | Raw MaterialInspectResult value. |
| `label` | nvarchar(128) | yes |  | Human label; NULL until IFL answers Q10. |
| `is_pass` | bit | yes |  | 1 if the code pair means the cone passed (some codes are not rejections); NULL unknown. |
| `severity` | varchar(10) | yes |  | INFO \| WARNING \| ERROR \| CRITICAL, optional. |
| `line_id` | int | no | 1 | The line (migration 028). |

<a id="smsproduct"></a>
## sms.product

Mirror of PDAS_TP1U2.dbo.Materials (MaterialId > 10, vendor seed rows excluded), refreshed every pass by seedProducts (migrations 006, 012, 020). Reference data for the product screens; readings do not depend on it — they carry IFL's own MaterialId.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `product_id` | int | no |  | PDAS MaterialId. The key readings carry as material_id. |
| `blend_id` | int | yes |  | sms.blend.blend_id (PDAS Blends). |
| `count_id` | int | yes |  | sms.yarn_count.count_id (PDAS Counts). |
| `tube_type_id` | int | yes |  | sms.tube_type.tube_type_id (PDAS TubeTypes). |
| `setpoint_weight_g` | decimal(10,2) | yes |  | Today's PDAS setpoint. Judge a reading by sms.product_limit_version, not this. |
| `active_flag` | bit | yes |  | PDAS MaterialActive, informational — up to six materials run concurrently on different machines. |
| `description` | nvarchar(255) | yes |  | PDAS description text. |
| `lot_code` | nvarchar(64) | yes |  | Reserved; PDAS has no lot. |
| `weight_offset_minus_g` | decimal(10,2) | yes |  | Today's PDAS lower tolerance, grams (migration 012). |
| `weight_offset_plus_g` | decimal(10,2) | yes |  | Today's PDAS upper tolerance, grams. |
| `color` | nvarchar(255) | yes |  | PDAS colour text (migration 020). |

<a id="smsproduct_limit_version"></a>
## sms.product_limit_version

Time-versioned product limits (migration 027). A reading is judged by the version in force at ITS time, never by today's mirror — the old app applied today's tolerance to readings weeks old. 'pdas_observed' rows record when the mirror first SAW a value, which is only a lower bound on when it started.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `version_id` | bigint | no |  | Identity. |
| `product_id` | int | no |  | sms.product.product_id = PDAS MaterialId. |
| `setpoint_g` | decimal(10,2) | yes |  | Target cone weight in grams under this version. |
| `offset_minus_g` | decimal(10,2) | yes |  | Tolerance below the setpoint, grams. |
| `offset_plus_g` | decimal(10,2) | yes |  | Tolerance above the setpoint, grams. |
| `effective_from` | datetime2(3) | no |  | Real UTC from which these limits apply. |
| `effective_is_lower_bound` | bit | no | 0 | 1 when effective_from is only when the mirror first saw the value (the true start is unknown, earlier or equal). |
| `source` | varchar(20) | no |  | 'pdas_observed' (seen in the PDAS mirror) \| 'sms_write' (written through SMS's PDAS write path, which ships OFF). |
| `changed_by` | int | yes |  | sms.app_user.user_id for sms_write rows. |
| `reason` | nvarchar(255) | yes |  | Operator's reason for sms_write rows. |
| `recorded_at` | datetime2(3) | no | sysutcdatetime() | Real UTC when the row was written. |

<a id="smsproduct_timeline"></a>
## sms.product_timeline

App-owned 'current product' timeline, set by an engineer (migration 007). Since 11 Sep 2026 only the fallback for rows without MaterialId. See migration 007.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `timeline_id` | bigint | no |  | See migration 007. |
| `line_id` | int | no |  | See migration 007. |
| `product_id` | int | no |  | See migration 007. |
| `effective_from` | datetime2(3) | no |  | See migration 007. |
| `changed_at` | datetime2(3) | no | sysutcdatetime() | See migration 007. |
| `changed_by` | int | yes |  | See migration 007. |
| `reason` | nvarchar(255) | yes |  | See migration 007. |
| `superseded` | bit | no | 0 | See migration 007. |

<a id="smsproduct_change"></a>
## sms.product_change

Every attempted PDAS write (create / retire / change limits) with before, after and echo-back (migration 027). The write path ships OFF (PDAS_WRITE_ENABLED=false). See migration 027.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `change_id` | bigint | no |  | See migration 027. |
| `product_id` | int | yes |  | See migration 027. |
| `operation` | varchar(20) | no |  | See migration 027. |
| `before_json` | nvarchar(max) | yes |  | See migration 027. |
| `after_json` | nvarchar(max) | yes |  | See migration 027. |
| `observed_after_json` | nvarchar(max) | yes |  | See migration 027. |
| `outcome` | varchar(20) | no |  | See migration 027. |
| `pdas_error_code` | int | yes |  | See migration 027. |
| `message` | nvarchar(500) | yes |  | See migration 027. |
| `effective_from` | datetime2(3) | yes |  | See migration 027. |
| `changed_at` | datetime2(3) | no | sysutcdatetime() | See migration 027. |
| `changed_by` | int | yes |  | See migration 027. |
| `reason` | nvarchar(255) | yes |  | See migration 027. |

<a id="smsblend"></a>
## sms.blend

PDAS Blends mirror (migration 006).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `blend_id` | int | no |  | See migration 006. |
| `blend` | nvarchar(255) | no |  | See migration 006. |

<a id="smsyarn_count"></a>
## sms.yarn_count

PDAS Counts mirror; Count cast to int for ordering (migration 006).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `count_id` | int | no |  | See migration 006. |
| `count_val` | int | yes |  | See migration 006. |
| `count_text` | nvarchar(255) | no |  | See migration 006. |

<a id="smstube_type"></a>
## sms.tube_type

PDAS TubeTypes mirror (migration 006).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `tube_type_id` | int | no |  | See migration 006. |
| `tube_type` | nvarchar(255) | no |  | See migration 006. |
| `tube_weight_g` | decimal(10,2) | yes |  | See migration 006. |

<a id="smsunit"></a>
## sms.unit

Weight units and their factor to grams (migration 006).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `unit_code` | varchar(8) | no |  | See migration 006. |
| `display` | nvarchar(20) | no |  | See migration 006. |
| `base_factor` | decimal(18,6) | no |  | See migration 006. |

<a id="smscalibration_adjustment"></a>
## sms.calibration_adjustment

A physical scale adjustment an engineer logged (migrations 015, 019), so the station drift charts can show when a station was touched.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `adjustment_id` | bigint | no |  | Identity. |
| `line_id` | int | no |  | The line. |
| `station_id` | int | yes |  | sms.station.station_id; NULL = a whole-line adjustment. |
| `adjusted_at_utc` | datetime2(3) | no |  | When the physical adjustment happened — real UTC as entered. |
| `recorded_at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC when logged. |
| `recorded_by` | int | yes |  | sms.app_user.user_id. |
| `reason` | nvarchar(255) | yes |  | Why. |
| `note` | nvarchar(500) | yes |  | Free text. |
| `amount_g` | decimal(10,2) | yes |  | The adjustment applied, grams, signed (migration 019); NULL when not recorded. |

<a id="smsaudit_log"></a>
## sms.audit_log

Who changed what in Setup (migration 014). Configuration writes are audited in the SAME transaction as the change (auditedWrite, Phase 1); login and export are logged fire-and-forget.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `audit_id` | bigint | no |  | Identity. |
| `at_utc` | datetime2(3) | no | sysutcdatetime() | Real UTC. |
| `actor_id` | int | yes |  | sms.app_user.user_id; NULL for system actions. |
| `action` | varchar(40) | no |  | 'user.create', 'station.rename', 'machine.create', 'line.rename', 'source_table.update', 'reject_code.update', 'rebuild', ... |
| `target_type` | varchar(40) | no |  | 'user', 'station', 'machine', 'line', 'data_source', 'source_table', 'reject_code', ... |
| `target_id` | nvarchar(64) | yes |  | The affected row's own key as text (ids vary in type). |
| `detail` | nvarchar(1000) | yes |  | Plain-language "old -> new", meant to be read, not parsed. |

<a id="smsrole"></a>
## sms.role

Roles by rank; writes are gated server-side by rank (migration 011). See migration 011.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `role_id` | int | no |  | See migration 011. |
| `name` | varchar(20) | no |  | See migration 011. |
| `rank` | int | no |  | See migration 011. |

<a id="smsapp_user"></a>
## sms.app_user

App-local accounts, argon2 hashes (migration 011). IFL's own Users table is NOT reused — it holds plaintext passwords. See migration 011.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `user_id` | int | no |  | See migration 011. |
| `username` | nvarchar(64) | no |  | See migration 011. |
| `password_hash` | nvarchar(256) | no |  | See migration 011. |
| `display_name` | nvarchar(128) | yes |  | See migration 011. |
| `role_id` | int | no |  | See migration 011. |
| `active` | bit | no | 1 | See migration 011. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 011. |

<a id="smssession"></a>
## sms.session

Session cookies; renewed while in use so a wall display never logs itself out (migration 011). See migration 011.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `session_id` | uniqueidentifier | no |  | See migration 011. |
| `user_id` | int | no |  | See migration 011. |
| `created_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 011. |
| `expires_at_utc` | datetime2(3) | no |  | See migration 011. |

<a id="smsschema_migration"></a>
## sms.schema_migration

Which db/migrations files have been applied (migration 022; written by scripts/migrate.mjs).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `filename` | varchar(255) | no |  | See migration 022. |
| `applied_at_utc` | datetime2(3) | no | sysutcdatetime() | See migration 022. |

<a id="provenance-chain"></a>
## Provenance chain

Every reportable row can be walked back to the pass that read it and the physical generation of the IFL table it came from. Nothing in the chain is inferred; each link is a stored column.

```
IFL table (DATA_TP1U2.dbo.pack1_TP1U2, id = 5, ProductionDate, MachineNo, MaterialId, ...)
   │  read by the sync-worker, one pass per minute, through the adapter sms.data_source.system_code names
   ▼
sms_raw.cone_raw          raw_id (SMS identity)  src_id = 5  source_epoch = 9  ingest_run_id = <pass>  read_at_utc = <real UTC>
   │  transformed (pure function, transform_version 2), deduplicated on raw_id
   ▼
sms.cone_event            raw_id  source_row_id = 5  source_epoch = 9  ingest_run_id = <pass>  ingested_at_utc = read_at_utc
   │                          │                        │
   │                          │                        └──► sms.source_epoch (epoch_id = 9): WHICH pack1_TP1U2 — server, database,
   │                          │                             create_date, fingerprint of the columns read, full column list, label
   │                          └──► sms.sync_run (run_id = <pass>): when it was read, watermarks, rows read/written, outcome
   └──► sms.dq_finding.subject_ref = raw_id: the first row a finding is about
```

1. **Source row → raw row.** `src_id` is IFL's `id`, unique only within a generation (IFL reset every identity to 1 on 2026-08-05). `source_epoch` says which generation; `(line_id, source_epoch, src_id)` is the raw dedupe key. `raw_id` is SMS's own identity and never repeats.
2. **Raw row → canonical row.** `raw_id` is copied onto the canonical row and is unique there; the transform is deterministic, so `sms rebuild` reproduces the same rows. `source_row_id` and `source_epoch` are copied for the reader; `ingest_run_id` and `ingested_at_utc` are copied from the raw row — since transform version 2, never minted.
3. **Canonical row → the pass.** `ingest_run_id = sms.sync_run.run_id`. The sync_run row says when the pass started and finished, what it read, and how it ended; the same id is the `correlationId` on the worker's log lines for that pass.
4. **Canonical row → the generation.** `source_epoch = sms.source_epoch.epoch_id`. The epoch row is the identity of the physical table that was read: server, database, `create_date`, the fingerprint of the columns SMS depends on (a change halts the worker) and the full column list (a change raises the WARNING finding `source_columns_changed`).
5. **Findings → rows.** `sms.dq_finding.subject_ref` is the `raw_id` of the first offending row for a finding about rows; `subject_table` says which raw or canonical table.

The API exposes this chain on every register row and reading sheet as a `provenance` object (roadmap Phase 3 item 4); the TypeScript contracts are `ConeReading` / `SackReading` / `RejectEvent` / `Provenance` in `sms/shared/src/domain/canonical.ts`.
