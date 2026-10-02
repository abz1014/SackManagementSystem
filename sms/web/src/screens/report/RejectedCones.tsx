/**
 * List of Rejected Cones Against Weight (IFL report 6): one row per weight
 * reject with its time of day on the plant clock, winder, hanger, weight, the
 * product and the limits that were in force when that cone was weighed, and how
 * far outside them it was; then the weight range per winder.
 *
 * What the screen refuses to do: state limits the record does not hold. A row
 * with no product recorded at its time, or a product with no limits, prints the
 * server's own words (`noLimitsReason`) and no distance; limits taken from the
 * oldest known version for a reject that predates it carry "oldest on record"
 * and a footnote saying the limits in force may have differed. A distance of 0
 * reads "Inside the product's limits": the scale rejected the cone, and that is
 * a separate fact from the product's tolerance (one status vocabulary).
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtClockSec, fmtInt } from '../../lib/fmt';
import type { RejectedConeRow, RejectedConesReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

/** Grams to 2 dp with thousands separators, "—" when unknown. */
export function fmtG2(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const T = W.iflReports;
const L = T.rejectedConesList;

/** Signed grams outside the limits: "+25.00" above the upper limit, "−12.00" below the lower, words when inside. */
function outsideText(r: RejectedConeRow): string {
  if (r.outsideByG == null) return '—';
  if (r.outsideByG === 0) return L.insideLimits;
  return `${r.outsideByG > 0 ? '+' : '−'}${fmtG2(Math.abs(r.outsideByG))}`;
}

function LimitsCell({ r }: { r: RejectedConeRow }) {
  if (r.limits) {
    return (
      <td>
        {r.limits.label}
        {r.limits.lowerBound ? <span className="mut"> ({L.lowerBoundMark})</span> : null}
      </td>
    );
  }
  // A product with no limits says why; no product at all already said so in the product cell.
  return <td>{r.productLabel ? (r.noLimitsReason ?? L.noLimitsOnRecord) : '—'}</td>;
}

export function RejectedConesSection({ d }: { d: RejectedConesReportData }) {
  const wr = d.weightRange;
  const station = d.filters?.station ?? null;
  const fault = d.excludedClockFault ?? 0;
  const shown = d.list.length;
  const listTotal = d.listTotal ?? d.total;
  if (shown === 0 && wr.line.n === 0) {
    return (
      <div data-report-orientation="portrait">
        <Block first>
          <Empty message={W.nothingHere} />
          {fault > 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{T.excludedClockFault(fmtInt(fault), fault !== 1)}</p> : null}
          {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
        </Block>
        <PendingIfl lines={d.pendingIfl} />
      </div>
    );
  }
  // A station filter narrows the cones to one winder, so a "Line" row over them would be a wrong label on a right number.
  const rangeRows = station != null && !wr.byWinder.some((w) => w.winder === station)
    ? [{ winder: station, minG: null, maxG: null, avgG: null, n: 0 }]
    : wr.byWinder;
  return (
    <div data-report-orientation="portrait">
      <Block first label={T.rejectedCones}>
        {shown === 0 ? (
          <Empty message={L.empty} />
        ) : (
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.productionDate}</th>
                  <th>{T.shift}</th>
                  <th>{L.time}</th>
                  <th className="n">{T.winderNo}</th>
                  <th className="n">{L.hanger}</th>
                  <th className="n">{T.weightG}</th>
                  <th>{L.product}</th>
                  <th>{L.limits}</th>
                  <th className="n">{L.outsideBy}</th>
                </tr>
              </thead>
              <tbody>
                {d.list.map((r, i) => (
                  <tr key={`${r.producedAtUtc}-${i}`}>
                    <td>{fmtDmy(r.date)}</td>
                    <td>{W.shiftName[r.shift]}</td>
                    <td>{fmtClockSec(r.producedAtUtc)}</td>
                    <td className="n">{r.winder ?? '—'}</td>
                    <td className="n">{r.hanger ?? '—'}</td>
                    <td className="n">{fmtG2(r.weightG)}</td>
                    <td>
                      {r.productLabel ?? r.noLimitsReason ?? '—'}
                      {r.productSource === 'timeline' ? <div className="mut sm">{L.sourceTimeline}</div> : null}
                    </td>
                    <LimitsCell r={r} />
                    <td className="n">{outsideText(r)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={5}>{T.totalRejectedCones}</td>
                  <td className="n">{fmtInt(d.total)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {listTotal > shown ? <p className="mut sm" style={{ marginTop: 8 }}>{T.listCapped(fmtInt(shown), fmtInt(listTotal))}</p> : null}
        {d.list.some((r) => r.limits?.lowerBound) ? <p className="mut sm" style={{ marginTop: 8 }}>{L.lowerBoundNote}</p> : null}
        {fault > 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{T.excludedClockFault(fmtInt(fault), fault !== 1)}</p> : null}
        {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
      </Block>
      <Block label={L.byWinderTitle}>
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
              {rangeRows.map((w) => (
                <tr key={w.winder}>
                  <td className="n">{w.winder}</td>
                  <td className="n">{fmtG2(w.minG)}</td>
                  <td className="n">{fmtG2(w.maxG)}</td>
                  <td className="n">{fmtG2(w.avgG)}</td>
                  <td className="n">{fmtInt(w.n)}</td>
                </tr>
              ))}
              {station == null ? (
                <tr className="total">
                  <td>{T.line}</td>
                  <td className="n">{fmtG2(wr.line.minG)}</td>
                  <td className="n">{fmtG2(wr.line.maxG)}</td>
                  <td className="n">{fmtG2(wr.line.avgG)}</td>
                  <td className="n">{fmtInt(wr.line.n)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {wr.excludedImplausible > 0 && (
          <p className="mut sm" style={{ marginTop: 8 }}>
            {T.implausible(fmtInt(wr.excludedImplausible), fmtInt(wr.plausibility.loG), fmtInt(wr.plausibility.hiG))}
          </p>
        )}
      </Block>
      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
