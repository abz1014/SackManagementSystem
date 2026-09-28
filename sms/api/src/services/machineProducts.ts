/**
 * Which product ran on which machine in which shift — roadmap Phase 8
 * extended on IFL's answers of 15 Sep 2026 (Wave F, item F2.1).
 *
 * IFL's procedure (contract header, Q19/Q28/Q33): the engineer creates the
 * material in PDAS, the OPERATOR selects it on each machine's QCS panel at
 * the shift change, and the panel stamps every cone with the selected
 * material's id. SMS never selects anything on a machine and never talks to
 * the PLC; "which product ran on which machine in which shift" is therefore
 * DERIVED from the readings, and this service is that derivation.
 *
 * Per active station, per production day × shift in the period: the
 * material(s) whose cones the station weighed, with the count and the first
 * and last reading time on each. EVERY cone counts here — the plausibility
 * rule that governs the weight figures is deliberately not applied, because
 * a 1,400 g reading still says which material the panel had selected.
 *
 * Machine = station, 1–14: IFL confirmed the default link on 15 Sep 2026
 * (Q1/Q3), so the roster is sms.station joined to its machine, as
 * machinesRunning.ts reads it.
 *
 * CHANGES. A `changes` list names every changeover the readings show, so a
 * manager can read "machine 7 went from A to B in Tuesday's evening shift
 * at 15:42" without scanning the matrix:
 *  - WITHIN a shift: a cell whose cones carry more than one material lists
 *    them in order of first reading; each step from one to the next is a
 *    change, timed at the first reading of the new material.
 *  - BETWEEN shifts: the material running at the END of a station's previous
 *    cell (its newest reading) against the material running at the START of
 *    the next cell (its oldest reading). Consecutive cells, not consecutive
 *    shifts — a shift with no cones at that station is skipped, so a machine
 *    that was quiet for the evening still reports morning → night.
 * The two rules together report each changeover once. Comparing DOMINANT
 * materials shift-to-shift (the first draft) reported a mid-shift changeover
 * twice: once inside the cell and again when the next shift's dominant
 * material differed from the previous shift's. `dominantMaterialId` is still
 * on every cell for a screen that wants one name per cell.
 *
 * `tsTo` caps the production INSTANT for a replay (`?at=`), as production.ts
 * does; without it the newest reading is the natural bound.
 *
 * ONE SOURCE GENERATION (23 Sep 2026, generation.ts). This derivation is the
 * one in the application where pooling generations does not merely blur a
 * figure — it INVENTS AN EVENT. A cell is keyed (station, day, shift) with no
 * epoch in the key, so two generations covering the same production day put
 * BOTH their materials in the same cell; `changedDuringShift` goes true and
 * `foldCells` emits a `within_shift` change from one generation's material to
 * the other's, timed at a real reading time. The `between_shifts` rule chains
 * the same way across consecutive cells drawn from different generations.
 * Nothing on the machine changed; the readings were simply filed twice.
 *
 * MEASURED on the dev sidecar, 23 Sep 2026, over 2026-08-21 – 2026-09-07,
 * read-only:
 *
 *   pooled   380 of 756 (station, day, shift) cells carry more than one
 *            material — i.e. 380 cells report a mid-shift changeover
 *   epoch 9    2 of 390 cells do (IFL's own September generation, alone)
 *
 * 378 of the 380 changeovers a manager would have read off this grid did not
 * happen. Both generations run the same six material ids in that window, so
 * every fabricated change also names two plausible products. That is the
 * defect; it is not a display problem, and no amount of labelling fixes it,
 * because the fabricated row is not a reading — it is a conclusion.
 *
 * So this service FILTERS rather than labels: one generation, the newest real
 * one in the window, with `generationNote` stating what was excluded.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_CODES, type ShiftCode } from '@sms/shared';
import { resolveGenerationScope, andEpoch, noteOf, type GenerationNote } from './generation.js';
import { shiftRangeClause, type ShiftRange } from '../shiftRange.js';

export interface ShiftMaterial {
  /** material_id from the reading; null when the reading predates product recording (before 2026-08-05). */
  materialId: number | null;
  /** sms.product description or lot code; "Product N" when the mirror has no row; null without a material. */
  productName: string | null;
  cones: number;
  /** Plant clock labelled UTC, like every production time. */
  firstUtc: string;
  lastUtc: string;
}

export interface MachineShiftCell {
  station: number;
  stationName: string | null;
  machineName: string | null;
  /** Production day (shift_date). */
  day: string;
  shift: ShiftCode;
  /** In order of first reading, so materials[0] started the shift and materials[at(-1)] ended it. */
  materials: ShiftMaterial[];
  /** The material with the most cones in the cell (ties → the one running later). */
  dominantMaterialId: number | null;
  cones: number;
  changedDuringShift: boolean;
}

export interface MachineProductChange {
  station: number;
  machineName: string | null;
  /** The day and shift the NEW material was first read in. */
  day: string;
  shift: ShiftCode;
  fromMaterialId: number | null;
  fromProductName: string | null;
  toMaterialId: number | null;
  toProductName: string | null;
  /** First reading of the new material at this station. */
  firstUtc: string;
  kind: 'within_shift' | 'between_shifts';
}

