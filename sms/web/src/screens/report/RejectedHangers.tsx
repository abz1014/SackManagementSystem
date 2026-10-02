/**
 * Rejected Cone Hangers Report (IFL report 7).
 *
 * Two tables over api/src/services/reports/rejectedHangers.ts:
 *  A. Rejects by hanger — cones, inspected, quality and weight rejects, total,
 *     rate and the flag. Only hangers with a reject are listed (the server's
 *     note says so); the "No hanger recorded" bucket is last. A hanger is
 *     marked "Stands out in this period" or "Too few cones to judge", in words
 *     and in bold, never by colour alone, and never as a verdict on the hanger.
 *     When too few hangers have enough cones, NO flag is raised and the screen
 *     says why in the server's own words.
 *  B. Every rejected cone, one row each, with the time of day on the plant
 *     clock. The screen shows the first 500; the export carries up to the
 *     report's own cap, and the footer says which.
 *
 * Prints portrait: the root carries data-report-orientation="portrait"
 * (app.css [IFL HOUSE STYLE] contract). Every field is read defensively: an
 * older or fuzzed payload without the table renders the empty state, not a
 * crash (IflScaffold.test.tsx feeds it exactly that).
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtClockSec, fmtInt } from '../../lib/fmt';
import type { RejectedHangerRow, RejectedHangersReportData } from '../../api';
import { PendingIfl } from './PendingIfl';
import { fmtDmy } from './PrintHead';
import { fmtG2 } from './RejectedCones';

const R = W.iflReports;
const T = R.rejectedHangers;

/** Rows of table B the screen (and so the print) shows; the export carries up to `listCap`. */
export const HANGER_LIST_SCREEN_ROWS = 500;

/** "12.29", "—" when the rate is unknown. */
const fmtRate = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2));

function FlagCell({ flag }: { flag: RejectedHangerRow['flag'] }) {
  if (flag === 'stands_out') return <td><strong>{T.standsOut}</strong></td>;
  if (flag === 'too_few') return <td className="mut">{T.tooFew}</td>;
  return <td />;
}

export function RejectedHangersSection({ d }: { d: RejectedHangersReportData }) {
  const hangers = d.hangers ?? [];
  const list = d.list ?? [];
  const listTotal = d.listTotal ?? list.length;
  const hasData = (d.total?.inspected ?? 0) > 0 || listTotal > 0;

  if (!hasData) {
    return (
      <div data-report-orientation="portrait">
        <Block first>
          <Empty message={T.empty} />
          {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
        </Block>
        <PendingIfl lines={d.pendingIfl} />
      </div>
    );
  }

  const fl = d.flagging;
  const cutByCap = listTotal > list.length;
  const shown = list.slice(0, HANGER_LIST_SCREEN_ROWS);
  const cutByScreen = shown.length < list.length;
  const clockFault = d.excludedClockFault ?? 0;

  return (
    <div data-report-orientation="portrait">
      <Block first label={T.tableTitle}>
        {hangers.length === 0 ? (
          <Empty message={T.noRejects} />
        ) : (
          <>
            {fl && (
              <p className="mut sm" style={{ marginBottom: 8 }}>
                {fl.canFlag
                  ? T.flagNote(fmtInt(fl.hangersJudged), `${fmtRate(fl.lineRatePct)}%`)
                  : fl.reason
                    ? `${T.cannotFlag}: ${fl.reason}.`
                    : `${T.cannotFlag}.`}
              </p>
            )}
            <div className="tw">
              <table className="ifl-table">
                <thead>
                  <tr>
                    <th className="n">{T.hanger}</th>
                    <th className="n">{T.cones}</th>
                    <th className="n">{T.inspected}</th>
                    <th className="n">{T.qualityRejects}</th>
                    <th className="n">{T.weightRejects}</th>
                    <th className="n">{T.total}</th>
                    <th className="n">{T.ratePct}</th>
                    <th>{T.flag}</th>
                  </tr>
                </thead>
                <tbody>
                  {hangers.map((h) => (
                    <tr key={h.hanger ?? 'none'}>
                      <td className="n">{h.hanger ?? T.noHanger}</td>
                      <td className="n">{fmtInt(h.cones)}</td>
                      <td className="n">{fmtInt(h.inspected)}</td>
                      <td className="n">{fmtInt(h.qualityRejects)}</td>
                      <td className="n">{fmtInt(h.weightRejects)}</td>
                      <td className="n">{fmtInt(h.total)}</td>
                      <td className="n">{fmtRate(h.ratePct)}</td>
                      <FlagCell flag={h.flag} />
                    </tr>
                  ))}
                  {d.total && (
                    <tr className="total">
                      <td className="n">{R.total}</td>
                      <td className="n">{fmtInt(d.total.cones)}</td>
                      <td className="n">{fmtInt(d.total.inspected)}</td>
                      <td className="n">{fmtInt(d.total.qualityRejects)}</td>
                      <td className="n">{fmtInt(d.total.weightRejects)}</td>
                      <td className="n">{fmtInt(d.total.total)}</td>
                      <td className="n">{fmtRate(d.total.ratePct)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mut sm" style={{ marginTop: 8 }}>{T.inspectedNote}</p>
          </>
        )}
        {d.note ? <p className="mut sm" style={{ marginTop: 4 }}>{d.note}</p> : null}
      </Block>

      {shown.length > 0 && (
        <Block label={T.listTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.date}</th>
                  <th>{T.time}</th>
                  <th>{T.shift}</th>
                  <th className="n">{T.hanger}</th>
                  <th className="n">{T.winder}</th>
                  <th>{T.type}</th>
                  <th>{T.reason}</th>
                  <th className="n">{T.weightG}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.producedAtUtc}-${i}`}>
                    <td>{fmtDmy(r.date)}</td>
                    <td>{fmtClockSec(r.producedAtUtc)}</td>
                    <td>{W.shiftName[r.shift]}</td>
                    <td className="n">{r.hanger ?? '—'}</td>
                    <td className="n">{r.winder ?? '—'}</td>
                    <td>{r.rejectType === 'weight' ? T.typeWeight : T.typeQuality}</td>
                    <td>{r.reason ?? '—'}</td>
                    <td className="n">{r.weightG == null ? '—' : fmtG2(r.weightG)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cutByCap ? (
            <p className="mut sm" style={{ marginTop: 8 }}>
              {T.showingCapped(fmtInt(shown.length), fmtInt(d.listCap), fmtInt(listTotal))}
            </p>
          ) : cutByScreen ? (
            <p className="mut sm" style={{ marginTop: 8 }}>{T.showing(fmtInt(shown.length), fmtInt(listTotal))}</p>
          ) : null}
          {clockFault > 0 && (
            <p className="mut sm" style={{ marginTop: 4 }}>{R.excludedClockFault(fmtInt(clockFault), clockFault !== 1)}</p>
          )}
        </Block>
      )}
      {shown.length === 0 && clockFault > 0 && (
        <Block label={T.listTitle}>
          <p className="mut sm">{R.excludedClockFault(fmtInt(clockFault), clockFault !== 1)}</p>
        </Block>
      )}
      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
