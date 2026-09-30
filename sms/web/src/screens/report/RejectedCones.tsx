/** Rejected Cones report (IFL SSRS style, 30 Sep 2026): the weight-rejected cones, then the weight range. */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { RejectedConesReportData } from '../../api';
import { fmtDmy } from './PrintHead';

/** Grams to 2 dp with thousands separators, "—" when unknown. */
export function fmtG2(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const T = W.iflReports;

export function RejectedConesSection({ d }: { d: RejectedConesReportData }) {
  const wr = d.weightRange;
  if (d.list.length === 0 && wr.line.n === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  return (
    <div data-report-orientation="portrait">
      <Block first label={T.rejectedCones}>
        {d.list.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.productionDate}</th>
                  <th>{T.shift}</th>
                  <th className="n">{T.winderNo}</th>
                  <th className="n">{T.weightG}</th>
                </tr>
              </thead>
              <tbody>
                {d.list.map((r, i) => (
                  <tr key={`${r.producedAtUtc}-${i}`}>
                    <td>{fmtDmy(r.date)}</td>
                    <td>{W.shiftName[r.shift]}</td>
                    <td className="n">{r.winder ?? '—'}</td>
                    <td className="n">{fmtG2(r.weightG)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>{T.totalRejectedCones}</td>
                  <td className="n">{fmtInt(d.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p>
      </Block>
      <Block label={T.weightRange}>
        <div className="tw" style={{ breakInside: 'avoid' }}>
          <table className="ifl-table">
            <thead>
              <tr>
                <th className="n">{T.winder}</th>
                <th className="n">{T.minG}</th>
                <th className="n">{T.maxG}</th>
                <th className="n">{T.avgG}</th>
                <th className="n">{T.n}</th>
              </tr>
            </thead>
            <tbody>
              {wr.byWinder.map((w) => (
                <tr key={w.winder}>
                  <td className="n">{w.winder}</td>
                  <td className="n">{fmtG2(w.minG)}</td>
                  <td className="n">{fmtG2(w.maxG)}</td>
                  <td className="n">{fmtG2(w.avgG)}</td>
                  <td className="n">{fmtInt(w.n)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>{T.line}</td>
                <td className="n">{fmtG2(wr.line.minG)}</td>
                <td className="n">{fmtG2(wr.line.maxG)}</td>
                <td className="n">{fmtG2(wr.line.avgG)}</td>
                <td className="n">{fmtInt(wr.line.n)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {wr.excludedImplausible > 0 && (
          <p className="mut sm" style={{ marginTop: 8 }}>
            {T.implausible(fmtInt(wr.excludedImplausible), fmtInt(wr.plausibility.loG), fmtInt(wr.plausibility.hiG))}
          </p>
        )}
      </Block>
    </div>
  );
}
