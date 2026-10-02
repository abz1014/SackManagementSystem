/**
 * SPS Production Report - Count-wise Packing at Each SPS — IFL's report 3 of 8
 * (their email of 29 Sep 2026), registered 1 Oct 2026, built 1 Oct 2026
 * (task F-R3R4).
 *
 * EVERY figure comes from the shared sack cells (`sackCells.ts` `getSackCells`:
 * production date x shift x material x scale verdict) and a pure roll-up of
 * them, so a sack counted here is the sack the Sack Packing Weight Summary,
 * the weight range report and the Sacks screen count for the same period.
 *
 * THE SHAPE IFL ASKED FOR. A matrix: one row per production date and shift,
 * one column per YARN COUNT, each cell the sacks packed and, on a second line,
 * their kilograms. A yarn count is a product attribute: the sack's own
 * `material_id` (the S1_Sack_Quality tag, on every sack since 5 Aug 2026)
 * through `sms.product.count_id` to the count text, via today's product master
 * (the report says so — a count re-pointed later would move old sacks).
 * Sacks from July carry no product and fall in "No product on the reading".
 *
 * WHAT "EACH SPS" CAN AND CANNOT BE. TP1 Line 3 has ONE sack scale
 * (PLC_sack1) and the sack records carry no machine at any layer, so there is
 * exactly one SPS block, labelled as this line's one sack scale and marked
 * unconfirmed (`pendingIfl`). No sack is ever attributed to a winder.
 *
 * Prints LANDSCAPE: one column per yarn count is wider than a portrait page.
 */
import type { ConnectionPool } from 'mssql';
import type { ShiftCode } from '@sms/shared';
import type { GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getSackCells, rollupAll, type SackCell } from '../sackCells.js';
import { csvRowOf, pct, round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

/** The key of the column holding sacks whose reading carries no product. */
export const SPS_NO_PRODUCT_KEY = 'none';
/** What that column is called on every surface. */
export const SPS_NO_PRODUCT_LABEL = 'No product on the reading';
/**
 * The key of the column holding sacks that DO carry a product whose yarn count
 * is not on record (a material today's product master has never heard of, or
 * one with no count). A different fact from "no product on the reading", so a
 * different column; sacks must not be told they carry no product when they do.
 */
export const SPS_NO_COUNT_KEY = 'unknown';
/** What that column is called on every surface (the same words the Sack Packing Weight Summary uses). */
export const SPS_NO_COUNT_LABEL = 'Count not on record';

/** One matrix column: a yarn count (several materials can share one count text), or the no-product bucket. */
export interface SpsCountColumn {
  /** Stable key for `SpsMatrixRow.cells`: the count text, `SPS_NO_COUNT_KEY` or `SPS_NO_PRODUCT_KEY`. */
  key: string;
  /** Count text from today's product master ("36", "20 Slub"); null for the two buckets without a count. */
  yarnCount: string | null;
  /** What the column header prints: the count, `SPS_NO_COUNT_LABEL` or `SPS_NO_PRODUCT_LABEL`. */
  label: string;
  /** The PDAS material ids that map to this count in the period, ascending. */
  materialIds: number[];
}

/** Sacks packed and their kilograms (weight basis applied). */
export interface SpsCell {
  sacks: number;
  kg: number;
}

/** One production date and shift: the cell per count that had sacks, and the row total. */
export interface SpsMatrixRow {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** Keyed by `SpsCountColumn.key`; a count with no sacks in this row is absent. */
  cells: Record<string, SpsCell>;
  total: SpsCell;
}

/** The period's figures for one count. */
export interface SpsCountTotal {
  key: string;
  yarnCount: string | null;
  label: string;
  materialIds: number[];
  sacks: number;
  kg: number;
  /** Mean over sacks with a plausible weight; null when none. */
  avgKg: number | null;
  /** This count's share of all sacks in the period, 1 dp; null when no sacks. */
  sharePct: number | null;
}

/** The one SPS block. */
export interface SpsBlock {
  /** 1: the line's only sack scale. */
  number: number;
  /** "SPS 1 — this line's one sack scale (PLC_sack1)". */
  label: string;
  /** False until IFL confirms that an SPS is a sack scale and how many there are. */
  confirmed: boolean;
}

export interface SpsPackingReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** The weight basis every kg figure is stated under (as-of the period end). */
  weightBasis: string;
  sps: SpsBlock;
  /** The matrix columns, ascending by count, the no-product bucket last. */
  columns: SpsCountColumn[];
  /** One row per production date and shift that had sacks, chronological. */
  rows: SpsMatrixRow[];
  /** Period totals per count, in `columns` order. */
  totals: SpsCountTotal[];
  grandTotal: { sacks: number; kg: number; avgKg: number | null };
  /** Sacks with an implausible weight, kept out of every average (still counted in sacks and kg). */
  implausibleSacks: number;
  note: string;
  /** "Assumed until IFL confirms" lines: defaults this report applied because IFL has not answered. */
  pendingIfl: string[];
  generationNote: GenerationNote;
}

