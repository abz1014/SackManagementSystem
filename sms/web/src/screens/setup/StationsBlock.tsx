/**
 * Setup › Stations — the names every screen uses, which machine each one
 * is, and whether it is still in service.
 *
 * Moved out of Setup.tsx and extended in roadmap Phase 1 (14 Sep 2026): the
 * machine cell used to print sms.station.machine, a free-text column nobody
 * had filled in, so every row read "—". It is now a select over the line's
 * sms.machine rows. Choosing one writes machine_id and marks the link as
 * made here (link_source='admin'), which is how a Q3 answer that says
 * "machines and stations differ" gets applied — row by row, with an audit
 * entry each, and no code change.
 *
 * The select commits on BLUR, not change, for the reason People's role
 * select does: a <select> fires change on every arrow key, and stepping
 * through fourteen winders would write fourteen links on the way past.
 */
import { useState } from 'react';
import { adminCreateStation, adminListMachines, adminListStations, adminSetStation, type MachineRow, type StationRow } from '../../api';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { Said, YesNo, textOrNull, useResource, useWrite, worthARow } from './shared';

/** Winders first, by number; then anything else; the packer last — it links to no station. */
function forSelect(machines: MachineRow[]): MachineRow[] {
  const rank = (m: MachineRow) => (m.kind === 'winder' ? 0 : m.kind === 'other' ? 1 : 2);
  return [...machines].sort((a, b) => rank(a) - rank(b) || (a.machineNo ?? 1e9) - (b.machineNo ?? 1e9) || a.name.localeCompare(b.name));
}

function machineLabel(m: MachineRow): string {
  return m.isActive ? m.name : `${m.name} (${W.config.inactive})`;
}

export function StationsBlock() {
  const res = useResource(async () => {
    const [s, m] = await Promise.all([adminListStations(), adminListMachines()]);
    return { stations: s.stations, machines: forSelect(m.machines) };
  });

  if (res.error) return <Block label={W.setupTabs.stations}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.stations}><SkelLines n={6} short /></Block>;

  const { stations, machines } = res.data;
  return (
    <Block label={W.setupTabs.stations} note={W.config.stations.note}>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th style={{ width: '4em' }}>{W.config.stations.colNo}</th>
              <th>{W.config.stations.colName}</th>
              <th>{W.config.stations.colMachine}</th>
              <th>{W.config.stations.colActive}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <StationTr key={s.stationId} s={s} machines={machines} onChanged={res.reload} />
            ))}
          </tbody>
        </table>
      </div>
      <NewStationForm machines={machines} onCreated={res.reload} />
    </Block>
  );
}

/* --------------------------------------------------------------- one row */

function StationTr({ s, machines, onChanged }: { s: StationRow; machines: MachineRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const w = useWrite();

  // The route's original body is required-nullable; the link and the flag
  // ride along only when they are the thing being changed.
  const base = { name: s.name, machine: s.machine, description: s.description };
  const machineId = s.machineId ?? null;
  const isActive = s.isActive ?? true;

  const rename = () =>
    void w.run(() => adminSetStation(s.stationId, { ...base, name: textOrNull(draft) }), () => {
      setEditing(false);
      onChanged();
    });

  return (
    <>
      <tr>
        <td>{s.stationId}</td>
        <td>
          {editing ? (
            <input
              type="text"
              value={draft}
              autoFocus
              maxLength={64}
              aria-label={`${W.config.stations.colName}: ${W.station(s.stationId)}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter') rename();
              }}
            />
          ) : (
            s.name ?? <span className="mut">{W.config.stations.notNamed}</span>
          )}
        </td>
        <td>
          <select
            key={`${s.stationId}:${machineId ?? 'none'}`}
            defaultValue={machineId == null ? '' : String(machineId)}
            disabled={w.busy}
            aria-label={`${W.config.stations.colMachine}: ${W.station(s.stationId)}`}
            onBlur={(e) => {
              const next = e.target.value === '' ? null : Number(e.target.value);
              if (next !== machineId) void w.run(() => adminSetStation(s.stationId, { ...base, machineId: next }), onChanged);
            }}
            style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
          >
            <option value="">{W.config.stations.noMachine}</option>
            {machines.map((m) => (
              <option key={m.machineId} value={String(m.machineId)}>{machineLabel(m)}</option>
            ))}
          </select>
          {/* How the link came to be: the seeded default, or an admin. Only
              the default is worth a word — it is the one an IFL answer could
              overturn. */}
          {machineId != null && s.linkSource === 'default_by_number' && (
            <span className="mut sm" style={{ display: 'block' }}>{W.config.stations.linkedByNumber}</span>
          )}
        </td>
        <td>
          <YesNo
            value={isActive}
            busy={w.busy}
            label={`${W.config.stations.colActive}: ${W.station(s.stationId)}`}
            onToggle={() => void w.run(() => adminSetStation(s.stationId, { ...base, isActive: !isActive }), onChanged)}
          />
        </td>
        <td className="n">
          <button
            type="button"
            className="linkish sm"
            disabled={w.busy}
            onClick={() => {
              setEditing(true);
              setDraft(s.name ?? '');
            }}
          >
            {W.config.stations.rename}
          </button>
        </td>
      </tr>
      {worthARow(w.outcome) && (
        <tr>
          <td colSpan={5}><Said outcome={w.outcome} quiet /></td>
        </tr>
      )}
    </>
  );
}

/* --------------------------------------------------------- add a station */

function NewStationForm({ machines, onCreated }: { machines: MachineRow[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [stationId, setStationId] = useState('');
  const [name, setName] = useState('');
  const [machineId, setMachineId] = useState('');
  const w = useWrite();

  if (!open) {
    return (
      <>
        {/* Opening clears the last outcome, so a fresh form does not open
            under the previous add's "… added." */}
        <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => { w.say(null); setOpen(true); }}>
          {W.config.stations.add}
        </button>
        <Said outcome={w.outcome} />
      </>
    );
  }

  const id = Number(stationId);
  const idValid = stationId.trim() !== '' && Number.isInteger(id) && id >= 0;

  return (
    <form
      style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!idValid) return;
        void w.run(
          () => adminCreateStation({ stationId: id, name: textOrNull(name), machineId: machineId === '' ? null : Number(machineId) }),
          () => {
            setOpen(false);
            setStationId('');
            setName('');
            setMachineId('');
            onCreated();
          },
          () => W.config.stations.added(id),
        );
      }}
    >
      <label className="field">
        <span>{W.config.stations.number}</span>
        <input type="number" min={0} step={1} value={stationId} required autoFocus onChange={(e) => setStationId(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.stations.name}</span>
        <input type="text" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.stations.machine}</span>
        <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          <option value="">{W.config.stations.noMachine}</option>
          {machines.map((m) => (
            <option key={m.machineId} value={String(m.machineId)}>{machineLabel(m)}</option>
          ))}
        </select>
      </label>
      <Said outcome={w.outcome} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || !idValid}>{W.config.add}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.config.cancel}</button>
      </div>
    </form>
  );
}
