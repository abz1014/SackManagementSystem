/**
 * Data checks: every standing finding, with an Acknowledge control for engineers and above (rank 2) on the checks the
 * server says are acknowledgeable. A system-state check never gets a control, not even a disabled one. No optimistic UI:
 * the list is re-read after the server answers, and a refusal is printed in the server's own words.
 */
import { useState } from 'react';
import { ackDqFinding, ApiError, getDqDestination, type DqFinding } from '../../../bridge/api';
import { dqRawTableFor } from '../../../bridge/system';
import { fmt } from '../../../bridge/lib';
import { reasonValid, ReasonField } from '../../../ui/Field';
import { WriteGate } from '../../../ui/WriteGate';
import { StatusPill } from '../../../ui/StatusPill';
import { ENGINEER_RANK } from '../../../ranks';
import { SY, TECH } from '../systemCopy';
import { severityState } from './model';

const D = SY.diag.checks;

const title = (name: string) => {
  const t = name.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Watch and Act in the state kit; Info as a plain word (it is not a state). */
function Severity({ severity }: { severity: string }) {
  const st = severityState(severity);
  if (st === null) return <span className="sy-info">{D.severity[severity] ?? severity}</span>;
  return <StatusPill state={st} />;
}

function AckControl({ finding, onDone }: { finding: DqFinding; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="wr-btn" onClick={() => setOpen(true)}>
        {D.acknowledge}
      </button>
    );
  }
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ackDqFinding(finding.findingId, reason.trim());
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? (e.detail ?? e.message) : D.ackFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="sy-ack"
      onSubmit={(e) => {
        e.preventDefault();
        if (reasonValid(reason)) void submit();
      }}
    >
      <ReasonField label={D.reasonLabel} value={reason} onChange={setReason} disabled={busy} />
      {err && <p className="wr-field__error" role="alert">{err}</p>}
      <div className="sy-actions">
        <button type="submit" className="ui-btn" disabled={busy || !reasonValid(reason)}>{busy ? D.recording : D.record}</button>
        <button type="button" className="wr-btn" onClick={() => { setOpen(false); setErr(null); }}>{D.cancel}</button>
      </div>
    </form>
  );
}

function SourceLink({ finding, onOpen }: { finding: DqFinding; onOpen: (type: 'cone' | 'sack' | 'reject', id: number) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'gone'>('idle');
  if (finding.subjectRef == null) return null;
  if (finding.subjectTable === 'reject_event') return <p className="sy-note">{D.sourceAmbiguous}</p>;
  const raw = dqRawTableFor(finding.subjectTable);
  if (raw == null) return null;
  if (state === 'gone') return <p className="sy-note">{D.sourceGone}</p>;
  return (
    <button
      type="button"
      className="ui-link"
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        try {
          const dest = await getDqDestination(raw, finding.subjectRef!);
          setState('idle');
          onOpen(dest.type, dest.id);
        } catch (e) {
          setState(e instanceof ApiError && e.status === 404 ? 'gone' : 'idle');
        }
      }}
    >
      {state === 'busy' ? D.sourceBusy : D.sourceRow}
    </button>
  );
}

export function DqFindings({
  findings, rank, onChanged, onOpenReading,
}: {
  findings: readonly DqFinding[];
  rank: number;
  onChanged: () => void;
  onOpenReading: (type: 'cone' | 'sack' | 'reject', id: number) => void;
}) {
  const acked = findings.filter((f) => f.acknowledgedUtc != null).length;
  if (findings.length === 0) return <p className="sy-note">{D.none}</p>;
  return (
    <>
      {acked > 0 && <p className="sy-note">{D.ackSummary(acked)}</p>}
      <ul className="sy-find">
        {findings.map((f) => (
          <li key={f.findingId}>
            <div className="sy-find__tx">
              <b>{title(f.checkName)}</b>
              {f.detail && <span>{f.detail}</span>}
              <SourceLink finding={f} onOpen={onOpenReading} />
              <details className="sy-tech">
                <summary>{SY.diag.sources.detail}</summary>
                <p className="sy-note">{TECH.checkName(f.checkName)}</p>
                {f.subjectTable && <p className="sy-note">{TECH.subjectTable(f.subjectTable)}</p>}
              </details>
            </div>
            <div className="sy-find__side">
              <Severity severity={f.severity} />
              {f.acknowledgedUtc != null ? (
                <span className="sy-acked">
                  {f.acknowledgedBy ? D.ackBy(f.acknowledgedBy, fmt.fmtAppInstant(f.acknowledgedUtc)) : D.ackByUnknown(fmt.fmtAppInstant(f.acknowledgedUtc))}
                  {f.acknowledgedReason && <i>{`“${f.acknowledgedReason}”`}</i>}
                </span>
              ) : f.acknowledgeable ? (
                <WriteGate rank={rank} minRank={ENGINEER_RANK}>
                  <AckControl finding={f} onDone={onChanged} />
                </WriteGate>
              ) : (
                <span className="sy-note">{D.systemState}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
