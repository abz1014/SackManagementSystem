/**
 * SPS Sack Weight Range Report (IFL report 4): where the period's sacks fell by
 * weight, then how spread out they are.
 *
 * Table A — the weight bands. One row per band (0.1 kg wide, or 0.2 kg when the
 * range is wide), an open row at each end holding everything lighter or
 * heavier, and a row for sacks with no usable weight (0 kg, a fault reading).
 * Every row is split by the SCALE's own verdict — passed or rejected — and by
 * shift, with its total and its share of all sacks. A band includes its lower
 * edge and excludes its upper one (the report's note says so). There is no
 * target and no "good" band: IFL's data holds no sack target or tolerance, so
 * the screen states the weight range the scale passed as a recorded fact, never
 * as a limit.
 *
 * Table B — the spread: n, lightest, heaviest, range, average and sample
 * standard deviation, per production date and shift, then per shift, each closed
 * by the period. These are over sacks with a plausible weight only; the
 * footnote says how many a period left out.
 *
 * Prints portrait: the root carries data-report-orientation="portrait"
 * (app.css [IFL HOUSE STYLE] contract). Every list is read defensively — a
 * payload that omits a field must not take the screen down.
 */
import { Fragment } from 'react';
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { SackBandCounts, SackSpreadRow, SackWeightBand, SackWeightRangeReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports.sackWeightRange;

type ShiftKey = 'morning' | 'evening' | 'night';
const SHIFTS: readonly ShiftKey[] = ['morning', 'evening', 'night'];

/** A figure to `dp` places with thousands separators, "—" when there is none. The unit is in the column heading. */
function numCell(n: number | null | undefined, dp: number): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const ZERO: SackBandCounts = { passed: 0, rejected: 0, noFlag: 0, total: 0 };

/** A band's counts for one shift, tolerant of a payload that leaves a shift out. */
const shiftCounts = (b: SackWeightBand, s: ShiftKey): SackBandCounts => b.byShift?.[s] ?? ZERO;

/** The scale's two verdicts, side by side. */
function VerdictCells({ c }: { c: SackBandCounts }) {
  return (
    <>
      <td className="n">{fmtInt(c.passed)}</td>
      <td className="n">{fmtInt(c.rejected)}</td>
    </>
  );
}

function bandLabel(b: SackWeightBand): string {
  return b.kind === 'implausible' ? T.implausibleRow : b.label;
}

/** The cells every spread row shares, after its leading label cells. */
function SpreadCells({ r }: { r: SackSpreadRow }) {
  return (
    <>
      <td className="n">{fmtInt(r.n)}</td>
      <td className="n">{numCell(r.minKg, 2)}</td>
      <td className="n">{numCell(r.maxKg, 2)}</td>
      <td className="n">{numCell(r.rangeKg, 2)}</td>
      <td className="n">{numCell(r.avgKg, 2)}</td>
      <td className="n">{numCell(r.sdKg, 3)}</td>
    </>
  );
}

function SpreadHeads() {
  return (
    <>
      <th className="n">{T.n}</th>
      <th className="n">{T.minKg}</th>
      <th className="n">{T.maxKg}</th>
      <th className="n">{T.rangeKg}</th>
      <th className="n">{T.avgKg}</th>
      <th className="n">{T.sdKg}</th>
    </>
  );
}

export function SackWeightRangeSection({ d }: { d: SackWeightRangeReportData }) {
  const bands = d.bands ?? [];
  const byDayShift = d.spreadByDayShift ?? [];
  const byShift = d.spreadByShift ?? [];
  const spreadTotal = d.spreadTotal;

  if (bands.length === 0 && byDayShift.length === 0 && (spreadTotal?.n ?? 0) === 0) {
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

  // The closing row of table A: every band, the open rows and the implausible row together.
  const sumOf = (pick: (b: SackWeightBand) => SackBandCounts): SackBandCounts =>
    bands.reduce<SackBandCounts>((a, b) => {
      const c = pick(b);
      return { passed: a.passed + c.passed, rejected: a.rejected + c.rejected, noFlag: a.noFlag + c.noFlag, total: a.total + c.total };
    }, { ...ZERO });
  const total = sumOf((b) => b.total ?? ZERO);
  const shiftTotals = SHIFTS.map((s) => sumOf((b) => shiftCounts(b, s)));

  // Rows arrive date-then-shift; group them so a date reads once, over its shifts.
  const days: { date: string; rows: SackSpreadRow[] }[] = [];
  for (const r of byDayShift) {
    const g = days[days.length - 1];
    if (g && g.date === (r.date ?? '')) g.rows.push(r);
    else days.push({ date: r.date ?? '', rows: [r] });
  }

  const passed = d.passedRange;
  const implausible = d.implausibleSacks ?? 0;

  return (
    <div data-report-orientation="portrait">
      <Block first label={T.bandsTitle}>
        {passed ? (
          <p className="sm" style={{ margin: '0 0 4px' }}>
            {T.passedRangeLine(numCell(passed.minKg, 2), numCell(passed.maxKg, 2))}
          </p>
        ) : total.total > 0 ? (
          <p className="sm" style={{ margin: '0 0 4px' }}>{T.noPassed}</p>
        ) : null}
        <p className="mut sm" style={{ margin: '0 0 8px' }}>{T.bandWidthNote(numCell(d.bandKg, 1))}</p>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th rowSpan={2}>{T.band}</th>
                {SHIFTS.map((s) => <th key={s} colSpan={2}>{W.shiftName[s]}</th>)}
                <th rowSpan={2} className="n">{T.passed}</th>
                <th rowSpan={2} className="n">{T.rejected}</th>
                <th rowSpan={2} className="n">{T.total}</th>
                <th rowSpan={2} className="n">{T.share}</th>
              </tr>
              <tr>
                {SHIFTS.map((s) => (
                  <Fragment key={s}>
                    <th className="n">{T.passed}</th>
                    <th className="n">{T.rejected}</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={`${b.kind}-${i}`}>
                  <td>{bandLabel(b)}</td>
                  {SHIFTS.map((s) => <VerdictCells key={s} c={shiftCounts(b, s)} />)}
                  <td className="n">{fmtInt(b.total?.passed ?? 0)}</td>
                  <td className="n">{fmtInt(b.total?.rejected ?? 0)}</td>
                  <td className="n">{fmtInt(b.total?.total ?? 0)}</td>
                  <td className="n">{numCell(b.sharePct, 1)}</td>
                </tr>
              ))}
              {bands.length > 0 && (
                <tr className="total">
                  <td>{T.total}</td>
                  {shiftTotals.map((c, i) => <VerdictCells key={SHIFTS[i]} c={c} />)}
                  <td className="n">{fmtInt(total.passed)}</td>
                  <td className="n">{fmtInt(total.rejected)}</td>
                  <td className="n">{fmtInt(total.total)}</td>
                  <td className="n">{numCell(100, 1)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total.noFlag > 0 && (
          <p className="mut sm" style={{ marginTop: 8 }}>{W.iflReports.rejectedSacks.noFlagNote(fmtInt(total.noFlag))}</p>
        )}
        {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
      </Block>

      {byDayShift.length > 0 && (
        <Block label={T.spreadTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.date}</th>
                  <th>{T.shift}</th>
                  <SpreadHeads />
                </tr>
              </thead>
              {days.map((g) => (
                <tbody key={g.date} style={{ breakInside: 'avoid' }}>
                  {g.rows.map((r, i) => (
                    <tr key={r.shift ?? i}>
                      {i === 0 && <td rowSpan={g.rows.length}>{fmtDmy(g.date)}</td>}
                      <td>{r.shift ? (W.shiftName[r.shift] ?? r.shift) : '—'}</td>
                      <SpreadCells r={r} />
                    </tr>
                  ))}
                </tbody>
              ))}
              {spreadTotal && (
                <tbody>
                  <tr className="total">
                    <td colSpan={2}>{T.total}</td>
                    <SpreadCells r={spreadTotal} />
                  </tr>
                </tbody>
              )}
            </table>
          </div>
          <p className="mut sm" style={{ marginTop: 8 }}>
            {implausible > 0 ? W.iflReports.sackWeightSummary.excludedNote(fmtInt(implausible)) : T.spreadNote}
          </p>
        </Block>
      )}

      {byShift.length > 0 && (
        <Block label={T.spreadByShiftTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.shift}</th>
                  <SpreadHeads />
                </tr>
              </thead>
              <tbody>
                {byShift.map((r, i) => (
                  <tr key={r.shift ?? i}>
                    <td>{r.shift ? (W.shiftName[r.shift] ?? r.shift) : '—'}</td>
                    <SpreadCells r={r} />
                  </tr>
                ))}
                {spreadTotal && (
                  <tr className="total">
                    <td>{T.total}</td>
                    <SpreadCells r={spreadTotal} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
