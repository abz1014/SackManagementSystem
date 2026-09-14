/**
 * Setup › Machines — the winders and the packer on this line.
 *
 * Machines had no row anywhere before roadmap Phase 1 (14 Sep 2026):
 * sms.station.machine was a free-text column and "14" was a literal in the
 * station seed. Migration 028 seeded the 14 Rieter winders and the
 * Neuenhauser packer from IFL's own material, and linked station N to winder
 * N by number. That link is a DEFAULT, and the section says so in words:
 * whether a machine and a station are the same thing is still IFL's to
 * confirm (Q3), and if they differ the links are edited in Stations, not the
 * code.
 *
 * Reads /api/config rather than /api/admin/machines: the table's "linked
 * station" column is the join of machines and stations, and config carries
 * both in one response with the link fields guaranteed.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { adminCreateMachine, adminUpdateMachine, getConfig, type ConfigStation, type MachineKind, type MachineRow } from '../../api';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { Said, YesNo, sameText, textOrNull, useResource, useWrite, worthARow, type Outcome } from './shared';

const KINDS: MachineKind[] = ['winder', 'packer', 'other'];

export function MachinesBlock() {
  const res = useResource(() => getConfig());

  if (res.error) return <Block label={W.setupTabs.machines}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.machines}><SkelLines n={6} short /></Block>;

  const { machines, stations } = res.data;
  // machine_id → the stations linked to it. Normally one; the column prints
  // every one, since a wrong double link is exactly what an admin should see.
  const linked = new Map<number, ConfigStation[]>();
  for (const s of stations) {
    if (s.machineId == null) continue;
    linked.set(s.machineId, [...(linked.get(s.machineId) ?? []), s]);
  }

  return (
    <Block label={W.setupTabs.machines} note={W.config.machines.note}>
      <p className="mut sm" style={{ marginBottom: 14 }}>{W.config.machines.defaultLink}</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              {/* Not .n: that class is the right-aligned LAST column (padding-right 0),
                  and used mid-table it ran the number into the next cell — "1winder". */}
              <th style={{ width: '4em' }}>{W.config.machines.colNo}</th>
              <th>{W.config.machines.colKind}</th>
              <th>{W.config.machines.colMake}</th>
              <th>{W.config.machines.colModel}</th>
              <th>{W.config.machines.colName}</th>
              <th>{W.config.machines.colActive}</th>
              <th>{W.config.machines.colStation}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <MachineTr key={m.machineId} m={m} stations={linked.get(m.machineId) ?? []} onChanged={res.reload} />
            ))}
          </tbody>
        </table>
      </div>
      <NewMachineForm onCreated={res.reload} />
    </Block>
  );
}

/* --------------------------------------------------------------- one row */

