/**
 * The installation's configuration entities (roadmap Phase 1, migration 028):
 * plant › unit › line › machines, the stations they link to, and the data
 * sources and source tables that feed the line.
 *
 * Until 14 Sep 2026 none of this was data. The line's name was an env string
 * two screens parsed on '·' to recover a unit label; the fourteen winders
 * existed only as `SELECT TOP (14)` in the worker's station seed and as a
 * free-text `machine` column typed by hand; the source table names were a
 * const array. Adding a second machine was a source-code change, which is the
 * one thing Phase 1's acceptance forbids.
 *
 * Reads take the pool. Writes take the pool too but run their statements on a
 * transaction handed out by auditedWrite(), so the change and its audit row
 * commit together (services/audit.ts says why).
 *
 * Every seeded default here is a fact from IFL's own material and every one
 * is editable; three carry an open clarification:
 *   Q3  — station N ↔ machine N is linked BY NUMBER (link_source
 *         'default_by_number'). If IFL says a station is not a machine, the
 *         link is edited in Setup, not the code.
 *   Q14 — one line today. `lines[]` is returned so a second line is rows,
 *         not a rebuild; nothing else in the API is multi-line yet.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { auditedWrite } from './audit.js';

// ---------------------------------------------------------------- shapes (the /api/config contract)

export interface LineIdentity {
  lineId: number;
  code: string;
  name: string;
  displayName: string;
  isActive: boolean;
  unit: { unitId: number; code: string; name: string };
  plant: { plantId: number; code: string; name: string };
}

export interface LineSummary {
  lineId: number;
  displayName: string;
  isActive: boolean;
}

export type MachineKind = 'winder' | 'packer' | 'other';

export interface MachineRow {
  machineId: number;
  machineNo: number | null;
  kind: MachineKind;
  make: string | null;
  model: string | null;
  name: string;
  isActive: boolean;
  notes: string | null;
}

export interface StationConfigRow {
  stationId: number;
  name: string | null;
  description: string | null;
  machineId: number | null;
  machineNo: number | null;
  machineName: string | null;
  linkSource: string | null;
  isActive: boolean;
}

export interface LineConfig {
  line: LineIdentity;
  lines: LineSummary[];
  machines: MachineRow[];
  stations: StationConfigRow[];
}

export interface DataSourceRow {
  dataSourceId: number;
  systemCode: string;
  role: string;
  label: string;
  connectionKey: string;
  isEnabled: boolean;
  notes: string | null;
}

export interface SourceTableRow {
  sourceTableId: number;
  kind: string;
  sourceTable: string;
  rawTable: string;
  isEnabled: boolean;
  dataSourceId: number;
}

/** A SQL Server identifier, unquoted. Same rule seedProducts.ts applies to the
 *  PDAS database name: the API never builds SQL from this value — the worker
 *  bracket-quotes it — but a name that could not be bracket-quoted safely is
 *  refused at the door rather than stored for the worker to trip on. */
export const SOURCE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** SQL Server: invalid object name — the table does not exist. */
const INVALID_OBJECT = 208;

// ---------------------------------------------------------------- reads

interface LineRaw {
  line_id: number; line_code: string; line_name: string; display_name: string; is_active: boolean;
  unit_id: number; unit_code: string; unit_name: string;
  plant_id: number; plant_code: string; plant_name: string;
}

const LINE_SELECT = `
  SELECT l.line_id, l.code AS line_code, l.name AS line_name, l.display_name, l.is_active,
         u.unit_id, u.code AS unit_code, u.name AS unit_name,
         p.plant_id, p.code AS plant_code, p.name AS plant_name
    FROM sms.line l
    JOIN sms.plant_unit u ON u.unit_id = l.unit_id
    JOIN sms.plant p ON p.plant_id = u.plant_id
   WHERE l.line_id = @line`;

