/**
 * Products > Board: the pure part. One card per station from `GET /api/machines/running`, joined to the
 * product list (code, colour, target, tolerance, retired flag) and the period's cone counts.
 *
 * What SMS knows about a station's product (owner's PDAS understanding, CLAUDE.md Stage 3): nothing in
 * PDAS or the acquisition database says which product a station is set to. The station's panel stamps
 * the product on every cone, so SMS knows only "the product on the latest cone it weighed" (running) and
 * "the last product it stamped, as of its last cone" (idle). Times here are times of CONES, never of the
 * operator pressing a button. `sinceUtc` is the start of the 2-hour window, not a change time (VERIFY-D2-D4):
 * the run start is `runStartUtc`, and when `runStartIsLookbackLimit` is set the run may be older, so the
 * wording is "since at least", never a start time.
 */
import type { MachineRunning, ProductOption } from '../../../bridge/api';
import { productLabel as productLabelLib } from '../../../bridge/lib';

export interface ProductFacts {
  materialId: number;
  /** PDAS description, the code operators know ("205-IL0-SD"). */
  code: string;
  /** Colour as PDAS holds it; the tube name when PDAS holds no colour. */
  colour: string | null;
  setpointG: number | null;
  minusG: number | null;
  plusG: number | null;
  /** PDAS says explicitly that it is retired; null/undefined activeFlag is left unmarked (RT-018). */
  retired: boolean;
  /** The distinct label of lib/productLabel, used where the code alone would repeat. */
  label: string;
}

/** "ORANGE" becomes "Orange"; a mixed-case colour ("Star Green") is kept as PDAS holds it. */
export function niceColour(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s === s.toUpperCase() && !s.includes('_')) return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

export function productFacts(products: readonly ProductOption[], labels: Map<number, string>): Map<number, ProductFacts> {
  const out = new Map<number, ProductFacts>();
  for (const p of products) {
    out.set(p.productId, {
      materialId: p.productId,
      code: p.description || p.lotCode || `Product ${p.productId}`,
      colour: niceColour(p.color) ?? (p.tubeType?.trim() || null),
      setpointG: p.setpointG,
      minusG: p.weightOffsetMinusG == null ? null : Math.abs(p.weightOffsetMinusG),
      plusG: p.weightOffsetPlusG == null ? null : Math.abs(p.weightOffsetPlusG),
      retired: p.activeFlag === false,
      label: labels.get(p.productId) ?? productLabelLib.productLabel(p),
    });
  }
  return out;
}

export type Filter = 'all' | 'running' | 'idle';

export interface BoardProduct {
  materialId: number | null;
  code: string;
  colour: string | null;
  setpointG: number | null;
  minusG: number | null;
  plusG: number | null;
  retired: boolean;
  label: string;
}

export interface BoardCard {
  station: number;
  /** The plant's name for the station when the roster gave one, else null (the screen prints "Station N"). */
  stationName: string | null;
  running: boolean;
  /** Running: the product on the latest cone. Idle: the last product it stamped. null: none on record. */
  product: BoardProduct | null;
  /** Running only. atLeast: the run may be older than `at` (no change found in the lookback). */
  since: { at: string; atLeast: boolean } | null;
  /** Idle only: the time of the cone that carried that product. */
  lastStampedUtc: string | null;
  /** Running only, and only when the server found one: what it replaced and when the new product's first cone was weighed. */
  change: { atUtc: string; from: BoardProduct | null } | null;
  /** The newest cone ever seen at the station. */
  lastConeUtc: string | null;
  /** null when the counts could not be read. */
  conesInPeriod: number | null;
}

function boardProduct(id: number | null, name: string | null, facts: Map<number, ProductFacts>, activeFlag: boolean | null | undefined): BoardProduct | null {
  if (id == null) return null;
  const f = facts.get(id);
  if (f) return { ...f };
  // Not in the product list (list failed or product unknown): name what the station row itself says.
  return {
    materialId: id,
    code: name || `Product ${id}`,
    colour: null,
    setpointG: null,
    minusG: null,
    plusG: null,
    retired: activeFlag === false,
    label: name || `Product ${id}`,
  };
}

/** conesByStation: null = the counts failed (never a confident zero); a station absent from a loaded answer has none. */
export function buildCards(
  machines: readonly MachineRunning[],
  facts: Map<number, ProductFacts>,
  conesByStation: Map<number, number> | null,
): BoardCard[] {
  return [...machines]
    .sort((a, b) => a.station - b.station)
    .map((m): BoardCard => {
      const running = !m.quiet;
      const product = running
        ? boardProduct(m.materialId, m.productName, facts, m.productActive)
        : boardProduct(m.lastMaterialId ?? null, m.lastProductName ?? null, facts, m.lastProductActive);
      let since: BoardCard['since'] = null;
      if (running) {
        if (m.runStartUtc != null) since = { at: m.runStartUtc, atLeast: m.runStartIsLookbackLimit === true };
        else if (m.sinceUtc != null) since = { at: m.sinceUtc, atLeast: true };
      }
      const change =
        running && m.lastChange
          ? {
              atUtc: m.lastChange.atUtc,
              from: boardProduct(m.lastChange.fromMaterialId, m.lastChange.fromProductName, facts, undefined),
            }
          : null;
      return {
        station: m.station,
        stationName: m.stationName?.trim() || null,
        running,
        product,
        since,
        lastStampedUtc: running ? null : (m.lastStampedUtc ?? null),
        change,
        lastConeUtc: running ? (m.newestUtc ?? m.lastSeenUtc) : m.lastSeenUtc,
        conesInPeriod: conesByStation ? (conesByStation.get(m.station) ?? 0) : null,
      };
    });
}

export function applyFilter(cards: readonly BoardCard[], f: Filter): BoardCard[] {
  return f === 'all' ? [...cards] : cards.filter((c) => (f === 'running' ? c.running : !c.running));
}

export interface BoardChange {
  station: number;
  atUtc: string;
  to: BoardProduct | null;
  from: BoardProduct | null;
}

/** Product changes the server found, newest first. Each is timed at the first cone of the new product. */
export function buildChanges(cards: readonly BoardCard[]): BoardChange[] {
  return cards
    .filter((c) => c.change)
    .map((c) => ({ station: c.station, atUtc: c.change!.atUtc, to: c.product, from: c.change!.from }))
    .sort((a, b) => (a.atUtc < b.atUtc ? 1 : a.atUtc > b.atUtc ? -1 : a.station - b.station));
}

/** "1,960 g ± 50 g" when the offsets agree, "1,910 g to 2,000 g" when they do not, null without a target. */
export function limitsText(p: Pick<BoardProduct, 'setpointG' | 'minusG' | 'plusG'>, fmtG: (n: number) => string): string | null {
  if (p.setpointG == null) return null;
  if (p.minusG == null || p.plusG == null) return fmtG(p.setpointG);
  if (p.minusG === p.plusG) return `${fmtG(p.setpointG)} ± ${fmtG(p.plusG)}`;
  return `${fmtG(p.setpointG - p.minusG)} to ${fmtG(p.setpointG + p.plusG)}`;
}
