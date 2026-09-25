/**
 * The products that ACTUALLY RAN in a period — independent verification of
 * the report PDFs, 25 Sep 2026 (items C6/C7/W8/T4).
 *
 * The station, calibration and cone-weight reports used to name their
 * line-wide target after the app's own "current product" setting
 * (`sms.product_timeline`, via `getWeightStations`). On the dev copy that
 * setting was product 12 — retired in PDAS and never weighed in the period —
 * while every cone weighed carried one of four OTHER materials. The setpoint
 * happened to agree (1960 g), the name did not.
 *
 * This module answers "which products did the readings themselves carry",
 * from each cone's own `material_id`, confined to the same one source
 * generation every other figure on the report uses, and resolves each
 * product's limits in force at the period's end with the same rule the rest
 * of the reports use (`resolvePeriodTarget`). The caller then states:
 *   - one product: its name, setpoint and in-force instant;
 *   - several with ONE setpoint: every name, "all set to S";
 *   - several with DIFFERENT setpoints: no single line-wide target at all.
 * Retired products carry "(retired in PDAS)" inline, everywhere.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { andEpoch, type GenerationScope } from '../generation.js';
import type { ProductCatalogue } from '../productLimits.js';
import { resolvePeriodTarget } from './common.js';

export const RETIRED_MARKER = '(retired in PDAS)';

export interface RanProduct {
  productId: number;
  /** Distinct label, with RETIRED_MARKER appended when PDAS marks it retired. */
  label: string;
  cones: number;
  /** Setpoint in force at the period's end; null when none is usable for the period. */
  setpointG: number | null;
  inForceAtUtc: string | null;
  inForceIsLowerBound: boolean;
  active: boolean | null;
}

export interface RanTarget {
  /** The single setpoint every ran product shares, or null. */
  targetG: number | null;
  /** Printable: which product(s) ran, with their setpoint. Null when nothing carried a product. */
  label: string | null;
  inForceAtUtc: string | null;
  inForceIsLowerBound: boolean;
  /** Why no single target is stated although products ran. */
  omittedReason: string | null;
  products: RanProduct[];
}

const fmtG = (n: number) => `${n.toFixed(1)} g`;

export async function productsRanInPeriod(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  catalogue: ProductCatalogue,
  scope: GenerationScope,
  station?: number | null,
): Promise<RanProduct[]> {
  const req = pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to);
  let where = 'line_id = @line AND shift_date >= @from AND shift_date <= @to AND material_id IS NOT NULL';
  if (station != null) {
    where += ' AND source_station = @station';
    req.input('station', mssql.Int, station);
  }
  where = andEpoch(where, req, scope, 'cone_event', { prefix: 'rp' });
  const r = await req.query<{ material_id: number; n: number }>(
    `SELECT material_id, COUNT(*) AS n FROM sms.cone_event WHERE ${where} GROUP BY material_id`,
  );
  const periodEndMs = new Date(`${to}T23:59:59Z`).getTime();
  return (r.recordset ?? [])
    .map((x) => {
      const pid = Number(x.material_id);
      const active = catalogue.product(pid)?.activeFlag ?? null;
      const v = catalogue.versionAt(pid, periodEndMs);
      const t = resolvePeriodTarget(v, periodEndMs, to);
      const base = catalogue.distinctLabel(pid);
      return {
        productId: pid,
        label: active === false ? `${base} ${RETIRED_MARKER}` : base,
        cones: Number(x.n),
        setpointG: t.usable ? (v?.setpointG ?? null) : null,
        inForceAtUtc: t.usable ? t.inForceAtUtc : null,
        inForceIsLowerBound: t.usable && t.isLowerBound,
        active,
      };
    })
    .sort((a, b) => b.cones - a.cones || a.productId - b.productId);
}

/** Pure: compose the line-wide target statement from the products that ran. */
export function describeRanTarget(products: RanProduct[]): RanTarget {
  if (products.length === 0) {
    return { targetG: null, label: null, inForceAtUtc: null, inForceIsLowerBound: false, omittedReason: null, products };
  }
  const setpoints = [...new Set(products.map((p) => p.setpointG))];
  const names = products.map((p) => p.label);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (setpoints.length === 1 && setpoints[0] != null) {
    const s = setpoints[0];
    const instants = products.map((p) => p.inForceAtUtc).filter((x): x is string => x != null).sort();
    return {
      targetG: s,
      label: products.length === 1 ? list : `${list} — ${products.length} products ran, all with setpoint ${fmtG(s)}`,
      inForceAtUtc: instants[instants.length - 1] ?? null,
      inForceIsLowerBound: products.some((p) => p.inForceIsLowerBound),
      omittedReason: null,
      products,
    };
  }
  const each = products.map((p) => `${p.label} ${p.setpointG != null ? fmtG(p.setpointG) : 'no setpoint on record for the period'}`);
  return {
    targetG: null,
    label: `${products.length} products ran: ${each.join('; ')}`,
    inForceAtUtc: null,
    inForceIsLowerBound: false,
    omittedReason:
      'No single line-wide target is stated: the products that ran in the period did not share one setpoint on record. ' +
      'Each station is judged against its own product’s target in the table.',
    products,
  };
}
