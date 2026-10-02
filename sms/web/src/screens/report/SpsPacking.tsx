/**
 * SPS Production Report, count-wise packing (IFL report 3): sacks packed per
 * production date and shift, a column per YARN COUNT, each cell the sacks and,
 * on a second line, their kilograms. Beneath it, the period's figures per
 * count — sacks, kilograms, average sack and share — then the one sentence
 * that says where a count comes from (today's product master).
 *
 * "Each SPS" is ONE SPS: this line has a single sack scale (PLC_sack1) and the
 * sack records carry no machine, so the report states the one block it can
 * state, as the server labels it, and the "Assumed until IFL confirms" block
 * says that IFL has not confirmed the reading. A sack is never attributed to a
 * winder.
 *
 * Average sack weights are over sacks with a plausible weight; the kilograms
 * in a cell cover every sack. A sack with no product on the reading (all of
 * July's) has no count and sits in its own last column; a sack whose product
 * has no count on record sits in the column before it.
 *
 * Prints LANDSCAPE: a column per yarn count is wider than a portrait page. The
 * root is marked "landscape", never "portrait", so app.css's report-landscape
 * page applies (the portrait hook only matches the value "portrait"). Every
 * list is read defensively — a payload that omits a field must not take the
 * screen down.
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtInt } from '../../lib/fmt';
import type { SpsCell, SpsCountColumn, SpsMatrixRow, SpsPackingReportData } from '../../api';
import { fmtDmy } from './PrintHead';
import { PendingIfl } from './PendingIfl';

const T = W.iflReports.spsPacking;

/** The key the server gives the no-product column (`SPS_NO_PRODUCT_KEY`). */
const NO_PRODUCT_KEY = 'none';

/** A figure to `dp` places with thousands separators, "—" when there is none. The unit is in the column heading. */
function numCell(n: number | null | undefined, dp: number): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** What a column or count row prints: the no-product bucket in the screen's own words, everything else as the server labels it. */
function labelOf(c: { key: string; label: string }): string {
  return c.key === NO_PRODUCT_KEY ? T.noProduct : c.label;
}

/** One matrix cell: the sacks, then the kilograms on a second line; a dash where the count had no sacks in that row. */
function MatrixCell({ c }: { c: SpsCell | undefined }) {
  if (!c || c.sacks <= 0) return <td className="n">—</td>;
  return (
    <td className="n">
      {fmtInt(c.sacks)}
      <br />
      <span className="mut">{numCell(c.kg, 1)}</span>
    </td>
  );
}

export function SpsPackingSection({ d }: { d: SpsPackingReportData }) {
  const columns: SpsCountColumn[] = d.columns ?? [];
  const rows: SpsMatrixRow[] = d.rows ?? [];
  const totals = d.totals ?? [];
  const grand = d.grandTotal ?? { sacks: 0, kg: 0, avgKg: null };

  if (grand.sacks === 0 && rows.length === 0) {
    return (
      <div data-report-orientation="landscape">
        <Block first>
          <Empty message={T.empty} />
          {d.note ? <p className="mut sm" style={{ marginTop: 8 }}>{d.note}</p> : null}
        </Block>
        <PendingIfl lines={d.pendingIfl} />
      </div>
    );
  }

  // Rows arrive date-then-shift; group them so a date reads once, over its shifts.
  const days: { date: string; rows: SpsMatrixRow[] }[] = [];
  for (const r of rows) {
    const g = days[days.length - 1];
    if (g && g.date === r.date) g.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }
  const totalOf = (key: string) => totals.find((t) => t.key === key);
  const implausible = d.implausibleSacks ?? 0;

  return (
    <div data-report-orientation="landscape">
      <Block first label={T.matrixTitle}>
        {d.sps?.label ? <p className="sm" style={{ margin: '0 0 8px' }}><b>{d.sps.label}</b></p> : null}
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.date}</th>
                <th>{T.shift}</th>
                {columns.map((c) => (
                  <th key={c.key} className="n">
                    {labelOf(c)}
                    <br />
                    <span className="mut sm">{T.cellUnits}</span>
                  </th>
                ))}
                <th className="n">
                  {T.total}
                  <br />
                  <span className="mut sm">{T.cellUnits}</span>
                </th>
              </tr>
            </thead>
            {days.map((g) => (
              <tbody key={g.date} style={{ breakInside: 'avoid' }}>
                {g.rows.map((r, i) => (
                  <tr key={r.shift}>
                    {i === 0 && <td rowSpan={g.rows.length}>{fmtDmy(g.date)}</td>}
                    <td>{W.shiftName[r.shift] ?? r.shift}</td>
                    {columns.map((c) => <MatrixCell key={c.key} c={r.cells?.[c.key]} />)}
                    <MatrixCell c={r.total} />
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              <tr className="total">
                <td colSpan={2}>{T.total}</td>
                {columns.map((c) => <MatrixCell key={c.key} c={totalOf(c.key)} />)}
                <MatrixCell c={grand} />
              </tr>
            </tbody>
          </table>
        </div>
      </Block>

      <Block label={T.byCountTitle}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{T.yarnCount}</th>
                <th>{T.materialIds}</th>
                <th className="n">{T.sacks}</th>
                <th className="n">{T.kg}</th>
                <th className="n">{T.avgKg}</th>
                <th className="n">{T.share}</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => {
                const ids = t.materialIds ?? [];
                return (
                  <tr key={t.key}>
                    <td>{labelOf(t)}</td>
                    <td>{ids.length > 0 ? ids.join(', ') : '—'}</td>
                    <td className="n">{fmtInt(t.sacks)}</td>
                    <td className="n">{numCell(t.kg, 1)}</td>
                    <td className="n">{numCell(t.avgKg, 2)}</td>
                    <td className="n">{numCell(t.sharePct, 1)}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td colSpan={2}>{T.total}</td>
                <td className="n">{fmtInt(grand.sacks)}</td>
                <td className="n">{numCell(grand.kg, 1)}</td>
                <td className="n">{numCell(grand.avgKg, 2)}</td>
                <td className="n">{grand.sacks > 0 ? numCell(100, 1) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mut sm" style={{ marginTop: 8 }}>{T.mappingNote}</p>
        {implausible > 0 && <p className="mut sm" style={{ marginTop: 4 }}>{T.implausibleNote(fmtInt(implausible))}</p>}
        {d.note ? <p className="mut sm" style={{ marginTop: 4 }}>{d.note}</p> : null}
      </Block>

      <PendingIfl lines={d.pendingIfl} />
    </div>
  );
}
