# Phase 1 contract — Configurable platform (roadmap Phase 1, Wave B)

Repository: `C:\Users\ABDULLAH SAJID\Desktop\sag database` (git, branch `floor-first-rework`). App under `sms/` (npm workspaces: shared, sync-worker, cli, api, web; Node 22; vitest). **Do not commit** — the orchestrator commits. **Do not run `npm ci`.** Run tests with `npx vitest run <path>` from `sms/`, typecheck with `npm run typecheck` from `sms/` (must stay at 0 errors — it builds all five workspaces; if another agent's in-progress file breaks it, typecheck only your workspace with `npx tsc -b <workspace>`).

## Schema already applied (migration `sms/db/migrations/028_configurable_platform.sql`, read it first)
- `sms.plant(plant_id, code, name)`, `sms.plant_unit(unit_id, plant_id, code, name)`, `sms.line(line_id, unit_id, code, name, display_name, is_active)` — seeded TP1 / U2 / line 1 `'TP1 · Line 3 · Unit 2'`.
- `sms.machine(machine_id, line_id, machine_no NULL, kind 'winder'|'packer'|'other', make, model, name, is_active, notes)` — seeded 14 Rieter winders (machine_no 1..14) + 1 Neuenhauser packer (machine_no NULL). Unique filtered index on (line_id, machine_no).
- `sms.station` gained `machine_id NULL FK`, `link_source VARCHAR(20) NULL` ('default_by_number' | 'admin'), `is_active BIT`. Stations 1..14 linked to winders 1..14.
- `sms.data_source(data_source_id, system_code 'ifl_sql', role 'acquisition'|'product_master'|'sack_packing', label, connection_key 'IFL_DB'|'PDAS', is_enabled, notes)` — three rows; sack_packing is disabled (not identified by IFL).
- `sms.source_table(source_table_id, line_id, data_source_id, kind 'cone'|'sack'|'reject_qcs'|'reject_weight', source_table, raw_table, is_enabled)` — four rows for line 1: pack1_TP1U2 → sms_raw.cone_raw, sack1_TP1U2 → sms_raw.sack_raw, rejectQCS1_TP1U2 → sms_raw.reject_qcs_raw, rejectWeight1_TP1U2 → sms_raw.reject_weight_raw.
- `sms.reject_code` gained `line_id INT NOT NULL DEFAULT 1`; unique index is now (line_id, reject_type, tube_code, material_code).
- Existing, unchanged: `sms.shift_rule` (morning_start/evening_start/night_start TIME, mode, night_belongs_to, effective_from, changed_by, reason — append-only, newest effective_from wins), `sms.weight_rule`, `sms.plausibility_rule`, `sms.audit_log(actor_id, action VARCHAR(40), target_type VARCHAR(40), target_id NVARCHAR(64), detail NVARCHAR(1000))`.

## Shared (already done in `sms/shared/src/domain/shift.ts`)
`ShiftBoundaries {morningStart, eveningStart, nightStart}` (minutes from midnight); `DEFAULT_SHIFT_BOUNDARIES` (06/14/22); `SHIFT_BOUNDARIES` is a deprecated alias of the default — **stop reading it**; `shiftCodeFromMinutes(minutes, boundaries = DEFAULT)`; `parseShiftTime('HH:MM') → minutes|null`; `formatShiftTime(minutes)`; `shiftBoundariesFrom(m, e, n) → ShiftBoundaries|null` (null unless morning < evening < night).

## API contract (Express, `sms/api/src/app.ts`; existing patterns: `requireRole(n)`, zod `safeParse`, `audit(req, action, targetType, targetId, detail)`)

### Read, any signed-in account (rank ≥ 1)
`GET /api/config` →
```json
{ "line": { "lineId": 1, "code": "L3", "name": "Line 3", "displayName": "TP1 · Line 3 · Unit 2", "isActive": true,
            "unit": { "unitId": 1, "code": "U2", "name": "Unit 2" }, "plant": { "plantId": 1, "code": "TP1", "name": "TP1" } },
  "lines": [ { "lineId": 1, "displayName": "TP1 · Line 3 · Unit 2", "isActive": true } ],
  "machines": [ { "machineId": 1, "machineNo": 1, "kind": "winder", "make": "Rieter", "model": null, "name": "Winder 1", "isActive": true, "notes": null } ],
  "stations": [ { "stationId": 1, "name": null, "description": null, "machineId": 1, "machineNo": 1, "machineName": "Winder 1", "linkSource": "default_by_number", "isActive": true } ] }
```
`GET /api/live` — each entry of `lines[]` (type `LiveLine`) gains `plantName: string` and `unitName: string`; `lineName` becomes `sms.line.display_name` (env `LINE_NAME` is only the fallback when the row is missing).

### Admin (rank 4). Every write below is AUDITED IN THE SAME TRANSACTION as the change (see "Transactional audit").
- `GET /api/admin/line` → `{ line: <as /api/config line> }`
- `PUT /api/admin/line` body `{ plantName?, unitName?, lineName?, displayName? }` (each string 1..128) → `{ ok: true }`. Audit action `line.rename`, target_type `line`, target_id lineId, detail "displayName \"old\" -> \"new\"; ...".
- `GET /api/admin/machines` → `{ machines: [...] }` (same shape as /api/config machines).
- `POST /api/admin/machines` body `{ machineNo: int|null, kind: 'winder'|'packer'|'other', name: string(1..64), make?: string|null, model?: string|null, notes?: string|null }` → 201 `{ machineId, stationCreated: boolean }`. A winder/other WITH a machineNo also gets a station row `(station_id = machineNo, line_id)` linked with `link_source='admin'` when no station with that id exists on the line; `stationCreated` says whether it did. 409 `{ error: 'machine number N already exists on this line' }` when taken. Audit `machine.create`.
- `PUT /api/admin/machines/:id` body `{ name?, make?, model?, notes?, isActive? }` → `{ ok: true }`; 404 when not on this line. Audit `machine.update` with old -> new per changed field.
- `POST /api/admin/stations` body `{ stationId: int ≥ 0, name?: string|null, machineId?: int|null }` → 201 `{ ok: true }`; 409 if it exists; 400 if machineId is not a machine on this line. Audit `station.create`.
- `PUT /api/admin/stations/:id` body (extends the existing route) `{ name: string|null, machine: string|null, description: string|null, machineId?: int|null, isActive?: boolean }` — when `machineId` is present (including null) set `machine_id` and `link_source='admin'`; existing 404 behaviour stays. Audit `station.rename` (existing) and additionally `station.link` when machineId changed.
- `GET /api/admin/sources` → `{ sources: [ { dataSourceId, systemCode, role, label, connectionKey, isEnabled, notes } ], tables: [ { sourceTableId, kind, sourceTable, rawTable, isEnabled, dataSourceId } ] }` (tables for the API's line).
- `PUT /api/admin/sources/:id` body `{ label?, isEnabled?, notes? }` → `{ ok: true }`. Audit `data_source.update`.
- `PUT /api/admin/sources/tables/:id` body `{ sourceTable?: string matching ^[A-Za-z_][A-Za-z0-9_]{0,127}$, isEnabled?: boolean }` → `{ ok: true, note: "Applies on the sync worker's next pass. A different table is a different source generation: the worker will halt on it until `sms epoch:accept` registers it." }`. 404 if the row is not this line's. Audit `source_table.update`.
- `POST /api/admin/rules/shift` body becomes `{ morningStart: 'HH:MM', eveningStart: 'HH:MM', nightStart: 'HH:MM', mode: 'corrected'|'legacy', nightBelongsTo: 'start_day'|'calendar_day', reason?: string }` — 400 with `detail` unless `shiftBoundariesFrom(...)` returns non-null. `setShiftRule` in `services/admin.ts` is parameterised (no more '06:00','14:00','22:00' literals). Response keeps `{ ok, rebuildRequired: true, note }`.
- `GET /api/admin/rules` unchanged shape (`shift.morningStart` etc. are already 'HH:MM' strings).
- `PUT /api/reject-codes/:id` (rank 3, existing) accepts `{ label?: string|null, isPass?: boolean|null, severity?: 'INFO'|'WARNING'|'ERROR'|'CRITICAL'|null }` — only fields present are changed; `GET /api/reject-codes` (if absent, ADD it at rank 1: `{ codes: [ { rejectCodeId, rejectType, tubeCode, materialCode, label, isPass, severity } ] }` for the line). Audit `reject_code.update`.

### Transactional audit
New helper in `sms/api/src/services/audit.ts`:
```ts
export async function auditedWrite<T>(pool, actorId: number, entry: { action; targetType; targetId; detail }, work: (tx: mssql.Transaction) => Promise<T>): Promise<T>
```
Opens an `mssql.Transaction`, runs `work(tx)` (callers use `new mssql.Request(tx)`), inserts the audit row with the same transaction, commits; any failure rolls back everything and rethrows. The existing fire-and-forget `audit()` in app.ts stays only for reads-with-side-effects that are not configuration (login, export). Configuration writes — rules, line, machines, stations, sources, reject codes, users — go through `auditedWrite`. `detail` may be computed inside `work` (return it) — design the helper so the detail can be produced after the write (e.g. `work` returns `{ result, detail }`).

## Sync worker contract (`sms/sync-worker`)
- `loadSourceTables(appPool, lineId): Promise<IflTableDef[]>` in `sync-worker/src/reader/sourceTables.ts`: `SELECT st.kind, st.source_table, st.raw_table, ds.system_code FROM sms.source_table st JOIN sms.data_source ds ON ds.data_source_id = st.data_source_id WHERE st.line_id=@line AND st.is_enabled=1 AND ds.is_enabled=1 ORDER BY st.source_table_id`, merged with the per-kind column shape (`TABLE_SHAPES[kind]`, the columns currently in `IFL_TABLES`). `IflTableDef` gains `systemCode: string`. Zero rows → throw `Error('No source tables are configured for line N. Add them in Setup › Sources (sms.source_table).')` — the runner halts (and records halt rows as it does for other pre-read halts). `IFL_TABLES` stays exported as `DEFAULT_IFL_TABLES` for tests/docs only.
- Every `'ifl_sql'` literal in `runner.ts`, `pipeline.ts`, `transform.ts`, `persistCanonical.ts` and `cli/src/commands/rebuild.ts` (`:35` and the DELETE at `:69`) comes from the source table's `systemCode` / the line's acquisition `data_source.system_code`.
- Shift rule: `resolveShiftRule(appPool, lineId, fallback)` (extend `resolveNightBelongsTo` in `runTransform.ts`) returns `{ boundaries: ShiftBoundaries, nightBelongsTo, mode }` from the newest `sms.shift_rule` row (TIME columns → minutes); the transform stamps `shift_code` with `shiftCodeFromMinutes(min, boundaries)` and `shift_date` with `shiftDateOf(wc, nightBelongsTo, boundaries)` (`wallClock.ts` takes boundaries; no `SHIFT_BOUNDARIES` import remains anywhere in the worker).
- `seedReference.ts`: remove `SELECT TOP (14)`. Stations are reconciled from machines: for every active `sms.machine` on the line with `kind IN ('winder','other')` and a non-null `machine_no` and no station row of that id, insert the station linked (`link_source='default_by_number'`). A line with no machines seeds no stations (the runbook says to add machines first).
- DQ finding `station_not_in_roster` (severity WARNING, subject_table = the raw table's short name, detail `machine number N observed in <source_table> (generation <epoch_id>) is not a station on line L — add it in Setup › Machines`), raised in the transform for cone/reject rows whose `src_MachineNo` is not in the line's station set; dedup is by detail so once per (station, table, generation).
- `cli`: `verify`, `cutover`, `epoch:*`, `summary` use `loadSourceTables` (with the same halt) instead of the const.

## Web contract (`sms/web`) — Setup gains sections; every string in `web/src/lib/words.ts`
Setup order: Sync health · **Line** (plant/unit/line names + display name, editable) · **Machines** (table: no, kind, make, model, name, active, linked station; "Add a machine" form) · Stations (existing; add: machine select, active toggle, "Add a station" row) · **Sources** (data sources with enable toggle and notes; the line's source tables with table-name input + enable; the note from the API shown after save) · **Rules** (three real forms replacing the read-only list: weight basis/tube/tare; shift — three time inputs + mode + night rule; plausibility — four bounds; each with a reason field and the API's note shown after save) · **Reject codes** (table: type, tube code, material code, label, pass?, severity — editable) · People · Audit.
Line.tsx and Wall.tsx stop parsing `lineName` on '·'; they print `plantName` / `unitName` / `lineName` from `/api/live`.
Client functions in `web/src/api.ts`, typed to the JSON above. No new dependency (no testing-library); `npm run typecheck` must pass.

## Non-negotiables
Parameterised SQL only (identifiers may not be parameters — validate against `^[A-Za-z_][A-Za-z0-9_]{0,127}$` and bracket-quote, as `seedProducts.ts` does). Never touch DATA_TP1U2 / PDAS_TP1U2. No PDAS writes. No new npm dependency. Preserve every existing test; add tests with every logic change (vitest, fake pools like `api/src/app.rbac.test.ts` and `sync-worker/src/runner.test.ts` do it). Keep comment density and voice of the surrounding code (explain WHY, cite the finding/date). Every seeded default that an IFL answer could change must say so in a comment (Q3 machine-vs-station; Q14 multi-line; Q7 shift mode).
