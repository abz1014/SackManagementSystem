/**
 * Daily production report — the section set Report.tsx carried before
 * roadmap Phase 8, with the one thing wrong with it fixed: "Rejected" is
 * now TWO named figures, rejected by the scale and rejected at inspection,
 * which the old page printed under one word (gap analysis §10).
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt, fmtKg, fmtPct1, fmtSpan, describeMismatchHours } from '../../lib/fmt';
import type { PeriodParams } from '../../lib/period';
import type { DailyReportData, ReportLine } from '../../api';
import { DayBars, Fig, LineTable } from './shared';

export function DailySection({ d, onSelectPeriod }: { d: DailyReportData; onSelectPeriod?: (p: PeriodParams) => void }) {
  if (d.totals.cones === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  return (
    <>
      <Block first>
        <Totals t={d.totals} pops={d.rejectPopulations} />
      </Block>

      <Block label={W.report.conesPerDay} chartWide>
        <DayBars rows={d.byDay} chartId="report-daily-day-bars" onSelect={onSelectPeriod} />
        {d.downtime ? (
          <p className="g" style={{ marginTop: 18 }}>
            {W.report.timeLost(fmtSpan(d.downtime.stoppedSeconds), d.downtime.stoppageCount)}{' '}
            <span className="mut sm">({W.report.timeLostCaveat})</span>.
          </p>
        ) : (
          <p className="mut sm" style={{ marginTop: 18 }}>{W.reports.timeLostNotSplit}</p>
        )}
        <p className="mut sm" style={{ marginTop: 10 }}>{W.report.noSackStock}</p>
        <p className="mut sm" style={{ marginTop: 6 }}>{d.rejectPopulations.note}</p>
        {d.readings && (
          <p className="mut sm" style={{ marginTop: 6 }}>
            {W.cone.readingsSentence(fmtInt(d.totals.cones), fmtInt(d.readings.implausible))}
          </p>
        )}
        {d.shiftCheck && (
          <p className="mut sm" style={{ marginTop: 6 }}>
            {W.cone.shiftSentence(
              fmtInt(d.shiftCheck.mismatched),
              fmtInt(d.shiftCheck.compared),
              describeMismatchHours(d.shiftCheck.hours, d.shiftCheck.mismatched, d.shiftCheck.topHour),
            )}
          </p>
        )}
      </Block>

      <Block>
        <div className="two-col">
          <div>
            <p className="h2"><span>{W.report.byShift}</span></p>
            <div className="tw"><LineTable rows={d.byShift} head={W.report.colShift} /></div>
          </div>
          <div>
            <p className="h2"><span>{W.report.byDay}</span></p>
            <div className="tw"><LineTable rows={d.byDay} head={W.report.colDay} /></div>
          </div>
        </div>
      </Block>
    </>
  );
}

function Totals({ t, pops }: { t: ReportLine; pops: DailyReportData['rejectPopulations'] }) {
  return (
    <>
      <div className="figs four">
        <Fig v={fmtInt(t.cones)} u={W.fig.cones} n={t.conesInRangePct != null ? W.withinLimits(fmtPct1(t.conesInRangePct)) : null} />
        <Fig v={fmtInt(t.sacks)} u={W.fig.sacks} n={t.conesPerSack != null ? `${t.conesPerSack} ${W.report.perSack}` : null} />
        <Fig v={fmtInt(Math.round(t.sackWeightKg))} u={W.fig.kg} n={t.avgSackKg != null ? `${fmtKg(t.avgSackKg)} ${W.report.averageSack}` : null} />
        <Fig
          v={fmtInt(pops.atInspection)}
          u={W.reports.rejectedAtInspection.toLowerCase()}
          n={pops.atInspectionPct != null ? W.reports.ofInspected(fmtPct1(pops.atInspectionPct)) : null}
        />
      </div>
      <p className="mut sm" style={{ marginTop: 14 }}>
        {W.reports.rejectedByScale}: {fmtInt(pops.byScale)}
        {pops.byScalePct != null ? ` (${W.reports.ofConesWeighed(fmtPct1(pops.byScalePct))})` : ''}.
      </p>
    </>
  );
}
