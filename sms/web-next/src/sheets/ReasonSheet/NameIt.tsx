/**
 * "Name it": the one write on this screen and its sheet (PUT /api/reject-codes/:id, TRACE A1-040, A4-13).
 * Absent below the engineer rank; at rank with writes off the control is disabled and the server's
 * own reason is printed verbatim (WriteGate). No optimistic UI: the editor stays open until the server
 * says yes, and a refusal is shown with the server's own words.
 */
import { useId, useState } from 'react';
import { setRejectLabel } from '../../bridge/api';
import { ENGINEER_RANK } from '../../ranks';
import { WriteGate } from '../../ui/WriteGate';
import { R } from '../../screens/Quality/Rejects/strings';
import './reasonSheet.css';

export interface NameItProps {
  rank: number;
  /** null: the code has no row to name yet, so nothing is offered. */
  codeId: number | null;
  /** The current name, null while unnamed. */
  label: string | null;
  /** The server's reason that writes are off, printed verbatim. null = writes are on. */
  disabledReason?: string | null;
  /** Called after the server accepted the name (refetch the reasons). */
  onSaved: () => void;
}

export function NameIt({ rank, codeId, label, disabledReason = null, onSaved }: NameItProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (codeId == null) return null;

  const save = async () => {
    setBusy(true);
    try {
      await setRejectLabel(codeId, draft.trim() === '' ? null : draft.trim());
      setError(null);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="rs-nameit">
      <WriteGate rank={rank} minRank={ENGINEER_RANK} disabledReason={disabledReason}>
        <button
          type="button"
          className="ui-link"
          onClick={() => {
            setDraft(label ?? '');
            setError(null);
            setEditing(true);
          }}
        >
          {label ? R.rename : R.nameIt}
        </button>
      </WriteGate>
      {editing && rank >= ENGINEER_RANK && (
        <span className="rs-nameit__form">
          <label className="ui-sr" htmlFor={id}>{R.nameLabel}</label>
          <input
            id={id}
            className="wr-input"
            type="text"
            value={draft}
            maxLength={128}
            autoFocus
            placeholder={R.nameHint}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !busy) void save();
            }}
          />
          <button type="button" className="ui-btn" disabled={busy} onClick={() => void save()}>{R.save}</button>
          <button type="button" className="ui-link" onClick={() => setEditing(false)}>{R.cancel}</button>
        </span>
      )}
      {error && (
        <span className="rs-nameit__err" role="alert">
          {R.saveFailed} {error}
        </span>
      )}
    </span>
  );
}
