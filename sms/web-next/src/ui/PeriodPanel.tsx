import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { C, FRAGMENTS } from '../copy';
import { createPortal } from 'react-dom';
import { period as P, fmt } from '../bridge/lib';
import { fmtDate } from '../lib/fmt';
import type { PeriodState } from '../data/usePeriod';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { useMediaQuery } from './useMediaQuery';
import './components/shared.css';
import './components/period.css';

type ShiftChoice = 'whole' | P.ShiftCode;
interface Draft {
  fd: string;
  fs: ShiftChoice;
  td: string;
  ts: ShiftChoice;
}

export interface PeriodPanelProps {
  open: boolean;
  onClose: () => void;
  /** The one usePeriod() result of the chip. */
  state: PeriodState;
  /** Plant-clock anchor read from /api/live; null until it is known. */
  anchor: P.PeriodAnchor | null;
  /** Newest production day held (getRange().maxDate). */
  maxDate: string | null;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function draftFrom(period: P.Period | null): Draft {
  if (!period) return { fd: '', fs: 'whole', td: '', ts: 'whole' };
  if (period.fromShift && period.toShift) {
    const whole = period.fromShift.shift === 'morning' && period.toShift.shift === 'night';
    return {
      fd: period.fromShift.date,
      fs: whole ? 'whole' : period.fromShift.shift,
      td: period.toShift.date,
      ts: whole ? 'whole' : period.toShift.shift,
    };
  }
  if (period.shift) return { fd: period.from, fs: period.shift, td: period.to, ts: period.shift };
  return { fd: period.from, fs: 'whole', td: period.to, ts: 'whole' };
}

function refs(d: Draft): { from: P.ShiftRef; to: P.ShiftRef } {
  return {
    from: { date: d.fd, shift: d.fs === 'whole' ? 'morning' : d.fs },
    to: { date: d.td, shift: d.ts === 'whole' ? 'night' : d.ts },
  };
}

/** Why the draft cannot be applied, or null. Order is checked by the bridged range decoder. */
function invalidReason(d: Draft): string | null {
  if (!P.isRealDate(d.fd)) return C.periodUi.needStart;
  if (!P.isRealDate(d.td)) return C.periodUi.needEnd;
  const r = refs(d);
  return P.decodeRangeParams(P.encodeShiftRef(r.from), P.encodeShiftRef(r.to)) ? null : C.periodUi.endBeforeStart;
}

function ShiftSelect({ id, label, value, onChange }: { id: string; label: string; value: ShiftChoice; onChange: (v: ShiftChoice) => void }) {
  return (
    <div className="pp-fld">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="pp-input" value={value} onChange={(e) => onChange(e.target.value as ShiftChoice)}>
        {(['whole', 'morning', 'evening', 'night'] as const).map((k) => (
          <option key={k} value={k}>
            {C.periodUi.shifts[k]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PeriodPanel({ open, onClose, state, anchor, maxDate }: PeriodPanelProps) {
  if (!open) return null;
  return <PanelOpen onClose={onClose} state={state} anchor={anchor} maxDate={maxDate} />;
}

function PanelOpen({ onClose, state, anchor, maxDate }: Omit<PeriodPanelProps, 'open'>) {
  const phone = useMediaQuery('(max-width: 767px)');
  const { period, params, compare, setParams, setCompare } = state;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(period));
  const reason = invalidReason(draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const preview = anchor && !reason ? P.describePeriod(P.resolvePeriod('range', anchor, undefined, refs(draft))) : null;

  const go = (p: P.PeriodParams) => {
    setParams(p);
    onClose();
  };
  const apply = () => {
    if (reason) return;
    const r = refs(draft);
    const next = P.snapToShifts(r.from, r.to, params);
    if (next) setParams(next);
    onClose();
  };

  // Last week and Last month are plain date picks computed from the anchor.
  let lastWeek: P.PeriodParams | null = null;
  let lastMonth: P.PeriodParams | null = null;
  if (anchor) {
    const mon = P.resolvePeriod('week', anchor).from;
    lastWeek = { key: 'pick', picked: { from: fmt.addDays(mon, -7), to: fmt.addDays(mon, -1) } };
    const first = P.resolvePeriod('month', anchor).from;
    const end = fmt.addDays(first, -1);
    lastMonth = { key: 'pick', picked: { from: `${end.slice(0, 7)}-01`, to: end } };
  }
  const samePick = (p: P.PeriodParams | null) => !!p && P.samePeriodParams(params, p);

  const presets: Array<{ id: string; label: string; pressed: boolean; run: (() => void) | null }> = [
    { id: 'shift', label: C.periodUi.presets.shift, pressed: params.key === 'shift', run: () => go({ key: 'shift' }) },
    { id: 'today', label: C.periodUi.presets.today, pressed: params.key === 'today', run: () => go({ key: 'today' }) },
    { id: 'yesterday', label: C.periodUi.presets.yesterday, pressed: params.key === 'yesterday', run: () => go({ key: 'yesterday' }) },
    { id: 'week', label: C.periodUi.presets.week, pressed: params.key === 'week', run: () => go({ key: 'week' }) },
    { id: 'lastWeek', label: C.periodUi.presets.lastWeek, pressed: samePick(lastWeek), run: lastWeek ? () => go(lastWeek!) : null },
    { id: 'month', label: C.periodUi.presets.month, pressed: params.key === 'month', run: () => go({ key: 'month' }) },
    { id: 'lastMonth', label: C.periodUi.presets.lastMonth, pressed: samePick(lastMonth), run: lastMonth ? () => go(lastMonth!) : null },
  ];

  const showNewest = !!period && !!maxDate && P.periodAfterNewest(period, anchor?.dataAsOfUtc ?? null);
  const goNewest = () => {
    if (!maxDate) return;
    const r = P.dayToShiftRange(maxDate, maxDate);
    const next = P.snapToShifts(r.from, r.to, params);
    if (next) setParams(next);
    onClose();
  };

  const actions = (
    <>
      <button type="button" className="pp-quiet" onClick={onClose}>
        {C.periodUi.cancel}
      </button>
      <button type="button" className="ui-btn" disabled={!!reason} aria-describedby={reason ? 'pp-reason' : undefined} onClick={apply}>
        {C.periodUi.apply}
      </button>
    </>
  );

  const body = (
    <div className="pp-body">
      {!phone && (
        <div className="pp-head">
          <h2 id="pp-title">{C.periodUi.title}</h2>
          <span className="pp-cap">{C.periodUi.plantTime}</span>
        </div>
      )}
      {showNewest && (
        <div className="pp-newest">
          <span>{C.periodUi.newestData(fmtDate(maxDate!))}</span>
          <button type="button" className="ui-link" onClick={goNewest}>
            {C.periodUi.goNewest}
          </button>
        </div>
      )}
      <div className="pp-presets" role="group" aria-label={C.periodUi.quick}>
        {presets.map((p) => (
          <button key={p.id} type="button" className="pp-preset" aria-pressed={p.pressed} disabled={!p.run} onClick={() => p.run?.()}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="pp-sec" role="group" aria-label={C.periodUi.custom}>
        <span className="pp-cmp__lbl">{C.periodUi.custom}</span>
        <div className="pp-grid">
          <div className="pp-fld">
            <label htmlFor="pp-fd">{C.periodUi.fromDate}</label>
            <input id="pp-fd" type="date" className="pp-input" value={draft.fd} onChange={(e) => set({ fd: e.target.value })} aria-invalid={reason !== null} />
          </div>
          <ShiftSelect id="pp-fs" label={C.periodUi.fromShift} value={draft.fs} onChange={(v) => set({ fs: v })} />
          <div className="pp-fld">
            <label htmlFor="pp-td">{C.periodUi.toDate}</label>
            <input id="pp-td" type="date" className="pp-input" value={draft.td} onChange={(e) => set({ td: e.target.value })} aria-invalid={reason !== null} />
          </div>
          <ShiftSelect id="pp-ts" label={C.periodUi.toShift} value={draft.ts} onChange={(v) => set({ ts: v })} />
        </div>
        {reason ? (
          <p id="pp-reason" className="pp-reason" role="alert">
            {reason}
          </p>
        ) : (
          preview && <p className="pp-sentence">{C.periodUi.shows(preview)}</p>
        )}
        <p className="pp-cap">{C.periodUi.dayRule}</p>
      </div>
      <div className="pp-sec pp-cmp">
        <span className="pp-cmp__lbl">{C.periodUi.compare}</span>
        <Segmented
          label={C.periodUi.compare}
          value={compare ?? 'off'}
          options={[
            { id: 'off', label: FRAGMENTS.compareOpts.off },
            { id: 'prev', label: FRAGMENTS.compareOpts.prev },
            { id: 'week', label: FRAGMENTS.compareOpts.week },
          ]}
          onChange={(id) => setCompare(id === 'prev' || id === 'week' ? id : null)}
        />
      </div>
      {!phone && <div className="pp-actions">{actions}</div>}
    </div>
  );

  if (phone) {
    return (
      <Sheet open onClose={onClose} title={C.periodUi.title} footer={actions}>
        {body}
      </Sheet>
    );
  }
  return <Desktop onClose={onClose}>{body}</Desktop>;
}

function Desktop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div className="pp-root" onKeyDown={onKey}>
      <div className="pp-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="pp-pop" role="dialog" aria-modal="true" aria-labelledby="pp-title" tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
