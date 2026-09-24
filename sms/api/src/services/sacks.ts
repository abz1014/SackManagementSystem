/**
 * Sack summary — roadmap Phase 7 (15 Sep 2026): the figures the Sacks screen
 * heads with, composed the way the register and production.ts already read
 * sack_event, so a number here is the number Report and Line print.
 *
 * WHY IT EXISTS. The gap analysis (§9) found the sack in-range share was
 * computed by the CLI's `summary` command and shown on no screen at all —
 * July measured 4.23 % of sacks outside the scale's range, and a manager had
 * nowhere to see it. This service puts count, kg, average, in-range share,
 * cones per sack (approximate, labelled), by shift and by product in one
 * response.
 *
 * THE RULES IT FOLLOWS, each borrowed rather than invented:
 *  - kg total: every sack, with the weight rule's basis and tare applied
 *    exactly as production.ts does — so the Sacks screen's kg is Report's kg.
 *  - average: over the PLAUSIBLE population only (the rule on file, both
 *    bounds, through the same plausibleWhere the cone statistics use — roadmap
 *    Phase 4's one population rule), with the excluded count stated. A 0.3 kg
 *    sack is a scale fault, not a light sack, and it would drag the mean.
 *  - in-range: the scale's own bit (REDESIGN rule 1), named as the scale's;
 *    sacks with no bit are counted separately, never as failures.
 *  - cones per sack: cones weighed in the period over sacks weighed in it —
 *    an approximation, because the plant records no link from a cone to its
 *    sack (CLAUDE.md), and the response says so.
 *  - product: a sack's OWN material_id (present since 5 Aug 2026); the
 *    unattributed count says how many sacks predate product recording.
 *  - the sack's time is the plant's insert time (DQ-5), stated on the
 *    response so every consumer prints the caveat.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';
import { plausibleWhere } from './coneState.js';
import { MACHINE_LEVEL_REASON } from './sackStock.js';
import {
  andEpoch, noteOf, resolveGenerationScope,
  type EventTable, type GenerationNote, type GenerationScope,
} from './generation.js';
import { getPlausibilityRuleAsOf, getWeightRuleAsOf, plantDayEndMs, plantDayStartMs } from './ruleAsOf.js';

export interface SackSummaryQuery {
  from: string;
  to: string;
  shift?: string;
  /** Replay cap on the production instant, as every other period query. */
  tsTo?: string;
  /** material_id — the sack's own; pre-August sacks carry none and drop out (see `unattributed`). */
  product?: number;
}

export interface SackGroup {
  sacks: number;
  /** Under the weight rule on file (basis + tare), like production.ts. */
  kg: number;
  /** Over the plausible population; null when none. */
  avgKg: number | null;
  /** Share of sacks the scale's own bit passed, of those carrying a bit. */
  inRangePct: number | null;
  inRange: number;
  /** Sacks with no in-range bit at all. */
  noFlag: number;
  /** Sacks the plausibility rule excludes from the average. */
  implausible: number;
}

export interface SackSummary {
  from: string;
  to: string;
  shift: string | null;
  product: number | null;
  totals: SackGroup & {
    cones: number;
    /** Approximate: the plant records no cone → sack link. */
    conesPerSack: number | null;
  };
  byShift: (SackGroup & { shift: string })[];
  byProduct: (SackGroup & { materialId: number | null; productName: string | null })[];
  /** Sacks in the period with no product on the reading, of all sacks in it (product filter ignored). */
  unattributed: { rows: number; of: number };
  weightBasis: string;
  tareKg: number;
  plausibility: { loKg: number; hiKg: number };
  sackTimeIsInsertTime: true;
  conesPerSackApproximate: true;
  machineLevel: { enabled: false; reason: string };
  /** Which source generation these sacks came from, and what was left out. */
  generationNote?: GenerationNote;
  /** RT24-04: true when the named rule changed at least once inside [from, to]. */
  weightRuleChangedInPeriod?: boolean;
  plausibilityRuleChangedInPeriod?: boolean;
}

interface GroupRow {
  grp: string | number | null;
  n: number;
  kg: number;
  inr: number;
  noflag: number;
  implausible: number;
  plaus_kg: number;
  plaus_n: number;
  product_name?: string | null;
}

