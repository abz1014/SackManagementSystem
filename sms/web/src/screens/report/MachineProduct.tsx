/**
 * Product by machine and shift — the tenth report type, roadmap Phase 8
 * extended on IFL's answer of 15 Sep 2026 (Wave F, item F2.2): "at the
 * morning shift machine 1 ran product A; the engineer changes the product
 * so the evening shift runs product B; reports must show, per machine,
 * which product ran in which shift". This section is that page: a MATRIX
 * with one row per machine and one column per production day × shift, each
 * cell the product name(s) that machine's cones carried in it and the cone
 * count; the list of changeovers the readings show; and the per-product
 * totals. Mirrors `api/src/services/reports/machineProduct.ts`
 * MachineProductReportData exactly — see the interfaces in `../../api`.
 *
 * A cell with two materials shows BOTH, in the order they ran ("→" between
 * them): the operator changed the panel's selection mid-shift and hiding
 * one would misreport the shift. A machine that weighed nothing in a
 * column is an em dash, not 0 — `cells[i]` is `null` there, never a
 * zero-cone cell, because absence and zero are different facts.
 *
 * Sacks carry no machine (sack1_TP1U2 has no station column at any layer),
 * so every count here is cones, never sacks — the same caveat the Sacks
 * report and screen carry.
 */
import { W } from '../../lib/words';
import { Block, Chevron, Empty, rowKeys } from '../../ui/bits';
import { fmtClock, fmtInt } from '../../lib/fmt';
import type { MachineProductChange, MachineProductReportData, MachineShiftCell } from '../../api';
import { fmtDayDmy } from './shared';

/** The row/change label: the machine's own name, then the station's, then a plain numbered fallback. */
function machineLabel(station: number, machineName: string | null, stationName?: string | null): string {
  return machineName?.trim() || stationName?.trim() || `${W.reports.colMachine} ${station}`;
}

/** materialId → the label the report prints, as the server's own CSV serialiser resolves it (machineProduct.ts labelOf). */
function labelOf(id: number | null, name: string | null, labels: Record<string, string>): string {
  return labels[String(id ?? 'none')] ?? name ?? (id == null ? W.cone.noMaterial : W.cone.noProductName(id));
}

/**
 * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.3
 * "a machine → its product and its shift"): the changeover matrix names the
 * machine on every row but opened nothing. `onOpen` opens that station's
 * sheet — the same destination the machine rows on Line and the station
 * table on Weight already open.
 */
/*
 * UX Phase 9 Brief D (21 Sep 2026) print-suppressed this whole section: the
 * matrix is one column per calendar day × shift worked in the period —
 * measured at 102 columns on the full 34-day dev range (2026-08-05 to
 * 2026-09-07; the report's own `daysBetween` × 3 shifts, deterministic, not
 * data-dependent — see machineProduct.ts). The owner was asked whether it
 * should print at all and said yes ("there is no harm in it right?") on
 * 22 Sep 2026. There IS one harm, and it is not "should it print" but "at
 * what scale": 102 columns onto ~1,015px of A4-landscape usable width (the
 * [PHASE 9 PRINT P6] page) is a ~0.14 shrink factor even before the
 * row-label column — 8pt text would land under 2pt, unreadable, which is
 * worse than the page not existing. Scaling was ruled out for exactly that
 * reason; this section PAGINATES instead, tiling MACHINE_PRODUCT_COLS_PER_PAGE
 * data columns per sheet with the row-label column repeated on every page
 * and the span stated ("Columns 1–12 of 102 · page 1 of 9"), so a reader
 * with the stack in hand can always orient. The on-screen table (`.no-print`,
 * unchanged, still one continuous table) and the print version (`.print-only`,
 * now real tables instead of one apology line) render from the same `d`, so
 * there is exactly one place the matrix's numbers are computed.
 */
const MACHINE_PRODUCT_COLS_PER_PAGE = 12;

