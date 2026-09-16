/**
 * One day's rejects for one reason, in a sheet over the Rejects screen
 * (roadmap Phase 5 item 1, 14 Sep 2026).
 *
 * Opened from the by-day table: `?sheet=reason:<day>|<type>|<tube>|<material>`,
 * a missing half of the code pair written as the empty string. The day is
 * the PRODUCTION day (06:00-06:00 under the line's shift rule), the same axis
 * the table uses; IFL has not confirmed production day against calendar
 * date, and the eyebrow says which this is.
 *
 * WHAT IT SAYS, and the rule behind each line:
 *  - The reason's name — the manager's label when one exists, otherwise the
 *    kind and the raw code pair, never a bare pair presented as a meaning.
 *    Renamable here at manager rank through the existing PUT, with the
 *    failure reported rather than swallowed.
 *  - Each reject: when, which station, which PRODUCT (the row's own
 *    material_id, never today's; "not recorded" for a pre-August row), the
 *    weight when the row has one (weight rejects only — a quality reject is
 *    thrown out before it is weighed), and ONE record id with its generation
 *    label beside it, because since the 5 Aug 2026 rebuild the id alone names
 *    two rows.
 *  - A link to Readings for the same day. The register has no reason filter,
 *    so that link narrows to the day and the inspection-reject listing; the
 *    reason itself is listed only here, and the link's note says so.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Chevron, Failed, Loading, rowKeys } from '../ui/bits';
import { W } from '../lib/words';
import { fmtClock, fmtDayLong, fmtG, fmtInt } from '../lib/fmt';
import {
  getRejectReason, getStations, rejectCodeParam, setRejectLabel, stationLabel,
  type RejectReasonData, type StationRow,
} from '../api';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReasonId {
  day: string;
  rejectType: 'quality' | 'weight';
  tubeCode: number | null;
  materialCode: number | null;
}

/** The sheet's id, as it travels in the URL. */
export function reasonIdOf(r: ReasonId): string {
  return `${r.day}|${r.rejectType}|${r.tubeCode ?? ''}|${r.materialCode ?? ''}`;
}

/** Null for anything malformed, so a hand-edited URL renders "could not load", not a crash. */
export function parseReasonId(raw: string): ReasonId | null {
  const parts = raw.split('|');
  if (parts.length !== 4) return null;
  const [day, type, tube, material] = parts as [string, string, string, string];
  if (!DATE_RE.test(day) || (type !== 'quality' && type !== 'weight')) return null;
  const half = (s: string): number | null | undefined => (s === '' ? null : /^\d{1,9}$/.test(s) ? Number(s) : undefined);
  const t = half(tube);
  const m = half(material);
  if (t === undefined || m === undefined) return null;
  return { day, rejectType: type, tubeCode: t, materialCode: m };
}

interface State {
  data: RejectReasonData | null;
  stations: StationRow[];
  error: string | null;
}