function mapLine(x: LineRaw): LineIdentity {
  return {
    lineId: Number(x.line_id),
    code: x.line_code,
    name: x.line_name,
    displayName: x.display_name,
    isActive: Boolean(x.is_active),
    unit: { unitId: Number(x.unit_id), code: x.unit_code, name: x.unit_name },
    plant: { plantId: Number(x.plant_id), code: x.plant_code, name: x.plant_name },
  };
}

/**
 * The line's identity, or null when there is no row.
 *
 * Null ALSO when sms.line does not exist (error 208): /api/live is polled by
 * the wall display, and a wall display must not go dark because migration
 * 028 has not been applied to this database yet — it falls back to the env
 * LINE_NAME it printed before. Every other caller wants the exception.
 */
export async function getLineIdentity(pool: ConnectionPool, lineId: number): Promise<LineIdentity | null> {
  try {
    const r = await pool.request().input('line', mssql.Int, lineId).query<LineRaw>(LINE_SELECT);
    return r.recordset[0] ? mapLine(r.recordset[0]) : null;
  } catch (err) {
    if ((err as { number?: number }).number === INVALID_OBJECT) return null;
    throw err;
  }
}

export async function listLines(pool: ConnectionPool): Promise<LineSummary[]> {
  const r = await pool.request().query<{ line_id: number; display_name: string; is_active: boolean }>(
    `SELECT line_id, display_name, is_active FROM sms.line ORDER BY line_id`,
  );
  return r.recordset.map((x) => ({ lineId: Number(x.line_id), displayName: x.display_name, isActive: Boolean(x.is_active) }));
}

interface MachineRaw {
  machine_id: number; machine_no: number | null; kind: string; make: string | null; model: string | null;
  name: string; is_active: boolean; notes: string | null;
}
const mapMachine = (x: MachineRaw): MachineRow => ({
  machineId: Number(x.machine_id),
  machineNo: x.machine_no == null ? null : Number(x.machine_no),
  kind: x.kind as MachineKind,
  make: x.make,
  model: x.model,
  name: x.name,
  isActive: Boolean(x.is_active),
  notes: x.notes,
});

export async function listMachines(pool: ConnectionPool, lineId: number): Promise<MachineRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<MachineRaw>(
    `SELECT machine_id, machine_no, kind, make, model, name, is_active, notes
       FROM sms.machine WHERE line_id = @line
      ORDER BY CASE WHEN machine_no IS NULL THEN 1 ELSE 0 END, machine_no, machine_id`,
  );
  return r.recordset.map(mapMachine);
}

export async function listStationConfig(pool: ConnectionPool, lineId: number): Promise<StationConfigRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    station_id: number; name: string | null; description: string | null; machine_id: number | null;
    machine_no: number | null; machine_name: string | null; link_source: string | null; is_active: boolean | null;
  }>(
    `SELECT s.station_id, s.name, s.description, s.machine_id, m.machine_no, m.name AS machine_name, s.link_source, s.is_active
       FROM sms.station s
       LEFT JOIN sms.machine m ON m.machine_id = s.machine_id
      WHERE s.line_id = @line ORDER BY s.station_id`,
  );
  return r.recordset.map((x) => ({
    stationId: Number(x.station_id),
    name: x.name,
    description: x.description,
    machineId: x.machine_id == null ? null : Number(x.machine_id),
    machineNo: x.machine_no == null ? null : Number(x.machine_no),
    machineName: x.machine_name,
    linkSource: x.link_source,
    isActive: x.is_active == null ? true : Boolean(x.is_active),
  }));
}

/** Everything /api/config answers with. Throws when the line has no row —
 *  a database this API is pointed at must carry migration 028. */
export async function getLineConfig(pool: ConnectionPool, lineId: number): Promise<LineConfig> {
  const [line, lines, machines, stations] = await Promise.all([
    getLineIdentity(pool, lineId),
    listLines(pool),
    listMachines(pool, lineId),
    listStationConfig(pool, lineId),
  ]);
  if (!line) {
    throw new Error(`sms.line has no row for line ${lineId} — apply migration 028 (or check LINE_ID)`);
  }
  return { line, lines, machines, stations };
}

