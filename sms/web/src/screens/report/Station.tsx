/** Machine / station report: the one station ranking, on paper. Roadmap Phase 8 (15 Sep 2026). */
import { W } from '../../lib/words';
import { Block, Chevron, Empty, rowKeys } from '../../ui/bits';
import { fmtInt, fmtPct1 } from '../../lib/fmt';
import { stationLabel, type StationReportData, type StationRow } from '../../api';
import { DeviationBars, fmtAppInstantDmy, fmtG1, fmtSignedG, StateCells, StateHeads, type DeviationRow } from './shared';

/**
 * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.6):
 * a row on paper was a dead end — the same finding was one click from
 * evidence on Weight's identical table, but not here. `onOpen` opens the
 * station sheet over this report, carrying nothing but the station id: the
 * sheet reads its own period from the URL's global period, not from this
 * report's (possibly different) range, exactly as Weight's table does.
 */
export function StationSection({ d, names, onOpen }: { d: StationReportData; names: StationRow[]; onOpen: (station: number) => void }) {
  if (d.rows.length === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  const nameOf = (n: number) => stationLabel(names.find((s) => s.stationId === n), n);
  // RT-018: the line-wide target may be a product PDAS has retired while
  // still carrying production — say so beside the figure this report leads
  // with, the same convention Weight.tsx and ConeWeight.tsx use.
  const targetNote =
    d.targetG != null
      ? `${W.reports.target(fmtG1(d.targetG), d.productLabel ?? '')}${d.productActive === false ? ` · ${W.retiredProduct.marker}` : ''}`
      : d.productLabel
        ? d.productLabel
        : W.reports.noTarget;
  // The bar IS `vsLineG`, already the "vs line" column; the threshold IS
  // `thresholdG`, already the input to the "flagged" column. Nothing new.
  const devRows: DeviationRow[] = d.rows.map((r) => ({
    key: String(r.station),
    label: nameOf(r.station),
    value: r.vsLineG ?? 0,
    flagged: r.flagged,
  }));
  return (
    <>
      <Block first>
        <p className="g">
          {W.reports.lineMean(fmtG1(d.lineMeanG))} · {targetNote}
          {d.lineRejectRatePct != null ? ` · ${W.reports.colRejectRate.toLowerCase()} ${fmtPct1(d.lineRejectRatePct)}` : ''}
        </p>
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>
      <Block label={W.reports.colStation}>
        <DeviationBars
          rows={devRows}
          ariaLabel={W.report.deviationScale(W.reports.colVsLine, 'g')}
          threshold={d.thresholdG}
          thresholdLabel={W.report.refLineThreshold(fmtSignedG(d.thresholdG))}
          zeroLabel={W.report.refLineZero}
        />
        <div className="tw tw-span">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{W.reports.colStation}</th>
                <th className="n">{W.report.colCones}</th>
                <th className="n">{W.reports.colInRange}</th>
                <th className="n">{W.reports.colMean}</th>
                <th className="n">{W.reports.colVsLine}</th>
                <th className="n">{W.reports.colVsTarget}</th>
                <th className="n">{W.reports.colDaysHeld}</th>
                <th>{W.reports.colFlagged}</th>
                <th className="n">{W.reports.rejectedAtInspection}</th>
                <th className="n">{W.reports.colRejectRate}</th>
                <StateHeads />
                <th>{W.reports.colLastAdjusted}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr
                  key={r.station}
                  className="click"
                  tabIndex={0}
                  onClick={() => onOpen(r.station)}
                  onKeyDown={rowKeys(() => onOpen(r.station))}
                >
                  <td>
                    {nameOf(r.station)}
                    <Chevron label={W.openRecord} />
                  </td>
                  <td className="n">{fmtInt(r.cones)}</td>
                  <td className="n">{fmtPct1(r.conesInRangePct)}</td>
                  <td className="n">{fmtG1(r.meanG)}</td>
                  <td className="n">{fmtSignedG(r.vsLineG)}</td>
                  <td className="n">{fmtSignedG(r.vsTargetG)}</td>
                  <td className="n">{r.daysHeld}</td>
                  <td>{r.flagged ? W.reports.flaggedYes : W.reports.flaggedNo}</td>
                  <td className="n">{fmtInt(r.rejectedAtInspection)}</td>
                  <td className="n">{fmtPct1(r.rejectRatePct)}</td>
                  <StateCells s={r.states} />
                  {/* An app-written instant (genuine UTC), so the viewer's own zone, never the plant formatters. */}
                  <td>{r.lastAdjustedUtc ? fmtAppInstantDmy(r.lastAdjustedUtc) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}
