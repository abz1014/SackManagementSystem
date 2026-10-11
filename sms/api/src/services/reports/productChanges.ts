/**
 * Product changes in the reports — F-2 (Stage 3, 11 Oct 2026; owner, 7 Oct 2026).
 *
 * "Show product changes in reports." The derivation is `machineProducts.ts` (`getMachineProductShifts`): per winder, a
 * change is the first cone of one product after the cones of another, within a shift, between shifts, and (new) at the
 * start of the period against the cone just before it. This module derives NOTHING: it reads that one derivation for
 * the report's own period/shift/winder, and turns its answer into plain sentences for the notes every export carries.
 *
 * WHAT A CHANGE IS NOT. PDAS is a catalogue; the operator picks the product on the winder's panel and the panel stamps
 * every cone with it. So SMS only ever sees the cones, and every time here is "the first cone of the new product on that
 * winder", never when the selection was made (`PRODUCT_CHANGE_TIME_NOTE`). July cones carry no product and give none.
 *
 * Nothing is written to any database; this is read at report time.
 */
import type { ConnectionPool } from 'mssql';
import { getMachineProductShifts, type MachineProductChange } from '../machineProducts.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import type { ReportFilters } from './common.js';
import { labelMaterials, NO_PRODUCT_LABEL } from './machineProduct.js';
import { plantWallClock } from './plantTime.js';

export const PRODUCT_CHANGE_TIME_NOTE =
  'Each change is timed at the first cone of the new product on that winder, not at the moment the panel selection was made.';
export const NO_PRODUCT_CHANGE_NOTE = 'No product change was read on any winder in this period.';
export const PRODUCT_CHANGES_UNREAD_NOTE = 'Product changes could not be read for this period.';

/** The two fields a report carries so its notes and its screen can state the changes. `productChanges` null = could not be read. */
export interface ReportProductChanges {
  productChanges: MachineProductChange[] | null;
  /** material_id (as text) -> the label the report prints; "#id" is appended only where one name belongs to several products. */
  productChangeLabels: Record<string, string>;
}

/**
 * The changes for one report's own window. A failure to read them never sinks the report: it is carried as `null` so the
 * notes and the screen say "could not be read" instead of "none".
 */
export async function readProductChanges(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<ReportProductChanges> {
  try {
    const data = await getMachineProductShifts(pool, lineId, {
      from: resolved.from, to: resolved.to, shift: filters.shift ?? null, station: filters.station ?? null, shiftRange,
    });
    const extra = data.changes.flatMap((c) => [
      { materialId: c.fromMaterialId, productName: c.fromProductName },
      { materialId: c.toMaterialId, productName: c.toProductName },
    ]);
    return { productChanges: data.changes, productChangeLabels: labelMaterials(data.cells, extra) };
  } catch {
    return { productChanges: null, productChangeLabels: {} };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20:03, 11 Aug 2026" from a production-time instant (the plant's wall clock, labelled Z); '' when it cannot be read. */
function plantTimeWords(iso: string): string {
  const w = plantWallClock(iso); // YYYY-MM-DD HH:mm:ss
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(w);
  if (!m) return '';
  return `${m[4]}:${m[5]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * One sentence per change, in time order: "Winder 4: 205-IL0-SD #21 to 205-IL0-SD #1021, first cone of the new product
 * 20:03, 11 Aug 2026." Words only; nothing is derived here.
 */
export function productChangeLines(
  changes: readonly MachineProductChange[],
  labelOf: (materialId: number | null) => string,
): string[] {
  return [...changes]
    .sort((a, b) => (a.firstUtc < b.firstUtc ? -1 : a.firstUtc > b.firstUtc ? 1 : a.station - b.station))
    .map((c) => {
      const when = plantTimeWords(c.firstUtc);
      return `Winder ${c.station}: ${labelOf(c.fromMaterialId)} to ${labelOf(c.toMaterialId)}, first cone of the new product${when ? ` ${when}` : ''}.`;
    });
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * The note sentences for the report types that state product changes in their notes (product, daily, shift,
 * shift-production), read from the report DATA: the time note, then one sentence per change, or "none", or "could not be
 * read". A payload with no `productChanges` field at all (an older server, a fixture) states nothing.
 */
export function productChangeNotes(d: unknown): string[] {
  if (!isRec(d) || !('productChanges' in d)) return [];
  if (d.productChanges === null) return [PRODUCT_CHANGES_UNREAD_NOTE];
  if (!Array.isArray(d.productChanges)) return [];
  const labels = isRec(d.productChangeLabels) ? d.productChangeLabels : {};
  const labelOf = (id: number | null): string => {
    const l = labels[String(id ?? 'none')];
    return typeof l === 'string' && l !== '' ? l : id == null ? NO_PRODUCT_LABEL : `Product ${id}`;
  };
  const lines = productChangeLines(d.productChanges as MachineProductChange[], labelOf);
  return lines.length === 0 ? [NO_PRODUCT_CHANGE_NOTE] : [PRODUCT_CHANGE_TIME_NOTE, ...lines];
}