export async function listSources(pool: ConnectionPool, lineId: number): Promise<{ sources: DataSourceRow[]; tables: SourceTableRow[] }> {
  const [s, t] = await Promise.all([
    pool.request().query<{
      data_source_id: number; system_code: string; role: string; label: string; connection_key: string; is_enabled: boolean; notes: string | null;
    }>(`SELECT data_source_id, system_code, role, label, connection_key, is_enabled, notes FROM sms.data_source ORDER BY data_source_id`),
    pool.request().input('line', mssql.Int, lineId).query<{
      source_table_id: number; kind: string; source_table: string; raw_table: string; is_enabled: boolean; data_source_id: number;
    }>(`SELECT source_table_id, kind, source_table, raw_table, is_enabled, data_source_id
          FROM sms.source_table WHERE line_id = @line ORDER BY source_table_id`),
  ]);
  return {
    sources: s.recordset.map((x) => ({
      dataSourceId: Number(x.data_source_id),
      systemCode: x.system_code,
      role: x.role,
      label: x.label,
      connectionKey: x.connection_key,
      isEnabled: Boolean(x.is_enabled),
      notes: x.notes,
    })),
    tables: t.recordset.map((x) => ({
      sourceTableId: Number(x.source_table_id),
      kind: x.kind,
      sourceTable: x.source_table,
      rawTable: x.raw_table,
      isEnabled: Boolean(x.is_enabled),
      dataSourceId: Number(x.data_source_id),
    })),
  };
}

// ---------------------------------------------------------------- writes

const q = (v: string | null | undefined) => (v == null ? '(none)' : `"${v}"`);
/** Strings quoted, null as (none), booleans and numbers bare. */
const fmt = (v: unknown) => (v == null || typeof v === 'string' ? q(v as string | null) : String(v));

/** `field "old" -> "new"` for each field that was sent AND differs. */
function changes(pairs: { field: string; before: unknown; after: unknown }[]): string[] {
  return pairs
    .filter((p) => p.after !== undefined && p.after !== p.before)
    .map((p) => `${p.field} ${fmt(p.before)} -> ${fmt(p.after)}`);
}

export interface LinePatch {
  plantName?: string;
  unitName?: string;
  lineName?: string;
  displayName?: string;
}

/**
 * Rename the plant, unit or line. Audit `line.rename` on the line, with every
 * changed name in the detail — one row, because an admin sees this as one
 * form. Returns false when the line has no row.
 */
export async function updateLine(pool: ConnectionPool, actorId: number, lineId: number, p: LinePatch): Promise<boolean> {
  return auditedWrite(pool, actorId, { action: 'line.rename', targetType: 'line', targetId: lineId, detail: null }, async (tx) => {
    const cur = await tx.request().input('line', mssql.Int, lineId).query<LineRaw>(LINE_SELECT);
    const before = cur.recordset[0];
    if (!before) return { result: false, noop: true };

    if (p.plantName !== undefined && p.plantName !== before.plant_name) {
      await tx.request().input('id', mssql.Int, before.plant_id).input('n', mssql.NVarChar(128), p.plantName)
        .query(`UPDATE sms.plant SET name = @n WHERE plant_id = @id`);
    }
    if (p.unitName !== undefined && p.unitName !== before.unit_name) {
      await tx.request().input('id', mssql.Int, before.unit_id).input('n', mssql.NVarChar(128), p.unitName)
        .query(`UPDATE sms.plant_unit SET name = @n WHERE unit_id = @id`);
    }
    if ((p.lineName !== undefined && p.lineName !== before.line_name) || (p.displayName !== undefined && p.displayName !== before.display_name)) {
      await tx.request().input('line', mssql.Int, lineId)
        .input('n', mssql.NVarChar(128), p.lineName ?? before.line_name)
        .input('d', mssql.NVarChar(128), p.displayName ?? before.display_name)
        .query(`UPDATE sms.line SET name = @n, display_name = @d WHERE line_id = @line`);
    }
    const detail = changes([
      { field: 'displayName', before: before.display_name, after: p.displayName },
      { field: 'lineName', before: before.line_name, after: p.lineName },
      { field: 'unitName', before: before.unit_name, after: p.unitName },
      { field: 'plantName', before: before.plant_name, after: p.plantName },
    ]);
    if (detail.length === 0) return { result: true, noop: true };
    return { result: true, detail: detail.join('; ') };
  });
}

