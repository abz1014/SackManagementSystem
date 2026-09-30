/** Shift Production report (IFL SSRS style, 30 Sep 2026): summary by shift, then per date, shift and winder. */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { ShiftProductionFigures, ShiftProductionReportData } from '../../api';
import { fmtDmy } from './PrintHead';

/** Efficiency to 2 dp, "—" when unknown. */
export function fmtEff(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2);
}

// Below 100 gets a light tint AND bold, so it still reads on black-and-white print.
function EffCell({ v }: { v: number | null }) {
  const low = v != null && v < 100;
  return (
    <td className="n" style={low ? { fontWeight: 700, background: 'rgba(200, 120, 0, 0.12)' } : undefined}>
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

const totalStyle = { fontWeight: 700, fontStyle: 'italic' } as const;

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
      <Block first label="Summary">
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th className="n">Pass packages</th>
                <th className="n">Weight rejections</th>
                <th className="n">Total</th>
                <th className="n">Efficiency %</th>
              </tr>
            </thead>
            <tbody>
              {d.summary.map((s) => (
                <tr key={s.shift}>
                  <td>{W.shiftName[s.shift]}</td>
                  <FigureCells f={s} />
                </tr>
              ))}
              <tr className="total" style={totalStyle}>
                <td>Total</td>
                <FigureCells f={d.grandTotal} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p>
        {(wo.pass > 0 || wo.weightRejects > 0) && (
          <p className="mut sm" style={{ marginTop: 4 }}>
            {fmtInt(wo.pass)} pass and {fmtInt(wo.weightRejects)} weight rejections carry no winder and are in the totals above but not in the winder rows below.
          </p>
        )}
      </Block>
      <Block label="By winder">
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Shift</th>
                <th className="n">Winder</th>
                <th className="n">Pass</th>
                <th className="n">Weight rej.</th>
                <th className="n">Total</th>
                <th className="n">Efficiency %</th>
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
                    <tr className="total" style={totalStyle}>
                      <td className="n">Total</td>
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
