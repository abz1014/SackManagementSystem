/**
 * One sack or one cone, in plain words. No merge keys, transform versions or
 * source systems here — that provenance lives in Records for the people who
 * need it. The card says what was weighed, how much, whether it passed, when,
 * and on which shift and station.
 *
 * The related list is honest about what the plant records. There is no key
 * from a cone to its sack (SCHEMA.md), and cone counts between consecutive
 * sack timestamps range from 0 to 250 rather than clustering at 25 — so a
 * sack's card shows "cones weighed between the previous sack and this one" as
 * context, with that caveat printed, and never claims a packing list.
 */
import { useEffect, useState } from 'react';
import { getEventDetail, getEvents, type RegisterRow } from '../api';
import { S } from './strings';
import { fmtClockSec, fmtDay, fmtDayLong, fmtG, fmtInt, fmtKg, fmtSpan, secondsBetween } from './fmt';
import { Pill } from './bits';

type Kind = 'sack' | 'cone';
const MAX_WINDOW_MS = 10 * 60_000;

interface Related {
  /** For a sack: cones in the window; for a cone: the next sack (0 or 1). */
  rows: RegisterRow[];
  windowFrom: string | null;
  note: string;
}

const SHIFT_NAMES: Record<string, string> = S.shift;

export function RecordCard({
  type,
  id,
  onBack,
  onOpen,
}: {
  type: Kind;
  id: string;
  onBack: () => void;
  onOpen: (type: Kind, id: string | number) => void;
}) {
  const [row, setRow] = useState<RegisterRow | null>(null);
  const [related, setRelated] = useState<Related | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRow(null);
    setRelated(null);
    (async () => {
      const r = (await getEventDetail(type, id)).row;
      if (cancelled) return;
      setRow(r);
      const ts = new Date(r.production_ts_utc);
      if (type === 'sack') {
        const before = new Date(ts.getTime() - 1).toISOString();
        const prev = await getEvents({ type: 'sack', tsTo: before, sort: 'time', dir: 'desc', page: 1, pageSize: 1 });
        const prevTs = prev.data.rows[0]?.production_ts_utc ?? null;
        const floor = ts.getTime() - MAX_WINDOW_MS;
        const fromMs = prevTs ? Math.max(new Date(prevTs).getTime(), floor) : floor;
        const from = new Date(fromMs).toISOString();
        const cones = await getEvents({
          type: 'cone', tsFrom: from, tsTo: ts.toISOString(), sort: 'time', dir: 'desc', page: 1, pageSize: 300,
        });
        if (cancelled) return;
        setRelated({
          rows: cones.data.rows,
          windowFrom: from,
          note: prevTs ? S.conesBeforeSackNote : `${S.noPreviousSack} ${S.conesBeforeSackNote}`,
        });
      } else {
        const next = await getEvents({
          type: 'sack', tsFrom: ts.toISOString(), sort: 'time', dir: 'asc', page: 1, pageSize: 1,
        });
        if (cancelled) return;
        setRelated({ rows: next.data.rows, windowFrom: null, note: S.nextSackNote });
      }
    })()
      .catch((e) => !cancelled && setError(String((e as Error).message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  return (
    <div className="card">
      <button type="button" className="card-back" onClick={onBack}>
        ← {S.back}
      </button>

      {error ? (
        <div className="error-card" role="alert">
          <b>{S.notFound}</b> {error}
        </div>
      ) : !row ? (
        <div className="sk sk-ribbon" aria-busy="true" />
      ) : (
        <>
          <header className="card-head">
            <div className="eyebrow">
              {type === 'sack' ? S.sack : S.cone} · {SHIFT_NAMES[row.shift_code] ?? row.shift_code}
            </div>
            <h2 className="card-title">
              {type === 'sack' ? `${S.sack} #${row.sack_num ?? '—'}` : `${S.cone} · ${S.station} ${row.source_station ?? '—'}`}
            </h2>
            <div className="card-weight">
              {type === 'sack' ? fmtKg(row.weight_kg) : fmtG(row.weight_g)}
              <Pill inRange={row.in_range} big />
            </div>
            <div className="card-when">
              {S.weighedAt} {fmtDayLong(row.production_ts_utc.slice(0, 10))}, {fmtClockSec(row.production_ts_utc)}
            </div>
          </header>

          <dl className="card-grid">
            <div>
              <dt>{S.weight}</dt>
              <dd>{type === 'sack' ? fmtKg(row.weight_kg) : fmtG(row.weight_g)}</dd>
            </div>
            <div>
              <dt>{S.inRange}</dt>
              <dd><Pill inRange={row.in_range} /></dd>
            </div>
            <div>
              <dt>{S.time}</dt>
              <dd>{fmtClockSec(row.production_ts_utc)}</dd>
            </div>
            {type === 'cone' && (
              <>
                <div>
                  <dt>{S.station}</dt>
                  <dd>{row.source_station ?? '—'}</dd>
                </div>
                <div>
                  <dt>{S.hanger}</dt>
                  <dd>{row.hanger_num ?? '—'}</dd>
                </div>
              </>
            )}
            {type === 'sack' && (
              <div>
                <dt>{S.sack}</dt>
                <dd>#{row.sack_num ?? '—'}</dd>
              </div>
            )}
            <div>
              <dt>{S.recordNo}</dt>
              <dd className="mono">{String(row.source_row_id)}</dd>
            </div>
          </dl>

          <section className="panel card-related">
            <div className="panel-head">
              <h3 className="panel-title">{type === 'sack' ? S.conesBeforeSack : S.nextSackAfterCone}</h3>
              {related && type === 'sack' && related.windowFrom && (
                <span className="mono-note">
                  {fmtClockSec(related.windowFrom)} – {fmtClockSec(row.production_ts_utc)} ·{' '}
                  {fmtSpan(secondsBetween(related.windowFrom, row.production_ts_utc))} · {fmtInt(related.rows.length)} {S.cones.toLowerCase()}
                </span>
              )}
            </div>
            {loading && !related ? (
              <div className="sk sk-ribbon" aria-busy="true" />
            ) : !related || related.rows.length === 0 ? (
              <div className="empty-note">{S.nothingInScope}</div>
            ) : (
              <div className="lrows compact">
                {related.rows.map((r) => {
                  const kind: Kind = type === 'sack' ? 'cone' : 'sack';
                  return (
                    <button key={String(r.source_row_id)} type="button" className="lrow" onClick={() => onOpen(kind, r.source_row_id)}>
                      <span className="lr-id">
                        {kind === 'sack' ? `#${r.sack_num ?? '—'}` : `${S.station} ${r.source_station ?? '—'}`}
                      </span>
                      <span className="lr-w">{kind === 'sack' ? fmtKg(r.weight_kg) : fmtG(r.weight_g)}</span>
                      <Pill inRange={r.in_range} />
                      <span className="lr-t">
                        <b>{fmtClockSec(r.production_ts_utc)}</b>
                        <small>{fmtDay(r.production_ts_utc)}</small>
                      </span>
                      <span className="lr-go" aria-hidden="true">›</span>
                    </button>
                  );
                })}
              </div>
            )}
            {related && <div className="panel-foot">{related.note}</div>}
          </section>
        </>
      )}
    </div>
  );
}