export interface NewMachine {
  machineNo: number | null;
  kind: MachineKind;
  name: string;
  make?: string | null;
  model?: string | null;
  notes?: string | null;
}

export type CreateMachineResult =
  | { ok: true; machineId: number; stationCreated: boolean }
  | { ok: false; code: 'DUPLICATE_NO'; message: string };

/**
 * Add a machine. A winder (or 'other') with a machine number is what the
 * acquisition layer writes in MachineNo, so it also needs a station row of
 * that number for its readings to land against — created here when absent
 * and linked with link_source 'admin', which is the roadmap's acceptance
 * test in one call ("adding a second machine does not require source-code
 * modification"). A packer has no number and no station (no sack row carries
 * a machine number). An EXISTING station of that number is left as it is,
 * linked or not: whether it IS this machine is Q3, not something to assume.
 */
export async function createMachine(pool: ConnectionPool, actorId: number, lineId: number, m: NewMachine): Promise<CreateMachineResult> {
  return auditedWrite<CreateMachineResult>(
    pool, actorId, { action: 'machine.create', targetType: 'machine', targetId: null, detail: null },
    async (tx) => {
      if (m.machineNo != null) {
        const dup = await tx.request().input('line', mssql.Int, lineId).input('no', mssql.Int, m.machineNo)
          .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.machine WHERE line_id = @line AND machine_no = @no`);
        if (Number(dup.recordset[0]?.n ?? 0) > 0) {
          return {
            result: { ok: false, code: 'DUPLICATE_NO', message: `machine number ${m.machineNo} already exists on this line` },
            noop: true,
          };
        }
      }
      const ins = await tx.request()
        .input('line', mssql.Int, lineId).input('no', mssql.Int, m.machineNo)
        .input('kind', mssql.VarChar(16), m.kind).input('make', mssql.NVarChar(64), m.make ?? null)
        .input('model', mssql.NVarChar(64), m.model ?? null).input('name', mssql.NVarChar(64), m.name)
        .input('notes', mssql.NVarChar(255), m.notes ?? null)
        .query<{ id: number }>(
          `INSERT INTO sms.machine (line_id, machine_no, kind, make, model, name, notes)
           OUTPUT inserted.machine_id AS id
           VALUES (@line, @no, @kind, @make, @model, @name, @notes)`,
        );
      const machineId = Number(ins.recordset[0]?.id);
      if (!Number.isFinite(machineId)) throw new Error('INSERT sms.machine returned no machine_id');

      let stationCreated = false;
      if (m.machineNo != null && m.kind !== 'packer') {
        const st = await tx.request()
          .input('line', mssql.Int, lineId).input('no', mssql.Int, m.machineNo).input('mid', mssql.Int, machineId)
          .query(
            `INSERT INTO sms.station (station_id, line_id, machine_id, link_source, is_active)
             SELECT @no, @line, @mid, 'admin', 1
              WHERE NOT EXISTS (SELECT 1 FROM sms.station WHERE line_id = @line AND station_id = @no)`,
          );
        stationCreated = (st.rowsAffected[0] ?? 0) > 0;
      }
      const detail =
        `${m.kind} "${m.name}"` +
        (m.machineNo == null ? ' (no machine number)' : ` machine_no ${m.machineNo}`) +
        (m.make ? `, make ${q(m.make)}` : '') +
        (stationCreated ? `; station ${m.machineNo} created and linked` : '');
      return { result: { ok: true, machineId, stationCreated }, targetId: machineId, detail };
    },
  );
}

export interface MachinePatch {
  name?: string;
  make?: string | null;
  model?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

/** Update the fields present; false when the machine is not this line's. */
export async function updateMachine(pool: ConnectionPool, actorId: number, lineId: number, machineId: number, p: MachinePatch): Promise<boolean> {
  return auditedWrite(pool, actorId, { action: 'machine.update', targetType: 'machine', targetId: machineId, detail: null }, async (tx) => {
    const cur = await tx.request().input('line', mssql.Int, lineId).input('id', mssql.Int, machineId).query<MachineRaw>(
      `SELECT machine_id, machine_no, kind, make, model, name, is_active, notes FROM sms.machine WHERE line_id = @line AND machine_id = @id`,
    );
    const before = cur.recordset[0];
    if (!before) return { result: false, noop: true };
    const beforeActive = Boolean(before.is_active);
    const detail = changes([
      { field: 'name', before: before.name, after: p.name },
      { field: 'make', before: before.make, after: p.make },
      { field: 'model', before: before.model, after: p.model },
      { field: 'notes', before: before.notes, after: p.notes },
      { field: 'isActive', before: beforeActive, after: p.isActive },
    ]);
    if (detail.length === 0) return { result: true, noop: true };
    await tx.request()
      .input('line', mssql.Int, lineId).input('id', mssql.Int, machineId)
      .input('name', mssql.NVarChar(64), p.name ?? before.name)
      .input('make', mssql.NVarChar(64), p.make === undefined ? before.make : p.make)
      .input('model', mssql.NVarChar(64), p.model === undefined ? before.model : p.model)
      .input('notes', mssql.NVarChar(255), p.notes === undefined ? before.notes : p.notes)
      .input('active', mssql.Bit, p.isActive ?? beforeActive)
      .query(`UPDATE sms.machine SET name = @name, make = @make, model = @model, notes = @notes, is_active = @active
               WHERE line_id = @line AND machine_id = @id`);
    return { result: true, detail: detail.join('; ') };
  });
}

export type CreateStationResult =
  | { ok: true }
  | { ok: false; code: 'EXISTS' | 'UNKNOWN_MACHINE'; message: string };

/**
 * Add a station by number. The number is the station's identity — it is what
 * MachineNo on a cone row is matched against — so it is chosen, not
 * assigned. A machine link is optional and must be a machine on this line.
 */
export async function createStation(
  pool: ConnectionPool, actorId: number, lineId: number, s: { stationId: number; name: string | null; machineId: number | null },
): Promise<CreateStationResult> {
  return auditedWrite<CreateStationResult>(
    pool, actorId, { action: 'station.create', targetType: 'station', targetId: s.stationId, detail: null },
    async (tx) => {
      if (s.machineId != null) {
        const m = await tx.request().input('line', mssql.Int, lineId).input('id', mssql.Int, s.machineId)
          .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.machine WHERE line_id = @line AND machine_id = @id`);
        if (Number(m.recordset[0]?.n ?? 0) === 0) {
          return { result: { ok: false, code: 'UNKNOWN_MACHINE', message: `no machine ${s.machineId} on this line` }, noop: true };
        }
      }
      const ins = await tx.request()
        .input('line', mssql.Int, lineId).input('id', mssql.Int, s.stationId)
        .input('name', mssql.NVarChar(64), s.name).input('mid', mssql.Int, s.machineId)
        .input('link', mssql.VarChar(20), s.machineId == null ? null : 'admin')
        .query(
          `INSERT INTO sms.station (station_id, line_id, name, machine_id, link_source, is_active)
           SELECT @id, @line, @name, @mid, @link, 1
            WHERE NOT EXISTS (SELECT 1 FROM sms.station WHERE line_id = @line AND station_id = @id)`,
        );
      if ((ins.rowsAffected[0] ?? 0) === 0) {
        return { result: { ok: false, code: 'EXISTS', message: `station ${s.stationId} already exists on this line` }, noop: true };
      }
      const detail = `name ${q(s.name)}` + (s.machineId == null ? '' : `; linked to machine ${s.machineId}`);
      return { result: { ok: true }, detail };
    },
  );
}

