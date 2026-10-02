/**
 * Rejected Sack Report, daily (IFL report 2): four tables over the sack scale's
 * own verdict.
 *   A  per production date, the sacks weighed, the sacks the scale rejected and
 *      the share, under a Morning / Evening / Night column group and a day
 *      total; the period total closes the table;
 *   B  of the rejected sacks, how many carry an implausible weight (0 kg or a
 *      fault reading) and how many a plausible one;
 *   C  the weight range of the sacks the scale PASSED, per product: a stated
 *      fact about the readings, never a tolerance (IFL's data holds none);
 *   D  every rejected sack with its time, number, product, yarn count and weight.
 *
 * What the screen refuses to do: call any sack under- or over-weight, count a
 * sack with no scale verdict as a pass (it is named apart), attribute a sack to
 * a winder (the plant's one sack scale records none), or print a sack's time as
 * anything but the plant's insert time. The share is shown to two decimals so a
 * small one does not read as zero. Table A keeps two columns a shift, "Sacks" and
 * "Rejected (%)", so four column groups fit a portrait A4 page.
 *
 * Prints portrait: the root carries data-report-orientation="portrait"
 * (app.css [IFL HOUSE STYLE] contract). Every list is read defensively — a
 * payload that omits a field must not take the screen down.
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtClockSec, fmtInt } from '../../lib/fmt';
import type { RejectedSackCounts, RejectedSackShiftRow, RejectedSacksReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports.rejectedSacks;
const R = W.iflReports;

type ShiftKey = 'morning' | 'evening' | 'night';
const SHIFTS: readonly ShiftKey[] = ['morning', 'evening', 'night'];

/** A percentage value to two decimals, "—" when there is none. The unit is in the column heading. */
function pctCell(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toFixed(2);
}

