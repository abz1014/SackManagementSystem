/**
 * Setup › Sources — the source systems by role, and the four tables this
 * line reads from them.
 *
 * Until roadmap Phase 1 (14 Sep 2026) the table names were a const array in
 * the sync worker (IFL_TABLES), so a renamed table — or a second line, whose
 * tables carry its own suffix — was a code change. They are rows now
 * (sms.source_table), and the worker reads them before every pass.
 *
 * Two things the section is careful to say. Server, database and login are
 * NOT here: they stay in .env on the plant PC, and a row only names which
 * block it uses. And changing a table name is not a rename: to the worker a
 * different table is a different source generation, and it halts on one it
 * has not been told about — the API says so in its `note`, printed verbatim
 * under the row, because the admin who just typed the name is the one who
 * needs to run `sms epoch:accept` next.
 */
import { useState } from 'react';
import {
  adminGetSources, adminUpdateSource, adminUpdateSourceTable, SOURCE_TABLE_NAME,
  type DataSourceRow, type SourceTableRow,
} from '../../api';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { Said, YesNo, sameText, textOrNull, useResource, useWrite, worthARow } from './shared';

export function SourcesBlock() {
  const res = useResource(() => adminGetSources());

  if (res.error) return <Block label={W.setupTabs.sources}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.sources}><SkelLines n={5} short /></Block>;

  const { sources, tables } = res.data;

  return (
    <Block label={W.setupTabs.sources} note={W.config.sources.note}>
      <p className="mut sm" style={{ marginBottom: 14 }}>{W.config.sources.intro}</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{W.config.sources.colSource}</th>
              <th>{W.config.sources.colRole}</th>
              <th>{W.config.sources.colConnection}</th>
              <th>{W.config.sources.colEnabled}</th>
              <th>{W.config.sources.colNotes}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <SourceTr key={s.dataSourceId} s={s} onChanged={res.reload} />
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 24, marginBottom: 10, fontWeight: 500 }}>{W.config.sources.tablesTitle}</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{W.config.sources.colKind}</th>
              <th>{W.config.sources.colTable}</th>
              <th>{W.config.sources.colRaw}</th>
              <th>{W.config.sources.colEnabled}</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <TableTr key={t.sourceTableId} t={t} onChanged={res.reload} />
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

/* ------------------------------------------------------------ one source */

function SourceTr({ s, onChanged }: { s: DataSourceRow; onChanged: () => void }) {
  const w = useWrite();
  const commitLabel = (v: string) => {
    const label = v.trim();
    if (label === '' || sameText(label, s.label)) return;
    void w.run(() => adminUpdateSource(s.dataSourceId, { label }), onChanged);
  };
  const commitNotes = (v: string) => {
    if (sameText(v, s.notes)) return;
    void w.run(() => adminUpdateSource(s.dataSourceId, { notes: textOrNull(v) }), onChanged);
  };

  return (
    <>
      <tr>
        <td>
          {/* defaultValue + commit on blur/Enter, keyed on the saved value so
              a failed write snaps the field back to what is actually stored
              rather than leaving the unsaved text looking saved. */}
          <input
            key={s.label}
            type="text"
            defaultValue={s.label}
            maxLength={128}
            disabled={w.busy}
            aria-label={`${W.config.sources.colSource}: ${s.label}`}
            onBlur={(e) => commitLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ width: '15em', maxWidth: '100%' }}
          />
          <span className="mut sm" style={{ display: 'block' }}>{s.systemCode}</span>
        </td>
        <td>{W.config.sources.roles[s.role] ?? s.role}</td>
        <td>{s.connectionKey}</td>
        <td>
          <YesNo
            value={s.isEnabled}
            busy={w.busy}
            label={`${W.config.sources.colEnabled}: ${s.label}`}
            onToggle={() => void w.run(() => adminUpdateSource(s.dataSourceId, { isEnabled: !s.isEnabled }), onChanged)}
          />
        </td>
        <td>
          <input
            key={s.notes ?? ''}
            type="text"
            defaultValue={s.notes ?? ''}
            maxLength={255}
            disabled={w.busy}
            aria-label={`${W.config.sources.colNotes}: ${s.label}`}
            onBlur={(e) => commitNotes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ width: '14em', maxWidth: '100%' }}
          />
          {/* The seeded state of the packing source is a question for IFL,
              not a fact about the plant; the row says so. */}
          {s.role === 'sack_packing' && !s.isEnabled && (
            <span className="mut sm" style={{ display: 'block', maxWidth: '40ch' }}>{W.config.sources.packingUnknown}</span>
          )}
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

/* ------------------------------------------------------------- one table */

function TableTr({ t, onChanged }: { t: SourceTableRow; onChanged: () => void }) {
  const [invalid, setInvalid] = useState(false);
  const w = useWrite();

  const commitName = (v: string) => {
    const name = v.trim();
    if (sameText(name, t.sourceTable)) {
      setInvalid(false);
      return;
    }
    // The server validates the same pattern (an identifier, bracket-quoted
    // into the query — never a parameter); saying so here spares the round
    // trip and the word "invalid".
    if (!SOURCE_TABLE_NAME.test(name)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void w.run(() => adminUpdateSourceTable(t.sourceTableId, { sourceTable: name }), onChanged);
  };

  return (
    <>
      <tr>
        <td>{W.config.sources.kinds[t.kind] ?? t.kind}</td>
        <td>
          <input
            key={t.sourceTable}
            type="text"
            defaultValue={t.sourceTable}
            maxLength={128}
            disabled={w.busy}
            aria-label={`${W.config.sources.colTable}: ${W.config.sources.kinds[t.kind] ?? t.kind}`}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ width: '16em', maxWidth: '100%' }}
          />
          {invalid && <span className="acc sm" style={{ display: 'block' }}>{W.config.sources.tableNameInvalid}</span>}
        </td>
        <td>{t.rawTable}</td>
        <td>
          <YesNo
            value={t.isEnabled}
            busy={w.busy}
            label={`${W.config.sources.colEnabled}: ${t.sourceTable}`}
            onToggle={() => void w.run(() => adminUpdateSourceTable(t.sourceTableId, { isEnabled: !t.isEnabled }), onChanged)}
          />
        </td>
      </tr>
      {/* Every outcome, including success: the API's note about the next
          worker pass and the generation halt is the point of this row. */}
      {worthARow(w.outcome) && (
        <tr>
          <td colSpan={4}><Said outcome={w.outcome} quiet /></td>
        </tr>
      )}
    </>
  );
}