function MachineTr({ m, stations, onChanged }: { m: MachineRow; stations: ConfigStation[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const w = useWrite();

  const stationCell =
    stations.length === 0 ? (
      <span className="mut">{W.config.machines.notLinked}</span>
    ) : (
      stations.map((s) => s.stationId).join(', ')
    );

  if (editing) {
    return (
      <EditTr
        m={m}
        busy={w.busy}
        stationCell={stationCell}
        onCancel={() => setEditing(false)}
        onSave={(patch) =>
          void w.run(
            () => adminUpdateMachine(m.machineId, patch),
            () => {
              setEditing(false);
              onChanged();
            },
          )
        }
        outcome={w.outcome}
      />
    );
  }

  return (
    <>
      <tr>
        <td style={{ whiteSpace: 'nowrap' }}>{m.machineNo ?? <span className="mut">{W.config.machines.noNumber}</span>}</td>
        <td>{W.config.machines.kinds[m.kind]}</td>
        <td>{m.make ?? <span className="mut">—</span>}</td>
        <td>{m.model ?? <span className="mut">—</span>}</td>
        <td>
          {m.name}
          {m.notes && <span className="mut sm" style={{ display: 'block' }}>{m.notes}</span>}
        </td>
        <td>
          <YesNo
            value={m.isActive}
            busy={w.busy}
            label={`${W.config.machines.colActive}: ${m.name}`}
            onToggle={() => void w.run(() => adminUpdateMachine(m.machineId, { isActive: !m.isActive }), onChanged)}
          />
        </td>
        <td>{stationCell}</td>
        <td className="n">
          <button type="button" className="linkish sm" disabled={w.busy} onClick={() => setEditing(true)}>
            {W.config.edit}
          </button>
        </td>
      </tr>
      {worthARow(w.outcome) && (
        <tr>
          <td colSpan={8}><Said outcome={w.outcome} quiet /></td>
        </tr>
      )}
    </>
  );
}

function EditTr({
  m, busy, stationCell, onCancel, onSave, outcome,
}: {
  m: MachineRow;
  busy: boolean;
  stationCell: ReactNode;
  onCancel: () => void;
  onSave: (patch: Parameters<typeof adminUpdateMachine>[1]) => void;
  outcome: Outcome;
}) {
  const [name, setName] = useState(m.name);
  const [make, setMake] = useState(m.make ?? '');
  const [model, setModel] = useState(m.model ?? '');
  const [notes, setNotes] = useState(m.notes ?? '');

  const patch: Parameters<typeof adminUpdateMachine>[1] = {};
  if (!sameText(name, m.name) && name.trim() !== '') patch.name = name.trim();
  if (!sameText(make, m.make)) patch.make = textOrNull(make);
  if (!sameText(model, m.model)) patch.model = textOrNull(model);
  if (!sameText(notes, m.notes)) patch.notes = textOrNull(notes);
  const changed = Object.keys(patch).length > 0;

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (changed) onSave(patch);
      else onCancel();
    }
  };

  return (
    <>
      <tr>
        <td style={{ whiteSpace: 'nowrap' }}>{m.machineNo ?? <span className="mut">{W.config.machines.noNumber}</span>}</td>
        <td>{W.config.machines.kinds[m.kind]}</td>
        <td><input type="text" value={make} maxLength={64} aria-label={`${W.config.machines.make}: ${m.name}`} onChange={(e) => setMake(e.target.value)} onKeyDown={keys} style={{ width: '8em' }} /></td>
        <td><input type="text" value={model} maxLength={64} aria-label={`${W.config.machines.model}: ${m.name}`} onChange={(e) => setModel(e.target.value)} onKeyDown={keys} style={{ width: '8em' }} /></td>
        <td>
          <input type="text" value={name} required maxLength={64} autoFocus aria-label={`${W.config.machines.name}: ${m.name}`} onChange={(e) => setName(e.target.value)} onKeyDown={keys} style={{ width: '10em' }} />
          <input type="text" value={notes} maxLength={255} aria-label={`${W.config.machines.notes}: ${m.name}`} placeholder={W.config.machines.notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={keys} style={{ width: '16em', display: 'block', marginTop: 6 }} />
        </td>
        <td>{m.isActive ? W.config.yes : <span className="acc">{W.config.no}</span>}</td>
        <td>{stationCell}</td>
        <td className="n">
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary" disabled={busy || !changed || name.trim() === ''} onClick={() => onSave(patch)}>{W.config.save}</button>
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>{W.config.cancel}</button>
          </div>
        </td>
      </tr>
      {worthARow(outcome) && (
        <tr>
          <td colSpan={8}><Said outcome={outcome} quiet /></td>
        </tr>
      )}
    </>
  );
}

/* --------------------------------------------------------- add a machine */

function NewMachineForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [machineNo, setMachineNo] = useState('');
  const [kind, setKind] = useState<MachineKind>('winder');
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState('');
  const w = useWrite();

  if (!open) {
    return (
      <>
        {/* Opening clears the last outcome, so a fresh form does not open
            under the previous add's "… added." */}
        <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => { w.say(null); setOpen(true); }}>
          {W.config.machines.add}
        </button>
        {/* The outcome of the LAST add stays visible after the form closes:
            "Winder 15 added, and station 15 with it" is the sentence the
            admin came for, and it would vanish with the form otherwise. */}
        <Said outcome={w.outcome} />
      </>
    );
  }

  const no = machineNo.trim() === '' ? null : Number(machineNo);
  const noValid = no === null || (Number.isInteger(no) && no >= 0);

  return (
    <form
      style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!noValid) return;
        const label = name.trim();
        void w.run(
          () => adminCreateMachine({ machineNo: no, kind, name: label, make: textOrNull(make), model: textOrNull(model), notes: textOrNull(notes) }),
          () => {
            setOpen(false);
            setMachineNo('');
            setName('');
            setMake('');
            setModel('');
            setNotes('');
            setKind('winder');
            onCreated();
          },
          (r) => (r.stationCreated && no != null ? W.config.machines.addedWithStation(label, no) : W.config.machines.added(label)),
        );
      }}
    >
      <label className="field">
        <span>{W.config.machines.number}</span>
        <input type="number" min={0} step={1} value={machineNo} autoFocus onChange={(e) => setMachineNo(e.target.value)} />
        <span>{W.config.machines.numberNote}</span>
      </label>
      <label className="field">
        <span>{W.config.machines.kind}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as MachineKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{W.config.machines.kinds[k]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{W.config.machines.name}</span>
        <input type="text" value={name} required maxLength={64} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.machines.make}</span>
        <input type="text" value={make} maxLength={64} onChange={(e) => setMake(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.machines.model}</span>
        <input type="text" value={model} maxLength={64} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.machines.notes}</span>
        <input type="text" value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <Said outcome={w.outcome} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || !noValid || name.trim() === ''}>{W.config.add}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.config.cancel}</button>
      </div>
    </form>
  );
}
