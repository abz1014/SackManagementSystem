/** Shift report: one section per shift, its totals and its day-by-day rows. Roadmap Phase 8 (15 Sep 2026). */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt, fmtKg, fmtPct1, describeMismatchHours } from '../../lib/fmt';
import type { ShiftReportData, ShiftSection as ShiftSectionData } from '../../api';
import { Fig, LineTable, DayBars } from './shared';

// A missing total (a stripped field on an otherwise-real payload) is UNKNOWN,
// not zero: `undefined > 0` is false, so treating a hole the same as a real
// 0 makes a shift with real non-zero rejectedCones/sacks/sackWeightKg render
// as Empty. A shift counts as having data when any of its KNOWN totals is
// non-zero; a missing field never by itself proves a shift was empty.
function shiftHasData(t: ShiftSectionData['totals']): boolean {
  const known = [t.cones, t.rejectedCones, t.sacks, t.sackWeightKg].filter((v): v is number => v != null);
  return known.some((v) => v > 0);
}

export function ShiftSection({ d }: { d: ShiftReportData }) {
  const any = d.shifts.some((s) => shiftHasData(s.totals));
  if (!any) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  return (
    <>
      {d.shifts.map((s, i) => (
        <OneShift key={s.shift} s={s} first={i === 0} />
      ))}
      <Block plain>
        <p className="mut sm">{d.timeLostNote}</p>
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
    </>
  );
}

function OneShift({ s, first }: { s: ShiftSectionData; first: boolean }) {
  const t = s.totals;
  const name = W.shiftName[s.shift];
  return (
    <Block first={first} label={W.reports.shiftSection(name)} note={`${s.coverage.daysWithData} of ${s.coverage.daysInPeriod} days`}>
      <div className="figs four">
        <Fig v={fmtInt(t.cones)} u={W.fig.cones} n={t.conesInRangePct != null ? W.withinLimits(fmtPct1(t.conesInRangePct)) : null} />
        <Fig v={fmtInt(t.sacks)} u={W.fig.sacks} n={t.conesPerSack != null ? `${t.conesPerSack} ${W.report.perSack}` : null} />
        <Fig v={fmtInt(Math.round(t.sackWeightKg))} u={W.fig.kg} n={t.avgSackKg != null ? `${fmtKg(t.avgSackKg)} ${W.report.averageSack}` : null} />
        <Fig v={fmtInt(t.rejectedCones)} u={W.reports.rejectedAtInspection.toLowerCase()} n={t.rejectRatePct != null ? W.reports.ofInspected(fmtPct1(t.rejectRatePct)) : null} />
      </div>
      <div style={{ marginTop: 18 }}>
        <DayBars rows={s.byDay} label={W.report.conesPerDayFor(name)} />
      </div>
      <div className="tw" style={{ marginTop: 18 }}>
        <LineTable rows={s.byDay} head={W.report.colDay} />
      </div>
      {s.readings && (
        <p className="mut sm" style={{ marginTop: 10 }}>
          {W.cone.readingsSentence(fmtInt(t.cones), fmtInt(s.readings.implausible))}
        </p>
      )}
    </Block>
  );
}
