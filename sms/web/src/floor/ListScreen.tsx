/**
 * Sacks / Cones — every reading, newest first, in big type, with ONE time
 * selector (the section column's four scopes). While the scope is still open
 * (this shift, today) the newest page is re-read every fifteen seconds and new
 * rows slide in at the top, so a person watching the screen sees each sack
 * appear as it is weighed. Tap a row for its card.
 */
import { useEffect, useRef, useState } from 'react';
import { getEvents, type RegisterRow } from '../api';
import { LIST_POLL_MS, useLive } from './live';
import { parseScope, scopeWindow, type ScopeKey, type ScopeWindow } from './scope';
import { S } from './strings';
import { addDays, fmtClock, fmtClockSec, fmtDay, fmtDayLong, fmtG, fmtInt, fmtKg } from './fmt';
import { Pill, ReplayBanner, LiveFooter } from './bits';
import { RecordCard } from './RecordCard';

export type Kind = 'sack' | 'cone';
const PAGE = 50;
const rowId = (r: RegisterRow) => String(r.source_row_id);

/** Newest-first union of two pages, by row id; reports which ids were new. */
export function mergeRows(existing: RegisterRow[], incoming: RegisterRow[]): { rows: RegisterRow[]; added: string[] } {
  const seen = new Set(existing.map(rowId));
  const fresh: RegisterRow[] = [];
  const added: string[] = [];
  for (const r of incoming) {
    const id = rowId(r);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(r);
    added.push(id);
  }
  if (fresh.length === 0) return { rows: existing, added };
  const rows = [...fresh, ...existing].sort((a, b) => {
    const d = new Date(b.production_ts_utc).getTime() - new Date(a.production_ts_utc).getTime();
    return d !== 0 ? d : Number(b.source_row_id) - Number(a.source_row_id);
  });
  return { rows, added };
}

const SHIFT_NAMES: Record<string, string> = S.shiftShort;

