/**
 * Product changes on a report — F-2 (Stage 3, 11 Oct 2026; owner, 7 Oct 2026).
 *
 * One table, shared: the machine-product report's own "Changeovers" table (moved here unchanged except its first column's
 * heading, "First cone of the new product", which says what the time is) and the block the product, daily, shift and
 * shift-production reports now carry. The server derives the changes once (machineProducts.ts); this only shows them.
 *
 * Every time is that of the first cone of the new product on that winder: PDAS is a catalogue and the operator picks the product
 * on the machine's panel, so SMS never sees the selection, only the cones. On paper the same facts are printed once, through the
 * report's notes, so the on-screen block is `no-print`.
 */
import { W } from '../../lib/words';
import { Block } from '../../ui/bits';
import { useDateFmt } from '../../lib/fmtContext';
import type { MachineProductChange, ReportProductChanges } from '../../api';
import { fmtDayDmy } from './shared';

/** The row/change label: the machine's own name, then the station's, then a plain numbered fallback. */
export function machineLabel(station: number, machineName: string | null, stationName?: string | null): string {
  return machineName?.trim() || stationName?.trim() || `${W.reports.colMachine} ${station}`;
}

/** materialId → the label the report prints, as the server's own CSV serialiser resolves it (machineProduct.ts labelOf). */
export function labelOf(id: number | null, name: string | null, labels: Record<string, string>): string {
  return labels[String(id ?? 'none')] ?? name ?? (id == null ? W.cone.noMaterial : W.cone.noProductName(id));
}

function ChangeRow({ c, labels }: { c: MachineProductChange; labels: Record<string, string> }) {
  const df = useDateFmt();
  return (
    <tr>
      <td>{fmtDayDmy(c.day)} {W.shiftName[c.shift]}{' · '}{df.clock(c.firstUtc)}</td>
      <td>{machineLabel(c.station, c.machineName)}</td>
      <td>
        {labelOf(c.fromMaterialId, c.fromProductName, labels)}
        {c.fromBeforePeriod && <span className="mut sm"> {W.reports.fromBeforePeriod}</span>}
      </td>
      <td>{labelOf(c.toMaterialId, c.toProductName, labels)}</td>
    </tr>
  );
}

/** The changes table: first cone of the new product, machine, from, to. */
export function ChangesTable({ changes, labels }: { changes: MachineProductChange[]; labels: Record<string, string> }) {
  return (
    <div className="tw">
      <table className="ifl-table">
        <thead>
          <tr>
            <th>{W.reports.colFirstConeOfNew}</th>
            <th>{W.reports.colMachine}</th>
            <th>{W.reports.colFrom}</th>
            <th>{W.reports.colTo}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <ChangeRow key={i} c={c} labels={labels} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The block on the four reports. Nothing for a payload that predates the field (`productChanges` undefined); a sentence when
 * they could not be read (null) or there were none; the table and the time rule otherwise. Hidden in print.
 */
export function ProductChangesBlock({ d }: { d: ReportProductChanges }) {
  if (d.productChanges === undefined) return null;
  return (
    <div className="no-print">
      <Block label={W.reports.productChanges}>
        {d.productChanges === null ? (
          <p className="mut">{W.reports.productChangesUnread}</p>
        ) : d.productChanges.length === 0 ? (
          <p className="mut">{W.reports.noProductChanges}</p>
        ) : (
          <>
            <ChangesTable changes={d.productChanges} labels={d.productChangeLabels ?? {}} />
            <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.productChangeTimeNote}</p>
          </>
        )}
      </Block>
    </div>
  );
}