export interface MachineProductShiftsData {
  from: string;
  to: string;
  shift: ShiftCode | null;
  /** Every active station, whether or not it produced anything in the period. */
  stations: { station: number; stationName: string | null; machineName: string | null }[];
  /** One per (station, day, shift) with at least one cone; ordered station, day, shift. */
  cells: MachineShiftCell[];
  changes: MachineProductChange[];
  /** Readings in the period carrying no station at all — they belong to no machine and are in no cell. */
  conesWithoutStation: number;
  /**
   * Which source generation the grid was derived from, and what was left out
   * (generation.ts). Optional per that module's contract: a missing value
   * means "not stated", never "nothing was excluded".
   */
  generationNote?: GenerationNote;
}

export interface MachineProductShiftsParams {
  from: string;
  to: string;
  shift?: ShiftCode | null;
  station?: number | null;
  /** ISO instant; caps production_ts_utc_ms for a replay. */
  tsTo?: string | null;
  /**
   * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): a shift-bounded period,
   * ANDed via `shiftRangeClause` alongside `from`/`to`/`shift` above, into
   * both the cell query and the no-station count so the two stay scoped to
   * the same window.
   */
  shiftRange?: ShiftRange | null;
}

const SHIFT_ORDER: Record<ShiftCode, number> = { morning: 0, evening: 1, night: 2 };

/** Chronological order of cells: day, then the shift order the production day runs in. */
export function cellOrder(a: { day: string; shift: ShiftCode }, b: { day: string; shift: ShiftCode }): number {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift];
}

interface RawRow {
  st: number;
  day: string;
  shift_code: string;
  material_id: number | null;
  product_name: string | null;
  cones: number;
  first_ms: string | number;
  last_ms: string | number;
}

