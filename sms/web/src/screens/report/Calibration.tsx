/**
 * Calibration report: per station the drift status and the days flagged,
 * and the adjustments logged in the period. Roadmap Phase 8 (15 Sep 2026).
 *
 * The adjustments table asks roadmap Phase 9's `/api/calibration/
 * adjustments?from&to&station` (api.ts `listAdjustments`) for the ledger
 * with its richer fields (before / after / product), and says the details
 * are not available yet when that call fails. The report's own
 * `adjustments` (a period-bounded ledger read the CSV carries) are the
 * fallback rows, so the page never prints an empty table because a route
 * was not there — and never prints rows from outside the period either.
 */
import { usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { Block, Empty, SkelLines } from '../../ui/bits';
import { fmtAppInstant, fmtInt } from '../../lib/fmt';
import { listAdjustments, stationLabel, type CalibrationAdjustment, type CalibrationReportData, type StationRow } from '../../api';
import { fmtG1, fmtSignedG } from './shared';

export function CalibrationSection({ d, names }: { d: CalibrationReportData; names: StationRow[] }) {
  const nameOf = (n: number | null) => (n == null ? W.reports.wholeLine : stationLabel(names.find((s) => s.stationId === n), n));
  return (
    <>
      <Block first>
        {d.stations.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <>
            <p className="g">
              {W.reports.stationsFlagged(d.flaggedStationCount)} · {W.reports.lineMean(fmtG1(d.lineMeanG))}
              {d.targetG != null ? ` · ${W.reports.target(fmtG1(d.targetG), d.productLabel ?? '')}` : ` · ${W.reports.noTarget}`}
            </p>
            <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
          </>
        )}
      </Block>

      {d.stations.length > 0 && (
        <Block label={W.reports.colStation}>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{W.reports.colStation}</th>
                  <th className="n">{W.reports.colWeighed}</th>
                  <th className="n">{W.reports.colMean}</th>
                  <th className="n">{W.reports.colVsLine}</th>
                  <th className="n">{W.reports.colVsTarget}</th>
                  <th className="n">{W.reports.colDaysHeld}</th>
                  <th>{W.reports.colFlagged}</th>
                  <th className="n">{W.reports.colDaysFlagged}</th>
                  <th className="n">{W.reports.colAdjustments}</th>
                  <th>{W.reports.colLastAdjusted}</th>
                </tr>
              </thead>
              <tbody>
                {d.stations.map((s) => (
                  <tr key={s.station}>
                    <td>{nameOf(s.station)}</td>
                    <td className="n">{fmtInt(s.n)}</td>
                    <td className="n">{fmtG1(s.meanG)}</td>
                    <td className="n">{fmtSignedG(s.vsLineG)}</td>
                    <td className="n">{fmtSignedG(s.vsTargetG)}</td>
                    <td className="n">{s.daysHeld}</td>
                    <td>{s.flagged ? W.reports.flaggedYes : W.reports.flaggedNo}</td>
                    <td className="n">{s.daysFlagged} / {s.daysWithData}</td>
                    <td className="n">{s.adjustmentsInPeriod}</td>
                    <td>{s.lastAdjustedUtc ? fmtAppInstant(s.lastAdjustedUtc) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      <AdjustmentsBlock d={d} nameOf={nameOf} />
    </>
  );
}

function AdjustmentsBlock({ d, nameOf }: { d: CalibrationReportData; nameOf: (n: number | null) => string }) {
  const { from, to } = d.period;
  const station = d.filters.station ?? null;
  const p9 = usePolling(() => listAdjustments({ from, to, station }), 5 * 60_000, `report-adjustments:${from}:${to}:${station ?? ''}`);
  // Phase 9's rows, kept to the period the report is bounded to (by id
  // against the report's own ledger read) so a route that ignored from/to
  // could never widen the table; the report's rows when the call failed.
  const own = new Map(d.adjustments.map((a) => [a.adjustmentId, a]));
  const rich: CalibrationAdjustment[] | null = p9.data
    ? p9.data.adjustments.filter((a) => own.has(a.adjustmentId))
    : null;
  const detailsMissing = p9.error != null && !p9.data;

  return (
    <Block label={W.reports.adjustments}>
      {p9.loading && !p9.data && !p9.error ? (
        <SkelLines n={3} />
      ) : d.adjustments.length === 0 ? (
        <p className="mut">{W.reports.noAdjustments}</p>
      ) : (
        <>
          {detailsMissing && <p className="mut sm" style={{ marginBottom: 10 }}>{W.reports.adjustmentsNotAvailable}</p>}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{W.reports.colWhen}</th>
                  <th>{W.reports.colStation}</th>
                  <th className="n">{W.reports.colAmount}</th>
                  {rich && <th className="n">{W.reports.colBefore}</th>}
                  {rich && <th className="n">{W.reports.colAfter}</th>}
                  <th>{W.reports.colReasonAdj}</th>
                  <th>{W.reports.colBy}</th>
                </tr>
              </thead>
              <tbody>
                {(rich ?? d.adjustments).map((a) => (
                  <tr key={a.adjustmentId}>
                    {/* An app-written instant (genuine UTC): the viewer's zone, never the plant formatters. */}
                    <td>{fmtAppInstant(a.adjustedAtUtc)}</td>
                    <td>{nameOf(a.stationId)}</td>
                    <td className="n">{fmtSignedG(a.amountG)}</td>
                    {rich && <td className="n">{fmtG1((a as CalibrationAdjustment).beforeG)}</td>}
                    {rich && <td className="n">{fmtG1((a as CalibrationAdjustment).afterG)}</td>}
                    <td>{a.reason ?? '—'}{a.note ? ` · ${a.note}` : ''}</td>
                    <td>{a.recordedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Block>
  );
}
