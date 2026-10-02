/**
 * Management summary: the KPI set beside the period before, each with its
 * change, and the coverage of both periods stated first. Roadmap Phase 8
 * (15 Sep 2026). The verdict mark stays on the page head (Report.tsx).
 *
 * Every row prints "awaiting IFL's approval": the set and its definitions
 * (KPI-DEFINITIONS.md) are the developer's proposal until IFL signs them.
 */
import { useMemo } from 'react';
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtDayLong, fmtInt, fmtSpan } from '../../lib/fmt';
import type { KpiRow, ManagementSummaryData, ProductMixRow, ProductOption } from '../../api';
import { distinctProductLabels } from '../../lib/productLabel';
import { describePeriod, type ShiftCode } from '../../lib/period';
import { digitsFor, fmtDelta } from './model';

function fmtValue(v: number | null, unit: KpiRow['unit'], key?: string): string {
  if (v == null) return '—';
  if (unit === 'seconds') return fmtSpan(v);
  const digits = digitsFor(unit, key);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit === '%' ? `${s}%` : `${s} ${unit}`;
}

const SHIFT_REF = /^(\d{4}-\d{2}-\d{2})\.(morning|evening|night)$/;
const ONE_END = '\u0000';

/**
 * The "compared with ..." caption. C-167 (2 Oct 2026): a shift-bounded summary's prior period is a SHIFT range, so when the server
 * sends `prior.fromShift`/`toShift` the caption names those shifts in the period control's own words (`describePeriod`), split at its
 * " – " into the two ends `priorSpan` takes; a one-shift or one-day prior has no second end and is named once. Otherwise the
 * calendar days, as before.
 */
function priorCaption(prior: ManagementSummaryData['prior']): string {
  const a = SHIFT_REF.exec(prior.fromShift ?? '');
  const b = SHIFT_REF.exec(prior.toShift ?? '');
  if (!a || !b) return W.reports.priorSpan(fmtDayLong(prior.from), fmtDayLong(prior.to));
  const words = describePeriod({
    key: 'range', from: prior.from, to: prior.to, tsTo: '', live: false, days: 1,
    fromShift: { date: a[1]!, shift: a[2] as ShiftCode }, toShift: { date: b[1]!, shift: b[2] as ShiftCode },
  });
  const ends = words.split(' – ');
  if (ends.length === 2) return W.reports.priorSpan(ends[0]!, ends[1]!);
  const once = W.reports.priorSpan(words, ONE_END).replace(` to ${ONE_END}`, '');
  return once.includes(ONE_END) ? W.reports.priorSpan(words, words) : once;
}

