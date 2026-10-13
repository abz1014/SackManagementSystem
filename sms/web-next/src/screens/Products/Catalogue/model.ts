/**
 * Products > Catalogue: the pure part. One row per product PDAS holds, with the stations running it now.
 * "Active" means PDAS says so; only an explicit "not active" is retired, and a product PDAS gave no flag
 * for is "not stated" and listed under All only (RT-018: never guess a status).
 */
import type { MachineRunning, ProductOption } from '../../../bridge/api';
import { niceColour } from '../Board/model';

export type CatalogueFilter = 'active' | 'retired' | 'all';
export type ProductStatus = 'active' | 'retired' | 'unstated';

export interface CatalogueRow {
  id: number;
  /** PDAS description, e.g. 205-IL0-SD. */
  code: string;
  /** The distinct label (code + what differs), used in sentences. */
  label: string;
  colour: string | null;
  count: string | null;
  tube: string | null;
  setpointG: number | null;
  minusG: number | null;
  plusG: number | null;
  status: ProductStatus;
  /** Stations whose latest cone carries this product; null when the station answer is not available. */
  stations: number[] | null;
}

export function buildRows(
  products: readonly ProductOption[],
  labels: Map<number, string>,
  machines: readonly MachineRunning[] | null,
): CatalogueRow[] {
  return products.map((p) => ({
    id: p.productId,
    code: p.description || p.lotCode || `Product ${p.productId}`,
    label: labels.get(p.productId) ?? (p.description || p.lotCode || `Product ${p.productId}`),
    colour: niceColour(p.color),
    count: p.countText?.trim() || null,
    tube: p.tubeType?.trim() || null,
    setpointG: p.setpointG,
    minusG: p.weightOffsetMinusG == null ? null : Math.abs(p.weightOffsetMinusG),
    plusG: p.weightOffsetPlusG == null ? null : Math.abs(p.weightOffsetPlusG),
    status: p.activeFlag === true ? 'active' : p.activeFlag === false ? 'retired' : 'unstated',
    stations: machines
      ? machines.filter((m) => !m.quiet && m.materialId === p.productId).map((m) => m.station).sort((a, b) => a - b)
      : null,
  }));
}

export function countByStatus(rows: readonly CatalogueRow[]): { active: number; retired: number; all: number } {
  return {
    active: rows.filter((r) => r.status === 'active').length,
    retired: rows.filter((r) => r.status === 'retired').length,
    all: rows.length,
  };
}

export function filterRows(rows: readonly CatalogueRow[], f: CatalogueFilter, query: string): CatalogueRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f === 'active' && r.status !== 'active') return false;
    if (f === 'retired' && r.status !== 'retired') return false;
    if (!q) return true;
    return [r.code, r.label, r.colour, r.count, r.tube, String(r.id)].some((v) => v != null && v.toLowerCase().includes(q));
  });
}

/** Active products first, then the rest, each in PDAS order. */
export function activeFirst(rows: readonly CatalogueRow[]): CatalogueRow[] {
  const rank = (r: CatalogueRow) => (r.status === 'active' ? 0 : r.status === 'unstated' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}
