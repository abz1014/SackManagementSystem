/**
 * Sack Packing Weight Summary (IFL report 5): sacks, kilograms, average,
 * lightest, heaviest, standard deviation and the scale's rejections per
 * production date and shift, with a day subtotal under each date, then the
 * shifts over the period, then the yarn counts, each closed by the period
 * total.
 *
 * Average, lightest, heaviest and SD are over sacks with a plausible weight
 * only; the "Implausible" column says how many a row left out, and the table's
 * footnote says it once more for the period. "Rejected by scale" is the sack
 * scale's own verdict — the only verdict there is: no sack tolerance exists in
 * IFL's data, so nothing here says a sack is under- or over-weight.
 *
 * Prints portrait: the root carries data-report-orientation="portrait"
 * (app.css [IFL HOUSE STYLE] contract). Every list is read defensively — a
 * payload that omits a field must not take the screen down.
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { SackSummaryFigures, SackWeightSummaryReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports.sackWeightSummary;

/** A kilogram figure to `dp` places, "—" when there is none. The unit is in the column heading. */
function kgCell(n: number | null | undefined, dp: number): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** The eight figure cells of one row, in the order of `FigureHeads`. */
function FigureCells({ f }: { f: SackSummaryFigures }) {
  return (
    <>
      <td className="n">{fmtInt(f.sacks)}</td>
      <td className="n">{kgCell(f.kg, 1)}</td>
      <td className="n">{kgCell(f.avgKg, 2)}</td>
      <td className="n">{kgCell(f.minKg, 2)}</td>
      <td className="n">{kgCell(f.maxKg, 2)}</td>
      <td className="n">{kgCell(f.sdKg, 3)}</td>
      <td className="n">{fmtInt(f.rejectedByScale)}</td>
      <td className="n">{fmtInt(f.implausible)}</td>
    </>
  );
}

function FigureHeads() {
  return (
    <>
      <th className="n">{T.sacks}</th>
      <th className="n">{T.kg}</th>
      <th className="n">{T.avgKg}</th>
      <th className="n">{T.minKg}</th>
      <th className="n">{T.maxKg}</th>
      <th className="n">{T.sdKg}</th>
      <th className="n">{T.rejectedByScale}</th>
      <th className="n">{T.implausible}</th>
    </>
  );
}

export function SackWeightSummarySection({ d }: { d: SackWeightSummaryReportData }) {
  const rows = d.rows ?? [];
  const dayTotals = d.dayTotals ?? [];
  const shiftTotals = d.shiftTotals ?? [];
  const byYarnCount = d.byYarnCount ?? [];
  const total = d.total;

  if ((total?.sacks ?? 0) === 0 && rows.length === 0) {
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

  // Rows arrive date-then-shift; group them so the date and its day total read as one block.
  const days: { date: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const g = days[days.length - 1];
    if (g && g.date === r.date) g.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }
  const dayTotalOf = (date: string) => dayTotals.find((t) => t.date === date);

  return (
    <div data-report-orientation="portrait">
      <Block first label={T.title}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.date}</th>
                <th>{T.shift}</th>
                <FigureHeads />
              </tr>
            </thead>
            {days.map((g) => {
              const t = dayTotalOf(g.date);
              const span = g.rows.length + (t ? 1 : 0);
              return (
                <tbody key={g.date} style={{ breakInside: 'avoid' }}>
                  {g.rows.map((r, i) => (
                    <tr key={r.shift}>
                      {i === 0 && <td rowSpan={span}>{fmtDmy(g.date)}</td>}
                      <td>{W.shiftName[r.shift] ?? r.shift}</td>
                      <FigureCells f={r} />
                    </tr>
                  ))}
                  {t && (
                    <tr className="total">
                      <td>{T.dayTotal}</td>
                      <FigureCells f={t} />
                    </tr>
                  )}
                </tbody>
              );
            })}
            {total && (
              <tbody>
                <tr className="total">
                  <td colSpan={2}>{T.total}</td>
                  <FigureCells f={total} />
                </tr>
              </tbody>
            )}
          </table>
        </div>
        {total && total.implausible > 0 && (
          <p className="mut sm" style={{ marginTop: 8 }}>{T.excludedNote(fmtInt(total.implausible))}</p>
        )}
        {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
      </Block>

      {shiftTotals.length > 0 && (
        <Block label={T.byShiftTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.shift}</th>
                  <FigureHeads />
                </tr>
              </thead>
              <tbody>
                {shiftTotals.map((s) => (
                  <tr key={s.shift}>
                    <td>{W.shiftName[s.shift] ?? s.shift}</td>
                    <FigureCells f={s} />
                  </tr>
                ))}
                {total && (
                  <tr className="total">
                    <td>{T.total}</td>
                    <FigureCells f={total} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {byYarnCount.length > 0 && (
        <Block label={T.byCountTitle}>
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{T.yarnCount}</th>
                  <th>{T.materialIds}</th>
                  <FigureHeads />
                </tr>
              </thead>
              <tbody>
                {byYarnCount.map((c) => {
                  const ids = c.materialIds ?? [];
                  return (
                    <tr key={c.label}>
                      {/* No yarn count AND no material = the sacks that carry no product. */}
                      <td>{c.yarnCount == null && ids.length === 0 ? T.noProduct : c.label}</td>
                      <td>{ids.length > 0 ? ids.join(', ') : '—'}</td>
                      <FigureCells f={c} />
                    </tr>
                  );
                })}
                {total && (
                  <tr className="total">
                    <td colSpan={2}>{T.total}</td>
                    <FigureCells f={total} />
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