export interface DataSourcePatch {
  label?: string;
  isEnabled?: boolean;
  notes?: string | null;
}

/** Update a data source's label / enabled flag / notes. False when absent.
 *  Connection details are not here on purpose: they stay in .env (028). */
export async function updateDataSource(pool: ConnectionPool, actorId: number, dataSourceId: number, p: DataSourcePatch): Promise<boolean> {
  return auditedWrite(pool, actorId, { action: 'data_source.update', targetType: 'data_source', targetId: dataSourceId, detail: null }, async (tx) => {
    const cur = await tx.request().input('id', mssql.Int, dataSourceId).query<{ label: string; is_enabled: boolean; notes: string | null }>(
      `SELECT label, is_enabled, notes FROM sms.data_source WHERE data_source_id = @id`,
    );
    const before = cur.recordset[0];
    if (!before) return { result: false, noop: true };
    const beforeEnabled = Boolean(before.is_enabled);
    const detail = changes([
      { field: 'label', before: before.label, after: p.label },
      { field: 'isEnabled', before: beforeEnabled, after: p.isEnabled },
      { field: 'notes', before: before.notes, after: p.notes },
    ]);
    if (detail.length === 0) return { result: true, noop: true };
    await tx.request()
      .input('id', mssql.Int, dataSourceId)
      .input('label', mssql.NVarChar(128), p.label ?? before.label)
      .input('enabled', mssql.Bit, p.isEnabled ?? beforeEnabled)
      .input('notes', mssql.NVarChar(255), p.notes === undefined ? before.notes : p.notes)
      .query(`UPDATE sms.data_source SET label = @label, is_enabled = @enabled, notes = @notes WHERE data_source_id = @id`);
    return { result: true, detail: detail.join('; ') };
  });
}

