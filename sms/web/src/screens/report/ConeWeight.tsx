/** Cone weight report: mean, median, spread, states, the distribution and the stations. Roadmap Phase 8 (15 Sep 2026). */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import { stationLabel, type ConeWeightReportData, type StationRow } from '../../api';
import { fmtG1, fmtSignedG, Histogram, statesLine } from './shared';

export function ConeWeightSection({ d, names }: { d: ConeWeightReportData; names: StationRow[] }) {
  if (d.cones === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  const nameOf = (n: number) => stationLabel(names.find((s) => s.stationId === n), n);
  return (
    <>
      <Block first>
        <div className="figs">
          <div>
            <b className="fig-val">{d.meanG == null ? '—' : Math.round(d.meanG).toLocaleString('en-US')}<span className="fig-unit">g {W.reports.meanLabel}</span></b>
            <span className="fig-note">{W.reports.target(fmtG1(d.target.setpointG), d.target.label ?? d.target.source)}</span>
          </div>
          <div>
            <b className="fig-val">{d.medianG == null ? '—' : Math.round(d.medianG).toLocaleString('en-US')}<span className="fig-unit">g {W.reports.medianLabel}</span></b>
            {d.medianSource === 'report_query' && <span className="fig-note">{W.reports.medianFromReport}</span>}
          </div>
          <div>
            <b className="fig-val">{d.sdG == null ? '—' : d.sdG.toFixed(1)}<span className="fig-unit">g {W.reports.spreadLabel}</span></b>
            <span className="fig-note">{W.reports.minMax(fmtG1(d.minG), fmtG1(d.maxG))}</span>
          </div>
        </div>
        <p className="mut sm" style={{ marginTop: 14 }}>{W.reports.readingsExcluded(fmtInt(d.cones), fmtInt(d.implausible))}.</p>
        {d.states && <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.states}: {statesLine(d.states)}.</p>}
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>

      <Block label={W.reports.histogram(d.bucketSizeG)}>
        <Histogram buckets={d.histogram} unit="" label={W.reports.histogram(d.bucketSizeG)} />
      </Block>

      <Block label={W.reports.byStation} note={W.reports.lineMean(fmtG1(d.lineMeanG))}>
        {d.byStation.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{W.reports.colStation}</th>
                  <th className="n">{W.reports.colWeighed}</th>
                  <th className="n">{W.reports.colMean}</th>
                  <th className="n">{W.reports.colVsLine}</th>
                  <th className="n">{W.reports.colVsTarget}</th>
                  <th>{W.reports.colFlagged}</th>
                </tr>
              </thead>
              <tbody>
                {d.byStation.map((s) => (
                  <tr key={s.station}>
                    <td>{nameOf(s.station)}</td>
                    <td className="n">{fmtInt(s.n)}</td>
                    <td className="n">{fmtG1(s.meanG)}</td>
                    <td className="n">{fmtSignedG(s.vsLineG)}</td>
                    <td className="n">{fmtSignedG(s.vsTargetG)}</td>
                    <td>{s.flagged ? W.reports.flaggedYes : W.reports.flaggedNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </>
  );
}