function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (arr.length === 0) return [arr as T[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function MachineProductSection({ d, onOpen }: { d: MachineProductReportData; onOpen: (station: number) => void }) {
  if (d.rows.length === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  return <MachineProductTables d={d} onOpen={onOpen} />;
}

function MachineProductTables({ d, onOpen }: { d: MachineProductReportData; onOpen: (station: number) => void }) {
  return (
    <>
      <Block first>
        <p className="g">{W.reports.machineProductSummary(fmtInt(d.machinesWeighing ?? d.rows.filter((r) => r.cones > 0).length), fmtInt(d.products.length))}</p>
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
        {d.conesWithoutStation > 0 && (
          <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.conesWithoutStation(fmtInt(d.conesWithoutStation))}</p>
        )}
      </Block>

      <Block label={W.reports.colMachine}>
        {/* Screen: TRANSPOSED (RT-017, 25 Sep 2026) — machines run across
            (~14 columns, fits without horizontal scroll), day×shift runs
            down as rows (up to ~102), inside a fixed-height, independently
            scrolling box with a sticky header row and a sticky first
            column. See the `.mp-scroll` comment in app.css for the
            measurement that showed the old layout losing the machine label
            off-screen. Same `d`, same cells, only the axes are swapped. */}
        <div className="tw mp-scroll no-print">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{W.reports.colWhen}</th>
                {d.rows.map((r) => (
                  <th
                    key={r.station}
                    className="click"
                    tabIndex={0}
                    onClick={() => onOpen(r.station)}
                    onKeyDown={rowKeys(() => onOpen(r.station))}
                  >
                    {machineLabel(r.station, r.machineName, r.stationName)}
                    <Chevron label={W.openRecord} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.columns.map((c, ci) => (
                <tr key={`${c.day}|${c.shift}`}>
                  <td className="n">
                    {fmtDayDmy(c.day)}
                    <br />
                    {W.shiftName[c.shift]}
                  </td>
                  {d.rows.map((r) => {
                    const cell = r.cells[ci];
                    return <td key={r.station}>{cell ? <Cell cell={cell} labels={d.labels} /> : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Print / PDF: paginated — a sheet cannot scroll. `tw` gives every
            page's table the same [PHASE 9 PRINT P2] full-width/8pt rules the
            screen table's own `.tw` wrapper gets; `print-only` is the only
            reason this markup is invisible on screen. */}
        <div className="tw print-only">
          <MachineProductPrintPages d={d} />
        </div>
      </Block>

      <Block label={W.reports.changeovers}>
        {d.changes.length === 0 ? (
          <p className="mut">{W.reports.noChangeovers}</p>
        ) : (
          <div className="tw">
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{W.reports.colWhen}</th>
                  <th>{W.reports.colMachine}</th>
                  <th>{W.reports.colFrom}</th>
                  <th>{W.reports.colTo}</th>
                </tr>
              </thead>
              <tbody>
                {d.changes.map((c, i) => (
                  <ChangeRow key={i} c={c} labels={d.labels} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <Block label={W.reports.byProduct}>
        <div className="tw">
          <table className="ifl-table">
            <thead>
              <tr>
                <th>{W.reports.colProduct}</th>
                <th className="n">{W.report.colCones}</th>
                <th className="n">{W.reports.colMachinesCount}</th>
                <th>{W.reports.colFirst}</th>
                <th>{W.reports.colLast}</th>
              </tr>
            </thead>
            <tbody>
              {d.products.map((p) => (
                <tr key={p.materialId ?? 'none'}>
                  <td>{p.label}</td>
                  <td className="n">{fmtInt(p.cones)}</td>
                  <td className="n">{fmtInt(p.machines)}</td>
                  <td>{fmtDayDmy(p.firstUtc)} {fmtClock(p.firstUtc)}</td>
                  <td>{fmtDayDmy(p.lastUtc)} {fmtClock(p.lastUtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}

/**
 * The print/PDF version of the machine matrix: `d.columns` tiled into
 * `MACHINE_PRODUCT_COLS_PER_PAGE`-wide pages, each its own `<table className="ifl-table">` with the
 * row-label column repeated and the span stated above it. `break-after: page`
 * (`.mp-page`, app.css) puts each page on its own sheet under the existing
 * `report-landscape` @page rule — one table per printed page, not one huge
 * table Chromium would have to paginate on its own with no column repeat.
 * The LAST page gets no forced break, so it doesn't leave a blank trailing
 * sheet. A period with zero columns (period shorter than one shift-day,
 * should not happen given daysBetween always returns ≥1 day) still renders
 * one page with zero data columns rather than nothing.
 */
function MachineProductPrintPages({ d }: { d: MachineProductReportData }) {
  const pages = chunk(d.columns, MACHINE_PRODUCT_COLS_PER_PAGE);
  const total = d.columns.length;
  return (
    <>
      {pages.map((pageCols, pi) => {
        const fromCol = pi * MACHINE_PRODUCT_COLS_PER_PAGE + 1;
        const toCol = fromCol + pageCols.length - 1;
        const first = d.columns[0] === pageCols[0];
        return (
          <div className="mp-page" key={pi}>
            <p className="mut sm" style={{ marginTop: first ? 0 : 18, marginBottom: 6 }}>
              {W.reports.machineProductPageSpan(fmtInt(fromCol), fmtInt(toCol), fmtInt(total), fmtInt(pi + 1), fmtInt(pages.length))}
            </p>
            <table className="ifl-table">
              <thead>
                <tr>
                  <th>{W.reports.colMachine}</th>
                  {pageCols.map((c) => (
                    <th key={`${c.day}|${c.shift}`} className="n">
                      {fmtDayDmy(c.day)}
                      <br />
                      {W.shiftName[c.shift]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.station}>
                    <td>{machineLabel(r.station, r.machineName, r.stationName)}</td>
                    {pageCols.map((c, i) => {
                      const globalIndex = fromCol - 1 + i;
                      const cell = r.cells[globalIndex];
                      return <td key={i}>{cell ? <Cell cell={cell} labels={d.labels} /> : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/** One matrix cell: every material the machine ran in this day × shift, in run order. */
function Cell({ cell, labels }: { cell: MachineShiftCell; labels: Record<string, string> }) {
  return (
    <>
      {cell.materials.map((m, i) => (
        <span key={i}>
          {i > 0 && ' → '}
          {labelOf(m.materialId, m.productName, labels)} ({fmtInt(m.cones)})
        </span>
      ))}
    </>
  );
}

function ChangeRow({ c, labels }: { c: MachineProductChange; labels: Record<string, string> }) {
  return (
    <tr>
      <td>{fmtDayDmy(c.day)} {W.shiftName[c.shift]}{' · '}{fmtClock(c.firstUtc)}</td>
      <td>{machineLabel(c.station, c.machineName)}</td>
      <td>{labelOf(c.fromMaterialId, c.fromProductName, labels)}</td>
      <td>{labelOf(c.toMaterialId, c.toProductName, labels)}</td>
    </tr>
  );
}