/**
 * The shared WHERE for every sack query here — the same columns and parameters
 * production.ts binds, plus the SOURCE-GENERATION predicate (generation.ts,
 * 23 Sep 2026). `table` matters: one generation spans one `sms.source_epoch`
 * row PER SOURCE TABLE, so the sack aggregate and the cone count that divides
 * it must each name their own table's epoch — getting that wrong would make
 * cones-per-sack a ratio across two generations, which is precisely the
 * defect being closed.
 */
function bindFilters(
  req: SqlRequest,
  lineId: number,
  q: SackSummaryQuery,
  alias: string,
  withProduct: boolean,
  scope: GenerationScope,
  table: EventTable,
): string {
  const c = (n: string) => `${alias}${n}`;
  const w = [`${c('line_id')} = @line`, `${c('shift_date')} >= @from`, `${c('shift_date')} <= @to`];
  req.input('line', mssql.Int, lineId).input('from', mssql.Date, q.from).input('to', mssql.Date, q.to);
  if (q.shift) {
    w.push(`${c('shift_code')} = @shift`);
    req.input('shift', mssql.VarChar(10), q.shift);
  }
  if (q.tsTo) {
    w.push(`${c('production_ts_utc_ms')} <= @tsTo`);
    req.input('tsTo', mssql.BigInt, new Date(q.tsTo).getTime());
  }
  if (withProduct && q.product != null) {
    w.push(`${c('material_id')} = @product`);
    req.input('product', mssql.Int, q.product);
  }
  return andEpoch(w.join(' AND '), req, scope, table, { alias });
}

const SHIFT_ORDER = ['morning', 'evening', 'night'];

