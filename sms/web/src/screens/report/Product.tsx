/** Product report: one row per product, and the unattributed sentence first. Roadmap Phase 8 (15 Sep 2026). */
import { useMemo } from 'react';
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt, fmtPct1 } from '../../lib/fmt';
import type { ProductOption, ProductReportData } from '../../api';
import { distinctProductLabels } from '../../lib/productLabel';
import { fmtG1, StateCells, StateHeads } from './shared';

export function ProductSection({ d, products }: { d: ProductReportData; products: ProductOption[] }) {
  const rows = d.rows.filter((r) => r.cones > 0 || r.rejectedCones > 0 || r.sacks > 0);
  // Six PDAS materials on this line share the description "205-IL0-SD";
  // the server's label is the plain description, so the parts that differ
  // are appended here from the product list, as the Rejects filter does.
  const labels = useMemo(() => distinctProductLabels(products), [products]);
  const nameOf = (r: ProductReportData['rows'][number]) => (r.productId == null ? r.productLabel : (labels.get(r.productId) ?? r.productLabel));
  if (rows.length === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  const u = d.unattributed;
  return (
    <>
      <Block first>
        <p className="g">
          {W.reports.unattributedSentence(fmtInt(u.cones), fmtInt(u.ofCones), fmtInt(u.rejects), fmtInt(u.ofRejects))}
        </p>
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>
      <Block label={W.reports.colProduct}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{W.reports.colProduct}</th>
                <th className="n">{W.report.colCones}</th>
                <th className="n">{W.reports.colInRange}</th>
                <th className="n">{W.reports.rejectedAtInspection}</th>
                <th className="n">{W.reports.colRate}</th>
                <th className="n">{W.report.colSacks}</th>
                <th className="n">{W.reports.colWeighed}</th>
                <th className="n">{W.reports.colMean}</th>
                <th className="n">{W.reports.colSpread}</th>
                <StateHeads />
                <th className="n">{W.reports.colExcluded}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId ?? 'none'}>
                  <td>{nameOf(r)}</td>
                  <td className="n">{fmtInt(r.cones)}</td>
                  <td className="n">{fmtPct1(r.conesInRangePct)}</td>
                  <td className="n">{fmtInt(r.rejectedCones)}</td>
                  <td className="n">{fmtPct1(r.rejectRatePct)}</td>
                  <td className="n">{fmtInt(r.sacks)}</td>
                  <td className="n">{fmtInt(r.weight.n)}</td>
                  <td className="n">{fmtG1(r.weight.avgG)}</td>
                  <td className="n">{fmtG1(r.weight.sdG)}</td>
                  <StateCells s={r.states} />
                  <td className="n">{fmtInt(r.implausible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}