/** A kilogram figure to two decimals (the scale weighs to 0.01 kg), "—" when there is none. */
function kgCell(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Sacks, then rejected with its share in brackets: the two cells of one shift (or day, or period) column group.
 * Two columns a group, not three, because a portrait A4 page holds four groups of two and not four groups of
 * three (the "Rejected" and "% rejected" headings are each wider than their figures).
 */
function CountCells({ c }: { c: RejectedSackCounts | null | undefined }) {
  if (!c) {
    return (
      <>
        <td className="n">—</td>
        <td className="n">—</td>
      </>
    );
  }
  return (
    <>
      <td className="n">{fmtInt(c.sacks)}</td>
      <td className="n">{c.rejectedPct == null ? fmtInt(c.rejected) : `${fmtInt(c.rejected)} (${pctCell(c.rejectedPct)}%)`}</td>
    </>
  );
}

function CountHeads() {
  return (
    <>
      <th className="n">{T.sacks}</th>
      <th className="n">{`${T.rejected} (%)`}</th>
    </>
  );
}

/** The period's sacks and rejects for one shift, summed over the rows (exact: counts add). */
function shiftTotal(rows: readonly RejectedSackShiftRow[], shift: ShiftKey): RejectedSackCounts | null {
  const mine = rows.filter((r) => r.shift === shift);
  if (mine.length === 0) return null;
  const sacks = mine.reduce((a, r) => a + r.sacks, 0);
  const rejected = mine.reduce((a, r) => a + r.rejected, 0);
  return { sacks, rejected, rejectedPct: sacks > 0 ? Math.round((10000 * rejected) / sacks) / 100 : null };
}

export function RejectedSacksSection({ d }: { d: RejectedSacksReportData }) {
  const byShift = d.byShift ?? [];
  const byDay = d.byDay ?? [];
  const total = d.total;
  const list = d.list ?? [];
  const passed = d.passedRange;
  const byProduct = passed?.byProduct ?? [];
  const split = d.rejectedSplit;
  const fault = d.excludedClockFault ?? 0;

  if ((total?.sacks ?? 0) === 0 && byShift.length === 0) {
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

  // Only the shifts the period holds get a column group: a one-shift filter must not print two empty groups.
  const shifts = SHIFTS.filter((s) => byShift.some((r) => r.shift === s));
  const dates = [...new Set([...byDay.map((r) => r.date), ...byShift.map((r) => r.date)])].sort();
  const cellOf = (date: string, shift: ShiftKey) => byShift.find((r) => r.date === date && r.shift === shift) ?? null;
  const dayOf = (date: string) => byDay.find((r) => r.date === date) ?? null;

  const rejected = total?.rejected ?? 0;
  const noFlag = total?.noFlag ?? 0;
  const listTotal = d.listTotal ?? list.length;
  const hasPassed = byProduct.length > 0 || (passed?.all?.sacks ?? 0) > 0;

  return (
    <div data-report-orientation="portrait">
      <Block first label={T.byDayTitle}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th rowSpan={2}>{T.date}</th>
                {shifts.map((s) => <th key={s} colSpan={2}>{W.shiftName[s] ?? s}</th>)}
                <th colSpan={2}>{R.dayTotal}</th>
              </tr>
              <tr>
                {shifts.map((s) => <CountHeads key={s} />)}
                <CountHeads />
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <tr key={date}>
                  <td>{fmtDmy(date)}</td>
                  {shifts.map((s) => <CountCells key={s} c={cellOf(date, s)} />)}
                  <CountCells c={dayOf(date)} />
                </tr>
              ))}
              <tr className="total">
                <td>{T.periodTotal}</td>
                {shifts.map((s) => <CountCells key={s} c={shiftTotal(byShift, s)} />)}
                <CountCells c={total} />
              </tr>
            </tbody>
          </table>
        </div>
        {noFlag > 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{T.noFlagNote(fmtInt(noFlag))}</p> : null}
        {rejected === 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{T.noneRejected}</p> : null}
        {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
      </Block>

      {rejected > 0 && split ? (
        <Block label={T.splitTitle}>
          <div className="tw" style={{ breakInside: 'avoid' }}>
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.rejected}</th>
                  <th className="n">{T.sacks}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="total">
                  <td>{T.splitRejected}</td>
                  <td className="n">{fmtInt(rejected)}</td>
                </tr>
                <tr>
                  <td>{T.splitImplausible}</td>
                  <td className="n">{fmtInt(split.implausible)}</td>
                </tr>
                <tr>
                  <td>{T.splitPlausible}</td>
                  <td className="n">{fmtInt(split.plausible)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}

      {hasPassed ? (
        <Block label={T.passedTitle}>
          <p className="mut sm" style={{ margin: '0 0 8px' }}>{T.passedNote}</p>
          <div className="tw" style={{ breakInside: 'avoid' }}>
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.product}</th>
                  <th>{T.yarnCount}</th>
                  <th className="n">{T.passedSacks}</th>
                  <th className="n">{T.minKg}</th>
                  <th className="n">{T.maxKg}</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map((p) => (
                  <tr key={p.productId ?? 'none'}>
                    <td>{p.productId == null ? T.noProduct : p.productLabel}</td>
                    <td>{p.yarnCount ?? '—'}</td>
                    <td className="n">{fmtInt(p.sacks)}</td>
                    <td className="n">{kgCell(p.minKg)}</td>
                    <td className="n">{kgCell(p.maxKg)}</td>
                  </tr>
                ))}
                {passed?.all ? (
                  <tr className="total">
                    <td colSpan={2}>{R.total}</td>
                    <td className="n">{fmtInt(passed.all.sacks)}</td>
                    <td className="n">{kgCell(passed.all.minKg)}</td>
                    <td className="n">{kgCell(passed.all.maxKg)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}

      {rejected > 0 ? (
        <Block label={T.listTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.date}</th>
                  <th>{T.shift}</th>
                  <th>{T.time}</th>
                  <th className="n">{T.sackNo}</th>
                  <th>{T.product}</th>
                  <th>{T.yarnCount}</th>
                  <th className="n">{T.weightKg}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={`${r.producedAtUtc}-${i}`}>
                    <td>{fmtDmy(r.date)}</td>
                    <td>{W.shiftName[r.shift] ?? r.shift}</td>
                    <td>{fmtClockSec(r.producedAtUtc)}</td>
                    <td className="n">{r.sackNum ?? '—'}</td>
                    <td>{r.productId == null ? T.noProduct : (r.productLabel ?? `${T.materialId} ${r.productId}`)}</td>
                    <td>{r.yarnCount ?? '—'}</td>
                    <td className="n">
                      {kgCell(r.weightKg)}
                      {r.implausible ? <div className="mut sm">{T.implausibleMark}</div> : null}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>{T.splitRejected}</td>
                  <td className="n">{fmtInt(listTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {listTotal > list.length ? <p className="mut sm" style={{ marginTop: 8 }}>{R.listCapped(fmtInt(list.length), fmtInt(listTotal))}</p> : null}
          {fault > 0 ? <p className="mut sm" style={{ marginTop: 8 }}>{R.excludedClockFault(fmtInt(fault), fault !== 1)}</p> : null}
        </Block>
      ) : fault > 0 ? (
        <Block label={T.listTitle}>
          <p className="mut sm">{R.excludedClockFault(fmtInt(fault), fault !== 1)}</p>
        </Block>
      ) : null}

      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
