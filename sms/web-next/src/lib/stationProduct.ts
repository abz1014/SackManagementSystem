/**
 * How a station's product is written on a tile, a table row, the sheet and the Wall.
 *
 * The server (GET /api/station-status) already sends the DISTINCT label the Products Board prints
 * ("205-IL0-SD · ORANGE · PVSD8020 · 30"), because several PDAS materials share one description.
 * This only chooses how much of it fits: tiles show code + colour, the full label goes in the title.
 * Nothing is re-derived here, no attribution.
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

export function stationProductText(s: StationProductInput): StationProductText {
  if (s.productBasis === 'mixed') return { short: C.stationUi.severalProducts, full: C.stationUi.severalProducts };
  if (!s.product) return { short: C.stationUi.noProduct, full: C.stationUi.noProduct };
  const parts = s.product.split(SEP);
  const short = parts.length > 2 ? parts.slice(0, 2).join(SEP) : s.product;
  if (s.productBasis === 'line') {
    return { short: `${short} (${C.stationUi.lineProductMark.toLowerCase()})`, full: `${s.product} (${C.stationUi.lineProductMark.toLowerCase()})` };
  }
  return { short, full: s.product };
}