export const SPS_PACKING_NOTE =
  'Sacks packed per production date and shift, by yarn count. A sack’s yarn count comes from its own product (MaterialId) ' +
  'through today’s product master; sacks recorded before 5 August 2026 carry no product and are shown as "No product on the ' +
  'reading". Kilograms are on the weight basis set in Setup; averages exclude implausible weights. A sack’s time is the ' +
  'plant’s insert time: the sack scale records no event time of its own. No sack is attributed to a winder.';

/** The one SPS block's label: this line has one sack scale, and nothing in IFL's data says there is more than one SPS. */
export const SPS_BLOCK_LABEL = 'SPS 1 — this line’s one sack scale (PLC_sack1)';

/** Defaults this report applies until IFL answers; printed as "Assumed until IFL confirms". */
export const SPS_PACKING_PENDING_IFL: readonly string[] = [
  'The line has one sack scale (PLC_sack1), shown as "SPS 1"; IFL has not confirmed that an SPS is a sack scale or how many SPS stations there are.',
  'Yarn counts come from the sack’s product through today’s product master; IFL has not confirmed that a product maps to exactly one count.',
];

const kgText = (n: number): string => String(round(n, 3));

/**
 * "Assumed until IFL confirms": the two defaults above, plus the ones this
 * period's own settings add — a net basis names its tare, and the plausible
 * window names the numbers actually used — so the sentence states what was
 * applied, not what Setup might hold today.
 */
export function spsPackingPendingIfl(basis: string, tareKg: number, loKg: number, hiKg: number): string[] {
  const out = [...SPS_PACKING_PENDING_IFL];
  if (basis === 'net') {
    out.push(`Weights are shown net of a ${kgText(tareKg)} kg sack tare set in Setup. IFL has not confirmed the tare weight.`);
  }
  out.push(
    `Sacks weighing less than ${kgText(loKg)} kg or more than ${kgText(hiKg)} kg (the plausible window set in Setup) are left out of the averages and counted as implausible; ` +
      'they stay in the sack and kilogram totals. IFL has not confirmed the window.',
  );
  return out;
}

/** Shift order within a day. */
const SHIFT_ORDER: readonly ShiftCode[] = ['morning', 'evening', 'night'];
const shiftIdx = (s: string): number => {
  const i = SHIFT_ORDER.indexOf(s as ShiftCode);
  return i < 0 ? SHIFT_ORDER.length : i;
};

/** Where a column sorts: counts first (ascending, as numbers), then "count not on record", then "no product". */
const columnRank = (key: string): number => (key === SPS_NO_PRODUCT_KEY ? 2 : key === SPS_NO_COUNT_KEY ? 1 : 0);