export function ReasonSheet({
  id,
  canName,
  onClose,
  onOpenRegister,
  onOpenReading,
  onOpenReport,
}: {
  id: string;
  canName: boolean;
  onClose: () => void;
  /** Readings, on this production day's inspection rejects. */
  onOpenRegister: (day: string) => void;
  onOpenReading: (type: 'reject', id: number) => void;
  /**
   * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.5
   * "a reject code → the days and readings behind it"). The reject report has
   * no per-code filter, so this narrows to this reason's own day, the same
   * narrowing `onOpenRegister` already uses.
   */
  onOpenReport: (day: string) => void;
}) {
  const ref = parseReasonId(id);
  const [s, setS] = useState<State>({ data: null, stations: [], error: null });
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    if (!ref) {
      setS({ data: null, stations: [], error: 'malformed reason id' });
      return;
    }
    (async () => {
      try {
        const [reason, stations] = await Promise.all([
          getRejectReason({ day: ref.day, code: rejectCodeParam(ref), pageSize: 200 }),
          getStations(),
        ]);
        if (cancelled) return;
        setS({ data: reason.data, stations: stations.stations, error: null });
      } catch (e) {
        if (!cancelled) setS((p) => ({ ...p, error: String((e as Error).message ?? e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `id` stands in for `ref`, which is derived from it on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tick]);

  const M = W.rejectsMore;
  const eyebrow = ref ? M.sheetEyebrow(fmtDayLong(ref.day)) : M.sheetTitle;

  return (
    <Sheet title={M.sheetTitle} eyebrow={eyebrow} onClose={onClose}>
      {s.error ? (
        <Failed error={s.error} onRetry={ref ? refresh : undefined} />
      ) : !s.data ? (
        <Loading />
      ) : (
        <Body
          data={s.data}
          stations={s.stations}
          canName={canName}
          onRenamed={refresh}
          onOpenRegister={onOpenRegister}
          onOpenReading={onOpenReading}
          onOpenReport={onOpenReport}
        />
      )}
    </Sheet>
  );
}

function Body({
  data,
  stations,
  canName,
  onRenamed,
  onOpenRegister,
  onOpenReading,
  onOpenReport,
}: {
  data: RejectReasonData;
  stations: StationRow[];
  canName: boolean;
  onRenamed: () => void;
  onOpenRegister: (day: string) => void;
  onOpenReading: (type: 'reject', id: number) => void;
  onOpenReport: (day: string) => void;
}) {
  const M = W.rejectsMore;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The inline rename, through the same PUT the Rejects screen uses. A
  // failure is a sentence on screen, not a silently closed editor.
  const save = async () => {
    if (data.rejectCodeId == null) return;
    setSaving(true);
    try {
      await setRejectLabel(data.rejectCodeId, draft.trim() || null);
      setSaveError(null);
      setEditing(false);
      onRenamed();
    } catch (e) {
      setSaveError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const passNote = data.isPass == null ? M.passUnknown : data.isPass ? M.pass : M.fail;
  const shown = data.rows.length;

  return (
    <>
      {/* A name, not a number, in the head step: the display step is for a
          measurement, and a reason is not one. */}
      <div className="big" style={{ fontSize: 'var(--fs-head)' }}>{data.displayLabel}</div>
      <div style={{ marginTop: 8, fontWeight: 500 }}>
        {data.total === 1 ? M.sheetCountOne(data.displayLabel) : M.sheetCount(fmtInt(data.total), data.displayLabel)}
      </div>
      <div className="g" style={{ marginTop: 6 }}>{passNote}</div>

      {canName && data.rejectCodeId != null && (
        <div style={{ marginTop: 14 }}>
          {editing ? (
            <span className="row" style={{ gap: 8 }}>
              <input
                type="text"
                value={draft}
                autoFocus
                aria-label={M.nameThisReason}
                maxLength={128}
                style={{ width: 220, fontSize: 'var(--fs-small)', padding: '2px 6px' }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setEditing(false); setSaveError(null); }
                  if (e.key === 'Enter') void save();
                }}
              />
              <button type="button" className="btn" disabled={saving} onClick={() => void save()}>{M.save}</button>
              <button type="button" className="linkish" onClick={() => { setEditing(false); setSaveError(null); }}>{M.cancel}</button>
            </span>
          ) : (
            <button type="button" className="linkish" onClick={() => { setDraft(data.label ?? ''); setEditing(true); }}>
              {data.label ? M.rename : M.nameThisReason}
            </button>
          )}
          {saveError && (
            <p className="state err sm" role="alert" style={{ padding: '8px 0' }}>
              {M.renameFailed} <span className="sr-only">{saveError}</span>
            </p>
          )}
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="state">{M.sheetEmpty}</p>
      ) : (
        <table style={{ marginTop: 22 }}>
          <thead>
            <tr>
              <th style={{ width: '7em' }}>{M.colTime}</th>
              <th style={{ width: '8em' }}>{M.colStation}</th>
              <th>{M.colProduct}</th>
              <th className="n" style={{ width: '6em' }}>{M.colWeight}</th>
              <th style={{ paddingLeft: 24 }}>{M.colRecord}</th>
              <th className="n" style={{ width: '2em' }} />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={r.eventId}
                className="click"
                tabIndex={0}
                onClick={() => onOpenReading('reject', r.eventId)}
                onKeyDown={rowKeys(() => onOpenReading('reject', r.eventId))}
              >
                <td>{fmtClock(r.productionTsUtc)}</td>
                <td>{r.station == null ? '—' : stationLabel(stations.find((x) => x.stationId === r.station), r.station)}</td>
                <td className={r.productLabel ? '' : 'g'}>{r.productLabel ?? M.noProductThen}</td>
                <td className="n">{r.weightG == null ? <span className="g">{M.notWeighed}</span> : fmtG(r.weightG)}</td>
                {/* One id, labelled with its generation: the number alone names two rows since 5 Aug 2026. */}
                <td style={{ paddingLeft: 24 }}>
                  {r.sourceRowId == null ? '—' : String(r.sourceRowId)}
                  {r.epochLabel && <span className="mut sm"> · {r.epochLabel}</span>}
                </td>
                <td className="n"><Chevron label={W.openRecord} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.total > shown && <p className="mut sm" style={{ marginTop: 8 }}>{M.sheetMore(shown, data.total)}</p>}

      <p style={{ marginTop: 22 }}>
        <button type="button" className="linkish" onClick={() => onOpenRegister(data.day)}>{M.openRegister}</button>{' '}
        <span className="mut sm">· {M.openRegisterNote}</span>
      </p>
      <p style={{ marginTop: 8 }}>
        <button type="button" className="linkish" onClick={() => onOpenReport(data.day)}>{M.openReport}</button>{' '}
        <span className="mut sm">· {M.openReportNote}</span>
      </p>
      <p className="mut sm" style={{ marginTop: 14 }}>{M.dayBasisCaveat}</p>
    </>
  );
}
