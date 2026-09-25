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
import { DeviationBars, fmtG1, fmtSignedG, type DeviationRow } from './shared';

export function CalibrationSection({ d, names }: { d: CalibrationReportData; names: StationRow[] }) {
  const nameOf = (n: number | null) => (n == null ? W.reports.wholeLine : stationLabel(names.find((s) => s.stationId === n), n));
  // This report's own subject is drift against TARGET (not against the
  // line), so the bar is `vsTargetG` — the same column the table already
  // prints — with the reference lines at the same `thresholdG` that feeds
  // the "flagged" column.
  const devRows: DeviationRow[] = d.stations
    .filter((s) => s.vsTargetG != null)
    .map((s) => ({
      key: String(s.station),
      label: nameOf(s.station),
      value: s.vsTargetG as number,
      flagged: s.flagged,
    }));
  return (
    <>
      <Block first>
        {d.stations.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : (
          <>
            <p className="g">
              {/* WS-OR (23 Sep 2026 red-team remediation, missingField.fuzz.test.tsx):
                  no null guard here meant a stripped `flaggedStationCount` on an
                  otherwise-real 200 fell through `n === 1` to the else branch and
                  printed the literal "undefined stations flagged for drift" — the
                  same "state the absence, never a number" rule Line.tsx's
                  `fig.couldNotRead` and Weight.tsx's `countCouldNotRead` already
                  apply elsewhere, reworded as a full sentence for this summary. */}
              {d.flaggedStationCount != null ? W.reports.stationsFlagged(d.flaggedStationCount) : W.reports.stationsFlaggedUnknown} · {W.reports.lineMean(fmtG1(d.lineMeanG))}
              {d.targetG != null ? ` · ${W.reports.target(fmtG1(d.targetG), d.productLabel ?? '')}` : ` · ${W.reports.noTarget}`}
            </p>
            <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
          </>
        )}
      </Block>

      {d.stations.length > 0 && (
        <Block label={W.reports.colStation}>
          <DeviationBars
            rows={devRows}
            ariaLabel={W.report.deviationScale(W.reports.colVsTarget, 'g')}
            threshold={d.thresholdG}
            thresholdLabel={W.report.refLineThreshold(fmtSignedG(d.thresholdG))}
            zeroLabel={W.report.refLineZero}
          />
          {/* UX overflow sweep (23 Sep 2026): ten columns needed 969px of an
              816px content column — the same `.tw` overflow-x:auto shape
              found on Weight's station table (Weight.tsx's own note on this
              date). `table-layout: fixed` plus a `<colgroup>` (Weight's
              pattern, reused rather than reinvented) fits it without
              dropping a column; "Last adjusted" wraps to two lines on its
              17%-wide column instead of forcing the table wider. */}
          <div className="tw tw-span">
            <table className="calib-tbl">
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
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
  /**
   * The report's own ledger is the spine; the richer route only DECORATES it
   * — friction audit F5, 23 Sep 2026.
   *
   * This used to filter the richer route's rows by the report's ids and
   * render THAT list. Two things went wrong at once and the table showed five
   * headers over zero rows with no message, while the CSV for the same period
   * carried the adjustment:
   *
   *   1. `/api/reports/calibration` returns `adjustmentId: 4` (number) and
   *      `/api/calibration/adjustments` returns `"4"` (string), so the
   *      cross-route match was `own.has("4")` against number keys — always
   *      false, and the filtered list was always empty. Both sides are keyed
   *      through `String()` here so the id's wire type cannot decide whether
   *      a row is shown. (The API's id type still wants settling so this
   *      cannot recur elsewhere — reported, not fixed here.)
   *   2. The empty-state guard tested `d.adjustments`, the report's ledger,
   *      which was NOT empty — so the "no adjustments" sentence never fired
   *      for a table that was rendering nothing.
   *
   * Iterating the report's own rows fixes both by construction: the table can
   * never be emptier than the ledger the guard tests, it stays bounded to the
   * report's period (a route that ignored from/to still cannot widen it), and
   * a row the richer call does not know about keeps its place with "—" in the
   * two detail columns instead of vanishing.
   */
  const detailById = p9.data
    ? new Map<string, CalibrationAdjustment>(p9.data.adjustments.map((a) => [String(a.adjustmentId), a]))
    : null;
  const rows = d.adjustments.map((a) => ({ a, detail: detailById?.get(String(a.adjustmentId)) ?? null }));
  const rich = rows.some((r) => r.detail != null);
  const detailsMissing = p9.error != null && !p9.data;

  return (
    <Block label={W.reports.adjustments}>
      {p9.loading && !p9.data && !p9.error ? (
        <SkelLines n={3} />
      ) : rows.length === 0 ? (
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
                {rows.map(({ a, detail }) => (
                  <tr key={String(a.adjustmentId)}>
                    {/* An app-written instant (genuine UTC): the viewer's zone, never the plant formatters. */}
                    <td>{fmtAppInstant(a.adjustedAtUtc)}</td>
                    <td>{nameOf(a.stationId)}</td>
                    <td className="n">{fmtSignedG(a.amountG)}</td>
                    {rich && <td className="n">{detail ? fmtG1(detail.beforeG) : '—'}</td>}
                    {rich && <td className="n">{detail ? fmtG1(detail.afterG) : '—'}</td>}
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
