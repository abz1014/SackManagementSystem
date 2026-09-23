/** Cone weight report: mean, median, spread, states, the distribution and the stations. Roadmap Phase 8 (15 Sep 2026). */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtAppInstant, fmtInt } from '../../lib/fmt';
import { stationLabel, type ConeWeightReportData, type StationRow } from '../../api';
import { fmtG1, fmtSignedG, Histogram, statesLine } from './shared';

/** See the note at the render site: on the wire since `71ac170`, not yet on api.ts's own type. */
type TargetExtras = { omittedReason?: string | null; inForceIsLowerBound?: boolean };
const targetOmittedReason = (t: ConeWeightReportData['target']): string | null => {
  const r = (t as TargetExtras).omittedReason;
  return typeof r === 'string' && r.length > 0 ? r : null;
};
const targetIsLowerBound = (t: ConeWeightReportData['target']): boolean =>
  (t as TargetExtras).inForceIsLowerBound === true;

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
            {/* F6 (23 Sep 2026), two corrections in one tile.
                (1) `targetNone` — "No product was in force at the end of this
                period" — was printed for BOTH reasons a target can be absent.
                On epoch 9 (5-20 Aug) a product WAS in force (id 12,
                201-IH0-SD); what is missing is any record of its tolerance
                then. coneWeight.ts has published the true reason as
                `target.omittedReason` since `71ac170` and nothing rendered it,
                so the one case the fix was written for printed a sentence
                that is false. The resolver's sentence wins when there is one;
                `targetNone` survives for the genuine no-product case.
                (2) `targetSince` asserts a start date. Every limits version
                on this system is a migration-027 bootstrap marked
                `effective_is_lower_bound`, so the instant is a lower bound,
                and Weight.tsx:279 already says "no later than" for the
                identical fact. This tile said "in force since". */}
            {/* Both fields are read LOOSELY off the wire object rather than
                through api.ts's ConeWeightReportData: api.ts carries another
                worker's in-flight change today, so declaring them there would
                have swept their unfinished hunks into this commit. Both have
                been on the wire since `71ac170` (coneWeight.ts's `target`).
                Reported: they belong on that interface once the tree settles. */}
            {d.target.source === 'none' ? (
              <span className="fig-note">{targetOmittedReason(d.target) ?? W.reports.targetNone}</span>
            ) : (
              <span className="fig-note">
                {W.reports.target(fmtG1(d.target.setpointG), d.target.label ?? W.reports.wholeLine)}
                {d.target.inForceAtUtc &&
                  ` · ${
                    targetIsLowerBound(d.target)
                      ? W.reports.targetNoLaterThan(fmtAppInstant(d.target.inForceAtUtc))
                      : W.reports.targetSince(fmtAppInstant(d.target.inForceAtUtc))
                  }`}
              </span>
            )}
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
        {d.target.limitsChangedInPeriod > 0 && (
          <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.limitsChangedInPeriod(d.target.limitsChangedInPeriod)}</p>
        )}
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
