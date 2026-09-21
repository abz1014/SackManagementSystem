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
import { fmtDayShort } from './shared';

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
 * UX Phase 9 Brief D (21 Sep 2026, owner decision): this matrix is one
 * column per calendar day × shift worked in the period — measured at ~103
 * columns / 7,438px on the dev range (2026-08-05 to 2026-09-07). No print
 * orientation or type-size rule fixes that; it is a structural limit, not
 * something [PHASE 9 PRINT P2]'s full-width/8pt table rule (app.css) can
 * paper over. So the whole section is print-suppressed — `.no-print` below,
 * the same existing mechanism the rest of the screen chrome already uses,
 * not a new one — and replaced on paper by one line pointing at the CSV
 * export, which carries the identical rows and is already audited (rank 3,
 * `reportExportUrl` in Report.tsx). `.print-only` (app.css:526-527) is the
 * existing mirror-image mechanism for that line; using both keeps this
 * change to markup only, no CSS edit needed for Decision 2. Nothing here
 * changes what renders on screen.
 */
export function MachineProductSection({ d, onOpen }: { d: MachineProductReportData; onOpen: (station: number) => void }) {
  return (
    <>
      <p className="print-only">{W.reports.machineProductTooWideForPrint}</p>
      <div className="no-print">
        {d.rows.length === 0 ? (
          <Block first>
            <Empty message={W.nothingHere} />
          </Block>
        ) : (
          <MachineProductTables d={d} onOpen={onOpen} />
        )}
      </div>
    </>
  );
}

function MachineProductTables({ d, onOpen }: { d: MachineProductReportData; onOpen: (station: number) => void }) {
  return (
    <>
      <Block first>
        <p className="g">{W.reports.machineProductSummary(fmtInt(d.rows.length), fmtInt(d.products.length))}</p>
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
        {d.conesWithoutStation > 0 && (
          <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.conesWithoutStation(fmtInt(d.conesWithoutStation))}</p>
        )}
      </Block>

      <Block label={W.reports.colMachine}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{W.reports.colMachine}</th>
                {d.columns.map((c) => (
                  <th key={`${c.day}|${c.shift}`} className="n">
                    {fmtDayShort(c.day)}
                    <br />
                    {W.shiftName[c.shift]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.station}>
                  <td className="click" tabIndex={0} onClick={() => onOpen(r.station)} onKeyDown={rowKeys(() => onOpen(r.station))}>
                    {machineLabel(r.station, r.machineName, r.stationName)}
                    <Chevron label={W.openRecord} />
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={i}>{cell ? <Cell cell={cell} labels={d.labels} /> : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block label={W.reports.changeovers}>
        {d.changes.length === 0 ? (
          <p className="mut">{W.reports.noChangeovers}</p>
        ) : (
          <div className="tw">
            <table>
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
          <table>
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
                  <td>{fmtDayShort(p.firstUtc)} {fmtClock(p.firstUtc)}</td>
                  <td>{fmtDayShort(p.lastUtc)} {fmtClock(p.lastUtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
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
      <td>{fmtDayShort(c.day)} {W.shiftName[c.shift]}{' · '}{fmtClock(c.firstUtc)}</td>
      <td>{machineLabel(c.station, c.machineName)}</td>
      <td>{labelOf(c.fromMaterialId, c.fromProductName, labels)}</td>
      <td>{labelOf(c.toMaterialId, c.toProductName, labels)}</td>
    </tr>
  );
}
