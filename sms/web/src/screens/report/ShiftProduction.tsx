/** Shift Production report (IFL SSRS style, 30 Sep 2026): summary by shift, then per date, shift and winder. */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { ShiftProductionFigures, ShiftProductionReportData } from '../../api';
import { fmtDmy } from './PrintHead';

const T = W.iflReports;

/** Efficiency to 2 dp, "—" when unknown. */
export function fmtEff(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2);
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

function FigureCells({ f }: { f: ShiftProductionFigures }) {
  return (
    <>
      <td className="n">{fmtInt(f.pass)}</td>
      <td className="n">{fmtInt(f.weightRejects)}</td>
      <td className="n">{fmtInt(f.total)}</td>
      <EffCell v={f.efficiencyPct} />
    </>
  );
}

export function ShiftProductionSection({ d }: { d: ShiftProductionReportData }) {
  if (d.grandTotal.total === 0 && d.rows.length === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  // Group rows by date+shift, in the order the server sorted them.
  const groups: { key: string; date: string; shift: ShiftProductionReportData['rows'][number]['shift']; rows: ShiftProductionReportData['rows'] }[] = [];
  for (const r of d.rows) {
    const key = `${r.date}|${r.shift}`;
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.rows.push(r);
    else groups.push({ key, date: r.date, shift: r.shift, rows: [r] });
  }
  const totalOf = (date: string, shift: string) => d.shiftTotals.find((t) => t.date === date && t.shift === shift);
  const wo = d.withoutWinder;

  return (
    <div data-report-orientation="portrait">
      <Block first label={T.summary}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.shift}</th>
                <th className="n">{T.passPackages}</th>
                <th className="n">{T.weightRejections}</th>
                <th className="n">{T.total}</th>
                <th className="n">{T.efficiency}</th>
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
                <td>{T.total}</td>
                <FigureCells f={d.grandTotal} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p>
        {(wo.pass > 0 || wo.weightRejects > 0) && (
          <p className="mut sm" style={{ marginTop: 4 }}>
            {T.noWinder(fmtInt(wo.pass), fmtInt(wo.weightRejects))}
          </p>
        )}
      </Block>
      <Block label={T.byWinder}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.date}</th>
                <th>{T.shift}</th>
                <th className="n">{T.winder}</th>
                <th className="n">{T.pass}</th>
                <th className="n">{T.weightRejShort}</th>
                <th className="n">{T.total}</th>
                <th className="n">{T.efficiency}</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const t = totalOf(g.date, g.shift);
              const span = g.rows.length + (t ? 1 : 0);
              return (
                <tbody key={g.key} style={{ breakInside: 'avoid' }}>
                  {g.rows.map((r, i) => (
                    <tr key={r.winder}>
                      {i === 0 && <td rowSpan={span}>{fmtDmy(g.date)}</td>}
                      {i === 0 && <td rowSpan={span}>{W.shiftName[g.shift]}</td>}
                      <td className="n">{r.winder}</td>
                      <FigureCells f={r} />
                    </tr>
                  ))}
                  {t && (
                    <tr className="total">
                      <td className="n">{T.total}</td>
                      <FigureCells f={t} />
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      </Block>
    </div>
  );
}
