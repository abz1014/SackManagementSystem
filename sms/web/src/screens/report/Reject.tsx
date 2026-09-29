/** Reject report: reasons, the per-day-per-reason table and the daily rate with its band. Roadmap Phase 8 (15 Sep 2026). */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt, fmtPct1 } from '../../lib/fmt';
import type { PeriodParams } from '../../lib/period';
import type { RejectReason, RejectReportData } from '../../api';
import { fmtDayShort, fmtPct, RejectTrendChart, type TrendBucket } from './shared';

/**
 * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.5
 * "a reject code → the days and readings behind it"): a Pareto bar on paper
 * named a reason but could not be followed to it. `onOpenCode` sends the
 * reader to the Rejects screen with that code selected — the same code param
 * (`jc`) the live screen's own Pareto bars set — carrying the period and the
 * station/product filters this report was already showing (`st`/`pr` are
 * shared, so they ride along automatically).
 */
export function RejectSection({
  d,
  onOpenCode,
  onSelectPeriod,
}: {
  d: RejectReportData;
  onOpenCode: (r: RejectReason) => void;
  /** Chart overhaul, Task T8b (29 Sep 2026): drag-select on the trend chart
   *  snaps the WHOLE PAGE period to shift boundaries. */
  onSelectPeriod?: (p: PeriodParams) => void;
}) {
  if (d.total === 0 && d.trend.every((t) => t.produced === 0)) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  return (
    <>
      <Block first>
        <div className="figs two">
          <div>
            <b className="fig-val">{fmtInt(d.total)}<span className="fig-unit">{W.reports.rejectedAtInspection.toLowerCase()}</span></b>
            {d.pBarPct != null && <span className="fig-note">{W.reports.pBar(fmtPct1(d.pBarPct))}</span>}
          </div>
          <div>
            <b className="fig-val">{fmtInt(d.trend.filter((t) => t.outOfControl).length)}<span className="fig-unit">days {W.reports.outOfControl}</span></b>
            <span className="fig-note">{d.trend.length} days</span>
          </div>
        </div>
        {d.unattributed && (
          <p className="mut sm" style={{ marginTop: 10 }}>{W.reports.rejectUnattributed(fmtInt(d.unattributed.rows), fmtInt(d.unattributed.of))}</p>
        )}
        {d.spansGenerations && <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.spansGenerations}</p>}
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>

      <Block label={W.reports.reasons}>
        {d.reasons.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <div className="bars">
            {d.reasons.map((r) => (
              <div key={`${r.rejectType}-${r.tubeCode}-${r.materialCode}`}>
                <button type="button" className="linkish" style={{ textAlign: 'left' }} onClick={() => onOpenCode(r)}>
                  {r.displayLabel}
                </button>
                <i style={{ width: `${Math.max(2, r.pct)}%`, background: 'var(--graphite)' }} />
                <em>{fmtInt(r.count)} · {fmtPct(r.pct)}</em>
                <em className="sm mut">{fmtPct(r.cumulativePct)} cum.</em>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block label={W.reports.trend} chartWide>
        {d.trend.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <>
            <RejectTrendChart
              quality={d.trend.map((t): TrendBucket => ({
                bucketTs: t.day,
                rate: t.ratePct == null ? null : t.ratePct / 100,
                ucl: t.uclPct == null ? null : t.uclPct / 100,
                lcl: t.lclPct == null ? null : t.lclPct / 100,
                outOfControl: t.outOfControl,
                produced: t.produced,
                rejects: t.rejects,
              }))}
              singleName={W.nav.rejects}
              ariaLabel={W.reports.trend}
              labelFmt={fmtDayShort}
              onSelect={onSelectPeriod}
            />
            {/*
             * The 40+ day table this report used to print in full is now the
             * chart above plus ONLY the days the chart marks out-of-control —
             * the days worth a second look on paper, not a digit-for-digit
             * transcript of every point the chart already draws.
             */}
            {d.trend.some((t) => t.outOfControl) ? (
              <div className="tw" style={{ marginTop: 18 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{W.reports.colDay}</th>
                      <th className="n">{W.reports.colCones}</th>
                      <th className="n">{W.reports.rejectedAtInspection}</th>
                      <th className="n">{W.reports.colRate}</th>
                      <th className="n">{W.reports.colBand}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.trend.filter((t) => t.outOfControl).map((t) => (
                      <tr key={t.day} className="hit">
                        <td>{fmtDayShort(t.day)}</td>
                        <td className="n">{fmtInt(t.produced)}</td>
                        <td className="n">{fmtInt(t.rejects)}</td>
                        <td className="n">{fmtPct(t.ratePct, 2)}</td>
                        <td className="n">{t.lclPct != null && t.uclPct != null ? `${fmtPct(t.lclPct, 2)} – ${fmtPct(t.uclPct, 2)}` : '—'}</td>
                        <td className="mut sm">{W.reports.outOfControl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mut sm" style={{ marginTop: 10 }}>{W.nothingHere}</p>
            )}
          </>
        )}
      </Block>

      <Block label={W.reports.byDayCode}>
        {d.byDayCode.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <div className="tw tw-span">
            <table>
              <thead>
                <tr>
                  <th>{W.reports.colDay}</th>
                  <th>{W.reports.colReason}</th>
                  <th className="n">{W.reports.colCount}</th>
                  <th className="n">{W.reports.colInspected}</th>
                  <th className="n">{W.reports.colRate}</th>
                </tr>
              </thead>
              <tbody>
                {d.byDayCode.map((r, i) => (
                  <tr key={`${r.day}-${r.rejectType}-${r.tubeCode}-${r.materialCode}-${i}`}>
                    <td>{fmtDayShort(r.day)}</td>
                    <td>{r.displayLabel}</td>
                    <td className="n">{fmtInt(r.count)}</td>
                    <td className="n">{fmtInt(r.inspected)}</td>
                    <td className="n">{fmtPct(r.ratePct)}</td>
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
