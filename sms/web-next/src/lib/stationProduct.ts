/**
 * How a station's product is written on a tile, a table row, the sheet and the Wall.
 *
 * The server (GET /api/station-status) already sends the DISTINCT label the Products Board prints
 * ("205-IL0-SD · ORANGE · PVSD8020 · 30"), because several PDAS materials share one description.
 * This only chooses how much of it fits: tiles show code + colour, the full label goes in the title.
 * When two products shown together would read the same at that length ("... · ORANGE · PVSD8020 · 30" and
 * "... · ORANGE · PVSD8020 · 20 Slub" both start "205-IL0-SD · ORANGE"), the short form grows one segment at a time
 * until it is unique among the products on screen. Nothing is re-derived here, no attribution.
 */
import { C } from '../copy';

export interface StationProductInput {
  product: string | null;
  productBasis?: 'own' | 'mixed' | 'line' | null;
}

export interface StationProductText {
  /** What fits on a tile or a table cell. */
  short: string;
  /** The whole sentence for the tooltip and the sheet. */
  full: string;
}

const SEP = ' · ';

/** Shortest prefix (at least code + colour) of `label`'s segments that no OTHER label in `shown` shares. */
export function shortProductLabel(label: string, shown: readonly (string | null | undefined)[] = []): string {
  const parts = label.split(SEP);
  if (parts.length <= 2) return label;
  const others = [...new Set(shown.filter((x): x is string => !!x && x !== label))].map((x) => x.split(SEP));
  for (let k = 2; k < parts.length; k++) {
    const prefix = parts.slice(0, k).join(SEP);
    if (!others.some((o) => o.length >= k && o.slice(0, k).join(SEP) === prefix)) return prefix;
  }
  return label;
}

/**
 * `shown`: the product labels of every station on the same screen (tiles, table, Wall). Without it the short
 * form is the fixed code + colour.
 */
export function stationProductText(s: StationProductInput, shown?: readonly (string | null | undefined)[]): StationProductText {
  if (s.productBasis === 'mixed') return { short: C.stationUi.severalProducts, full: C.stationUi.severalProducts };
  if (!s.product) return { short: C.stationUi.noProduct, full: C.stationUi.noProduct };
  const short = shortProductLabel(s.product, shown);
  if (s.productBasis === 'line') {
    return { short: `${short} (${C.stationUi.lineProductMark.toLowerCase()})`, full: `${s.product} (${C.stationUi.lineProductMark.toLowerCase()})` };
  }
  return { short, full: s.product };
}