export async function getMachineProductShifts(
  pool: ConnectionPool,
  lineId: number,
  p: MachineProductShiftsParams,
): Promise<MachineProductShiftsData> {
  // 1. The roster: every active station with its name and its machine's —
  //    the same read as machinesRunning.ts, so the two blocks on Line agree
  //    about which machines exist.
  const roster = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ station_id: number; name: string | null; machine_name: string | null; is_active: boolean | null }>(
      `SELECT s.station_id, s.name, m.name AS machine_name, s.is_active
         FROM sms.station s
         LEFT JOIN sms.machine m ON m.machine_id = s.machine_id
        WHERE s.line_id = @line
        ORDER BY s.station_id`,
    );
  const stations = roster.recordset
    .filter((r) => r.is_active == null || Boolean(r.is_active))
    .filter((r) => p.station == null || Number(r.station_id) === p.station)
    .map((r) => ({ station: Number(r.station_id), stationName: r.name, machineName: r.machine_name }));
  const byStation = new Map(stations.map((s) => [s.station, s]));

  // 1b. The one generation this grid is derived from. Resolved on line and
  //     date range only (never on the station/shift filter), so changing a
  //     filter cannot move the grid to a different generation under the
  //     reader — generation.ts's own rule.
  const scope = await resolveGenerationScope(pool, lineId, { from: p.from, to: p.to }, ['cone_event']);

  // 2. Every (station, day, shift, material) with its count and its span.
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, p.from)
    .input('to', mssql.Date, p.to);
  const where = ['c.line_id = @line', 'c.shift_date BETWEEN @from AND @to'];
  if (p.shift) {
    where.push('c.shift_code = @shift');
    req.input('shift', mssql.VarChar(10), p.shift);
  }
  if (p.station != null) {
    where.push('c.source_station = @station');
    req.input('station', mssql.Int, p.station);
  }
  if (p.tsTo) {
    where.push('c.production_ts_utc_ms <= @tsTo');
    req.input('tsTo', mssql.BigInt, new Date(p.tsTo).getTime());
  }
  if (p.shiftRange) {
    where.push(shiftRangeClause(p.shiftRange, { date: 'c.shift_date', code: 'c.shift_code' }, req));
  }
  const r = await req.query<RawRow>(
    `SELECT c.source_station AS st, CONVERT(varchar(10), c.shift_date, 120) AS day, c.shift_code,
            c.material_id, COALESCE(p.description, p.lot_code) AS product_name,
            COUNT(*) AS cones, MIN(c.production_ts_utc_ms) AS first_ms, MAX(c.production_ts_utc_ms) AS last_ms
       FROM sms.cone_event c
       LEFT JOIN sms.product p ON p.product_id = c.material_id
      WHERE ${andEpoch(where.join(' AND '), req, scope, 'cone_event', { alias: 'c.' })} AND c.source_station IS NOT NULL
      GROUP BY c.source_station, c.shift_date, c.shift_code, c.material_id, COALESCE(p.description, p.lot_code)
      ORDER BY c.source_station, c.shift_date, c.shift_code, MIN(c.production_ts_utc_ms)`,
  );

  // 3. Readings with no station: counted so the report can say they exist,
  //    never assigned to a machine.
  const noSt = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, p.from).input('to', mssql.Date, p.to);
  const noStWhere = ['line_id = @line', 'shift_date BETWEEN @from AND @to', 'source_station IS NULL'];
  if (p.shift) {
    noStWhere.push('shift_code = @shift');
    noSt.input('shift', mssql.VarChar(10), p.shift);
  }
  if (p.tsTo) {
    noStWhere.push('production_ts_utc_ms <= @tsTo');
    noSt.input('tsTo', mssql.BigInt, new Date(p.tsTo).getTime());
  }
  if (p.shiftRange) {
    noStWhere.push(shiftRangeClause(p.shiftRange, { date: 'shift_date', code: 'shift_code' }, noSt));
  }
  // Scoped to the SAME generation as the grid: this count is read as "and
  // these readings are in no cell", which is only true of the generation the
  // cells came from.
  const noStation = p.station != null
    ? { recordset: [{ n: 0 }] }
    : await noSt.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sms.cone_event WHERE ${andEpoch(noStWhere.join(' AND '), noSt, scope, 'cone_event')}`,
      );

  return {
    from: p.from,
    to: p.to,
    shift: p.shift ?? null,
    stations,
    ...foldCells(r.recordset, byStation),
    conesWithoutStation: Number(noStation.recordset[0]?.n ?? 0),
    generationNote: noteOf(scope),
  };
}

/**
 * Pure: the grouped rows into cells and the change list. Exported so the
 * aggregation is testable on a fake row set without SQL.
 */
export function foldCells(
  rows: readonly RawRow[],
  roster: Map<number, { station: number; stationName: string | null; machineName: string | null }>,
): { cells: MachineShiftCell[]; changes: MachineProductChange[] } {
  const cellOf = new Map<string, MachineShiftCell>();
  for (const row of rows) {
    if (!(SHIFT_CODES as readonly string[]).includes(row.shift_code)) continue;
    const st = Number(row.st);
    const shift = row.shift_code as ShiftCode;
    const key = `${st}|${row.day}|${shift}`;
    let cell = cellOf.get(key);
    if (!cell) {
      const s = roster.get(st);
      cell = {
        station: st,
        stationName: s?.stationName ?? null,
        machineName: s?.machineName ?? null,
        day: row.day,
        shift,
        materials: [],
        dominantMaterialId: null,
        cones: 0,
        changedDuringShift: false,
      };
      cellOf.set(key, cell);
    }
    const materialId = row.material_id == null ? null : Number(row.material_id);
    cell.materials.push({
      materialId,
      productName: row.product_name ?? (materialId != null ? `Product ${materialId}` : null),
      cones: Number(row.cones),
      firstUtc: new Date(Number(row.first_ms)).toISOString(),
      lastUtc: new Date(Number(row.last_ms)).toISOString(),
    });
  }

  const cells = [...cellOf.values()];
  for (const cell of cells) {
    cell.materials.sort((a, b) => (a.firstUtc < b.firstUtc ? -1 : a.firstUtc > b.firstUtc ? 1 : 0));
    cell.cones = cell.materials.reduce((n, m) => n + m.cones, 0);
    cell.changedDuringShift = cell.materials.length > 1;
    // Most cones wins; a tie goes to the material running later, which is
    // the one the panel had selected at the end of the shift.
    let dominant: ShiftMaterial | null = null;
    for (const m of cell.materials) if (!dominant || m.cones >= dominant.cones) dominant = m;
    cell.dominantMaterialId = dominant?.materialId ?? null;
  }
  cells.sort((a, b) => a.station - b.station || cellOrder(a, b));

  const changes: MachineProductChange[] = [];
  let prev: MachineShiftCell | null = null;
  for (const cell of cells) {
    const sameStation = prev != null && prev.station === cell.station;
    // Between shifts: the material that ended the previous cell against the
    // one that started this cell.
    if (sameStation && prev) {
      const ended = prev.materials.reduce((a, b) => (b.lastUtc > a.lastUtc ? b : a));
      const started = cell.materials[0]!;
      if (ended.materialId !== started.materialId) {
        changes.push({
          station: cell.station, machineName: cell.machineName, day: cell.day, shift: cell.shift,
          fromMaterialId: ended.materialId, fromProductName: ended.productName,
          toMaterialId: started.materialId, toProductName: started.productName,
          firstUtc: started.firstUtc, kind: 'between_shifts',
        });
      }
    }
    // Within the shift: each step along the materials list.
    for (let i = 1; i < cell.materials.length; i++) {
      const a = cell.materials[i - 1]!;
      const b = cell.materials[i]!;
      changes.push({
        station: cell.station, machineName: cell.machineName, day: cell.day, shift: cell.shift,
        fromMaterialId: a.materialId, fromProductName: a.productName,
        toMaterialId: b.materialId, toProductName: b.productName,
        firstUtc: b.firstUtc, kind: 'within_shift',
      });
    }
    prev = cell;
  }
  changes.sort((a, b) => (a.firstUtc < b.firstUtc ? -1 : a.firstUtc > b.firstUtc ? 1 : a.station - b.station));

  return { cells, changes };
}