export async function getSpsPackingReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<SpsPackingReportData> {
  const q = { from: resolved.from, to: resolved.to, shift: filters.shift, product: filters.product, shiftRange };
  // One generation, one rule set, one read: the cells. The catalogue only
  // names yarn counts (today's product master).
  const [res, catalogue] = await Promise.all([getSackCells(pool, lineId, q), loadProductCatalogue(pool)]);
  const cells = res.cells;

  // The sack's own material -> today's product master -> count text. Two
  // materials with one count text share a column (their ids are listed); a
  // sack with NO material and a sack whose material has no count on record are
  // two different facts and get two different columns.
  const columnKeyOf = (c: SackCell): string => {
    if (c.materialId == null) return SPS_NO_PRODUCT_KEY;
    const text = catalogue.product(c.materialId)?.countText?.trim();
    return text ? text : SPS_NO_COUNT_KEY;
  };
  const idsByKey = new Map<string, Set<number>>();
  const cellsByKey = new Map<string, SackCell[]>();
  for (const c of cells) {
    const k = columnKeyOf(c);
    const g = cellsByKey.get(k);
    if (g) g.push(c);
    else cellsByKey.set(k, [c]);
    if (c.materialId != null) {
      const set = idsByKey.get(k) ?? new Set<number>();
      set.add(c.materialId);
      idsByKey.set(k, set);
    }
  }
  const keys = [...cellsByKey.keys()].sort((a, b) => columnRank(a) - columnRank(b) || a.localeCompare(b, 'en', { numeric: true }));
  const columns: SpsCountColumn[] = keys.map((key) => ({
    key,
    yarnCount: columnRank(key) === 0 ? key : null,
    label: key === SPS_NO_PRODUCT_KEY ? SPS_NO_PRODUCT_LABEL : key === SPS_NO_COUNT_KEY ? SPS_NO_COUNT_LABEL : key,
    materialIds: [...(idsByKey.get(key) ?? [])].sort((a, b) => a - b),
  }));

  // Rows: one per production date and shift. Cells are exact sums of
  // thousandths, so a row's cells add to its total and the rows to the grand
  // total exactly.
  const cellsByRow = new Map<string, SackCell[]>();
  for (const c of cells) {
    const k = `${c.date}|${c.shift}`;
    const g = cellsByRow.get(k);
    if (g) g.push(c);
    else cellsByRow.set(k, [c]);
  }
  const rows: SpsMatrixRow[] = [...cellsByRow]
    .map(([k, cs]): SpsMatrixRow => {
      const [date, shift] = k.split('|') as [string, ShiftCode];
      const perKey = new Map<string, SackCell[]>();
      for (const c of cs) {
        const ck = columnKeyOf(c);
        const g = perKey.get(ck);
        if (g) g.push(c);
        else perKey.set(ck, [c]);
      }
      // In column order, so every surface walks the cells the way the header reads.
      // (`fromEntries` makes own properties: a count text can never reach a prototype.)
      const rowCells: Record<string, SpsCell> = Object.fromEntries(
        keys.flatMap((key): [string, SpsCell][] => {
          const g = perKey.get(key);
          if (!g) return [];
          const f = rollupAll(g);
          return [[key, { sacks: f.sacks, kg: round(f.kg, 3) ?? 0 }]];
        }),
      );
      const t = rollupAll(cs);
      return { date, shift, cells: rowCells, total: { sacks: t.sacks, kg: round(t.kg, 3) ?? 0 } };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || shiftIdx(a.shift) - shiftIdx(b.shift));

  const grand = rollupAll(cells);
  const totals: SpsCountTotal[] = columns.map((col) => {
    const f = rollupAll(cellsByKey.get(col.key) ?? []);
    return { ...col, sacks: f.sacks, kg: round(f.kg, 3) ?? 0, avgKg: f.avgKg, sharePct: pct(f.sacks, grand.sacks) };
  });

  const note = [
    SPS_PACKING_NOTE,
    cellsByKey.has(SPS_NO_COUNT_KEY)
      ? `Sacks whose product has no yarn count on record are shown as "${SPS_NO_COUNT_LABEL}".`
      : '',
    // A rule version recorded mid-period is applied as it stood at the period END
    // to every sack (RT24-04). Worded as a RECORD, not as a change of value: the
    // flag says a version was saved inside the period, and a version can restate
    // the value already in force.
    res.weightRuleChangedInPeriod ? 'Setup recorded a new weight-basis version during this period; the version in force at its end is applied to every sack.' : '',
    res.plausibilityRuleChangedInPeriod ? 'Setup recorded a new plausible-weight-window version during this period; the version in force at its end is applied to every sack.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    period: resolved,
    filters,
    lineId,
    weightBasis: res.weightBasis,
    sps: { number: 1, label: SPS_BLOCK_LABEL, confirmed: false },
    columns,
    rows,
    totals,
    grandTotal: { sacks: grand.sacks, kg: round(grand.kg, 3) ?? 0, avgKg: grand.avgKg },
    implausibleSacks: grand.implausible,
    note,
    pendingIfl: spsPackingPendingIfl(res.weightBasis, res.tareKg, res.plausibility.loKg, res.plausibility.hiKg),
    generationNote: res.generationNote,
  };
}

export const SPS_PACKING_CSV_HEADERS = [
  'section', 'date', 'shift', 'sps', 'yarn_count', 'material_ids', 'sacks', 'kg', 'avg_kg', 'share_pct',
] as const;

/**
 * Sections: `cell` (one row per date, shift and count with sacks), `shift_total`
 * (one per date and shift), `count_total` (the period per count, with average
 * and share) and `grand_total`. `material_ids` is space-separated.
 */
export function spsPackingCsv(d: SpsPackingReportData): CsvTable {
  const H = SPS_PACKING_CSV_HEADERS;
  const sps = d.sps.label;
  const label = (key: string): string => d.columns.find((c) => c.key === key)?.label ?? key;
  const ids = (key: string): string => (d.columns.find((c) => c.key === key)?.materialIds ?? []).join(' ');
  const rows: CsvRow[] = [
    ...d.rows.flatMap((r) =>
      Object.entries(r.cells).map(([key, c]) =>
        csvRowOf(H, { section: 'cell', date: r.date, shift: r.shift, sps, yarn_count: label(key), material_ids: ids(key), sacks: c.sacks, kg: c.kg })),
    ),
    ...d.rows.map((r) => csvRowOf(H, { section: 'shift_total', date: r.date, shift: r.shift, sps, sacks: r.total.sacks, kg: r.total.kg })),
    ...d.totals.map((t) =>
      csvRowOf(H, { section: 'count_total', sps, yarn_count: t.label, material_ids: t.materialIds.join(' '), sacks: t.sacks, kg: t.kg, avg_kg: t.avgKg, share_pct: t.sharePct })),
    csvRowOf(H, { section: 'grand_total', sps, sacks: d.grandTotal.sacks, kg: d.grandTotal.kg, avg_kg: d.grandTotal.avgKg, share_pct: d.grandTotal.sacks > 0 ? 100 : null }),
  ];
  return { headers: H, rows };
}