export function SummarySection({ d, products }: { d: ManagementSummaryData; products: ProductOption[] }) {
  // Defect fix (16 Sep 2026): several PDAS materials on this line share one
  // plain description ("205-IL0-SD" is six of them), which is all the
  // server's labelFor can print, so the product-mix table could show the
  // same words on four rows the reader has no way to tell apart even though
  // they are distinct products (distinct productId). Product.tsx already
  // solves this for its own per-product rows via distinctProductLabels; the
  // same disambiguation is reused here rather than inventing a second one.
  // Done client-side because the server's product catalogue (productLimits.ts)
  // is outside this worker's file ownership for this task.
  const labels = useMemo(() => distinctProductLabels(products), [products]);
  if (d.coverage.current.daysWithData === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  const priorEmpty = d.coverage.prior.daysWithData === 0;
  /*
   * U5 assumed every incomparable row carried the SAME reason, because the
   * only reason that existed was derived from the two periods' coverage
   * rather than from the individual KPI — so it took the FIRST such row's
   * reason and printed it as a note for all of them.
   *
   * That assumption stopped being true on 23 Sep 2026 (`71ac170`), which
   * added a second, independent comparability test: `attributionSensitive`
   * KPIs are withheld when product attribution covers materially different
   * shares of the two periods. A KPI can now be blocked by coverage, by
   * attribution, or by both (summary.ts joins them), and the three read
   * differently. With both kinds present, `find` returned whichever row came
   * first in the KPI list — the coverage reason, since `shape: 'total'` rows
   * are declared ahead of `cones_within_limits_pct` — and the attribution
   * reason survived only in a tooltip on a different row, where a printed
   * page cannot show it at all.
   *
   * The per-row data was always exact; only the "one reason fits all"
   * summarisation was wrong. So collect the DISTINCT reasons in the order
   * they first appear and print every one. In the common case there is still
   * exactly one and the note reads as it always did.
   */
  const incomparableReasons = [
    ...new Set(d.kpis.filter((k) => !k.comparable && k.incomparableReason).map((k) => k.incomparableReason!)),
  ];
  return (
    <>
      <Block first>
        <p className="g">
          {priorCaption(d.prior)}
          {' · '}
          {W.reports.priorCoverage(d.coverage.prior.daysWithData, d.coverage.prior.daysInPeriod)}.
        </p>
        {priorEmpty && <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.priorNoData}</p>}
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>

      <Block label={W.reports.kpi}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{W.reports.kpi}</th>
                <th className="n">{W.reports.thisPeriod}</th>
                <th className="n">{W.reports.priorPeriod}</th>
                <th className="n">{W.reports.change}</th>
                <th>{W.reports.approval}</th>
              </tr>
            </thead>
            <tbody>
              {d.kpis.map((k) => (
                <tr key={k.key}>
                  <td>
                    {k.label}
                    {k.betterWhen !== 'neither' && (
                      <span className="mut sm"> · {k.betterWhen === 'higher' ? W.reports.betterHigher : W.reports.betterLower}</span>
                    )}
                  </td>
                  <td className="n">{fmtValue(k.current, k.unit, k.key)}</td>
                  <td className="n">{fmtValue(k.prior, k.unit, k.key)}</td>
                  <td className="n">
                    {k.comparable ? (
                      k.unit === 'seconds' && k.delta
                        ? `${k.delta.abs > 0 ? '+' : k.delta.abs < 0 ? '−' : ''}${fmtSpan(Math.abs(k.delta.abs))}`
                        : fmtDelta(k.delta, digitsFor(k.unit, k.key))
                    ) : (
                      <span title={k.incomparableReason ?? undefined}>{W.reports.notComparable}</span>
                    )}
                  </td>
                  <td className="mut sm">{k.approval === 'awaiting' ? W.reports.approval : k.approval}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* One reason renders exactly as it did before (a single sentence
            after the heading); two or more are listed, so neither can hide
            behind the other. Printed, not a tooltip — this page goes to
            paper and a hover has no meaning there. */}
        {incomparableReasons.length === 1 && (
          <p className="mut sm" style={{ marginTop: 10 }}>{W.reports.incomparableNote} {incomparableReasons[0]}</p>
        )}
        {incomparableReasons.length > 1 && (
          <div className="mut sm" style={{ marginTop: 10 }}>
            <p>{W.reports.incomparableNote}</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {incomparableReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      <Block label={W.reports.productMix}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{W.reports.colProduct}</th>
                <th className="n">{W.reports.thisPeriod}</th>
                <th className="n">{W.reports.priorPeriod}</th>
              </tr>
            </thead>
            <tbody>
              <ProductMixRows current={d.productMix.current} prior={d.productMix.prior} labels={labels} />
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}

/** The union of products either period ran, each period's own cone count beside it — so a reader can see whether a mean-weight comparison is even comparing the same products. */
function ProductMixRows({ current, prior, labels }: { current: ProductMixRow[]; prior: ProductMixRow[]; labels: Map<number, string> }) {
  const curOf = new Map(current.map((m) => [m.productId, m]));
  const priorOf = new Map(prior.map((m) => [m.productId, m]));
  const ids = [...new Set([...curOf.keys(), ...priorOf.keys()])];
  if (ids.length === 0) {
    return (
      <tr>
        <td colSpan={3} className="mut sm">{W.reports.productMixNone}</td>
      </tr>
    );
  }
  // The server's own label (`c ?? p)?.label`) is the plain PDAS description,
  // which collides across materials; when the row names a real product,
  // prefer the disambiguated label built from the full product list.
  const nameOf = (id: number | null, row: ProductMixRow | undefined) => (id == null ? row?.label : (labels.get(id) ?? row?.label));
  return (
    <>
      {ids.map((id) => {
        const c = curOf.get(id);
        const p = priorOf.get(id);
        // RT-018: either period's own row can carry the retired flag —
        // PDAS's MaterialActive is a CURRENT fact, not a per-period one, so
        // the two rows for the same product always agree; either suffices.
        const retired = (c ?? p)?.productActive === false;
        return (
          <tr key={id ?? 'none'}>
            <td>
              {nameOf(id, c ?? p)}
              {retired && <span className="mut sm" style={{ marginLeft: 6 }}>{W.retiredProduct.marker}</span>}
            </td>
            <td className="n">{c ? fmtInt(c.cones) : '—'}</td>
            <td className="n">{p ? fmtInt(p.cones) : '—'}</td>
          </tr>
        );
      })}
    </>
  );
}
