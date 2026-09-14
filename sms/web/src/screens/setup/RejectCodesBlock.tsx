/**
 * Setup › Reject codes — what each inspection code means, whether it counts
 * as a pass, and how serious it is.
 *
 * The codes themselves arrive from the plant: the sync worker creates a
 * sms.reject_code row the first time it sees a (type, tube code, material
 * code) triple, so this table lists what the readings have carried, never a
 * catalogue. IFL has not supplied the meanings, and until they do Rejects
 * prints "code 3/0 — not yet named". A manager can name one from Rejects as
 * well; this is the one place all three fields are editable together
 * (roadmap Phase 1, 14 Sep 2026).
 *
 * The label is joined at read time and stamped on no row, so a name given
 * here applies to history. The pass flag and the severity are the same:
 * per code, not per reading.
 */
import { getRejectCodes, setRejectCode, type RejectCodeRow, type RejectSeverity } from '../../api';
import { W } from '../../lib/words';
import { Block, Empty, Failed, SkelLines } from '../../ui/bits';
import { Said, sameText, textOrNull, useResource, useWrite, worthARow } from './shared';

const SEVERITIES: RejectSeverity[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

/** yes / no / not known ↔ true / false / null, as the select carries them. */
const passToValue = (p: boolean | null): 'yes' | 'no' | 'unknown' => (p === true ? 'yes' : p === false ? 'no' : 'unknown');
const valueToPass = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export function RejectCodesBlock() {
  const res = useResource(() => getRejectCodes());

  if (res.error) return <Block label={W.setupTabs.rejectCodes}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.rejectCodes}><SkelLines n={5} short /></Block>;
  if (res.data.codes.length === 0) return <Block label={W.setupTabs.rejectCodes}><Empty message={W.config.rejectCodes.none} /></Block>;

  return (
    <Block label={W.setupTabs.rejectCodes} note={W.config.rejectCodes.note}>
      <p className="mut sm" style={{ marginBottom: 14 }}>{W.config.rejectCodes.intro}</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{W.config.rejectCodes.colType}</th>
              <th>{W.config.rejectCodes.colTube}</th>
              <th>{W.config.rejectCodes.colMaterial}</th>
              <th>{W.config.rejectCodes.colLabel}</th>
              <th>{W.config.rejectCodes.colPass}</th>
              <th>{W.config.rejectCodes.colSeverity}</th>
            </tr>
          </thead>
          <tbody>
            {res.data.codes.map((c) => (
              <CodeTr key={c.rejectCodeId} c={c} onChanged={res.reload} />
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function CodeTr({ c, onChanged }: { c: RejectCodeRow; onChanged: () => void }) {
  const w = useWrite();
  const who = `${W.config.rejectCodes.types[c.rejectType] ?? c.rejectType} ${c.tubeCode ?? '—'}/${c.materialCode ?? '—'}`;
  // One field per write, so the audit row names exactly what changed.
  const commitLabel = (v: string) => {
    if (sameText(v, c.label)) return;
    void w.run(() => setRejectCode(c.rejectCodeId, { label: textOrNull(v) }), onChanged);
  };
  const commitPass = (v: string) => {
    const next = valueToPass(v);
    if (next === c.isPass) return;
    void w.run(() => setRejectCode(c.rejectCodeId, { isPass: next }), onChanged);
  };
  const commitSeverity = (v: string) => {
    const next = v === '' ? null : (v as RejectSeverity);
    if (next === c.severity) return;
    void w.run(() => setRejectCode(c.rejectCodeId, { severity: next }), onChanged);
  };
  const plain = { border: 0, background: 'none', padding: 0, font: 'inherit' } as const;

  return (
    <>
      <tr>
        <td>{W.config.rejectCodes.types[c.rejectType] ?? c.rejectType}</td>
        <td>{c.tubeCode ?? <span className="mut">—</span>}</td>
        <td>{c.materialCode ?? <span className="mut">—</span>}</td>
        <td>
          {/* Keyed on the saved label: a failed write snaps the field back to
              what is stored, rather than leaving unsaved text looking saved. */}
          <input
            key={c.label ?? ''}
            type="text"
            defaultValue={c.label ?? ''}
            placeholder={W.config.rejectCodes.unnamed}
            maxLength={128}
            disabled={w.busy}
            aria-label={`${W.config.rejectCodes.colLabel}: ${who}`}
            onBlur={(e) => commitLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ width: '18em', maxWidth: '100%' }}
          />
        </td>
        <td>
          {/* defaultValue + commit on blur, as People's role select: a
              <select> fires change on every arrow key. */}
          <select
            key={`pass:${String(c.isPass)}`}
            defaultValue={passToValue(c.isPass)}
            disabled={w.busy}
            aria-label={`${W.config.rejectCodes.colPass}: ${who}`}
            onBlur={(e) => commitPass(e.target.value)}
            style={plain}
          >
            <option value="yes">{W.config.rejectCodes.pass.yes}</option>
            <option value="no">{W.config.rejectCodes.pass.no}</option>
            <option value="unknown">{W.config.rejectCodes.pass.unknown}</option>
          </select>
        </td>
        <td>
          <select
            key={`sev:${c.severity ?? ''}`}
            defaultValue={c.severity ?? ''}
            disabled={w.busy}
            aria-label={`${W.config.rejectCodes.colSeverity}: ${who}`}
            onBlur={(e) => commitSeverity(e.target.value)}
            style={plain}
          >
            <option value="">{W.config.rejectCodes.severities.none}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{W.config.rejectCodes.severities[s]}</option>
            ))}
          </select>
        </td>
      </tr>
      {worthARow(w.outcome) && (
        <tr>
          <td colSpan={6}><Said outcome={w.outcome} quiet /></td>
        </tr>
      )}
    </>
  );
}