export async function getSackSummary(pool: ConnectionPool, lineId: number, q: SackSummaryQuery): Promise<SackSummary> {
  // One generation for the sack aggregates AND the cone count they are
  // divided by, resolved once (generation.ts).
  const scope = await resolveGenerationScope(pool, lineId, { from: q.from, to: q.to }, ['cone_event', 'sack_event']);
  // RT24-04: judged as of the PERIOD END (tsTo, the replay cap, wins over
  // `to` exactly as bindFilters gives it precedence below), not "whatever is
  // configured right now" — the same defect class product_limit_version was
  // built to close. Both queries are single SQL aggregates over the whole
  // period; per-row-in-JS is neither needed nor done anywhere in this file.
  const periodEndPlantMs = q.tsTo ? new Date(q.tsTo).getTime() : plantDayEndMs(q.to);
  const periodStartPlantMs = plantDayStartMs(q.from);
  const [plausR, wrR] = await Promise.all([
    getPlausibilityRuleAsOf(pool, lineId, periodEndPlantMs, periodStartPlantMs),
    getWeightRuleAsOf(pool, lineId, periodEndPlantMs, periodStartPlantMs),
  ]);
  const plaus = plausR.rule;
  const basis = wrR.rule?.basis ?? 'as_recorded';
  const tare = wrR.rule?.sackTareKg ?? 0;
  const window = { loG: plaus.sackLoKg, hiG: plaus.sackHiKg };

  const aggregate = async (groupExpr: string | null, join = ''): Promise<GroupRow[]> => {
    const req = pool.request();
    const where = bindFilters(req, lineId, q, 'e.', true, scope, 'sack_event');
    const plausible = plausibleWhere(req, 'e.weight_kg', window, { prefix: 'sp' });
    const grp = groupExpr ?? `'total'`;
    const nameCol = join ? `, COALESCE(p.description, p.lot_code) AS product_name` : '';
    const groupBy = groupExpr ? ` GROUP BY ${groupExpr}${join ? ', COALESCE(p.description, p.lot_code)' : ''}` : '';
    const r = await req.query<GroupRow>(
      `SELECT ${grp} AS grp, COUNT(*) n, ISNULL(SUM(e.weight_kg), 0) kg,
              SUM(CASE WHEN e.in_range = 1 THEN 1 ELSE 0 END) inr,
              SUM(CASE WHEN e.in_range IS NULL THEN 1 ELSE 0 END) noflag,
              SUM(CASE WHEN e.weight_kg IS NOT NULL AND NOT (${plausible}) THEN 1 ELSE 0 END) implausible,
              ISNULL(SUM(CASE WHEN ${plausible} THEN e.weight_kg ELSE 0 END), 0) plaus_kg,
              SUM(CASE WHEN ${plausible} THEN 1 ELSE 0 END) plaus_n${nameCol}
         FROM sms.sack_event e ${join}
        WHERE ${where}${groupBy}`,
    );
    return r.recordset;
  };

  const toGroup = (r: GroupRow): SackGroup => {
    const n = Number(r.n);
    const inr = Number(r.inr);
    const noflag = Number(r.noflag);
    const plausN = Number(r.plaus_n);
    let kg = Number(r.kg);
    let plausKg = Number(r.plaus_kg);
    if (basis === 'net') {
      kg -= tare * n;
      plausKg -= tare * plausN;
    }
    const flagged = n - noflag;
    return {
      sacks: n,
      kg: Math.round(kg * 10) / 10,
      avgKg: plausN > 0 ? Math.round((100 * plausKg) / plausN) / 100 : null,
      inRangePct: flagged > 0 ? Math.round((1000 * inr) / flagged) / 10 : null,
      inRange: inr,
      noFlag: noflag,
      implausible: Number(r.implausible),
    };
  };

  const [totalRows, shiftRows, productRows] = await Promise.all([
    aggregate(null),
    aggregate('e.shift_code'),
    aggregate('e.material_id', 'LEFT JOIN sms.product p ON p.product_id = e.material_id'),
  ]);

  // Cones in the same period and filters, for the approximate cones-per-sack.
  const coneReq = pool.request();
  const coneWhere = bindFilters(coneReq, lineId, q, '', true, scope, 'cone_event');
  const cones = await coneReq.query<{ n: number }>(`SELECT COUNT(*) n FROM sms.cone_event WHERE ${coneWhere}`);
  const coneN = Number(cones.recordset[0]?.n ?? 0);

  // Sacks with no product on the reading, of every sack in the period — the
  // product filter deliberately left off, as production.ts does for cones.
  const uReq = pool.request();
  const uWhere = bindFilters(uReq, lineId, q, '', false, scope, 'sack_event');
  const u = await uReq.query<{ n: number; no_attr: number }>(
    `SELECT COUNT(*) n, SUM(CASE WHEN material_id IS NULL THEN 1 ELSE 0 END) no_attr FROM sms.sack_event WHERE ${uWhere}`,
  );

  const totals = toGroup(totalRows[0] ?? { grp: 'total', n: 0, kg: 0, inr: 0, noflag: 0, implausible: 0, plaus_kg: 0, plaus_n: 0 });
  return {
    from: q.from,
    to: q.to,
    shift: q.shift ?? null,
    product: q.product ?? null,
    totals: {
      ...totals,
      cones: coneN,
      conesPerSack: totals.sacks > 0 ? Math.round((10 * coneN) / totals.sacks) / 10 : null,
    },
    byShift: shiftRows
      .map((r) => ({ shift: String(r.grp), ...toGroup(r) }))
      .sort((a, b) => SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift)),
    byProduct: productRows
      .map((r) => ({
        materialId: r.grp == null ? null : Number(r.grp),
        productName: r.grp == null ? null : (r.product_name ?? null),
        ...toGroup(r),
      }))
      .sort((a, b) => b.sacks - a.sacks),
    unattributed: { rows: Number(u.recordset[0]?.no_attr ?? 0), of: Number(u.recordset[0]?.n ?? 0) },
    weightBasis: basis,
    tareKg: tare,
    plausibility: { loKg: plaus.sackLoKg, hiKg: plaus.sackHiKg },
    sackTimeIsInsertTime: true,
    conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: MACHINE_LEVEL_REASON },
    generationNote: noteOf(scope),
    weightRuleChangedInPeriod: wrR.ruleChangedInPeriod,
    plausibilityRuleChangedInPeriod: plausR.ruleChangedInPeriod,
  };
}