export interface SourceTablePatch {
  sourceTable?: string;
  isEnabled?: boolean;
}

/**
 * Point a raw table at a different source table, or switch it off. The
 * worker reads this on its next pass; a different table name is a different
 * source GENERATION (SEPT-2026-EPOCH-DECISION) and the worker halts on it
 * until `sms epoch:accept` registers it — the route's note says so.
 * False when the row is not this line's.
 */
export async function updateSourceTable(
  pool: ConnectionPool, actorId: number, lineId: number, sourceTableId: number, p: SourceTablePatch,
): Promise<boolean> {
  if (p.sourceTable !== undefined && !SOURCE_TABLE_NAME.test(p.sourceTable)) {
    throw new Error(`refusing an unsafe source table name: ${JSON.stringify(p.sourceTable)}`);
  }
  return auditedWrite(pool, actorId, { action: 'source_table.update', targetType: 'source_table', targetId: sourceTableId, detail: null }, async (tx) => {
    const cur = await tx.request().input('line', mssql.Int, lineId).input('id', mssql.Int, sourceTableId)
      .query<{ kind: string; source_table: string; is_enabled: boolean }>(
        `SELECT kind, source_table, is_enabled FROM sms.source_table WHERE line_id = @line AND source_table_id = @id`,
      );
    const before = cur.recordset[0];
    if (!before) return { result: false, noop: true };
    const beforeEnabled = Boolean(before.is_enabled);
    const detail = changes([
      { field: 'sourceTable', before: before.source_table, after: p.sourceTable },
      { field: 'isEnabled', before: beforeEnabled, after: p.isEnabled },
    ]);
    if (detail.length === 0) return { result: true, noop: true };
    await tx.request()
      .input('line', mssql.Int, lineId).input('id', mssql.Int, sourceTableId)
      .input('t', mssql.NVarChar(128), p.sourceTable ?? before.source_table)
      .input('enabled', mssql.Bit, p.isEnabled ?? beforeEnabled)
      .query(`UPDATE sms.source_table SET source_table = @t, is_enabled = @enabled WHERE line_id = @line AND source_table_id = @id`);
    return { result: true, detail: `${before.kind}: ${detail.join('; ')}` };
  });
}
