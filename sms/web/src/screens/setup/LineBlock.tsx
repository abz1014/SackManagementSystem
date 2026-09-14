/**
 * Setup › Line — the plant, unit and line names, and the display name every
 * screen prints.
 *
 * Until roadmap Phase 1 (14 Sep 2026) the line's identity was LINE_NAME in
 * .env — one string, "TP1 · Line 3 · Unit 2", which Line and Wall parsed on
 * '·' to find the word "Line". Now it is a row in sms.line with its unit and
 * plant, and this is where it is edited. PUT /api/admin/line takes only the
 * fields that changed; the audit row records old -> new for each.
 */
import { useState } from 'react';
import { adminGetLine, adminSetLine, type ConfigLine } from '../../api';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { Said, sameText, useResource, useWrite } from './shared';

export function LineBlock() {
  const res = useResource(() => adminGetLine());

  if (res.error) return <Block label={W.setupTabs.line}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.line}><SkelLines n={4} short /></Block>;

  const line = res.data.line;
  return (
    <Block label={W.setupTabs.line} note={W.config.line.note}>
      {/* Keyed on the saved names so the form re-seeds after a save, and
          after a reload that found somebody else's change. */}
      <LineForm key={`${line.plant.name}|${line.unit.name}|${line.name}|${line.displayName}`} line={line} onSaved={res.reload} />
      <p className="mut sm" style={{ marginTop: 14 }}>{W.config.line.oneLine}</p>
    </Block>
  );
}

function LineForm({ line, onSaved }: { line: ConfigLine; onSaved: () => void }) {
  const [plantName, setPlantName] = useState(line.plant.name);
  const [unitName, setUnitName] = useState(line.unit.name);
  const [lineName, setLineName] = useState(line.name);
  const [displayName, setDisplayName] = useState(line.displayName);
  const w = useWrite();

  // Only what changed goes over the wire: the route audits per field, and an
  // unchanged field sent anyway would write "name "Line 3" -> "Line 3"".
  const patch: Parameters<typeof adminSetLine>[0] = {};
  if (!sameText(plantName, line.plant.name)) patch.plantName = plantName.trim();
  if (!sameText(unitName, line.unit.name)) patch.unitName = unitName.trim();
  if (!sameText(lineName, line.name)) patch.lineName = lineName.trim();
  if (!sameText(displayName, line.displayName)) patch.displayName = displayName.trim();
  const changed = Object.keys(patch).length > 0;
  // Each name is 1..128 on the server; an emptied field is refused there
  // too, but `required` says so before the round trip.
  const empty = [plantName, unitName, lineName, displayName].some((s) => s.trim() === '');

  return (
    <form
      style={{ display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) {
          w.say({ kind: 'info', message: W.config.noChange });
          return;
        }
        void w.run(() => adminSetLine(patch), onSaved);
      }}
    >
      <label className="field">
        <span>{W.config.line.plant} · {W.config.line.code(line.plant.code)}</span>
        <input type="text" value={plantName} required maxLength={128} onChange={(e) => setPlantName(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.line.unit} · {W.config.line.code(line.unit.code)}</span>
        <input type="text" value={unitName} required maxLength={128} onChange={(e) => setUnitName(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.line.lineName} · {W.config.line.code(line.code)}</span>
        <input type="text" value={lineName} required maxLength={128} onChange={(e) => setLineName(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.config.line.displayName}</span>
        <input type="text" value={displayName} required maxLength={128} onChange={(e) => setDisplayName(e.target.value)} />
        <span>{W.config.line.displayNameNote}</span>
      </label>
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || empty}>{W.config.save}</button>
      </div>
      <Said outcome={w.outcome} />
    </form>
  );
}
