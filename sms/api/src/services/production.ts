/**
 * Generalized production query (ARCHITECTURE §9). Filtered by date range /
 * shift / station / product, grouped by day|shift|station|none. Parameterised.
 * Merges cone, reject, and sack aggregates by the group key in JS.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';

export type GroupBy = 'day' | 'shift' | 'station' | 'none';

export interface ProductionParams {
  from?: string; // YYYY-MM-DD (shift_date)
  to?: string;
  shift?: string; // morning|evening|night
  station?: number;
  product?: number; // material_id (null in Phase 1 → yields empty)
  /**
   * Upper bound on the production INSTANT, not the day — what makes a replay
   * (`?at=`) show only what existed at that moment.
   *
   * Without it this endpoint answered with the whole shift while /api/live
   * truncated at the replay instant, so under replay the Line screen's sack
   * and cone counts read roughly DOUBLE the Wall display's for the same
   * shift, mid-shift. period.ts documents `tsTo` as exactly this guard; it
   * simply was never plumbed through to here.
   */
  tsTo?: string;
  groupBy: GroupBy;
}

export interface ProductionRow {
  group: string;
  cones: number;
  rejectedCones: number;
  sacks: number | null;
  sackWeightKg: number | null;
  conesInRangePct: number | null;
}

/** SQL expression that yields the grouping key per dimension. */
function groupExpr(g: GroupBy, stationCol = 'source_station'): string {
  switch (g) {
    case 'day':
      return "CONVERT(varchar(10), shift_date, 120)";
    case 'shift':
      return 'shift_code';
    case 'station':
      return `CAST(${stationCol} AS varchar(12))`;
    case 'none':
      return "'total'";
  }
}

/** Common WHERE + parameter binding for a table. `hasStation` gates station filters. */
function bindFilters(
  req: SqlRequest,
  p: ProductionParams,
  lineId: number,
  hasStation: boolean,
): string {
  const w: string[] = ['line_id = @line'];
  req.input('line', mssql.Int, lineId);
  if (p.from) {
    w.push('shift_date >= @from');
    req.input('from', mssql.Date, p.from);
  }
  if (p.to) {
    w.push('shift_date <= @to');
    req.input('to', mssql.Date, p.to);
  }
  if (p.shift) {
    w.push('shift_code = @shift');
    req.input('shift', mssql.VarChar(10), p.shift);
  }
  // production_ts_utc_ms leads the merge index on all three tables, so this
  // stays an index seek rather than turning the scan wider.
  if (p.tsTo) {
    w.push('production_ts_utc_ms <= @tsTo');
    req.input('tsTo', mssql.BigInt, new Date(p.tsTo).getTime());
  }
  if (p.station != null && hasStation) {
    w.push('source_station = @station');
    req.input('station', mssql.Int, p.station);
  }
  if (p.product != null && hasStation) {
    // material_id is NULL on every row from before the 2026-08-05 source
    // rebuild (the column did not exist at source), so this filter drops that
    // whole generation; getProduction reports how many via `unattributed`.
    w.push('material_id = @product');
    req.input('product', mssql.Int, p.product);
  }
  return w.join(' AND ');
}

/**
 * Present only on a product-filtered call, and the reason it exists: product
 * attribution is asymmetric across the 2026-08-05 source rebuild. Every
 * July-generation cone carries material_id NULL because the column did not
 * exist at source then, and back-filling it would be fabrication. So
 * `?product=` over a range spanning both generations silently answers with
 * the September rows only, for a period the screen says covers both
 * (SEPT-2026-EPOCH-DECISION §4.6). `rows` is the count of cones in the
 * requested range with NO attribution at all, `of` every cone in the range —
 * both counted WITHOUT the product filter — so the screen can say "N of M
 * readings in this period predate product recording" instead of narrowing
 * the period without saying so. Cones only: sacks are never product-filtered
 * here (see bindFilters), so they are never silently dropped.
 */
export interface Unattributed {
  rows: number;
  of: number;
}

export interface ProductionResult {
  groupBy: GroupBy;
  rows: ProductionRow[];
  /** null on an unfiltered call — nothing was narrowed, so there is nothing to say. */
  unattributed: Unattributed | null;
}

