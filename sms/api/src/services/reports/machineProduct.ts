/**
 * Product by machine and shift — the tenth report type, roadmap Phase 8
 * extended on IFL's answers of 15 Sep 2026 (Wave F, item F2.2).
 *
 * IFL's Q28 answer turned "sack stock per machine" into "production per
 * machine by shift and day, with all relevant information", and Hassan's
 * example was "which product ran on which machine in which shift". This
 * report is that page: a MATRIX with one row per machine and one column per
 * production day × shift, each cell the product name(s) and the cone count;
 * the list of changeovers the readings show; and the per-product totals.
 * Composed from machineProducts.ts — the same derivation the Line screen's
 * "What each machine is running" block reads for today — so a cell here is
 * the cell the front screen showed on the day.
 *
 * WHAT A CELL IS NOT. Sacks carry no machine (sack1_TP1U2 has no station
 * column at any layer), so this is cones per machine, never sacks; the sack
 * report and Phase 7's Sacks screen carry sacks per shift/day/product with
 * the same caveat. A cell with two materials shows both, in the order they
 * ran, because the operator changed the selection on that panel during the
 * shift and hiding one would misreport the shift.
 *
 * Product labels: six PDAS materials share one description on this line, so
 * a name that belongs to more than one material in the period gets its id
 * appended ("205-IL0-SD #24"); a name that is unique stays plain. The label
 * rule is applied once here so the screen, the CSV and the workbook agree.
 */
import type { ConnectionPool } from 'mssql';
import type { GenerationNote } from '../generation.js';
import type { ShiftCode } from '@sms/shared';
import { SHIFT_CODES } from '@sms/shared';
import { cellOrder, getMachineProductShifts, type MachineProductChange, type MachineShiftCell } from '../machineProducts.js';
import type { ResolvedPeriod } from '../report.js';
import type { ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';

export interface MachineProductColumn {
  day: string;
  shift: ShiftCode;
  /** Cones across every machine in this day × shift. */
  cones: number;
}

export interface MachineProductRow {
  station: number;
  stationName: string | null;
  machineName: string | null;
  /** Indexed like `columns`; null where the machine weighed nothing. */
  cells: (MachineShiftCell | null)[];
  cones: number;
  /** Distinct materials this machine ran in the period. */
  materials: number;
}

export interface MachineProductTotal {
  materialId: number | null;
  label: string;
  cones: number;
  /** Machines that ran it at least once in the period. */
  machines: number;
  /** (machine, day, shift) cells it appears in. */
  cells: number;
  firstUtc: string;
  lastUtc: string;
}

export interface MachineProductReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  columns: MachineProductColumn[];
  rows: MachineProductRow[];
  changes: MachineProductChange[];
  products: MachineProductTotal[];
  /** materialId → the label the report prints (unique names plain, shared names with the id). */
  labels: Record<string, string>;
  conesWithoutStation: number;
  /**
   * Machines that weighed at least one cone in the period (verification
   * 25 Sep 2026, X1). `rows` also carries roster machines that weighed
   * nothing — a row of dashes — so `rows.length` is not "machines that ran".
   */
  machinesWeighing: number;
  note: string;
  generationNote?: GenerationNote;
}

/** Every production day in [from, to], in order. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T12:00:00Z`).getTime();
  for (let t = new Date(`${from}T12:00:00Z`).getTime(); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const NO_PRODUCT_LABEL = 'No product on the reading';

/**
 * The label per material: the product name, with " #id" appended only when
 * the same name belongs to more than one material in this data.
 */
export function labelMaterials(cells: readonly MachineShiftCell[]): Record<string, string> {
  const nameOf = new Map<string, string | null>();
  for (const c of cells) for (const m of c.materials) nameOf.set(String(m.materialId ?? 'none'), m.productName);
  const owners = new Map<string, number>();
  for (const name of nameOf.values()) if (name != null) owners.set(name, (owners.get(name) ?? 0) + 1);
  const labels: Record<string, string> = {};
  for (const [id, name] of nameOf) {
    if (id === 'none') labels[id] = NO_PRODUCT_LABEL;
    else if (name == null) labels[id] = `Product ${id}`;
    else labels[id] = (owners.get(name) ?? 0) > 1 ? `${name} #${id}` : name;
  }
  return labels;
}

