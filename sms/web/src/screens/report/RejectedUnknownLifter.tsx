/**
 * Rejected Unknown (Lifter) Report (IFL report 8).
 *
 * The DEFINITION is a draft (IFL has not defined "unknown (lifter)"): a reject
 * with no lifter number or no winder number recorded, and nothing else. The
 * screen therefore states it in the note and the "Assumed until IFL confirms"
 * block rather than presenting it as IFL's. A zero reason code is NOT an
 * unknown lifter (orchestrator decision, 1 Oct 2026): it is counted in table A
 * and listed in its own, separately titled list. Four blocks, over
 * api/src/services/reports/rejectedUnknownLifter.ts:
 *
 *  A. Rejects by lifter (1 to 14, then "No lifter recorded" when it has any):
 *     cones, inspected, quality rejects, of which with a zero reason code, weight
 *     rejects, total, rate.
 *  B. The rejects with no lifter or no winder recorded, each with why; when
 *     there are none the page says so in one sentence instead of printing a
 *     table of zeros.
 *  B2. The rejects with a zero reason code, a separate list headed "meaning not
 *     confirmed by IFL".
 *  C. The zeroed-clock records (stamped 1970): no period can reach them, so
 *     this block is for the period's own data batch whatever period is chosen.
 *
 * Prints portrait: the root carries data-report-orientation="portrait" (app.css [IFL HOUSE STYLE] contract).
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtClockSec, fmtInt } from '../../lib/fmt';
import type { LifterRow, RejectedUnknownLifterReportData, UnknownLifterReject } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports.rejectedUnknownLifter;
const S = W.iflReports;

/**
 * The payload this screen reads. Kept as a named alias (the component test imports it); every list below still tolerates an older or
 * partial payload — an absent list is an empty one, never a crash.
 */
export type RejectedUnknownLifterView = RejectedUnknownLifterReportData;

/** A rate to 2 dp ("0.04"), "—" when nothing was inspected. */
function fmtRate(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2);
}

function LifterCells({ r }: { r: LifterRow }) {
  return (
    <>
      <td className="n">{fmtInt(r.cones)}</td>
      <td className="n">{fmtInt(r.inspected)}</td>
      <td className="n">{fmtInt(r.qualityRejects)}</td>
      <td className="n">{fmtInt(r.zeroCodeRejects)}</td>
      <td className="n">{fmtInt(r.weightRejects)}</td>
      <td className="n">{fmtInt(r.total)}</td>
      <td className="n">{fmtRate(r.ratePct)}</td>
    </>
  );
}

/** The one table B and C share: a reject per row, with the reasons it is listed. */
function RejectTable({ rows }: { rows: UnknownLifterReject[] }) {
  return (
    <div className="tw">
      <table className="ifl-table">
        <thead>
          <tr>
            <th>{T.date}</th>
            <th>{T.time}</th>
            <th>{T.shift}</th>
            <th className="n">{T.hanger}</th>
            <th className="n">{T.lifter}</th>
            <th className="n">{T.winder}</th>
            <th>{T.type}</th>
            <th className="n">{T.tubeCode}</th>
            <th className="n">{T.materialCode}</th>
            <th className="n">{T.weightG}</th>
            <th>{T.why}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.producedAtUtc}-${i}`}>
              <td>{fmtDmy(r.date)}</td>
              <td>{fmtClockSec(r.producedAtUtc)}</td>
              <td>{W.shiftName[r.shift]}</td>
              <td className="n">{r.hanger ?? '—'}</td>
              <td className="n">{r.lifter ?? '—'}</td>
              <td className="n">{r.winder ?? '—'}</td>
              <td>{r.rejectType === 'weight' ? T.typeWeight : T.typeQuality}</td>
              <td className="n">{r.tubeCode ?? '—'}</td>
              <td className="n">{r.materialCode ?? '—'}</td>
              <td className="n">{r.weightG == null ? '—' : fmtInt(r.weightG)}</td>
              <td>{(r.why ?? []).join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RejectedUnknownLifterSection({ d }: { d: RejectedUnknownLifterView }) {
  // Every field read below tolerates an older or partial payload: an absent list is an empty one, never a crash.
  const lifters = d.lifters ?? [];
  const list = d.list ?? [];
  const zeroList = d.zeroCodeList ?? [];
  const zeroTotal = d.zeroCodeTotal ?? zeroList.length;
  const zeroed = d.zeroedClock ?? { generation: null, rows: [] };
  const listTotal = d.listTotal ?? list.length;
  const fault = d.excludedClockFault ?? 0;
  const hasData = lifters.length > 0 || (d.total?.inspected ?? 0) > 0;

  return (
    <div data-report-orientation="portrait">
      {hasData ? (
        <>
          <Block first label={T.tableTitle}>
            <div className="tw">
              <table className="ifl-table">
                <thead>
                  <tr>
                    <th className="n">{T.lifter}</th>
                    <th className="n">{T.cones}</th>
                    <th className="n">{T.inspected}</th>
                    <th className="n">{T.qualityRejects}</th>
                    <th className="n">{T.zeroCode}</th>
                    <th className="n">{T.weightRejects}</th>
                    <th className="n">{T.total}</th>
                    <th className="n">{T.ratePct}</th>
                  </tr>
                </thead>
                <tbody>
                  {lifters.map((r) => (
                    <tr key={r.lifter ?? 'none'}>
                      <td className="n">{r.lifter ?? T.noLifter}</td>
                      <LifterCells r={r} />
                    </tr>
                  ))}
                  {d.total ? (
                    <tr className="total">
                      <td className="n">{S.total}</td>
                      <LifterCells r={d.total} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {fault > 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{S.excludedClockFault(fmtInt(fault), fault !== 1)}</p> : null}
            {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
          </Block>
          {list.length === 0 ? (
            <Block label={T.noLifterListTitle}>
              <Empty message={T.allHaveLifter} />
            </Block>
          ) : (
            <Block label={T.noLifterListTitle}>
              <RejectTable rows={list} />
              {listTotal > list.length ? (
                <p className="mut sm" style={{ marginTop: 8 }}>{S.listCapped(fmtInt(list.length), fmtInt(listTotal))}</p>
              ) : null}
            </Block>
          )}
          {/* B2: a separate list; what a zero code means is not confirmed by IFL, so it is never mixed into B. */}
          <Block label={T.zeroCodeListTitle}>
            {zeroList.length === 0 ? (
              <Empty message={T.zeroCodeNone} />
            ) : (
              <>
                <p className="mut sm" style={{ marginBottom: 8 }}>{T.zeroCodeNote}</p>
                <RejectTable rows={zeroList} />
                {zeroTotal > zeroList.length ? (
                  <p className="mut sm" style={{ marginTop: 8 }}>{S.listCapped(fmtInt(zeroList.length), fmtInt(zeroTotal))}</p>
                ) : null}
              </>
            )}
          </Block>
        </>
      ) : (
        <Block first>
          <Empty message={T.empty} />
          {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
        </Block>
      )}
      {/* C: independent of the period, so it shows whenever the period resolved a data batch, and says which. */}
      {zeroed.generation != null || zeroed.rows.length > 0 ? (
        <Block label={T.zeroedTitle}>
          {zeroed.rows.length === 0 ? (
            <Empty message={T.zeroedNone} />
          ) : (
            <>
              <p className="mut sm" style={{ marginBottom: 8 }}>{T.zeroedNote(zeroed.generation ?? '—')}</p>
              <RejectTable rows={zeroed.rows} />
            </>
          )}
        </Block>
      ) : null}
      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
