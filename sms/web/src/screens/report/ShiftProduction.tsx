/**
 * Shift-wise CTS Loop Production Report (IFL report 1). IFL SSRS style, 30 Sep
 * 2026; rebuilt 1 Oct 2026 (task A-R1): each physical cone is counted ONCE
 * (a cone that was weighed and then rejected on weight is in Total as a reject,
 * not also as a pass), so the table carries Weighed beside Pass, and the weighed
 * kilograms. Three tables — the summary by shift, then every date, shift and
 * winder with a total per shift and per day, then each winder over the period —
 * and the sentences a reader needs to trust them: the loop, the scale's own
 * bit versus the weight-reject records, and the kg basis.
 *
 * Prints portrait: the root carries data-report-orientation="portrait".
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { ShiftProductionFigures, ShiftProductionReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports;
const S = T.shiftProduction;

/** Efficiency to 2 dp, "—" when unknown. */
export function fmtEff(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2);
}

/** Kilograms to 2 dp with thousands separators, "—" when no plausible weight was recorded (never "0"). */
export function fmtKg2(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Below 100 gets a light tint AND bold, so it still reads on black-and-white print.
function EffCell({ v }: { v: number | null }) {
  const low = v != null && v < 100;
  return (
    <td className={low ? 'n eff-low' : 'n'}>
      {fmtEff(v)}
    </td>
  );
}

/** Weighed, Pass, Weight rejects, Total, Efficiency, Weighed kg — the six figure columns every table shares. */
function FigureCells({ f }: { f: ShiftProductionFigures }) {
  return (
    <>
      <td className="n">{fmtInt(f.weighed)}</td>
      <td className="n">{fmtInt(f.pass)}</td>
      <td className="n">{fmtInt(f.weightRejects)}</td>
      <td className="n">{fmtInt(f.total)}</td>
      <EffCell v={f.efficiencyPct} />
      <td className="n">{fmtKg2(f.weighedKg)}</td>
    </>
  );
}

function FigureHeads() {
  return (
    <>
      <th className="n">{S.weighed}</th>
      <th className="n">{S.pass}</th>
      <th className="n">{T.weightRejShort}</th>
      <th className="n">{S.total}</th>
      <th className="n">{S.efficiency}</th>
      <th className="n">{S.weighedKg}</th>
    </>
  );
}

type Row = ShiftProductionReportData['rows'][number];
type Shift = Row['shift'];

export function ShiftProductionSection({ d }: { d: ShiftProductionReportData }) {
  if (d.grandTotal.total === 0 && d.rows.length === 0) {
    return (
      <div data-report-orientation="portrait">
        <Block first>
          <Empty message={S.empty} />
          {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
        </Block>
        <PendingIfl lines={d.pendingIfl} />
      </div>
    );
  }

  // The totals are the authority for which date and shift exist (a shift whose
  // cones all lack a winder has a total and no winder row); the winder rows hang off them.
  const rowsOf = new Map<string, Row[]>();
  for (const r of d.rows) {
    const k = `${r.date}|${r.shift}`;
    rowsOf.set(k, [...(rowsOf.get(k) ?? []), r]);
  }
  const days: { date: string; shifts: { shift: Shift; total: ShiftProductionFigures; rows: Row[] }[] }[] = [];
  for (const t of d.shiftTotals) {
    let day = days[days.length - 1];
    if (!day || day.date !== t.date) {
      day = { date: t.date, shifts: [] };
      days.push(day);
    }
    day.shifts.push({ shift: t.shift, total: t, rows: rowsOf.get(`${t.date}|${t.shift}`) ?? [] });
  }
  const dayTotalOf = (date: string) => (d.dayTotals ?? []).find((t) => t.date === date);
  const wo = d.withoutWinder;
  const hangers = d.loop?.hangersSeen ?? 0;

  return (
    <div data-report-orientation="portrait">
      <Block first label={S.byShiftTitle}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.shift}</th>
                <FigureHeads />
              </tr>
            </thead>
            <tbody>
              {d.summary.map((s) => (
                <tr key={s.shift}>
                  <td>{W.shiftName[s.shift]}</td>
                  <FigureCells f={s} />
                </tr>
              ))}
              <tr className="total">
                <td>{S.grandTotal}</td>
                <FigureCells f={d.grandTotal} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p>
        {hangers > 0 && <p className="mut sm" style={{ marginTop: 4 }}>{S.loopLine(fmtInt(hangers), hangers === 1)}</p>}
        {typeof d.scaleRejectedCones === 'number' && (
          <p className="mut sm" style={{ marginTop: 4 }}>
            {S.scaleRejected(fmtInt(d.scaleRejectedCones), fmtInt(d.grandTotal.weightRejects))}
          </p>
        )}
        {d.kgBasis && (
          <p className="mut sm" style={{ marginTop: 4 }}>{S.kgBasis(d.kgBasis.label, fmtInt(d.kgBasis.implausible))}</p>
        )}
        {(wo.pass > 0 || wo.weightRejects > 0) && (
          <p className="mut sm" style={{ marginTop: 4 }}>
            {T.noWinder(fmtInt(wo.pass), fmtInt(wo.weightRejects))}
          </p>
        )}
      </Block>
      <Block label={S.byWinderTitle}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.date}</th>
                <th>{T.shift}</th>
                <th className="n">{T.winder}</th>
                <FigureHeads />
              </tr>
            </thead>
            {days.map((day) => {
              const dayTotal = dayTotalOf(day.date);
              return (
                <DayBodies key={day.date} date={day.date} shifts={day.shifts} dayTotal={dayTotal} />
              );
            })}
          </table>
        </div>
      </Block>
      {(d.winderTotals ?? []).length > 0 && (
        <Block label={S.winderTotalsTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th className="n">{T.winder}</th>
                  <FigureHeads />
                </tr>
              </thead>
              <tbody>
                {d.winderTotals.map((w) => (
                  <tr key={w.winder}>
                    <td className="n">{w.winder}</td>
                    <FigureCells f={w} />
                  </tr>
                ))}
                <tr className="total">
                  <td className="n">{S.grandTotal}</td>
                  <FigureCells f={d.grandTotal} />
                </tr>
              </tbody>
            </table>
          </div>
        </Block>
      )}
      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}

/** One production date: a body per shift (its winder rows and its shift total, kept together on a page), then the day total. */
function DayBodies({
  date, shifts, dayTotal,
}: {
  date: string;
  shifts: { shift: Shift; total: ShiftProductionFigures; rows: Row[] }[];
  dayTotal: ShiftProductionFigures | undefined;
}) {
  return (
    <>
      {shifts.map((g) => (
        <tbody key={g.shift} style={{ breakInside: 'avoid' }}>
          {g.rows.map((r, i) => (
            <tr key={r.winder}>
              {i === 0 && <td rowSpan={g.rows.length}>{fmtDmy(date)}</td>}
              {i === 0 && <td rowSpan={g.rows.length}>{W.shiftName[g.shift]}</td>}
              <td className="n">{r.winder}</td>
              <FigureCells f={r} />
            </tr>
          ))}
          <tr className="total">
            <td colSpan={3}>
              {g.rows.length > 0 ? S.shiftTotal : `${fmtDmy(date)} ${W.shiftName[g.shift]}: ${S.shiftTotal}`}
            </td>
            <FigureCells f={g.total} />
          </tr>
        </tbody>
      ))}
      {dayTotal && (
        <tbody style={{ breakInside: 'avoid' }}>
          <tr className="total">
            <td colSpan={3}>{`${S.dayTotal}, ${fmtDmy(date)}`}</td>
            <FigureCells f={dayTotal} />
          </tr>
        </tbody>
      )}
    </>
  );
}