export function ListScreen({
  type,
  sub,
  detailId,
  onOpen,
  onClose,
  onOpenOther,
}: {
  type: Kind;
  sub: string;
  detailId: string | null;
  onOpen: (id: string | number) => void;
  onClose: () => void;
  onOpenOther: (type: Kind, id: string | number) => void;
}) {
  const live = useLive();
  const scope: ScopeKey = parseScope(sub);
  const [day, setDay] = useState('');
  const anchor = live.line
    ? { shiftStartUtc: live.line.shift.startUtc, shiftDate: live.line.shift.shiftDate, plantNowUtc: live.line.plantNowUtc }
    : null;
  const anchorDate = anchor?.shiftDate ?? '';
  useEffect(() => {
    if (scope === 'day' && !day && anchorDate) setDay(anchorDate);
  }, [scope, day, anchorDate]);

  const win: ScopeWindow | null = anchor ? scopeWindow(scope, anchor, day || undefined) : null;
  // The window's identity ignores tsTo: the plant clock advances every poll
  // and must not restart the list. tsTo is read from a ref at request time.
  const winKey = win ? `${type}|${scope}|${win.from ?? ''}|${win.to ?? ''}|${win.tsFrom ?? ''}` : '';
  const winRef = useRef(win);
  winRef.current = win;

  const [rows, setRows] = useState<RegisterRow[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const query = (p: number) => {
    const w = winRef.current;
    if (!w) return Promise.reject(new Error('no window'));
    return getEvents({
      type, from: w.from, to: w.to, tsFrom: w.tsFrom, tsTo: w.tsTo,
      sort: 'time', dir: 'desc', page: p, pageSize: PAGE,
    });
  };

  // First page whenever the window changes.
  useEffect(() => {
    if (!winKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setRows([]);
    setFresh(new Set());
    query(1)
      .then((r) => {
        if (cancelled) return;
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => !cancelled && setError(String((e as Error).message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winKey]);

  // Re-read the newest page while the window is still open; merge new rows in.
  const isLive = win?.live ?? false;
  useEffect(() => {
    if (!winKey || !isLive) return;
    let cancelled = false;
    const id = window.setInterval(() => {
      query(1)
        .then((r) => {
          if (cancelled) return;
          setTotal(r.data.total);
          const m = mergeRows(rowsRef.current, r.data.rows);
          if (m.added.length) {
            setRows(m.rows);
            setFresh((f) => new Set([...f, ...m.added]));
          }
          setError(null);
        })
        .catch((e) => !cancelled && setError(String((e as Error).message ?? e)));
    }, LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winKey, isLive]);

  const more = () => {
    const p = page + 1;
    setPage(p);
    setBusy(true);
    query(p)
      .then((r) => {
        setTotal(r.data.total);
        setRows((prev) => mergeRows(prev, r.data.rows).rows);
      })
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setBusy(false));
  };

  if (detailId) {
    return <RecordCard type={type} id={detailId} onBack={onClose} onOpen={onOpenOther} />;
  }

  if (!live.line) {
    if (live.loading) return <div className="sk sk-ribbon" aria-busy="true" />;
    return (
      <div className="error-card" role="alert">
        <b>{S.offline}</b> {live.error}
      </div>
    );
  }

  const noun = type === 'sack' ? S.sacks : S.cones;
  const scopeDetail =
    scope === 'shift'
      ? `${S.shift[live.line.shift.code]} · ${S.scopeNote.shift} (${fmtClock(live.line.shift.startUtc)})`
      : scope === 'today'
        ? fmtDayLong(anchorDate)
        : scope === 'yesterday'
          ? fmtDayLong(addDays(anchorDate, -1))
          : day
            ? fmtDayLong(day)
            : '';

  return (
    <div className="flist">
      <ReplayBanner />
      <header className="list-head">
        <div>
          <div className="eyebrow">
            {S.scope[scope]} · {scopeDetail}
          </div>
          <h2 className="list-title">
            {loading ? '…' : fmtInt(total)} {noun.toLowerCase()}
            {isLive && <span className="live-dot" title={S.live} aria-label={S.live} />}
          </h2>
        </div>
        <div className="list-controls">
          {scope === 'day' && (
            <input
              type="date"
              className="ov-date"
              aria-label={S.scope.day}
              value={day}
              max={anchorDate}
              onChange={(e) => setDay(e.target.value)}
            />
          )}
          <span className="mono-note">{S.newestFirst}</span>
        </div>
      </header>

      {error && (
        <div className="error-card" role="alert">
          <b>{S.offline}</b> {error}
        </div>
      )}

      {loading ? (
        <div className="sk sk-ribbon" aria-busy="true" />
      ) : rows.length === 0 ? (
        <div className="empty-note">{S.nothingInScope}</div>
      ) : (
        <div className="lrows">
          {rows.map((r) => (
            <button
              key={rowId(r)}
              type="button"
              className={`lrow${fresh.has(rowId(r)) ? ' fresh' : ''}`}
              onClick={() => onOpen(r.source_row_id)}
            >
              <span className="lr-id">
                {type === 'sack' ? `#${r.sack_num ?? '—'}` : `${S.station} ${r.source_station ?? '—'}`}
              </span>
              <span className="lr-w">{type === 'sack' ? fmtKg(r.weight_kg) : fmtG(r.weight_g)}</span>
              <Pill inRange={r.in_range} />
              <span className="lr-t">
                <b>{fmtClockSec(r.production_ts_utc)}</b>
                <small>
                  {fmtDay(r.production_ts_utc)} · {SHIFT_NAMES[r.shift_code] ?? r.shift_code}
                </small>
              </span>
              <span className="lr-go" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}

      {!loading && rows.length < total && (
        <div className="list-more">
          <button type="button" className="btn-more" onClick={more} disabled={busy}>
            {busy ? S.loading : `${S.showMore} · ${fmtInt(total - rows.length)}`}
          </button>
        </div>
      )}

      <LiveFooter />
    </div>
  );
}