export async function getMachineProductReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  /** Chart overhaul wave 2 (Task TB2, 28 Sep 2026). */
  shiftRange?: ShiftRange,
): Promise<MachineProductReportData> {
  const data = await getMachineProductShifts(pool, lineId, {
    from: resolved.from, to: resolved.to, shift: filters.shift ?? null, station: filters.station ?? null, shiftRange,
  });

  const shifts: ShiftCode[] = filters.shift ? [filters.shift] : [...SHIFT_CODES];
  const columns: MachineProductColumn[] = [];
  for (const day of daysBetween(resolved.from, resolved.to)) for (const shift of shifts) columns.push({ day, shift, cones: 0 });
  const colIndex = new Map(columns.map((c, i) => [`${c.day}|${c.shift}`, i]));

  // Rows: the roster first (a quiet machine is a row of dashes, not a
  // missing row), then any station the readings name that Setup does not.
  const rowOf = new Map<number, MachineProductRow>();
  const row = (station: number, stationName: string | null, machineName: string | null): MachineProductRow => {
    let r = rowOf.get(station);
    if (!r) {
      r = { station, stationName, machineName, cells: columns.map(() => null), cones: 0, materials: 0 };
      rowOf.set(station, r);
    }
    return r;
  };
  for (const s of data.stations) row(s.station, s.stationName, s.machineName);
  const materialsOfRow = new Map<number, Set<string>>();
  for (const cell of data.cells) {
    const r = row(cell.station, cell.stationName, cell.machineName);
    const i = colIndex.get(`${cell.day}|${cell.shift}`);
    if (i == null) continue; // a shift outside the filter cannot occur; defensive
    r.cells[i] = cell;
    r.cones += cell.cones;
    columns[i]!.cones += cell.cones;
    const set = materialsOfRow.get(cell.station) ?? new Set<string>();
    // An unattributed reading (no material_id) is the absence of a product,
    // not a product in its own right — do not count it toward `materials`.
    for (const m of cell.materials) if (m.materialId != null) set.add(String(m.materialId));
    materialsOfRow.set(cell.station, set);
  }
  const rows = [...rowOf.values()].sort((a, b) => a.station - b.station);
  for (const r of rows) r.materials = materialsOfRow.get(r.station)?.size ?? 0;

  const labels = labelMaterials(data.cells);

  // Per-product totals.
  const totals = new Map<string, MachineProductTotal & { stations: Set<number> }>();
  for (const cell of [...data.cells].sort(cellOrder)) {
    for (const m of cell.materials) {
      const key = String(m.materialId ?? 'none');
      let t = totals.get(key);
      if (!t) {
        t = { materialId: m.materialId, label: labels[key] ?? NO_PRODUCT_LABEL, cones: 0, machines: 0, cells: 0, firstUtc: m.firstUtc, lastUtc: m.lastUtc, stations: new Set() };
        totals.set(key, t);
      }
      t.cones += m.cones;
      t.cells += 1;
      t.stations.add(cell.station);
      if (m.firstUtc < t.firstUtc) t.firstUtc = m.firstUtc;
      if (m.lastUtc > t.lastUtc) t.lastUtc = m.lastUtc;
    }
  }
  const products: MachineProductTotal[] = [...totals.values()]
    .map(({ stations, ...t }) => ({ ...t, machines: stations.size }))
    .sort((a, b) => b.cones - a.cones);

  return {
    period: resolved,
    filters,
    columns,
    rows,
    changes: data.changes,
    products,
    labels,
    conesWithoutStation: data.conesWithoutStation,
    machinesWeighing: rows.filter((r) => r.cones > 0).length,
    generationNote: data.generationNote,
    note:
      'Each cell is the product recorded on the cones that machine weighed in that shift, as the operator selected it on the machine’s panel; ' +
      'every cone counts, and a cell with two products shows both in the order they ran. Sacks carry no machine and are not on this page.',
  };
}

/* ------------------------------------------------------------------- CSV */

export const MACHINE_PRODUCT_CSV_HEADERS = [
  'section', 'station', 'machine', 'day', 'shift', 'material_id', 'product', 'cones', 'first_utc', 'last_utc',
  'changed_during_shift', 'from_material_id', 'from_product', 'to_material_id', 'to_product', 'change_kind', 'machines', 'cells',
] as const;

export function machineProductCsv(d: MachineProductReportData): CsvTable {
  const labelOf = (id: number | null) => d.labels[String(id ?? 'none')] ?? (id == null ? NO_PRODUCT_LABEL : `Product ${id}`);
  const rows: CsvRow[] = [];
  for (const r of d.rows) {
    for (const cell of r.cells) {
      if (!cell) continue;
      for (const m of cell.materials) {
        rows.push([
          'cell', r.station, r.machineName, cell.day, cell.shift, m.materialId, labelOf(m.materialId), m.cones, m.firstUtc, m.lastUtc,
          cell.changedDuringShift, null, null, null, null, null, null, null,
        ]);
      }
    }
  }
  for (const c of d.changes) {
    rows.push([
      'change', c.station, c.machineName, c.day, c.shift, null, null, null, c.firstUtc, null,
      null, c.fromMaterialId, labelOf(c.fromMaterialId), c.toMaterialId, labelOf(c.toMaterialId), c.kind, null, null,
    ]);
  }
  for (const p of d.products) {
    rows.push([
      'product', null, null, null, null, p.materialId, p.label, p.cones, p.firstUtc, p.lastUtc,
      null, null, null, null, null, null, p.machines, p.cells,
    ]);
  }
  return { headers: MACHINE_PRODUCT_CSV_HEADERS, rows };
}