export async function getProduction(
  pool: ConnectionPool,
  lineId: number,
  p: ProductionParams,
): Promise<ProductionResult> {
  const g = groupExpr(p.groupBy);
  const byStation = p.groupBy === 'station';
  // 'none' → single aggregate row: label with the literal, NO GROUP BY
  // (SQL Server rejects GROUP BY on a constant).
  const groupClause = p.groupBy === 'none' ? '' : `GROUP BY ${g}`;

  // The unattributed count, when a product filter is on: the same range and
  // station/shift filters, minus the product, so `of` is the population the
  // caller believes the period covers.
  let unattributed: Unattributed | null = null;
  if (p.product != null) {
    const uReq = pool.request();
    const uWhere = bindFilters(uReq, { ...p, product: undefined }, lineId, true);
    const u = await uReq.query<{ n: number; no_attr: number }>(
      `SELECT COUNT(*) n, SUM(CASE WHEN material_id IS NULL THEN 1 ELSE 0 END) no_attr
       FROM sms.cone_event WHERE ${uWhere}`,
    );
    const u0 = u.recordset[0];
    unattributed = { rows: Number(u0?.no_attr ?? 0), of: Number(u0?.n ?? 0) };
  }

  // cones (with in-range %)
  const coneReq = pool.request();
  const coneWhere = bindFilters(coneReq, p, lineId, true);
  const cones = await coneReq.query<{ grp: string; n: number; inr: number }>(
    `SELECT ${g} AS grp, COUNT(*) n, SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END) inr
     FROM sms.cone_event WHERE ${coneWhere} ${groupClause}`,
  );

  // rejected cones
  const rejReq = pool.request();
  const rejWhere = bindFilters(rejReq, p, lineId, true);
  const rejects = await rejReq.query<{ grp: string; n: number }>(
    `SELECT ${g} AS grp, COUNT(*) n FROM sms.reject_event WHERE ${rejWhere} ${groupClause}`,
  );

  // sacks — no station dimension; skip when grouping by station
  let sacks: { grp: string; n: number; kg: number }[] = [];
  if (!byStation) {
    const sackReq = pool.request();
    const sackWhere = bindFilters(sackReq, p, lineId, false);
    const res = await sackReq.query<{ grp: string; n: number; kg: number }>(
      `SELECT ${g} AS grp, COUNT(*) n, ISNULL(SUM(weight_kg),0) kg
       FROM sms.sack_event WHERE ${sackWhere} ${groupClause}`,
    );
    sacks = res.recordset;
  }

  // weight basis (Q4/Q5)
  const wr = await pool.request().input('line', mssql.Int, lineId).query<{ basis: string; tare: number }>(
    `SELECT TOP 1 basis, sack_tare_kg AS tare FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const basis = wr.recordset[0]?.basis ?? 'as_recorded';
  const tare = Number(wr.recordset[0]?.tare ?? 0);

  // merge by group key
  const map = new Map<string, ProductionRow>();
  const row = (grp: string): ProductionRow =>
    map.get(grp) ??
    map.set(grp, { group: grp, cones: 0, rejectedCones: 0, sacks: byStation ? null : 0, sackWeightKg: byStation ? null : 0, conesInRangePct: null }).get(grp)!;

  for (const c of cones.recordset) {
    const r = row(c.grp);
    r.cones = c.n;
    r.conesInRangePct = c.n > 0 ? Math.round((1000 * c.inr) / c.n) / 10 : null;
  }
  for (const rj of rejects.recordset) row(rj.grp).rejectedCones = rj.n;
  for (const s of sacks) {
    const r = row(s.grp);
    r.sacks = s.n;
    let kg = Number(s.kg);
    if (basis === 'net') kg -= tare * s.n;
    r.sackWeightKg = Math.round(kg * 10) / 10;
  }

  // 'station' groups are numeric strings (varchar-cast for the shared group
  // key) — a plain string sort orders them "1,10,11,...,2,3" alphabetically.
  // Sort numerically for that dimension; string sort is correct for the rest
  // (day = ISO date, shift = already a fixed short list, none = single row).
  const rows = [...map.values()].sort((a, b) =>
    byStation ? Number(a.group) - Number(b.group) : a.group.localeCompare(b.group),
  );
  return { groupBy: p.groupBy, rows, unattributed };
}
